/**
 * 定向验证：自动重跑对「真实模型结构性失败」是否有效。
 * 对同一份 PRD 重复跑同一档，统计成功/失败，并可从服务端日志看是否触发了重跑。
 * 用法：node .tmp/real-model-retry-check.mjs [port] [level] [times] [prdPath]
 */
import { readFileSync, writeFileSync } from "node:fs";

const PORT = process.argv[2] ?? "8799";
const LEVEL = process.argv[3] ?? "standard";
const TIMES = Number(process.argv[4] ?? 3);
const PRD = process.argv[5] ?? "prd_1-过审版.md";
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

async function waitTask(taskId, tok, budgetMs = 25 * 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const s = await req(`/tasks/${taskId}`, { token: tok });
    if (s.data && !["queued", "running"].includes(s.data.status)) {
      return { status: s.data.status, error_code: s.data.error_code ?? null, ms: Date.now() - t0 };
    }
    await sleep(1500);
  }
  return { status: "client-timeout", error_code: null, ms: Date.now() - t0 };
}

const tok = (await req("/auth/password/login", { method: "POST", body: { username: "admin", password: PW } })).data.token;
const md = readFileSync(PRD, "utf8");
P(`样本 ${PRD}｜档位 ${LEVEL}｜重复 ${TIMES} 次`);
P("");

const rows = [];
for (let i = 1; i <= TIMES; i++) {
  const p = (await req("/projects", { method: "POST", token: tok, body: { name: `重试验证-${LEVEL}-${i}` } })).data.project_id;
  await req("/users/me/ai-egress", { method: "PUT", token: tok, body: { consent_acknowledged: true, egress_enabled: true } });
  const fd = new FormData();
  fd.append("file", new Blob([md], { type: "text/markdown" }), "s.md");
  const up = await j(await fetch(S + `/projects/${p}/uploads`, { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: fd }));
  const rev = (await req(`/documents/${up.data.document_id}/revisions`, { method: "POST", token: tok })).data;
  await waitTask(rev.task_id, tok);

  process.stdout.write(`第 ${i} 次发起审核… `);
  const r = await req(`/revisions/${rev.revision_id}/reviews`, { method: "POST", token: tok, body: { level: LEVEL, force: true } });
  if (r.status !== 202) { P(`触发失败 ${r.status} ${r.message}`); rows.push({ i, ok: false, note: `${r.status} ${r.message}` }); continue; }
  const t = await waitTask(r.data.task_id, tok);
  const card = (await req(`/reviews/${r.data.review_id}`, { token: tok })).data;
  const items = (await req(`/reviews/${r.data.review_id}/items`, { token: tok })).data.items ?? [];
  P(`task=${t.status}${t.error_code ? "/" + t.error_code : ""} verdict=${card?.verdict} 条目=${items.length} 耗时=${(t.ms / 1000).toFixed(1)}s`);
  rows.push({ i, ok: t.status === "succeeded", task: t.status, error_code: t.error_code, verdict: card?.verdict ?? null, items: items.length, ms: t.ms });
}
const okN = rows.filter((r) => r.ok).length;
P("");
P(`成功 ${okN}/${rows.length}`);
writeFileSync(`.tmp/real-model-retry-${LEVEL}.json`, JSON.stringify({ prd: PRD, level: LEVEL, rows, ok: okN, total: rows.length }, null, 2));
