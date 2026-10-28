/**
 * Fastify 应用装配 —— 统一响应包 / 错误码 / 幂等 / CORS / 上传。
 * 所有业务路由**只抛 `ApiError` 或返回数据**，包壳与状态码在此层统一处理（`接口契约 §0.2 / §0.5`）。
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ApiError, HTTP_STATUS, fail, newRequestId, ok } from "./core/envelope.ts";
import { installIdempotency } from "./core/idempotency.ts";
import { catalog } from "./core/llm-models.ts";
import { dhworkSessionStatus, primeDhworkSession } from "./core/dhwork-session.ts";
import type { User } from "./core/auth.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerKbRoutes } from "./routes/kb.ts";
import { registerAiEgressRoutes } from "./routes/ai-egress.ts";
import { registerLlmModelRoutes } from "./routes/llm-models.ts";
import { registerUploadRoutes } from "./routes/upload.ts";
import type { LlmAdapter } from "./adapters/llm.ts";
import { registerReviewRoutes } from "./routes/review.ts";
import { registerSplitRoutes } from "./routes/split.ts";
import { registerEditorRoutes } from "./routes/editor.ts";
import { registerGenerationRoutes } from "./routes/generation.ts";
import type { CodegenAdapter } from "./adapters/codegen.ts";
import { registerTaskRoutes } from "./routes/tasks.ts";
import { registerChatRoutes } from "./routes/chat.ts";
import { registerSpecRoutes } from "./routes/specs.ts";
import { registerApiRoutes } from "./routes/apis.ts";
import { registerVersionRoutes } from "./routes/versions.ts";
import { registerCapabilityRoutes } from "./routes/capabilities.ts";
import { registerDeliverableRoutes, registerMetricRoutes, registerAbortRoutes } from "./routes/deliverables.ts";

export interface Ctx {
  req: FastifyRequest;
  reply: FastifyReply;
  user: User;
}

/** 需要鉴权的处理器签名：拿到已验证的 `user`，返回 `data`（自动包壳 200/201） */
export type AuthedHandler<T> = (ctx: Ctx) => Promise<T> | T;

export function buildApp(opts: {llm?: LlmAdapter; codegen?: CodegenAdapter} = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.AD_LOG_LEVEL ?? "info",
      // **敏感数据不入日志**：只记录方法与路径（去 query），不记录 body
      serializers: {
        req: (r) => ({ method: r.method, url: String(r.url).split("?")[0] }),
      },
    },
    genReqId: () => newRequestId(),
    bodyLimit: 22 * 1024 * 1024, // 上传上限 20MB，留出 multipart 开销
  });

  void app.register(cors, {
    origin: true,
    exposedHeaders: ["ETag"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "If-Match"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  void app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  /**
   * 契约里有多个「无请求体」的 POST（如 `#12` 触发解析、`#44a` 取消、`#55` 打版本）。
   * 但客户端很常见地会带上 `Content-Type: application/json` 却不发 body，
   * Fastify 默认解析器会直接 400「Body cannot be empty」——**这不是业务错误**。
   * 这里把**空 body 视为 `{}`**；非空但非法 JSON 仍是 400。
   */
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = String(body ?? "").trim();
    if (!text) { done(null, {}); return; }
    try { done(null, JSON.parse(text)); }
    catch { done(Object.assign(new Error("请求体不是合法 JSON。"), { statusCode: 400 })); }
  });

  /** 统一错误出口 */
  app.setErrorHandler((err, req, reply) => {
    const requestId = String(req.id);
    if (err instanceof ApiError) {
      void reply.status(HTTP_STATUS[err.code]).send(fail(err.code, err.message, err.data, requestId));
      return;
    }
    const fe = err as { statusCode?: number; code?: string; message?: string };
    if (fe.statusCode === 413 || fe.code === "FST_REQ_FILE_TOO_LARGE") {
      void reply.status(413).send(fail("PAYLOAD_TOO_LARGE", "文件超过 20MB（当前超出上限）。请压缩后重试。", null, requestId));
      return;
    }
    if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
      void reply.status(fe.statusCode).send(fail("INVALID_ARGUMENT", fe.message, null, requestId));
      return;
    }
    req.log.error({ err: fe.message }, "unhandled error");
    void reply.status(500).send(fail("INTERNAL", undefined, null, requestId));
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send(fail("NOT_FOUND", undefined, null, String(req.id)));
  });

  /* 各业务路由自行 `reply.send(envelope)`：
     - 未捕获的 `ApiError` 一律由上面的 `setErrorHandler` 转成统一失败包（含正确 HTTP 状态码）；
     - 需要 SSE / 文件流的处理器可以直接写流（`reply.sent` 之后不再包壳）。 */

  // 云端 DHwork 会话：**后台**预热/续期一次（不阻塞启动；失败只记状态，见 `/health` 的 `dhwork_session`）
  primeDhworkSession();

  app.get("/api/v1/health", async (req) => ok({
    service: "autodevelopment-server",
    llm_mode: process.env.AD_LLM_MODE === "development" ? "development"
      : process.env.AD_LLM_BASE_URL && process.env.AD_LLM_MODEL ? `real:${process.env.AD_LLM_MODEL}` : "unconfigured",
    // `llm_mode` 是**环境变量兜底值**；实际用哪个模型由用户在界面上选，
    // 未选时用目录里的第一个可用项 —— 这两个值可能不同，所以都回报出来，避免误读。
    llm_default_model: catalog().default_model,
    llm_model_count: catalog().models.length,
    feishu_login: process.env.AD_FEISHU_APP_ID && process.env.AD_FEISHU_APP_SECRET ? "real" : "development",
    feishu_doc: (process.env.AD_FEISHU_APP_ID && process.env.AD_FEISHU_APP_SECRET) || process.env.AD_FEISHU_USER_TOKEN ? "real" : "development",
    // DHwork 会话（云端模型能力凭据）：自动续期，这里回报状态便于排查
    // （**只回报状态，绝不回报令牌本身**）
    dhwork_session: dhworkSessionStatus(),
    time: new Date().toISOString(),
    request_id: String(req.id),
  }, String(req.id)));

  installIdempotency(app);
  registerAuthRoutes(app);
  registerProjectRoutes(app);
  registerKbRoutes(app);
  registerAiEgressRoutes(app);
  registerLlmModelRoutes(app);
  registerUploadRoutes(app);
  registerReviewRoutes(app, opts.llm);
  registerSplitRoutes(app, opts.llm);
  registerTaskRoutes(app);
  registerChatRoutes(app, opts.llm);
  registerSpecRoutes(app, opts.llm);
  registerApiRoutes(app);
  registerVersionRoutes(app);
  registerCapabilityRoutes(app);
  registerDeliverableRoutes(app);
  registerMetricRoutes(app);
  registerAbortRoutes(app);
  registerEditorRoutes(app);
  registerGenerationRoutes(app,opts.codegen);

  return app;
}
