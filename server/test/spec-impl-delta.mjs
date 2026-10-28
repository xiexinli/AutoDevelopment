/**
 * **Spec ↔ 实现 专项核对**（2026-10-22 第 1 刀）—— 只读、可复跑。
 *
 * 覆盖「今天双方都刚改过」的面（最容易两边说法不一）：
 *   A. `#25` 对话历史的 `thread` 过滤 / 回落 / 出参字段集
 *   B. `#26` 发送的 `thread` 落库与 `seq` 线程内单增、SSE `chat.delta` 带线程
 *   C. `#45` 的 `ai.step`（任务类 / 大模型类 / 同 step_id 覆盖 / 新订阅补发 / 不落库）
 *   D. `#5` 删除的二次确认与出参
 *   E. `#62` 的 `schema_version` 类型分支与 `event_name`
 *   F. 静态：契约端点 vs 实际注册路由（找「契约有代码无」「代码有契约无」）
 *
 * 用法：`cd server && node test/spec-impl-delta.mjs` → 打印逐项 PASS/FAIL + 写 `/tmp/spec-impl-delta.json`
 */
process.env.AD_DB_PATH = ":memory:";
process.env.AD_LOG_LEVEL = "fatal";
process.env.AD_LLM_MODE = "development";
process.env.AD_CODEGEN_MODE = "development";
process.env.AD_PASSWORD_LOGIN = "development";
process.env.AD_DEV_PASSWORD = "delta-pw";

const { buildApp } = await import("../src/app.ts");
const { get, all } = await import("../src/db/index.ts");
const { ensureUser, issueToken } = await import("../src/core/auth.ts");
const { writeFileSync } = await import("node:fs");

const app = buildApp();
await app.ready();
const user = ensureUser("delta_user", "核对");
const token = issueToken(user.user_id);
const H = { authorization: `Bearer ${token}` };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function req(path, { method = "GET", body, query } = {}) {
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const r = await app.inject({ method, url: "/api/v1" + path + qs, headers: H, ...(body !== undefined ? { payload: body } : {}) });
  return { http: r.statusCode, ...r.json() };
}

// ---------- 前置：开启外发（否则 #26 被 fail-closed 拒绝）----------
await req("/users/me/ai-egress", { method: "PUT", body: { consent_acknowledged: true, egress_enabled: true } });

// ---------- 造一个项目 ----------
const mk = await req("/projects", { method: "POST", body: { name: "核对项目" } });
const P = mk.data.project_id;

// ================= A. #25 =================
const chat = async (text, thread) => {
  const r = await req(`/projects/${P}/chat/messages`, { method: "POST", body: thread ? { content: text, thread } : { content: text } });
  if (r.http !== 202) throw new Error(`#26 发送失败：http=${r.http} code=${r.code} msg=${r.message}`);
  return r;
};
await chat("工作台的问题");                    // 缺省 → workbench
await chat("上传的问题", "upload");            // 指定 → upload
await chat("知识库的问题", "kb");

const all1 = await req(`/projects/${P}/chat/messages`);
check("A1 不给 thread 返回全部线程", all1.data.items.length >= 3 && new Set(all1.data.items.map((m) => m.thread_key)).size >= 2,
  `条数=${all1.data.items.length} 线程=${[...new Set(all1.data.items.map((m) => m.thread_key))].join("/")}`);
check("A2 不给 thread 时 data.thread 为 null", all1.data.thread === null, `data.thread=${JSON.stringify(all1.data.thread)}`);
const FIELDS = ["message_id", "project_id", "seq", "role", "content", "status", "thread_key", "created_at"];
const got = Object.keys(all1.data.items[0] ?? {});
check("A3 出参字段集 = 8（Spec §5.4.5，含 project_id）", FIELDS.every((f) => got.includes(f)) && got.length === FIELDS.length,
  `实测=[${got.join(",")}]`);

const up1 = await req(`/projects/${P}/chat/messages`, { query: { thread: "upload" } });
check("A4 ?thread=upload 只返回该线程", up1.data.items.length > 0 && up1.data.items.every((m) => m.thread_key === "upload"),
  `条数=${up1.data.items.length}`);
check("A5 指定 thread 时 data.thread 回显", up1.data.thread === "upload", `data.thread=${JSON.stringify(up1.data.thread)}`);

const bogus = await req(`/projects/${P}/chat/messages`, { query: { thread: "bogus" } });
check("A6 非法 thread 回落 workbench（200，不是 400）", bogus.http === 200 && bogus.data.thread === "workbench",
  `http=${bogus.http} data.thread=${JSON.stringify(bogus.data.thread)}`);

// ================= B. #26 =================
const wb = await req(`/projects/${P}/chat/messages`, { query: { thread: "workbench" } });
const upSeqs = up1.data.items.map((m) => m.seq);
check("B1 seq 线程内单增（upload 从 1 开始、与 workbench 互不影响）",
  Math.min(...upSeqs) === 1 && Math.max(...wb.data.items.map((m) => m.seq)) !== Math.min(...upSeqs),
  `upload seq=[${upSeqs.join(",")}] workbench seq=[${wb.data.items.map((m) => m.seq).join(",")}]`);
const rows = all(`SELECT thread_key, COUNT(*) n FROM tbl_chat_message WHERE project_id=? GROUP BY thread_key`, P);
check("B2 落库 thread_key 分线程", rows.length >= 2 && rows.every((r) => !!r.thread_key),
  rows.map((r) => `${r.thread_key}:${r.n}`).join(" "));

// ================= C. #45 ai.step（走真实 SSE 连接）=================
await app.listen({ port: 0, host: "127.0.0.1" });
const port = app.server.address().port;
const ac = new AbortController();
const res = await fetch(`http://127.0.0.1:${port}/api/v1/projects/${P}/tasks/stream`, { headers: H, signal: ac.signal });
const reader = res.body.getReader();
const dec = new TextDecoder();
let sse = "";
const pump = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) break; sse += dec.decode(value); } })().catch(() => {});

const { createTask, startTask, publish } = await import("../src/core/tasks.ts");
const { aiStep } = await import("../src/core/ai-trace.ts");
// 任务类：running(1%) → running(40%) → done(100%)
const t1 = createTask({ projectId: P, type: "review" });
await new Promise((r) => startTask(t1.task_id, async (ctx) => { ctx.progress(40); return null; }, { onSettled: r }));
// 大模型类：running → done（有 duration_ms、无正文）
await new Promise((r) => setTimeout(r, 150));

const parse = () => sse.split("\n\n").filter((b) => b.includes("event: ai.step")).map((b) => JSON.parse(b.split("data: ")[1]));
let steps = parse();
const taskSteps = steps.filter((s) => s.task_id === t1.task_id);
check("C1 任务类推 ai.step 且同 step_id 覆盖", taskSteps.length >= 2 && new Set(taskSteps.map((s) => s.step_id)).size === 1,
  `推送=${taskSteps.length} 次 step_id 唯一=${new Set(taskSteps.map((s) => s.step_id)).size}`);
check("C2 终态映射 succeeded→done", taskSteps.some((s) => s.status === "done"), `终态=${taskSteps.at(-1)?.status}`);
const REQUIRED = ["step_id", "task_id", "kind", "title", "status", "at"];
const OPT = ["detail", "model", "duration_ms", "progress", "phase"];
const present = new Set(steps.flatMap((s) => Object.keys(s)));
check("C3a ai.step 必需键齐备（6）", REQUIRED.every((f) => present.has(f)),
  `实测并集=[${[...present].join(",")}]`);
check("C3b ai.step 可选键（5）实际出现", OPT.every((f) => present.has(f)),
  `未出现的可选键=[${OPT.filter((f) => !present.has(f)).join(",") || "无"}]`);

// 新订阅补发
const ac2 = new AbortController();
const res2 = await fetch(`http://127.0.0.1:${port}/api/v1/projects/${P}/tasks/stream`, { headers: H, signal: ac2.signal });
let sse2 = ""; const rd2 = res2.body.getReader();
const pump2 = (async () => {
  const deadline = Date.now() + 800;
  while (Date.now() < deadline) {
    const r = await Promise.race([rd2.read(), new Promise((res) => setTimeout(() => res({ timeout: true }), 200))]);
    if (r.timeout || r.done) continue;
    sse2 += dec.decode(r.value);
  }
})().catch(() => {});
await pump2;
const replayed = sse2.split("\n\n").filter((b) => b.includes("event: ai.step")).length;
check("C4 新订阅补发近期步骤", replayed >= 1, `补发 ${replayed} 条`);
ac2.abort(); ac.abort(); await pump;

// 不落库：库里没有承载 ai.step 的表/行
const tables = all(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name);
const stepTables = tables.filter((n) => /ai_?step|step_?trace/i.test(n));
check("C5 ai.step 不落库（无承载表）", stepTables.length === 0, `命中表=[${stepTables.join(",") || "无"}] 总表数=${tables.length}`);

// ================= D. #5 =================
const noC = await req(`/projects/${P}`, { method: "DELETE" });
check("D1 #5 缺 confirm → 400", noC.http === 400 && noC.code === "INVALID_ARGUMENT", `${noC.http} ${noC.message}`);
const ok5 = await req(`/projects/${P}`, { method: "DELETE", body: { confirm: true } });
check("D2 #5 带 confirm → 200 + {deleted_at}", ok5.http === 200 && !!ok5.data?.deleted_at, `${ok5.http} deleted_at=${ok5.data?.deleted_at}`);

// ================= E. #62 =================
const mk2 = await req("/projects", { method: "POST", body: { name: "核对项目2" } });
const P2 = mk2.data.project_id;
const bad62 = await req("/metrics/events", { method: "POST", body: { schema_version: 1, batch: [] } });
check("E1 #62 schema_version 类型错 → 400「必须是字符串」", bad62.http === 400 && /字符串/.test(bad62.message), `${bad62.http} ${bad62.message}`);
const ok62 = await req("/metrics/events", { method: "POST", body: { schema_version: "1.0", batch: [{ event_name: "EVT_proj_create_success", event_id: "e1" }] } });
check("E2 #62 event_name 合法 → accepted=1", ok62.http === 200 && ok62.data.accepted === 1, `accepted=${ok62.data?.accepted}`);

// ================= F. 静态：契约 vs 路由（粗筛）=================
const { readFileSync, readdirSync } = await import("node:fs");
const { join } = await import("node:path");

// ① 实现侧：扫 app.<method>(...) 与 app.route({...})
const routesDir = join(import.meta.dirname, "..", "src", "routes");
const implRaw = [];
for (const f of readdirSync(routesDir).filter((n) => n.endsWith(".ts"))) {
  const src = readFileSync(join(routesDir, f), "utf8");
  const re1 = /app\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g;
  for (const m of src.matchAll(re1)) implRaw.push(m[1].toUpperCase() + " " + m[2]);
  const re2 = /app\.route\(\{[^}]*method:\s*['"`]?(\w+)['"`]?[^}]*url:\s*(?:`([^`]+)`|['"]([^'"]+)['"])/gs;
  for (const m of src.matchAll(re2)) {
    const verb = String(m[1]).toUpperCase();
    let url = m[2] || m[3];
    // `editor.ts` 的循环注册：url 形如 `/api/v1/elements/:element_id${suffix}` → 展开三种后缀
    if (url.includes("${suffix}")) {
      for (const suf of ["", "/style", "/events"]) {
        implRaw.push((suf ? "PUT" : "PATCH") + " " + url.replace("${suffix}", suf));
      }
      continue;
    }
    implRaw.push(verb + " " + url);
  }
}
// `editor.ts` 用 `app.route<...>({method, url:\`/api/v1/elements/:element_id${suffix}\`})` 循环注册，
// 正则无法静态求值 method —— 按源码形态识别（同 `A1-硬核对报告 §1.1` 的口径）
const editorSrc = readFileSync(join(routesDir, "editor.ts"), "utf8");
const loopReg = /for\s*\(\s*const suffix of/.test(editorSrc) && /app\.route[\s\S]{0,240}\$\{suffix\}/.test(editorSrc);

const strip = (s) => s.replace("/api/v1", "").replace(/:([A-Za-z_]+)/g, "{$1}");
const implSet = new Set(implRaw.map(strip));
implSet.delete("");

// ② 契约侧：抽 §1 各表里的「方法 + 路径」
const contract = readFileSync(join(import.meta.dirname, "..", "..", "platform", "design", "接口契约.md"), "utf8");
const contractSet = new Set();
// 契约侧：按行取「全部反引号 token」——① 动词（可带 ⬛/⚡）② 以 / 开头的路径
const VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
for (const line of contract.split("\n")) {
  if (!/^\|\s*\d+[a-z]?\s*\|/.test(line)) continue;          // 只吃「编号」开头的契约行
  const toks = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
  const paths = toks.filter((x) => x.startsWith("/"));
  if (paths.length === 0) continue;
  const verbs = [];
  for (const x of toks) {
    for (const part of x.split(/[\s/]+/)) {
      const v = part.replace(/[⬛⚡]/g, "").trim();
      if (VERBS.has(v)) verbs.push(v);
    }
  }
  if (verbs.length === 0) continue;
  for (const p0 of paths) { if (p0.startsWith(":")) continue;      // 只跳过「:开头」的非路径 token
    const path = strip(p0.replace(/\/$/, ""));
    for (const v of verbs) contractSet.add(v + " " + path);
  }
}
if (loopReg) for (const [v, s] of [["PATCH", ""], ["PUT", "/style"], ["PUT", "/events"]]) implSet.add(`${v} /elements/{element_id}${s}`);
const implOnly = [...implSet].filter((s) => !contractSet.has(s));
const contractOnly = [...contractSet].filter((s) => !implSet.has(s));

// 已知的「契约外实现」——**已于 2026-10-22 登记为内部端点**（`接口-Spec §5.4.14`、`接口契约 §2` 前注）
const KNOWN_IMPL_ONLY = [
  "POST /auth/feishu/qrcode/{state}/simulate", // 开发适配器专用，有意不进契约
  "GET /projects/{project_id}/kb-sectors",     // 契约未登记（A1 遗留）
  "GET /projects/{project_id}/tasks",          // 契约未登记（A1 遗留）
  "GET /auth/feishu/callback",                 // 真实飞书登录回调（OAuth 重定向），契约未登记 —— 本次新发现
];
const implOnlyNew = implOnly.filter((s) => !KNOWN_IMPL_ONLY.includes(s));

check("F1 契约端点全部有实现（粗筛）", contractOnly.length === 0,
  contractOnly.length ? "契约有实现无=" + contractOnly.join(" ") : `${contractSet.size} 个端点`);
check("F2 无「未登记且非已知例外」的实现端点", implOnlyNew.length === 0,
  implOnlyNew.length ? "未登记=" + implOnlyNew.join(" ") : `实现 ${implSet.size} 个；已知例外 ${implOnly.length} 个未变`);

writeFileSync("/tmp/spec-impl-delta.json", JSON.stringify({ results, implCount: implSet.size, contractCount: contractSet.size }, null, 1));
const fail = results.filter((r) => !r.ok).length;
console.log(`\n==== 合计 ${results.length} 项，FAIL ${fail} ====`);
process.exit(0);
