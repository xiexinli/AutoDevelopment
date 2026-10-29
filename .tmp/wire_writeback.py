# -*- coding: utf-8 -*-
"""二期 步骤 3：写回 helper + 路由 + generation 自动衔接。"""
import io, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:56])); return s
    return s.replace(old, new, cnt)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ============ patches.ts：writebackTask helper + 显式写回路由 ============
P = "server/src/routes/patches.ts"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, 'import { applyPatch, rollbackPatch, assertPatchPath, type PatchFile, type PatchPlan } from "../adapters/patch.ts";\nimport { get, uid } from "../db/index.ts";',
        'import { applyPatch, rollbackPatch, assertPatchPath, type PatchFile, type PatchPlan } from "../adapters/patch.ts";\nimport { planBrownfieldMerge, type MergeResult } from "../adapters/brownfield.ts";\nimport { all, get, uid } from "../db/index.ts";')
HELPER = '''
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
'''
s = rep(P, s, "export function registerPatchRoutes(app: FastifyInstance): void {", HELPER + "\nexport function registerPatchRoutes(app: FastifyInstance): void {")
ROUTE = '''
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
'''
s = rep(P, s, "  /** #N5 补丁列表（倒序，最多 50） */", ROUTE + "\n  /** #N5 补丁列表（倒序，最多 50） */")
run(P, s)

# ============ generation.ts：生成成功后自动写回（best-effort） ============
P = "server/src/routes/generation.ts"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "       return ctx.commit(()=>{", "       const committed=ctx.commit(()=>{")
s = rep(P, s, "         return versionId;\n       });\n      },{onFailure:status=>{",
        "         return versionId;\n       });\n       // 二期 brownfield：生成成功后**自动写回**既有工程（`D3`）。**best-effort**：写回失败只记录，不影响本任务结论。\n       if(committed){try{const wb=writebackTask(task.project_id,task.task_id);if(wb)writeMeta(task.project_id,`patch_latest:${task.task_id}`,{patch_id:wb.plan.patch_id,files:wb.files.length,notes:wb.merge.notes,skipped:wb.merge.skipped});}catch(e){writeMeta(task.project_id,`patch_error:${task.task_id}`,{message:(e as Error).message});}}\n       return committed;\n      },{onFailure:status=>{")
s = rep(P, s, 'import {verifyL1} from \'../adapters/verify.ts\';', 'import {verifyL1} from \'../adapters/verify.ts\';\nimport {writebackTask} from \'./patches.ts\';')
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: 生成侧衔接完成")
