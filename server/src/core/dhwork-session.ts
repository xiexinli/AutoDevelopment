/**
 * DHwork 云端会话 —— **模型能力的凭据**，自动续期（2026-10-23）。
 *
 * 为什么需要它（实证结论，别再重复踩）：
 *  - 云端 DHwork 的 OpenAI 兼容端点（`https://www.dhcoder.net/llm-api/v1`）**只认 DHwork 自己签发的会话令牌**
 *    （`HS256` JWT、有效期 30 天）。**飞书开放平台的应用凭据不行** —— 实测拿应用 `tenant_access_token`
 *    调 `/llm-api/v1/models` 恒返 `500 登录状态无效或已过期`。所以「用飞书扫码登录换 DHwork 模型能力」
 *    在 DHwork 现有接口下**不成立**：飞书身份 ≠ DHwork 会话，两个应用之间没有兑换口。
 *  - 该会话令牌**可以程序化续期**：`POST {服务}/api/auth/feishu/refresh`（DHwork 客户端自己每小时调一次），
 *    带当前令牌 → 返回新的 `accessToken`。实测刷新后的令牌立刻可用于 `/models` 与 `/chat/completions`。
 *
 * 于是本模块把会话令牌当成**有状态凭据**：内存 + 落盘（gitignored 的 `server/.dhwork-session.json`），
 * 快过期就自动刷新。刷新失败**绝不静默降级**：记录错误并在 `dhworkSessionStatus()` 里暴露，供健康检查/日志查看。
 *
 * 令牌来源（按优先级）：`AD_DHWORK_TOKEN` → 会话文件 → `AD_LLM_API_KEY` → DHwork 客户端配置
 * （`~/Library/Application Support/DHwork/config/aionui-config.txt` 的 `cloudAgent.token`，老的
 * `desktop.bootstrapAuth.*.accessToken` 也认）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVICE = (process.env.AD_DHWORK_SERVICE_URL ?? "https://www.dhwork.net/agent").replace(/\/+$/, "");
const SESSION_FILE = process.env.AD_DHWORK_SESSION_FILE ?? join(here, "..", "..", ".dhwork-session.json");
/** 距上次刷新超过这么久就续期（客户端是 1h；这里放宽到 12h，够用且省调用） */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
/** 令牌剩余寿命少于这个值也必须续期 */
const MIN_REMAINING_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 15_000;

export interface DhworkSessionStatus {
  configured: boolean;
  source: "env" | "file" | "llm_key" | "client_config" | "none";
  updated_at: string | null;
  expires_at: string | null;
  refresh_supported: boolean;
  last_error: string;
}

let token = "";
let source: DhworkSessionStatus["source"] = "none";
let updatedAt: number | null = null;
let lastError = "";
let inflight: Promise<void> | null = null;

/** JWT 的 `exp`（秒）→ 毫秒；不是 JWT / 解不开就给 `null` */
function jwtExpiryMs(t: string): number | null {
  const payload = t.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json?.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** DHwork 客户端配置里的会话令牌（客户端登出后这里会是空的） */
function tokenFromClientConfig(): string {
  try {
    const p = join(homedir(), "Library/Application Support/DHwork/config/aionui-config.txt");
    if (!existsSync(p)) return "";
    const json = JSON.parse(decodeURIComponent(Buffer.from(readFileSync(p, "utf8").trim(), "base64").toString("utf8")));
    const direct = typeof json["cloudAgent.token"] === "string" ? json["cloudAgent.token"].trim() : "";
    if (direct) return direct;
    for (const rec of Object.values(json["desktop.bootstrapAuth"] ?? {})) {
      const t = (rec as { accessToken?: string } | null)?.accessToken?.trim();
      if (t) return t;
    }
    return "";
  } catch {
    return "";
  }
}

function readSessionFile(): { token: string; updated_at: number } | null {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    const j = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as { token?: string; updated_at?: number };
    if (!j?.token) return null;
    return { token: j.token, updated_at: typeof j.updated_at === "number" ? j.updated_at : Date.now() };
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    writeFileSync(SESSION_FILE, JSON.stringify({ token, updated_at: updatedAt ?? Date.now() }, null, 2), { mode: 0o600 });
  } catch (e) {
    lastError = `会话落盘失败：${(e as Error).message}`;
  }
}

/** 首次载入：按优先级取一个可用的会话令牌（**无令牌不报错**，只记状态） */
function seed(): void {
  const fromEnv = (process.env.AD_DHWORK_TOKEN ?? "").trim();
  if (fromEnv) { token = fromEnv; source = "env"; updatedAt = Date.now(); persist(); return; }
  const f = readSessionFile();
  if (f) { token = f.token; source = "file"; updatedAt = f.updated_at; return; }
  const key = (process.env.AD_LLM_API_KEY ?? "").trim();
  if (key) { token = key; source = "llm_key"; updatedAt = Date.now(); persist(); return; }
  const cfg = tokenFromClientConfig();
  if (cfg) { token = cfg; source = "client_config"; updatedAt = Date.now(); persist(); }
}

function needsRefresh(): boolean {
  if (!token) return false;                       // 没有令牌就无从刷新，交给上层报「未配置」
  const now = Date.now();
  if (updatedAt != null && now - updatedAt > REFRESH_AFTER_MS) return true;
  const exp = jwtExpiryMs(token);
  return exp != null && exp - now < MIN_REMAINING_MS;
}

/**
 * 确保会话可用。`force=true` 强制刷新（令牌被判失效时用）。
 * 并发调用会**合并成一次**请求。刷新失败**不抛错**（调用方按当前令牌继续；错误留在状态里），
 * 只有「强制刷新且失败」才把错误抛出去 —— 那时上层已经知道令牌不能用了。
 */
export async function ensureDhworkSession(force = false): Promise<void> {
  if (!token) { seed(); if (!token) return; }
  if (!force && !needsRefresh()) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${SERVICE}/api/auth/feishu/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as { accessToken?: string } | null;
      const next = body?.accessToken?.trim() ?? "";
      if (!res.ok || !next) {
        lastError = `续期失败：HTTP ${res.status}`;
        if (force) throw new Error(lastError);
        return;
      }
      token = next; updatedAt = Date.now(); lastError = "";
      persist();
    } catch (e) {
      lastError = `续期异常：${(e as Error).message}`;
      if (force) throw new Error(lastError);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 当前会话令牌（同步；未配置时为空串） */
export function currentDhworkToken(): string {
  if (!token) seed();
  return token;
}

export function dhworkSessionStatus(): DhworkSessionStatus {
  if (!token) seed();
  const exp = jwtExpiryMs(token);
  return {
    configured: !!token,
    source,
    updated_at: updatedAt ? new Date(updatedAt).toISOString() : null,
    expires_at: exp ? new Date(exp).toISOString() : null,
    refresh_supported: true,
    last_error: lastError,
  };
}

/** 供启动时调用：后台把会话预热/续期一次，不阻塞启动 */
export function primeDhworkSession(): void {
  void ensureDhworkSession(false).catch(() => undefined);
}
