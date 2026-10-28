import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.AD_DB_PATH=':memory:';
process.env.AD_LOG_LEVEL='fatal';
process.env.AD_UPLOAD_DIR=mkdtempSync(resolve('.tmp-b2-uploads-'));
// `#72` 账号密码登录（本地开发方式）：用独立密码，避免与任何真实配置耦合
process.env.AD_PASSWORD_LOGIN='development';
const DEV_PW='regression-pw-123';
process.env.AD_DEV_PASSWORD=DEV_PW;
const {buildApp}=await import('../src/app.ts');
const {db,get,all,run}=await import('../src/db/index.ts');
const {ensureUser,issueToken}=await import('../src/core/auth.ts');
const {createMockAdapter}=await import('../src/adapters/llm.ts');
const {createTask,startTask,getTask,cancelTask}=await import('../src/core/tasks.ts');
const {readMeta}=await import('../src/core/revisions.ts');
const {parseDocument}=await import('../src/adapters/parser.ts');
const fixture=readFileSync('../samples/prd.docx');
const markdown='# 隔离回归 PRD\n\n'+['背景','主流程','范围与目标','状态机','异常失败','字段数据','属性样式','页面元素','文案字样','接口API','权限角色','生成验证','角落组合','假设'].map(s=>`## ${s}\n\n测试内容。`).join('\n\n');
const owner=ensureUser('owner_test','测试用户'); const token=issueToken(owner.user_id);
const other=ensureUser('other_test','另一用户'); const otherToken=issueToken(other.user_id);
let reviewHook=null, splitHook=null;
const base=createMockAdapter();
const adapter={kind:'mock',review:async input=>reviewHook?reviewHook(input):base.review(input),split:async input=>splitHook?splitHook(input):base.split(input)};
const app=buildApp({llm:adapter}); await app.ready();
async function request(path,{method='GET',body,token:tk=token,key,headers={}}={}) {
 const res=await app.inject({method,url:'/api/v1'+path,headers:{authorization:`Bearer ${tk}`,...(key?{'idempotency-key':key}:{}),...headers},...(body!==undefined?{payload:body}:{})});
 return {status:res.statusCode,...res.json()};
}
function expect(r,status){assert.equal(r.status,status,JSON.stringify(r));return r.data;}
async function project(){return expect(await request('/projects',{method:'POST',body:{name:'B2回归'}}),201).project_id;}
async function upload(p,text=markdown,name='test.md',key){
 const boundary='----regression-boundary';
 const payload=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),Buffer.isBuffer(text)?text:Buffer.from(text),Buffer.from(`\r\n--${boundary}--\r\n`)]);
 return request(`/projects/${p}/uploads`,{method:'POST',body:payload,key,headers:{'content-type':`multipart/form-data; boundary=${boundary}`}});
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(id){for(let i=0;i<300;i++){const t=expect(await request(`/tasks/${id}`),200);if(!['queued','running'].includes(t.status)) return t;await sleep(5);}throw Error('task did not settle');}
async function parse(p,text=markdown,name='test.md'){
 const u=expect(await upload(p,text,name),201);const submitted=expect(await request(`/documents/${u.document_id}/revisions`,{method:'POST',key:crypto.randomUUID()}),202);
 assert.equal((await wait(submitted.task_id)).status,'succeeded');return {...u,...submitted};
}
async function review(rev){const r=expect(await request(`/revisions/${rev}/reviews`,{method:'POST',body:{}}),202);await wait(r.task_id);return r;}
async function accept(r){const rows=expect(await request(`/reviews/${r}/assumptions`),200).items;for(const a of rows)expect(await request(`/reviews/${r}/assumptions`,{method:'POST',body:{assumption_code:a.assumption_code,choice:'accept'}}),200);}
function deferred(){let release;const promise=new Promise(r=>release=r);return {promise,release};}
await test('B2 HTTP / lifecycle regression',async t=>{
 try {
 await t.test('未确认告知不得上传/生成',async()=>{const p=await project();expect(await upload(p),400);expect(await request('/users/me/ai-egress',{method:'PUT',body:{consent_acknowledged:true}}),200);});
 await t.test('本地 Markdown 解析、自动入库和 current_revision_id',async()=>{const p=await project(),r=await parse(p);assert.equal(expect(await request(`/projects/${p}`),200).current_revision_id,r.revision_id);assert.equal(expect(await request(`/projects/${p}/kb-docs`),200).total,1);assert.equal(expect(await request(`/revisions/${r.revision_id}/parse-result`),200).empty_document,false);});
 await t.test('DOCX 表格纯净且无行间空行，后续标题保留',async()=>{const r=parseDocument('prd.docx',fixture);assert.match(r.markdown,/\| 字段 \| 类型 \|\n\|/);assert.match(r.markdown,/## 状态机/);assert.doesNotMatch(r.markdown,/<w:/);});
 await t.test('同名不同文档隔离 / 旧 revision 留存',async()=>{const p=await project(),a=await parse(p),b=await parse(p);assert.notEqual(a.document_id,b.document_id);assert.equal(expect(await request(`/projects/${p}/kb-docs`),200).total,2);const c=expect(await request(`/documents/${a.document_id}/revisions`,{method:'POST'}),202);await wait(c.task_id);assert.equal(expect(await request(`/documents/${a.document_id}/revisions`),200).items.length,2);});
 await t.test('上传同键并发重放不新增文档',async()=>{const p=await project();const rs=await Promise.all([upload(p,markdown,'idem.md','upload-same'),upload(p,markdown,'idem.md','upload-same')]);assert.equal(expect(rs[0],201).document_id,expect(rs[1],201).document_id);assert.equal(get('SELECT COUNT(*) n FROM tbl_document WHERE project_id=?',p).n,1);});
 await t.test('外部图片引用标为缺失 / 手补只修改所属文档',async()=>{const p=await project(),b=await parse(p),a=await parse(p,markdown+'\n![图](https://invalid.example/missing.png)');const result=expect(await request(`/revisions/${a.revision_id}/parse-result`),200);assert.equal(result.parse_status,'partial');assert.equal(result.parts.attachments[0].status,'failed');expect(await request(`/revisions/${a.revision_id}/parts/attachment:missing.png/manual-supplement`,{method:'POST',body:{content:'该图片说明'}}),200);assert.match(get('SELECT content_md FROM tbl_kb_doc WHERE document_id=?',a.document_id).content_md,/该图片说明/);assert.doesNotMatch(get('SELECT content_md FROM tbl_kb_doc WHERE document_id=?',b.document_id).content_md,/该图片说明/);assert.equal(expect(await request(`/revisions/${a.revision_id}/parse-result`),200).parse_status,'succeeded');});
 await t.test('损坏文件任务 failed，不修改当前版本',async()=>{const p=await project(),a=await parse(p);const u=expect(await upload(p,'not zip','broken.docx'),201);const r=expect(await request(`/documents/${u.document_id}/revisions`,{method:'POST'}),202);assert.equal((await wait(r.task_id)).status,'failed');assert.equal(expect(await request(`/revisions/${r.revision_id}/parse-result`),200).parse_status,'failed');assert.equal(expect(await request(`/projects/${p}`),200).current_revision_id,a.revision_id);expect(await upload(p,'x','bad.exe'),422);});
 await t.test('审核输入取 revision 快照，不取项目最新 KB',async()=>{const p=await project(),a=await parse(p);const before=get('SELECT content_md FROM tbl_kb_doc WHERE document_id=?',a.document_id).content_md;run(`INSERT INTO tbl_kb_doc(kb_doc_id,project_id,title,sector,origin,content_md,version,created_at,updated_at) VALUES('decoy',?,'诱饵','prd','user_uploaded','错误正文',1,'2099','2099')`,p);let received;reviewHook=async input=>{received=input.markdown;return base.review(input);};await review(a.revision_id);reviewHook=null;assert.equal(received,before);});
 await t.test('空结构审核不能 passed',async()=>{const p=await project(),a=await parse(p);reviewHook=async()=>({items:[],questions:[],assumptions:[]});const r=await review(a.revision_id);reviewHook=null;assert.equal((await wait(r.task_id)).status,'failed');assert.equal(expect(await request(`/reviews/${r.review_id}`),200).verdict,'failed');expect(await request(`/projects/${p}/splits`,{method:'POST',body:{}}),400);});
 await t.test('无审核、阻断未答及 unset 假设不能拆解',async()=>{const p=await project();expect(await request(`/projects/${p}/splits`,{method:'POST',body:{}}),400);const a=await parse(p,'# PRD\n## 背景\n缺主流程');await review(a.revision_id);expect(await request(`/projects/${p}/splits`,{method:'POST',body:{}}),400);const b=await parse(p),r=await review(b.revision_id);assert.equal(expect(await request(`/reviews/${r.review_id}`),200).verdict,'passed');expect(await request(`/projects/${p}/splits`,{method:'POST',body:{}}),400);await accept(r.review_id);const task=expect(await request(`/projects/${p}/splits`,{method:'POST',body:{}}),202);assert.equal((await wait(task.task_id)).status,'succeeded');});
 await t.test('假设 convert 产生待澄清且阻止放行',async()=>{const p=await project(),a=await parse(p),r=await review(a.revision_id);await accept(r.review_id);const code=expect(await request(`/reviews/${r.review_id}/assumptions`),200).items[0].assumption_code;expect(await request(`/reviews/${r.review_id}/assumptions`,{method:'POST',body:{assumption_code:code,choice:'convert'}}),200);assert.equal(expect(await request(`/reviews/${r.review_id}/questions`),200).items.length,1);expect(await request(`/projects/${p}/splits`,{method:'POST',body:{}}),400);});
 await t.test('取消审核后响应不得写入报告和阶段',async()=>{const p=await project(),a=await parse(p),d=deferred();reviewHook=async input=>{await d.promise;return base.review(input);};const r=expect(await request(`/revisions/${a.revision_id}/reviews`,{method:'POST',body:{}}),202);await sleep(10);expect(await request(`/tasks/${r.task_id}/cancel`,{method:'POST'}),200);assert.equal(get('SELECT verdict FROM tbl_review_report WHERE review_id=?',r.review_id).verdict,'failed');assert.notEqual(expect(await request(`/projects/${p}`),200).stage,'reviewing');d.release();await sleep(30);reviewHook=null;assert.equal(getTask(r.task_id).status,'canceled');assert.equal(get('SELECT COUNT(*) n FROM tbl_review_item WHERE review_id=?',r.review_id).n,0);assert.notEqual(expect(await request(`/projects/${p}`),200).stage,'gate_passed');});
 await t.test('超时后 commit 被拒绝，无业务副作用',async()=>{const p=await project(),d=deferred(),task=createTask({projectId:p,type:'split'});let writes=0;startTask(task.task_id,async ctx=>{await d.promise;return ctx.commit(()=>{writes++;return null;});},{timeoutMs:15});await sleep(30);d.release();await sleep(30);assert.equal(getTask(task.task_id).status,'timeout');assert.equal(writes,0);});
 await t.test('新 revision 使旧审核失效 / 旧 worker 不覆盖新结果',async()=>{const p=await project(),a=await parse(p),d=deferred();reviewHook=async input=>{await d.promise;return base.review(input);};const r=expect(await request(`/revisions/${a.revision_id}/reviews`,{method:'POST',body:{}}),202);await sleep(10);await parse(p);d.release();await sleep(30);reviewHook=null;assert.equal(getTask(r.task_id).status,'failed');assert.equal(expect(await request(`/reviews/${r.review_id}`),200).superseded,true);expect(await request(`/reviews/${r.review_id}/accept-candidates`,{method:'POST',body:{item_codes:[]}}),409);});
 await t.test('采纳只勾选 / 回写真快照 / 同键重放一次',async()=>{const p=await project(),a=await parse(p,markdown.replace('## 范围与目标','## 其他')),r=await review(a.revision_id);await accept(r.review_id);const kb=get('SELECT * FROM tbl_kb_doc WHERE document_id=?',a.document_id),items=expect(await request(`/reviews/${r.review_id}/items`),200).items.filter(i=>i.suggestion).map(i=>i.item_code);expect(await request(`/reviews/${r.review_id}/accept-candidates`,{method:'POST',body:{item_codes:items}}),200);assert.equal(get('SELECT content_md FROM tbl_kb_doc WHERE document_id=?',a.document_id).content_md,kb.content_md);const body={confirm:true,snapshot:true,accepted_items:items};const one=expect(await request(`/reviews/${r.review_id}/writeback`,{method:'POST',body,key:'write-same'}),200),two=expect(await request(`/reviews/${r.review_id}/writeback`,{method:'POST',body,key:'write-same'}),200);assert.equal(one.snapshot_id,two.snapshot_id);assert.equal(readMeta(p,`snapshot:${one.snapshot_id}`).content_md,kb.content_md);assert.equal(one.modified_lines,0);assert.ok(one.added_lines>0);assert.equal(get('SELECT version FROM tbl_kb_doc WHERE document_id=?',a.document_id).version,kb.version+1);});
 await t.test('#29 分页形状 / 拆解单飞与幂等 / 两项目事件隔离',async()=>{const p=await project(),a=await parse(p),r=await review(a.revision_id);await accept(r.review_id);const d=deferred();splitHook=async input=>{await d.promise;return base.split(input);};const first=expect(await request(`/projects/${p}/splits`,{method:'POST',body:{},key:'split-same'}),202);const replay=expect(await request(`/projects/${p}/splits`,{method:'POST',body:{},key:'split-same'}),202);assert.equal(first.task_id,replay.task_id);expect(await request(`/projects/${p}/splits`,{method:'POST',body:{},key:'different'}),409);await sleep(10);d.release();await wait(first.task_id);splitHook=null;const packs=expect(await request(`/projects/${p}/requirements`),200);assert.equal(packs.items.length,5);assert.equal(packs.total,5);assert.equal(packs.requirement_count,packs.items.reduce((n,p)=>n+p.reqs.length,0));assert.equal(expect(await request(`/projects/${p}/requirements?page=999`),200).items.length,0);assert.equal(expect(await request(`/projects/${p}/traceability-matrix`),200).items.every(i=>i.coverage_status==='GAP'),true);const q=await project(),b=await parse(q),v=await review(b.revision_id);await accept(v.review_id);const second=expect(await request(`/projects/${q}/splits`,{method:'POST',body:{}}),202);assert.equal((await wait(second.task_id)).status,'succeeded');assert.equal(expect(await request(`/projects/${p}/tracking-plan`),200).items.length,10);assert.equal(expect(await request(`/projects/${q}/tracking-plan`),200).items.length,10);});
 await t.test('F1 解析迟到不得覆盖已保存编辑',async()=>{const p=await project(),a=await parse(p),kb=get('SELECT * FROM tbl_kb_doc WHERE document_id=?',a.document_id);const r=expect(await request(`/documents/${a.document_id}/revisions`,{method:'POST'}),202);expect(await request(`/kb-docs/${kb.kb_doc_id}`,{method:'PUT',body:{content_md:markdown+'\n新编辑'},headers:{'if-match':String(kb.version)}}),200);assert.equal((await wait(r.task_id)).status,'failed');assert.match(get('SELECT content_md FROM tbl_kb_doc WHERE document_id=?',a.document_id).content_md,/新编辑/);});
 await t.test('F2 历史版本手补拒绝而不污染新正文',async()=>{const p=await project(),a=await parse(p,markdown+'\n![图](https://invalid.example/missing.png)');const r=expect(await request(`/documents/${a.document_id}/revisions`,{method:'POST'}),202);await wait(r.task_id);const before=get('SELECT content_md FROM tbl_kb_doc WHERE document_id=?',a.document_id).content_md;expect(await request(`/revisions/${a.revision_id}/parts/attachment:missing.png/manual-supplement`,{method:'POST',body:{content:'旧补充'}}),409);assert.equal(get('SELECT content_md FROM tbl_kb_doc WHERE document_id=?',a.document_id).content_md,before);});
 await t.test('F3 revision 插入故障导致 #9 整体回滚',async()=>{const p=await project(),a=await parse(p),kb=get('SELECT * FROM tbl_kb_doc WHERE document_id=?',a.document_id);db.exec("CREATE TEMP TRIGGER fail_revision BEFORE INSERT ON tbl_doc_revision BEGIN SELECT RAISE(FAIL,'injected'); END;");try{expect(await request(`/kb-docs/${kb.kb_doc_id}`,{method:'PUT',body:{content_md:'不应保存'},headers:{'if-match':String(kb.version)}}),500);assert.equal(get('SELECT content_md FROM tbl_kb_doc WHERE document_id=?',a.document_id).content_md,kb.content_md);assert.equal(get('SELECT version FROM tbl_kb_doc WHERE document_id=?',a.document_id).version,kb.version);}finally{db.exec('DROP TRIGGER fail_revision');}});
 await t.test('开发飞书链接解析 partial 且原文链接正确传递',async()=>{const p=await project(),u=expect(await request(`/projects/${p}/documents`,{method:'POST',body:{source_type:'feishu_link',feishu_token:'https://example.feishu.cn/docx/test'}}),201);const r=expect(await request(`/documents/${u.document_id}/revisions`,{method:'POST'}),202);assert.equal((await wait(r.task_id)).status,'succeeded');assert.equal(expect(await request(`/revisions/${r.revision_id}/parse-result`),200).parse_status,'partial');});
 await t.test('管理员标准版本乐观锁 / 历史评分不重算',async()=>{const p=await project(),a=await parse(p),r=await review(a.revision_id);const admin=ensureUser('admin_test','管理员');run("UPDATE tbl_user SET role='admin' WHERE user_id=?",admin.user_id);const tk=issueToken(admin.user_id);const std=expect(await request(`/projects/${p}/gate-standards`,{token:tk}),200);expect(await request(`/projects/${p}/gate-standards`,{method:'PUT',token:tk,body:{items:std.items},headers:{'if-match':String(std.version)}}),200);expect(await request(`/projects/${p}/gate-standards`,{method:'PUT',token:tk,body:{items:std.items},headers:{'if-match':String(std.version)}}),409);assert.equal(expect(await request(`/reviews/${r.review_id}`),200).standard_version,std.version);});
 await t.test('上传超过20MB返回413 / 分页参数400',async()=>{const p=await project();expect(await upload(p,Buffer.alloc(20*1024*1024+1),'oversize.md'),413);expect(await request(`/projects/${p}/kb-docs?page_size=101`),400);});
 await t.test('对象存在性保护 / 关闭外发拒绝上传与拆解',async()=>{const p=await project(),a=await parse(p);expect(await request(`/revisions/${a.revision_id}/parse-result`,{token:otherToken}),403);expect(await request('/revisions/not-exists/parse-result',{token:otherToken}),403);expect(await request('/users/me/ai-egress',{method:'PUT',body:{egress_enabled:false}}),200);expect(await upload(p),503);expect(await request(`/projects/${p}/splits`,{method:'POST',body:{}}),503);expect(await request('/users/me/ai-egress',{method:'PUT',body:{egress_enabled:true}}),200);});
 await t.test('#72 账号密码登录：只存哈希 / 不泄露账号是否存在 / 非法输入拒绝',async()=>{
  assert.equal(expect(await request('/auth/methods'),200).password_login,true);
  // 任意合法用户名 + 开发密码 → 自助开通
  const first=expect(await request('/auth/password/login',{method:'POST',body:{username:'pw_user',password:DEV_PW}}),200);
  assert.equal(first.created,true);
  assert.equal(typeof first.token,'string');
  assert.equal(expect(await request('/users/me',{token:first.token}),200).user_id,first.user.user_id);
  // **只存 scrypt 哈希，不得有明文**
  const row=get('SELECT password_hash FROM tbl_account WHERE username=?','pw_user');
  assert.equal(row.password_hash.startsWith("scrypt"),true);
  assert.equal(row.password_hash.split("$").length,3,'格式：scrypt$salt$hash');
  assert.equal(row.password_hash.includes(DEV_PW),false,'不得存明文密码');
  // 用户名大小写不敏感；再次登录不再 created
  const again=expect(await request('/auth/password/login',{method:'POST',body:{username:'PW_USER',password:DEV_PW}}),200);
  assert.equal(again.created,false);
  assert.equal(again.user.user_id,first.user.user_id);
  // 密码错 与 账号不存在：**同一个错误码与文案**（不泄露账号是否存在）
  const bad=await request('/auth/password/login',{method:'POST',body:{username:'pw_user',password:'nope'}});
  const ghost=await request('/auth/password/login',{method:'POST',body:{username:'nobody_here',password:'nope'}});
  assert.equal(bad.status,401);assert.equal(ghost.status,401);
  assert.equal(bad.code,ghost.code);assert.equal(bad.message,ghost.message);
  assert.equal(get('SELECT COUNT(*) n FROM tbl_account WHERE username=?','nobody_here').n,0,'错密码不得开通账号');
  // 非法用户名 / 空密码 → 400
  assert.equal((await request('/auth/password/login',{method:'POST',body:{username:'a',password:DEV_PW}})).status,400);
  assert.equal((await request('/auth/password/login',{method:'POST',body:{username:'pw_user',password:''}})).status,400);
 });
 } finally {await app.close();db.close();rmSync(process.env.AD_UPLOAD_DIR,{recursive:true,force:true});}
});
