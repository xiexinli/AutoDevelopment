/**
 * 内置 Mock 后端 —— **严格按 `接口契约.md` 的响应包、错误码、幂等与乐观锁语义**实现。
 * 后端未就绪时前端可真实跑通交互；后端就绪后设 `VITE_USE_MOCK=0` 切换。
 *
 * 覆盖接口：
 *   #63/#64/#65/#66  认证与用户       #1~#6    项目
 *   #10/#11/#12/#13/#14/#15  上传与解析
 *   #16~#23 门禁审核 / 待澄清 / 假设   #24      门禁标准（项目级）
 *   #28/#29 拆解                     #59      埋点方案
 *   #67 追溯矩阵                     #68      外发大模型开关
 *   #69 导出审核报告
 */

import type { ApiEnvelope, ErrorCode } from "./client";

interface MockReq {
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  formData?: FormData;
}

// ---------- 类型 ----------
interface ProjectRow {
  project_id: string; name: string; description: string; stage: string;
  owner_user_id: string; depth: "minimal" | "standard" | "comprehensive";
  /** PRD 审核分级（2026-10-28 定稿） */
  review_level: "quick" | "standard" | "strict"; review_extended: boolean;
  updated_at: string; created_at: string; deleted_at: string | null;
  version: number; element_id_seq: Record<string, number>;
  current_revision_id?: string;
}
interface RevisionRow {
  revision_id: string; document_id: string; parse_status: "pending" | "parsing" | "succeeded" | "partial" | "failed";
  empty_document: boolean; created_at: string;
  parts: {
    body: { status: "ok" | "failed" | "skipped"; chars?: number };
    tables: { token: string; status: "ok" | "failed" | "skipped" }[];
    whiteboards: { token: string; status: "ok" | "failed" | "skipped" }[];
    attachments: { name: string; status: "ok" | "failed" | "skipped" }[];
  };
  manual: Record<string, string>;
}
interface ReviewRow {
  review_id: string; project_id: string; revision_id: string; standard_version: number;
  verdict: "running" | "passed" | "blocked" | "failed"; superseded: boolean;
  /** 本次审核使用的等级 + 是否超严扩展（结论随等级而变） */
  review_level: "quick" | "standard" | "strict"; review_extended: boolean;
  counts: { blocking: number; major: number; suggestion: number };
  items: { item_code: string; group: string; level: "blocking" | "major" | "suggestion";
           verdict: "pass" | "fail" | "na"; evidence_ref: string; suggestion: string; accepted: boolean }[];
  questions: { question_code: string; level: "blocking" | "major" | "suggestion"; title: string;
               options: string[]; fallback: string; impact: string; answer: string; status: "open" | "answered" }[];
  assumptions: { assumption_code: string; content: string; source_tag: string;
                 choice: "unset" | "accept" | "convert" }[];
  started_at: number;
}

const now = () => new Date().toISOString();
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

// ---------- 状态 ----------
const db = {
  users: { u_demo: { user_id: "u_demo", nickname: "演示用户", avatar_url: "", role: "requester" as const } },
  projects: [] as ProjectRow[],
  revisions: [] as RevisionRow[],
  reviews: [] as ReviewRow[],
  qrcodes: new Map<string, { state: string; expires_at: number; scan_status: string; created_at: number }>(),
  idem: new Map<string, ApiEnvelope<unknown>>(),
  tokens: new Set<string>(JSON.parse(localStorage.getItem("ad.mock.tokens") ?? "[]") as string[]),
  gateStandard: { standard_id: "gs_1", version: 3, is_current: true,
    items: ["A 需求完整性", "B 状态穷举与迁移", "C 数据与字段", "D 页面级元素与文案",
            "E 平台接口契约", "F 角色与权限", "G 生成与验证", "H 角落收敛", "I 假设集中确认"]
      .map((t, i) => ({ code: `${"ABCDEFGHI"[i]}1`, level: i < 3 ? "blocking" : "major", title: t })) },
  egress: { egress_enabled: true, policy_text:
    "平台会把你的 PRD 正文与生成的业务代码发送给第三方大模型，用于审核、拆解与代码生成。",
    disabled_reason: "", consent_acknowledged_at: null as string | null },
  aborted: false,
  splitProjects: new Set<string>(["p_0001"]),
  drafts: new Map<string, { tree: unknown[]; id_base: Record<string, number>; updated_at: string }>(),
  idLedger: [] as { element_id: string; alias: string; status: "active" | "void"; voided_at: string | null }[],
  tasks: new Map<string, { task_id: string; type: string; status: string; progress: number; seq: number; error_code: string | null; started_at: number; taskKind: string }>(),
  // ---- S4 ----
  apis: [] as { api_id: string; project_id: string; code: string; name: string; method: string; path: string;
    status: "draft" | "effective" | "deprecated"; updated_at: string; version: number;
    fields: { name: string; field_type: string; required: boolean; length: number | null; precision: number | null; unit: string; description: string }[];
    deleted: boolean; revision: number }[],
  versions: [] as { version_id: string; project_id: string; seq: number; status: "current" | "superseded" | "rolled_back" | "archived";
    created_by: string; created_by_name: string; created_at: string;
    summary: string; artifacts: string[] }[],
  capabilities: new Map<string, { items: { capability: string; name: string; description: string; note: string; enabled: boolean; code_status: string }[]; version: number }>(),
  specs: new Map<string, { spec_id: string; project_id: string; role: string; role_order: number; status: string;
    stale: boolean; change_point: string | null; error_code: string | null; content_md: string; version: number; updated_at: string }>(),
  chat: new Map<string, { message_id: string; seq: number; role: "user" | "assistant"; content: string;
    created_at: string; status: "sent" | "failed" }[]>(),
  // ---- S5：知识库（**只含本项目内容**） ----
  kbDocs: [] as { kb_doc_id: string; project_id: string; title: string; sector: "prd" | "spec" | "glossary" | "domain";
    origin: "agent_extracted" | "user_edited" | "user_uploaded"; content_md: string;
    version: number; updated_at: string | null }[],
};

function seed() {
  if (db.projects.length) return;
  const base = Date.now();
  const mk = (n: number, name: string, stage: string, minutesAgo: number, depth: ProjectRow["depth"]): ProjectRow => ({
    project_id: `p_${String(n).padStart(4, "0")}`, name, description: "", stage,
    owner_user_id: "u_demo", depth, review_level: "standard", review_extended: false,
    created_at: new Date(base - minutesAgo * 60_000 * 10).toISOString(),
    updated_at: new Date(base - minutesAgo * 60_000).toISOString(),
    deleted_at: null, version: 1, element_id_seq: {},
  });
  db.projects.push(mk(1, "点餐 App", "gate_passed", 3, "standard"), mk(2, "内部工单系统", "created", 180, "standard"));
  // 预置一条「已解析（partial）」的 revision，便于直接看审核页
  const rev: RevisionRow = {
    revision_id: "rev_demo_0001", document_id: "doc_demo_0001", parse_status: "partial", empty_document: false,
    created_at: new Date(base - 20 * 60_000).toISOString(),
    parts: {
      body: { status: "ok", chars: 12400 },
      tables: [{ token: "tbl_1", status: "ok" }, { token: "tbl_2", status: "failed" }],
      whiteboards: [{ token: "wb_1", status: "skipped" }],
      attachments: [{ name: "流程图.png", status: "ok" }],
    },
    manual: {},
  };
  db.revisions.push(rev);
  db.projects[0].current_revision_id = rev.revision_id;

  // ---- S4 预置：被开发项目的接口定义（与「平台自身接口」是两套） ----
  const mkApi = (n: number, code: string, name: string, method: string, path: string,
    status: "draft" | "effective" | "deprecated", minutesAgo: number, fields: typeof db.apis[number]["fields"]) => ({
    api_id: `api_${String(n).padStart(4, "0")}`, project_id: "p_0001", code, name, method, path, status,
    updated_at: new Date(base - minutesAgo * 60_000).toISOString(), version: 1, fields, deleted: false, revision: 1,
  });
  db.apis.push(
    mkApi(1, "订单查询", "查询订单列表", "GET", "/v1/orders", "effective", 12, [
      { name: "page", field_type: "int", required: false, length: null, precision: null, unit: "页", description: "页码，从 1 开始" },
      { name: "status", field_type: "string", required: false, length: 16, precision: null, unit: "", description: "订单状态" },
    ]),
    mkApi(2, "订单创建", "创建订单", "POST", "/v1/orders", "draft", 40, [
      { name: "items", field_type: "array", required: true, length: null, precision: null, unit: "", description: "商品明细" },
      { name: "amount", field_type: "double", required: true, length: 10, precision: 2, unit: "元", description: "订单金额" },
    ]),
    mkApi(3, "订单取消", "取消订单", "DELETE", "/v1/orders/{id}", "deprecated", 260, [
      { name: "id", field_type: "long", required: true, length: null, precision: null, unit: "", description: "订单号" },
    ]),
  );

  // ---- S4 预置：版本（v1 current、v2 已归档） ----
  /** 版本快照的**5 项范围**（`#55`）：只列实际含内容的产物 */
  const arts = (o: Partial<Record<string, boolean>> = {}) => [
    ...(o.Spec ?? true ? ["spec"] : []),
    ...(o["接口定义"] ?? true ? ["apis"] : []),
    ...(o["能力配置"] ?? false ? ["capabilities"] : []),
    ...(o["安卓代码"] ?? true ? ["android_code"] : []),
    ...(o["埋点方案"] ?? false ? ["tracking_plan"] : []),
  ];
  db.versions.push(
    { version_id: "v_0002", project_id: "p_0001", seq: 2, status: "current",
      created_by: "u_demo", created_by_name: "演示用户", created_at: new Date(base - 30 * 60_000).toISOString(),
      summary: "新增 3 个接口，更新 1 份 Spec。", artifacts: arts() },
    { version_id: "v_0001", project_id: "p_0001", seq: 1, status: "superseded",
      created_by: "u_demo", created_by_name: "演示用户", created_at: new Date(base - 26 * 3600_000).toISOString(),
      summary: "首个版本：五份 Spec 与安卓代码骨架。", artifacts: arts({ 接口定义: false }) },
  );

  // ---- S4 预置：五份 Spec（含 1 份失败、1 份过期，便于看部分成功态） ----
  const specMd = (role: string) => `# ${role} Spec\n\n> 由 AutoDevelopment 平台生成（演示数据）。\n\n## 1 范围\n\n本份覆盖 ${role} 角色的需求条目。\n\n## 2 详细设计\n\n| 编号 | 说明 |\n|---|---|\n| ${role}-001 | 演示条目一 |\n| ${role}-002 | 演示条目二 |\n\n## 3 自检\n\n- [x] 编号唯一\n- [x] 与接口契约一致\n`;
  ([["ui", "UI"], ["api", "接口"], ["app", "App"], ["track", "埋点"], ["test", "测试"]] as const).forEach(([role, label], i) => {
    const id = `sp_${role}`;
    const status = role === "track" ? "failed" : role === "test" ? "stale" : "succeeded";
    db.specs.set(id, { spec_id: id, project_id: "p_0001", role, role_order: i + 1, status,
      stale: role === "test", change_point: role === "test" ? "§F13 生成流程重试上限" : null,
      error_code: role === "track" ? "UPSTREAM_TIMEOUT" : null, content_md: specMd(label),
      version: 1, updated_at: new Date(base - 20 * 60_000).toISOString() });
  });

  // ---- S5 预置：知识库（四分区各若干篇；含一条「你编辑过」与一条「你上传的」） ----
  const kb = (n: number, sector: typeof db.kbDocs[number]["sector"], title: string,
    origin: typeof db.kbDocs[number]["origin"], minutesAgo: number, content_md: string) => ({
    kb_doc_id: `kb_${String(n).padStart(4, "0")}`, project_id: "p_0001", title, sector, origin,
    content_md, version: 1, updated_at: new Date(base - minutesAgo * 60_000).toISOString(),
  });
  db.kbDocs.push(
    kb(1, "prd", "点餐 App · 产品需求文档", "agent_extracted", 90,
      "# 点餐 App · 产品需求文档\n\n> 平台抽取（PRD 正文）。\n\n## 1 背景\n\n门店排队点餐效率低。\n\n## 2 主流程\n\n1. 扫码进店\n2. 选菜下单\n3. 支付\n\n## 3 关键字段\n\n| 字段 | 类型 | 说明 |\n|---|---|---|\n| order_id | string | 订单号 |\n| amount | double | 金额（元） |\n"),
    kb(2, "prd", "点餐 App · 补充说明（人工）", "user_uploaded", 60,
      "# 补充说明\n\n- 支持**堂食**与**自取**两种取餐方式。\n- 下单后 15 分钟内可取消。\n"),
    kb(3, "spec", "UI-Spec（节选）", "agent_extracted", 45,
      "# UI-Spec（节选）\n\n## 4.2 项目列表\n\n| 元素 ID | 元素名 |\n|---|---|\n| EL-PROJ-001 | 页面标题 |\n| EL-PROJ-002 | 新建按钮 |\n"),
    kb(4, "glossary", "术语表", "user_edited", 30,
      "# 术语表\n\n| 术语 | 含义 |\n|---|---|\n| 断点 | 生成任务被中断的状态 |\n| 角落 | 组件 × 条件面的交叉场景 |\n"),
    kb(5, "domain", "领域模型", "agent_extracted", 20,
      "# 领域模型\n\n- `Project` 1—N `Page`\n- `Page` 1—N `Element`\n- `Element` 1—1 `StyleProps`\n"),
  );

  // ---- S5 预置：对话（含一条失败消息，便于看 `这条没发出去。` + `重发`） ----
  db.chat.set("p_0001", [
    { message_id: "msg_0001", seq: 1, role: "user", content: "把下单流程里的取消时限改成 10 分钟。", created_at: new Date(base - 26 * 60_000).toISOString(), status: "sent" },
    { message_id: "msg_0002", seq: 2, role: "assistant", content: "已记录，会并入下一轮生成。\n\n- 影响 `§2 主流程` 第 3 步\n- 关联接口 `POST /v1/orders` 的 `cancel_window` 字段", created_at: new Date(base - 25 * 60_000).toISOString(), status: "sent" },
    { message_id: "msg_0003", seq: 3, role: "user", content: "再加一个「开发票」入口。", created_at: new Date(base - 12 * 60_000).toISOString(), status: "failed" },
  ]);
}
seed();

// ---------- 工具 ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = <T,>(data: T): ApiEnvelope<T> => ({ code: "OK", message: "", data, request_id: uid("req") });
const fail = (code: ErrorCode, message: string, data: unknown = null): ApiEnvelope<never> =>
  ({ code, message, data, request_id: uid("req") }) as ApiEnvelope<never>;

function persistTokens() {
  try { localStorage.setItem("ad.mock.tokens", JSON.stringify([...db.tokens])); } catch { /* ignore */ }
}

function authed(headers: Record<string, string>) {
  const h = headers.Authorization ?? headers.authorization ?? "";
  return h.startsWith("Bearer ") && db.tokens.has(h.slice(7));
}
function parseUrl(url: string) {
  const [path, search = ""] = url.split("?");
  return { path, params: new URLSearchParams(search) };
}

// ---------- 审核数据生成 ----------
const GROUP_TITLES: Record<string, string> = {
  A: "需求完整性", B: "状态穷举与迁移", C: "数据与字段", D: "页面级元素与文案",
  E: "平台接口契约", F: "角色与权限", G: "生成与验证", H: "角落收敛", I: "假设集中确认",
};
function makeReview(projectId: string, revisionId: string, level: "quick" | "standard" | "strict" = "standard"): ReviewRow {
  const items: ReviewRow["items"] = [];
  // 简审档：只两项专项（可实现性 / 内部一致性），不套 14 项表
  if (level === "quick") {
    for (const [code, ev] of [["Q1", "§3 主流程 / 一句话说明"], ["Q2", "§2 背景 / §4 范围与目标"]] as [string, string][]) {
      items.push({ item_code: code, group: "Q", level: "blocking", verdict: "pass", evidence_ref: ev, suggestion: "", accepted: false });
    }
    return {
      review_id: uid("rv"), project_id: projectId, revision_id: revisionId, standard_version: db.gateStandard.version,
      verdict: "passed", superseded: false, review_level: "quick", review_extended: false,
      counts: { blocking: 0, major: 0, suggestion: 0 },
      items, questions: [], assumptions: [], started_at: Date.now(),
    };
  }
  const plan: [string, "blocking" | "major" | "suggestion", "pass" | "fail" | "na", string][] = [
    ["A1", "blocking", "pass", "§2 一句话 / §3 主流程"], ["A2", "blocking", "pass", "§4 分期规划"],
    ["A3", "major", "pass", "§F1 新建项目"], ["B1", "blocking", "pass", "§7 状态机"],
    ["B2", "blocking", "fail", "§7 状态机 · 迁移条件缺失"], ["B3", "major", "pass", "§7 无孤立状态"],
    ["C1", "blocking", "pass", "§8 数据字段"], ["C2", "major", "pass", "§F14 属性面板"],
    ["D1", "major", "fail", "§8 页面级元素构成"], ["D2", "major", "pass", "§8 逐字文案"],
    ["E1", "blocking", "pass", "§9 接口契约"], ["F1", "blocking", "pass", "§9 角色权限矩阵"],
    ["G1", "major", "pass", "§F13 生成与 L1 验证"], ["H1", "suggestion", "fail", "角落扫描：组件 × 条件面"],
    ["I1", "suggestion", "na", "假设集中确认"],
  ];
  plan.forEach(([code, level, verdict, ev]) => items.push({
    item_code: code, group: code[0], level, verdict, evidence_ref: ev,
    suggestion: verdict === "fail" ? "补齐该项后再进入拆解。" : "", accepted: false,
  }));
  return {
    review_id: uid("rv"), project_id: projectId, revision_id: revisionId, standard_version: db.gateStandard.version,
    verdict: "blocked", superseded: false, review_level: level, review_extended: false,
    counts: { blocking: 1, major: 2, suggestion: 1 },
    items,
    questions: [
      { question_code: "Q1", level: "blocking", title: "生成失败后的自动重试上限是多少？",
        options: ["3 次", "5 次", "不限", "不自动重试"], fallback: "not_yet_defined",
        impact: "影响 §F13 生成流程与 §9 耗时指标", answer: "", status: "open" },
      { question_code: "Q2", level: "blocking", title: "预览刷新是否有最小间隔（防止抖动）？",
        options: ["无间隔", "≥1s", "≥3s"], fallback: "not_identified",
        impact: "影响 §F9 预览刷新时机", answer: "", status: "open" },
      { question_code: "Q3", level: "major", title: "知识库人工修订是否需要二次确认？",
        options: ["需要", "不需要"], fallback: "none",
        impact: "影响 §F1 知识库编辑", answer: "", status: "open" },
      { question_code: "Q4", level: "suggestion", title: "空态插画是否使用品牌色？",
        options: ["是", "否"], fallback: "not_applicable",
        impact: "视觉细节，不影响验收", answer: "", status: "open" },
    ],
    assumptions: [
      { assumption_code: "假设-A1", content: "平台默认单用户量级 < 100 个项目。", source_tag: "[来源: 推断，待确认]", choice: "unset" },
      { assumption_code: "假设-A2", content: "飞书云文档链接一律按只读方式读取。", source_tag: "[来源: 推断，待确认]", choice: "unset" },
    ],
    started_at: Date.now(),
  };
}

// ---------- 能力配置（7 项固定，默认全关） ----------
const CAP_DEFS = [
  { capability: "push", name: "推送", description: "接入推送 SDK 与初始化代码。" },
  { capability: "apm", name: "性能采集", description: "接入性能采集 SDK 与埋点。" },
  { capability: "crash_report", name: "崩溃上报", description: "接入崩溃上报 SDK 与初始化代码。" },
  { capability: "log_report", name: "日志上报", description: "接入日志上报 SDK 与初始化代码。" },
  { capability: "stats_sdk", name: "统计 SDK", description: "接入统计 SDK 与初始化代码。" },
  { capability: "hardening", name: "加固", description: "接入加固配置与占位说明。" },
  { capability: "privacy_dialog", name: "隐私合规弹窗", description: "生成启动时的隐私政策同意弹窗骨架。" },
].map((c) => ({ ...c, note: "接入代码里预留了占位，请在工程内自行填写；平台不采集任何密钥。" }));
function capDefault() {
  return CAP_DEFS.map((d) => ({ ...d, enabled: false, code_status: "not_generated" as string }));
}
/** 依赖冲突：仅当这两项同时开启时演示一条（**只列冲突项**，结构取自 `#58`） */
function capConflicts(items: { capability: string; enabled: boolean }[]) {
  const on = new Set(items.filter((i) => i.enabled).map((i) => i.capability));
  const conflicts = on.has("apm") && on.has("stats_sdk")
    ? [{ library: "okhttp", version_a: "4.9.3", version_b: "4.11.0" }] : [];
  const alignment_table = conflicts.map((c) => ({ library: c.library, resolved: c.version_b }));
  return { conflicts, alignment_table };
}
function capPayload(pid: string) {
  const rec = db.capabilities.get(pid) ?? { items: capDefault(), version: 1 };
  db.capabilities.set(pid, rec);
  const enabled = rec.items.filter((i) => i.enabled);
  const failed = enabled.filter((i) => i.code_status === "failed").map((i) => ({ capability: i.capability, error_code: "UPSTREAM_UNAVAILABLE" }));
  const gen = enabled.filter((i) => i.code_status === "generated").length;
  const overall = enabled.length === 0 ? "none"
    : failed.length ? (gen ? "partial" : "failed")
    : enabled.some((i) => i.code_status === "partial") ? "partial" : "succeeded";
  return { items: rec.items, overall, failed, ...capConflicts(rec.items), version: rec.version };
}

// ---------- 路由 ----------
export async function mockFetch<T>(url: string, req: MockReq): Promise<ApiEnvelope<T>> {
  await sleep(120 + Math.random() * 200);
  const { path, params } = parseUrl(url);
  const p = path.replace(/^\/api\/v1/, "");
  const M = req.method.toUpperCase();
  const body = (req.body ?? {}) as Record<string, unknown>;
  let out: ApiEnvelope<unknown> = fail("NOT_FOUND", "这个内容已经不在了。");

  // 幂等
  const idemKey = req.headers["Idempotency-Key"] ?? req.headers["idempotency-key"];
  if (idemKey && M !== "GET") {
    const hit = db.idem.get(idemKey);
    if (hit) return hit as ApiEnvelope<T>;
  }
  const done = (v: ApiEnvelope<unknown>) => {
    if (idemKey && M !== "GET" && v.code === "OK") db.idem.set(idemKey, v);
    return v;
  };

  // ===== 公开 =====
  if (p === "/auth/feishu/qrcode" && M === "GET") {
    const state = uid("st");
    db.qrcodes.set(state, { state, expires_at: Date.now() + 120_000, scan_status: "pending_scan", created_at: Date.now() });
    if (db.qrcodes.size > 5) db.qrcodes.delete(db.qrcodes.keys().next().value as string);
    out = ok({ qrcode_url: "data:image/svg+xml;base64," + btoa(qrSvg()), expires_in_seconds: 120, state });
  } else if (/^\/auth\/feishu\/qrcode\/.+/.test(p) && M === "GET") {
    const st = decodeURIComponent(p.split("/").pop()!);
    const rec = db.qrcodes.get(st);
    if (!rec || rec.expires_at < Date.now()) out = fail("NOT_FOUND", "二维码已过期。");
    else {
      const el = Date.now() - rec.created_at;
      rec.scan_status = el > 4500 ? "confirmed" : el > 2500 ? "scanned" : "pending_scan";
      if (rec.scan_status === "confirmed") {
        const token = uid("tk"); db.tokens.add(token); persistTokens();
        out = ok({ scan_status: "confirmed", token });
      } else out = ok({ scan_status: rec.scan_status });
    }
  } else if (p === "/auth/logout" && M === "POST") {
    const h = req.headers.Authorization ?? "";
    if (h.startsWith("Bearer ")) { db.tokens.delete(h.slice(7)); persistTokens(); }
    out = ok(null);
  }
  // ===== 需鉴权 =====
  else if (!authed(req.headers)) out = fail("UNAUTHENTICATED", "登录已过期，已为你保留未提交的内容。");

  else if (p === "/users/me" && M === "GET") out = ok(db.users.u_demo);

  // ---- #68 外发大模型开关 ----
  else if (p === "/users/me/ai-egress" && M === "GET") out = ok({ ...db.egress });
  else if (p === "/users/me/ai-egress" && M === "PUT") {
    if (body.consent_acknowledged === true) db.egress.consent_acknowledged_at = now();
    if (body.egress_enabled !== undefined) {
      db.egress.egress_enabled = Boolean(body.egress_enabled);
      db.egress.disabled_reason = db.egress.egress_enabled ? "" : "你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。";
    }
    out = ok({ ...db.egress });
  }

  // ---- 项目 ----
  else if (p === "/projects" && M === "GET") {
    const q = (params.get("q") ?? "").trim();
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("page_size") ?? 20);
    const sort = params.get("sort") ?? "updated_at:desc";
    if (![20, 50, 100].includes(pageSize)) out = fail("INVALID_ARGUMENT", "每页条数只能是 20 / 50 / 100。");
    else {
      let rows = db.projects.filter((r) => !r.deleted_at);
      if (q) rows = rows.filter((r) => r.name.includes(q));
      rows = [...rows].sort((a, b) =>
        sort.startsWith("name") ? a.name.localeCompare(b.name, "zh")
        : sort.startsWith("created_at") ? b.created_at.localeCompare(a.created_at)
        : b.updated_at.localeCompare(a.updated_at));
      const total = rows.length;
      out = ok({
        items: rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({
          project_id: r.project_id, name: r.name, stage: r.stage,
          updated_at: r.updated_at, created_at: r.created_at, version: r.version })),
        page, page_size: pageSize, total, has_more: page * pageSize < total, sort, failed_parts: [],
      });
    }
  } else if (p === "/projects" && M === "POST") {
    const name = String(body.name ?? "").trim();
    if (!name || [...name].length > 50) out = fail("INVALID_ARGUMENT", "项目名不能为空，长度 1~50。");
    else {
      const row: ProjectRow = { project_id: uid("p"), name, description: String(body.description ?? ""),
        stage: "created", owner_user_id: "u_demo", depth: "standard", review_level: "standard", review_extended: false,
        created_at: now(), updated_at: now(), deleted_at: null, version: 1, element_id_seq: {} };
      db.projects.unshift(row);
      out = ok({ project_id: row.project_id, name: row.name, stage: row.stage, created_at: row.created_at, version: row.version });
    }
  }
  // ---- 上传与解析 ----
  else if (/^\/projects\/[^/]+\/uploads$/.test(p) && M === "POST") {
    const f = req.formData?.get("file") as File | undefined;
    if (!f) out = fail("INVALID_ARGUMENT", "请选择要上传的文件。");
    else if (!/\.(docx|md)$/i.test(f.name)) out = fail("FORMAT_UNSUPPORTED", "暂不支持该格式。请上传 .docx / .md 或飞书云文档链接。");
    else if (f.size > 20 * 1024 * 1024) out = fail("PAYLOAD_TOO_LARGE", `文件超过 20MB（当前 ${(f.size / 1048576).toFixed(1)}MB）。请压缩后重试。`);
    else {
      const docId = uid("doc");
      out = ok({ file_id: uid("f"), document_id: docId, size_bytes: f.size, status: "uploaded", reject_reason: null });
    }
  } else if (/^\/projects\/[^/]+\/documents$/.test(p) && M === "POST") {
    const link = String(body.feishu_token ?? "");
    if (!link) out = fail("INVALID_ARGUMENT", "链接无效或已失效。");
    else out = ok({ document_id: uid("doc"), source_type: "feishu_link" });
  } else if (/^\/documents\/[^/]+\/revisions$/.test(p) && M === "POST") {
    const docId = p.split("/")[2];
    // 演示：文件路径首解析 → partial（含 1 个失败块），可看标黄条
    const mkRev = (): RevisionRow => ({
      revision_id: uid("rev"), document_id: docId, parse_status: "parsing", empty_document: false,
      created_at: now(),
      parts: { body: { status: "ok", chars: 12400 },
        tables: [{ token: "tbl_a", status: "ok" }, { token: "tbl_b", status: "failed" }],
        whiteboards: [{ token: "wb_a", status: "skipped" }],
        attachments: [{ name: "架构图.png", status: "ok" }] },
      manual: {},
    });
    const rev = mkRev();
    db.revisions.push(rev);
    out = ok({ task_id: uid("tk"), revision_id: rev.revision_id });
    // 异步把状态推进到 partial
    setTimeout(() => { rev.parse_status = "partial"; }, 1800);
  } else if (/^\/documents\/[^/]+\/revisions$/.test(p) && M === "GET") {
    const docId = p.split("/")[2];
    out = ok({ items: db.revisions.filter((r) => r.document_id === docId).map((r) => ({
      revision_id: r.revision_id, document_id: r.document_id, parse_status: r.parse_status, created_at: r.created_at })) });
  } else if (/^\/revisions\/[^/]+\/parse-result$/.test(p) && M === "GET") {
    const rid = p.split("/")[2];
    const r = db.revisions.find((x) => x.revision_id === rid);
    out = r ? ok({ parse_status: r.parse_status, empty_document: r.empty_document, parts: r.parts }) : fail("NOT_FOUND", "这个内容已经不在了。");
  } else if (/^\/revisions\/[^/]+\/parts\/[^/]+\/manual-supplement$/.test(p) && M === "POST") {
    const seg = p.split("/");
    const r = db.revisions.find((x) => x.revision_id === seg[2]);
    if (!r) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else { r.manual[seg[4]] = String(body.content ?? ""); out = ok({ part_key: seg[4], supplemented: true }); }
  }
  // ---- 审核 ----
  else if (/^\/revisions\/[^/]+\/reviews$/.test(p) && M === "POST") {
    const rid = p.split("/")[2];
    const proj = db.projects.find((x) => x.current_revision_id === rid) ?? db.projects[0];
    // 与真后端同口径：不带 `force` 且「同 revision + 同等级」已有终态报告 → 复用（不新建、不重跑）
    const force = (req.body as { force?: boolean } | undefined)?.force === true;
    const asked = (req.body as { level?: string } | undefined)?.level;
    const level = (asked === "quick" || asked === "strict" ? asked : asked === "standard" ? "standard" : proj.review_level ?? "standard") as "quick" | "standard" | "strict";
    const existing = db.reviews.find((x) => x.revision_id === rid && x.verdict !== "running" && x.review_level === level);
    if (!force && existing) {
      out = ok({ review_id: existing.review_id, task_id: null, standard_version: existing.standard_version, level, reused: true });
    } else {
      const rv = makeReview(proj.project_id, rid, level);
      rv.verdict = "running";
      db.reviews.forEach((x) => { if (x.review_id !== rv.review_id) x.superseded = true; });
      db.reviews.unshift(rv);
      proj.review_level = level;
      out = ok({ review_id: rv.review_id, task_id: uid("tk"), standard_version: rv.standard_version, level, reused: false });
      setTimeout(() => {
        rv.verdict = level === "quick" ? "passed" : "blocked";
        proj.stage = rv.verdict === "passed" ? "gate_passed" : "gate_blocked"; proj.updated_at = now();
      }, 2200);
    }
  } else if (/^\/reviews\/[^/]+$/.test(p) && M === "GET") {
    const rv = db.reviews.find((x) => x.review_id === p.split("/")[2]);
    out = rv ? ok({ review_id: rv.review_id, verdict: rv.verdict, counts: rv.counts,
      standard_version: rv.standard_version, superseded: rv.superseded, revision_id: rv.revision_id,
      review_level: rv.review_level, review_extended: rv.review_extended }) : fail("NOT_FOUND", "这个内容已经不在了。");
  } else if (/^\/reviews\/[^/]+\/items$/.test(p) && M === "GET") {
    const rv = db.reviews.find((x) => x.review_id === p.split("/")[2]);
    out = rv ? ok({ items: rv.items.map((i) => ({ ...i, group_title: GROUP_TITLES[i.group] ?? i.group })) }) : fail("NOT_FOUND", "这个内容已经不在了。");
  } else if (/^\/reviews\/[^/]+\/questions$/.test(p) && M === "GET") {
    const rv = db.reviews.find((x) => x.review_id === p.split("/")[2]);
    out = rv ? ok({ items: rv.questions }) : fail("NOT_FOUND", "这个内容已经不在了。");
  } else if (/^\/questions\/[^/]+\/answers$/.test(p) && M === "POST") {
    const code = p.split("/")[2];
    const rv = db.reviews.find((x) => x.questions.some((q) => q.question_code === code));
    const q = rv?.questions.find((x) => x.question_code === code);
    const ans = String(body.answer ?? "").trim();
    if (!q) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else if (!ans) out = fail("INVALID_ARGUMENT", "请先填写答复。");
    else { q.answer = ans; q.status = "answered"; out = ok({ question_code: code, status: "answered" }); }
  } else if (/^\/reviews\/[^/]+\/assumptions$/.test(p) && M === "GET") {
    const rv = db.reviews.find((x) => x.review_id === p.split("/")[2]);
    out = rv ? ok({ items: rv.assumptions }) : fail("NOT_FOUND", "这个内容已经不在了。");
  } else if (/^\/reviews\/[^/]+\/assumptions$/.test(p) && M === "POST") {
    const rv = db.reviews.find((x) => x.review_id === p.split("/")[2]);
    const code = String(body.assumption_code ?? "");
    const choice = String(body.choice ?? "");
    const a = rv?.assumptions.find((x) => x.assumption_code === code);
    if (!a) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else if (choice === "unset") out = fail("INVALID_ARGUMENT", "假设必须选择 accept 或 convert。");
    else { a.choice = choice as "accept" | "convert"; out = ok({ assumption_code: code, choice }); }
  } else if (/^\/reviews\/[^/]+\/accept-candidates$/.test(p) && M === "POST") {
    const rv = db.reviews.find((x) => x.review_id === p.split("/")[2]);
    const codes = (body.item_codes as string[]) ?? [];
    if (!rv) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else { rv.items.forEach((i) => { if (codes.includes(i.item_code)) i.accepted = true; }); out = ok({ accepted_items_count: codes.length }); }
  } else if (/^\/reviews\/[^/]+\/writeback$/.test(p) && M === "POST") {
    if (body.confirm !== true) out = fail("INVALID_ARGUMENT", "回写需要显式确认。");
    else out = ok({ deleted_lines: 0, modified_lines: 0, snapshot: true });
  } else if (/^\/projects\/[^/]+\/reviews\/[^/]+\/export$/.test(p) && M === "GET") {
    out = ok({ export_id: uid("exp"), format: "md" });
  }
  // ---- 门禁标准（项目级）----
  else if (/^\/projects\/[^/]+\/gate-standards$/.test(p) && M === "GET") {
    out = ok({ standard_id: db.gateStandard.standard_id, version: db.gateStandard.version,
      is_current: true, items: db.gateStandard.items });
  } else if (/^\/projects\/[^/]+\/gate-standards$/.test(p) && M === "PUT") {
    db.gateStandard.version += 1;
    if (Array.isArray(body.items)) db.gateStandard.items = body.items as typeof db.gateStandard.items;
    out = ok({ standard_id: db.gateStandard.standard_id, version: db.gateStandard.version, is_current: true });
  }
  // ---- 拆解 ----
  else if (/^\/projects\/[^/]+\/splits$/.test(p) && M === "POST") {
    const proj = db.projects.find((x) => x.project_id === p.split("/")[2]);
    if (!proj) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else {
      if (body.depth && ["minimal", "standard", "comprehensive"].includes(String(body.depth))) {
        proj.depth = String(body.depth) as ProjectRow["depth"];
      }
      proj.stage = "splitting"; proj.updated_at = now();
      const id = uid("tk");
      db.tasks.set(id, { task_id:id,type:"split",status:"running",progress:0,seq:1,error_code:null,started_at:Date.now(),taskKind:"split" });
      out = ok({ task_id:id });
      setTimeout(() => { const task=db.tasks.get(id); if(task){task.status="succeeded";task.progress=100;} proj.stage = "spec_ready"; proj.updated_at = now(); db.splitProjects.add(proj.project_id); }, 2000);
    }
  } else if (/^\/projects\/[^/]+\/requirements$/.test(p) && M === "GET") {
    const proj = db.projects.find((x) => x.project_id === p.split("/")[2]);
    if (!proj) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else if (!db.splitProjects.has(proj.project_id)) out = fail("NOT_FOUND", "还没有需求包。");
    else {
    const depth = proj?.depth ?? "standard";
    const packs: Record<string, string[]> = {
      UI: ["REQ-UPLOAD-001", "REQ-REVIEW-001", "REQ-UIEDIT-001", "REQ-UIEDIT-002", "REQ-UIEDIT-003", "REQ-PREVIEW-001"],
      接口: ["REQ-API-001", "REQ-API-002", "REQ-GEN-007", "REQ-NF-003", "REQ-AUTH-004"],
      App: ["REQ-GEN-001", "REQ-GEN-004", "REQ-GEN-005", "REQ-UIEDIT-006", "REQ-PREVIEW-003"],
      埋点: ["REQ-SPLIT-004", "REQ-TRACK-001", "REQ-TRACK-002"],
      测试: ["REQ-SPEC-001", "REQ-GEN-002", "REQ-DELIVER-001"],
    };
    if (depth === "minimal") { packs["埋点"] = []; packs["接口"] = packs["接口"].slice(0, 3); }
    if (depth === "comprehensive") { packs["App"].push("REQ-GEN-009"); packs["测试"].push("REQ-NF-002"); }
    const q = params.get("q") ?? "";
    const rows = Object.entries(packs).map(([role, reqs]) => ({role, reqs:q ? reqs.filter(r=>r.includes(q)):reqs}));
    const page=Number(params.get("page")??1), pageSize=Number(params.get("page_size")??20);
    out = ok({ total:rows.length, requirement_count:rows.reduce((n,r)=>n+r.reqs.length,0), depth,
      items:rows.slice((page-1)*pageSize,page*pageSize),page,page_size:pageSize,has_more:page*pageSize<rows.length,sort:"role:asc",failed_parts:[] });
    }
  }
  // ---- 埋点方案 ----
  else if (/^\/projects\/[^/]+\/tracking-plan$/.test(p) && M === "GET") {
    out = ok({ items: [
      { event_key: "EVT_proj_create_success", trigger_desc: "项目创建成功后", params: ["project_id"], element_id: "EL-PROJ-041" },
      { event_key: "EVT_upload_start", trigger_desc: "点击「开始解析」后", params: ["file_id", "size_mb"], element_id: "EL-UPLOAD-014" },
      { event_key: "EVT_review_verdict", trigger_desc: "审核产出结论后", params: ["verdict", "blocking_count"], element_id: "EL-REVIEW-003" },
      { event_key: "EVT_edit_submit_success", trigger_desc: "提交变更后", params: ["page_id", "element_count"], element_id: "EL-EDIT-037" },
      { event_key: "EVT_gen_task_terminal", trigger_desc: "生成任务终态", params: ["status", "duration_ms"], element_id: "EL-WORK-023" },
    ] });
  }
  // ---- 追溯矩阵 ----
  else if (/^\/projects\/[^/]+\/traceability-matrix$/.test(p) && M === "GET") {
    // 四态由接口给出（`OK`｜`GAP`｜`N/A`｜`Deferred`）；五列**每列必有值**
    const rows: [string, string, string, string, string, string, string, "OK" | "GAP" | "N/A" | "Deferred"][] = [
      ["REQ-PROJ-001", "新建项目", "EL-PROJ-001", "#2", "RT-PROJ-001", "EVT_proj_create_success", "TC-PROJ-001", "OK"],
      ["REQ-UPLOAD-001", "上传 PRD 并解析", "EL-UPLOAD-001", "#10~#14", "RT-UPLOAD-001", "EVT_upload_start", "TC-UPLOAD-001", "OK"],
      ["REQ-REVIEW-001", "门禁审核与评分卡", "EL-REVIEW-001", "#16~#19", "RT-REVIEW-001", "EVT_review_verdict", "TC-REVIEW-001", "OK"],
      ["REQ-SPLIT-002", "自适应深度三档", "EL-SPLIT-001", "#16/#28", "RT-SPLIT-001", "—待填", "TC-SPLIT-002", "GAP"],
      ["REQ-AUTH-007", "增强策略本期不做", "N/A：本轮未分配该角色", "N/A：本轮未分配该角色", "N/A：本轮未分配该角色", "N/A：本轮未分配该角色", "N/A：本轮未分配该角色", "N/A"],
      ["REQ-DESIGN-001", "设计参考（UE）", "EL-PREVIEW-001", "—待填", "—待填", "—待填", "—待填", "Deferred"],
    ];
    const all = rows.map(([req_id, summary, ui, api, app, track, test, coverage_status]) => ({
      req_id, summary, targets: { ui, api, app, track, test }, coverage_status,
      orphan: [ui, api, app, track, test].every((x) => x === "—待填") }));
    const q = params.get("q"); const cs = params.get("coverage_status");
    let filtered = all;
    if (q) filtered = filtered.filter((r) => r.req_id.includes(q));
    if (cs) filtered = filtered.filter((r) => r.coverage_status === cs);
    const page = Number(params.get("page") ?? 1), pageSize = Number(params.get("page_size") ?? 20);
    out = ok({ orphan_count: filtered.filter((r) => r.orphan).length, total_orphan_count: all.filter((r) => r.orphan).length,
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      page, page_size: pageSize, total: filtered.length, has_more: page * pageSize < filtered.length, sort: "req_id:asc", failed_parts: [] });
  }
  // ---- #35 页面列表 ----
  else if (/^\/projects\/[^/]+\/pages$/.test(p) && M === "GET") {
    out = ok({ items: [{ page_id: `pg_${p.split("/")[2]}`, module_code: "HOME", name: "首页", order_index: 0, status: "draft" }] });
  }
  // ---- #41 元素 id 台账 ----
  else if (/^\/projects\/[^/]+\/element-id-ledger$/.test(p) && M === "GET") {
    out = ok({ items: db.idLedger });
  }
  // ---- #42 画布草稿 ----
  else if (/^\/pages\/[^/]+\/draft$/.test(p) && M === "GET") {
    const d = db.drafts.get(p.split("/")[2]);
    out = d ? ok({ ...d }) : fail("NOT_FOUND", "还没有草稿。");
  } else if (/^\/pages\/[^/]+\/draft$/.test(p) && M === "PUT") {
    const pid = p.split("/")[2];
    db.drafts.set(pid, { tree: (body.tree as unknown[]) ?? [], id_base: (body.id_base as Record<string, number>) ?? {}, updated_at: now() });
    out = ok({ updated_at: now() });
  }
  // ---- #43 提交变更 → 生成任务 ----
  else if (/^\/pages\/[^/]+\/generations$/.test(p) && M === "POST") {
    const pageId = p.split("/")[2];
    const proj = db.projects[0];
    if (!db.egress.egress_enabled) {
      out = fail("UPSTREAM_UNAVAILABLE", "你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。");
    } else {
      const running = [...db.tasks.values()].some((t) => t.status === "queued" || t.status === "running");
      const id = uid("tk");
      const seq = Number(body.seq ?? 1);
      db.tasks.set(id, { task_id: id, type: "code_gen", status: "queued", progress: 0, seq,
        error_code: null, started_at: Date.now(), taskKind: "gen" });
      out = ok({ task_id: id, seq });
      // 排队 → 运行 → 成功；若已有在跑则先排队（串行）
      const delay = running ? 2600 : 1200;
      setTimeout(() => { const t = db.tasks.get(id); if (t) { t.status = "running"; t.progress = 40; } }, delay);
      setTimeout(() => { const t = db.tasks.get(id); if (t) { t.status = "running"; t.progress = 80; } }, delay + 600);
      setTimeout(() => { const t = db.tasks.get(id); if (t) { t.status = "succeeded"; t.progress = 100; } }, delay + 1400);
      void pageId;
      void proj;
    }
  }
  // ---- #44 任务状态 / #44a 取消 ----
  else if (/^\/tasks\/[^/]+\/cancel$/.test(p) && M === "POST") {
    const t = db.tasks.get(p.split("/")[2]);
    if (!t) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else if (t.status === "succeeded") out = fail("INVALID_ARGUMENT", "任务已经结束了。");
    else { t.status = "canceled"; t.progress = 0; out = ok({ status: "canceled" }); }
  } else if (/^\/tasks\/[^/]+$/.test(p) && M === "GET") {
    const t = db.tasks.get(p.split("/")[2]);
    out = t ? ok({ task_id: t.task_id, type: t.type, status: t.status, progress: t.progress, seq: t.seq, error_code: t.error_code })
            : fail("NOT_FOUND", "这个内容已经不在了。");
  }
  // ---- #47 产物 / #49 验证证据 ----
  else if (/^\/tasks\/[^/]+\/artifacts$/.test(p) && M === "GET") {
    out = ok({ items: [
      { path: "app/src/main/java/.../MainActivity.kt", kind: "kotlin" },
      { path: "app/src/main/res/layout/activity_main.xml", kind: "xml" },
      { path: "gradle/wrapper/gradle-wrapper.properties", kind: "wrapper" },
      { path: "dependencies.lock.json", kind: "lock" },
    ] });
  } else if (/^\/tasks\/[^/]+\/verifications$/.test(p) && M === "GET") {
    out = ok({ items: [{ verify_id: uid("vf"), layer: "L1", status: "passed", rules: [
      { rule: "Kotlin/XML 语法可解析", ok: true },
      { rule: "结构合法（根布局、父子闭包）", ok: true },
      { rule: "元素 id 与画布元素树一一对应", ok: true },
      { rule: "属性取值在允许域内", ok: true },
      { rule: "引用完整（R.id.*、字符串资源、drawable）", ok: true },
    ] }] });
  }
  // ---- #50~#53 被开发项目的接口定义 ----
  else if (/^\/projects\/[^/]+\/apis$/.test(p) && M === "GET") {
    const pid = p.split("/")[2];
    const q = (params.get("q") ?? "").trim().toLowerCase();
    const st = params.get("status") ?? "";
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("page_size") ?? 20);
    if (![20, 50, 100].includes(pageSize)) out = fail("INVALID_ARGUMENT", "每页条数只能是 20 / 50 / 100。");
    else {
      let rows = db.apis.filter((r) => r.project_id === pid && !r.deleted);
      if (q) rows = rows.filter((r) => `${r.code} ${r.name} ${r.path}`.toLowerCase().includes(q));
      if (st) rows = rows.filter((r) => r.status === st);
      rows = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const total = rows.length;
      out = ok({ items: rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r })),
        page, page_size: pageSize, total, has_more: page * pageSize < total, sort: "updated_at:desc", failed_parts: [] });
    }
  } else if (/^\/projects\/[^/]+\/apis$/.test(p) && M === "POST") {
    const pid = p.split("/")[2];
    const code = String(body.code ?? "").trim();
    const name = String(body.name ?? "").trim();
    if (!code || !name) out = fail("INVALID_ARGUMENT", "接口编号与名称不能为空。");
    else if (db.apis.some((a) => a.project_id === pid && a.code === code && !a.deleted))
      out = fail("INVALID_ARGUMENT", "该接口编号已存在。");
    else {
      const created = { api_id: uid("api"), project_id: pid, code, name,
        method: String(body.method ?? "GET"), path: String(body.path ?? ""),
        status: "draft" as const, updated_at: now(), version: 1, fields: [], deleted: false, revision: 1 };
      db.apis.unshift(created);
      out = ok({ ...created });
    }
  } else if (/^\/apis\/[^/]+\/schema$/.test(p) && M === "PUT") {
    const id = p.split("/")[2];
    const row = db.apis.find((a) => a.api_id === id && !a.deleted);
    if (!row) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else {
      const ifMatch = req.headers["If-Match"] ?? req.headers["if-match"];
      if (String(ifMatch ?? "") !== String(row.version)) out = fail("VERSION_CONFLICT", "该接口已被他人修改。", { current_version: row.version });
      else {
        row.fields = (body.fields as typeof row.fields) ?? [];
        row.version += 1; row.updated_at = now();
        out = ok({ api_id: row.api_id, fields: row.fields, version: row.version });
      }
    }
  } else if (/^\/apis\/[^/]+$/.test(p) && M === "GET") {
    const row = db.apis.find((a) => a.api_id === p.split("/")[2] && !a.deleted);
    out = row ? ok({ ...row }) : fail("NOT_FOUND", "这个内容已经不在了。");
  } else if (/^\/apis\/[^/]+$/.test(p) && M === "PATCH") {
    const row = db.apis.find((a) => a.api_id === p.split("/")[2] && !a.deleted);
    if (!row) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else {
      const ifMatch = req.headers["If-Match"] ?? req.headers["if-match"];
      if (String(ifMatch ?? "") !== String(row.version)) out = fail("VERSION_CONFLICT", "该接口已被他人修改。", { current_version: row.version });
      else {
        for (const k of ["code", "name", "method", "path", "status"] as const) {
          if (body[k] !== undefined) (row as unknown as Record<string, unknown>)[k] = body[k];
        }
        row.version += 1; row.updated_at = now();
        out = ok({ ...row });
      }
    }
  } else if (/^\/apis\/[^/]+$/.test(p) && M === "DELETE") {
    const row = db.apis.find((a) => a.api_id === p.split("/")[2] && !a.deleted);
    if (!row) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else { row.deleted = true; row.updated_at = now(); out = ok(null); }
  }
  // ---- #30~#34 五份 Spec ----
  else if (/^\/projects\/[^/]+\/specs:generate$/.test(p) && M === "POST") {
    const pid = p.split("/")[2];
    for (const [, s] of db.specs) { if (s.project_id === pid) { s.status = "generating"; s.error_code = null; } }
    out = ok({ task_id: uid("tk"), overall: "generating" });
    setTimeout(() => {
      for (const [id, s] of db.specs) {
        if (s.project_id !== pid) continue;
        if (s.role === "track") { s.status = "failed"; s.error_code = "UPSTREAM_TIMEOUT"; }
        else { s.status = "succeeded"; s.stale = false; s.change_point = null; s.content_md = s.content_md || `# ${s.role} Spec\n`; }
        s.version += 1; s.updated_at = now();
        void id;
      }
    }, 2400);
  } else if (/^\/projects\/[^/]+\/specs$/.test(p) && M === "GET") {
    const pid = p.split("/")[2];
    const items = [...db.specs.values()].filter((s) => s.project_id === pid);
    items.sort((a, b) => a.role_order - b.role_order);
    const succeeded = items.filter((s) => s.status === "succeeded" || s.status === "stale").map((s) => s.role);
    const failed = items.filter((s) => s.status === "failed").map((s) => ({ role: s.role, error_code: s.error_code ?? "INTERNAL" }));
    const overall = items.length === 0 ? "none"
      : items.some((s) => s.status === "generating") ? "generating"
      : failed.length ? (succeeded.length ? "partial" : "failed") : "succeeded";
    out = ok({ overall, succeeded, failed, items: items.map((s) => ({
      spec_id: s.spec_id, role: s.role, role_order: s.role_order, status: s.status, stale: s.stale,
      change_point: s.change_point, error_code: s.error_code, version: s.version, updated_at: s.updated_at })) });
  } else if (/^\/projects\/[^/]+\/specs\/[^/]+\/proofread$/.test(p) && M === "POST") {
    out = ok({ role: "ui", items: [
      { item_code: "UI-P1", content: "UI Spec 缺少「元素清单」章节。", can_loopback: true },
      { item_code: "UI-P2", content: "UI Spec 缺少「样式」章节。", can_loopback: true },
    ] });
  } else if (/^\/specs\/[^/]+\/export$/.test(p) && M === "GET") {
    const s = db.specs.get(p.split("/")[2]);
    out = s ? ok({ export_id: uid("exp"), format: "md", filename: `${s.role}-Spec.md`, content_md: s.content_md }) : fail("NOT_FOUND", "这个内容已经不在了。");
  } else if (/^\/specs\/[^/]+$/.test(p) && M === "GET") {
    const s = db.specs.get(p.split("/")[2]);
    out = s ? ok({ spec_id: s.spec_id, role: s.role, content_md: s.content_md, status: s.status }) : fail("NOT_FOUND", "这个内容已经不在了。");
  }
  // ---- #58 能力配置 ----
  else if (/^\/projects\/[^/]+\/capabilities$/.test(p) && M === "GET") {
    const pid = p.split("/")[2];
    out = ok(capPayload(pid));
  } else if (/^\/projects\/[^/]+\/capabilities$/.test(p) && M === "PUT") {
    const pid = p.split("/")[2];
    const rec = db.capabilities.get(pid) ?? { items: capDefault(), version: 1 };
    const ifMatch = req.headers["If-Match"] ?? req.headers["if-match"];
    if (String(ifMatch ?? "") !== String(rec.version)) out = fail("VERSION_CONFLICT", "该内容已被他人修改。", { current_version: rec.version });
    else {
      const next = (body.items as { capability: string; enabled: boolean }[]) ?? [];
      const unknown = next.find((n) => !CAP_DEFS.some((d) => d.capability === n.capability));
      if (unknown) out = fail("INVALID_ARGUMENT", "能力只能是固定的 7 项。");
      else {
        const disabling = next.filter((n) => !n.enabled
          && rec.items.find((i) => i.capability === n.capability)?.enabled
          && rec.items.find((i) => i.capability === n.capability)?.code_status !== "not_generated");
        if (disabling.length && body.confirm_disable !== true)
          out = fail("INVALID_ARGUMENT", `取消勾选 ${disabling.length} 项已生成的能力需要二次确认。`);
        else {
          rec.items = rec.items.map((it) => {
            const hit = next.find((n) => n.capability === it.capability);
            const enabled = hit ? hit.enabled : it.enabled;
            return { ...it, enabled, code_status: enabled ? "generated" : it.code_status };
          });
          rec.version += 1;
          db.capabilities.set(pid, rec);
          out = ok(capPayload(pid));
        }
      }
    }
  }
  // ---- #54~#57 版本 ----
  else if (/^\/projects\/[^/]+\/versions$/.test(p) && M === "GET") {
    const pid = p.split("/")[2];
    out = ok({ items: db.versions.filter((v) => v.project_id === pid).sort((a, b) => b.seq - a.seq).map((v) => ({ ...v })) });
  } else if (/^\/projects\/[^/]+\/versions$/.test(p) && M === "POST") {
    const pid = p.split("/")[2];
    const summary = String(body.summary ?? "").trim()
      || `新增 ${db.apis.filter((a) => a.project_id === pid && !a.deleted && a.status === "draft").length} 个接口草稿。`;
    db.versions.forEach((v) => { if (v.project_id === pid && v.status === "current") v.status = "superseded"; });
    const seq = Math.max(0, ...db.versions.filter((v) => v.project_id === pid).map((v) => v.seq)) + 1;
    const row = { version_id: uid("v"), project_id: pid, seq, status: "current" as const,
      created_by: "u_demo", created_by_name: "演示用户", created_at: now(), summary,
      artifacts: ["spec", "apis", ...((db.capabilities.get(pid)?.items ?? []).some((i) => i.enabled) ? ["capabilities"] : []), "android_code"] };
    db.versions.unshift(row);
    out = ok({ version_id: row.version_id, seq: row.seq });
  } else if (/^\/versions\/[^/]+\/diff$/.test(p) && M === "GET") {
    const v = db.versions.find((x) => x.version_id === p.split("/")[2]);
    if (!v) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else out = ok({ version_id: v.version_id, seq: v.seq, diff: [
      { path: "apis/POST /v1/orders", left: "—", right: "字段：items, amount", change: "新增" },
      { path: "apis/GET /v1/orders", left: "字段：status", right: "字段：status, page", change: "修改" },
      { path: "apis/DELETE /v1/orders/{id}", left: "存在", right: "已删除", change: "删除" },
      { path: "specs/UI-Spec.md", left: "上一版内容", right: "本版内容", change: "修改" },
      { path: "tracking/EVT_review_verdict", left: "—", right: "已定义", change: "新增" },
    ] });
  } else if (/^\/versions\/[^/]+\/rollback$/.test(p) && M === "POST") {
    const v = db.versions.find((x) => x.version_id === p.split("/")[2]);
    if (!v) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else {
      if (body.confirm !== true) out = fail("INVALID_ARGUMENT", "回滚需要显式确认。");
      else {
        db.versions.forEach((x) => {
          if (x.project_id !== v.project_id) return;
          if (x.version_id === v.version_id) x.status = "current";
          else if (x.status === "current") x.status = "rolled_back";
        });
        out = ok({ status: "rolled_back", version_id: v.version_id, seq: v.seq });
      }
    }
  }
  // ---- #7~#9 知识库（只含本项目内容） ----
  else if (/^\/projects\/[^/]+\/kb-docs$/.test(p) && M === "GET") {
    const pid = p.split("/")[2];
    const sector = params.get("sector") ?? "";
    const q = (params.get("q") ?? "").trim();
    if ([...q].length > 100) out = fail("INVALID_ARGUMENT", "搜索关键词最多 100 个字符。");
    else {
      let rows = db.kbDocs.filter((d) => d.project_id === pid);
      if (sector) rows = rows.filter((d) => d.sector === sector);
      if (q) rows = rows.filter((d) => d.title.includes(q) || d.content_md.includes(q));
      out = ok({ items: rows.map(({ content_md, ...rest }) => { void content_md; return { ...rest }; }), total: rows.length });
    }
  } else if (/^\/kb-docs\/[^/]+$/.test(p) && M === "GET") {
    const d = db.kbDocs.find((x) => x.kb_doc_id === p.split("/")[2]);
    out = d ? ok({ kb_doc_id: d.kb_doc_id, title: d.title, sector: d.sector, origin: d.origin,
      content_md: d.content_md, version: d.version, updated_at: d.updated_at })
      : fail("NOT_FOUND", "这个内容已经不在了。");
  } else if (/^\/kb-docs\/[^/]+$/.test(p) && M === "PUT") {
    const d = db.kbDocs.find((x) => x.kb_doc_id === p.split("/")[2]);
    if (!d) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else {
      const ifMatch = req.headers["If-Match"] ?? req.headers["if-match"];
      if (String(ifMatch ?? "") !== String(d.version)) out = fail("VERSION_CONFLICT", "该内容已被他人修改。", { current_version: d.version });
      else {
        d.content_md = String(body.content_md ?? "");
        d.origin = "user_edited";
        d.version += 1; d.updated_at = now();
        out = ok({ kb_doc_id: d.kb_doc_id, origin: d.origin, version: d.version, updated_at: d.updated_at });
      }
    }
  }
  // ---- #25/#26/#27 对话（Workbench 右栏；SSE `chat.delta` 在 mock 下退化为轮询） ----
  else if (/^\/projects\/[^/]+\/chat\/messages$/.test(p) && M === "GET") {
    const pid = p.split("/")[2];
    out = ok({ items: db.chat.get(pid) ?? [] });
  } else if (/^\/projects\/[^/]+\/chat\/messages$/.test(p) && M === "POST") {
    const pid = p.split("/")[2];
    const content = String(body.content ?? "").trim();
    if (!content) out = fail("INVALID_ARGUMENT", "先说点什么再发送。");
    else if ([...content].length > 20000) out = fail("INVALID_ARGUMENT", `消息最多 20000 字符，当前 ${[...content].length} 字符。`);
    else {
      const list = db.chat.get(pid) ?? [];
      const seq = list.length ? Math.max(...list.map((m) => m.seq)) + 1 : 1;
      const mid = uid("msg");
      list.push({ message_id: mid, seq, role: "user", content, created_at: now(), status: "sent" });
      db.chat.set(pid, list);
      out = ok({ message_id: mid, seq });
      // 服务端异步产出回复（客户端以轮询/SSE 取回，**流式逐段追加**由字节增长表达）
      const replyAt = Date.now() + 1200;
      void replyAt;
      setTimeout(() => {
        list.push({ message_id: uid("msg"), seq: seq + 1, role: "assistant",
          content: "已记录你的补充，会在下一轮生成时并入。", created_at: now(), status: "sent" });
      }, 1200);
    }
  } else if (/^\/chat\/messages\/[^/]+\/retry$/.test(p) && M === "POST") {
    const mid = p.split("/")[3];
    let hit: { message_id: string; seq: number; status: "sent"; } | null = null;
    for (const [, list] of db.chat) {
      const m = list.find((x) => x.message_id === mid);
      if (m) {
        m.status = "sent";
        const nseq = Math.max(...list.map((x) => x.seq)) + 1;
        list.push({ message_id: uid("msg"), seq: nseq, role: "assistant",
          content: "重发成功，已记录你的补充。", created_at: now(), status: "sent" });
        hit = { message_id: mid, seq: m.seq, status: "sent" };
      }
    }
    out = hit ? ok(hit) : fail("NOT_FOUND", "这个内容已经不在了。");
  }
  // ---- #6 状态条 / #3 详情 / #4 改 / #5 删 ----
  else if (/^\/projects\/[^/]+\/stats$/.test(p) && M === "GET") {
    const row = db.projects.find((r) => r.project_id === p.split("/")[2]);
    if (!row) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else {
      const latest = db.reviews.find((r) => r.project_id === row.project_id && !r.superseded && r.verdict !== "running");
      out = ok({
        stage: row.stage, version_seq: row.version, running_tasks: 0, loopback_round: 1,
        current_revision_id: row.current_revision_id ?? null,
        gate: { verdict: latest?.verdict ?? "unreviewed", blocking_count: latest?.counts.blocking ?? 0,
          major_count: latest?.counts.major ?? 0, review_revision_id: latest?.revision_id ?? null,
          review_level: row.review_level, review_extended: row.review_extended },
      });
    }
  } else if (/^\/projects\/[^/]+$/.test(p) && (M === "GET" || M === "PATCH" || M === "DELETE")) {
    const id = p.split("/")[2];
    const row = db.projects.find((r) => r.project_id === id && !r.deleted_at);
    if (!row) out = fail("NOT_FOUND", "这个内容已经不在了。");
    else if (M === "GET") out = ok({ ...row });
    else if (M === "PATCH") {
      const ifMatch = req.headers["If-Match"] ?? req.headers["if-match"];
      if (String(ifMatch ?? "") !== String(row.version)) out = fail("VERSION_CONFLICT", "该内容已被他人修改。", { current_version: row.version });
      else {
        if (body.name !== undefined) {
          const nm = String(body.name).trim();
          if (!nm || [...nm].length > 50) out = fail("INVALID_ARGUMENT", "项目名不能为空，长度 1~50。");
          else row.name = nm;
        }
        if (body.description !== undefined) row.description = String(body.description);
        row.version += 1; row.updated_at = now();
        if (out.code === "OK" || out.code === "NOT_FOUND") out = ok({ ...row });
      }
    } else {
      // #5 `⬛` 删除：服务端亦须校验显式 `confirm:true`；出参 `{deleted_at}`（对齐契约/`TC-PROJ-019`）
      if (body?.confirm !== true) out = fail("INVALID_ARGUMENT", "删除项目需要显式确认。");
      else { const at = now(); row.deleted_at = at; out = ok({ deleted_at: at }); }
    }
  }

  return done(out) as ApiEnvelope<T>;
}

/** 演示二维码（内联 SVG，无外链 —— 脱敏要求） */
function qrSvg(): string {
  const n = 21, s = 6, cells: string[] = [];
  let seed = 20261021;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const finder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    const on = finder ? (x % 6 === 0 || y % 6 === 0 || (x > 1 && x < 5 && y > 1 && y < 5)) : rnd() > 0.55;
    if (on) cells.push(`<rect x="${x * s}" y="${y * s}" width="${s}" height="${s}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n * s}" height="${n * s}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${cells.join("")}</g></svg>`;
}
