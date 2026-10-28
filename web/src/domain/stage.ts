/**
 * 项目阶段（`数据模型 §3.1` 的 **17 值**）→ 中文名 + 标签色。
 *
 * ⚠️ 原先 `ProjectListPage` 的本地映射用的是**旧阶段名**（`uploading`/`gate_review`/`spec_ready`…），
 * 与后端实际下发的枚举对不上 → 卡片上会**直接显示英文枚举**（`reviewing`/`kb_ready`/`preview_ready`）。
 * 本模块按 `数据模型 §3.1` / `接口-Spec` 的 17 值口径统一，未命中的状态**回落为原值**（不隐藏、不猜）。
 */
export interface StageMeta {
  text: string;
  color: string;
}

export const STAGE_META: Record<string, StageMeta> = {
  created: { text: "新建", color: "default" },
  kb_ready: { text: "知识库就绪", color: "default" },
  reviewing: { text: "审核中", color: "processing" },
  supplementing: { text: "对话补充中", color: "processing" },
  gate_passed: { text: "门禁通过", color: "success" },
  splitting: { text: "拆解中", color: "processing" },
  spec_generating: { text: "Spec 生成中", color: "processing" },
  ui_ready: { text: "UI 定稿中", color: "processing" },
  api_developing: { text: "接口开发中", color: "processing" },
  app_developing: { text: "App 开发中", color: "processing" },
  editing: { text: "编辑中", color: "processing" },
  code_generating: { text: "生成中", color: "processing" },
  verifying: { text: "验证中", color: "processing" },
  preview_ready: { text: "预览就绪", color: "success" },
  manual_required: { text: "需人工介入", color: "warning" },
  testing: { text: "测试中", color: "processing" },
  delivered: { text: "已交付", color: "success" },
};

/** 取阶段展示元信息；未命中 → 原值 + 默认色（**不隐藏未知状态**） */
export function stageMeta(stage: string): StageMeta {
  return STAGE_META[stage] ?? LEGACY[stage] ?? { text: stage, color: "default" };
}

/**
 * 历史阶段名（旧枚举）→ 展示名。
 * 库中存在改造前写入的历史值（实测：`spec_ready`），若不兜底会在卡片上直接显示英文。
 * 仅做**展示映射**，不改变数据。
 */
const LEGACY: Record<string, StageMeta> = {
  uploading: { text: "解析中", color: "processing" },
  gate_review: { text: "门禁审核", color: "processing" },
  gate_blocked: { text: "有待澄清", color: "warning" },
  spec_ready: { text: "Spec 就绪", color: "success" },
  generating: { text: "生成中", color: "processing" },
  ui_finalizing: { text: "UI 定稿中", color: "processing" },
  chatting: { text: "对话补充中", color: "processing" },
  manual_needed: { text: "需人工介入", color: "warning" },
  archived: { text: "已归档", color: "default" },
};
