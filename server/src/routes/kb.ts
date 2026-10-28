/**
 * `§1.2 知识库`（§F1）—— #7 列表 / #8 详情 / #9 用户编辑。
 *
 * 硬约束：**只含本项目内容**（跨项目检索不可能发生 —— 强制按 `project_id` 过滤 + 逐对象鉴权）；
 * 编辑后 `origin` 置 `user_edited`，须带 `If-Match`。
 */
import type { FastifyInstance } from "fastify";
import { digest, invalidateReviews, materializeEditedRevision } from "../core/revisions.ts";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser, type User } from "../core/auth.ts";
import { assertIfMatch } from "../core/idempotency.ts";
import { parsePage, withMeta } from "../core/pagination.ts";
import { all, get, nowIso, run, tx } from "../db/index.ts";

const SECTORS = new Set(["prd", "spec", "glossary", "domain"]);

interface KbRow {
  kb_doc_id: string; project_id: string; document_id: string | null; title: string; sector: string; origin: string;
  content_md: string; version: number; created_at: string; updated_at: string | null;
}

function loadDoc(user: User, kbDocId: string): KbRow {
  const row = get<KbRow>(`SELECT * FROM tbl_kb_doc WHERE kb_doc_id = ?`, kbDocId);
  // 不存在 → 先判越权（**不泄露存在性**）：无成员关系一律 403
  if (!row) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
  assertProjectAccess(user, row.project_id);
  return row;
}

export function registerKbRoutes(app: FastifyInstance) {
  /** #7 列表（强制按 project_id 过滤 + 逐对象鉴权；`q` ≤100 字符） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/kb-docs", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const p = parsePage(req);
    const sector = String((req.query as Record<string, unknown>)?.sector ?? "");
    const rows = all<KbRow>(`SELECT * FROM tbl_kb_doc WHERE project_id = ?`, projectId)
      .filter((r) => (sector ? r.sector === sector : true))
      .filter((r) => (p.q ? r.title.includes(p.q) || r.content_md.includes(p.q) : true))
      .map(({ content_md, ...rest }) => { void content_md; return { ...rest }; });
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: withMeta(rows, p, "kb_doc_id"),
    });
  });

  /** #8 详情（Markdown 原文） */
  app.get<{ Params: { kb_doc_id: string } }>("/api/v1/kb-docs/:kb_doc_id", async (req, reply) => {
    const user = currentUser(req);
    const d = loadDoc(user, req.params.kb_doc_id);
    void reply.send({ code: "OK", message: "", data: { ...d, content_hash: digest(d.content_md) }, request_id: String(req.id) });
  });

  /** #9 用户编辑（origin → `user_edited`；`If-Match` 不匹配 → 409） */
  app.put<{ Params: { kb_doc_id: string }; Body: { content_md?: string } }>(
    "/api/v1/kb-docs/:kb_doc_id", async (req, reply) => {
      const user = currentUser(req);
      const d = loadDoc(user, req.params.kb_doc_id);
      assertIfMatch(req, d.version);
      const content = String(req.body?.content_md ?? "");
      const nextVersion = d.version + 1;
      tx(()=> {
      run(
        `UPDATE tbl_kb_doc SET content_md = ?, origin = 'user_edited', version = ?, updated_at = ? WHERE kb_doc_id = ?`,
        content, nextVersion, nowIso(), d.kb_doc_id,
      );
      if (d.sector === "prd") { if(d.document_id) materializeEditedRevision(d.project_id,d.document_id,content); else invalidateReviews(d.project_id); }
      });
      void reply.send({
        code: "OK", message: "", request_id: String(req.id),
        data: { kb_doc_id: d.kb_doc_id, origin: "user_edited", version: nextVersion, updated_at: nowIso() },
      });
    });

  /** 分区合法性（供上传/解析链路复用） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/kb-sectors", async (req, reply) => {
    const user = currentUser(req);
    assertProjectAccess(user, req.params.project_id);
    void reply.send({ code: "OK", message: "", data: { sectors: [...SECTORS] }, request_id: String(req.id) });
  });
}
