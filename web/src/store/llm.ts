/**
 * 大模型目录与「当前用户所选模型」（`#71`）。
 *
 * ⚠️ 门禁结论**随模型而变**（同一份 PRD，不同模型判定的 blocking 数可差 9 倍），
 * 因此界面上必须让用户看得见、选得动，并显示「本次审核用的是哪个模型」。
 */
import { request } from "@/api/client";

export interface LlmModel {
  id: string;
  name: string;
  description: string;
  /** `false` 的项**仍会展示**，但不可选中；原因在 `reason` */
  available: boolean;
  reason?: string;
}

export interface LlmModelList {
  items: LlmModel[];
  default_model: string;
  /** 当前用户选过的模型（未选过则空串） */
  selected_model: string;
  /** 真正会用的模型：用户选择 → 目录默认 */
  effective_model: string;
}

/** `#71` 列出所有模型（含不可用项与默认模型） */
export function fetchLlmModels() {
  return request<LlmModelList>("/llm/models");
}

/** `#71` 保存当前用户选择的模型（按用户隔离） */
export function saveLlmModel(modelId: string) {
  return request<{ selected_model: string; effective_model: string }>("/me/llm-model", {
    method: "PUT",
    body: { model: modelId },
  });
}
