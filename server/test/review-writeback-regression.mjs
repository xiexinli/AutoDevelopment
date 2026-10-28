/**
 * Isolated, repeatable review/writeback regression (no real DB/account/AI).
 * Run from workspace: node --test server/test/review-writeback-regression.mjs
 * Or from server:     node --test test/review-writeback-regression.mjs
 * Every HTTP scenario uploads a file, parses it and reviews it via buildApp/app.inject.
 * The custom adapter checks actual body evidence, NOT headings or accepted flags.
 * This proves transport/persistence/orchestration, not any real model's verdict.
 * Only this test's mkdtemp subtree under workspace .tmp is removed in after().
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEMO = '# demo\n这是一个简单的 demo PRD。'; // exactly two original Markdown lines
const FLOW = '用户提交申请 → 服务端校验 → 审核员确认 → 结果回显。';
const PHASES = '一期：申请与审核；二期：通知与报表。';
const COMPLETE = `${FLOW}\n${PHASES}`;
const INCOMPLETE = '主流程：待业务方补充分期规划。';
const STATES = '草稿 → 待审核 → 已通过；校验失败保留草稿并展示错误原因。';
const QUESTION_TITLE = '主流程及分期如何落实？';
const ANSWER = '一期依次提交、校验、审核、回显，二期再补通知。';
const ASSUMPTION = '一期只支持单审核员。';
const GROUPS = { A:'需求完整性', B:'状态穷举与迁移', C:'数据与字段', D:'页面级元素与文案', E:'平台接口契约', F:'角色与权限', G:'生成与验证', H:'角落收敛', I:'假设集中确认' };
const sha = s => createHash('sha256').update(s).digest('hex');
const savedEnv = new Map();
const setEnv = (key, value) => { if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]); process.env[key] = value; };
let worktmp, app, db, get, all, run, owner, token, outsiderToken, adminToken;
let loadRevision, revisionText, readMeta, normalizeAnswer, reviewSubmitReasons;
const receipts = [], networkAttempts = [];
const originalFetch = globalThis.fetch;

before(async () => {
  mkdirSync(join(ROOT, '.tmp'), { recursive:true });
  worktmp = mkdtempSync(join(ROOT, '.tmp/review-writeback-regression-'));
  setEnv('AD_DB_PATH', ':memory:'); // MUST precede every business-module import
  setEnv('AD_LOG_LEVEL', 'fatal');
  setEnv('AD_UPLOAD_DIR', join(worktmp, 'uploads'));
  setEnv('AD_LLM_MODE', 'development');
  setEnv('AD_LLM_MODEL', 'isolated-evidence-adapter');
  setEnv('AD_LLM_BASE_URL', '');
  setEnv('AD_LLM_API_KEY', '');
  setEnv('AD_LLM_CATALOG_FILE', join(worktmp, 'catalog.json'));
  writeFileSync(process.env.AD_LLM_CATALOG_FILE, JSON.stringify({ default_model:'isolated-evidence-adapter', models:[{id:'isolated-evidence-adapter',available:true}] }));
  // Synthetic sentinel prevents primeDhworkSession from reading client/real session credentials.
  setEnv('AD_DHWORK_TOKEN', 'isolated-test-sentinel-not-a-credential');
  setEnv('AD_DHWORK_SESSION_FILE', join(worktmp, 'synthetic-session.json'));
  setEnv('AD_DHWORK_SERVICE_URL', 'https://network-disabled.invalid');
  for (const k of ['AD_FEISHU_APP_ID','AD_FEISHU_APP_SECRET','AD_FEISHU_USER_TOKEN','AD_FEISHU_TOKEN']) setEnv(k, '');
  setEnv('AD_PASSWORD_LOGIN', 'disabled');
  globalThis.fetch = async (...args) => { networkAttempts.push(String(args[0])); throw new Error('Regression forbids all external fetch/network'); };
  ({ db, get, all, run } = await import('../src/db/index.ts'));
  assert.equal(process.env.AD_DB_PATH, ':memory:');
  assert.equal(db.prepare('PRAGMA database_list').get().file, '', 'SQLite is in memory, not server/data/app.db');
  const { ensureUser, issueToken } = await import('../src/core/auth.ts');
  owner = ensureUser(`rw_owner_${randomUUID()}`, '隔离写回测试'); token = issueToken(owner.user_id);
  outsiderToken = issueToken(ensureUser(`rw_other_${randomUUID()}`, '隔离无权限测试').user_id);
  const admin = ensureUser(`rw_admin_${randomUUID()}`, '隔离标准测试');
  run("UPDATE tbl_user SET role='admin' WHERE user_id=?", admin.user_id); adminToken = issueToken(admin.user_id);
  ({ loadRevision, revisionText, readMeta } = await import('../src/core/revisions.ts'));
  ({ normalizeAnswer, reviewSubmitReasons } = await import('../../web/src/pages/reviewState.ts'));
  const { createMockAdapter } = await import('../src/adapters/llm.ts');
  const base = createMockAdapter();
  const llm = { ...base, kind:'mock', async review(input) {
    const { markdown, standardItems } = input;
    // Deterministic evidence rules: an empty heading or "补齐主流程" cannot pass A2.
    const bodyLines = []; let fence = null;
    for (const line of markdown.split('\n')) {
      const f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) { if (!fence) fence=f[1][0]; else if (fence===f[1][0]) fence=null; continue; }
      if (!fence && !/^#{1,6}\s/.test(line)) bodyLines.push(line);
    }
    const body = bodyLines.join('\n');
    const items = standardItems.map(s => {
      const evidence = s.code==='A1' && body.includes(DEMO.split('\n')[1]) ? DEMO.split('\n')[1]
        : s.code==='A2' && body.includes(FLOW) && body.includes(PHASES) ? COMPLETE
        : s.code==='B1' && body.includes(STATES) ? STATES : '';
      return { item_code:s.code, group:s.code[0], level:s.level, verdict:evidence?'pass':'fail',
        evidence_ref:evidence ? `正文证据：${evidence}` : `缺少 ${s.code} 的可验证正文证据`,
        suggestion:evidence ? '' : `需要补充 ${s.code} 的可验证事实。` };
    });
    receipts.push({ input:structuredClone(input), items:structuredClone(items) });
    return { items, questions:items.some(i=>i.item_code==='A2' && i.verdict==='fail') ? [{ question_code:'Q-MAIN', level:'blocking', title:QUESTION_TITLE, options:[], fallback:'not_yet_defined', impact:'主流程与分期尚未落实' }] : [],
      assumptions:[{assumption_code:'ASSUMPTION-ONE',content:ASSUMPTION,source_tag:'[来源: 测试推断，待确认]'}] };
  } };
  const { buildApp } = await import('../src/app.ts');
  app = buildApp({ llm, codegen:{kind:'development',async generate(){throw new Error('Code generation is outside this regression');}} });
  await app.ready();
  ok(await request('/users/me/ai-egress', {method:'PUT',body:{consent_acknowledged:true}}));
});

after(async () => {
  try {
    if (app) await app.close();
    assert.equal(networkAttempts.length, 0, `Forbidden network attempts: ${networkAttempts.join(', ')}`);
  } finally {
    if (db) db.close();
    globalThis.fetch = originalFetch;
    for (const [key,value] of savedEnv) { if (value===undefined) delete process.env[key]; else process.env[key]=value; }
    if (worktmp) { rmSync(worktmp, {recursive:true,force:true}); assert.equal(existsSync(worktmp), false); }
  }
});

async function request(path, {method='GET',body,key,tk=token,headers={}}={}) {
  const res = await app.inject({method,url:`/api/v1${path}`,headers:{authorization:`Bearer ${tk}`,...(key?{'idempotency-key':key}:{}),...headers},...(body!==undefined?{payload:body}:{})});
  return {status:res.statusCode,...res.json()};
}
function ok(r,status=200) { assert.equal(r.status,status,JSON.stringify(r)); assert.equal(r.code,'OK',JSON.stringify(r)); return r.data; }
function rejected(r,status,message,code='INVALID_ARGUMENT') { assert.equal(r.status,status,JSON.stringify(r)); assert.equal(r.code,code,JSON.stringify(r)); assert.equal(r.message,message,JSON.stringify(r)); }
async function settle(id) {
  const deadline = Date.now()+5000;
  while (Date.now()<deadline) { const task=ok(await request(`/tasks/${id}`)); if (!['queued','running'].includes(task.status)) { assert.equal(task.status,'succeeded',JSON.stringify(task)); return task; } await delay(5); }
  assert.fail(`Task ${id} did not settle within 5s`);
}
async function newProject() { return ok(await request('/projects',{method:'POST',body:{name:'隔离写回复审回归'}}),201).project_id; }
async function parse(projectId, text=DEMO) {
  const fixturePath=join(worktmp, `fixture-${randomUUID()}.md`); writeFileSync(fixturePath,text);
  const boundary=`----rw-${randomUUID()}`;
  const payload=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="demo.md"\r\nContent-Type: text/markdown\r\n\r\n`),readFileSync(fixturePath),Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const u=ok(await request(`/projects/${projectId}/uploads`,{method:'POST',body:payload,headers:{'content-type':`multipart/form-data; boundary=${boundary}`}}),201);
  const r=ok(await request(`/documents/${u.document_id}/revisions`,{method:'POST'}),202); await settle(r.task_id);
  const result=ok(await request(`/revisions/${r.revision_id}/parse-result`)); assert.equal(result.parse_status,'succeeded'); assert.equal(result.empty_document,false);
  const kb=get('SELECT * FROM tbl_kb_doc WHERE project_id=? AND document_id=?',projectId,u.document_id);
  assert.equal(kb.content_md,text,'Uploaded original body must not be replaced by a prepared full PRD');
  return {projectId,...u,...r,kb,fixturePath};
}
async function review(revisionId) {
  const r=ok(await request(`/revisions/${revisionId}/reviews`,{method:'POST',body:{force:true}}),202); await settle(r.task_id); return r;
}
async function fixture({text=DEMO,historical=false,foreignItem=false}={}) {
  const projectId=await newProject();
  const std=ok(await request(`/projects/${projectId}/gate-standards`));
  // Test-only historical fixture in :memory:, never migrate/rewrite a real standard.
  if (historical) {
    const row=get('SELECT * FROM tbl_gate_standard WHERE project_id=? AND version=?',projectId,std.version);
    run('UPDATE tbl_gate_standard SET items_json=? WHERE project_id=? AND version=?',JSON.stringify(JSON.parse(row.items_json).map(i=>({...i,title:GROUPS[i.code[0]]}))),projectId,std.version);
  }
  if (foreignItem) {
    const row=get('SELECT * FROM tbl_gate_standard WHERE project_id=? AND version=?',projectId,std.version);
    run('UPDATE tbl_gate_standard SET items_json=? WHERE project_id=? AND version=?',JSON.stringify([...JSON.parse(row.items_json),{code:'Z9',group:'Z',title:'异项目专用项',level:'major'}]),projectId,std.version);
  }
  const p=await parse(projectId,text),r=await review(p.revision_id);
  const questions=ok(await request(`/reviews/${r.review_id}/questions`)).items;
  const assumptions=ok(await request(`/reviews/${r.review_id}/assumptions`)).items;
  assert.equal(assumptions.length,1);
  return {...p,...r,questions,assumptions};
}
async function choose(f,choice='accept') { return ok(await request(`/reviews/${f.review_id}/assumptions`,{method:'POST',body:{assumption_code:f.assumptions[0].assumption_code,choice}})); }
function writeBody(f,{supplement=COMPLETE,answers=true,accepted=['A2']}={}) {
  return {confirm:true,snapshot:true,accepted_items:accepted,supplements:supplement?[{item_code:'A2',text:supplement}]:[],answers:answers?f.questions.map(q=>({question_code:q.question_code,answer:`__other  ${ANSWER}  `})):[]};
}
async function write(f,body=writeBody(f),key) { return request(`/reviews/${f.review_id}/writeback`,{method:'POST',body,key}); }
const item = async (reviewId,code) => { const rows=ok(await request(`/reviews/${reviewId}/items`)).items; const row=rows.find(i=>i.item_code===code); assert.ok(row,code); return row; };
function state(f) {
  // Entire transactional footprint, not just content/version. Includes snapshot/meta, flags,
  // answers, report superseded, stage/current revision and idempotency cache.
  const tables=['tbl_project','tbl_document','tbl_upload_file','tbl_doc_revision','tbl_kb_doc','tbl_review_report','tbl_gate_standard','tbl_project_meta'];
  const out=Object.fromEntries(tables.map(table=>[table,all(`SELECT * FROM ${table} WHERE project_id=? ORDER BY rowid`,f.projectId)]));
  for (const table of ['tbl_review_item','tbl_gate_question','tbl_assumption']) out[table]=all(`SELECT * FROM ${table} WHERE review_id IN (SELECT review_id FROM tbl_review_report WHERE project_id=?) ORDER BY rowid`,f.projectId);
  out.tbl_idempotency=all('SELECT * FROM tbl_idempotency ORDER BY rowid');
  return out;
}
async function assertDocumentContract(f,w,{sections=['主流程与分期规划','澄清答复']}={}) {
  const doc=ok(await request(`/kb-docs/${w.kb_doc_id}`));
  assert.equal(w.kb_doc_id,f.kb.kb_doc_id); assert.equal(doc.document_id,f.document_id);
  assert.equal(w.kb_version,doc.version);
  assert.match(doc.content_hash,/^[0-9a-f]{64}$/,'GET #8 must expose a lowercase SHA-256 digest');
  assert.equal(doc.content_hash,sha(doc.content_md),'GET #8 content_hash must digest its own response Markdown');
  assert.equal(w.content_hash,doc.content_hash,'#23 and GET #8 must report the same body hash');
  assert.equal(w.changed,doc.content_md!==f.kb.content_md);
  assert.equal(doc.version,f.kb.version+(w.changed?1:0));
  assert.equal(revisionText(loadRevision(owner,w.new_revision_id)),doc.content_md);
  assert.equal(ok(await request(`/projects/${f.projectId}`)).current_revision_id,w.new_revision_id);
  assert.equal(w.deleted_lines,0); assert.equal(w.modified_lines,0);
  assert.equal(w.added_lines,doc.content_md.split('\n').length-f.kb.content_md.split('\n').length);
  assert.deepEqual(w.diff_summary,{deleted_lines:w.deleted_lines,modified_lines:w.modified_lines,added_lines:w.added_lines});
  assert.deepEqual(w.sections_added,sections);
  const prd=ok(await request(`/reviews/${f.review_id}`)).prd;
  assert.deepEqual(prd,{revision_id:w.new_revision_id,document_id:f.document_id,kb_doc_id:w.kb_doc_id,version:w.kb_version,content_hash:w.content_hash});
  const snapshot=readMeta(f.projectId,`snapshot:${w.snapshot_id}`);
  assert.equal(w.snapshot,true); assert.equal(snapshot.content_md,f.kb.content_md); assert.equal(snapshot.version,f.kb.version); assert.equal(snapshot.revision_id,f.revision_id);
  assert.equal(revisionText(loadRevision(owner,f.revision_id)),f.kb.content_md,'Old revision stays byte-identical');
  return doc;
}

// 1: Real shared frontend pure functions + source binding (not a mounted browser UI test).
for (const [label,value] of [['sentinel','__other'],['sentinel+space','__other \t\n'],['whitespace',' \t\n'],['empty',''],['undefined',undefined]]) {
  test(`01 normalizeAnswer ${label} is not a valid answer`,()=>assert.equal(normalizeAnswer(value),''));
}
test('01 normalizeAnswer preserves human words without sentinel',()=>assert.equal(normalizeAnswer(`__other  ${ANSWER} \n`),ANSWER));
const ready={busy:false,blockingOpen:0,unset:0,dirty:false,revisionChanged:true};
for (const [label,patch,reason] of [
  ['busy',{busy:true},'正在保存或审核，请稍候。'],
  ['blocking',{blockingOpen:2},'还有 2 项阻断没有作答，请补充答复。'],
  ['unset',{unset:1},'还有 1 条假设没有选择，先逐条选完再继续。'],
  ['dirty',{dirty:true},'补充内容尚未写入 PRD，请先勾选采纳并确认写入。'],
  ['unchanged revision',{revisionChanged:false},'PRD 尚无新的已写入版本，无需重复提交复审。'],
]) test(`01 reviewSubmitReasons disables submit: ${label}`,()=>assert.deepEqual(reviewSubmitReasons({...ready,...patch}),[reason]));
test('01 combinations retain every applicable reason; dirty does not emit unchanged-version duplicate',()=>{
  assert.deepEqual(reviewSubmitReasons({...ready,busy:true,blockingOpen:1,unset:1,dirty:true,revisionChanged:false}),[
    '正在保存或审核，请稍候。','还有 1 项阻断没有作答，请补充答复。','还有 1 条假设没有选择，先逐条选完再继续。','补充内容尚未写入 PRD，请先勾选采纳并确认写入。']);
  assert.deepEqual(reviewSubmitReasons(ready),[]);
});
test('01 ReviewPage submit button is disabled by shared reasons, not only click interception',async()=>{
  const source=readFileSync(join(ROOT,'web/src/pages/ReviewPage.tsx'),'utf8');
  assert.equal(/const submitReasons = reviewSubmitReasons\(/.test(source),true,'Page must use shared reviewSubmitReasons');
  assert.equal(/^\s*const canSubmit\s*=\s*!!reviewId\s*&&\s*!documentError\s*&&\s*submitReasons\.length\s*===\s*0\s*;/m.test(source),true,'Review ID, no document error AND all shared reasons must gate canSubmit');
  // Parse TSX, rather than treating the arrow in onClick={... => ...} as tag end.
  const ts=(await import('../../web/node_modules/typescript/lib/typescript.js')).default;
  const ast=ts.createSourceFile('ReviewPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const buttons=[];
  const visit=node=>{
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast)==='Button'
        && node.children.some(c=>ts.isJsxText(c) && c.text.trim()==='提交复审')) buttons.push(node);
    ts.forEachChild(node,visit);
  };
  visit(ast); assert.equal(buttons.length,1,'Exactly one submit-review button');
  const disabled=buttons[0].openingElement.attributes.properties.find(p=>ts.isJsxAttribute(p) && p.name.getText(ast)==='disabled');
  assert.ok(disabled && ts.isJsxExpression(disabled.initializer),'Submit button needs an actual disabled property');
  assert.equal(disabled.initializer.expression.getText(ast),'!canSubmit');
});

// 2: Convert -> immediate questions -> archive -> restore, with preserved human answer.
test('02 convert immediately exposes a supplementable blocking question; accept archives; convert restores',async t=>{
  const f=await fixture(); await choose(f);
  const response=await choose(f,'convert'),code=response.converted_question_code;
  assert.equal(code,`${f.assumptions[0].assumption_code}_converted`);
  const q=ok(await request(`/reviews/${f.review_id}/questions`)).items.find(q=>q.question_code===code);
  assert.ok(q,'Immediate GET must expose convert question'); assert.equal(q.title,ASSUMPTION); assert.equal(q.level,'blocking'); assert.equal(q.status,'open'); assert.equal(q.answer,''); assert.deepEqual(q.options,[]);
  ok(await request(`/questions/${code}/answers`,{method:'POST',body:{answer:`__other ${ANSWER}`}}));
  const accepted=await choose(f,'accept'); assert.equal(accepted.converted_question_code,null);
  assert.equal(ok(await request(`/reviews/${f.review_id}/questions`)).items.some(q=>q.question_code===code),false);
  assert.equal(get('SELECT status,answer FROM tbl_gate_question WHERE question_code=?',code).status,'converted');
  const restored=await choose(f,'convert'); assert.equal(restored.converted_question_code,code);
  const q2=ok(await request(`/reviews/${f.review_id}/questions`)).items.find(q=>q.question_code===code);
  assert.equal(q2.status,'answered'); assert.equal(q2.answer,ANSWER);
  assert.equal(get('SELECT COUNT(*) n FROM tbl_gate_question WHERE question_code=?',code).n,1);
  t.diagnostic(`convert=${code}; immediate open -> archived converted -> restored answered`);
});
test('02 accepted unanswered converted question does not block writeback or leave fake clarification',async()=>{
  const f=await fixture(); await choose(f,'convert'); await choose(f,'accept');
  assert.equal(get("SELECT COUNT(*) n FROM tbl_gate_question WHERE review_id=? AND level='blocking' AND status<>'converted'",f.review_id).n,1);
  const w=ok(await write(f)); const doc=await assertDocumentContract(f,w);
  assert.ok(doc.content_md.includes(`- 假设：${ASSUMPTION} → 接受`));
  assert.equal(doc.content_md.includes(`- 问：${ASSUMPTION}`),false);
});
test('02 restored unanswered converted question blocks writing until it is answered',async()=>{
  const f=await fixture(); const c=await choose(f,'convert'); await choose(f,'accept'); await choose(f,'convert');
  const before=state(f);
  rejected(await write(f),400,'还有 1 项阻断没有作答，请先补充答复再写入。'); assert.deepEqual(state(f),before);
  const body=writeBody(f); body.answers.push({question_code:c.converted_question_code,answer:ANSWER});
  const w=ok(await write(f,body)); assert.ok(ok(await request(`/kb-docs/${w.kb_doc_id}`)).content_md.includes(`- 问：${ASSUMPTION}\n  答：${ANSWER}`));
});

// 3: answers and supplements are only sent together to #23 (no pre-save #20/#22).
test('03 #23 commits human answers + accepted supplements + revision atomically, without __other',async t=>{
  const f=await fixture(); assert.equal(f.kb.content_md.split('\n').length,2); await choose(f);
  assert.equal(get('SELECT answer FROM tbl_gate_question WHERE question_code=?',f.questions[0].question_code).answer,'');
  const w=ok(await write(f)); const doc=await assertDocumentContract(f,w);
  const q=get('SELECT answer,status FROM tbl_gate_question WHERE question_code=?',f.questions[0].question_code);
  assert.deepEqual({...q},{answer:ANSWER,status:'answered'});
  assert.equal((await item(f.review_id,'A2')).supplement,COMPLETE); assert.equal((await item(f.review_id,'A2')).accepted,true);
  assert.ok(doc.content_md.includes(`## 主流程与分期规划\n\n${COMPLETE}`));
  assert.ok(doc.content_md.includes(`- 问：${QUESTION_TITLE}\n  答：${ANSWER}`));
  assert.equal(doc.content_md.includes('__other'),false);
  t.diagnostic(`v${f.kb.version}->v${w.kb_version}; revision=${w.new_revision_id}; hash=${w.content_hash}; sections=${w.sections_added.join(',')}; added_lines=${w.added_lines}`);
});
for (const answer of ['__other','__other \n\t',' \n\t']) test(`03 #23 rejects non-answer ${JSON.stringify(answer)} without partial supplement persistence`,async()=>{
  const f=await fixture(); await choose(f); const body=writeBody(f); body.answers[0].answer=answer; const before=state(f);
  rejected(await write(f,body),400,'还有 1 项阻断没有作答，请先补充答复再写入。'); assert.deepEqual(state(f),before);
});
test('03 standalone #20 normalizes human answer and rejects sentinel-only answer',async()=>{
  const f=await fixture(); const path=`/questions/${f.questions[0].question_code}/answers`;
  rejected(await request(path,{method:'POST',body:{answer:'__other   '}}),400,'请先填写答复。');
  ok(await request(path,{method:'POST',body:{answer:`__other ${ANSWER}`}}));
  assert.equal(get('SELECT answer FROM tbl_gate_question WHERE question_code=?',f.questions[0].question_code).answer,ANSWER);
});

// 4: Validation precedes every write, including all foreign project footprints.
test('04 unanswered blocking question rejects writeback and leaves all state unchanged',async()=>{
  const f=await fixture(); await choose(f); const before=state(f);
  rejected(await write(f,writeBody(f,{answers:false})),400,'还有 1 项阻断没有作答，请先补充答复再写入。'); assert.deepEqual(state(f),before);
});
test('04 unset assumption rejects writeback even with otherwise valid answers/supplements',async()=>{
  const f=await fixture(),before=state(f);
  rejected(await write(f),400,'还有 1 条假设没有选择，先逐条选完再继续。'); assert.deepEqual(state(f),before);
});
for (const kind of ['question','item']) test(`04 cross-project ${kind} rejected; neither document/answers/supplements polluted`,async()=>{
  const f=await fixture(),foreign=await fixture({foreignItem:true}); await choose(f); await choose(foreign);
  const body=writeBody(f);
  if (kind==='question') body.answers.push({question_code:foreign.questions[0].question_code,answer:'跨项目污染'});
  else { body.accepted_items.push('Z9'); body.supplements.push({item_code:'Z9',text:'跨项目污染'}); }
  const before=state(f),beforeForeign=state(foreign);
  rejected(await write(f,body),400,kind==='question'?'答复包含不属于该评分卡的问题。':'包含不属于该评分卡的条目。');
  assert.deepEqual(state(f),before); assert.deepEqual(state(foreign),beforeForeign);
});
test('04 outsider cannot write a known review (403, no real account)',async()=>{
  const f=await fixture(); await choose(f); const before=state(f);
  rejected(await request(`/reviews/${f.review_id}/writeback`,{method:'POST',tk:outsiderToken,body:writeBody(f)}),403,'你没有权限访问这个项目。','FORBIDDEN'); assert.deepEqual(state(f),before);
});
for (const [key,value,message] of [['confirm',false,'回写需要显式确认。'],['snapshot',false,'回写必须保存原文快照。']]) test(`04 requires ${key}`,async()=>{
  const f=await fixture(); await choose(f); const body={...writeBody(f),[key]:value},before=state(f);
  rejected(await write(f,body),400,message); assert.deepEqual(state(f),before);
});

// 5: Historical standard group titles must be mapped locally, not migrated.
test('05 historical group-title standards land A2 under exact section without modifying any standard row',async t=>{
  const f=await fixture({historical:true}); await choose(f);
  const historic=all('SELECT * FROM tbl_gate_standard WHERE project_id=? ORDER BY version',f.projectId);
  assert.ok(JSON.parse(historic[0].items_json).every(i=>i.title===GROUPS[i.code[0]]));
  // Move current standard forward: writeback must still respect report's old version.
  const s=ok(await request(`/projects/${f.projectId}/gate-standards`));
  ok(await request(`/projects/${f.projectId}/gate-standards`,{method:'PUT',tk:adminToken,body:{items:s.items.map(i=>({...i,title:i.code==='A2'?'新的自定义主流程标题':i.title}))},headers:{'if-match':String(s.version)}}));
  const before=all('SELECT * FROM tbl_gate_standard WHERE project_id=? ORDER BY version',f.projectId);
  const w=ok(await write(f)); const doc=await assertDocumentContract(f,w);
  assert.ok(doc.content_md.includes('## 主流程与分期规划\n')); assert.equal(doc.content_md.includes('## 需求完整性\n'),false); assert.equal(doc.content_md.includes('## 新的自定义主流程标题\n'),false);
  assert.deepEqual(all('SELECT * FROM tbl_gate_standard WHERE project_id=? ORDER BY version',f.projectId),before);
  // #24 legitimately retires v1 before writeback; its content/version is immutable.
  assert.deepEqual({...before[0]},{...historic[0],is_current:0}); assert.equal(ok(await request(`/reviews/${f.review_id}`)).standard_version,1);
  t.diagnostic('historical v1 unchanged; current v2 unchanged; A2 -> ## 主流程与分期规划');
});
test('05 custom historical item title is preserved rather than overwritten by defaults',async()=>{
  const p=await newProject(),std=ok(await request(`/projects/${p}/gate-standards`));
  ok(await request(`/projects/${p}/gate-standards`,{method:'PUT',tk:adminToken,body:{items:std.items.map(i=>({...i,title:i.code==='A2'?'业务专属流程':i.title}))},headers:{'if-match':String(std.version)}}));
  const parsed=await parse(p),r=await review(parsed.revision_id),f={...parsed,...r,questions:ok(await request(`/reviews/${r.review_id}/questions`)).items,assumptions:ok(await request(`/reviews/${r.review_id}/assumptions`)).items}; await choose(f);
  const w=ok(await write(f)); await assertDocumentContract(f,w,{sections:['业务专属流程','澄清答复']});
});

// 6: Exact insertion oracle; not just fuzzy "old text exists" or a heading-count check.
const FENCED='```md\n## 主流程与分期规划\n仅代码块中的伪标题\n```';
const RICH=`${DEMO}\n\n## 原有说明\n逐字保留：空格  双空格，标点！\n\n${FENCED}\n\n## 主流程与分期规划\n原有正文 A。\n### 三级子标题\n子节正文 B，不能删。\n~~~txt\n## 另一伪标题\n代码里的正文 C。\n~~~\n\n## 尾部其他章节\n其他正文 D。\n`;
test('06 insertion preserves all original headings/subheadings/fences/body byte-for-byte',async()=>{
  const f=await fixture({text:RICH}); await choose(f); const w=ok(await write(f)); const doc=await assertDocumentContract(f,w);
  const clarification=`- 问：${QUESTION_TITLE}\n  答：${ANSWER}\n- 假设：${ASSUMPTION} → 接受`;
  const expected=RICH.replace('## 尾部其他章节',`\n${COMPLETE}\n\n## 尾部其他章节`)+`\n\n## 澄清答复\n\n${clarification}\n`;
  assert.equal(doc.content_md,expected,'Only the known insertion hunks may differ');
  assert.ok(doc.content_md.includes(FENCED)); assert.ok(doc.content_md.includes('### 三级子标题\n子节正文 B，不能删。'));
  assert.ok(doc.content_md.indexOf(COMPLETE)>doc.content_md.indexOf('代码里的正文 C。'));
  assert.ok(doc.content_md.indexOf(COMPLETE)<doc.content_md.indexOf('## 尾部其他章节'));
});
test('06 suggestion-only acceptance is inserted literally, not treated as solving the item',async()=>{
  const f=await fixture(); await choose(f); const suggestion=(await item(f.review_id,'A2')).suggestion;
  const w=ok(await write(f,writeBody(f,{supplement:'',accepted:['A2']})));
  const doc=ok(await request(`/kb-docs/${w.kb_doc_id}`));
  assert.ok(doc.content_md.startsWith(DEMO)); assert.ok(doc.content_md.includes(`## 评审采纳建议\n\n- [A2] ${suggestion}`));
  assert.equal(doc.content_md.includes('## 主流程与分期规划'),false);
  const r=await review(w.new_revision_id),a2=await item(r.review_id,'A2');
  assert.equal(a2.verdict,'fail'); assert.equal(a2.supplement,'');
  assert.equal(a2.suggestion,suggestion); assert.equal(a2.accepted,true,'Same suggestion actually written in Markdown inherits acceptance, but not pass');
});

// 7: Flat diff + diff_summary, revision/KB/#17 identity, changed and no-op cases.
test('07 GET #8 hashes its own exact body before writeback, after edits and for empty Markdown',async()=>{
  const f=await fixture();
  let doc=ok(await request(`/kb-docs/${f.kb.kb_doc_id}`));
  assert.equal(doc.content_md,DEMO); assert.equal(doc.content_hash,sha(DEMO));
  const originalHash=doc.content_hash;
  for (const content of ['# 原文哈希\r\n\r\n中文、emoji 🧪，空格  不可归一化。\r\n','']) {
    const edited=ok(await request(`/kb-docs/${doc.kb_doc_id}`,{method:'PUT',body:{content_md:content},headers:{'if-match':String(doc.version)}}));
    const previousHash=doc.content_hash,before=state(f);
    doc=ok(await request(`/kb-docs/${doc.kb_doc_id}`));
    assert.equal(doc.version,edited.version); assert.equal(doc.content_md,content);
    assert.match(doc.content_hash,/^[0-9a-f]{64}$/); assert.equal(doc.content_hash,sha(doc.content_md));
    assert.notEqual(doc.content_hash,previousHash,'GET #8 must not reuse a stale version hash');
    assert.notEqual(doc.content_hash,originalHash);
    assert.equal(revisionText(loadRevision(owner,ok(await request(`/projects/${f.projectId}`)).current_revision_id)),content);
    assert.deepEqual(state(f),before,'Reading body and hash must not mutate stored state');
  }
});
test('07 writeback response matches GET #8, revisionText and #17.prd including SHA-256',async t=>{
  const f=await fixture(); await choose(f); const w=ok(await write(f)); await assertDocumentContract(f,w);
  assert.equal(w.changed,true); assert.notEqual(w.new_revision_id,f.revision_id);
  assert.equal(ok(await request(`/reviews/${f.review_id}`)).superseded,true);
  t.diagnostic(JSON.stringify({diff:w.diff_summary,new_revision_id:w.new_revision_id,kb_doc_id:w.kb_doc_id,kb_version:w.kb_version,content_hash:w.content_hash,sections_added:w.sections_added}));
});
test('07 repeat same content from a current new review returns changed=false, zero diff, no new revision/version',async()=>{
  const f=await fixture(); await choose(f); const first=ok(await write(f,writeBody(f,{supplement:INCOMPLETE})));
  const r=await review(first.new_revision_id),kb=ok(await request(`/kb-docs/${first.kb_doc_id}`));
  const next={...f,...r,revision_id:first.new_revision_id,kb,questions:ok(await request(`/reviews/${r.review_id}/questions`)).items,assumptions:ok(await request(`/reviews/${r.review_id}/assumptions`)).items}; await choose(next);
  const count=get('SELECT COUNT(*) n FROM tbl_doc_revision WHERE document_id=?',f.document_id).n;
  const w=ok(await write(next,writeBody(next,{supplement:INCOMPLETE}))); await assertDocumentContract(next,w);
  assert.equal(w.changed,false); assert.equal(w.new_revision_id,first.new_revision_id); assert.equal(w.kb_version,first.kb_version); assert.equal(w.added_lines,0);
  assert.equal(get('SELECT COUNT(*) n FROM tbl_doc_revision WHERE document_id=?',f.document_id).n,count);
});

// 8: Adapter input must be exact new body. B1 remains unresolved, regardless of accepted.
test('08 rereview receives newly written body; A2 passes on body evidence, unresolved accepted B1 still fails',async t=>{
  const f=await fixture(); await choose(f);
  assert.equal((await item(f.review_id,'A2')).verdict,'fail'); assert.equal((await item(f.review_id,'B1')).verdict,'fail');
  const n=receipts.length,w=ok(await write(f,writeBody(f,{accepted:['A2','B1']}))),doc=ok(await request(`/kb-docs/${w.kb_doc_id}`));
  const r=await review(w.new_revision_id); assert.equal(receipts.length,n+1);
  const receipt=receipts.at(-1); assert.equal(receipt.input.markdown,doc.content_md); assert.equal(sha(receipt.input.markdown),w.content_hash);
  assert.deepEqual(Object.keys(receipt.input).sort(),['extended','level','markdown','model','standardItems']);
  assert.equal(receipt.items.length,ok(await request(`/reviews/${r.review_id}/items`)).items.length);
  const a2=await item(r.review_id,'A2'),b1=await item(r.review_id,'B1');
  assert.equal(a2.verdict,'pass'); assert.equal(a2.evidence_ref,`正文证据：${COMPLETE}`); assert.equal(a2.accepted,false);
  assert.equal(b1.verdict,'fail'); assert.equal(b1.evidence_ref,'缺少 B1 的可验证正文证据');
  const report=ok(await request(`/reviews/${r.review_id}`)); assert.equal(report.verdict,'blocked'); assert.ok(report.counts.blocking>0);
  assert.equal(report.revision_id,w.new_revision_id); assert.equal(report.prd.content_hash,w.content_hash);
  t.diagnostic(`Adapter called once on new hash ${w.content_hash}; A2 pass on FLOW+PHASES, accepted B1 remains fail; overall blocked`);
});
test('08 title-only / insufficient supplement cannot pass A2 even when accepted',async()=>{
  const f=await fixture({text:DEMO+'\n\n## 主流程与分期规划\n'}); await choose(f);
  const w=ok(await write(f,writeBody(f,{supplement:INCOMPLETE}))),r=await review(w.new_revision_id);
  assert.equal((await item(r.review_id,'A2')).verdict,'fail'); assert.equal(ok(await request(`/reviews/${r.review_id}`)).verdict,'blocked');
  assert.equal((await item(r.review_id,'A2')).accepted,true,'Acceptance may persist, but must not override model result');
});

// 9: Acceptance/supplement inheritance requires exact written text AND same document chain.
test('09 checkbox-only acceptance without suggestion in Markdown is not inherited on same-revision rereview',async()=>{
  const f=await fixture(); await choose(f);
  const old=await item(f.review_id,'A2'),beforeDoc=ok(await request(`/kb-docs/${f.kb.kb_doc_id}`));
  assert.equal(old.verdict,'fail'); assert.notEqual(old.suggestion,''); assert.equal(old.supplement,'');
  const accepted=ok(await request(`/reviews/${f.review_id}/accept-candidates`,{method:'POST',body:{item_codes:['A2']}}));
  assert.deepEqual(accepted,{accepted_items_count:1,wrote_prd:false});
  ok(await request(`/questions/${f.questions[0].question_code}/answers`,{method:'POST',body:{answer:ANSWER}}));
  const doc=ok(await request(`/kb-docs/${f.kb.kb_doc_id}`));
  assert.deepEqual(doc,beforeDoc); assert.equal(doc.content_md.includes(old.suggestion),false);
  assert.equal((await item(f.review_id,'A2')).accepted,true);
  const r=await review(f.revision_id),a2=await item(r.review_id,'A2');
  assert.equal(receipts.at(-1).input.markdown,doc.content_md);
  assert.equal(a2.verdict,'fail'); assert.equal(a2.suggestion,old.suggestion); assert.equal(a2.supplement,'');
  assert.equal(a2.accepted,false,'Identical nonempty old/new suggestion and accepted flag alone must not inherit');
  assert.equal((await item(f.review_id,'A2')).accepted,true,'Rereview must leave the old report flag intact');
});
test('09 suggestion-only acceptance stops inheriting after its text is removed from same-document Markdown',async()=>{
  const f=await fixture(); await choose(f); const old=await item(f.review_id,'A2');
  assert.notEqual(old.suggestion,''); assert.equal(old.supplement,'');
  const w=ok(await write(f,writeBody(f,{supplement:''}))),r=await review(w.new_revision_id);
  const written=await item(r.review_id,'A2'),doc=ok(await request(`/kb-docs/${w.kb_doc_id}`));
  assert.equal(written.verdict,'fail'); assert.equal(written.supplement,'');
  assert.equal(written.suggestion,old.suggestion); assert.equal(written.accepted,true);
  assert.ok(doc.content_md.includes(old.suggestion));
  const editedBody=doc.content_md.replaceAll(old.suggestion,'该建议已从正文删除。');
  assert.equal(editedBody.includes(old.suggestion),false);
  ok(await request(`/kb-docs/${w.kb_doc_id}`,{method:'PUT',body:{content_md:editedBody},headers:{'if-match':String(doc.version)}}));
  const revision=ok(await request(`/projects/${f.projectId}`)).current_revision_id;
  assert.notEqual(revision,w.new_revision_id); assert.equal(loadRevision(owner,revision).document_id,f.document_id);
  const next=await review(revision),a2=await item(next.review_id,'A2');
  assert.equal(receipts.at(-1).input.markdown,editedBody);
  assert.equal(a2.verdict,'fail'); assert.equal(a2.suggestion,old.suggestion); assert.equal(a2.supplement,'');
  assert.equal(a2.accepted,false,'Same-document old acceptance must clear when only the suggestion body is removed');
  assert.equal((await item(r.review_id,'A2')).accepted,true,'Previously written report stays intact');
});
for (const [label,supplement,verdict] of [['resolved',COMPLETE,'pass'],['unresolved',INCOMPLETE,'fail']]) test(`09 new review echoes old written supplement: ${label}`,async()=>{
  const f=await fixture(); await choose(f); const w=ok(await write(f,writeBody(f,{supplement}))),r=await review(w.new_revision_id);
  const a2=await item(r.review_id,'A2'); assert.equal(a2.supplement,supplement); assert.equal(a2.verdict,verdict); assert.equal(a2.accepted,verdict==='fail');
});
test('09 removed body supplement is not inherited into same-document new review',async()=>{
  const f=await fixture(); await choose(f); const w=ok(await write(f,writeBody(f,{supplement:INCOMPLETE}))),r=await review(w.new_revision_id);
  assert.equal((await item(r.review_id,'A2')).supplement,INCOMPLETE);
  const doc=ok(await request(`/kb-docs/${w.kb_doc_id}`));
  ok(await request(`/kb-docs/${w.kb_doc_id}`,{method:'PUT',body:{content_md:doc.content_md.replace(INCOMPLETE,'正文已删除该补充')},headers:{'if-match':String(doc.version)}}));
  const revision=ok(await request(`/projects/${f.projectId}`)).current_revision_id;
  const next=await review(revision); assert.equal((await item(next.review_id,'A2')).supplement,'');
});
test('09 another upload document never inherits even with identical filename and identical written body',async t=>{
  const f=await fixture(); await choose(f); const w=ok(await write(f,writeBody(f,{supplement:INCOMPLETE}))),r=await review(w.new_revision_id);
  assert.equal((await item(r.review_id,'A2')).supplement,INCOMPLETE);
  const doc=ok(await request(`/kb-docs/${w.kb_doc_id}`)),other=await parse(f.projectId,doc.content_md),next=await review(other.revision_id);
  assert.notEqual(other.document_id,f.document_id); assert.notEqual(other.kb.kb_doc_id,f.kb.kb_doc_id);
  const a2=await item(next.review_id,'A2'); assert.equal(a2.supplement,''); assert.equal(a2.accepted,false); assert.equal(a2.verdict,'fail');
  assert.equal((await item(r.review_id,'A2')).supplement,INCOMPLETE,'Old report remains intact');
  t.diagnostic('Same filename + same bytes, different document_id: supplement and accepted state isolated');
});

// 10: Concurrent same-key single commit + transaction fault injection + same-key retry.
test('10 concurrent same-key writes create exactly one snapshot/revision/KB version',async t=>{
  const f=await fixture(); await choose(f); const key=randomUUID(),body=writeBody(f);
  const count=get('SELECT COUNT(*) n FROM tbl_doc_revision WHERE document_id=?',f.document_id).n;
  const responses=await Promise.all(Array.from({length:6},()=>write(f,body,key))),writes=responses.map(r=>ok(r));
  for (const w of writes) assert.deepEqual(w,writes[0]);
  const w=writes[0]; await assertDocumentContract(f,w);
  assert.equal(get('SELECT COUNT(*) n FROM tbl_doc_revision WHERE document_id=?',f.document_id).n,count+1);
  assert.equal(get("SELECT COUNT(*) n FROM tbl_project_meta WHERE project_id=? AND meta_key LIKE 'snapshot:%'",f.projectId).n,1);
  const before=state(f); assert.deepEqual(ok(await write(f,body,key)),w); assert.deepEqual(state(f),before);
  t.diagnostic(`6 concurrent requests + replay -> one snapshot=${w.snapshot_id}, one revision=${w.new_revision_id}, KB +1`);
});
const faultPoints=[
  ['snapshot',"BEFORE INSERT ON tbl_project_meta WHEN NEW.meta_key LIKE 'snapshot:%'"],
  ['supplement',"BEFORE UPDATE OF supplement ON tbl_review_item WHEN NEW.supplement<>OLD.supplement"],
  ['KB body',"BEFORE UPDATE OF content_md ON tbl_kb_doc WHEN NEW.content_md<>OLD.content_md"],
  ['revision',"BEFORE INSERT ON tbl_doc_revision"],
  ['post-revision invalidation',"BEFORE UPDATE OF stage ON tbl_project WHEN NEW.stage='kb_ready'"],
];
for (const [label,point] of faultPoints) test(`10 fault at ${label} rolls back answers/supplements/snapshot/KB/revision/stage/report; same key retry succeeds`,async t=>{
  const f=await fixture(); await choose(f); const body=writeBody(f),key=randomUUID(),before=state(f);
  db.exec(`CREATE TEMP TRIGGER rw_injected_fault ${point} BEGIN SELECT RAISE(FAIL,'rw regression injected failure'); END;`);
  try {
    const response=await write(f,body,key); rejected(response,500,'出了点问题。','INTERNAL');
    assert.deepEqual(state(f),before,'All transactional state must match pre-request, including no successful idempotency entry');
    t.diagnostic(`Injected ${label}: HTTP ${response.status} ${response.code}; entire transaction unchanged`);
  } finally { db.exec('DROP TRIGGER IF EXISTS rw_injected_fault'); }
  const w=ok(await write(f,body,key)); await assertDocumentContract(f,w);
});

test('isolation guard: no external fetch; every generated upload/fixture resides under workspace .tmp',()=>{
  assert.equal(networkAttempts.length,0); assert.equal(process.env.AD_DB_PATH,':memory:');
  assert.ok(worktmp.startsWith(join(ROOT,'.tmp/'))); assert.ok(process.env.AD_UPLOAD_DIR.startsWith(worktmp));
  assert.equal(db.prepare('PRAGMA database_list').get().file,'');
});
