/**
 * 飞书开放平台适配器（E4 依赖之一，超时 60s，**部分失败不阻断其余**）。
 *
 * 平台需要它的三件事：① 扫码登录；② 读云文档正文 / 内嵌表格 / 白板图；③ 附件下载。
 *
 * 本文件给出**两个实现**：
 *  - `FeishuRealAdapter`：走真实开放平台（需 `AD_FEISHU_APP_ID` / `AD_FEISHU_APP_SECRET`）；
 *  - `FeishuMockAdapter`：**开发适配器**，不联网，扫码状态由 `/auth/feishu/.../simulate` 显式推进
 *    （真实环境由手机扫码推进），返回结构与真实实现**完全一致**。
 *
 * 选择：设了 `AD_FEISHU_APP_ID` 用真实实现，否则用开发实现并在启动日志里明示。
 * ⚠️ 密钥**只存在于服务端环境变量**，绝不下发到浏览器、绝不写入日志。
 */
import { ApiError } from "../core/envelope.ts";
import { get, nowIso, run } from "../db/index.ts";

export type ScanStatus = "pending_scan" | "scanned" | "expired" | "confirmed";

export interface FeishuIdentity { open_id: string; nickname: string; avatar_url: string }

export interface ParsedParts {
  body: { status: "ok" | "failed" | "skipped"; chars?: number };
  tables: { token: string; status: "ok" | "failed" | "skipped" }[];
  whiteboards: { token: string; status: "ok" | "failed" | "skipped" }[];
  attachments: { name: string; status: "ok" | "failed" | "skipped" }[];
}

export interface FeishuAdapter {
  readonly kind: "real" | "mock";
  createQrcode(): Promise<{ qrcode_url: string; expires_in_seconds: number; state: string }>;
  scanStatus(state: string): Promise<ScanStatus>;
  /** 开发适配器专用：显式推进扫码状态；真实适配器下抛 `INVALID_ARGUMENT` */
  simulate(state: string, next: "scanned" | "confirmed"): Promise<FeishuIdentity | null>;
  /** 真实模式：回调里换取到的用户身份（`#64` 用它建档）；开发适配器返回 `null` 走内置身份 */
  takeIdentity?(state: string): FeishuIdentity | null;
  /** 真实模式：授权码换用户令牌 → 用户信息（真机扫码回调） */
  completeLogin?(state: string, code: string): Promise<FeishuIdentity>;
  /** 读飞书云文档 → 分块解析结果（原文正文 + 表格 / 白板图 token + 附件清单） */
  readDocument(link: string): Promise<{ title: string; parts: ParsedParts; markdown: string }>;
}

const EXPIRES_SECONDS = 120;

// ---------------- 云文档链接解析 ----------------

export type FeishuDocKind = "docx" | "doc" | "wiki" | "sheet" | "base" | "file";

/** 从飞书链接里取出「类型 + token」；支持 docx / docs(旧版文档) / wiki / sheets / base */
export function parseFeishuLink(link: string): { kind: FeishuDocKind; token: string } | null {
  const raw = String(link ?? "").trim();
  const m = /^https?:\/\/[^/\s]+\/(docx|docs|doc|wiki|sheets|base|file)\/([A-Za-z0-9_-]{6,})/.exec(raw);
  if (!m) return null;
  const seg = m[1]!;
  const kind: FeishuDocKind = seg === "docs" || seg === "doc" ? "doc"
    : seg === "sheets" ? "sheet" : (seg as FeishuDocKind);
  return { kind, token: m[2]! };
}

// ---------------- 真实实现 ----------------

/** docx 的富文本挂在**以块类型命名的字段**上（text / heading1 / bullet / code / quote / todo / callout …） */
const RICH_KEYS = [
  "text", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "heading7", "heading8", "heading9",
  "bullet", "ordered", "code", "quote", "todo", "callout", "quote_container", "task", "equation", "agenda_item_title", "agenda_item",
] as const;
const HEADING_LEVEL: Record<string, number> = {
  heading1: 1, heading2: 2, heading3: 3, heading4: 4, heading5: 5, heading6: 6, heading7: 7, heading8: 8, heading9: 9,
};

interface DocxBlock {
  block_id: string;
  block_type: number;
  parent_id?: string;
  children?: string[];
  table?: { property?: { row_size?: number; column_size?: number }; cells?: string[] };
  sheet?: { token?: string };
  file?: { token?: string; name?: string };
  board?: { token?: string };
  image?: { token?: string };
  [k: string]: unknown;
}

const esc = (v: unknown) => String(v ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();

/**
 * 真实实现：走 `open.feishu.cn`。
 *
 * 凭据两种模式：
 *  - **应用模式**（默认）：`AD_FEISHU_APP_ID` + `AD_FEISHU_APP_SECRET`，用 `tenant_access_token` 读**应用被授权**的文档；扫码登录需配置回调地址；
 *  - **用户令牌模式**：`AD_FEISHU_USER_TOKEN`，以**当前用户身份**读他有权限的文档（本地联调最省事，
 *    但它是**个人令牌**，不是平台应用凭据，**不要用于生产**）。
 *
 * ⚠️ 密钥只在服务端环境变量，绝不下发浏览器、绝不写入日志。
 */
export function createRealAdapter(
  appId: string,
  appSecret: string,
  opts: { userToken?: string; redirectUri?: string } = {},
): FeishuAdapter {
  // 可覆盖：Lark 国际版是 open.larksuite.com；本地一致性测试也用它指向桩服务
  const BASE = (process.env.AD_FEISHU_BASE_URL ?? "https://open.feishu.cn/open-apis").replace(/\/+$/, "");
  const AUTH_BASE = (process.env.AD_FEISHU_AUTH_BASE_URL ?? "https://accounts.feishu.cn/open-apis").replace(/\/+$/, "");
  let tenantToken: { token: string; exp: number } | null = null;

  async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 60_000); // `§0.6`：飞书 60s 超时
    try {
      return await fetch(url, { ...init, signal: ac.signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new ApiError("UPSTREAM_TIMEOUT", "飞书请求超时。");
      throw new ApiError("UPSTREAM_UNAVAILABLE", "飞书暂时不可用。");
    } finally {
      clearTimeout(t);
    }
  }

  async function getTenantToken(): Promise<string> {
    if (tenantToken && tenantToken.exp > Date.now() + 60_000) return tenantToken.token;
    const res = await fetchWithTimeout(`${BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const body = (await res.json()) as { code: number; msg: string; tenant_access_token?: string; expire?: number };
    if (body.code !== 0 || !body.tenant_access_token)
      throw new ApiError("UPSTREAM_UNAVAILABLE", `飞书鉴权失败（${body.msg || body.code}）。`);
    tenantToken = { token: body.tenant_access_token, exp: Date.now() + (body.expire ?? 7200) * 1000 };
    return tenantToken.token;
  }

  /** 当前读取用的令牌：用户令牌优先（本地联调），否则租户令牌 */
  const readToken = async () => opts.userToken || (await getTenantToken());

  /** 调一个飞书接口并解包 `{code,msg,data}`；`code !== 0` 一律当失败（细粒度错误码归一为可读文案） */
  async function api<T>(path: string, init: RequestInit = {}, tokenOverride?: string): Promise<T> {
    const token = tokenOverride ?? (await readToken());
    const res = await fetchWithTimeout(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => null)) as { code?: number; msg?: string; data?: T } | null;
    if (!body) throw new ApiError("UPSTREAM_UNAVAILABLE", "飞书返回了无法解析的内容。");
    if (body.code !== 0) {
      const msg = body.msg ?? "";
      if (/permission|forbidden|no permission|Access denied/i.test(msg))
        throw new ApiError("FORBIDDEN", "平台没有这篇文档的访问权限。");
      if (/not exist|not found|invalid.*token/i.test(msg))
        throw new ApiError("NOT_FOUND", "链接无效或已失效。");
      throw new ApiError("UPSTREAM_UNAVAILABLE", `飞书接口出错（${body.code} ${msg}）。`);
    }
    return body.data as T;
  }

  /** 取整篇文档的块（分页拉全；失败时由调用方降级，不阻断正文） */
  async function listBlocks(documentId: string): Promise<DocxBlock[]> {
    const out: DocxBlock[] = [];
    let pageToken = "";
    for (let i = 0; i < 40; i += 1) {
      const q = `/docx/v1/documents/${documentId}/blocks?page_size=500&document_revision_id=-1`
        + (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : "");
      const r = await api<{ items?: DocxBlock[]; has_more?: boolean; page_token?: string }>(q);
      out.push(...(r.items ?? []));
      if (!r.has_more || !r.page_token) break;
      pageToken = r.page_token;
    }
    return out;
  }

  /** 取一个块里的可见文本（富文本挂在类型命名字段上） */
  function richText(block: DocxBlock): string {
    for (const key of RICH_KEYS) {
      const holder = block[key] as { elements?: { text_run?: { content?: string }; mention_user?: unknown; equation?: { content?: string } }[] } | undefined;
      if (holder && Array.isArray(holder.elements)) {
        return holder.elements.map((el) =>
          el.text_run?.content ?? (el.equation ? `$${el.equation.content ?? ""}$` : el.mention_user ? "@某人" : "")).join("");
      }
    }
    return "";
  }

  /** 表格单元格文本：cell 块的 children 逐个取文本 */
  function cellText(cellId: string, byId: Map<string, DocxBlock>): string {
    const cell = byId.get(cellId);
    if (!cell) return "";
    const parts = (cell.children ?? []).map((cid) => richText(byId.get(cid) ?? ({ block_id: cid, block_type: 0 } as DocxBlock)));
    return parts.filter(Boolean).join(" ").trim();
  }

  interface DocResult { title: string; parts: ParsedParts; markdown: string }

  /** docx：正文用 `raw_content`（保证拿得到），表格/附件/白板用 `blocks`（拿不到就如实标失败） */
  async function readDocx(documentId: string): Promise<DocResult> {
    const meta = await api<{ document?: { title?: string; revision_id?: number } }>(`/docx/v1/documents/${documentId}`);
    const title = meta.document?.title ?? "飞书云文档";

    let raw = "";
    try {
      const rc = await api<{ content?: string }>(`/docx/v1/documents/${documentId}/raw_content`);
      raw = String(rc.content ?? "");
    } catch (e) {
      if (e instanceof ApiError && e.code === "FORBIDDEN") throw e;   // 无权限要明确拒绝
      throw e;
    }

    let blocks: DocxBlock[] = [];
    let blocksError: string | null = null;
    try { blocks = await listBlocks(documentId); }
    catch (e) { blocksError = e instanceof ApiError ? e.code : "INTERNAL"; }

    const parts: ParsedParts = {
      body: raw.trim() ? { status: "ok", chars: [...raw].length } : { status: "skipped" },
      tables: [], whiteboards: [], attachments: [],
    };

    if (blocksError || !blocks.length) {
      // 拿不到块：正文可用，但表格/附件/白板**如实标为失败或跳过**，绝不假装已取到
      return {
        title,
        parts: {
          ...parts,
          tables: [{ token: "blocks", status: blocksError ? "failed" : "skipped" }],
        },
        markdown: `# ${title}\n\n${raw}`.trim(),
      };
    }

    const byId = new Map(blocks.map((b) => [b.block_id, b]));
    const cellIds = new Set<string>();
    for (const b of blocks) if (b.table?.cells) for (const c of b.table.cells) cellIds.add(c);
    const nestedIds = new Set<string>();
    for (const id of cellIds) for (const c of byId.get(id)?.children ?? []) nestedIds.add(c);

    const out: string[] = [`# ${title}`, ""];
    const codeLanguages = new Set<string>();
    let tableIndex = 0;

    for (const b of blocks) {
      if (cellIds.has(b.block_id) || nestedIds.has(b.block_id)) continue;   // 表格内部由表格统一渲染
      const text = richText(b);
      const heading = RICH_KEYS.find((k) => HEADING_LEVEL[k] && (b as Record<string, unknown>)[k]);
      if (heading) { out.push(`${"#".repeat(HEADING_LEVEL[heading]!)} ${text}`.trim(), ""); continue; }
      if (text) {
        const key = RICH_KEYS.find((k) => (b as Record<string, unknown>)[k] && Array.isArray(((b as Record<string, unknown>)[k] as { elements?: unknown[] }).elements));
        if (key === "bullet") out.push(`- ${text}`);
        else if (key === "ordered") out.push(`1. ${text}`);
        else if (key === "quote" || key === "quote_container") out.push(`> ${text}`);
        else if (key === "code") { codeLanguages.add(String(((b["code"] as { style?: { language?: unknown } })?.style?.language) ?? "")); out.push("```", text, "```"); }
        else out.push(text, "");
        continue;
      }
      if (b.table?.cells?.length) {
        tableIndex += 1;
        const cols = b.table.property?.column_size ?? 0;
        const rows = b.table.property?.row_size ?? 0;
        const token = `tbl_${tableIndex}`;
        const cells = b.table.cells.map((cid) => cellText(cid, byId));
        const md: string[] = [];
        for (let r = 0; r < Math.max(rows, 1); r += 1) {
          const slice = cells.slice(r * (cols || cells.length), (r + 1) * (cols || cells.length));
          md.push(`| ${slice.map(esc).join(" | ")} |`);
          if (r === 0) md.push(`|${" --- |".repeat(Math.max(slice.length, 1))}`);
        }
        out.push(...md, "");
        parts.tables.push({ token, status: "ok" });
        continue;
      }
      if (b.sheet?.token) {
        tableIndex += 1;
        const token = `sheet_${tableIndex}`;
        try {
          // docx 内嵌表格的 token 形如 `<spreadsheetToken>_<sheetId>`，**按最后一个下划线拆**
          const md = await readEmbeddedSheet(b.sheet.token, 200);
          if (md) { out.push(md, ""); parts.tables.push({ token, status: "ok" }); }
          else parts.tables.push({ token, status: "skipped" });
        } catch { parts.tables.push({ token, status: "failed" }); }
        continue;
      }
      if (b.file?.token) {
        parts.attachments.push({ name: b.file.name || `附件_${parts.attachments.length + 1}`, status: "ok" });
        out.push(`> 附件：${b.file.name || "未命名"}` + "（平台已登记该附件；如需正文请单独下载）", "");
        continue;
      }
      if (b.board?.token) {
        // 白板**只给缩略图**，取不到结构化文本 —— 如实标 `skipped`，不假装已解析
        parts.whiteboards.push({ token: b.board.token, status: "skipped" });
        out.push("> 白板图：平台只能拿到缩略图，**无法取到结构化文本**；请以原文档为准。", "");
        continue;
      }
      if (b.image?.token) out.push(`![图片](${b.image.token})`, "");
      if (b.block_type === 22) out.push("", "---", "");
    }
    void codeLanguages;

    const markdown = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const bodyChars = [...raw].length || [...markdown].length;
    return {
      title,
      parts: { ...parts, body: bodyChars ? { status: "ok", chars: bodyChars } : { status: "skipped" } },
      markdown,
    };
  }

  /** 单元格 → Markdown 表（表头 + 分隔行） */
  function rowsToMarkdown(values: unknown[][]): string {
    if (!values.length) return "";
    const out: string[] = [];
    values.forEach((row, i) => {
      out.push(`| ${row.map(esc).join(" | ")} |`);
      if (i === 0) out.push(`|${" --- |".repeat(Math.max(row.length, 1))}`);
    });
    return out.join("\n");
  }

  /**
   * docx **内嵌表格**：token 形如 `<spreadsheetToken>_<sheetId>`，直接按 sheetId 取区间；
   * 没有下划线时按普通电子表格处理（查全部工作表）。
   */
  async function readEmbeddedSheet(embedded: string, maxRows: number): Promise<string> {
    const cut = embedded.lastIndexOf("_");
    if (cut > 0) {
      const spreadsheetToken = embedded.slice(0, cut);
      const sheetId = embedded.slice(cut + 1);
      const r = await api<{ valueRange?: { values?: unknown[][] } }>(
        `/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(`${sheetId}!A1:Z${maxRows}`)}`,
      );
      return rowsToMarkdown(r.valueRange?.values ?? []);
    }
    return readSheetAsMarkdown(embedded, maxRows);
  }

  /** 表格（电子表格）：把前若干行渲染成 Markdown 表 */
  async function readSheetAsMarkdown(spreadsheetToken: string, maxRows: number): Promise<string> {
    const info = await api<{ sheets?: { sheet_id?: string; title?: string; grid_properties?: { row_count?: number; column_count?: number } }[] }>(
      `/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`,
    );
    const sheets = (info.sheets ?? []).slice(0, 3);
    const out: string[] = [];
    for (const s of sheets) {
      if (!s.sheet_id) continue;
      const rows = Math.min(maxRows, Math.max(1, s.grid_properties?.row_count ?? maxRows));
      const range = `${s.sheet_id}!A1:Z${rows}`;
      const v = await api<{ valueRange?: { values?: unknown[][] } }>(
        `/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`,
      );
      const values = v.valueRange?.values ?? [];
      if (!values.length) continue;
      out.push(`## ${s.title || "工作表"}`, "", rowsToMarkdown(values), "");
    }
    return out.join("\n").trim();
  }

  return {
    kind: "real",

    /**
     * 扫码登录：返回飞书**授权页地址**（手机扫码/点击授权后回到 `redirect_uri`），
     * 回调由 `GET /api/v1/auth/feishu/callback` 处理并把该 `state` 置为 `confirmed`。
     */
    async createQrcode() {
      if (!appId || !appSecret)
        throw new ApiError("UPSTREAM_UNAVAILABLE", "真实飞书登录需要配置 AD_FEISHU_APP_ID / AD_FEISHU_APP_SECRET。");
      if (!opts.redirectUri)
        throw new ApiError(
          "UPSTREAM_UNAVAILABLE",
          "真实飞书扫码登录需要在飞书开放平台配置回调地址（AD_FEISHU_REDIRECT_URI），并在后台把该地址加入重定向 URL 白名单。",
        );
      const state = `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      run(`INSERT INTO tbl_qrcode (state, scan_status, expires_at, created_at) VALUES (?,?,?,?)`,
        state, "pending_scan", new Date(Date.now() + EXPIRES_SECONDS * 1000).toISOString(), nowIso());
      // 授权 scope：**默认沿用历史那 5 个**（老应用配置过）；`AD_FEISHU_LOGIN_SCOPE=`（显式空）
      // 则不传 scope —— 应用没开通 user 类型权限时，**请求未被授予的 scope 会让授权页直接失败**。
      const loginScope = (process.env.AD_FEISHU_LOGIN_SCOPE
        ?? "contact:user.base:readonly docx:document:readonly drive:drive:readonly wiki:wiki:readonly sheets:spreadsheet:readonly").trim();
      const url = `${AUTH_BASE}/authen/v1/authorize?client_id=${encodeURIComponent(appId)}`
        + `&redirect_uri=${encodeURIComponent(opts.redirectUri)}`
        + `&state=${encodeURIComponent(state)}`
        + (loginScope ? `&scope=${encodeURIComponent(loginScope)}` : "");
      return { qrcode_url: url, expires_in_seconds: EXPIRES_SECONDS, state };
    },

    async scanStatus(state: string) {
      const row = get<{ scan_status: string; expires_at: string }>(
        `SELECT scan_status, expires_at FROM tbl_qrcode WHERE state = ?`, state);
      if (!row) throw new ApiError("NOT_FOUND", "二维码已过期。");
      if (row.scan_status !== "confirmed" && row.expires_at < nowIso())
        throw new ApiError("NOT_FOUND", "二维码已过期。");
      return row.scan_status as ScanStatus;
    },

    /** 回调里换取的用户身份（`#64` 用它建档） */
    takeIdentity(state: string): FeishuIdentity | null {
      const row = get<{ identity_json: string | null }>(
        `SELECT identity_json FROM tbl_qrcode WHERE state = ?`, state);
      if (!row?.identity_json) return null;
      try { return JSON.parse(row.identity_json) as FeishuIdentity; } catch { return null; }
    },

    /** 授权码换用户令牌 → 拉用户信息（真机扫码回调走这里） */
    async completeLogin(state: string, code: string): Promise<FeishuIdentity> {
      const res = await fetchWithTimeout(`${BASE}/authen/v2/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          grant_type: "authorization_code", client_id: appId, client_secret: appSecret,
          code, redirect_uri: opts.redirectUri,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        { code?: number; msg?: string; error?: string; error_description?: string; access_token?: string } | null;
      if (!body || !body.access_token) {
        // 飞书 v2 用 OAuth 风格错误体（`error` / `error_description`），v1 才是 `msg` —— 都读出来，
        // 否则排查时只会看到「无响应」（实测：非法 code 返回 `invalid_grant` + `code:20003`）。
        const why = body?.error_description ?? body?.msg ?? body?.error ?? "无响应";
        throw new ApiError("UPSTREAM_UNAVAILABLE", `飞书换取用户令牌失败（${why}）。`);
      }
      const info = await api<{ data?: { open_id?: string; name?: string; avatar_url?: string } }>(
        "/authen/v1/user_info", { method: "GET" }, body.access_token,
      );
      const d = (info as unknown as { open_id?: string; name?: string; avatar_url?: string }) ?? {};
      if (!d.open_id) throw new ApiError("UPSTREAM_UNAVAILABLE", "飞书没有返回用户标识。");
      const identity: FeishuIdentity = { open_id: d.open_id, nickname: d.name ?? "未命名用户", avatar_url: d.avatar_url ?? "" };
      run(`UPDATE tbl_qrcode SET scan_status='confirmed', identity_json=? WHERE state=?`, JSON.stringify(identity), state);
      return identity;
    },

    simulate() { throw new ApiError("INVALID_ARGUMENT", "真实适配器不支持模拟扫码。"); },

    /** 读云文档 / Wiki / 电子表格 → 分块结果 + Markdown（**部分失败不阻断其余**） */
    async readDocument(link: string): Promise<DocResult> {
      const parsed = parseFeishuLink(link);
      if (!parsed) throw new ApiError("INVALID_ARGUMENT", "这不像飞书云文档链接；请粘贴 docx / 云文档 / 表格 / Wiki 链接。");
      let { kind, token } = parsed;
      if (kind === "wiki") {
        const node = await api<{ node?: { obj_type?: string; obj_token?: string; title?: string } }>(
          `/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`,
        );
        const t = node.node?.obj_type;
        if (t !== "docx" && t !== "doc" && t !== "sheet")
          throw new ApiError("FORMAT_UNSUPPORTED", `暂不支持这种 Wiki 节点类型（${t ?? "未知"}），请改用文档 / 表格链接。`);
        kind = t === "sheet" ? "sheet" : "docx";
        token = node.node?.obj_token ?? token;
      }
      if (kind === "docx" || kind === "doc") return readDocx(token);
      if (kind === "sheet") {
        const info = await api<{ properties?: { title?: string } }>(`/sheets/v3/spreadsheets/${token}`);
        const title = info.properties?.title ?? "飞书表格";
        const md = await readSheetAsMarkdown(token, 200);
        return {
          title,
          parts: {
            body: md.trim() ? { status: "ok", chars: [...md].length } : { status: "skipped" },
            tables: md.trim() ? [{ token: "sheet_1", status: "ok" }] : [],
            whiteboards: [], attachments: [],
          },
          markdown: `# ${title}\n\n${md}`.trim(),
        };
      }
      throw new ApiError("FORMAT_UNSUPPORTED", `暂不支持这种飞书文档类型（${kind}），请改用文档 / 表格链接。`);
    },
  } as FeishuAdapter & {
    takeIdentity(state: string): FeishuIdentity | null;
    completeLogin(state: string, code: string): Promise<FeishuIdentity>;
  };
}

/** 开发适配器：结构真实、不联网；扫码状态由显式接口推进（**状态落 `tbl_qrcode`**，可跨重启） */
export function createMockAdapter(): FeishuAdapter {
  let n = 0;

  return {
    kind: "mock",
    async createQrcode() {
      n += 1;
      const state = `st_dev_${Date.now().toString(36)}${n}`;
      run(`INSERT INTO tbl_qrcode (state, scan_status, expires_at, created_at) VALUES (?,?,?,?)`,
        state, "pending_scan", new Date(Date.now() + EXPIRES_SECONDS * 1000).toISOString(), nowIso());
      // 开发环境给一个**可被前端渲染的占位二维码**（内联 SVG data URL，无外链 —— 脱敏要求）
      const rects: string[] = [];
      for (let y = 0; y < 24; y += 1) {
        for (let x = 0; x < 24; x += 1) {
          if (((x * 7 + y * 13) % 5) < 2) {
            rects.push(`<rect x="${x * 7}" y="${y * 7}" width="7" height="7"/>`);
          }
        }
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">`
        + `<rect width="180" height="180" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
      return {
        qrcode_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        expires_in_seconds: EXPIRES_SECONDS,
        state,
      };
    },
    async scanStatus(state: string) {
      const row = get<{ scan_status: ScanStatus; expires_at: string }>(
        `SELECT scan_status, expires_at FROM tbl_qrcode WHERE state = ?`, state,
      );
      if (!row) throw new ApiError("NOT_FOUND", "二维码已过期。");
      if (row.expires_at < nowIso()) {
        run(`UPDATE tbl_qrcode SET scan_status = 'expired' WHERE state = ?`, state);
        return "expired";
      }
      return row.scan_status;
    },
    async simulate(state: string, next: "scanned" | "confirmed") {
      const row = get<{ scan_status: ScanStatus }>(`SELECT scan_status FROM tbl_qrcode WHERE state = ?`, state);
      if (!row) throw new ApiError("NOT_FOUND", "二维码已过期。");
      run(`UPDATE tbl_qrcode SET scan_status = ? WHERE state = ?`, next, state);
      return next === "confirmed" ? { open_id: "ou_dev_user", nickname: "演示用户", avatar_url: "" } : null;
    },
    async readDocument(link: string) {
      // 开发适配器：按链接确定性地产出一份「部分成功」的解析结果（1 个失败块）
      const title = link.includes("whiteboard") ? "含白板图的文档" : "飞书云文档（开发适配器）";
      return {
        title,
        parts: {
          body: { status: "ok", chars: 3180 },
          tables: [{ token: "tbl_dev_1", status: "ok" }, { token: "tbl_dev_2", status: "failed" }],
          whiteboards: link.includes("whiteboard")
            ? [{ token: "wb_dev_1", status: "ok" }]
            : [{ token: "wb_dev_1", status: "skipped" }],
          attachments: [{ name: "流程图.png", status: "ok" }],
        },
        markdown: `# ${title}\n\n> 由**开发适配器**产出；接入真实飞书应用后，这里会是云文档正文。\n\n## 1 背景\n\n（正文…）\n`,
      };
    },
  };
}

/**
 * **登录**用的适配器：只有配了**应用凭据**（`AD_FEISHU_APP_ID`/`SECRET`）才是真实实现 ——
 * 扫码登录必须由平台应用发起，个人令牌做不到代他人登录。
 * 未配置时用开发实现（扫码由 `/simulate` 推进），保证本地 UI 流程可跑通。
 */
export function createFeishuLoginAdapter(): FeishuAdapter {
  const id = process.env.AD_FEISHU_APP_ID ?? "";
  const secret = process.env.AD_FEISHU_APP_SECRET ?? "";
  if (id && secret) return createRealAdapter(id, secret, { redirectUri: process.env.AD_FEISHU_REDIRECT_URI ?? "" });
  return createMockAdapter();
}

/**
 * **读云文档**用的适配器：应用凭据**或**用户令牌都能读 ——
 * 用户令牌模式（`AD_FEISHU_USER_TOKEN`）用于本地联调：以当前用户身份读他有权限的文档。
 * ⚠️ 个人令牌不是平台应用凭据，**不要用于生产**。
 */
export function createFeishuDocAdapter(): FeishuAdapter {
  const id = process.env.AD_FEISHU_APP_ID ?? "";
  const secret = process.env.AD_FEISHU_APP_SECRET ?? "";
  const userToken = process.env.AD_FEISHU_USER_TOKEN ?? "";
  if ((id && secret) || userToken)
    return createRealAdapter(id, secret, { userToken, redirectUri: process.env.AD_FEISHU_REDIRECT_URI ?? "" });
  return createMockAdapter();
}

/** 兼容入口：默认按**登录**场景选择（旧调用方语义不变） */
export function createFeishuAdapter(): FeishuAdapter {
  return createFeishuDocAdapter();
}
