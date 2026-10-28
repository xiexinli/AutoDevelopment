/**
 * 平台自身埋点（A 线）—— 前端上报通道。
 *
 * 契约来源：`platform/specs/埋点-Spec.md §5`（公共参数 / 上报通道）+ `§3`（事件字典）
 *          + `platform/specs/App-Spec.md §10`（27 个埋码点）。
 *
 * 硬约束（逐条遵守）：
 * - 走 **`#62 POST /metrics/events`**（批量），`Authorization: Bearer <token>`；
 * - **失败不阻塞业务**、界面**不暴露上报错误**；
 * - 上报体**不含** PRD 正文 / 生成代码 / 对话正文 / 文件名 / 项目名 / 令牌 / `open_id` 明文 / 登录表单输入；
 * - 每条必带 `event_id`（幂等）/ `event_name` / `client_ts` / `schema_version` / 公共参数；
 * - 批量时机：队列满 **20 条** 或距上次 flush **30s**；漏斗/旁路/合规事件**即时 flush**；
 * - 退出补报：`visibilitychange=hidden` / `pagehide` 时 flush（`keepalive`）；
 * - 断网：队列持久化 `localStorage`（**上限 200，超出丢最旧**），`online` 后 FIFO 补报；
 * - 重试：**静默指数退避 ≤2 次**（1s / 3s），仍失败则丢弃该批并在本地计数。
 */
import { BASE_URL, IS_MOCK } from "@/api/client";
import { session } from "@/store/session";

/** 事件结构版本（`埋点-Spec §5`：string(8)，构建注入） */
export const SCHEMA_VERSION = "1.0";
/** 平台前端构建版本（`app_version`） */
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "web-dev";

const LS_DEVICE = "ad.device_id";
const LS_SESSION = "ad.session_id";
const LS_SESSION_TS = "ad.session_last_ts";
const LS_QUEUE = "ad.track_queue";
const LS_DROPPED = "ad.track_dropped";

const MAX_QUEUE = 200;
const FLUSH_AT = 20;
const FLUSH_MS = 30_000;
const SESSION_IDLE_MS = 30 * 60_000;

export interface TrackItem {
  event_id: string; event_name: string; client_ts: string; schema_version: string;
  device_id: string; anon_id?: string; session_id: string; app_version: string; platform: "web";
  page_rt: string; prev_rt: string | null; project_id: string | null;
  dedup_key: string | null; seq: number | null;
  [k: string]: unknown;
}

export interface TrackOptions {
  /** 业务幂等键（`埋点-Spec §5` 的 `dedup_key`）；用于「同一次用户意图只上报一次」 */
  dedupKey?: string | null;
  /** 同一 `dedupKey` / 事件的本地去重窗口（ms），默认 3000 */
  dedupWindowMs?: number;
  /** 生成任务序号（仅任务类事件） */
  seq?: number | null;
  /** 漏斗节点 / 旁路 / 合规事件 → 入队后立即 flush */
  immediate?: boolean;
}

// ---------- 基础标识 ----------

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 隐私模式等：忽略 */ }
}

/** `device_id`：浏览器 `localStorage` 持久 UUID（清除浏览器数据即更换） */
export function deviceId(): string {
  let v = lsGet(LS_DEVICE);
  if (!v) { v = uuid(); lsSet(LS_DEVICE, v); }
  return v;
}

/** `anon_id`：未登录场景的 `device_id` 派生值（`埋点-Spec §5`） */
export function anonId(): string {
  return `anon_${deviceId().replace(/-/g, "").slice(0, 28)}`;
}

/** `session_id`：登录成功时新建；**30 分钟无任何事件**即切新会话（`埋点-Spec §5`） */
function currentSessionId(touch = true): string {
  const now = Date.now();
  const last = Number(lsGet(LS_SESSION_TS) ?? 0);
  let sid = lsGet(LS_SESSION);
  if (!sid || (last && now - last > SESSION_IDLE_MS)) {
    sid = uuid();
    lsSet(LS_SESSION, sid);
  }
  if (touch) lsSet(LS_SESSION_TS, String(now));
  return sid;
}

/** 登录成功后重开会话（`埋点-Spec §5`）；登出也可调用以断开旧会话 */
export function trackRenewSession(): void {
  lsSet(LS_SESSION, uuid());
  lsSet(LS_SESSION_TS, String(Date.now()));
}

// ---------- 路由上下文（`page_rt` / `prev_rt`） ----------

let curRt: string | null = null;
let prevRt: string | null = null;
let curProjectId: string | null = null;

/** 由路由层在每次切换时调用；`rt` 取 `App-Spec §3` 的 `RT-*` */
export function trackRoute(rt: string | null, projectId: string | null = null): void {
  if (rt === curRt) { curProjectId = projectId; return; }
  prevRt = curRt;
  curRt = rt;
  curProjectId = projectId;
}

/** 当前路由（供全局拦截器等非组件上下文取 `source_rt`） */
export function currentRouteRt(): string {
  return curRt ?? "RT-UNKNOWN";
}

// ---------- 队列 ----------

let queue: TrackItem[] = loadQueue();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function loadQueue(): TrackItem[] {
  try {
    const raw = lsGet(LS_QUEUE);
    const arr = raw ? (JSON.parse(raw) as TrackItem[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function persistQueue(): void {
  try { lsSet(LS_QUEUE, JSON.stringify(queue)); } catch { /* 超配额：忽略 */ }
}
function push(item: TrackItem): void {
  queue.push(item);
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE); // 丢最旧
  persistQueue();
}

function droppedCount(): number {
  return Number(lsGet(LS_DROPPED) ?? 0);
}
function bumpDropped(n: number): void {
  lsSet(LS_DROPPED, String(droppedCount() + n));
}

// ---------- 本地去重（同一次用户意图只上报一次） ----------

const seen = new Map<string, number>();
function isDuplicate(key: string, windowMs: number): boolean {
  const now = Date.now();
  const prev = seen.get(key);
  if (prev !== undefined && now - prev < windowMs) return true;
  seen.set(key, now);
  if (seen.size > 500) for (const [k, t] of seen) if (now - t > 60_000) seen.delete(k);
  return false;
}

// ---------- 上报 ----------

/** 单条入队。**失败不阻塞业务**：本函数同步返回，网络动作全部异步。 */
export function track(eventName: string, params: Record<string, unknown> = {}, opts: TrackOptions = {}): void {
  if (IS_MOCK) return; // mock 模式无后端：不上报，也不产生噪音
  if (!/^EVT_[a-z0-9_]+$/.test(eventName)) return; // 只接正式事件名（`EVT_<模块>_<动作>` 全小写）

  const { dedupKey = null, dedupWindowMs = 3000, seq = null, immediate = false } = opts;
  const dedup = dedupKey ?? `${eventName}:${curRt ?? ""}:${JSON.stringify(params).slice(0, 120)}`;
  if (isDuplicate(dedup, dedupWindowMs)) return;

  const token = session.token;
  const item: TrackItem = {
    event_id: uuid(),
    event_name: eventName,
    client_ts: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    device_id: deviceId(),
    ...(token ? {} : { anon_id: anonId() }),
    session_id: currentSessionId(),
    app_version: APP_VERSION,
    platform: "web",
    page_rt: curRt ?? "RT-UNKNOWN",
    prev_rt: prevRt,
    project_id: curProjectId,
    dedup_key: dedupKey,
    seq,
    ...params,
  };
  push(item);

  if (immediate) { void flush(); return; }
  if (queue.length >= FLUSH_AT) { void flush(); return; }
  if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS);
}

/** 把当前队列整批上报（异步、静默）。 */
export async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return; // 断网：留在队列，`online` 后补报
  flushing = true;
  const batch = queue.splice(0, queue.length);
  persistQueue();
  try {
    await send(batch);
  } finally {
    flushing = false;
  }
}

async function send(batch: TrackItem[], attempt = 0): Promise<void> {
  const token = session.token;
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${BASE_URL}/metrics/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ schema_version: SCHEMA_VERSION, batch }),
      keepalive: true, // 退出补报语义（`埋点-Spec §5`）
    });
    if (!res.ok && attempt < 2) {
      await sleep(attempt === 0 ? 1000 : 3000);
      return send(batch, attempt + 1);
    }
    if (!res.ok) bumpDropped(batch.length); // 静默丢弃 + 本地计数（不上报失败事件、不弹提示）
  } catch {
    if (attempt < 2) {
      await sleep(attempt === 0 ? 1000 : 3000);
      return send(batch, attempt + 1);
    }
    bumpDropped(batch.length);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 生命周期挂钩 ----------

let installed = false;
/** 应用启动时调用一次（`main.tsx`）。挂退出补报 / 断网补报 / 定时 flush。 */
export function installTracking(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const onHidden = () => { if (document.visibilityState === "hidden") void flush(); };
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", () => { void flush(); });
  window.addEventListener("online", () => { void flush(); });

  if (queue.length > 0) void flush(); // 上次会话残留 → 启动补报
  timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS);
}

/** 仅供本地自检/测试读取（不参与业务） */
export const __trackDebug = { queueSize: () => queue.length, dropped: droppedCount };
