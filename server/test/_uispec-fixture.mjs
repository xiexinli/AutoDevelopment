/**
 * 回归测试共用夹具：为项目播种一份**可解析的 S5 `UI-Spec`**。
 *
 * 背景（2026-10-29「去拖拽编辑 · Spec 直出代码」）：`#43` 的生成输入由「画布草稿 `tree`」
 * 改为「S5 `UI-Spec`（页面 + 元素 `EL-*`）」。没有 UI-Spec 的项目**不能生成**（`INVALID_ARGUMENT`）。
 * 因此凡是要跑生成链路的老回归，都要先播种一份 UI-Spec 并用**它**的哈希提交。
 */
import { get, nowIso, run, uid } from "../src/db/index.ts";
import { parseUiSpec, uiSpecInputHash } from "../src/adapters/uispec.ts";

/** 造一份 `templates/UI-Spec.md` 最小可解析正文：§2 页面清单 + §4.1 ① 元素清单（逐字对齐表头）。 */
export function uiSpecMarkdown(moduleCode, pageName, types = ["主按钮"]) {
  const rows = types.map((t, i) => `| \`EL-${moduleCode}-${String(i + 1).padStart(3, "0")}\` | 元素${i + 1} | ${t} | — | 是 |`).join("\n");
  return [
    "# 夹具 UI Spec",
    "",
    "## 2 页面清单",
    "| 页面 ID | 页面名 | 对应 REQ-ID | 优先级 | 备注 |",
    "|---|---|---|---|---|",
    `| UI-${moduleCode}-001 | ${pageName} | REQ-UI-001 | P0 |  |`,
    "",
    "## 4 页面详细设计",
    `### 4.1 ${pageName}（UI-${moduleCode}-001）`,
    "",
    "**① 元素清单**",
    "| 元素 ID | 元素名 | 类型 | 层级/父元素 | 是否可交互 |",
    "|---|---|---|---|---|",
    rows,
    "",
  ].join("\n");
}

/** 直接落一份 `succeeded` 的 UI-Spec（绕过 `#30`，专供生成链路回归）。**会替换**该项目已有 ui Spec。 */
export function seedUiSpec(projectId, moduleCode = "HOME", pageName = "首页", types = ["主按钮"]) {
  const md = uiSpecMarkdown(moduleCode, pageName, types);
  run(`DELETE FROM tbl_spec_doc WHERE project_id=? AND role='ui'`, projectId);
  run(`INSERT INTO tbl_spec_doc (spec_id, project_id, role, role_order, status, stale, content_md, version, updated_at)
       VALUES (?,?,'ui',1,'succeeded',0,?,1,?)`, uid("sp"), projectId, md, nowIso());
  const tree = parseUiSpec(md, moduleCode);
  return { md, tree, input_hash: uiSpecInputHash(moduleCode, pageName, tree) };
}

/** 从库里读该页的 UI-Spec → 解析树 + `#43` 输入哈希（与 `#43` 的同口径）。 */
export function uiSpecFor(page) {
  const row = get(`SELECT content_md FROM tbl_spec_doc WHERE project_id=? AND role='ui' AND status='succeeded' ORDER BY version DESC LIMIT 1`, page.project_id);
  if (!row) throw new Error("夹具缺失：项目还没有 UI-Spec");
  const tree = parseUiSpec(row.content_md, page.module_code);
  return { tree, input_hash: uiSpecInputHash(page.module_code, page.name, tree) };
}
