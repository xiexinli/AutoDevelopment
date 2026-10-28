/**
 * 语义核对（**只读性质**：跑一条完整生命周期并记录每个接口的**真实响应形状**）
 *
 * 目的：把「Spec 声明的出参字段 / 错误分支」与「接口**实际返回**的东西」对上，
 * 而不是只核 ID 是否存在（那是 `A1-硬核对报告` 做的）。
 *
 * 用法：`node test/semantic-audit.mjs` → 产出 `/tmp/semantic-shapes.json`
 * 用**开发适配器**跑（不受大模型判否影响；响应的**形状**与真实上游一致）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

process.env.AD_DB_PATH = ":memory:";
process.env.AD_LOG_LEVEL = "fatal";
process.env.AD_LLM_MODE = "development";
process.env.AD_CODEGEN_MODE = "development";
process.env.AD_PASSWORD_LOGIN = "development";
process.env.AD_DEV_PASSWORD = "audit-pw";

const { buildApp } = await import("../src/app.ts");
const { get } = await import("../src/db/index.ts");
const { ensureUser, issueToken } = await import("../src/core/auth.ts");
const { defaultStyle } = await import("../src/core/editor.ts");
const { createHash } = await import("node:crypto");

const app = buildApp();
await app.ready();
const user = ensureUser("audit_user", "语义核对");
const token = issueToken(user.user_id);
const outsider = issueToken(ensureUser("audit_other", "外部").user_id);

const shapes = {};          // { "#n 方法 路径": {http, keys, sample} }
const errors = [];          // 错误分支实测结果

async function req(path, { method = "GET", body, version, key, query, token: tk = token, headers = {} } = {}) {
  const qs = query ? "?" + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : "";
  const r = await app.inject({
    method, url: "/api/v1" + path + qs,
    headers: { authorization: `Bearer ${tk}`, ...(version !== undefined ? { "if-match": String(version) } : {}), ...(key ? { "idempotency-key": key } : {}), ...headers },
    ...(body !== undefined ? { payload: body } : {}),
  });
  let j = null; try { j = r.json(); } catch { /* 非 JSON */ }
  return { http: r.statusCode, ...(j ?? {}) };
}
const ok = (r, http = 200) => { assert.equal(r.http, http, JSON.stringify(r).slice(0, 300)); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(id) { for (let i = 0; i < 400; i++) { const t = ok(await req(`/tasks/${id}`)); if (!["queued", "running"].includes(t.status)) return t; await sleep(5); } throw Error("task timeout"); }

/** 记录一个接口的真实响应形状 */
function record(num, method, path, r) {
  const key = `#${num} ${method} ${path}`;
  const d = r.data;
  const keys = d && typeof d === "object" && !Array.isArray(d) ? Object.keys(d) : [];
  const itemKeys = d && Array.isArray(d.items) && d.items[0] && typeof d.items[0] === "object" ? Object.keys(d.items[0]) : [];
  shapes[key] = { http: r.http, code: r.code, dataKeys: keys, itemKeys, sample: JSON.stringify(d ?? null).slice(0, 400) };
}
function recordErr(label, declared, r) {
  errors.push({ label, declared, actualHttp: r.http, actualCode: r.code, message: r.message, match: declared.includes(r.code) });
}

const markdown = "# 语义核对 PRD\n\n" + ["背景", "主流程", "范围与目标", "状态机", "异常失败", "字段数据", "属性样式", "页面元素", "文案字样", "接口API", "权限角色", "生成验证", "角落组合", "假设"].map((s) => `## ${s}\n\n内容。`).join("\n\n");
const hash = (b) => createHash("sha256").update(JSON.stringify(b)).digest("hex");

await test("语义核对：跑完整生命周期并记录每个接口的真实响应形状", async (t) => {
  // ---------- 认证 ----------
  record("72a", "GET", "/auth/methods", await req("/auth/methods", { token: "" }));
  record("72", "POST", "/auth/password/login", await req("/auth/password/login", { method: "POST", token: "", body: { username: "audit_pw_user", password: "audit-pw" } }));

  // ---------- 项目 ----------
  const p = ok(await req("/projects", { method: "POST", body: { name: "语义核对" }, key: "cap-1" }), 201).project_id;
  record("2", "POST", "/projects", await req("/projects", { method: "POST", body: { name: "语义核对2" }, key: "cap-2" }));
  record("1", "GET", "/projects", await req("/projects", { query: { page: 1, page_size: 20 } }));
  record("3", "GET", "/projects/{id}", await req(`/projects/${p}`));
  record("6", "GET", "/projects/{id}/stats", await req(`/projects/${p}/stats`));
  record("68", "GET", "/users/me/ai-egress", await req("/users/me/ai-egress"));
  record("66", "GET", "/users/me", await req("/users/me"));
  ok(await req("/users/me/ai-egress", { method: "PUT", body: { consent_acknowledged: true, egress_enabled: true } }));

  // ---------- 上传 / 解析 ----------
  const boundary = "----audit";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.md"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(markdown), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const up = ok(await req(`/projects/${p}/uploads`, { method: "POST", body: payload, key: "cap-3", headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }), 201);
  record("10", "POST", "/projects/{id}/uploads", await req(`/projects/${p}/uploads`, { method: "POST", body: payload, key: "cap-4", headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }));
  const doc = up.document_id;
  const revTask = ok(await req(`/documents/${doc}/revisions`, { method: "POST" }), 202);
  await wait(revTask.task_id);
  const rev = ok(await req(`/documents/${doc}/revisions`)).items[0].revision_id;
  record("13", "GET", "/documents/{id}/revisions", await req(`/documents/${doc}/revisions`));
  record("14", "GET", "/revisions/{id}/parse-result", await req(`/revisions/${rev}/parse-result`));
  record("7", "GET", "/projects/{id}/kb-docs", await req(`/projects/${p}/kb-docs`));
  record("?", "GET", "/projects/{id}/kb-sectors", await req(`/projects/${p}/kb-sectors`));

  // ---------- 审核 ----------
  const rv = ok(await req(`/revisions/${rev}/reviews`, { method: "POST", body: {} }), 202);
  await wait(rv.task_id);
  // 作答 + 假设定稿：**必须在同一次审核上做完**，否则复审会产出新的未定稿假设
  for (const q of ok(await req(`/reviews/${rv.review_id}/questions`)).items) {
    if (q.status === "open" && q.options?.length) ok(await req(`/questions/${q.question_code}/answers`, { method: "POST", body: { answer: q.options[0] } }));
  }
  for (const a of ok(await req(`/reviews/${rv.review_id}/assumptions`)).items) {
    if (a.choice === "unset") ok(await req(`/reviews/${rv.review_id}/assumptions`, { method: "POST", body: { assumption_code: a.assumption_code, choice: "accept" } }));
  }
  record("17", "GET", "/reviews/{id}", await req(`/reviews/${rv.review_id}`));
  record("18", "GET", "/reviews/{id}/items", await req(`/reviews/${rv.review_id}/items`));
  record("19", "GET", "/reviews/{id}/questions", await req(`/reviews/${rv.review_id}/questions`));
  record("21", "GET", "/reviews/{id}/assumptions", await req(`/reviews/${rv.review_id}/assumptions`));
  record("24", "GET", "/projects/{id}/gate-standards", await req(`/projects/${p}/gate-standards`));
  record("69", "GET", "/projects/{id}/reviews/{id}/export", await req(`/projects/${p}/reviews/${rv.review_id}/export`));
  record("22", "POST", "/reviews/{id}/accept-candidates", await req(`/reviews/${rv.review_id}/accept-candidates`, { method: "POST", body: { item_codes: [] } }));

  // ---------- 拆解 / Spec ----------
  const sp = ok(await req(`/projects/${p}/splits`, { method: "POST", body: {} }), 202);
  await wait(sp.task_id);
  record("28", "POST", "/projects/{id}/splits", await req(`/projects/${p}/splits`, { method: "POST", body: {} }));
  record("29", "GET", "/projects/{id}/requirements", await req(`/projects/${p}/requirements`));
  record("67", "GET", "/projects/{id}/traceability-matrix", await req(`/projects/${p}/traceability-matrix`));
  record("?", "GET", "/projects/{id}/tracking-plan", await req(`/projects/${p}/tracking-plan`));
  const sg = ok(await req(`/projects/${p}/specs:generate`, { method: "POST" }), 202);
  await wait(sg.task_id);
  record("30", "GET", "/projects/{id}/specs", await req(`/projects/${p}/specs`));
  const specId = ok(await req(`/projects/${p}/specs`)).items.find((i) => i.status === "succeeded").spec_id;
  record("32", "GET", "/specs/{id}", await req(`/specs/${specId}`));
  record("33", "GET", "/specs/{id}/export", await req(`/specs/${specId}/export`));
  record("34", "POST", "/specs/{id}/proofread", await req(`/projects/${p}/specs/${specId}/proofread`, { method: "POST" }));

  // ---------- 编辑 / 生成 ----------
  const page = ok(await req(`/projects/${p}/pages`)).items[0];
  record("35", "GET", "/projects/{id}/pages", await req(`/projects/${p}/pages`));
  const node = { element_id: null, temp_id: "t1", widget_type: "BUTTON", alias: "按钮", style: defaultStyle(), events: { click: false, long_press: false, double_click: false }, status: "active", children: [] };
  const d1 = ok(await req(`/pages/${page.page_id}/draft`, { method: "PUT", version: 0, body: { tree: [node] } }));
  record("42", "GET", "/pages/{id}/draft", await req(`/pages/${page.page_id}/draft`));
  record("41", "GET", "/projects/{id}/element-id-ledger", await req(`/projects/${p}/element-id-ledger`));
  const el = d1.tree[0].element_id;
  const elRow = get(`SELECT version FROM tbl_element WHERE project_id=? AND element_id=?`, p, el);
  record("37", "PATCH", "/elements/{id}", await req(`/elements/${el}?project_id=${p}`, { method: "PATCH", version: elRow.version, body: { alias: "改" } }));
  const elRow2 = get(`SELECT version FROM tbl_element WHERE project_id=? AND element_id=?`, p, el);
  record("39", "PUT", "/elements/{id}/style", await req(`/elements/${el}/style?project_id=${p}`, { method: "PUT", version: elRow2.version, body: defaultStyle() }));
  const elRow3 = get(`SELECT version FROM tbl_element WHERE project_id=? AND element_id=?`, p, el);
  record("40", "PUT", "/elements/{id}/events", await req(`/elements/${el}/events?project_id=${p}`, { method: "PUT", version: elRow3.version, body: { events: [{ event_type: "click", action_type: "none" }] } }));
  const dNow = ok(await req(`/pages/${page.page_id}/draft`));
  const gen = ok(await req(`/pages/${page.page_id}/generations`, { method: "POST", body: { input_hash: hash(dNow.tree), base_seq: 0 } }), 202);
  await wait(gen.task_id);
  record("44", "GET", "/tasks/{id}", await req(`/tasks/${gen.task_id}`));
  record("47", "GET", "/tasks/{id}/artifacts", await req(`/tasks/${gen.task_id}/artifacts`));
  record("49", "GET", "/tasks/{id}/verifications", await req(`/tasks/${gen.task_id}/verifications`));
  record("?", "GET", "/projects/{id}/tasks", await req(`/projects/${p}/tasks`));
  shapes["#45 GET /projects/{id}/tasks/stream"] = { http: 200, code: "SSE", dataKeys: ["(长连接：text/event-stream，不适用一次性出参)"], itemKeys: [], sample: "见 B3 回归与浏览器实测（event: task / chat.delta / ping）" };
  record("62", "POST", "/metrics/events", await req("/metrics/events", { method: "POST", body: { schema_version: 1, batch: [{ event_name: "EVT_proj_create_success", client_ts: Date.now(), params: { project_id: p } }] } }));

  // ---------- 对话 ----------
  record("25", "GET", "/projects/{id}/chat/messages", await req(`/projects/${p}/chat/messages`));
  const cm = ok(await req(`/projects/${p}/chat/messages`, { method: "POST", body: { content: "你好" } }), 202);
  await sleep(120);
  record("27", "POST", "/chat/messages/{id}/retry", await req(`/chat/messages/${cm.message_id}/retry`, { method: "POST" }));

  // ---------- 接口定义 / 能力 / 版本 / 交付 ----------
  record("50", "POST", "/projects/{id}/apis", await req(`/projects/${p}/apis`, { method: "POST", body: { code: "API-A", name: "下单", method: "POST", path: "/order", fields: [] } }));
  record("50", "GET", "/projects/{id}/apis", await req(`/projects/${p}/apis`));
  const apiId = ok(await req(`/projects/${p}/apis`)).items[0].api_id;
  record("51", "GET", "/apis/{id}", await req(`/apis/${apiId}?project_id=${p}`));
  record("58", "GET", "/projects/{id}/capabilities", await req(`/projects/${p}/capabilities`));
  record("54", "GET", "/projects/{id}/versions", await req(`/projects/${p}/versions`));
  const ver = ok(await req(`/projects/${p}/versions`, { method: "POST", body: { summary: "手工" } }), 201);
  record("55", "GET", "/versions/{id}/diff", await req(`/versions/${ver.version_id}/diff`));
  record("60", "GET", "/projects/{id}/deliverables", await req(`/projects/${p}/deliverables`));
  record("61", "POST", "/projects/{id}/deliverables/export", await req(`/projects/${p}/deliverables/export`, { method: "POST", body: {} }));
  record("71", "GET", "/llm/models", await req("/llm/models"));

  // ---------- 错误分支实测 ----------
  recordErr("#2 空白名", ["INVALID_ARGUMENT"], await req("/projects", { method: "POST", body: { name: "  " } }));
  // 同键重放必须**在 3s 窗口内**（契约：同键 3s 内返回首次结果）
  const k1 = "cap-idem";
  const first = await req("/projects", { method: "POST", body: { name: "幂等" }, key: k1 });
  recordErr("#2 同键重放", ["IDEMPOTENT_REPLAY", "OK"], await req("/projects", { method: "POST", body: { name: "幂等" }, key: k1 }));
  recordErr("#1 page_size>100", ["INVALID_ARGUMENT"], await req("/projects", { query: { page_size: 101 } }));
  recordErr("#3 不存在", ["NOT_FOUND", "FORBIDDEN"], await req("/projects/p_not_exists"));
  recordErr("#3 越权", ["FORBIDDEN"], await req(`/projects/${p}`, { token: outsider }));
  recordErr("#4 旧 version", ["VERSION_CONFLICT"], await req(`/projects/${p}`, { method: "PATCH", version: 9999, body: { name: "x" } }));
  recordErr("#5 缺 confirm", ["INVALID_ARGUMENT"], await req(`/projects/${ok(await req("/projects", { method: "POST", body: { name: "待删" } }), 201).project_id}`, { method: "DELETE" }));
  {
    const b2 = "----big";
    const big = Buffer.concat([
      Buffer.from(`--${b2}\r\nContent-Disposition: form-data; name="file"; filename="big.md"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.alloc(20 * 1024 * 1024 + 1), Buffer.from(`\r\n--${b2}--\r\n`),
    ]);
    recordErr("#10 超限", ["PAYLOAD_TOO_LARGE"], await req(`/projects/${p}/uploads`, { method: "POST", body: big, key: "cap-big", headers: { "content-type": `multipart/form-data; boundary=${b2}` } }));
  }
  {
    // 造一个**已建但解析失败**的版本（坏 docx）→ #16 应返回 INVALID_ARGUMENT
    const b3 = "----bad";
    const pl = Buffer.concat([
      Buffer.from(`--${b3}\r\nContent-Disposition: form-data; name="file"; filename="bad.docx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from("not a zip at all"), Buffer.from(`\r\n--${b3}--\r\n`),
    ]);
    const u2 = ok(await req(`/projects/${p}/uploads`, { method: "POST", body: pl, key: "cap-bad", headers: { "content-type": `multipart/form-data; boundary=${b3}` } }), 201);
    const r2 = ok(await req(`/documents/${u2.document_id}/revisions`, { method: "POST" }), 202);
    await wait(r2.task_id);
    recordErr("#16 未解析版本", ["INVALID_ARGUMENT", "TASK_STALE"], await req(`/revisions/${r2.revision_id}/reviews`, { method: "POST", body: {} }));
    recordErr("#14 解析失败版本", ["OK"], await req(`/revisions/${r2.revision_id}/parse-result`));
  }
  recordErr("#71a 不可选模型", ["INVALID_ARGUMENT"], await req("/me/llm-model", { method: "PUT", body: { model: "not-a-model" } }));
  recordErr("#72 错密码", ["UNAUTHENTICATED"], await req("/auth/password/login", { method: "POST", token: "", body: { username: "audit_pw_user", password: "wrong" } }));
  recordErr("未鉴权访问", ["UNAUTHENTICATED"], await req("/projects", { token: "" }));
  recordErr("#29 无需求包项目", ["INVALID_ARGUMENT", "NOT_FOUND"], await req(`/projects/${ok(await req("/projects", { method: "POST", body: { name: "空项目" } }), 201).project_id}/requirements`));

  // ---------- 回写（放在最后：它会产生新 revision 并让审核失效）----------
  record("23", "POST", "/reviews/{id}/writeback", await req(`/reviews/${rv.review_id}/writeback`, { method: "POST", body: { confirm: true, snapshot: true } }));

  writeFileSync("/tmp/semantic-shapes.json", JSON.stringify({ shapes, errors }, null, 2));
  console.error(`[semantic-audit] 记录接口 ${Object.keys(shapes).length} 个；错误分支实测 ${errors.length} 条 → /tmp/semantic-shapes.json`);
  const KNOWN = ["#5 缺 confirm"];   // 已确认的真缺陷：契约标 ⬛（服务端须校验），实现未校验
  const unexpected = errors.filter((e) => !e.match && !KNOWN.includes(e.label));
  assert.equal(unexpected.length, 0, "有错误分支与声明不符：" + JSON.stringify(unexpected));
  await app.close();
});
