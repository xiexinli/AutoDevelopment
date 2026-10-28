#!/usr/bin/env node
/**
 * 生成「大模型目录」给平台前端选模型用（`server/data/llm-catalog.json`）。
 *
 * 模型清单来自 **DHwork 客户端配置**，不写死在平台代码里：
 *   `~/Library/Application Support/DHwork/config/dhwork-openai.json` 的 `modelOptions`
 *   （含中文名与描述，正是 DHwork 界面里给人看的那份清单）
 * 令牌同样现取（`aionui-config.txt` → `desktop.bootstrapAuth.feishu.accessToken`），**不回显、不落盘**。
 *
 * 用法：
 *   node tools/gen-llm-catalog.mjs            # 只按配置生成（不联网）
 *   node tools/gen-llm-catalog.mjs --probe    # 逐个真调一次，核实「能不能用」
 *
 * `--probe` 的意义：目录里 `available=false` 的项**仍然展示**给用户，但不可选中，
 * 并在 `reason` 里写明原因 —— 避免「看起来能选、选了就报错」。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "..");

const DH_DIR = process.env.AD_DHWORK_CONFIG_DIR
  ?? join(process.env.HOME ?? "", "Library/Application Support/DHwork/config");
const CFG_FILE = join(DH_DIR, "aionui-config.txt");
const MODELS_FILE = join(DH_DIR, "dhwork-openai.json");
const OUT_FILE = process.env.AD_LLM_CATALOG_FILE ?? join(serverDir, "data", "llm-catalog.json");

const probe = process.argv.includes("--probe");
/** `Auto` 是 DHwork 的路由项，直接当模型名调用会被上游拒绝（实测报 no healthy deployments） */
const NOT_DIRECTLY_CALLABLE = new Set(["Auto"]);

function readToken() {
  if (process.env.AD_LLM_API_KEY) return process.env.AD_LLM_API_KEY;
  try {
    const raw = readFileSync(CFG_FILE, "utf8").trim();
    const j = JSON.parse(decodeURIComponent(Buffer.from(raw, "base64").toString("utf8")));
    return j?.["desktop.bootstrapAuth"]?.feishu?.accessToken ?? "";
  } catch { return ""; }
}

function readOptions() {
  const cfg = JSON.parse(readFileSync(MODELS_FILE, "utf8"));
  const opts = Array.isArray(cfg.modelOptions) ? cfg.modelOptions : [];
  return opts
    .filter((o) => o && typeof o.id === "string" && o.id)
    .map((o) => ({
      id: o.id,
      name: typeof o.name === "string" && o.name ? o.name : o.id,
      description: typeof o.description === "string" ? o.description : "",
    }));
}

/** 真调一次，判断该模型是否可用。
 *  ⚠️ `max_tokens` 不能用 1：gpt-5.x / gpt-6.x 会以
 *  `Invalid 'max_output_tokens': integer below minimum value` 直接 400，
 *  那是**探测姿势的错**，不是模型不可用 —— 会把可用模型误判成不可用（实测踩过）。 */
async function checkAvailable(base, token, modelId) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 32 }),
      signal: ac.signal,
    });
    if (res.ok) return { available: true };
    // 429（限流）与 5xx 是**瞬时**状况，模型本身是存在的：仍应可被选择，
    // 否则探测时恰好被限流就会把一个可用模型永久标成「不可用」（实测踩过）。
    if (res.status === 429 || res.status >= 500) return { available: true };
    const text = (await res.text().catch(() => "")).slice(0, 300);
    let msg = text;
    try { msg = JSON.parse(text)?.error?.message ?? text; } catch { /* 保持原文 */ }
    return { available: false, reason: String(msg).replace(/\s+/g, " ").slice(0, 160) };
  } catch (e) {
    // 超时属于**不确定**（网络/冷启动都可能），不等于模型不存在：
    // 仍保留为可选，但把观察到的现象写进描述，让用户心里有数。
    if (e?.name === "AbortError")
      return { available: true, note: `探测时 60 秒未响应，实际调用可能较慢` };
    return { available: true, note: `探测未成功（${String(e?.message ?? e).slice(0, 80)}）` };
  } finally {
    clearTimeout(t);
  }
}

const base = process.env.AD_LLM_BASE_URL ?? "https://www.dhcoder.net/llm-api/v1";
const token = readToken();
const options = readOptions();
if (!options.length) {
  console.error("[gen-llm-catalog] 没读到 modelOptions，检查 DHwork 配置：", MODELS_FILE);
  process.exit(1);
}

const models = [];
for (const o of options) {
  if (NOT_DIRECTLY_CALLABLE.has(o.id)) {
    models.push({ ...o, available: false, reason: "DHwork 的自动路由项，不能直接指定为模型调用。" });
    continue;
  }
  if (!probe) { models.push({ ...o, available: true }); continue; }
  const r = await checkAvailable(base, token, o.id);
  if (r.available) {
    const description = r.note ? `${o.description}（${r.note}）` : o.description;
    models.push({ ...o, description, available: true });
  } else {
    models.push({ ...o, available: false, reason: r.reason });
  }
  console.error(`[gen-llm-catalog] ${o.id} -> ${r.available ? "可用" + (r.note ? "（" + r.note + "）" : "") : "不可用：" + r.reason}`);
}

const firstAvailable = models.find((m) => m.available);
const catalog = { default_model: firstAvailable?.id ?? "", models };
mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.error(`[gen-llm-catalog] 已写入 ${OUT_FILE}：${models.length} 个模型，默认 ${catalog.default_model || "(无可用)"}`);
