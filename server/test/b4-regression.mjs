import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
process.env.AD_DB_PATH=':memory:';process.env.AD_LOG_LEVEL='fatal';process.env.AD_LLM_MODE='development';process.env.AD_CODEGEN_MODE='development';
// 固定一份模型目录，避免测试依赖本机 DHwork 配置（否则不同机器结果不同）
{
  const {writeFileSync,mkdtempSync}=await import('node:fs');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
  const dir=mkdtempSync(join(tmpdir(),'ad-catalog-'));
  const file=join(dir,'llm-catalog.json');
  writeFileSync(file,JSON.stringify({default_model:'fixture-default',models:[
    {id:'fixture-default',name:'示例默认模型',description:'测试用',available:true},
    {id:'fixture-alt',name:'示例备用模型',description:'测试用',available:true},
    {id:'fixture-off',name:'示例不可用模型',description:'测试用',available:false,reason:'测试：不可用'},
  ]},null,2));
  process.env.AD_LLM_CATALOG_FILE=file;
}
const {buildApp}=await import('../src/app.ts');
const {db,get,all,run,uid,nowIso}=await import('../src/db/index.ts');
const {ensureUser,issueToken}=await import('../src/core/auth.ts');
const {createCodegenAdapter}=await import('../src/adapters/codegen.ts');
const {defaultStyle}=await import('../src/core/editor.ts');
const {writeMeta}=await import('../src/core/revisions.ts');
const {createLlmAdapter}=await import('../src/adapters/llm.ts');

const base=createLlmAdapter();let specHook=null,chatHook=null;
const llm={kind:'mock',
  review:(i)=>base.review(i), split:(i)=>base.split(i),
  spec:(i)=>specHook?specHook(i):base.spec(i),
  chat:(i)=>chatHook?chatHook(i):base.chat(i)};
const app=buildApp({llm,codegen:createCodegenAdapter()});await app.ready();
const user=ensureUser('b4_user','B4测试'),token=issueToken(user.user_id);
const outsider=issueToken(ensureUser('b4_other','外部用户').user_id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(path,{method='GET',body,version,key,query,token:tk=token,headers={}}={}){
  const qs=query?('?'+new URLSearchParams(Object.entries(query).map(([k,v])=>[k,String(v)])).toString()):'';
  const r=await app.inject({method,url:'/api/v1'+path+qs,
    headers:{authorization:`Bearer ${tk}`,...(version!==undefined?{'if-match':String(version)}:{}),...(key?{'idempotency-key':key}:{}),...headers},
    ...(body!==undefined?{payload:body}:{})});
  return {http:r.statusCode,...r.json()};
}
function ok(r,http=200){assert.equal(r.http,http,JSON.stringify(r));return r.data;}
async function project(){
  const p=ok(await req('/projects',{method:'POST',body:{name:'B4独立回归'}}),201).project_id;
  ok(await req('/users/me/ai-egress',{method:'PUT',body:{consent_acknowledged:true,egress_enabled:true}}));
  return p;
}
/** 直接落一份需求包（#30 的前置是「已拆解」） */
function seedRequirements(p){
  writeMeta(p,'requirements',{depth:'standard',round:1,packs:[
    {role:'UI',reqs:['REQ-UI-001','REQ-UI-002']},{role:'接口',reqs:['REQ-API-001']},
    {role:'App',reqs:['REQ-GEN-001']},{role:'埋点',reqs:['REQ-TRACK-001']},{role:'测试',reqs:['REQ-SPEC-001']},
  ]});
}
async function waitTask(id){for(let i=0;i<400;i++){const t=ok(await req(`/tasks/${id}`));if(!['running','queued'].includes(t.status))return t;await sleep(10);}throw Error('task timeout');}
/** 元素树节点（与 B3 回归同形） */
function node(type='BUTTON',id=null,temp=crypto.randomUUID()){return {element_id:id,temp_id:temp,widget_type:type,alias:'',style:defaultStyle(),events:{click:false,long_press:false,double_click:false},status:'active',children:[]};}
const hashOf=t=>createHash('sha256').update(JSON.stringify(t)).digest('hex');

await test('B4 spec / api / version / capability / delivery regression',async t=>{
 await t.test('#30 五份 Spec 串行生成 + 单份失败不阻断其余 + overall 绝不报成功',async()=>{
  const p=await project(); seedRequirements(p);
  specHook=(i)=>{ if(i.role==='埋点') throw Object.assign(new Error('upstream down'),{code:'UPSTREAM_TIMEOUT',name:'ApiError'}); return base.spec(i); };
  const r=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  const started=r.http===202?r.data:null;
  if(started?.task_id) await waitTask(started.task_id);
  const list=ok(await req(`/projects/${p}/specs`));
  assert.equal(list.items.length,5);
  assert.deepEqual(list.items.map(i=>i.role),['ui','api','app','track','test']);
  assert.equal(list.succeeded.includes('ui'),true,'其余角色不受影响');
  assert.equal(list.failed.length>=1,true);
  assert.notEqual(list.overall,'succeeded','部分成功绝不报成功');
  assert.equal(list.overall,'partial');
  const ui=ok(await req(`/specs/${list.items[0].spec_id}`));
  assert.equal(ui.content_md.includes('REQ-UI-001'),true);
  specHook=null;
 });
 await t.test('#30 前置：没有需求包时明确拒绝',async()=>{
  const p=await project();
  const r=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  assert.equal(r.http,400);assert.match(r.message,/需求包/);
 });
 await t.test('#32/#33 内容与导出，导出需鉴权且不含密钥',async()=>{
  const p=await project(); seedRequirements(p);
  const r=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  if(r.data?.task_id) await waitTask(r.data.task_id);
  const list=ok(await req(`/projects/${p}/specs`));
  const doc=list.items.find(i=>i.status==='succeeded');
  const exp=ok(await req(`/specs/${doc.spec_id}/export`));
  assert.equal(exp.format,'md');assert.equal(exp.content_md.length>0,true);
  assert.equal(/sk-|secret|api[_-]?key/i.test(exp.content_md),false,'导出不含密钥');
  const other=await req(`/specs/${doc.spec_id}`,{token:outsider});
  assert.equal(other.http,403,'越权不可读');
 });
 await t.test('#34 校对：缺章节带 can_loopback',async()=>{
  const p=await project(); seedRequirements(p);
  const r=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  if(r.data?.task_id) await waitTask(r.data.task_id);
  const list=ok(await req(`/projects/${p}/specs`));
  const doc=list.items[0];
  const pf=ok(await req(`/projects/${p}/specs/${doc.spec_id}/proofread`,{method:'POST'}));
  assert.equal(Array.isArray(pf.items),true);
  for(const it of pf.items) assert.equal(typeof it.can_loopback,'boolean');
 });
 await t.test('#31 生成 Spec 自动打一个项目级版本（§F12 方案 A）',async()=>{
  const p=await project(); seedRequirements(p);
  const r=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  if(r.data?.task_id) await waitTask(r.data.task_id);
  const vs=ok(await req(`/projects/${p}/versions`));
  assert.equal(vs.items.length>=1,true);
  assert.equal(vs.items.filter(v=>v.status==='current').length,1,'current 唯一');
  assert.equal(typeof vs.items[0].summary,'string');
  assert.equal(Array.isArray(vs.items[0].artifacts),true);
 });

 await t.test('#50~#53 接口定义：分页筛选 / If-Match / 8 项枚举 / 破坏性确认',async()=>{
  const p=await project();
  const a=ok(await req(`/projects/${p}/apis`,{method:'POST',body:{code:'ORDER-001',name:'查询订单',method:'GET',path:'/v1/orders'}}),201);
  assert.equal(a.status,'draft');
  await req(`/projects/${p}/apis`,{method:'POST',body:{code:'ORDER-001',name:'重复',method:'GET',path:'/x'}}).then(r=>assert.equal(r.http,400));
  const list=ok(await req(`/projects/${p}/apis`,{query:{}}));
  assert.equal(list.total,1);assert.equal(list.items[0].code,'ORDER-001');
  const bad=await req(`/apis/${a.api_id}/schema`,{method:'PUT',version:1,body:{fields:[{name:'id',field_type:'等等'}]}});
  assert.equal(bad.http,400);assert.match(bad.message,/完整 8 项/);
  const good=ok(await req(`/apis/${a.api_id}/schema`,{method:'PUT',version:1,body:{fields:[
    {name:'page',field_type:'int',required:false},{name:'status',field_type:'string',required:false,length:16}]}}));
  assert.equal(good.version,2);
  const stale=await req(`/apis/${a.api_id}`,{method:'PATCH',version:1,body:{name:'改'}});
  assert.equal(stale.http,409);assert.equal(stale.data.current_version,2);
  const del=await req(`/apis/${a.api_id}`,{method:'DELETE'});
  assert.equal(del.http,400,'破坏性操作服务端亦须校验');
  ok(await req(`/apis/${a.api_id}`,{method:'DELETE',body:{confirm:true}}));
  assert.equal(ok(await req(`/projects/${p}/apis`)).total,0);
  // 状态筛选非法值
  assert.equal((await req(`/projects/${p}/apis`,{query:{status:'weird'}})).http,400);
 });

 await t.test('#58 能力配置：固定 7 项默认全关 / If-Match / 取消需二次确认 / 不出密钥',async()=>{
  const p=await project();
  const g=ok(await req(`/projects/${p}/capabilities`));
  assert.equal(g.items.length,7);assert.equal(g.items.every(i=>i.enabled===false),true);
  assert.equal(g.overall,'none');assert.deepEqual(g.conflicts,[]);
  assert.equal(/"(key|secret|token|access_key)"/i.test(JSON.stringify(g)),false,'不出现密钥字段');
  const stale=await req(`/projects/${p}/capabilities`,{method:'PUT',version:99,body:{items:[{capability:'push',enabled:true}]}});
  assert.equal(stale.http,409);
  const bad=await req(`/projects/${p}/capabilities`,{method:'PUT',version:g.version,body:{items:[{capability:'nope',enabled:true}]}});
  assert.equal(bad.http,400);
  const on=ok(await req(`/projects/${p}/capabilities`,{method:'PUT',version:g.version,body:{items:[
    {capability:'push',enabled:true},{capability:'apm',enabled:true},{capability:'stats_sdk',enabled:true}]}}));
  assert.equal(on.items.filter(i=>i.enabled).length,3);
  assert.equal(on.items.find(i=>i.capability==='push').code_status,'generated');
  assert.equal(on.conflicts.length>=1,true,'apm+stats_sdk 依赖冲突可见');
  assert.equal(on.alignment_table.length,on.conflicts.length);
  const noConfirm=await req(`/projects/${p}/capabilities`,{method:'PUT',version:on.version,body:{items:[{capability:'push',enabled:true},{capability:'apm',enabled:false},{capability:'stats_sdk',enabled:true}]}});
  assert.equal(noConfirm.http,400);assert.match(noConfirm.message,/二次确认/);
  const off=ok(await req(`/projects/${p}/capabilities`,{method:'PUT',version:on.version,body:{confirm_disable:true,items:[{capability:'push',enabled:true},{capability:'apm',enabled:false},{capability:'stats_sdk',enabled:true}]}}));
  const apm=off.items.find(i=>i.capability==='apm');
  assert.equal(apm.enabled,false);assert.equal(apm.code_status,'generated','取消勾选只移除配置，不删已生成代码');
 });

 /**
  * 能力「保存即生成」的真实性护栏：
  * 不依赖厂商 SDK 的三项（隐私弹窗 / 崩溃捕获 / 运行日志）**必须真的产出可编译代码**，
  * 且入口 Activity 必须真的调用它们；有隐私弹窗时，采集类初始化必须放在同意回调内。
  */
 await t.test('#58 能力：不依赖厂商的三项真的产出代码并接线到入口 Activity',async()=>{
  const p=await project();
  const page=ok(await req(`/projects/${p}/pages`)).items[0];
  const draft=ok(await req(`/pages/${page.page_id}/draft`,{method:'PUT',version:0,body:{tree:[node()]}}));
  const g=ok(await req(`/projects/${p}/capabilities`));
  const on=ok(await req(`/projects/${p}/capabilities`,{method:'PUT',version:g.version,body:{items:[
    {capability:'privacy_dialog',enabled:true},{capability:'crash_report',enabled:true},{capability:'log_report',enabled:true}]}}));
  for(const k of ['privacy_dialog','crash_report','log_report'])
    assert.equal(on.items.find(i=>i.capability===k).code_status,'generated');
  const gen=ok(await req(`/pages/${page.page_id}/generations`,{method:'POST',body:{input_hash:hashOf(draft.tree),base_seq:0}}),202);
  assert.equal((await waitTask(gen.task_id)).status,'succeeded');
  const files=ok(await req(`/tasks/${gen.task_id}/artifacts`)).items;
  const boot=files.find(f=>f.path==='app/src/main/java/com/autodevelopment/generated/CapabilityBootstrap.kt');
  assert.ok(boot,'必须产出 CapabilityBootstrap.kt');
  for(const fn of ['ensureConsent','installCrashHandler','logLine'])
    assert.equal(boot.content.includes(fn),true,`CapabilityBootstrap 必须含 ${fn}`);
  const main=files.find(f=>f.path==='app/src/main/java/com/autodevelopment/generated/MainActivity.kt');
  assert.equal(main.content.includes('CapabilityBootstrap.ensureConsent(this)'),true,'入口必须走隐私同意');
  const consentCall=main.content.indexOf('CapabilityBootstrap.ensureConsent(this)');
  assert.ok(main.content.indexOf('CapabilityBootstrap.installCrashHandler(this)')>consentCall,'崩溃捕获必须在同意之后');
  assert.ok(main.content.indexOf('CapabilityBootstrap.logLine(this')>consentCall,'日志也必须在同意之后');
  // 只依赖厂商的能力：**不产出代码**，不假装
  const p2=await project();
  const page2=ok(await req(`/projects/${p2}/pages`)).items[0];
  const d2=ok(await req(`/pages/${page2.page_id}/draft`,{method:'PUT',version:0,body:{tree:[node()]}}));
  const g2=ok(await req(`/projects/${p2}/capabilities`));
  ok(await req(`/projects/${p2}/capabilities`,{method:'PUT',version:g2.version,body:{items:[{capability:'push',enabled:true}]}}));
  const gen2=ok(await req(`/pages/${page2.page_id}/generations`,{method:'POST',body:{input_hash:hashOf(d2.tree),base_seq:0}}),202);
  assert.equal((await waitTask(gen2.task_id)).status,'succeeded');
  const files2=ok(await req(`/tasks/${gen2.task_id}/artifacts`)).items;
  assert.equal(files2.some(f=>f.path.endsWith('CapabilityBootstrap.kt')),false,'未支持的能力不得凭空产码');
 });

 await t.test('#54~#57 版本：diff 用文字 / 回滚需确认且整包恢复',async()=>{
  const p=await project(); seedRequirements(p);
  const r=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  if(r.data?.task_id) await waitTask(r.data.task_id);
  ok(await req(`/projects/${p}/apis`,{method:'POST',body:{code:'ORDER-002',name:'创建订单',method:'POST',path:'/v1/orders'}}),201);
  const v2=ok(await req(`/projects/${p}/versions`,{method:'POST',body:{summary:'手工打版本'}}),201);
  assert.equal(typeof v2.seq,'number');
  const list=ok(await req(`/projects/${p}/versions`));
  assert.equal(list.items.filter(v=>v.status==='current').length,1);
  const diff=ok(await req(`/versions/${v2.version_id}/diff`));
  assert.equal(Array.isArray(diff.diff),true);
  for(const d of diff.diff){assert.ok(['新增','删除','修改'].includes(d.change));assert.equal(typeof d.path,'string');}
  assert.equal(diff.diff.some(d=>d.path.startsWith('apis/')),true);
  const noConfirm=await req(`/versions/${v2.version_id}/rollback`,{method:'POST',body:{}});
  assert.equal(noConfirm.http,400);
  // 打版本后改接口，再回滚 → 接口定义回到快照状态
  const api=ok(await req(`/projects/${p}/apis`)).items[0];
  ok(await req(`/apis/${api.api_id}`,{method:'PATCH',version:api.version,body:{name:'被改过了'}}));
  ok(await req(`/versions/${v2.version_id}/rollback`,{method:'POST',body:{confirm:true}}));
  const after=ok(await req(`/projects/${p}/apis`)).items[0];
  assert.equal(after.name,'创建订单','整包回滚恢复接口定义');
  const list2=ok(await req(`/projects/${p}/versions`));
  assert.equal(list2.items.filter(v=>v.status==='current').length,1,'current 唯一');
  assert.equal(list2.items.find(v=>v.status==='current').version_id,v2.version_id);
 });

 await t.test('#60/#61 交付：归档可见 + 真实 ZIP 且不含 apk/密钥',async()=>{
  const p=await project(); seedRequirements(p);
  const r=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  if(r.data?.task_id) await waitTask(r.data.task_id);
  const d=ok(await req(`/projects/${p}/deliverables`));
  assert.equal(d.items.find(i=>i.key==='spec_bundle').available,true);
  assert.equal(d.android_project.unverified_build,true);
  const exp=ok(await req(`/projects/${p}/deliverables/export`,{method:'POST'}),201);
  assert.equal(exp.format,'zip');
  const buf=Buffer.from(exp.base64,'base64');
  assert.equal(buf.subarray(0,4).toString('binary'),'PK\x03\x04');
  assert.equal(buf.includes(Buffer.from('PK\x05\x06')),true,'含 EOCD');
  assert.equal(buf.includes(Buffer.from('specs/')),true);
  assert.equal(buf.includes(Buffer.from('README.md')),true);
  assert.equal(/\.apk/i.test(buf.toString('latin1')),false,'平台不做服务端构建，不含 apk');
  const other=await req(`/projects/${p}/deliverables`,{token:outsider});
  assert.equal(other.http,403);
 });

 /**
  * 回归护栏：交付包必须**真的**含安卓工程源码。
  * 曾有的缺陷：`tbl_artifact` 的 `path` 是独立列、不在 `content` 的 JSON 外壳里，
  * 而读取处只 `SELECT content` 却又 `.filter(f=>f.path)` → 17 个安卓文件被全部滤掉，
  * 交付包里一个 `android/` 都没有（Spec 与 README 仍在，所以只看「是个合法 ZIP」发现不了）。
  */
 await t.test('#60/#61 交付包必须含真实安卓工程（含 wrapper 与构建脚本）',async()=>{
  const p=await project(); seedRequirements(p);
  // 先生成一份真实的安卓代码产物
  const page=ok(await req(`/projects/${p}/pages`)).items[0];
  const draft=ok(await req(`/pages/${page.page_id}/draft`,{method:'PUT',version:0,body:{tree:[node()]}}));
  const gen=ok(await req(`/pages/${page.page_id}/generations`,{method:'POST',body:{input_hash:hashOf(draft.tree),base_seq:0}}),202);
  assert.equal((await waitTask(gen.task_id)).status,'succeeded');
  const sg=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  if(sg.data?.task_id) await waitTask(sg.data.task_id);

  const d=ok(await req(`/projects/${p}/deliverables`));
  assert.equal(d.android_project.artifact_count>0,true,'预览接口应报告安卓文件数');
  const exp=ok(await req(`/projects/${p}/deliverables/export`,{method:'POST'}),201);
  const buf=Buffer.from(exp.base64,'base64');

  for(const f of ['android/gradlew','android/gradlew.bat','android/settings.gradle.kts','android/build.gradle.kts',
                  'android/app/build.gradle.kts','android/app/src/main/AndroidManifest.xml',
                  'android/gradle/wrapper/gradle-wrapper.properties','android/gradle/wrapper/gradle-wrapper.jar',
                  'android/app/src/main/java/com/autodevelopment/generated/MainActivity.kt']){
    assert.equal(buf.includes(Buffer.from(f)),true,`交付包必须含 ${f}`);
  }
  // 正文不得是未解包的 JSON 外壳（防止再次退化成 {"content": ...}）
  assert.equal(buf.includes(Buffer.from('{"content":"')),false,'文件正文不得是 JSON 外壳');
  assert.equal(exp.entry_count>=20,true,`条目数应含 17 个安卓文件，实际 ${exp.entry_count}`);
 });

 await t.test('#62 埋点上报：结构校验、拒绝项、不落业务数据',async()=>{
  const good=ok(await req('/metrics/events',{method:'POST',body:{schema_version:'1.0',batch:[
    {event_key:'EVT_proj_create_success',params:{}}]}}));
  assert.equal(good.accepted,1);assert.deepEqual(good.rejected,[]);
  const bad=ok(await req('/metrics/events',{method:'POST',body:{schema_version:'1.0',batch:[
    {event_key:'EVT_BAD'},{event_key:'EVT_ok_1'}]}}));
  assert.equal(bad.accepted,1);assert.equal(bad.rejected.length,1);assert.equal(bad.rejected[0].index,0);
  assert.equal((await req('/metrics/events',{method:'POST',body:{batch:[]}})).http,400);
 });

 await t.test('#70 中止：需显式确认；归档不删、数据仍可读',async()=>{
  const p=await project(); seedRequirements(p);
  const r=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  if(r.data?.task_id) await waitTask(r.data.task_id);
  assert.equal((await req(`/projects/${p}/abort`,{method:'POST',body:{}})).http,400);
  const ab=ok(await req(`/projects/${p}/abort`,{method:'POST',body:{confirm:true}}));
  assert.equal(ab.status,'aborted');
  assert.equal(get('SELECT stage FROM tbl_project WHERE project_id=?',p).stage,'archived');
  const vs=ok(await req(`/projects/${p}/versions`));
  assert.equal(vs.items.every(v=>v.status==='archived'),true);
  assert.equal(vs.items.length>=1,true,'归档不删，数据仍可读');
 });

 await t.test('#25~#27 对话：串行、长度上限、重发不重复入库、受外发开关约束',async()=>{
  const p=await project();
  assert.equal((await req(`/projects/${p}/chat/messages`,{method:'POST',body:{content:'   '}})).http,400);
  assert.equal((await req(`/projects/${p}/chat/messages`,{method:'POST',body:{content:'x'.repeat(20001)}})).http,400);
  const sent=ok(await req(`/projects/${p}/chat/messages`,{method:'POST',body:{content:'把取消时限改成 10 分钟。'}}),202);
  const after=await (async()=>{for(let i=0;i<100;i++){const l=ok(await req(`/projects/${p}/chat/messages`));if(l.items.length>=2)return l;await sleep(20);}return ok(await req(`/projects/${p}/chat/messages`));})();
  assert.equal(after.items.length,2,'用户消息 + 一条回复');
  const retry=ok(await req(`/chat/messages/${sent.message_id}/retry`,{method:'POST'}));
  assert.equal(retry.status,'sent');
  const users=ok(await req(`/projects/${p}/chat/messages`)).items.filter(m=>m.role==='user');
  assert.equal(users.length,1,'重发不重复入库');
  // 关闭外发 → 生成类不可用，但历史仍可读
  ok(await req('/users/me/ai-egress',{method:'PUT',body:{egress_enabled:false}}));
  const blocked=await req(`/projects/${p}/chat/messages`,{method:'POST',body:{content:'再改一处'}});
  assert.equal(blocked.http,503,'关闭外发不得静默降级');
  assert.equal(ok(await req(`/projects/${p}/chat/messages`)).items.length>=2,true);
  ok(await req('/users/me/ai-egress',{method:'PUT',body:{egress_enabled:true}}));
 });

 await t.test('外发开关关闭时 Spec 生成同样拒绝（不静默降级）',async()=>{
  const p=await project(); seedRequirements(p);
  ok(await req('/users/me/ai-egress',{method:'PUT',body:{egress_enabled:false}}));
  const r=await req(`/projects/${p}/specs:generate`,{method:'POST'});
  assert.equal(r.http,503);
  ok(await req('/users/me/ai-egress',{method:'PUT',body:{egress_enabled:true}}));
 });

 await t.test('所有 B4 只读接口都不泄露其他项目数据',async()=>{
  const p=await project();
  for(const path of ['/capabilities','/versions','/deliverables','/apis','/specs']){
    assert.equal((await req(`/projects/${p}${path}`,{token:outsider})).http,403,path);
  }
 });

 /**
  * 门禁结论**随模型而变**（同一份 PRD 在不同模型下 blocking 数可差 9 倍），
  * 所以：① 模型清单要能列给用户选（含不可用项与原因）；② 每次审核都要记下用的是哪个模型。
  */
 await t.test('#71 模型清单可选 + 审核报告记录所用模型',async()=>{
  const list=ok(await req('/llm/models'));
  assert.equal(list.items.length,3);
  assert.equal(list.default_model,'fixture-default');
  assert.equal(list.effective_model,'fixture-default','未选择时用目录默认');
  const off=list.items.find(i=>i.id==='fixture-off');
  assert.equal(off.available,false);
  assert.equal(typeof off.reason,'string','不可用项必须给出原因，不能只是不能点');
  assert.equal(list.items.find(i=>i.id==='fixture-default').available,true);

  // 选一个可用模型
  const sel=ok(await req('/me/llm-model',{method:'PUT',body:{model:'fixture-alt'}}));
  assert.equal(sel.selected_model,'fixture-alt');
  assert.equal(sel.effective_model,'fixture-alt');
  assert.equal(ok(await req('/llm/models')).effective_model,'fixture-alt','选择按用户保存');
  // 别的用户不受影响（按用户隔离）
  assert.equal(ok(await req('/llm/models',{token:outsider})).effective_model,'fixture-default');

  // 不可用 / 不存在的模型都拒绝
  assert.equal((await req('/me/llm-model',{method:'PUT',body:{model:'fixture-off'}})).http,400);
  assert.equal((await req('/me/llm-model',{method:'PUT',body:{model:'nope'}})).http,400);
  assert.equal((await req('/me/llm-model',{method:'PUT',body:{}})).http,400);

  // 审核报告必须记录本次实际使用的模型
  const p=await project();
  const docId=uid('doc'), revId=uid('rev');
  run(`INSERT INTO tbl_document(document_id,project_id,source_type,title,created_at) VALUES(?,?,?,?,?)`,docId,p,'file','模型记录',nowIso());
  run(`INSERT INTO tbl_doc_revision(revision_id,project_id,document_id,parse_status,empty_document,parts_json,manual_json,created_at) VALUES(?,?,?,?,?,?,?,?)`,revId,p,docId,'succeeded',0,'{}','{}',nowIso());
  writeMeta(p,`revision:${revId}`,{markdown:'## 1 背景\n一句话说明：测试。\n'});
  run(`UPDATE tbl_project SET current_revision_id=? WHERE project_id=?`,revId,p);
  const rv=ok(await req(`/revisions/${revId}/reviews`,{method:'POST',body:{}}),202);
  await waitTask(rv.task_id);
  const detail=ok(await req(`/reviews/${rv.review_id}`));
  assert.equal(detail.model,'fixture-alt','评分卡要回报本次审核用的模型');
  const rep=ok(await req(`/projects/${p}/reviews/${rv.review_id}/export`));
  assert.equal(rep.content_md.includes('使用模型：fixture-alt'),true,'导出的报告正文也要写明模型');

  // 复原，避免影响后续用例
  ok(await req('/me/llm-model',{method:'PUT',body:{model:'fixture-default'}}));
 });
});
