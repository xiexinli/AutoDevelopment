/**
 * `§1.5 对话` —— #25 历史 / #26 发送（⚡ 回复经 SSE `chat.delta` 流式回传）/ #27 失败重发。
 *
 * **对象与线程（2026-10-22）**：对话的**对象恒为 Project**（由 `project_id` 决定 —— 每个项目一组对话）；
 * **线程 = 项目内的子步骤**（`workbench`/`kb`/`upload`/`review`/`split`/`editor`/`specs`/`apis`/`capabilities`/`versions`）——
 * 即「在哪一步聊的」。未给 `thread` 时**默认归入 `workbench`**（对话原就长在工作台右栏）。
 *
 * 约束（`接口契约 §1.5`）：
 *  - 历史**按 `seq` 升序**返回；**串行处理，禁止并发改写同一 PRD**；
 *  - 空内容 → 400 `INVALID_ARGUMENT`；单条 **≤ 20000 字符**；
 *  - 重发**不重复入库**（不新增第二条用户消息）；
 *  - 对话回复来自第三方大模型 → **受 `#68` 外发开关约束**（关闭时返回明确原因，**不静默降级**）；
 *  - 消息内容按 Markdown 渲染且**转义 HTML、不执行任何标签**（渲染在前端，服务端只存原文）。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser } from "../core/auth.ts";
import { all, get, nowIso, run, uid } from "../db/index.ts";
import { publish } from "../core/tasks.ts";
import { createLlmAdapter, type LlmAdapter } from "../adapters/llm.ts";
import { assertEgressEnabled } from "./ai-egress.ts";
import { modelFor } from "../core/llm-models.ts";
import { traceLlm } from "../core/ai-trace.ts";

const MAX_LEN = 20_000;

interface ChatRow {
  message_id: string; project_id: string; seq: number; role: "user" | "assistant";
  content: string; status: "sent" | "failed";
  /** 对话线程 = 项目内的子步骤（`workbench`/`kb`/…）；`null` = 迁移前的老数据 */
  thread_key: string | null;
  created_at: string;
}

/** 对话**线程** = 项目内的子步骤（与 `App-Spec §3` 的页面 tab 一一对应） */
const THREADS = ["workbench", "kb", "upload", "review", "split", "editor", "specs", "apis", "capabilities", "versions"] as const;
const DEFAULT_THREAD = "workbench";

/** 读线程：未给 / 非法 → `workbench`（**默认线程**，不是「无」） */
function readThread(q: { thread?: unknown } | undefined): string {
  const raw = typeof q?.thread === "string" ? q.thread.trim() : "";
  if (!raw) return DEFAULT_THREAD;
  return (THREADS as readonly string[]).includes(raw) ? raw : DEFAULT_THREAD;
}

/** 序号在「项目 + 线程」范围内单增（线程内连续，便于按 `seq` 排序渲染） */
function nextSeqFor(projectId: string, thread: string): number {
  const row = get<{ m: number }>(
    `SELECT MAX(seq) m FROM tbl_chat_message WHERE project_id=? AND thread_key IS ?`, projectId, thread);
  return (row?.m ?? 0) + 1;
}

export function registerChatRoutes(app: FastifyInstance, adapter?: LlmAdapter) {
  const llm = adapter ?? createLlmAdapter();
  /** 同项目**串行**：同一时刻只有一条消息在处理（禁止并发改写同一 PRD） */
  const chains = new Map<string, Promise<void>>();

  function enqueue(projectId: string, work: () => Promise<void>): void {
    const prev = chains.get(projectId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(work).catch(() => undefined);
    chains.set(projectId, next);
    void next.finally(() => { if (chains.get(projectId) === next) chains.delete(projectId); });
  }

  /** 在飞的对话请求（`#70` 中止流程时一并终止，避免后台继续吃上游） */
  const inflight = new Map<string, Set<AbortController>>();

  /**
   * 生成回复：**真流式**——上游的增量直接 publish `chat.delta`（不再「先取整段再假装分段」）；
   * 成功后落库，失败把该用户消息置 `failed`（可重发），**绝不静默假装成功**。
   */
  function reply(projectId: string, userMessage: ChatRow, userId: string): void {
    enqueue(projectId, async () => {
      const history = all<ChatRow>(
        `SELECT * FROM tbl_chat_message WHERE project_id = ? ORDER BY seq`, projectId,
      ).map((m) => ({ role: m.role, content: m.content }));
      const replyId = uid("msg");
      const thread = userMessage.thread_key ?? DEFAULT_THREAD;
      const seq = nextSeqFor(projectId, thread);
      const ac = new AbortController();
      const set = inflight.get(projectId) ?? new Set<AbortController>();
      set.add(ac); inflight.set(projectId, set);
      let first = true;
      try {
        const usedModel = modelFor(userId);
        const text = await traceLlm(projectId, replyId, "调用大模型生成回复", usedModel,
          () => llm.chat({
            content: userMessage.content, history, signal: ac.signal, model: usedModel,
            onDelta: (delta) => {
              if (!delta) return;
              first = false;
              // 逐段追加（**无淡入、无打字机动画**，仅文本增长）
              publish(projectId, "chat.delta", { message_id: replyId, seq, role: "assistant", thread_key: thread, delta, done: false });
            },
          }),
          (r) => `输出 ${typeof r === "string" ? r.length : 0} 字`);
        if (first && text) publish(projectId, "chat.delta", { message_id: replyId, seq, role: "assistant", thread_key: thread, delta: text, done: false });
        run(`INSERT INTO tbl_chat_message (message_id, project_id, seq, role, content, status, thread_key, created_at)
             VALUES (?,?,?,?,?,?,?,?)`, replyId, projectId, seq, "assistant", String(text), "sent", thread, nowIso());
        publish(projectId, "chat.delta", { message_id: replyId, seq, role: "assistant", thread_key: thread, delta: "", done: true });
      } catch {
        // 上游失败 → 该条用户消息置 failed（界面显示「这条没发出去。」+ 重发）
        run(`UPDATE tbl_chat_message SET status = 'failed' WHERE message_id = ?`, userMessage.message_id);
        publish(projectId, "chat.delta", { message_id: userMessage.message_id, seq: userMessage.seq, role: "user", thread_key: thread, delta: "", done: true, failed: true });
      } finally {
        set.delete(ac);
        if (!set.size) inflight.delete(projectId);
      }
    });
  }

  /** `#70`：中止该项目的在飞对话（终止上游请求） */
  app.addHook("onClose", async () => { for (const set of inflight.values()) for (const ac of set) ac.abort(); });

  /**
   * #25 历史（按 `seq` 升序）。
   * - **不给 `thread`** → 返回该项目**全部线程**的消息（面板据此自行按 `thread_key` 分组、
   *   渲染当前线程并列出「可切回的对话」，一次请求即可，不必逐线程拉）；
   * - 给 `thread=kb` → 只取该线程。
   */
  app.get<{ Params: { project_id: string }; Querystring: { thread?: string } }>(
    "/api/v1/projects/:project_id/chat/messages", async (req, replySend) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const COLS = `message_id, project_id, seq, role, content, status, thread_key, created_at`;
    const thread = typeof req.query.thread === "string" && req.query.thread.trim() ? readThread(req.query) : null;
    const rows = thread
      ? all<ChatRow>(`SELECT ${COLS} FROM tbl_chat_message WHERE project_id = ? AND thread_key IS ? ORDER BY seq`, projectId, thread)
      : all<ChatRow>(`SELECT ${COLS} FROM tbl_chat_message WHERE project_id = ? ORDER BY seq`, projectId);
    void replySend.send({ code: "OK", message: "", request_id: String(req.id), data: { items: rows, thread } });
  });

  /** #26 发送（⚡：回复经 SSE `chat.delta` 流式回传） */
  app.post<{ Params: { project_id: string }; Body: { content?: string; thread?: string } }>(
    "/api/v1/projects/:project_id/chat/messages", async (req, replySend) => {
      const user = currentUser(req);
      const projectId = req.params.project_id;
      assertProjectAccess(user, projectId);
      assertEgressEnabled(user.user_id);

      const thread = readThread(req.body);
      const content = String(req.body?.content ?? "").trim();
      if (!content) throw new ApiError("INVALID_ARGUMENT", "先说点什么再发送。");
      if ([...content].length > MAX_LEN) {
        throw new ApiError("INVALID_ARGUMENT", `消息最多 20000 字符，当前 ${[...content].length} 字符。`);
      }

      const seq = nextSeqFor(projectId, thread);
      const messageId = uid("msg");
      run(`INSERT INTO tbl_chat_message (message_id, project_id, seq, role, content, status, thread_key, created_at)
           VALUES (?,?,?,?,?,?,?,?)`, messageId, projectId, seq, "user", content, "sent", thread, nowIso());

      const row = get<ChatRow>(`SELECT * FROM tbl_chat_message WHERE message_id = ?`, messageId)!;
      reply(projectId, row, user.user_id);

      void replySend.status(202).send({
        code: "OK", message: "", request_id: String(req.id),
        data: { message_id: messageId, seq },
      });
    });

  /** #27 失败重发（**不重复入库**：不新增第二条用户消息） */
  app.post<{ Params: { message_id: string } }>("/api/v1/chat/messages/:message_id/retry", async (req, replySend) => {
    const user = currentUser(req);
    const row = get<ChatRow>(`SELECT * FROM tbl_chat_message WHERE message_id = ?`, req.params.message_id);
    if (!row) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
    assertProjectAccess(user, row.project_id);
    assertEgressEnabled(user.user_id);
    if (row.role !== "user") throw new ApiError("INVALID_ARGUMENT", "只有你发送的消息可以重发。");

    run(`UPDATE tbl_chat_message SET status = 'sent' WHERE message_id = ?`, row.message_id);
    reply(row.project_id, { ...row, status: "sent" }, user.user_id);
    void replySend.send({
      code: "OK", message: "", request_id: String(req.id),
      data: { message_id: row.message_id, seq: row.seq, status: "sent" },
    });
  });
}
