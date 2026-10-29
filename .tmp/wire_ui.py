# -*- coding: utf-8 -*-
"""二期 步骤 2：session.ts API + WorkbenchPage 渲染写回面板。"""
import io, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:56])); return s
    return s.replace(old, new, cnt)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ============ session.ts：三个 API ============
P = "web/src/store/session.ts"; s = io.open(P, encoding="utf-8").read()
API = '''
/** #N7 把某次生成任务的产物按既有工程结构合并后写回（二期 brownfield） */
export function writebackGeneration(projectId: string, taskId: string) {
  return request<{
    patch_id: string; status: string;
    totals: { create: number; replace: number; unchanged: number; bytes: number };
    entries: { path: string; action: string; removed_ids: string[] }[];
    notes: string[]; skipped: { path: string; reason: string }[];
  }>(`/projects/${projectId}/generation/${taskId}/writeback`, {
    method: "POST", body: { confirm: true }, idempotencyKey: newIdempotencyKey(),
  });
}

export interface PatchApplicationItem {
  patch_id: string; status: string; message: string; created_at: string; rolled_back_at: string | null;
  totals: { create: number; replace: number; unchanged: number; bytes: number };
  files: string[];
}
/** #N5 补丁记录（倒序） */
export function listPatchApplications(projectId: string) {
  return request<{ items: PatchApplicationItem[]; total: number }>(`/projects/${projectId}/patch-applications`);
}
/** #N6 回滚某次补丁（`⬛` 破坏性 → 二次确认） */
export function rollbackPatchApplication(projectId: string, patchId: string) {
  return request<{ patch_id: string; status: string; rolled_back_at: string; restored: number; removed: number }>(
    `/projects/${projectId}/patch-applications/${patchId}/rollback`,
    { method: "POST", body: { confirm: true }, idempotencyKey: newIdempotencyKey() });
}

/** #3 项目详情（含 current_revision_id） */'''
s = rep(P, s, "\n/** #3 项目详情（含 current_revision_id） */", API)
# 详情出参补 source_kind / engineering_root 类型（fetchProject 已在上批加过，这里兜底确认）
run(P, s)

# ============ WorkbenchPage：渲染面板 ============
P = "web/src/pages/WorkbenchPage.tsx"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, 'import EditPage from "@/pages/EditPage";', 'import EditPage from "@/pages/EditPage";\nimport PatchWriteback from "@/components/PatchWriteback";')
s = rep(P, s, """          <div style={{ marginTop: 8, fontSize: 12, color: "#bbb" }}>
            当前分段：{mode === "preview" ? "预览" : "编辑"} ｜ Spec {specCount} 份 ｜ 已开启能力 {capCount} 项
            <Badge status="processing" text="" style={{ marginLeft: 8 }} />
          </div>""",
        """          <div style={{ marginTop: 8, fontSize: 12, color: "#bbb" }}>
            当前分段：{mode === "preview" ? "预览" : "编辑"} ｜ Spec {specCount} 份 ｜ 已开启能力 {capCount} 项
            <Badge status="processing" text="" style={{ marginLeft: 8 }} />
          </div>
          {/* 二期：接入既有工程的项目才渲染（`source_kind='imported'`），自身判空 */}
          <PatchWriteback projectId={projectId} />""")
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: UI 入口完成")
