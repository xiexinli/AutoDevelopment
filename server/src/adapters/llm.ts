/**
 * 第三方大模型适配器（E4 依赖之一，**60s / 次超时，指数退避 + 抖动、最多 2 次重试**）。
 *
 * 用途：门禁审核、Spec 生成、代码生成、L1 验证辅助、拆解。
 * 与飞书适配器同一套路：**真实实现**（走 `AD_LLM_BASE_URL` / `AD_LLM_API_KEY`）+
 * **开发实现**（不联网、确定性、结构完全一致，启动时在日志明示）。
 *
 * ⚠️ 密钥**只在服务端环境变量**，绝不下发浏览器、绝不入日志（`接口契约 §0.2`）。
 * ⚠️ 上游失败**绝不静默写入**：一律抛 `UPSTREAM_TIMEOUT` / `UPSTREAM_UNAVAILABLE`，任务置 `failed`。
 */
import { ApiError } from "../core/envelope.ts";
import { currentDhworkToken, dhworkSessionStatus, ensureDhworkSession } from "../core/dhwork-session.ts";

export type Level = "blocking" | "major" | "suggestion";

/** PRD 审核分级（2026-10-28 定稿）：简审 / 标准 / 严格 */
export type ReviewLevel = "quick" | "standard" | "strict";

/**
 * 各等级的**档位说明**（注入系统提示，让模型按档位判定）。
 * 口径来源：`PRD审核分级-定稿-v1.0.md` §2.1 / §3。
 */
export const REVIEW_LEVEL_PROFILE: Record<ReviewLevel, string> = {
  quick: [
    "审核等级：**简审（quick）**。只做两项专项判定，其余检查项一律判 `na`：",
    "  · Q1 可实现性：主流程每一步是否都有对应行为；要展示的数据是否都有来源；是否要求尚未定义的新技术；是否存在互斥的硬性要求。",
    "  · Q2 内部一致性 / 冲突：同一事实多处说法是否一致；范围与目标是否互斥；状态与流程是否对得上；角色与权限是否对得上。",
    "不跑角落扫描、不要求来源标注。",
  ].join("\n"),
  standard: [
    "审核等级：**标准（standard）**。按给定检查项清单逐项判定。",
    "角落扫描覆盖**核心 6 面**：网络与远程服务 / 界面与用户输入 / 集合与列表 / 存储与状态 / 并发任务与会话 / 文本。",
    "完善后正文不得出现无来源标签的实质段落。",
  ].join("\n"),
  strict: [
    "审核等级：**严格（strict）**。按给定检查项清单（完整细则）逐项判定；**「重要」项失败同样计入阻断**。",
    "角落扫描覆盖**全部 14 个条件面**。",
    "完善后正文不得出现无来源标签的实质段落。",
  ].join("\n"),
};

/** 档位说明 + 可选「超严扩展」尾注 */
export function reviewLevelProfile(level: ReviewLevel, extended = false): string {
  const base = REVIEW_LEVEL_PROFILE[level] ?? REVIEW_LEVEL_PROFILE.standard;
  if (level === "strict" && extended) {
    return base + "\n**超严扩展**：额外检查 安全 / 合规 / 性能 / 无障碍 / 国际化 / 隐私 / 成本；「建议」项失败也计入阻断；并做二次交叉复核。";
  }
  return base;
}

export interface ReviewItemDraft {
  item_code: string; group: string; level: Level;
  verdict: "pass" | "fail" | "na"; evidence_ref: string; suggestion: string;
}
export interface QuestionDraft {
  question_code: string; level: Level; title: string; options: string[];
  fallback: string; impact: string;
}
export interface AssumptionDraft { assumption_code: string; content: string; source_tag: string }

export interface ReviewDraft {
  items: ReviewItemDraft[];
  questions: QuestionDraft[];
  assumptions: AssumptionDraft[];
}

export interface RolePackDraft { role: string; reqs: string[] }
export interface SplitDraft { packs: RolePackDraft[]; depth: string }

/** 单份角色 Spec（`#30`）：Markdown 正文 */
export interface SpecDraft { role: string; content_md: string }

export interface LlmAdapter {
  readonly kind: "real" | "mock";
  /** `model` 为**本次调用实际使用的模型**（用户在界面上选的）；不传则用适配器默认模型 */
  review(input: { markdown: string; level: ReviewLevel; extended?: boolean; standardItems: { code: string; level: Level; title: string }[]; model?: string }): Promise<ReviewDraft>;
  split(input: { markdown: string; depth: string; model?: string }): Promise<SplitDraft>;
  /** `#30` 按角色生成 Spec（**单份失败不阻断其余**，由调用方逐角色捕获） */
  spec(input: { role: string; requirements: string[]; projectName: string; context: string; depth: string; model?: string }): Promise<SpecDraft>;
  /**
   * `#26` 对话回复。`onDelta` 为**逐段增量回调**（用于 SSE `chat.delta`）；
   * `signal` 为调用方取消信号，**必须贯穿到上游请求**。
   */
  chat(input: {
    content: string; history: { role: string; content: string }[];
    onDelta?: (delta: string) => void;
    signal?: AbortSignal;
    model?: string;
  }): Promise<string>;
}

/**
 * 真实实现：**OpenAI 兼容的 Chat Completions**（`POST {baseUrl}/chat/completions`）。
 *
 * 这样上游可以是任一兼容实现：本机 LM Studio / Ollama / vLLM，或云端 OpenAI / DeepSeek / 通义 等，
 * **不需要平台自己定义一套私有网关协议**。
 *
 * 三条硬约束（与 `接口契约 §0.6`、`P0 补口裁决单` 一致）：
 *  - **单次 60s 上限**（`AD_LLM_TIMEOUT_MS` 可覆盖，仅用于本地慢模型联调），**超时含响应体读取**；
 *  - 失败**指数退避 + 抖动、最多 2 次重试**；4xx（鉴权 / 参数）**不重试**，直接给出可读原因；
 *  - **调用方取消（任务被取消）必须原样向上抛**，不得被翻译成 `failed`/`timeout`。
 *  - 模型返回**结构不合法一律视为上游失败**（`UPSTREAM_UNAVAILABLE`），**绝不静默放行**。
 */
/** 各角色 Spec 的**固定章节**（生成与校对共用同一份口径） */
const SECTION_NEEDS: Record<string, string[]> = {
  UI: ["元素清单", "交互规则", "文案字样", "样式"],
  接口: ["接口清单", "入参 / 出参", "错误码", "分页与排序"],
  App: ["页面与路由", "状态管理", "网络与降级", "本地存储"],
  埋点: ["事件清单", "触发时机", "参数", "漏斗"],
  测试: ["接口层", "App 层", "埋点层", "E2E"],
};

const TIMEOUT_MS = Number(process.env.AD_LLM_TIMEOUT_MS ?? 60_000);
const MAX_RETRY = 2;

/**
 * JSON 输出模式（**默认 `none`：不发送 `response_format`**）。
 *
 * 不同上游对 `response_format` 的支持并不一致：OpenAI 用 `json_object`，
 * 部分实现（如 LM Studio 新版）只接受 `json_schema` / `text`，直接发 `json_object` 会 **400**。
 * 因此默认不发该字段 —— JSON 的保证改由**提示词 + 严格结构校验**承担
 * （解析不合法即判上游失败，绝不静默放行）。需要更强约束时可显式设置：
 *   `AD_LLM_JSON_MODE=json_object` 或 `json_schema`。
 */
const JSON_MODE = (process.env.AD_LLM_JSON_MODE ?? "none").toLowerCase();

/**
 * 输出上限（可选）。真实上游对长文档可能**把 JSON 截断**，截断后解析必然失败。
 * 明确给出上限可让上游更容易收敛；未设置时不发送该字段（由上游默认决定）。
 */
const MAX_TOKENS = Number(process.env.AD_LLM_MAX_TOKENS ?? 0);

interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
interface ChatChoice { message?: { content?: string | null }; delta?: { content?: string | null } }
interface ChatResponse { choices?: ChatChoice[]; error?: { message?: string; type?: string } }

/** 剥掉 ```json / ```markdown 围栏（模型很爱包一层） */
function stripFence(text: string): string {
  const t = text.trim();
  const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(t);
  return m ? m[1]!.trim() : t;
}

/** 从模型输出里取出一个 JSON 对象；**拿不到就是上游失败**，不做「尽力而为」的猜测 */
function parseJsonObject<T>(text: string): T {
  const t = stripFence(text);
  try { return JSON.parse(t) as T; } catch { /* 继续尝试截取 */ }
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try { return JSON.parse(t.slice(i, j + 1)) as T; } catch { /* 落到下面统一报错 */ }
  }
  throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型没有返回合法 JSON，未应用任何结果。");
}

const isAbort = (e: unknown) => (e as Error | undefined)?.name === "AbortError";
const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
const deadlineError = () => Object.assign(new Error("deadline"), { name: "DeadlineError" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 把「本次调用的 deadline」与「调用方取消」合成**一个信号**，并且**覆盖整个操作**
 * —— 包括响应体读取与流式读取。
 *
 * ⚠️ 这是踩过的坑：只把 signal 交给 `fetch()` 是**不够的**。上游把响应头发回来之后就挂住不写 body，
 * `await res.text()` / `reader.read()` 不会被那次 fetch 的 abort 打断，
 * 最终由 undici 自己的 300s body 超时兜底 —— 表现为「5 分钟才失败」且错误是 `TypeError: terminated`。
 * 正确做法：**同一个 signal 贯穿 fetch 与 body/流的读取**。
 */
async function withDeadline<T>(outer: AbortSignal | undefined, timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (outer?.aborted) throw abortError();
  const ac = new AbortController();
  const onOuter = () => ac.abort();
  outer?.addEventListener("abort", onOuter, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fn(ac.signal);
  } catch (e) {
    if (isAbort(e)) {
      if (outer?.aborted) throw abortError();   // 调用方取消 → 原样上抛
      throw deadlineError();                    // 我们的 60s 到期
    }
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuter);
  }
}

/** 重试策略：**4xx 不重试**、调用方取消原样上抛、其余退避重试最多 2 次 */
async function withRetry<T>(signal: AbortSignal | undefined, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (isAbort(e) && signal?.aborted) throw e;
      lastErr = e;
      if (attempt < MAX_RETRY) {
        await sleep(400 * 2 ** attempt + Math.floor(Math.random() * 200));
        if (signal?.aborted) throw abortError();
      }
    }
  }
  if ((lastErr as Error | null)?.name === "DeadlineError")
    throw new ApiError("UPSTREAM_TIMEOUT", `大模型响应超时（${Math.round(timeoutMs / 1000)}s）。`);
  throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型服务暂时不可用，可以重试。");
}

function failFor(res: Response, body: string): never {
  const excerpt = body.replace(/\s+/g, " ").slice(0, 200);
  if (res.status === 401 || res.status === 403)
    throw new ApiError("UPSTREAM_UNAVAILABLE", `大模型鉴权失败（HTTP ${res.status}），请检查服务端密钥配置。`);
  if (res.status === 404)
    throw new ApiError("UPSTREAM_UNAVAILABLE", `大模型接口不存在（HTTP 404），请检查 AD_LLM_BASE_URL 与 AD_LLM_MODEL。`);
  if (res.status === 429) throw new ApiError("RATE_LIMITED", "大模型限流，稍后重试。");
  throw new ApiError("UPSTREAM_UNAVAILABLE", `大模型返回 HTTP ${res.status}：${excerpt}`);
}

export function createRealAdapter(
  baseUrl: string, apiKey: string, model: string, opts: { timeoutMs?: number; maxTokens?: number } = {},
): LlmAdapter {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  /**
   * 云端 DHwork 端点（`www.dhcoder.net/llm-api/v1`）**不认** `.env` 里写死的密钥 ——
   * 它要的是 DHwork 会话令牌，且该令牌会过期（见 `core/dhwork-session.ts`）。
   * 因此这条件下**每次请求现取**当前会话令牌：过期前自动续期，续期失败才报错，绝不静默沿用死令牌。
   */
  const dhworkCloud = /dhcoder\.net/i.test(baseUrl);
  /** 上游把「令牌失效」也包成 500（`{"error":{"message":"登录状态无效或已过期"}}`），要按内容识别 */
  const authExpired = (status: number, body: string) =>
    status === 401 || status === 403 || /登录状态无效|已过期|invalid token|unauthorized/i.test(body);
  const headersNow = (): Record<string, string> => ({
    "Content-Type": "application/json; charset=utf-8",
    ...(dhworkCloud
      ? (currentDhworkToken() ? { Authorization: `Bearer ${currentDhworkToken()}` } : {})
      : (apiKey ? { Authorization: `Bearer ${apiKey}` } : {})),
  });
  /** 单次调用上限：**默认取 `AD_LLM_TIMEOUT_MS`（契约 60s）**，可按适配器单独覆盖 */
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const maxTokens = opts.maxTokens ?? MAX_TOKENS;

  /**
   * 采样温度：`AD_LLM_TEMPERATURE` 可覆盖；**设为 `off`/`none` 则不发送该字段**。
   *
   * 起因（2026-10-21 实测）：DHwork 的 OpenAI 兼容端点后面是 litellm + `gpt-5.6-terra`，
   * 直接 400 拒绝 —— `Unsupported parameter: 'temperature' is not supported with this model.`，
   * 而适配器原来**无条件**发送 `temperature: 0.2`，导致该上游下所有审核/拆解/Spec 全挂。
   * 除了可配置，下面的 `omitTemperature` 还会在遇到这类 400 时**自动降级并重试一次**，
   * 这样换任何模型都不用再手改配置。
   */
  const wantTemperature = (() => {
    const raw = (process.env.AD_LLM_TEMPERATURE ?? "").trim().toLowerCase();
    if (raw === "off" || raw === "none") return null;
    if (raw === "") return 0.2;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0.2;
  })();
  /** 上游明确说「不支持 temperature」后，本进程内不再发送 */
  let omitTemperature = wantTemperature === null;
  /** 判断是不是「参数不被该模型支持」这一类可自愈的 400 */
  function unsupportedParam(text: string, param: string): boolean {
    return new RegExp(`unsupported parameter[^"]*'?${param}'?`, "i").test(text)
      || new RegExp(`'${param}'[^"]*not supported`, "i").test(text);
  }

  function payloadOf(messages: ChatMessage[], opts: { json: boolean; stream?: boolean; model?: string }) {
    return {
      model: opts.model || model,
      messages,
      ...(omitTemperature ? {} : { temperature: wantTemperature }),
      stream: opts.stream === true,
      ...(maxTokens > 0 ? { max_tokens: maxTokens } : {}),
      ...(opts.json && JSON_MODE === "json_object" ? { response_format: { type: "json_object" } } : {}),
      ...(opts.json && JSON_MODE === "json_schema"
        ? { response_format: { type: "json_schema", json_schema: { name: "draft", strict: false, schema: { type: "object" } } } }
        : {}),
    };
  }

  /** 一次性（非流式）调用：**fetch + 读 body 在同一个 deadline 内** */
  async function attempt(messages: ChatMessage[], opts: { json: boolean; model?: string }, signal: AbortSignal | undefined): Promise<string> {
    return withDeadline(signal, timeoutMs, async (s) => {
      if (dhworkCloud) await ensureDhworkSession(false);
      const send = () => fetch(url, {
        method: "POST",
        headers: headersNow(),
        body: JSON.stringify(payloadOf(messages, opts)),
        signal: s,
      });
      let res = await send();
      let text = await res.text();
      // 会话令牌失效：**强制续期后重试一次**（DHwork 把失效也包成 500）
      if (dhworkCloud && authExpired(res.status, text)) {
        try { await ensureDhworkSession(true); } catch { /* 续期失败 → 交给下面的错误分支如实上报 */ }
        res = await send();
        text = await res.text();
      }
      // 上游明确不支持 temperature → 摘掉该参数重试一次（换模型不用改配置）
      if (res.status === 400 && !omitTemperature && unsupportedParam(text, "temperature")) {
        omitTemperature = true;
        res = await send();
        text = await res.text();
      }
      if (res.status >= 400 && res.status < 500) failFor(res, text);
      if (res.status >= 500) throw new Error(`upstream ${res.status}`);
      return text;
    });
  }

  /** 流式调用：Delta 即时回调；上游不支持 SSE 时**自动退回一次性返回** */
  async function attemptStream(
    messages: ChatMessage[], onDelta: (s: string) => void, signal: AbortSignal | undefined, useModel?: string,
  ): Promise<string> {
    return withDeadline(signal, timeoutMs, async (s) => {
      if (dhworkCloud) await ensureDhworkSession(false);
      const send = () => fetch(url, {
        method: "POST",
        headers: headersNow(),
        body: JSON.stringify(payloadOf(messages, { json: false, stream: true, model: useModel })),
        signal: s,
      });
      let res = await send();
      let ctype = res.headers.get("content-type") ?? "";
      // 会话令牌失效（401/403 或 500 里的「登录状态无效」）→ 强制续期后重试一次
      if (dhworkCloud && (res.status === 401 || res.status === 403 || res.status >= 500)) {
        const peek = await res.text();
        if (authExpired(res.status, peek)) {
          let ok = true;
          try { await ensureDhworkSession(true); } catch { ok = false; }
          if (ok) {
            res = await send();
            ctype = res.headers.get("content-type") ?? "";
          } else {
            throw new ApiError("UPSTREAM_UNAVAILABLE", `DHwork 会话续期失败：${dhworkSessionStatus().last_error || "未知原因"}`);
          }
        } else if (res.status >= 400 && res.status < 500) {
          failFor(res, peek);
        } else {
          throw new Error(`upstream ${res.status}`);
        }
      }
      if (res.status === 400 && !omitTemperature) {
        const peek = await res.text();
        if (unsupportedParam(peek, "temperature")) {
          omitTemperature = true;
          res = await send();
          ctype = res.headers.get("content-type") ?? "";
        } else {
          failFor(res, peek);
        }
      } else if (res.status >= 400 && res.status < 500) {
        failFor(res, await res.text());
      }
      if (res.status >= 500) throw new Error(`upstream ${res.status}`);
      if (!ctype.includes("text/event-stream")) {
        const parsed = JSON.parse(await res.text()) as ChatResponse;
        const content = parsed.choices?.[0]?.message?.content ?? "";
        if (!content.trim()) throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型返回为空。");
        onDelta(content);
        return content;
      }
      const reader = res.body?.getReader();
      if (!reader) throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型流式响应不可读。");
      const decoder = new TextDecoder();
      let buffer = "";
      let out = "";
      for (;;) {
        const { done, value } = await reader.read();   // 被同一个 signal 中断 → AbortError
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = -1;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const delta = (JSON.parse(data) as ChatResponse).choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) { out += delta; onDelta(delta); }
          } catch { /* 单个坏块不影响整体 */ }
        }
      }
      if (!out.trim()) throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型流式返回为空。");
      return out;
    });
  }

  function parseContent<T>(text: string): T {
    let parsed: ChatResponse;
    try { parsed = JSON.parse(text) as ChatResponse; }
    catch { throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型返回的不是 JSON。"); }
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new ApiError("UPSTREAM_UNAVAILABLE", parsed.error?.message ? `大模型出错：${parsed.error.message}` : "大模型返回为空。");
    return parseJsonObject<T>(content);
  }

  function parseText(text: string): string {
    let parsed: ChatResponse;
    try { parsed = JSON.parse(text) as ChatResponse; }
    catch { throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型返回的不是 JSON。"); }
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new ApiError("UPSTREAM_UNAVAILABLE", parsed.error?.message ? `大模型出错：${parsed.error.message}` : "大模型返回为空。");
    return stripFence(content).trim();
  }

  /**
   * JSON 任务：**解析/结构失败再给一次机会**。
   * 实测真实上游会把长 JSON 截断（解析必然失败），一次重试对上游抖动与截断都有效；
   * 两次都不合法才判失败 —— **绝不静默放行**。
   */
  const callJson = async <T>(messages: ChatMessage[], signal?: AbortSignal, useModel?: string): Promise<T> => {
    let lastErr: unknown = null;
    for (let i = 0; i < 2; i += 1) {
      const text = await withRetry(signal, timeoutMs, () => attempt(messages, { json: true, model: useModel }, signal));
      try { return parseContent<T>(text); }
      catch (e) {
        lastErr = e;
        if (signal?.aborted) throw e;
      }
    }
    throw lastErr instanceof ApiError ? lastErr : new ApiError("UPSTREAM_UNAVAILABLE", "大模型返回的结构不合法。");
  };

  const callText = async (messages: ChatMessage[], signal?: AbortSignal, useModel?: string): Promise<string> =>
    parseText(await withRetry(signal, timeoutMs, () => attempt(messages, { json: false, model: useModel }, signal)));

  /** 流式只在**尚未吐出任何增量**时才允许重试，避免重复内容**
   */
  const callStream = async (messages: ChatMessage[], onDelta: (s: string) => void, signal?: AbortSignal, useModel?: string): Promise<string> => {
    let emitted = false;
    const wrapped = (d: string) => { emitted = true; onDelta(d); };
    try {
      return await attemptStream(messages, wrapped, signal, useModel);
    } catch (e) {
      if (e instanceof ApiError || emitted || isAbort(e)) throw e;
      return attemptStream(messages, wrapped, signal, useModel);
    }
  };

  const LEVELS = ["blocking", "major", "suggestion"] as const;

  return {
    kind: "real",

    async review({ markdown, level, extended, standardItems, model: useModel }) {
      const items = standardItems.map((i) => `${i.code}\t${i.level}\t${i.title}`).join("\n");
      const draft = await callJson<ReviewDraft>([
        {
          role: "system",
          content: [
            "你是「AutoDevelopment 平台」的门禁审核角色，按检查项对 PRD 逐项判定。",
            "只输出 JSON，不要任何解释文字，结构：",
            '{"items":[{"item_code":"A1","group":"A","level":"blocking","verdict":"pass|fail|na","evidence_ref":"原文小节名或原文片段","suggestion":"补齐建议"}],',
            '"questions":[{"question_code":"Q1","level":"blocking","title":"问题","options":["A. …","B. …","X. Other"],"fallback":"not_yet_defined","impact":"影响范围"}],',
            '"assumptions":[{"assumption_code":"AS1","content":"假设内容","source_tag":"[来源: 推断，待确认]"}]}',
            "硬规则：",
            "1) 检查项编号必须**逐条照抄**给定清单，不得增删；",
            "2) `level` 必须取给定清单里的等级，不得改判；",
            "3) **无证据不得判定**：`verdict=pass` 时 `evidence_ref` 必须能指到原文小节名或原文片段，否则判 `fail`；",
            "4) `fail` 必须给出可执行的 `suggestion`；",
            "5) 对文档里说不清楚、需要人来定的点，写进 `questions`（含 3~5 个选项与兜底值）；",
            "6) 文档没写但平台按默认处理的地方，写进 `assumptions`；",
            "7) `na` **只用于「本等级明确不评」的检查项**，不得用 `na` 回避给定清单里的项。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `${reviewLevelProfile(level, extended)}\n\n【检查项清单】\n${items}\n\n【PRD 正文】\n${markdown}`,
        },
      ], undefined, useModel);
      // 结构校验：**不合法一律视为上游失败**（绝不放行空结论）
      if (!draft || !Array.isArray(draft.items) || !draft.items.length)
        throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型没有返回可用的审核结论，未应用结果。");
      const okLevel = (v: unknown) => LEVELS.includes(v as never) || v === "na" || v === "pass" || v === "fail";
      for (const it of draft.items) {
        if (typeof it?.item_code !== "string" || !okLevel(it.level) || !okLevel(it.verdict))
          throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型返回的审核结论结构不合法，未应用结果。");
      }
      return {
        // `group` 以**检查项编号前缀**为准，不轻信模型自报
        items: draft.items.map((it) => ({ ...it, group: it.group || it.item_code.charAt(0) })),
        questions: Array.isArray(draft.questions) ? draft.questions : [],
        assumptions: Array.isArray(draft.assumptions) ? draft.assumptions : [],
      };
    },

    async split({ markdown, depth, model: useModel }) {
      const draft = await callJson<SplitDraft>([
        {
          role: "system",
          content: [
            "你是「AutoDevelopment 平台」的需求拆解角色，把 PRD 拆成五个角色的需求包。",
            '只输出 JSON：{"packs":[{"role":"UI","reqs":["REQ-UI-001"]},{"role":"接口","reqs":[]},{"role":"App","reqs":[]},{"role":"埋点","reqs":[]},{"role":"测试","reqs":[]}]}',
            "硬规则：",
            "1) `role` 必须**恰好是**这五个中文名：UI、接口、App、埋点、测试，顺序不变、不得增删；",
            "2) REQ 编号形如 `REQ-<模块>-<三位数字>`，模块用大写字母与数字，例如 REQ-UI-001 / REQ-API-002 / REQ-GEN-003；",
            "3) 编号在**本项目内唯一**，从 001 连续编号；",
            "4) 每条 REQ 必须来自 PRD 里真实存在的需求点，**不要编造**；该角色没有就返回空数组。",
          ].join("\n"),
        },
        { role: "user", content: `拆解深度：${depth}\n\n【PRD 正文】\n${markdown}` },
      ], undefined, useModel);
      const roles = ["UI", "接口", "App", "埋点", "测试"];
      const packs = Array.isArray(draft?.packs) ? draft.packs : [];
      const byRole = new Map(packs.map((p) => [p?.role, p]));
      if (packs.length !== 5 || roles.some((r) => !byRole.has(r)))
        throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型返回的需求包不是五角色，未应用结果。");
      const seen = new Set<string>();
      for (const r of roles) {
        const reqs = byRole.get(r)?.reqs;
        if (!Array.isArray(reqs)) throw new ApiError("UPSTREAM_UNAVAILABLE", `大模型返回的「${r}」需求包结构不合法。`);
        for (const req of reqs) {
          if (typeof req !== "string" || !/^REQ-[A-Z0-9]+-\d{3}$/.test(req))
            throw new ApiError("UPSTREAM_UNAVAILABLE", `大模型返回的需求编号不合法：${String(req)}`);
          if (seen.has(req)) throw new ApiError("UPSTREAM_UNAVAILABLE", `大模型返回了重复的需求编号：${req}`);
          seen.add(req);
        }
      }
      return { packs: roles.map((r) => ({ role: r, reqs: byRole.get(r)!.reqs })), depth };
    },

    async spec({ role, requirements, projectName, context, depth, model: useModel }) {
      const content = await callText([
        {
          role: "system",
          content: [
            "你是「AutoDevelopment 平台」的角色 Spec 撰写者。输出**只有 Markdown 正文**，不要任何前后缀说明。",
            "要求：",
            "1) 一级标题为 `# <角色> Spec（<项目名>）`；",
            "2) 必须含「## 1 覆盖需求」并逐条列出给定的 REQ 编号；",
            "3) 按该角色的固定章节展开（见用户消息里的章节清单），每节都要有**可开发**的细节，不要写空话；",
            "4) 禁止编造 PRD 里没有的需求；信息不足时在正文里显式写「（待澄清）」并说明缺什么；",
            "5) 不要输出任何密钥、凭据。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `项目：${projectName}`,
            `角色：${role}`,
            `深度：${depth}`,
            `必须覆盖的 REQ：${requirements.length ? requirements.join("、") : "（本角色暂无需求）"}`,
            `章节清单：${(SECTION_NEEDS[role] ?? ["概述"]).join(" / ")}`,
            `需求包全貌：\n${context}`,
          ].join("\n"),
        },
      ], undefined, useModel);
      if (!content.trim()) throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型没有返回 Spec 内容。");
      return { role, content_md: content };
    },

    async chat(input) {
      const onDelta = input.onDelta ?? (() => undefined);
      return callStream([
        {
          role: "system",
          content: [
            "你是「AutoDevelopment 平台」的需求助手，在右栏对话里和需求方确认 PRD 的细节。",
            "要求：用中文、简短、一次只问最关键的 1~3 个问题；能落到具体改动就给具体建议；",
            "不要编造需求方没说过的事实；不确定就用提问确认。",
          ].join("\n"),
        },
        ...input.history.slice(-20).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }) as ChatMessage),
        { role: "user" as const, content: input.content },
      ], onDelta, input.signal, input.model);
    },
  };
}

// ---------------- 开发适配器（确定性，不联网） ----------------

/** 从 Markdown 里抽取一级/二级标题，作为「文档里实际存在的小节」 */
function sections(markdown: string): string[] {
  return [...markdown.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
}

/** 关键词命中：返回**首个命中关键词所在的小节名**（用于 `evidence_ref`，可追溯） */
function sectionFor(secs: string[], keywords: string[]): string | null {
  for (const k of keywords) {
    const hit = secs.find((s) => s.includes(k));
    if (hit) return hit;
  }
  return null;
}

export function createMockAdapter(): LlmAdapter {
  return {
    kind: "mock",
    /**
     * 开发实现：**只依据文档里实际存在的小节**判定通过与否，结论可追溯到小节名（`evidence_ref`）；
     * 不做任何「编造内容」——找不到就判 `fail` 并给出补齐建议。
     */
    async review({ markdown, level, standardItems }) {
      const secs = sections(markdown);

      // 每个检查项的**判定关键词**（命中即 pass）。覆盖精简表 14 项 + 简审专项 2 项；
      // 其它（严格档追加的细则项）在本适配器里没有自动判定规则 → 判 `na`（**不编造结论**）。
      const NEED: Record<string, { hit: string[]; need: string }> = {
        A1: { hit: ["背景", "一句话", "概述"], need: "一句话说明 / 背景" },
        A2: { hit: ["主流程", "流程", "分期"], need: "主流程 / 分期规划" },
        A3: { hit: ["范围", "目标"], need: "范围与目标" },
        B1: { hit: ["状态", "状态机"], need: "状态机与迁移条件" },
        B2: { hit: ["异常", "失败", "边界"], need: "异常与失败路径" },
        C1: { hit: ["字段", "数据", "模型"], need: "数据与字段定义" },
        C2: { hit: ["属性", "样式"], need: "属性域与取值" },
        D1: { hit: ["页面", "元素"], need: "页面级元素构成" },
        D2: { hit: ["文案", "字样"], need: "逐字文案" },
        E1: { hit: ["接口", "API"], need: "接口契约" },
        F1: { hit: ["权限", "角色"], need: "角色与权限矩阵" },
        G1: { hit: ["生成", "验证"], need: "生成与验证" },
        H1: { hit: ["角落", "组合"], need: "角落扫描：组件 × 条件面" },
        I1: { hit: ["假设"], need: "假设集中确认" },
        // 简审专项（`quick`）：Q1 可实现性 / Q2 内部一致性·冲突
        Q1: { hit: ["主流程", "流程", "背景", "概述", "一句话", "目标"], need: "主流程 / 背景 / 一句话说明（可实现性）" },
        Q2: { hit: ["范围", "目标", "背景", "概述"], need: "范围 / 目标 / 背景（内部一致性）" },
      };

      // **逐条对齐 `standardItems`**（含严格档追加的细则项）—— 条目数必须与服务端应评数一致。
      const items: ReviewItemDraft[] = standardItems.map((s) => {
        const def = NEED[s.code];
        if (!def) {
          return { item_code: s.code, group: s.code.charAt(0), level: s.level, verdict: "na",
            evidence_ref: "（该检查项在本适配器中暂无自动判定规则）", suggestion: "" };
        }
        const hitSec = sectionFor(secs, def.hit);
        return {
          item_code: s.code, group: s.code.charAt(0), level: s.level,
          verdict: hitSec ? "pass" : "fail",
          evidence_ref: hitSec ? `§ ${hitSec}` : `未找到「${def.need}」`,
          suggestion: hitSec ? "" : `补齐「${def.need}」后再进入拆解。`,
        };
      });

      // 待澄清：只针对**确实缺失**的小节提问（附 impact）
      const questions: QuestionDraft[] = items.filter((i) => i.verdict === "fail")
        .map((i, idx) => ({
          question_code: `Q${idx + 1}`,
          level: i.level,
          title: `文档里没有找到「${i.evidence_ref.replace(/^未找到/, "").replace(/[「」]/g, "")}」，这一项怎么定？`,
          options: ["按平台默认处理", "稍后补充文档", "本期不做"],
          fallback: "not_yet_defined",
          impact: `影响 ${i.group} 组门禁结论与后续拆解范围`,
        }));

      // 简审档**不强制**假设（R-25）；其余档沿用两条固定假设（带来源标签，需用户确认）
      const assumptions: AssumptionDraft[] = level === "quick" ? [] : [
        { assumption_code: "假设-A1", content: "平台按单用户量级处理（< 100 个项目）。", source_tag: "[来源: 推断，待确认]" },
        { assumption_code: "假设-A2", content: "上传的文档一律按只读来源解析，不反向修改原文档。", source_tag: "[来源: 推断，待确认]" },
      ];

      return { items, questions, assumptions };
    },

    /** 拆解：按五角色产出需求包；REQ-ID 由文档小节数与深度决定（**确定性**） */
    async split({ markdown, depth }) {
      const secs = sections(markdown);
      const n = Math.max(3, Math.min(8, secs.length));
      const mk = (role: string, prefix: string) =>
        ({ role, reqs: Array.from({ length: n }, (_, i) => `REQ-${prefix}-${String(i + 1).padStart(3, "0")}`) });
      const packs = [mk("UI", "UI"), mk("接口", "API"), mk("App", "GEN"), mk("埋点", "TRACK"), mk("测试", "SPEC")];
      if (depth === "minimal") {
        return { depth, packs: packs.map((p) => (p.role === "埋点" ? { ...p, reqs: [] } : p)) };
      }
      if (depth === "comprehensive") {
        packs.find((p) => p.role === "测试")?.reqs.push("REQ-NF-002");
      }
      return { depth, packs };
    },

    /**
     * 角色 Spec：**确定性**地按需求包与角色必需章节拼出 Markdown（**非 AI 产出**）。
     * 每一节都来自需求包 REQ-ID 或该角色固定章节，**不编造需求内容**。
     */
    async spec({ role, requirements, projectName }) {
      const sections = SECTION_NEEDS[role] ?? ["概述"];
      const lines = [
        `# ${role} Spec（${projectName}）`,
        "",
        "> 由**开发适配器**按需求包确定性生成，**不是真实大模型产出**；接入真实模型后内容才具语义。",
        "",
        "## 1 覆盖需求",
        ...(requirements.length ? requirements.map((r) => `- ${r}`) : ["- （本期该角色无需求条目）"]),
        "",
        "## 2 本角色章节",
        ...sections.flatMap((s, i) => [`### 2.${i + 1} ${s}`, "", "（待补：真实模型生成后此处为逐条设计。）", ""]),
      ];
      return { role, content_md: lines.join("\n") };
    },

    /** 对话回复：确定性回执，**不冒充对需求的理解** */
    async chat({ content, history, onDelta }) {
      const reply = `（开发适配器）已收到你的补充，共 ${[...content].length} 字；本轮对话已有 ${history.length} 条历史。`
        + "接入真实大模型后，这里会是平台对需求的追问与确认。";
      onDelta?.(reply);
      return reply;
    },
  };
}

export function createLlmAdapter(): LlmAdapter {
  const base = process.env.AD_LLM_BASE_URL;
  const key = process.env.AD_LLM_API_KEY ?? "";
  const model = process.env.AD_LLM_MODEL ?? "";
  // `AD_LLM_MODE=development` **显式**指定时才用确定性桩，避免误把桩当真实模型
  if (process.env.AD_LLM_MODE === "development") return createMockAdapter();
  if (base && model) return createRealAdapter(base, key, model);
  if (base && !model) {
    // 配了地址却没给模型名 → 明确报错，不静默降级
    const miss = () => { throw new ApiError("UPSTREAM_UNAVAILABLE", "已配置 AD_LLM_BASE_URL 但缺少 AD_LLM_MODEL。"); };
    return { kind: "real", async review(){ miss(); }, async split(){ miss(); }, async spec(){ miss(); }, async chat(){ miss(); } } as unknown as LlmAdapter;
  }
  const unavailable = () => { throw new ApiError("UPSTREAM_UNAVAILABLE","未配置大模型服务；未应用任何生成结果。"); };
  return {
    kind:"real",
    async review(){ unavailable(); }, async split(){ unavailable(); },
    async spec(){ unavailable(); }, async chat(){ unavailable(); },
  } as unknown as LlmAdapter;
}
