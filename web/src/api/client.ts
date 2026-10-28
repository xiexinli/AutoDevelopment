/**
 * HTTP 客户端 —— 契约来源：`platform/design/接口契约.md §0`
 *
 * 约定（硬契约，不得偏离）：
 * - Base URL `/api/v1/`；统一响应包 `{ code, message, data, request_id }`
 * - 鉴权 `Authorization: Bearer <token>`
 * - 提交类接口带 `Idempotency-Key`；同键 3s 内重放返回首次结果
 * - 可编辑资源带 `version`；写操作须带 `If-Match`，不匹配 → `VERSION_CONFLICT`(409)
 * - 失败 `message` 是**可直接展示的中文**
 *
 * 后端未就绪时走内置 mock（`VITE_USE_MOCK=1`，默认开发环境开启）。
 */

import { mockFetch } from "./mock";

export const BASE_URL = "/api/v1";

/** 13 个错误码（与 `接口契约 §0.5` / `数据模型 §5.4` 一致） */
export type ErrorCode =
  | "INVALID_ARGUMENT" // 400
  | "UNAUTHENTICATED" // 401
  | "FORBIDDEN" // 403
  | "NOT_FOUND" // 404
  | "VERSION_CONFLICT" // 409
  | "IDEMPOTENT_REPLAY" // 409
  | "PAYLOAD_TOO_LARGE" // 413
  | "FORMAT_UNSUPPORTED" // 422
  | "UPSTREAM_TIMEOUT" // 504
  | "UPSTREAM_UNAVAILABLE" // 503
  | "RATE_LIMITED" // 429
  | "TASK_STALE" // 409
  | "INTERNAL"; // 500

export interface ApiEnvelope<T> {
  code: ErrorCode | "OK";
  message: string;
  data: T;
  request_id: string;
}

/** 业务失败：带错误码与可直接展示的文案（`UI-Spec §3.6` 映射） */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly requestId: string;
  readonly data: unknown;

  constructor(code: ErrorCode, status: number, message: string, requestId = "", data: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.data = data;
  }
}

/** 乐观锁冲突（409）——调用方需给出「以我的为准 / 放弃我的改动」 */
export class VersionConflictError extends ApiError {
  constructor(message: string, requestId = "", data: unknown = null) {
    super("VERSION_CONFLICT", 409, message, requestId, data);
    this.name = "VersionConflictError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** 查询串（`page` / `page_size` / `q` / `sort`…），值为 undefined 时忽略 */
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** 乐观锁版本号（可编辑资源的写操作必带） */
  ifMatch?: string | number;
  /** 幂等键（提交类接口）——同键 3s 内重放返回首次结果 */
  idempotencyKey?: string;
  /** 上传等非 JSON 体 */
  formData?: FormData;
  /**
   * 上传进度回调（0~100，逐次赋值、**非动画**）。
   * `fetch` 拿不到上传进度，故带本回调时改走 `XMLHttpRequest` 的 `upload.onprogress`。
   * 用于 `EL-UPLOAD-016`「正在上传…{n}%」。
   */
  onUploadProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

const USE_MOCK =
  (import.meta.env.VITE_USE_MOCK ?? (import.meta.env.DEV ? "1" : "0")) === "1";

let tokenGetter: () => string | null = () => localStorage.getItem("ad.token");
export function setTokenGetter(fn: () => string | null) {
  tokenGetter = fn;
}

/**
 * 全局 401 处理：**token 存在但服务端已失效**时，必须清 token 并跳登录，
 * 否则「/login ↔ /projects」会来回跳成死循环（`UI-Spec §3.6`：401 → 跳登录，恢复草稿）。
 */
let onUnauthorized: ((info: { source_api: string }) => void) | null = null;
export function setUnauthorizedHandler(fn: ((info: { source_api: string }) => void) | null) {
  onUnauthorized = fn;
}

/**
 * 全局 403 钩子（`埋点-Spec §3` 的 `EVT_auth_forbidden`）：
 * 由 `main.tsx` 注册上报器 —— 放在这里**不用 import 埋点模块**，避免 `client ↔ track` 循环依赖。
 */
let onForbidden: ((info: { source_api: string; resource: string }) => void) | null = null;
export function setForbiddenHandler(fn: ((info: { source_api: string; resource: string }) => void) | null) {
  onForbidden = fn;
}
/** 路径 → 埋点 `resource` 枚举（不区分「不存在」与「无权限」，也不携带对象名） */
function resourceOf(path: string): string {
  if (path.startsWith("/kb-docs") || path.includes("/kb-docs") || path.includes("/kb-sectors")) return "kb_doc";
  if (path.includes("/specs")) return "spec";
  if (path.includes("/versions")) return "deliverable";
  if (path.includes("/apis")) return "api_def";
  if (path.includes("/capabilities")) return "capability";
  if (path.includes("/reviews")) return "review";
  return "project";
}
function notifyForbidden(code: string, path: string, method?: string) {
  if (code === "FORBIDDEN") onForbidden?.({ source_api: `${method ?? "GET"} ${path}`, resource: resourceOf(path) });
}
function handleIf401(err: unknown, path = "") {
  if (err instanceof ApiError && err.code === "UNAUTHENTICATED") {
    try { localStorage.removeItem("ad.token"); } catch { /* ignore */ }
    onUnauthorized?.({ source_api: path });
  }
  return err;
}

function qs(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** 生成幂等键（UUID v4；3s 内的同一操作应复用同一个键） */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 带上传进度的发送（仅 multipart；`fetch` 无法提供上传进度） */
function xhrUpload<T>(
  url: string, path: string, opts: RequestOptions, headers: Record<string, string>,
): Promise<ApiEnvelope<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? "POST", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    // 小文件在快链路上可能**一次 `progress` 都不触发**，用 `loadstart`/`load` 兜底，
    // 保证「正在上传…{n}%」至少走到 0% 与 100%。
    xhr.upload.onloadstart = () => opts.onUploadProgress?.(0);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onUploadProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.upload.onload = () => opts.onUploadProgress?.(100);
    xhr.onload = () => {
      let raw: ApiEnvelope<T>;
      try { raw = JSON.parse(xhr.responseText) as ApiEnvelope<T>; }
      catch {
        reject(new ApiError("UPSTREAM_UNAVAILABLE", xhr.status || 0, "服务端返回不是合法 JSON。"));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || raw.code !== "OK") {
        notifyForbidden(raw.code, path, opts.method);
        reject(handleIf401(toApiError(raw, xhr.status), path));
        return;
      }
      resolve(raw);
    };
    xhr.onerror = () => reject(new ApiError("UPSTREAM_UNAVAILABLE", 0, "上传中断了。"));
    xhr.onabort = () => reject(new ApiError("UPSTREAM_UNAVAILABLE", 0, "上传已取消。"));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(opts.formData as FormData);
  });
}

/** 统一请求入口 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${BASE_URL}${path}${qs(opts.query)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = tokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.ifMatch !== undefined) headers["If-Match"] = String(opts.ifMatch);
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";

  let raw: ApiEnvelope<T>;
  if (USE_MOCK) {
    raw = await mockFetch<T>(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body,
      formData: opts.formData,
    });
  } else if (opts.onUploadProgress && opts.formData) {
    raw = await xhrUpload<T>(url, path, opts, headers);
  } else {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });
    raw = (await res.json()) as ApiEnvelope<T>;
    if (!res.ok || raw.code !== "OK") { notifyForbidden(raw.code, path, opts.method); throw handleIf401(toApiError(raw, res.status), path); }
  }

  if (raw.code !== "OK") { notifyForbidden(raw.code, path, opts.method); throw handleIf401(toApiError(raw, httpOf(raw.code)), path); }
  return raw.data;
}

function toApiError<T>(raw: ApiEnvelope<T>, status: number): ApiError {
  if (raw.code === "VERSION_CONFLICT") {
    return new VersionConflictError(raw.message, raw.request_id, raw.data);
  }
  return new ApiError(raw.code as ErrorCode, status, raw.message, raw.request_id, raw.data);
}

/** 错误码 → HTTP 状态（与 `接口契约 §0.5` 一致） */
export function httpOf(code: string): number {
  const map: Record<string, number> = {
    OK: 200, INVALID_ARGUMENT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
    NOT_FOUND: 404, VERSION_CONFLICT: 409, IDEMPOTENT_REPLAY: 409,
    PAYLOAD_TOO_LARGE: 413, FORMAT_UNSUPPORTED: 422, RATE_LIMITED: 429,
    TASK_STALE: 409, UPSTREAM_TIMEOUT: 504, UPSTREAM_UNAVAILABLE: 503, INTERNAL: 500,
  };
  return map[code] ?? 500;
}

/** 错误码 → 界面文案（`UI-Spec §3.6` 映射表，逐字） */
export const ERROR_COPY: Record<ErrorCode, string> = {
  INVALID_ARGUMENT: "", // 字段级提示，保留已输入（文案见各页）
  UNAUTHENTICATED: "登录已过期，已为你保留未提交的内容。",
  FORBIDDEN: "你没有权限访问这个项目。",
  NOT_FOUND: "这个内容已经不在了。",
  VERSION_CONFLICT: "该内容已被他人修改。",
  IDEMPOTENT_REPLAY: "", // 无提示，直接采用首次结果
  PAYLOAD_TOO_LARGE: "文件超过 20MB（当前 {n}MB）。请压缩后重试。",
  FORMAT_UNSUPPORTED: "暂不支持该格式。请上传 .docx / .md 或飞书云文档链接。",
  UPSTREAM_TIMEOUT: "上游服务响应超时（{n}s）。",
  UPSTREAM_UNAVAILABLE: "服务暂时不可用（{code}）。",
  RATE_LIMITED: "请求太频繁，{n} 秒后重试。",
  TASK_STALE: "", // 静默丢弃并提示已用最新结果
  INTERNAL: "出了点问题。",
};

export const IS_MOCK = USE_MOCK;
