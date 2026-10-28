import { IS_MOCK, BASE_URL, ApiError, request } from "@/api/client";
import { session, fetchStats, listProjectTasks, listChatMessages, type ChatMessage } from "@/store/session";


export type StreamStatus = "live" | "polling" | "offline";
export interface TaskStreamHandlers {
  onStatus: (s: StreamStatus) => void;
  onEvent?: (type: string, data: unknown) => void;
}
interface TaskStream { close: () => void }

/** 按项目共享连接；EditPage / Workbench / ChatPanel 都只增加订阅引用。 */
const streams = new Map<string, SharedStream>();
function safely(fn: () => void) { try { fn(); } catch { /* 一个订阅者不得破坏其他订阅者 */ } }

/** 增量 SSE 解码：支持 CRLF、分块 UTF-8、多行 data 与命名 event。 */
export function createEventParser(onEvent: (type: string, data: unknown, id?: string) => void) {
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let id: string | undefined;
  const line = (s: string) => {
    if (!s) {
      if (data.length) {
        const raw = data.join("\n");
        let value: unknown = raw;
        try { value = JSON.parse(raw); } catch { /* 文本 delta 也合法 */ }
        onEvent(event, value, id);
      }
      event = "message"; data = [];
      return;
    }
    if (s.startsWith(":")) return;
    const colon = s.indexOf(":");
    const field = colon < 0 ? s : s.slice(0, colon);
    const value = colon < 0 ? "" : s.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value || "message";
    if (field === "data") data.push(value);
    if (field === "id" && !value.includes("\0")) id = value;
  };
  return (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const i = buffer.search(/[\r\n]/);
      if (i < 0 || (buffer[i] === "\r" && i === buffer.length - 1)) break;
      const size = buffer[i] === "\r" && buffer[i + 1] === "\n" ? 2 : 1;
      line(buffer.slice(0, i));
      buffer = buffer.slice(i + size);
    }
  };
}

class SharedStream {
  readonly handlers = new Set<TaskStreamHandlers>();
  status: StreamStatus = "polling";
  private closed = false;
  private connecting = false;
  private live = false;
  private failures = 0;
  private lastEventId = "";
  private streamAbort: AbortController | null = null;
  private pollAbort: AbortController | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly projectId: string) {}
  start() {
    this.fallback();
    if (!IS_MOCK) void this.connect();
  }
  private report(s: StreamStatus) {
    this.status = s;
    if (!this.closed) this.handlers.forEach((h) => safely(() => h.onStatus(s)));
  }
  private emit(type: string, data: unknown) {
    // `ai.step` 一律先落客户端缓存：**与是否有订阅者无关**
    // （面板未打开时也要记，否则整页刷新后打开面板看不到服务端补发的历史步骤）
    if (type === "ai.step" && data && typeof data === "object") {
      const s = data as AiStep;
      if (typeof s.step_id === "string" && typeof s.title === "string") rememberAiStep(this.projectId, s);
    }
    if (!this.closed) this.handlers.forEach((h) => safely(() => h.onEvent?.(type, data)));
  }
  private resetHeartbeat() {
    if (this.heartbeat) clearTimeout(this.heartbeat);
    // 每 15s ping，45s 无任何字节视为半开连接；建立连接阶段也有超时。
    this.heartbeat = setTimeout(() => this.streamAbort?.abort(), 45000);
  }
  private async poll() {
    if (this.closed || this.live || this.pollAbort) return;
    const controller = new AbortController();
    this.pollAbort = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const result = IS_MOCK
        ? await fetchStats(this.projectId, controller.signal)
        : await listProjectTasks(this.projectId, controller.signal);
      if (this.closed || this.live || controller.signal.aborted) return;
      this.failures = 0;
      this.emit("task", result);
      this.report("polling");
    } catch (e) {
      // request 已走全局 401；停止此共享连接的轮询和重连。
      if (e instanceof ApiError && e.status === 401) { this.close(); return; }
      if (!this.closed && !this.live) {
        this.failures += 1;
        this.report(this.failures >= 2 ? "offline" : "polling");
      }
    } finally {
      clearTimeout(timeout);
      if (this.pollAbort === controller) this.pollAbort = null;
      if (!this.closed && !this.live) this.pollTimer = setTimeout(() => { this.pollTimer = null; void this.poll(); }, 2000);
    }
  }
  private fallback() {
    if (this.closed) return;
    this.live = false;
    this.report(this.failures >= 2 ? "offline" : "polling");
    if (!this.pollAbort && !this.pollTimer) void this.poll();
  }
  private async syncTasks(signal: AbortSignal) {
    try {
      const r = await listProjectTasks(this.projectId, signal);
      if (!this.closed && !signal.aborted) this.emit("task", r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.close();
      // 非鉴权失败时 SSE 仍可在线；订阅者可用 #44 对齐任务。
    }
  }
  private async unauthorized() {
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    this.pollAbort?.abort();
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      // fetch SSE 不经过 API 客户端；用 #66 触发既有清 token / 跳登录处理。
      await request("/users/me", { signal: abort.signal });
    } catch { /* 401 已由 request 统一处理；无论校验结果如何都不重连此连接。 */ }
    finally { clearTimeout(timeout); this.close(); }
  }
  private async connect() {
    if (this.closed || this.connecting || IS_MOCK) return;
    this.connecting = true;
    const controller = new AbortController();
    this.streamAbort = controller;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    this.resetHeartbeat();
    try {
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      // 只放在 header；每次重连取最新 token，不写 URL/localStorage 的额外副本。
      const token = session.token;
      if (!token) { await this.unauthorized(); return; }
      headers.Authorization = `Bearer ${token}`;
      if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId;
      const response = await fetch(`${BASE_URL}/projects/${encodeURIComponent(this.projectId)}/tasks/stream`, {
        headers, signal: controller.signal, cache: "no-store",
      });
      if (response.status === 401) { await this.unauthorized(); return; }
      if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        throw new Error(`SSE ${response.status}`);
      }
      if (this.closed) return;
      this.live = true; this.failures = 0;
      if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
      this.pollAbort?.abort();
      this.report("live");
      // 服务端未必重放事件：每次重连都取任务列表，不能漏掉断线期间的完成态。
      void this.syncTasks(controller.signal);
      const parse = createEventParser((type, data, id) => {
        if (id !== undefined) this.lastEventId = id;
        if (type === "task" || type === "chat.delta" || type === "ping") this.emit(type, data);
        else this.emit(type, data); // 保留原 onEvent 接口对扩展事件的兼容性
      });
      const decoder = new TextDecoder();
      reader = response.body.getReader();
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) break;
        this.resetHeartbeat();
        parse(decoder.decode(value, { stream: true }));
      }
      parse(decoder.decode());
    } catch { /* 断线由轮询接管，后台持续重连 */ }
    finally {
      try { await reader?.cancel(); } catch { /* aborted */ }
      reader?.releaseLock();
      controller.abort();
      if (this.heartbeat) { clearTimeout(this.heartbeat); this.heartbeat = null; }
      if (this.streamAbort === controller) this.streamAbort = null;
      this.connecting = false;
      if (!this.closed) {
        this.fallback();
        this.reconnect = setTimeout(() => { this.reconnect = null; void this.connect(); }, 3000);
      }
    }
  }
  close() {
    this.closed = true;
    this.streamAbort?.abort(); this.pollAbort?.abort();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.handlers.clear();
    if (streams.get(this.projectId) === this) streams.delete(this.projectId);
  }
}

/** 保留 openTaskStream 返回 close 的旧接口，最后一个引用释放时才关连接。 */
export function openTaskStream(projectId: string, h: TaskStreamHandlers): TaskStream {
  let shared = streams.get(projectId);
  const isNew = !shared;
  if (!shared) { shared = new SharedStream(projectId); streams.set(projectId, shared); }
  shared.handlers.add(h);
  safely(() => h.onStatus(shared.status));
  if (isNew) shared.start();
  let closed = false;
  return { close() {
    if (closed) return;
    closed = true;
    shared.handlers.delete(h);
    if (!shared.handlers.size) { shared.close(); if (streams.get(projectId) === shared) streams.delete(projectId); }
  } };
}

/** 对话订阅同一条 SSE；chat.delta 即时追加，断线 / Mock 时轮询补齐。 */export function watchChat(projectId: string, onMessages: (items: ChatMessage[]) => void, onStatus?: (s: StreamStatus) => void) {
  let closed = false;
  let status: StreamStatus = "polling";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let failures = 0;
  let epoch = 0;
  let messages: ChatMessage[] = [];
  const publish = () => { if (!closed) onMessages([...messages].sort((a, b) => a.seq - b.seq)); };
  const tick = async () => {
    if (closed || controller) return;
    if (timer) { clearTimeout(timer); timer = null; }
    const abort = new AbortController(); controller = abort;
    const timeout = setTimeout(() => abort.abort(), 10000);
    const revision = epoch;
    try {
      const r = await listChatMessages(projectId, null, abort.signal);
      if (closed || abort.signal.aborted) return;
      failures = 0;
      // HTTP 请求期间收到 delta 时，不能让较旧响应回退流式正文。
      if (revision === epoch) messages = r.items;
      else messages = [...r.items.filter((m) => !messages.some((v) => v.message_id === m.message_id)), ...messages];
      publish();
      onStatus?.(status);
    } catch {
      if (!closed) { failures += 1; onStatus?.(failures >= 2 && status !== "live" ? "offline" : status); }
    } finally {
      clearTimeout(timeout);
      if (controller === abort) controller = null;
      if (!closed) timer = setTimeout(() => void tick(), status === "live" ? 15000 : IS_MOCK ? 800 : 2000);
    }
  };
  const stream = openTaskStream(projectId, {
    onStatus(s) {
      const changed = status !== s; status = s; onStatus?.(s);
      if (changed) { if (timer) clearTimeout(timer); timer = null; void tick(); }
    },
    onEvent(type, data) {
      if (closed || type !== "chat.delta") return;
      if (!data || typeof data !== "object") { void tick(); return; }
      const d = data as Partial<ChatMessage> & { delta?: string; done?: boolean; message?: Partial<ChatMessage>; thread_key?: string | null };
      const m = d.message ?? d;
      if (!m.message_id || typeof m.seq !== "number") { void tick(); return; }
      epoch += 1;
      const previous = messages.find((v) => v.message_id === m.message_id);
      const next: ChatMessage = {
        message_id: m.message_id, seq: m.seq, role: m.role ?? previous?.role ?? "assistant",
        content: typeof d.delta === "string" ? (previous?.content ?? "") + d.delta : m.content ?? previous?.content ?? "",
        // `chat.delta` 的冻结字段是 `{message_id,seq,delta,thread_key}` —— **不带 `created_at`**。
        // 新消息必须以**到达时刻**兜底，否则 `created_at=''` → `atMs()` 得 `0` → 在「消息 + 步骤」的
        // 同一条时间线里被排到**最前**；面板又一直自动滚到底，用户就看不到这条刚生成的回复
        // （要等下一次 `#25` 全量刷新才「出现」——正是「回复完成但内容不显示」的成因）。
        created_at: m.created_at ?? previous?.created_at ?? new Date().toISOString(),
        status: m.status ?? previous?.status ?? "sent",
        // 线程随事件带回（消息按 `thread_key` 分组在面板里完成，这里不筛）
        thread_key: d.thread_key ?? m.thread_key ?? previous?.thread_key ?? null,
      };
      messages = [...messages.filter((v) => v.message_id !== next.message_id), next];
      publish();
      // 终态（`done`）：服务端此时**已落库**，再拉一次 `#25`，用权威的 `created_at`/`status`
      // 替换本地推测值（面板的合并逻辑会比对该字段，因此校正结果能真正生效）。
      if (d.done === true) void tick();
    },
  });
  void tick();
  return { close() {
    closed = true; stream.close(); controller?.abort(); if (timer) clearTimeout(timer);
  } };
}

/**
 * `AI 处理过程`（服务端 `ai.step` 事件）—— 供**对话面板**实时展示「AI 正在做什么」。
 *
 * 与 `watchChat` / 任务观察**共用同一条 SSE 连接**（`openTaskStream` 内部按项目共享）。
 * 说明：过程条目**只存在于运行时**（服务端不落库），刷新页面后会清空 —— 这是刻意的
 * （过程是观察面，不是业务数据；不新增实体、不改接口契约）。
 */
export interface AiStep {
  step_id: string;
  task_id?: string | null;
  kind: string;
  title: string;
  detail?: string | null;
  model?: string | null;
  status: "running" | "done" | "failed" | "canceled";
  progress?: number | null;
  duration_ms?: number | null;
  at: string;
  /** 服务端任务态（`queued`/`running`/…），仅任务类步骤有 */
  phase?: string;
}

/**
 * 客户端侧过程缓存（**模块级**，不随组件卸载消失）。
 *
 * 为什么需要：SSE 是**按项目共享的长连接**，悬浮对话框收起再打开只是重新挂载组件，
 * **不会新建连接**，服务端的「订阅时补发」这次拿不到；本缓存让重挂载的面板立刻恢复列表。
 * 整页刷新 / 断线重连时连接会重建，由**服务端**近期步骤缓存补发兜底 —— 两层互补。
 */
const aiCache = new Map<string, AiStep[]>();

function rememberAiStep(projectId: string, step: AiStep): void {
  const list = aiCache.get(projectId) ?? [];
  const i = list.findIndex((x) => x.step_id === step.step_id);
  if (i >= 0) list[i] = step; else list.push(step);
  aiCache.set(projectId, list.slice(-60));
}

export function watchAiSteps(projectId: string, onStep: (s: AiStep) => void): { close: () => void } {
  // 重挂载（悬浮框收起再打开）时先用客户端缓存立刻恢复列表
  const cached = aiCache.get(projectId);
  if (cached) for (const s of cached) safely(() => onStep(s));
  return openTaskStream(projectId, {
    onStatus: () => { /* 状态由页面层统一处理 */ },
    onEvent: (type, data) => {
      if (type !== "ai.step" || !data || typeof data !== "object") return;
      const s = data as AiStep;
      if (typeof s.step_id !== "string" || typeof s.title !== "string") return;
      safely(() => onStep(s));
    },
  });
}
