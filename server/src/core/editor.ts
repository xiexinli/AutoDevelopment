import { ApiError } from './envelope.ts';
import { assertProjectAccess, type User } from './auth.ts';
import { all,get,json,run,uid,nowIso,tx } from '../db/index.ts';
import { ANDROID_CLASSES, activeNodes, checkedStyle, normalizeElementId } from '../adapters/codegen.ts';
import { readMeta } from './revisions.ts';
export interface Page { page_id:string;project_id:string;module_code:string;name:string;order_index:number;status:string }
export interface ElementRow {element_id:string;project_id:string;page_id:string;parent_element_id:string|null;widget_type:string;alias:string;order_index:number;status:string;temp_id:string;version:number;voided_at:string|null}
export interface Node {element_id:string|null;temp_id:string;widget_type:string;alias:string;style:any;events:Record<string,boolean>;status:string;children:Node[]}
export const defaultStyle=()=>({width:{mode:'dp',value:120},height:{mode:'dp',value:40},background:'#FFFFFF',font_color:'#1F2329',font_size:14,padding:{top:0,right:0,bottom:0,left:0},margin:{top:0,right:0,bottom:8,left:0},radius:0,border:{width_dp:0,color:'#D9D9D9',style:'solid'},alpha:100,align_h:'left',align_v:'top',visibility:'visible'});
export function loadPage(user:User,id:string):Page {
 const p=get<Page>(`SELECT * FROM tbl_page WHERE page_id=?`,id);
 if(!p)throw new ApiError(user.role==='admin'?'NOT_FOUND':'FORBIDDEN');assertProjectAccess(user,p.project_id);return p;
}
export function ensurePage(projectId:string):void {
 if(!get(`SELECT page_id FROM tbl_page WHERE project_id=?`,projectId)) {
   run(`INSERT INTO tbl_page(page_id,project_id,module_code,name,order_index,status,created_at) VALUES(?,?,'HOME','首页',0,'draft',?)`,uid('pg'),projectId,nowIso());
 }
}
export function loadElement(user:User,id:string,projectId?:string):ElementRow {
 const normalized=normalizeElementId(id);
 const rows=all<ElementRow>(`SELECT * FROM tbl_element WHERE element_id=?${projectId?' AND project_id=?':''}`,...[normalized,...(projectId?[projectId]:[])]);
 const allowed=rows.filter(r=>{try{assertProjectAccess(user,r.project_id);return true;}catch{return false;}});
 if(!allowed.length)throw new ApiError(user.role==='admin'?'NOT_FOUND':'FORBIDDEN');
 if(allowed.length>1)throw new ApiError('INVALID_ARGUMENT','元素 ID 在多个项目内存在，请指定 project_id。');
 const row=allowed[0]!;if(row.status==='void')throw new ApiError('TASK_STALE','这个元素 ID 已作废，不能复用。');return row;
}
export function draft(page:Page):any {
 const r=get<{tree_json:string;version:number;updated_at:string}>(`SELECT * FROM tbl_page_draft WHERE page_id=?`,page.page_id);
 const project=get<{element_id_seq:string}>(`SELECT element_id_seq FROM tbl_project WHERE project_id=?`,page.project_id);
 const success=readMeta<any>(page.project_id,`preview:${page.page_id}`)??null;
 const running=all(`SELECT task_id,seq,status FROM tbl_gen_task WHERE page_id=? AND type='code_gen' AND status IN ('queued','running') ORDER BY seq`,page.page_id);
 return {tree:json.parse<Node[]>(r?.tree_json,[]),id_base:json.parse(project?.element_id_seq,{}),version:r?.version??0,updated_at:r?.updated_at??'',last_success:success,running_tasks:running,latest_seq:get<{seq:number}>(`SELECT MAX(seq) seq FROM tbl_gen_task WHERE project_id=? AND type='code_gen'`,page.project_id)?.seq??0};
}
function canonicalStyle(node:Node):any {
 const s=checkedStyle(node);const dim=(d:any)=>({mode:d.mode==='wrap_content'?'wrap':d.mode==='match_parent'?'match':d.mode,value:d.value});
 return {...s,width:dim(s.width),height:dim(s.height)};
}
export function events(value:any):Record<string,boolean> {
 const flags={click:false,long_press:false,double_click:false};
 if(Array.isArray(value)) {
   if(value.length>3)throw new ApiError('INVALID_ARGUMENT','最多配置 3 类事件。');const seen=new Set<string>();
   for(const e of value) {const key=e?.event_type==='long_click'?'long_press':e?.event_type;
     if(!Object.hasOwn(flags,key)||seen.has(key)||(e.action_type??'none')!=='none'||(e.action_payload!=null))throw new ApiError('INVALID_ARGUMENT','事件仅支持三类空回调（none）。');
     seen.add(key);flags[key as keyof typeof flags]=true;
   }
 } else {if(value==null)return flags;if(typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([k,v])=>!Object.hasOwn(flags,k)||typeof v!=='boolean'))throw new ApiError('INVALID_ARGUMENT','事件配置无效。');Object.assign(flags,value);}
 return flags;
}
/** 验证完成前不分配 ID；事务中分配后回滚不会消耗/污染台账。 */
export function saveTree(page:Page,input:unknown,version:number):any {
 return tx(()=>{
  const current=draft(page);if(version!==current.version)throw new ApiError('VERSION_CONFLICT','草稿已被他人修改，本地内容已保留。',{current_version:current.version,current_tree:current.tree});
  if(!Array.isArray(input))throw new ApiError('INVALID_ARGUMENT','tree 必须为数组。');
  const project=get<{element_id_seq:string}>(`SELECT element_id_seq FROM tbl_project WHERE project_id=?`,page.project_id)!;
  const seq=json.parse<Record<string,number>>(project.element_id_seq,{});const temps=new Set<string>(),formal=new Set<string>();let count=0;
  const convert=(nodes:any[],depth:number):Node[]=>{
   if(depth>200)throw new ApiError('INVALID_ARGUMENT','元素层级超出上限。');
   return nodes.map(n=>{
    if(!n||typeof n!=='object'||!Array.isArray(n.children)||typeof n.temp_id!=='string'||!n.temp_id||temps.has(n.temp_id)||!Object.hasOwn(ANDROID_CLASSES,n.widget_type)||(n.status&&n.status!=='active'))throw new ApiError('INVALID_ARGUMENT','元素树包含非法节点。');
    temps.add(n.temp_id);if(++count>200)throw new ApiError('INVALID_ARGUMENT','单页最多 200 个控件。');
    const alias=n.alias??'';if(typeof alias!=='string'||[...alias].length>50)throw new ApiError('INVALID_ARGUMENT','别名最多 50 个字符。');
    let id:string;
    if(n.element_id) {
      id=normalizeElementId(n.element_id);const old=get<ElementRow>(`SELECT * FROM tbl_element WHERE project_id=? AND element_id=?`,page.project_id,id);
      if(!old||old.page_id!==page.page_id||old.widget_type!==n.widget_type||old.status!=='active')throw new ApiError('TASK_STALE','元素 ID 不属于当前页面或已作废，不能复用。');
    }else {seq[page.module_code]=(seq[page.module_code]??0)+1;if(seq[page.module_code]!>9999)throw new ApiError('INVALID_ARGUMENT','元素序号已达上限，请人工处理。');id=`EL-${page.module_code}-${String(seq[page.module_code]).padStart(3,'0')}`;}
    if(formal.has(id))throw new ApiError('INVALID_ARGUMENT','元素 ID 重复。');formal.add(id);
    const node:Node={element_id:id,temp_id:n.temp_id,widget_type:n.widget_type,alias,style:n.style,events:events(n.events),status:'active',children:[]};
    node.style=canonicalStyle(node);node.children=convert(n.children,depth+1);return node;
   });
  };
  const tree=convert(input,0);activeNodes(tree);
  const persisted=all<ElementRow>(`SELECT * FROM tbl_element WHERE project_id=? AND page_id=? AND status='active'`,page.project_id,page.page_id);
  for(const r of persisted)if(!formal.has(r.element_id))run(`UPDATE tbl_element SET status='void',voided_at=?,version=version+1 WHERE project_id=? AND element_id=?`,nowIso(),page.project_id,r.element_id);
  const persist=(nodes:Node[],parent:string|null)=>nodes.forEach((n,index)=>{
   run(`INSERT INTO tbl_element(element_id,project_id,page_id,parent_element_id,widget_type,alias,order_index,status,temp_id,version,created_at) VALUES(?,?,?,?,?,?,?,'active',?,1,?) ON CONFLICT(project_id,element_id) DO UPDATE SET parent_element_id=excluded.parent_element_id,alias=excluded.alias,order_index=excluded.order_index,temp_id=excluded.temp_id,version=tbl_element.version+1`,n.element_id,page.project_id,page.page_id,parent,n.widget_type,n.alias,index,n.temp_id,nowIso());
   run(`INSERT INTO tbl_style_props(project_id,element_id,props_json,version) VALUES(?,?,?,1) ON CONFLICT(project_id,element_id) DO UPDATE SET props_json=excluded.props_json,version=tbl_style_props.version+1`,page.project_id,n.element_id,JSON.stringify(n.style));
   run(`DELETE FROM tbl_element_event WHERE project_id=? AND element_id=?`,page.project_id,n.element_id);
   for(const [key,on]of Object.entries(n.events))if(on)run(`INSERT INTO tbl_element_event(project_id,element_id,event_kind,action_type,payload_json) VALUES(?,?,?,'none','{}')`,page.project_id,n.element_id,key);
   persist(n.children,n.element_id);
  });persist(tree,null);
  run(`UPDATE tbl_project SET element_id_seq=?,updated_at=? WHERE project_id=?`,JSON.stringify(seq),nowIso(),page.project_id);
  run(`INSERT INTO tbl_page_draft(page_id,project_id,tree_json,id_base_json,updated_at,version) VALUES(?,?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET tree_json=excluded.tree_json,id_base_json=excluded.id_base_json,updated_at=excluded.updated_at,version=excluded.version`,page.page_id,page.project_id,JSON.stringify(tree),JSON.stringify(seq),nowIso(),version+1);
  return draft(page);
 });
}
export function findNode(tree:Node[],id:string):Node|undefined {for(const n of tree){if(n.element_id===id)return n;const child=findNode(n.children,id);if(child)return child;}return undefined;}
export function removeNode(tree:Node[],id:string):Node[] {return tree.filter(n=>n.element_id!==id).map(n=>({...n,children:removeNode(n.children,id)}));}
