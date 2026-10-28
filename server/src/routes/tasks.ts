/**
 * `§0.4 长任务` —— #44 任务状态 / #44a 取消 / #45 SSE 流。
 *
 * `#45` 事件：`task`（任务状态变化）、`chat.delta`（对话流式，见 B3）、`ping`（**15s 心跳**，用于发现断线）。
 * 头部：`Content-Type: text/event-stream`、`Cache-Control: no-cache`。
 * 断线重连由浏览器 `EventSource` 自动完成；重连后前端以 `#44` **按 `seq` 取最新结果**。
 */
import type { FastifyInstance } from "fastify";
import { recentSteps } from "../core/ai-trace.ts";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser } from "../core/auth.ts";
import { readMeta } from "../core/revisions.ts";
import { all } from "../db/index.ts";
import { cancelTask, getTask, subscribe, type TaskRow } from "../core/tasks.ts";

export function registerTaskRoutes(app: FastifyInstance) {
  /** #44 任务状态 */
  app.get<{ Params: { task_id: string } }>("/api/v1/tasks/:task_id", async (req, reply) => {
    const user = currentUser(req);
    const t = getTask(req.params.task_id);
    if (!t) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
    assertProjectAccess(user, t.project_id);
    void reply.send({ code: "OK", message: "", request_id: String(req.id), data: publicTask(t) });
  });

  /** #44a 取消（**非失败态**，不计重试、不入版本） */
  app.post<{ Params: { task_id: string } }>("/api/v1/tasks/:task_id/cancel", async (req, reply) => {
    const user = currentUser(req);
    const t = getTask(req.params.task_id);
    if (!t) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
    assertProjectAccess(user, t.project_id);
    cancelTask(t.task_id);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: { task_id: t.task_id, status: "canceled" },
    });
  });

  /** #45 SSE（**单条连接承载全部任务与对话流**） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/tasks/stream", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    let closed=false;
    const stillAllowed=()=>{try{assertProjectAccess(currentUser(req),projectId);return true;}catch{return false;}};
    const send = (event: string, data: unknown) => {
      if(closed)return;
      if(!stillAllowed()){close();return;}
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const unsubscribe = subscribe(projectId, (event, data) => send(event, data));
    const ping = setInterval(() => send("ping", { ts: new Date().toISOString() }), 15_000);

    const close = () => { if(closed)return;closed=true;clearInterval(ping); unsubscribe(); try { reply.raw.end(); } catch { /* ignore */ } };
    send("ping", {ts:new Date().toISOString()});
    // 补发项目近期 AI 处理步骤：悬浮对话框重新打开 / 从别的页面切回时，过程不丢
    for (const step of recentSteps(projectId)) send("ai.step", step);
    req.raw.on("close", close);
    req.raw.on("error", close);
    // 不调用 reply.send：已直接写流（Fastify 会因 reply.sent 跳过包壳）
  });

  /** 项目下最近的任务（供前端重连后按 `seq` 对齐；非契约必需，便于联调） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/tasks", async (req, reply) => {
    const user = currentUser(req);
    assertProjectAccess(user, req.params.project_id);
    const rows = getRecent(req.params.project_id);
    void reply.send({ code: "OK", message: "", request_id: String(req.id), data: { items: rows.map(publicTask) } });
  });
}

function publicTask(t: TaskRow) {
  return {
    task_id: t.task_id, type: t.type, page_id: t.page_id, project_id:t.project_id, status: t.status, progress: t.progress, seq: t.seq,
    ...(readMeta<any>(t.project_id,`task_info:${t.task_id}`)??{}),
    l2_result:readMeta<any>(t.project_id,`l2:${t.task_id}`)??{reported:false,passed:false,log_digest:""},
    result_ref: t.result_ref, error_code: t.error_code, started_at: t.started_at, finished_at: t.finished_at,
  };
}

function getRecent(projectId: string): TaskRow[] {
  return all<TaskRow>(
    `SELECT * FROM tbl_gen_task WHERE project_id = ? ORDER BY created_at DESC LIMIT 20`, projectId);
}
