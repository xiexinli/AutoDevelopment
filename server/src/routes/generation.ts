import type {FastifyInstance} from 'fastify';
import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {ApiError} from '../core/envelope.ts';
import {currentUser,assertProjectAccess,type User} from '../core/auth.ts';
import {all,get,run,tx,uid,nowIso,json} from '../db/index.ts';
import {createTask,startTask,getTask,type TaskRow,publish,registerTaskCleanup} from '../core/tasks.ts';
import {loadPage,draft,type Page} from '../core/editor.ts';
import {readMeta,writeMeta} from '../core/revisions.ts';
import {insertVersion} from './versions.ts';
import {assertEgressEnabled} from './ai-egress.ts';
import {createCodegenAdapter,validateCodeFiles,type CodegenAdapter,type CodeFile} from '../adapters/codegen.ts';
import {verifyL1} from '../adapters/verify.ts';
import {writebackTask} from './patches.ts';
const send=(req:any,reply:any,data:any,status=200)=>reply.status(status).send({code:'OK',message:'',data,request_id:String(req.id)});
const hash=(tree:any[])=>createHash('sha256').update(JSON.stringify(tree)).digest('hex');
interface Input {tree:any[];page:Page;user:User;root:string;retry:number}
export function registerGenerationRoutes(app:FastifyInstance,adapter:CodegenAdapter=createCodegenAdapter()):void {
 const queues=new Map<string,Promise<void>>();
 const admitted=new Set<string>();
 function cleanCanceled(task:TaskRow,input:Input):void {
   const done=readMeta<any>(task.project_id,`canceled_settlement:${task.task_id}`);
   if(done)return;
   writeMeta(task.project_id,`task_info:${task.task_id}`,{phase:'stopped',attempt:input.retry,error_message:'已停止'});
   if(input.retry>0){const state=readMeta<any>(task.project_id,`retry:${input.root}`)??{count:input.retry};writeMeta(task.project_id,`retry:${input.root}`,{count:Math.max(0,state.count-1)});}
   writeMeta(task.project_id,`canceled_settlement:${task.task_id}`,{done:true});
 }
 function meta(task:TaskRow):Input {const input=readMeta<Input>(task.project_id,`generation:${task.task_id}`);if(!input)throw new ApiError('TASK_STALE','该任务没有输入快照。');return input;}
 function authorized(user:User,id:string):TaskRow {
  const task=getTask(id);if(!task)throw new ApiError(user.role==='admin'?'NOT_FOUND':'FORBIDDEN');assertProjectAccess(user,task.project_id);
  if(task.type!=='code_gen')throw new ApiError('INVALID_ARGUMENT','该接口仅用于代码生成任务。');return task;
 }
 function enqueue(task:TaskRow):void {
  if(admitted.has(task.task_id))return;admitted.add(task.task_id);
  const queuedInput=meta(task);
  registerTaskCleanup(task.task_id,status=>{if(status==='canceled')cleanCanceled(task,queuedInput);});
  const previous=queues.get(task.project_id)??Promise.resolve();
  const next=previous.catch(()=>undefined).then(async()=>{
    if(getTask(task.task_id)?.status==='canceled')return;
    const input=meta(task);
    await new Promise<void>(resolve=>{
      startTask(task.task_id,async ctx=>{
       ctx.progress(5);assertEgressEnabled(input.user.user_id);
       writeMeta(task.project_id,`task_info:${task.task_id}`,{phase:'generating',attempt:input.retry});
       const capabilityKeys=all<{cap_key:string}>(`SELECT cap_key FROM tbl_capability_config WHERE project_id=? AND enabled=1`,task.project_id).map(r=>r.cap_key);
       const files=validateCodeFiles(await adapter.generate({tree:input.tree,pageName:input.page.name,moduleCode:input.page.module_code,capabilities:capabilityKeys},ctx.signal));
       ctx.check();ctx.progress(65);writeMeta(task.project_id,`task_info:${task.task_id}`,{phase:'verifying',attempt:input.retry});
       publish(task.project_id,'task',{task_id:task.task_id,type:task.type,page_id:task.page_id,project_id:task.project_id,status:'running',seq:task.seq,progress:65,phase:'verifying'});
       const evidence=verifyL1(input.tree,files);ctx.check();
       if(!evidence.passed) {
         tx(()=>{
           ctx.check();run(`INSERT INTO tbl_verify_task(verify_id,task_id,layer,status,rules_json,attempt,log_digest,created_at) VALUES(?,?,'L1','failed',?,?,?,?)`,uid('verify'),task.task_id,JSON.stringify(evidence.rules),input.retry,evidence.log_digest,nowIso());
           writeMeta(task.project_id,`task_info:${task.task_id}`,{phase:'verify_failed',attempt:input.retry,error_message:'生成的代码没通过验证。'});
         });throw new ApiError('INVALID_ARGUMENT','生成的代码没通过验证。');
       }
       ctx.progress(95);
       const committed=ctx.commit(()=>{
         assertEgressEnabled(input.user.user_id);assertProjectAccess(input.user,task.project_id);
         run(`INSERT INTO tbl_verify_task(verify_id,task_id,layer,status,rules_json,attempt,log_digest,created_at) VALUES(?,?,'L1','passed',?,?,?,?)`,uid('verify'),task.task_id,JSON.stringify(evidence.rules),input.retry,evidence.log_digest,nowIso());
         for(const f of files)run(`INSERT INTO tbl_artifact(artifact_id,task_id,path,kind,content) VALUES(?,?,?,?,?)`,uid('art'),task.task_id,f.path,f.kind,JSON.stringify({content:f.content,encoding:f.encoding}));
         const existing=readMeta<any>(task.project_id,`preview:${input.page.page_id}`);const at=nowIso();
         if(!existing||existing.seq<task.seq)writeMeta(task.project_id,`preview:${input.page.page_id}`,{task_id:task.task_id,seq:task.seq,at,tree:input.tree});
         // 版本快照与产物**同一事务**：要么全成要么全不成（`46`/`55`）
         const created=insertVersion(task.project_id,input.user,'代码生成及 L1 静态验证通过',task.task_id);
         const versionId=created.version_id;
         run(`UPDATE tbl_project SET current_version_id=?,stage='preview_ready',updated_at=? WHERE project_id=?`,versionId,at,task.project_id);
         writeMeta(task.project_id,`task_info:${task.task_id}`,{phase:'ready',attempt:input.retry});
         return versionId;
       });
       // 二期 brownfield：生成成功后**自动写回**既有工程（`D3`）。**best-effort**：写回失败只记录，不影响本任务结论。
       if(committed){try{const wb=writebackTask(task.project_id,task.task_id);if(wb)writeMeta(task.project_id,`patch_latest:${task.task_id}`,{patch_id:wb.plan.patch_id,files:wb.files.length,notes:wb.merge.notes,skipped:wb.merge.skipped});}catch(e){writeMeta(task.project_id,`patch_error:${task.task_id}`,{message:(e as Error).message});}}
       return committed;
      },{onFailure:status=>{
        const info=readMeta<any>(task.project_id,`task_info:${task.task_id}`)??{};
        writeMeta(task.project_id,`task_info:${task.task_id}`,{...info,phase:status==='canceled'?'stopped':info.phase==='verify_failed'?'verify_failed':'gen_failed',attempt:input.retry,error_message:info.error_message??(status==='canceled'?'已停止':'代码没生成出来。')});
        if(status==='canceled')cleanCanceled(task,input);
      },onSettled:resolve});
    });
  }).finally(()=>{admitted.delete(task.task_id);if(queues.get(task.project_id)===next)queues.delete(task.project_id);});
  queues.set(task.project_id,next);
 }
 app.post<{Params:{page_id:string};Body:{input_hash:string;base_seq:number}}>('/api/v1/pages/:page_id/generations',async(req,reply)=>{
  const user=currentUser(req),page=loadPage(user,req.params.page_id);assertEgressEnabled(user.user_id);
  if(adapter.kind==='unconfigured')throw new ApiError('UPSTREAM_UNAVAILABLE','代码生成网关未配置，未创建生成任务。');
  const d=draft(page);if(!d.tree.length)throw new ApiError('INVALID_ARGUMENT','画布上还没有控件。');
  if(typeof req.body?.input_hash!=='string'||req.body.input_hash!==hash(d.tree))throw new ApiError('TASK_STALE','草稿已更新，请保存当前内容后重新提交。');
  const latest=get<{seq:number}>(`SELECT MAX(seq) seq FROM tbl_gen_task WHERE project_id=? AND type='code_gen'`,page.project_id)?.seq??0;
  const based=req.body.base_seq;
  if(!Number.isInteger(based)||based<0)throw new ApiError('INVALID_ARGUMENT','base_seq 必须为已同步的非负任务序号。');
  if(based!==latest)throw new ApiError('TASK_STALE','已使用最新结果。',{current_seq:latest});
  const pending=all<TaskRow>(`SELECT * FROM tbl_gen_task WHERE project_id=? AND type='code_gen' AND status IN ('queued','running')`,page.project_id);
  if(pending.length>=20)throw new ApiError('RATE_LIMITED','请求太频繁，2 秒后重试。',{retry_after:2});
  const task=createTask({projectId:page.project_id,pageId:page.page_id,type:'code_gen',inputHash:req.body.input_hash});
  writeMeta(page.project_id,`generation:${task.task_id}`,{tree:d.tree,page,user,root:task.task_id,retry:0});writeMeta(page.project_id,`task_info:${task.task_id}`,{phase:'generating',attempt:0});
  enqueue(task);return send(req,reply,{task_id:task.task_id,seq:task.seq,status:'queued'},202);
 });
 app.get<{Params:{task_id:string}}>('/api/v1/tasks/:task_id/verifications',async(req,reply)=>{
  const task=authorized(currentUser(req),req.params.task_id),input=meta(task);
  const items=all<any>(`SELECT * FROM tbl_verify_task WHERE task_id=? ORDER BY created_at`,task.task_id).map(r=>({verify_id:r.verify_id,layer:r.layer,status:r.status,attempt:r.attempt,rules:json.parse(r.rules_json,[]),log_digest:r.log_digest}));
  return send(req,reply,{items,...(task.status==='succeeded'?{preview_tree:input.tree,generated_at:task.finished_at}:{})});
 });
 app.get<{Params:{task_id:string}}>('/api/v1/tasks/:task_id/artifacts',async(req,reply)=>{
  const task=authorized(currentUser(req),req.params.task_id);
  if(task.status!=='succeeded'||!get(`SELECT verify_id FROM tbl_verify_task WHERE task_id=? AND layer='L1' AND status='passed'`,task.task_id))throw new ApiError('TASK_STALE','L1 尚未通过，不提供可用产物。');
  const files=all<{path:string;kind:string;content:string}>(`SELECT path,kind,content FROM tbl_artifact WHERE task_id=?`,task.task_id).map(r=>({...r,...JSON.parse(r.content)}));
  return send(req,reply,{items:files});
 });
 app.post<{Params:{task_id:string;verify_id:string}}>('/api/v1/tasks/:task_id/verifications/:verify_id/retry',async(req,reply)=>{
  const user=currentUser(req),task=authorized(user,req.params.task_id);assertEgressEnabled(user.user_id);
  const evidence=get<any>(`SELECT * FROM tbl_verify_task WHERE task_id=? AND verify_id=? AND layer='L1'`,task.task_id,req.params.verify_id);
  if(!evidence||evidence.status!=='failed'||task.status!=='failed')throw new ApiError('INVALID_ARGUMENT','只有失败的 L1 验证可以重试。');
  const input=meta(task),state=readMeta<{count:number}>(task.project_id,`retry:${input.root}`)??{count:0};
  if(state.count>=3)throw new ApiError('INVALID_ARGUMENT','需要人工介入：已达到 3 次重试上限。');
  if(all<any>(`SELECT task_id FROM tbl_gen_task WHERE project_id=? AND type='code_gen' AND status IN ('queued','running')`,task.project_id).some(t=>readMeta<Input>(task.project_id,`generation:${t.task_id}`)?.root===input.root))throw new ApiError('VERSION_CONFLICT','该验证已有重试在进行中。');
  const next=createTask({projectId:task.project_id,pageId:task.page_id,type:'code_gen',inputHash:task.input_hash});
  writeMeta(task.project_id,`retry:${input.root}`,{count:state.count+1});writeMeta(task.project_id,`generation:${next.task_id}`,{...input,user,retry:state.count+1});writeMeta(task.project_id,`task_info:${next.task_id}`,{phase:'generating',attempt:state.count+1});
  enqueue(next);return send(req,reply,{task_id:next.task_id,seq:next.seq,status:'queued'},202);
 });
 app.post<{Params:{task_id:string};Body:{passed:boolean;log_digest:string}}>('/api/v1/tasks/:task_id/build-report',async(req,reply)=>{
  const task=authorized(currentUser(req),req.params.task_id);
  const secret=process.env.AD_BUILD_AGENT_SECRET;
  const stamp=String(req.headers['x-build-agent-timestamp']??'');
  const signature=String(req.headers['x-build-agent-signature']??'');
  if(!secret||!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300_000||!/^([a-f0-9]{64})$/.test(signature))
    throw new ApiError('FORBIDDEN','构建回传需要受信任本地代理的任务绑定签名。');
  const expected=createHmac('sha256',secret).update(`${task.task_id}:${task.input_hash}:${stamp}:${createHash("sha256").update(JSON.stringify(req.body)).digest("hex")}`).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw new ApiError('FORBIDDEN','构建代理签名无效。');
  if(task.status!=='succeeded')throw new ApiError('TASK_STALE','只能回传成功生成任务的本地构建结果。');
  if(typeof req.body?.passed!=='boolean'||typeof req.body.log_digest!=='string'||req.body.log_digest.length>2000||/BEGIN.*PRIVATE KEY|Bearer\s|api[_-]?key\s*[:=]/i.test(req.body.log_digest))throw new ApiError('INVALID_ARGUMENT','请仅回传布尔结果和脱敏日志摘要（≤2000字）。');
  const result={reported:true,source:'local-build-agent',passed:req.body.passed,log_digest:req.body.log_digest,reported_at:nowIso()};
  tx(()=>{writeMeta(task.project_id,`l2:${task.task_id}`,result);run(`DELETE FROM tbl_verify_task WHERE task_id=? AND layer='L2'`,task.task_id);run(`INSERT INTO tbl_verify_task(verify_id,task_id,layer,status,rules_json,attempt,log_digest,created_at) VALUES(?,?,'L2',?,'[]',0,?,?)`,uid('verify'),task.task_id,req.body.passed?'passed':'failed',req.body.log_digest,nowIso());});
  return send(req,reply,{task_id:task.task_id,l2_result:result});
 });
 // 重启后以持久化的输入重新排队，不再把进程内丢失的 running 永久挂起。
 for(const task of all<TaskRow>(`SELECT * FROM tbl_gen_task WHERE type='code_gen' AND status IN ('queued','running') ORDER BY seq`)) {
   if(!readMeta(task.project_id,`generation:${task.task_id}`))continue;
   run(`UPDATE tbl_gen_task SET status='queued' WHERE task_id=?`,task.task_id);enqueue(task);
 }
}
