import type { FastifyInstance } from 'fastify';
import { ApiError } from '../core/envelope.ts';
import { assertProjectAccess,currentUser } from '../core/auth.ts';
import { assertIfMatch } from '../core/idempotency.ts';
import { all } from '../db/index.ts';
import { loadPage,ensurePage,draft,saveTree,loadElement,findNode,removeNode,events,defaultStyle,type Node,type Page } from '../core/editor.ts';
const send=(req:any,reply:any,data:any,status=200)=>reply.status(status).send({code:'OK',message:'',data,request_id:String(req.id)});
export function registerEditorRoutes(app:FastifyInstance):void {
 app.get<{Params:{project_id:string}}>('/api/v1/projects/:project_id/pages',async(req,reply)=>{
  const user=currentUser(req);assertProjectAccess(user,req.params.project_id);ensurePage(req.params.project_id);
  return send(req,reply,{items:all<Page>(`SELECT page_id,module_code,name,order_index,status FROM tbl_page WHERE project_id=? ORDER BY order_index,page_id`,req.params.project_id)});
 });
 app.get<{Params:{page_id:string}}>('/api/v1/pages/:page_id/draft',async(req,reply)=>send(req,reply,draft(loadPage(currentUser(req),req.params.page_id))));
 app.put<{Params:{page_id:string};Body:{tree:Node[]}}>('/api/v1/pages/:page_id/draft',async(req,reply)=>{
  const page=loadPage(currentUser(req),req.params.page_id),d=draft(page);assertIfMatch(req,d.version);
  return send(req,reply,saveTree(page,req.body?.tree,d.version));
 });
 app.get<{Params:{project_id:string}}>('/api/v1/projects/:project_id/element-id-ledger',async(req,reply)=>{
  assertProjectAccess(currentUser(req),req.params.project_id);
  return send(req,reply,{items:all(`SELECT element_id,alias,status,voided_at,version,page_id FROM tbl_element WHERE project_id=? ORDER BY created_at,element_id`,req.params.project_id)});
 });
 app.post<{Params:{page_id:string};Body:{widget_type:string;parent_element_id?:string;order_index:number;alias?:string;temp_id?:string}}>('/api/v1/pages/:page_id/elements',async(req,reply)=>{
  const page=loadPage(currentUser(req),req.params.page_id),d=draft(page),b=req.body;
  if(!Number.isInteger(b?.order_index)||b.order_index<0)throw new ApiError('INVALID_ARGUMENT','order_index 必须为非负整数。');
  const tree=structuredClone(d.tree) as Node[];const parent=b.parent_element_id?findNode(tree,b.parent_element_id.toUpperCase().replace(/-(\d+)$/,(_,n)=>`-${String(Number(n)).padStart(3,'0')}`)):null;
  if(b.parent_element_id&&!parent)throw new ApiError('INVALID_ARGUMENT','这个容器不能再放控件。');
  const siblings=parent?parent.children:tree;if(b.order_index>siblings.length)throw new ApiError('INVALID_ARGUMENT','order_index 超出当前同级范围。');
  const tmp=b.temp_id??crypto.randomUUID();siblings.splice(b.order_index,0,{element_id:null,temp_id:tmp,widget_type:b.widget_type,alias:b.alias??'',style:defaultStyle(),events:events(null),status:'active',children:[]});
  const saved=saveTree(page,tree,d.version);const flattened=(ns:Node[]):Node[]=>ns.flatMap(n=>[n,...flattened(n.children)]);const node=flattened(saved.tree).find(n=>n.temp_id===tmp)!;
  return send(req,reply,{...node,order_index:b.order_index,version:all<any>(`SELECT version FROM tbl_element WHERE project_id=? AND element_id=?`,page.project_id,node.element_id)[0].version},201);
 });
 for(const suffix of ['', '/style','/events'] as const) {
  const method=suffix?'PUT':'PATCH';
  app.route<{Params:{element_id:string};Querystring:{project_id?:string};Body:any}>({method,url:`/api/v1/elements/:element_id${suffix}`,handler:async(req,reply)=>{
    const b=req.body as any;
    const user=currentUser(req),e=loadElement(user,req.params.element_id,req.query.project_id);assertIfMatch(req,e.version);
    const page=loadPage(user,e.page_id),d=draft(page),tree=structuredClone(d.tree) as Node[],node=findNode(tree,e.element_id)!;
    if(!node)throw new ApiError('TASK_STALE','元素已不在当前草稿内。');
    if(suffix==='/style')node.style=req.body;
    else if(suffix==='/events')node.events=events(b?.events);
    else {
      if(b.alias!==undefined)node.alias=b.alias;
      if(b.parent_element_id!==undefined||b.order_index!==undefined) {
        const removed=removeNode(tree,e.element_id);const parentId=b.parent_element_id===undefined?e.parent_element_id:b.parent_element_id;
        const parent=parentId?findNode(removed,parentId):null;
        if(parentId&&!parent)throw new ApiError('INVALID_ARGUMENT','不能移入自己的后代或其他页面。');
        const siblings=parent?parent.children:removed;const i=b.order_index??siblings.length;
        if(!Number.isInteger(i)||i<0||i>siblings.length)throw new ApiError('INVALID_ARGUMENT','排序位置无效。');siblings.splice(i,0,node);
        return send(req,reply,saveTree(page,removed,d.version));
      }
    }
    const saved=saveTree(page,tree,d.version);const result=all(`SELECT version FROM tbl_element WHERE project_id=? AND element_id=?`,e.project_id,e.element_id)[0];
    return send(req,reply,{element_id:e.element_id,...result,draft:saved});
  }});
 }
 app.delete<{Params:{element_id:string};Querystring:{project_id?:string;confirm?:string}}>( '/api/v1/elements/:element_id',async(req,reply)=>{
  const user=currentUser(req),e=loadElement(user,req.params.element_id,req.query.project_id);
  if(req.query.confirm!=='true')throw new ApiError('INVALID_ARGUMENT','删除元素需要显式 confirm=true。');
  const page=loadPage(user,e.page_id),d=draft(page);saveTree(page,removeNode(d.tree,e.element_id),d.version);
  return send(req,reply,{element_id:e.element_id,status:'void'});
 });
}
