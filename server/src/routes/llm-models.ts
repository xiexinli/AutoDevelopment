/**
 * 大模型目录与用户选择（`#71`）。
 *
 * - `GET /api/v1/llm/models`：列出**所有可选模型**（含不可用项与其原因），并回报「默认模型」与「当前用户已选」。
 * - `PUT /api/v1/me/llm-model`：保存当前用户的选择（**按用户隔离**，落 `tbl_user_pref`）。
 *
 * 平台不写死厂商：目录来自 `AD_LLM_CATALOG_FILE`（本机由 `run-local.sh` 从 DHwork 配置生成）。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { currentUser } from "../core/auth.ts";
import { catalog, isSelectable, modelFor, setUserModel, userModel } from "../core/llm-models.ts";

export function registerLlmModelRoutes(app: FastifyInstance) {
  app.get("/api/v1/llm/models", async (req) => {
    const user = currentUser(req);
    const c = catalog();
    return {
      code: "OK", message: "",
      data: {
        items: c.models,
        default_model: c.default_model,
        selected_model: userModel(user.user_id),
        effective_model: modelFor(user.user_id),
      },
      request_id: String(req.id),
    };
  });

  app.put<{ Body: { model?: unknown } }>("/api/v1/me/llm-model", async (req) => {
    const user = currentUser(req);
    const model = String((req.body ?? {}).model ?? "");
    if (!model) throw new ApiError("INVALID_ARGUMENT", "缺少 model。");
    if (!isSelectable(model))
      throw new ApiError("INVALID_ARGUMENT", `这个模型不可选：${model}。`, { model });
    setUserModel(user.user_id, model);
    return {
      code: "OK", message: "",
      data: { selected_model: model, effective_model: modelFor(user.user_id) },
      request_id: String(req.id),
    };
  });
}
