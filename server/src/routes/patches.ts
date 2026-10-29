/**
 * 二期 · 增量写回（`REQ-PATCH-001` / `F18`）—— #N4 应用补丁 / #N5 补丁列表 / #N6 回滚。
 *
 * 前置：项目须已接入既有工程（`source_kind='imported'` + `engineering_root`，由 `#73` 写入）。
 * 语义：**自动写**（`D3`）但**冲突不静默覆盖**；写前快照、原子落盘、可一键回滚；manifest 落 `tbl_project_meta['patch_sets']`。
 */
import type { FastifyInstance } from "fastify";
import { ApiError, ok } from "../core/envelope.ts";
import { assertProjectAccess, currentUser } from "../core/auth.ts";
import { idempotentReplay, rememberIdempotent } from "../core/idempotency.ts";
import { readMeta, writeMeta } from "../core/revisions.ts";
import { applyPatch, rollbackPatch, assertPatchPath, type PatchFile, type PatchPlan } from "../adapters/patch.ts";
import { planBrownfieldMerge, type MergeResult } from "../adapters/brownfield.ts";
import { all, get, uid } from "../db/index.ts";

const META_KEY = "patch_sets";
const MAX_KEPT = 50;

interface ProjectRow { project_id: string; source_kind: string; engineering_root: string | null }

function loadImportedProject(projectId: string): ProjectRow {
  const row = get<ProjectRow>(
    `SELECT project_id, source_kind, engineering_root FROM tbl_project WHERE project_id = ? AND deleted_at IS NULL`, projectId);
  if (!row) throw new ApiError("NOT_FOUND");
  if (row.source_kind !== "imported" || !row.engineering_root)
    throw new ApiError("INVALID_ARGUMENT", "这个项目还没有接入既有工程（先做「接入已有工程」）。");
  return row;
}

function listPlans(projectId: string): PatchPlan[] {
  return readMeta<PatchPlan[]>(projectId, META_KEY) ?? [];
}


export interface WritebackResult { plan: PatchPlan; merge: MergeResult; files: PatchFile[] }

/** 取某次生成任务的产物 → **brownfield 合并** → 写回登记工程根。返回 `null` 表示项目未接入（调用方自行决定是否报错）。 */
export function writebackTask(projectId: string, taskId: string, opts: { overwriteAll?: boolean } = {}): WritebackResult | null {
  const proj = get<ProjectRow>(`SELECT project_id, source_kind, engineering_root FROM tbl_project WHERE project_id = ? AND deleted_at IS NULL`, projectId);
  if (!proj || proj.source_kind !== "imported" || !proj.engineering_root) return null;
  const artifacts = all<{ path: string; kind: string; content: string }>(
    `SELECT path, kind, content FROM tbl_artifact WHERE task_id = ? ORDER BY path`, taskId,
  ).map((r) => ({ path: r.path, kind: r.kind, ...(JSON.parse(r.content) as { content: string; encoding?: "base64" }) }))
    .filter((f) => typeof f.content === "string" && f.encoding !== "base64")
    .map((f) => ({ path: f.path, kind: f.kind, content: f.content as string }));
  if (!artifacts.length) throw new ApiError("INVALID_ARGUMENT", "这次生成没有可写回的产物。");

  const pack = readMeta<{ namespace?: string | null; modules?: string[] }>(projectId, "constraints");
  const merge = planBrownfieldMerge({
    root: proj.engineering_root, generated: artifacts,
    namespace: pack?.namespace ?? null,
  });
  if (!merge.files.length) throw new ApiError("INVALID_ARGUMENT",
    `没有可安全写回的增量（全部被跳过）：${merge.skipped.slice(0, 6).map((s) => `${s.path}（${s.reason}）`).join("；")}`);
  const patchId = uid("patch");
  const plan = applyPatch({
    root: proj.engineering_root, projectId, patchId, files: merge.files,
    message: `生成任务 ${taskId} 自动写回`, overwriteAll: opts.overwriteAll === true,
  });
  writeMeta(projectId, META_KEY, [plan, ...listPlans(projectId)].slice(0, MAX_KEPT));
  return { plan, merge, files: merge.files };
}

export function registerPatchRoutes(app: FastifyInstance): void {
  /** #N4 应用补丁（自动写；冲突/禁碰/越界一律整批拒绝，不产生半成品） */
  app.post<{ Params: { project_id: string }; Body: { files?: PatchFile[]; confirm?: boolean; message?: string; overwrite_all?: boolean } }>(
    "/api/v1/projects/:project_id/patch-applications", async (req, reply) => {
      const user = currentUser(req);
      const projectId = req.params.project_id;
      assertProjectAccess(user, projectId);

      const replay = idempotentReplay(req, user.user_id);
      // 与 `#2`/`#73` 同惯例：**重放返回首次结果（含首次状态码 201）**
      if (replay) { void reply.status(201).send(replay); return; }

      const proj = loadImportedProject(projectId);
      if (req.body?.confirm !== true)
        throw new ApiError("INVALID_ARGUMENT", "写入既有工程前需要显式确认（body 需带 confirm:true）。");
      const files = Array.isArray(req.body?.files) ? req.body!.files! : [];
      // 统一在入口做一次路径校验（与引擎内一致；越界/禁碰在写任何文件之前就拒绝）
      for (const f of files) assertPatchPath((f as { path?: unknown })?.path);

      const patchId = uid("patch");
      const plan = applyPatch({
        root: proj.engineering_root!, projectId, patchId, files,
        message: String(req.body?.message ?? "").slice(0, 200),
        overwriteAll: req.body?.overwrite_all === true,
      });
      const kept = [plan, ...listPlans(projectId)].slice(0, MAX_KEPT);
      writeMeta(projectId, META_KEY, kept);

      const envelope = ok({
        patch_id: plan.patch_id, status: plan.status, created_at: plan.created_at,
        totals: plan.totals,
        entries: plan.entries.map((e) => ({ path: e.path, action: e.action, existed: e.existed, bytes: e.bytes, removed_ids: e.removed_ids })),
        rollback: { method: "POST", path: `/api/v1/projects/${projectId}/patch-applications/${plan.patch_id}/rollback` },
      }, String(req.id));
      rememberIdempotent(req, user.user_id, envelope);
      void reply.status(201).send(envelope);
    });


  /** #N7 把某次**生成任务的产物**按既有工程结构合并后写回（供前端「写回工程」按钮 / 自动衔接复用） */
  app.post<{ Params: { project_id: string; task_id: string }; Body: { confirm?: boolean; overwrite_all?: boolean } }>(
    "/api/v1/projects/:project_id/generation/:task_id/writeback", async (req, reply) => {
      const user = currentUser(req);
      const projectId = req.params.project_id;
      assertProjectAccess(user, projectId);
      const replay = idempotentReplay(req, user.user_id);
      if (replay) { void reply.status(201).send(replay); return; }
      if (req.body?.confirm !== true)
        throw new ApiError("INVALID_ARGUMENT", "写回既有工程前需要显式确认（body 需带 confirm:true）。");
      loadImportedProject(projectId);
      const wb = writebackTask(projectId, req.params.task_id, { overwriteAll: req.body?.overwrite_all === true });
      if (!wb) throw new ApiError("INVALID_ARGUMENT", "这个项目还没有接入既有工程。");
      const envelope = ok({
        patch_id: wb.plan.patch_id, status: wb.plan.status, totals: wb.plan.totals,
        entries: wb.plan.entries.map((e) => ({ path: e.path, action: e.action, removed_ids: e.removed_ids })),
        notes: wb.merge.notes, skipped: wb.merge.skipped,
      }, String(req.id));
      rememberIdempotent(req, user.user_id, envelope);
      void reply.status(201).send(envelope);
    });

  /** #N5 补丁列表（倒序，最多 50） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/patch-applications", async (req, reply) => {
    const user = currentUser(req);
    assertProjectAccess(user, req.params.project_id);
    const rows = listPlans(req.params.project_id).map((p) => ({
      patch_id: p.patch_id, status: p.status, message: p.message, created_at: p.created_at,
      rolled_back_at: p.rolled_back_at ?? null, totals: p.totals,
      files: p.entries.filter((e) => e.action !== "unchanged").map((e) => e.path),
    }));
    void reply.send({ code: "OK", message: "", request_id: String(req.id), data: { items: rows, total: rows.length } });
  });

  /** #N6 回滚（`⬛` 破坏性：二次确认；replace 还原备份、create 删除文件） */
  app.post<{ Params: { project_id: string; patch_id: string }; Body: { confirm?: boolean } }>(
    "/api/v1/projects/:project_id/patch-applications/:patch_id/rollback", async (req, reply) => {
      const user = currentUser(req);
      const projectId = req.params.project_id;
      assertProjectAccess(user, projectId);
      if (req.body?.confirm !== true)
        throw new ApiError("INVALID_ARGUMENT", "回滚是破坏性操作，需要显式确认（body 需带 confirm:true）。");

      const plans = listPlans(projectId);
      const plan = plans.find((p) => p.patch_id === req.params.patch_id);
      if (!plan) throw new ApiError("NOT_FOUND", "没有这次补丁记录。");
      if (plan.status === "rolled_back") throw new ApiError("INVALID_ARGUMENT", "这次补丁已经回滚过了。");

      const result = rollbackPatch(plan);
      plan.status = "rolled_back"; plan.rolled_back_at = new Date().toISOString();
      writeMeta(projectId, META_KEY, plans);
      void reply.send({
        code: "OK", message: "", request_id: String(req.id),
        data: { patch_id: plan.patch_id, status: plan.status, rolled_back_at: plan.rolled_back_at, ...result },
      });
    });
}
