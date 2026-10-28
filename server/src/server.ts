import "./core/env.ts";   // **必须最先执行**：`.env` 只补齐未设置的键
import { buildApp } from "./app.ts";
import { createFeishuLoginAdapter, createFeishuDocAdapter } from "./adapters/feishu.ts";
import { passwordLoginMode, seedDevAccount } from "./core/password.ts";

const PORT = Number(process.env.AD_PORT ?? 8787);
const app = buildApp();
const feishu = createFeishuLoginAdapter();
const feishuDoc = createFeishuDocAdapter();
// 本地账号（`#72`）：仅在 development 模式下播种，且**幂等**
seedDevAccount();
app.log.info({ login: feishu.kind, doc: feishuDoc.kind, passwordLogin: passwordLoginMode(), llm: process.env.AD_LLM_MODE === "development" ? "development" : (process.env.AD_LLM_BASE_URL && process.env.AD_LLM_MODEL ? `real(${process.env.AD_LLM_MODEL})` : "unconfigured") },
  `飞书登录=${feishu.kind} 云文档=${feishuDoc.kind} 账号密码登录=${passwordLoginMode()} ｜ `
  + (process.env.AD_LLM_MODE === "development"
    ? "大模型=确定性开发桩（**非真实 AI**）"
    : process.env.AD_LLM_BASE_URL && process.env.AD_LLM_MODEL
      ? `大模型=真实上游 ${process.env.AD_LLM_BASE_URL}`
      : "大模型=未配置（生成类接口会明确拒绝）"));

app.listen({ port: PORT, host: "127.0.0.1" })
  .then(() => app.log.info(`AutoDevelopment 后端已启动：http://127.0.0.1:${PORT}/api/v1`))
  .catch((e) => { app.log.error(e); process.exit(1); });
