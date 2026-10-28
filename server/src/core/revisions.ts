import { createHash } from 'node:crypto';
import { ApiError } from './envelope.ts';
import type { User } from './auth.ts';
import { assertProjectAccess } from './auth.ts';
import { get, run, nowIso, json, uid } from '../db/index.ts';
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function readMeta<T>(projectId: string, key: string): T | undefined {
  const r = get<{ value: string }>(`SELECT value FROM tbl_project_meta WHERE project_id=? AND meta_key=?`, projectId, key);
  return r ? JSON.parse(r.value) as T : undefined;
}
export function writeMeta(projectId: string, key: string, value: unknown): void {
  run(`INSERT OR REPLACE INTO tbl_project_meta(project_id,meta_key,value) VALUES(?,?,?)`, projectId, key, JSON.stringify(value));
}
export interface Revision { revision_id: string; project_id: string; document_id: string; parse_status: string; empty_document: number; parts_json: string; manual_json: string }
export function loadRevision(user: User, id: string): Revision {
  const r = get<Revision>(`SELECT * FROM tbl_doc_revision WHERE revision_id=?`, id);
  if (!r) throw new ApiError(user.role === 'admin' ? 'NOT_FOUND' : 'FORBIDDEN');
  assertProjectAccess(user, r.project_id); return r;
}
export function revisionText(r: Revision): string {
  const saved = readMeta<{ markdown: string }>(r.project_id, `revision:${r.revision_id}`);
  if (!saved) throw new ApiError('TASK_STALE', '该旧版本尚无正文快照，请重新解析后审核。');
  const manual = json.parse<Record<string, string>>(r.manual_json, {});
  return saved.markdown + Object.entries(manual).map(([k,v]) => `\n\n## 手动补充（${k}）\n\n${v}`).join('');
}
export function invalidateReviews(projectId: string): void {
  run(`UPDATE tbl_review_report SET superseded=1 WHERE project_id=?`, projectId);
  run(`UPDATE tbl_project SET stage='kb_ready',updated_at=? WHERE project_id=?`, nowIso(), projectId);
}
export function assertReviewCurrent(r: { project_id: string; revision_id: string; review_id: string; superseded: number }): void {
  const p = get<{ current_revision_id: string }>(`SELECT current_revision_id FROM tbl_project WHERE project_id=?`, r.project_id);
  const input = readMeta<{ hash: string; kb_version: number; document_id: string }>(r.project_id, `review:${r.review_id}`);
  const rev = get<Revision>(`SELECT * FROM tbl_doc_revision WHERE revision_id=?`, r.revision_id);
  const kb = input && get<{version: number}>(`SELECT version FROM tbl_kb_doc WHERE project_id=? AND document_id=?`, r.project_id, input.document_id);
  if (r.superseded || p?.current_revision_id !== r.revision_id || !rev || !input || input.hash !== digest(revisionText(rev)) || input.kb_version !== kb?.version)
    throw new ApiError('TASK_STALE', '这份审核已过期，请重新审核当前 PRD。');
}
export function assertSplitGate(projectId: string): { revision: Revision; reviewId: string; markdown: string } {
  const p = get<{current_revision_id: string}>(`SELECT current_revision_id FROM tbl_project WHERE project_id=?`, projectId);
  const r = get<{ review_id: string; project_id: string; revision_id: string; superseded: number; verdict: string; counts_json: string }>(
    `SELECT * FROM tbl_review_report WHERE project_id=? AND revision_id=? AND superseded=0 ORDER BY created_at DESC,review_id DESC LIMIT 1`, projectId, p?.current_revision_id ?? '');
  if (!r) throw new ApiError('INVALID_ARGUMENT', '请先完成当前 PRD 的门禁审核。');
  assertReviewCurrent(r);
  const open = get<{n:number}>(`SELECT COUNT(*) n FROM tbl_gate_question WHERE review_id=? AND level='blocking' AND status NOT IN ('answered','converted')`, r.review_id)?.n ?? 0;
  if (open) throw new ApiError('INVALID_ARGUMENT', `还有 ${open} 项阻断没有作答，无法进入拆解。`);
  if (r.verdict !== 'passed' || json.parse<{blocking:number}>(r.counts_json, {blocking:1}).blocking > 0)
    throw new ApiError('INVALID_ARGUMENT', '当前 PRD 未通过门禁，请补充内容并重新审核。');
  const unset = get<{n:number}>(`SELECT COUNT(*) n FROM tbl_assumption WHERE review_id=? AND choice='unset'`, r.review_id)?.n ?? 0;
  if (unset) throw new ApiError('INVALID_ARGUMENT', `还有 ${unset} 条假设没有选择，先逐条选完再继续。`);
  const revision = get<Revision>(`SELECT * FROM tbl_doc_revision WHERE revision_id=?`, r.revision_id)!;
  return { revision, reviewId:r.review_id, markdown: revisionText(revision) };
}

/** 用户编辑/显式回写产生新 revision，旧原文/审核快照不可变。 */
export function materializeEditedRevision(projectId: string, documentId: string, markdown: string): string {
  const id=uid("rev");
  run(`INSERT INTO tbl_doc_revision(revision_id,project_id,document_id,parse_status,empty_document,parts_json,created_at) VALUES(?,?,?,'succeeded',?, ?,?)`,id,projectId,documentId,markdown.trim()?0:1,JSON.stringify({body:{status:"ok",chars:[...markdown].length},tables:[],whiteboards:[],attachments:[]}),nowIso());
  writeMeta(projectId,`revision:${id}`,{markdown});
  run(`UPDATE tbl_project SET current_revision_id=? WHERE project_id=?`,id,projectId); invalidateReviews(projectId); return id;
}
