/**
 * PRD 审核分级（2026-10-28 定稿）回归 —— 简审 / 标准 / 严格。
 *
 * 覆盖清单 T1~T7（`PRD审核分级-定稿-v1.0.md` §8.7）：
 *  T1 三档各自的判定差异
 *  T2 **单调性**：同一 PRD 下「门槛内 fail 数」简审 ≤ 标准 ≤ 严格
 *  T3 复用键含等级：切档后不误复用旧报告
 *  T4 简审档豁免「假设未选完不得重跑」的前置校验（R-25）
 *  T5 换档 = 新审核，旧报告 superseded
 *  T6 `na` 不计入阻断（且计入 counts.na）
 *  T7 项目默认等级为 standard，并可被单次请求覆盖后回写
 *
 * 用内存库 + 确定性 mock 适配器；不联网、不依赖真实模型。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.AD_DB_PATH = ':memory:';
process.env.AD_LOG_LEVEL = 'fatal';
process.env.AD_UPLOAD_DIR = mkdtempSync(resolve('.tmp-review-level-uploads-'));

const { buildApp } = await import('../src/app.ts');
const { get } = await import('../src/db/index.ts');
const { ensureUser, issueToken } = await import('../src/core/auth.ts');
const { createMockAdapter } = await import('../src/adapters/llm.ts');

const owner = ensureUser('rl_owner_test', '分级回归');
const token = issueToken(owner.user_id);
const app = buildApp({ llm: createMockAdapter() });
await app.ready();

// 收尾：只删本测试自己的临时上传目录
after(async () => {
  await app.close();
  try { rmSync(process.env.AD_UPLOAD_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function request(path, { method = 'GET', body, token: tk = token, key, headers = {} } = {}) {
  const res = await app.inject({
    method, url: '/api/v1' + path,
    headers: { authorization: `Bearer ${tk}`, ...(key ? { 'idempotency-key': key } : {}), ...headers },
    ...(body !== undefined ? { payload: body } : {}),
  });
  return { status: res.statusCode, ...res.json() };
}
function expect(r, status) { assert.equal(r.status, status, JSON.stringify(r)); return r.data; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function project() {
  const id = expect(await request('/projects', { method: 'POST', body: { name: '分级回归' } }), 201).project_id;
  expect(await request('/users/me/ai-egress', { method: 'PUT', body: { consent_acknowledged: true } }), 200);
  return id;
}
async function upload(p, text, name = 'test.md') {
  const boundary = '----level-regression-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(text),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return request(`/projects/${p}/uploads`, { method: 'POST', body: payload, key: crypto.randomUUID(), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
}
async function wait(id) {
  for (let i = 0; i < 300; i++) {
    const t = expect(await request(`/tasks/${id}`), 200);
    if (!['queued', 'running'].includes(t.status)) return t;
    await sleep(5);
  }
  throw Error('task did not settle');
}
async function parse(p, text) {
  const u = expect(await upload(p, text), 201);
  const sub = expect(await request(`/documents/${u.document_id}/revisions`, { method: 'POST', key: crypto.randomUUID() }), 202);
  assert.equal((await wait(sub.task_id)).status, 'succeeded');
  return { ...u, ...sub };
}
/** 触发审核；`level` 不传则用项目默认 */
async function review(rev, { level, extended, force = true } = {}) {
  const body = { force, ...(level ? { level } : {}), ...(extended !== undefined ? { extended } : {}) };
  const r = expect(await request(`/revisions/${rev}/reviews`, { method: 'POST', body, key: crypto.randomUUID() }), 202);
  if (r.task_id) await wait(r.task_id);
  return r;
}
const itemRows = async (rid) => expect(await request(`/reviews/${rid}/items`), 200).items;
/** 把假设全部选成 accept（拆解前必须选完 —— `assertSplitGate`） */
async function acceptAll(rid) {
  const rows = expect(await request(`/reviews/${rid}/assumptions`), 200).items;
  for (const a of rows) {
    expect(await request(`/reviews/${rid}/assumptions`, { method: 'POST', body: { assumption_code: a.assumption_code, choice: 'accept' } }), 200);
  }
}

/** 把「本次等级门槛内算不算阻断」重算一遍：quick=任何 fail；standard=blocking fail；strict=blocking|major fail */
function thresholdFails(level, items) {
  return items.filter((i) => i.verdict === 'fail' &&
    (level === 'quick' ? true : level === 'standard' ? i.level === 'blocking' : i.level !== 'suggestion')).length;
}

const FULL = '# 完整 PRD\n\n' + ['背景', '主流程', '范围与目标', '状态机', '异常失败', '字段数据', '属性样式', '页面元素', '文案字样', '接口API', '权限角色', '生成验证', '角落组合', '假设']
  .map((s) => `## ${s}\n\n内容。`).join('\n\n');
const PARTIAL = '# 半成品 PRD\n\n## 背景\n\n一句话说明。\n\n## 主流程\n\n步骤。\n';

await test('PRD 审核分级（简审 / 标准 / 严格）', async (t) => {
  let p, rev;
  await t.test('T1/T2 三档判定差异与单调性（同一份不完整 PRD）', async () => {
    p = await project();
    rev = (await parse(p, PARTIAL)).revision_id;

    const quick = await review(rev, { level: 'quick' });
    const qItems = await itemRows(quick.review_id);
    const qReport = expect(await request(`/reviews/${quick.review_id}`), 200);
    assert.equal(qReport.review_level, 'quick');
    // 简审只评 Q1/Q2 两项，其余不评（这里根本没有其它项）
    assert.deepEqual(qItems.map((i) => i.item_code).sort(), ['Q1', 'Q2']);
    assert.equal(qReport.verdict, 'passed');                       // 背景 + 主流程都在 → 能实现、无冲突

    const std = await review(rev, { level: 'standard' });
    const sItems = await itemRows(std.review_id);
    const sReport = expect(await request(`/reviews/${std.review_id}`), 200);
    assert.equal(sReport.review_level, 'standard');
    assert.equal(sItems.length, 14);                               // 精简表 14 项
    assert.equal(sReport.verdict, 'blocked');                      // B1/B2/C1/E1/F1 是 blocking 且 fail

    // 换档走「不带 force 的新审核」（带 force 的会先被「假设未选完」前置校验拦住，那是设计行为）
    const strict = await review(rev, { level: 'strict', force: false });
    const tItems = await itemRows(strict.review_id);
    const tReport = expect(await request(`/reviews/${strict.review_id}`), 200);
    assert.equal(tReport.review_level, 'strict');
    assert.ok(tItems.length > 14, `严格档应追加完整表细则项，实际 ${tItems.length}`);
    assert.equal(tReport.verdict, 'blocked');

    // T2 单调性（回归强制断言）
    const qn = thresholdFails('quick', qItems), sn = thresholdFails('standard', sItems), tn = thresholdFails('strict', tItems);
    assert.ok(qn <= sn && sn <= tn, `阻断数必须单调：quick=${qn} standard=${sn} strict=${tn}`);
  });

  await t.test('T6 `na` 不计入阻断，且计入 counts.na', async () => {
    const p2 = await project();
    const rev2 = (await parse(p2, FULL)).revision_id;
    const r = await review(rev2, { level: 'strict' });
    const report = expect(await request(`/reviews/${r.review_id}`), 200);
    assert.ok(report.counts.na > 0, '严格档追加项在 mock 下应为 na');
    const items = await itemRows(r.review_id);
    const fails = items.filter((i) => i.verdict === 'fail').length;
    assert.equal(report.verdict, fails === 0 ? 'passed' : 'blocked');
    assert.equal(report.counts.na, items.filter((i) => i.verdict === 'na').length);
    assert.ok(items.every((i) => i.verdict !== 'na' || i.evidence_ref.length > 0), 'na 也必须带说明，不得留空');
  });

  await t.test('T7 项目默认等级 = standard，单次覆盖后回写', async () => {
    const p3 = await project();
    assert.equal(expect(await request(`/projects/${p3}`), 200).review_level, 'standard');
    assert.equal(expect(await request(`/projects/${p3}/stats`), 200).gate.review_level, 'standard');
    const rev3 = (await parse(p3, PARTIAL)).revision_id;
    await review(rev3, { level: 'quick' });                        // 单次覆盖
    assert.equal(expect(await request(`/projects/${p3}`), 200).review_level, 'quick');
    assert.equal(get('SELECT review_level FROM tbl_project WHERE project_id=?', p3).review_level, 'quick');
  });

  await t.test('T3 复用键含等级：切档不复用、同档复用', async () => {
    const p4 = await project();
    const rev4 = (await parse(p4, PARTIAL)).revision_id;
    const first = await review(rev4, { level: 'standard' });
    assert.equal(first.reused, false);
    // 进页（不带 force）同档 → 复用
    const again = expect(await request(`/revisions/${rev4}/reviews`, { method: 'POST', body: {} }), 200);
    assert.equal(again.reused, true); assert.equal(again.task_id, null); assert.equal(again.review_id, first.review_id);
    // 切到简审（不带 force）→ **不得**复用标准档报告
    const switched = expect(await request(`/revisions/${rev4}/reviews`, { method: 'POST', body: { level: 'quick' } }), 202);
    assert.equal(switched.reused, false);
    assert.notEqual(switched.review_id, first.review_id);
    assert.equal(switched.level, 'quick');
  });

  await t.test('T4 简审档豁免「假设未选完」前置校验（R-25）', async () => {
    const p5 = await project();
    const rev5 = (await parse(p5, PARTIAL)).revision_id;
    const std = await review(rev5, { level: 'standard' });
    const unset = get('SELECT COUNT(*) n FROM tbl_assumption WHERE review_id=? AND choice=\'unset\'', std.review_id).n;
    assert.ok(unset > 0, '标准档应留下未选假设');
    // 标准档带 force 重跑会被拦
    assert.equal((await request(`/revisions/${rev5}/reviews`, { method: 'POST', body: { level: 'standard', force: true } })).status, 400);
    // 简审档带 force 重跑 **放行**
    const quick = expect(await request(`/revisions/${rev5}/reviews`, { method: 'POST', body: { level: 'quick', force: true } }), 202);
    await wait(quick.task_id);
    assert.equal(expect(await request(`/reviews/${quick.review_id}`), 200).review_level, 'quick');
  });

  await t.test('T5 换档 = 新审核，旧报告 superseded', async () => {
    const p6 = await project();
    const rev6 = (await parse(p6, PARTIAL)).revision_id;
    const std = await review(rev6, { level: 'standard' });
    assert.equal(expect(await request(`/reviews/${std.review_id}`), 200).superseded, false);
    // 换档走「不带 force 的新审核」：同 revision 但等级不同 → 不复用 → 新建并作废旧报告
    const strict = await review(rev6, { level: 'strict', force: false });
    assert.equal(expect(await request(`/reviews/${std.review_id}`), 200).superseded, true);
    assert.equal(expect(await request(`/reviews/${strict.review_id}`), 200).superseded, false);
    assert.equal(expect(await request(`/reviews/${strict.review_id}`), 200).review_level, 'strict');
    // 非法等级 → 400
    assert.equal((await request(`/revisions/${rev6}/reviews`, { method: 'POST', body: { level: 'super' } })).status, 400);
  });

  await t.test('导出报告带审核等级；拆解深度由等级映射', async () => {
    const p7 = await project();
    const rev7 = (await parse(p7, FULL)).revision_id;
    const r = await review(rev7, { level: 'strict' });
    const md = expect(await request(`/projects/${p7}/reviews/${r.review_id}/export`), 200).content_md;
    assert.match(md, /审核等级：strict/);
    await acceptAll(r.review_id);                                  // 拆解前必须选完假设
    // 严格档 → comprehensive
    const split = expect(await request(`/projects/${p7}/splits`, { method: 'POST', body: {} }), 202);
    assert.equal(split.depth, 'comprehensive');
    await wait(split.task_id);
  });
});
