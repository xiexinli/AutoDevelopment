/**
 * 真实大模型下的「PRD 审核分级」三档实测。
 *
 * 做法：同一个 PRD 样本 → 3 个独立项目（各自首次审核，避开「假设未选完」前置校验），
 * 分别以 quick / standard / strict 跑一次真实审核，记录 verdict / counts / 条目数 / 耗时 / 失败原因。
 *
 * 用法：node .tmp/real-model-level-test.mjs [port] [prdPath]
 */
import { readFileSync, writeFileSync } from "node:fs";

const PORT = process.argv[2] ?? "8799";
const PRD_PATH = process.argv[3] ?? "samples/PRD-门店补货申请-门禁样例.md";
const S = `http://127.0.0.1:${PORT}/api/v1`;
const PW = "real-model-test-pw";

const j = async (r) => ({ status: r.status, ...(await r.json()) });
const req = async (p, { method = "GET", body, token } = {}) =>
  j(await fetch(S + p, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = (...a) => process.stdout.write(a.join(" ") + "\n");

/** 轮询任务终态；返回 {status,error_code,elapsed_ms} */
async function waitTask(taskId, tok, budgetMs = 25 * 60_000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < budgetMs) {
    const s = await req(`/tasks/${taskId}`, { token: tok });
    if (!s.data) throw new Error(`任务查询失败：${s.status} ${s.message}`);
    last = s.data;
    if (!["queued", "running"].includes(last.status)) {
      return { status: last.status, error_code: last.error_code ?? null, elapsed_ms: Date.now() - t0 };
    }
    await sleep(1500);
  }
  return { status: "client-timeout", error_code: null, elapsed_ms: Date.now() - t0 };
}

const token = (async () => {
  const r = await req("/auth/password/login", { method: "POST", body: { username: "admin", password: PW } });
  if (r.status !== 200) throw new Error(`登录失败：${r.status} ${r.message}`);
  return r.data.token;
})();
const tok = await token;

// 同一次运行共用一个 PRD 文本
const md = readFileSync(PRD_PATH, "utf8");
P(`PRD 样本：${PRD_PATH}｜${md.length} 字符 / ${md.split("\n").length} 行`);
P("");

const results = [];
for (const level of ["quick", "standard", "strict"]) {
  const p = (await req("/projects", { method: "POST", token: tok, body: { name: `真机实测-${level}` } })).data.project_id;
  await req("/users/me/ai-egress", { method: "PUT", token: tok, body: { consent_acknowledged: true, egress_enabled: true } });

  const fd = new FormData();
  fd.append("file", new Blob([md], { type: "text/markdown" }), "sample.md");
  const up = await j(await fetch(S + `/projects/${p}/uploads`, { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: fd }));
  if (up.status !== 201) { P(level, "上传失败", up.status, up.message); continue; }
  const rev = (await req(`/documents/${up.data.document_id}/revisions`, { method: "POST", token: tok })).data;
  const parseTask = await waitTask(rev.task_id, tok);
  if (parseTask.status !== "succeeded") { P(level, "解析失败", parseTask.status); continue; }

  P(`▶ ${level}：发起审核…`);
  const t0 = Date.now();
  const r = await req(`/revisions/${rev.revision_id}/reviews`, { method: "POST", token: tok, body: { level, force: true } });
  if (r.status !== 202) { P(level, "触发失败", r.status, r.message); results.push({ level, ok: false, reason: `${r.status} ${r.message}` }); continue; }

  const taskBit = await waitTask(r.data.task_id, tok);
  const wall = Date.now() - t0;

  let card = null, items = [], questions = [], assumptions = [];
  try {
    card = (await req(`/reviews/${r.data.review_id}`, { token: tok })).data;
    items = (await req(`/reviews/${r.data.review_id}/items`, { token: tok })).data.items ?? [];
    questions = (await req(`/reviews/${r.data.review_id}/questions`, { token: tok })).data.items ?? [];
    assumptions = (await req(`/reviews/${r.data.review_id}/assumptions`, { token: tok })).data.items ?? [];
  } catch (e) { P(level, "读评分卡失败", e.message); }

  const byVerdict = items.reduce((m, i) => ({ ...m, [i.verdict]: (m[i.verdict] ?? 0) + 1 }), {});
  const byLevel = items.reduce((m, i) => ({ ...m, [i.level]: (m[i.level] ?? 0) + 1 }), {});
  const failCodes = items.filter((i) => i.verdict === "fail").map((i) => i.item_code);
  const naCodes = items.filter((i) => i.verdict === "na").map((i) => i.item_code);

  results.push({
    level, ok: taskBit.status === "succeeded", task_status: taskBit.status, error_code: taskBit.error_code,
    wall_ms: wall, verdict: card?.verdict ?? null, counts: card?.counts ?? null,
    review_level: card?.review_level ?? null, model: card?.model ?? null,
    items_total: items.length, by_verdict: byVerdict, by_level: byLevel,
    fail_codes: failCodes, na_codes: naCodes,
    questions: questions.length, assumptions: assumptions.length,
  });

  P(`${level.padEnd(9)} task=${taskBit.status}${taskBit.error_code ? "/" + taskBit.error_code : ""} verdict=${card?.verdict ?? "-"} ` +
    `条目=${items.length} ${JSON.stringify(byVerdict)} 待澄清=${questions.length} 假设=${assumptions.length} 耗时=${(wall / 1000).toFixed(1)}s`);
  if (failCodes.length) P(`          fail: ${failCodes.join(",")}`);
  if (naCodes.length) P(`          na  : ${naCodes.join(",")}`);
  P("");
}

writeFileSync(".tmp/real-model-level-test.json", JSON.stringify({ prd: PRD_PATH, chars: md.length, results }, null, 2));
P("结果已写入 .tmp/real-model-level-test.json");
