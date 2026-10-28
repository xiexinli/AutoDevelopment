#!/usr/bin/env node
/**
 * 把 DHwork 客户端当前的会话令牌同步到 `server/.env` 的 `AD_LLM_API_KEY`
 * 与 `server/.dhwork-session.json`（后者是「自动续期」模块的落盘位，见 `core/dhwork-session.ts`）。
 *
 * 为什么还需要它：续期接口 `POST {服务}/api/auth/feishu/refresh` **需要一个还没过期的令牌做种子** ——
 * 客户端登出、令牌彻底过期或换机器时，种子就没了，这时候跑本脚本从客户端配置里抠一个回来。
 * 平时**不需要**手工跑：后端会自己续期。
 *
 * 用法：`cd server && node scripts/sync-llm-token.mjs`
 *
 * 令牌来源：`~/Library/Application Support/DHwork/config/aionui-config.txt`
 * （内容 `base64(encodeURIComponent(JSON))`）。取值顺序：
 *   1) `cloudAgent.token`（**当前版本客户端写这里**）
 *   2) `desktop.bootstrapAuth.{dhwork,feishu,lark}.accessToken`（老版本）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env");
const sessionPath = join(here, "..", ".dhwork-session.json");
const cfgPath = join(homedir(), "Library/Application Support/DHwork/config/aionui-config.txt");

if (!existsSync(cfgPath)) {
  console.error(`找不到 DHwork 配置：${cfgPath}（客户端是否未登录 / 路径变了？）`);
  process.exit(1);
}
if (!existsSync(envPath)) {
  console.error(`找不到 ${envPath}`);
  process.exit(1);
}

// 文件内容 = base64(encodeURIComponent(JSON))：先 base64 解码，再做 URL 解码。
const decodeCfg = () => JSON.parse(
  decodeURIComponent(Buffer.from(readFileSync(cfgPath, "utf8").trim(), "base64").toString("utf8")),
);
/** 从配置里按优先级取会话令牌 */
function pickToken() {
  let json;
  try { json = decodeCfg(); } catch (e) {
    console.error(`配置解不开（${e.message}）—— 客户端可能改了格式，需要重新确认取令牌路径。`);
    process.exit(1);
  }
  const direct = typeof json["cloudAgent.token"] === "string" ? json["cloudAgent.token"].trim() : "";
  if (direct) return { token: direct, from: "cloudAgent.token" };
  const map = json["desktop.bootstrapAuth"] ?? {};
  for (const provider of ["dhwork", "feishu", "lark"]) {
    const t = map?.[provider]?.accessToken?.trim();
    if (t) return { token: t, from: `desktop.bootstrapAuth.${provider}.accessToken` };
  }
  for (const [k, rec] of Object.entries(map ?? {})) {
    const t = (rec as { accessToken?: string } | null)?.accessToken?.trim();
    if (t) return { token: t, from: `desktop.bootstrapAuth.${k}.accessToken` };
  }
  return null;
}

const hit = pickToken();
if (!hit) {
  console.error("配置里没有可用的会话令牌（客户端未登录？）");
  process.exit(1);
}
const { token, from } = hit;

let text = readFileSync(envPath, "utf8");
if (/^AD_LLM_API_KEY=.*$/m.test(text)) {
  text = text.replace(/^AD_LLM_API_KEY=.*$/m, `AD_LLM_API_KEY=${token}`);
} else if (/^AD_LLM_MODEL=.*$/m.test(text)) {
  text = text.replace(/^AD_LLM_MODEL=.*$/m, (line) => `${line}\nAD_LLM_API_KEY=${token}`);
} else {
  text += `\nAD_LLM_API_KEY=${token}\n`;
}
writeFileSync(envPath, text);

// 会话落盘位（`core/dhwork-session.ts` 优先读它）——这样不必重启就能被续期模块接上
writeFileSync(sessionPath, JSON.stringify({ token, updated_at: Date.now() }, null, 2), { mode: 0o600 });

console.log(`已更新 ${envPath} 的 AD_LLM_API_KEY 与 ${sessionPath}（来源 ${from}，长度 ${token.length}）。`);
