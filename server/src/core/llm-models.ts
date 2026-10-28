/**
 * 大模型目录与「用户选择的模型」。
 *
 * 设计要点：
 * - 平台**不写死任何厂商**：可选模型来自一个**目录文件**（`AD_LLM_CATALOG_FILE`，
 *   默认 `server/data/llm-catalog.json`）。本机由 `run-local.sh` 从 DHwork 配置生成；
 *   没有目录文件时退化为「只有一个模型」（取 `AD_LLM_MODEL`）。
 * - 用户选择落 `tbl_user_pref`，**按用户隔离**；未选择时用目录里的默认项。
 * - `available=false` 的条目（如 DHwork 的 `Auto` 路由，**不支持直接调用**）仍展示给用户，
 *   但**不可被选中**，并在 `reason` 里说明原因 —— 不做「看起来能选、选了就报错」的坑。
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { get, run } from "../db/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

export interface LlmModelEntry {
  id: string;
  name: string;
  description: string;
  available: boolean;
  reason?: string;
}

export interface LlmCatalog { default_model: string; models: LlmModelEntry[] }

const CATALOG_FILE = () =>
  process.env.AD_LLM_CATALOG_FILE ?? join(here, "..", "..", "data", "llm-catalog.json");

/** 目录文件缺失/损坏时的退化目录：只有一个模型（就是环境变量配的那个） */
function fallbackCatalog(): LlmCatalog {
  const id = process.env.AD_LLM_MODEL ?? "";
  return id
    ? { default_model: id, models: [{ id, name: id, description: "来自 AD_LLM_MODEL 配置", available: true }] }
    : { default_model: "", models: [] };
}

let cache: { at: number; value: LlmCatalog } | null = null;

export function catalog(): LlmCatalog {
  // 目录文件可能在服务运行期间被重新生成（run-local.sh 每次启动都会写），
  // 因此做 5 秒短缓存，既不频繁读盘、也不会长时间看到旧目录。
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  let value: LlmCatalog;
  const file = CATALOG_FILE();
  try {
    if (!existsSync(file)) value = fallbackCatalog();
    else {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<LlmCatalog>;
      const models = Array.isArray(raw.models)
        ? raw.models
            .filter((m): m is LlmModelEntry => !!m && typeof m.id === "string" && m.id.length > 0)
            .map((m) => ({
              id: m.id,
              name: typeof m.name === "string" && m.name ? m.name : m.id,
              description: typeof m.description === "string" ? m.description : "",
              available: m.available !== false,
              ...(m.reason ? { reason: String(m.reason) } : {}),
            }))
        : [];
      value = models.length
        ? { default_model: String(raw.default_model ?? "") || (models.find((m) => m.available)?.id ?? ""), models }
        : fallbackCatalog();
    }
  } catch {
    value = fallbackCatalog();
  }
  cache = { at: Date.now(), value };
  return value;
}

const PREF_KEY = "llm_model";

/** 用户在界面上选过的模型（**必须仍在目录里且可用**，否则视为没选） */
export function userModel(userId: string): string {
  const row = get<{ value: string }>(
    `SELECT value FROM tbl_user_pref WHERE user_id = ? AND pref_key = ?`, userId, PREF_KEY);
  if (!row?.value) return "";
  const entry = catalog().models.find((m) => m.id === row.value);
  return entry?.available ? entry.id : "";
}

/** 本次调用实际使用的模型：**用户选择 → 目录默认 → 环境变量** */
export function modelFor(userId: string): string {
  return userModel(userId) || catalog().default_model || process.env.AD_LLM_MODEL || "";
}

export function setUserModel(userId: string, modelId: string): void {
  run(`INSERT INTO tbl_user_pref (user_id, pref_key, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, pref_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    userId, PREF_KEY, modelId, new Date().toISOString());
}

/** 校验一个模型 id 是否可选（存在且可用） */
export function isSelectable(modelId: string): boolean {
  return catalog().models.some((m) => m.id === modelId && m.available);
}
