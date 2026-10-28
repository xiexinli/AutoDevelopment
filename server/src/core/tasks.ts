import { all, get, nowIso, run, tx, uid } from "../db/index.ts";
import { aiStep } from "./ai-trace.ts";
import { ApiError } from "./envelope.ts";
/**
 * 单次任务上限：**契约默认 5min**（`接口契约 §0.4`）。
 * 本地跑大模型（如本机 35B）时单次调用就可能 40s+，5 份 Spec 串行会超；
 * 因此提供 `AD_TASK_TIMEOUT_MS` 覆盖，**仅在本地联调使用**，生产按契约 5min。
 */
const TASK_TIMEOUT_MS = Number(process.env.AD_TASK_TIMEOUT_MS ?? 300_000);

export type TaskType = "parse" | "review" | "split" | "spec_gen" | "code_gen" | "verify_l1";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "timeout" | "canceled";
export interface TaskRow {
  task_id: string; project_id: string; page_id: string | null; type: TaskType; status: TaskStatus;
  progress: number; seq: number; input_hash: string; error_code: string | null;
  result_ref: string | null; started_at: string | null; finished_at: string | null; created_at: string;
}
type Listener = (event: string, data: unknown) => void;
const hubs = new Map<string, Set<Listener>>();
const controllers = new Map<string, AbortController>();
const cleanupHandlers = new Map<string, (status:TaskStatus)=>void>();
const cleaned = new Set<string>();
export function registerTaskCleanup(id:string,fn:(status:TaskStatus)=>void):void { cleanupHandlers.set(id,fn); }
function cleanup(id:string,status:TaskStatus):void {
  if(cleaned.has(id)) return;
  cleaned.add(id); cleanupHandlers.get(id)?.(status);
}
export function subscribe(projectId: string, fn: Listener): () => void {
  const set = hubs.get(projectId) ?? new Set<Listener>(); hubs.set(projectId, set); set.add(fn);
  return () => { set.delete(fn); if (!set.size) hubs.delete(projectId); };
}
export function publish(projectId: string, event: string, data: unknown): void {
  for (const fn of hubs.get(projectId) ?? []) { try { fn(event, data); } catch { /* isolated subscriber */ } }
}
export function nextSeq(projectId: string): number {
  return (get<{ m: number }>(`SELECT MAX(seq) AS m FROM tbl_gen_task WHERE project_id = ?`, projectId)?.m ?? 0) + 1;
}
export function getTask(taskId: string): TaskRow | undefined {
  return get<TaskRow>(`SELECT * FROM tbl_gen_task WHERE task_id = ?`, taskId);
}
export function createTask(opts: { projectId: string; type: TaskType; pageId?: string | null; seq?: number; inputHash?: string }): TaskRow {
  const id = uid("tk");
  run(`INSERT INTO tbl_gen_task (task_id,project_id,page_id,type,status,progress,seq,input_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    id, opts.projectId, opts.pageId ?? null, opts.type, "queued", 0, opts.seq ?? nextSeq(opts.projectId), opts.inputHash ?? "", nowIso());
  return getTask(id)!;
}
/** 任务类型 → 过程标题（对话面板「AI 处理过程」展示用） */
const TASK_STEP_TITLE: Record<TaskType, string> = {
  parse: "解析 PRD 文档",
  review: "门禁审核",
  split: "需求拆解",
  spec_gen: "生成角色 Spec",
  code_gen: "生成安卓代码",
  verify_l1: "L1 验证",
};

function emit(id: string): void {
  const t = getTask(id); if (!t) return;
  publish(t.project_id, "task", { task_id: id, type: t.type, page_id:t.page_id, project_id:t.project_id, status: t.status, progress: t.progress, seq: t.seq });
  // `ai.step`：把任务生命周期也送进「AI 处理过程」（同 `step_id` 覆盖式更新，前端原地刷新）
  aiStep(t.project_id, {
    step_id: t.task_id, task_id: t.task_id, kind: `task:${t.type}`,
    title: TASK_STEP_TITLE[t.type] ?? t.type,
    // 与 `接口-Spec §5.0.3` 冻结表的 11 键保持**同一形状**：本类不适用的键显式给 `null`
    detail: null, model: null, duration_ms: null,
    phase: t.status,
    status: t.status === "succeeded" ? "done"
      : t.status === "failed" || t.status === "timeout" ? "failed"
      : t.status === "canceled" ? "canceled" : "running",
    progress: t.progress, at: nowIso(),
  });
}
export interface TaskContext {
  taskId: string; projectId: string; signal: AbortSignal;
  check: () => void; progress: (n: number) => void;
  /** 同步事务：检查任务/输入是否有效，再落业务结果和成功终态；禁止在事务内 await。 */
  commit: (fn: () => string | null) => string | null;
}
export type TaskWorker = (ctx: TaskContext) => Promise<string | null>;
export function startTask(id: string, worker: TaskWorker, opts: { timeoutMs?: number; onFailure?: (status: TaskStatus) => void; onSettled?:()=>void } = {}): void {
  const t = getTask(id); if (!t) return;
  const ac = new AbortController(); controllers.set(id, ac);
  if(opts.onFailure) cleanupHandlers.set(id,opts.onFailure);
  run(`UPDATE tbl_gen_task SET status='running',started_at=?,progress=1 WHERE task_id=?`, nowIso(), id); emit(id);
  const check = () => {
    if (ac.signal.aborted || getTask(id)?.status !== "running") throw new ApiError("TASK_STALE", "任务已停止，未应用本次结果。");
  };
  const finishFailure = (status: TaskStatus, code: string | null) => {
    tx(() => {
      run(`UPDATE tbl_gen_task SET status=?,error_code=?,finished_at=? WHERE task_id=? AND status IN ('queued','running')`, status, code, nowIso(), id);
      cleanup(id,status);
    }); emit(id);
  };
  const timer = setTimeout(() => {
    if (getTask(id)?.status !== "running") return;
    ac.abort(); finishFailure("timeout", "UPSTREAM_TIMEOUT");
  }, opts.timeoutMs ?? TASK_TIMEOUT_MS);
  setTimeout(async () => {
    let committed = false;
    try {
      check();
      const result = await worker({ taskId: id, projectId: t.project_id, signal: ac.signal, check,
        progress: (n) => { check(); run(`UPDATE tbl_gen_task SET progress=? WHERE task_id=?`, Math.max(0, Math.min(99, n)), id); emit(id); },
        commit: (fn) => {
          const result = tx(() => {
            check(); const ref = fn();
            run(`UPDATE tbl_gen_task SET status='succeeded',progress=100,result_ref=?,finished_at=? WHERE task_id=?`, ref, nowIso(), id);
            return ref;
          }); committed = true; emit(id); return result;
        },
      });
      if (!committed) {
        check(); run(`UPDATE tbl_gen_task SET status='succeeded',progress=100,result_ref=?,finished_at=? WHERE task_id=?`, result, nowIso(), id); emit(id);
      }
    } catch (e) {
      const status = getTask(id)?.status;
      if (status === "running") finishFailure("failed", e instanceof ApiError ? e.code : "INTERNAL");
      else if (status === "canceled") cleanup(id,"canceled");
    } finally { clearTimeout(timer); controllers.delete(id); cleanupHandlers.delete(id); cleaned.delete(id); opts.onSettled?.(); }
  }, 0);
}
export function cancelTask(id: string): boolean {
  const t = getTask(id); if (!t) return false;
  if (t.status === "canceled") return true;
  if (!["queued", "running"].includes(t.status)) throw new ApiError("INVALID_ARGUMENT", "任务已经结束了。");
  controllers.get(id)?.abort();
  tx(()=>{
    run(`UPDATE tbl_gen_task SET status='canceled',finished_at=? WHERE task_id=?`,nowIso(),id);
    cleanup(id,"canceled");
  }); emit(id); return true;
}
export function hasRunning(projectId: string, type?: TaskType): boolean {
  return !!get(`SELECT task_id FROM tbl_gen_task WHERE project_id=? AND status IN ('queued','running')${type ? " AND type=?" : ""} LIMIT 1`,
    ...[projectId, ...(type ? [type] : [])]);
}
