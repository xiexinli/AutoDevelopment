/**
 * 统一响应包与错误码 —— 严格对齐 `platform/design/接口契约.md §0.2 / §0.5`。
 *
 * - 成功：HTTP 200/201 + `code = "OK"`；
 * - 失败：HTTP 4xx/5xx + `code` = 13 个错误码之一 + `message` 为**可直接展示的中文**；
 * - `request_id` 全链路透传（**不含任何 PRD / 代码内容** —— 敏感数据不入日志与 URL）。
 */

export type ErrorCode =
  | "INVALID_ARGUMENT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND"
  | "VERSION_CONFLICT" | "IDEMPOTENT_REPLAY" | "PAYLOAD_TOO_LARGE" | "FORMAT_UNSUPPORTED"
  | "UPSTREAM_TIMEOUT" | "UPSTREAM_UNAVAILABLE" | "RATE_LIMITED" | "TASK_STALE" | "INTERNAL";

/** `§0.5` 错误码 → HTTP 状态 */
export const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_ARGUMENT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENT_REPLAY: 409,
  PAYLOAD_TOO_LARGE: 413,
  FORMAT_UNSUPPORTED: 422,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  TASK_STALE: 409,
  INTERNAL: 500,
};

/** `§0.5` 的默认中文文案（可被具体调用处覆盖；`message` 必须可直接展示） */
export const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  INVALID_ARGUMENT: "参数不正确。",
  UNAUTHENTICATED: "登录已过期，请重新登录。",
  FORBIDDEN: "你没有权限访问这个项目。",
  NOT_FOUND: "这个内容已经不在了。",
  VERSION_CONFLICT: "该内容已被他人修改。",
  IDEMPOTENT_REPLAY: "这次提交已经处理过了。",
  PAYLOAD_TOO_LARGE: "文件超过 20MB。",
  FORMAT_UNSUPPORTED: "暂不支持该格式。",
  UPSTREAM_TIMEOUT: "上游服务超时，可以重试。",
  UPSTREAM_UNAVAILABLE: "服务暂时不可用。",
  RATE_LIMITED: "请求太频繁，请稍后重试。",
  TASK_STALE: "已使用最新结果。",
  INTERNAL: "出了点问题。",
};

export interface Envelope<T> {
  code: "OK" | ErrorCode;
  message: string;
  data: T;
  request_id: string;
}

export class ApiError extends Error {
  code: ErrorCode;
  data: unknown;
  constructor(code: ErrorCode, message?: string, data: unknown = null) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.code = code;
    this.data = data;
  }
}

let reqSeq = 0;
export function newRequestId(): string {
  reqSeq = (reqSeq + 1) % 1e6;
  return `req_${Date.now().toString(36)}${reqSeq.toString(36).padStart(4, "0")}`;
}

export function ok<T>(data: T, requestId: string): Envelope<T> {
  return { code: "OK", message: "", data, request_id: requestId };
}

export function fail(code: ErrorCode, message: string | undefined, data: unknown, requestId: string): Envelope<unknown> {
  return { code, message: message ?? DEFAULT_MESSAGE[code], data, request_id: requestId };
}
