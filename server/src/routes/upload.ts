/**
 * `§1.3 上传与解析` —— #10 上传 / #11 飞书链接建文档 / #12 ⚡触发解析 / #13 revision 列表 /
 * #14 分块结果 / #15 手动补充。
 *
 * 要点：
 *  - `#10` 返回 **`file_id` + `document_id`**（闭合 `file_id→document_id` 链）；≤20MB、仅 `.docx`/`.md`；
 *  - `#12` 重复上传 → **新建 revision，旧的保留**；解析是 ⚡ 长任务；
 *  - **部分解析失败不是错误**：`parse_status = "partial"` + `parts` 里逐项标 `failed/ok/skipped`；
 *  - 解析成功后把内容抽进**知识库**（`origin = agent_extracted`）——「上传 PRD 后平台自动把内容抽进来」；
 *  - 解析是全流程唯一的「外发内容」源头，故 **`#12` 前必须校验外发开关**（关则 503，不静默降级）。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser } from "../core/auth.ts";
import { all, get, json, nowIso, run, tx, uid } from "../db/index.ts";
import { loadRevision as authorizedRevision, writeMeta, invalidateReviews, materializeEditedRevision } from "../core/revisions.ts";
import { readUpload, saveUpload } from "../db/uploads.ts";
import { startTask, createTask } from "../core/tasks.ts";
import { assertSupportedFormat, assertSizeOk, parseDocument, type ParsedParts } from "../adapters/parser.ts";
import { createFeishuDocAdapter } from "../adapters/feishu.ts";
import { assertEgressEnabled } from "./ai-egress.ts";


/**
 * 解析完成后的落库（正文进知识库 + 项目阶段推进）。
 * 知识库按 **`document_id` 归属**：同一文档重解析 → 更新同一篇；**不同文档即使标题相同也各成一篇**。
 */
function materialize(projectId: string, documentId: string, markdown: string, title: string) {
  const ts = nowIso();
  if (markdown.trim()) {
    const exists = get<{ kb_doc_id: string }>(
      `SELECT kb_doc_id FROM tbl_kb_doc WHERE project_id = ? AND document_id = ? AND sector = 'prd'`, projectId, documentId,
    );
    if (exists) {
      run(`UPDATE tbl_kb_doc SET title = ?, content_md = ?, origin = 'agent_extracted', version = version + 1, updated_at = ? WHERE kb_doc_id = ?`,
        title.slice(0, 80) || "PRD", markdown, ts, exists.kb_doc_id);
    } else {
      run(`INSERT INTO tbl_kb_doc (kb_doc_id, project_id, document_id, title, sector, origin, content_md, version, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        uid("kb"), projectId, documentId, title.slice(0, 80) || "PRD", "prd", "agent_extracted", markdown, 1, ts, ts);
    }
  }
  // 阶段推进：created → kb_ready（**只在仍是 created 时推进**，不回退已有进度）
  run(`UPDATE tbl_project SET stage = 'kb_ready', updated_at = ? WHERE project_id = ? AND stage = 'created'`, ts, projectId);
}

export function registerUploadRoutes(app: FastifyInstance) {
  const feishu = createFeishuDocAdapter();

  /** #10 上传文件（multipart） */
  app.post<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/uploads", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    assertEgressEnabled(user.user_id);

    let fileName = ""; let buf: Buffer | null = null;
    try {
      const part = await req.file();
      if (!part) throw new ApiError("INVALID_ARGUMENT", "请选择要上传的文件。");
      fileName = part.filename ?? "";
      buf = await part.toBuffer();
    } catch (e) {
      if (e instanceof ApiError || (e as {code?:string}).code === "FST_REQ_FILE_TOO_LARGE") throw e;
      throw new ApiError("INVALID_ARGUMENT", "上传的文件读不出来，请重试。");
    }
    if (!buf) throw new ApiError("INVALID_ARGUMENT", "请选择要上传的文件。");

    assertSupportedFormat(fileName);
    assertSizeOk(buf.length);
    if (buf.length === 0) throw new ApiError("INVALID_ARGUMENT", "文件是空的。");

    const documentId = uid("doc");
    const fileId = uid("f");
    const ts = nowIso();
    saveUpload(fileId, buf);   // **以系统 id 落盘**（原始文件名只作元数据）
    tx(() => {
      run(`INSERT INTO tbl_document (document_id, project_id, source_type, title, created_at) VALUES (?,?,?,?,?)`,
        documentId, projectId, "file", fileName.replace(/\.[^.]+$/, ""), ts);
      run(`INSERT INTO tbl_upload_file (file_id, project_id, document_id, file_name, size_bytes, created_at) VALUES (?,?,?,?,?,?)`,
        fileId, projectId, documentId, fileName, buf.length, ts);
    });
    void reply.status(201).send({
      code: "OK", message: "", request_id: String(req.id),
      data: { file_id: fileId, document_id: documentId, size_bytes: buf.length, status: "uploaded", reject_reason: null },
    });
  });

  /** #11 从飞书链接建文档（返回结构里带解析预取结果，失败不阻塞建档） */
  app.post<{ Params: { project_id: string }; Body: { source_type?: string; feishu_token?: string } }>(
    "/api/v1/projects/:project_id/documents", async (req, reply) => {
      const user = currentUser(req);
      const projectId = req.params.project_id;
      assertProjectAccess(user, projectId);
    assertEgressEnabled(user.user_id);
      const link = String(req.body?.feishu_token ?? "").trim();
      if (!link) throw new ApiError("INVALID_ARGUMENT", "链接无效或已失效。");
      if (!/^https?:\/\//i.test(link)) throw new ApiError("INVALID_ARGUMENT", "链接无效或已失效。");

      const documentId = uid("doc");
      const ts = nowIso();
      run(`INSERT INTO tbl_document (document_id, project_id, source_type, title, created_at) VALUES (?,?,?,?,?)`,
        documentId, projectId, "feishu_link", link, ts);
      void reply.status(201).send({
        code: "OK", message: "", request_id: String(req.id),
        data: { document_id: documentId, source_type: "feishu_link" },
      });
    });

  /** #12 ⚡ 触发解析（返回 task_id + revision_id；**旧 revision 保留**） */
  app.post<{ Params: { document_id: string } }>("/api/v1/documents/:document_id/revisions", async (req, reply) => {
    const user = currentUser(req);
    const doc = get<{ document_id: string; project_id: string; source_type: string; title: string }>(
      `SELECT document_id, project_id, source_type, title FROM tbl_document WHERE document_id = ?`, req.params.document_id,
    );
    if (!doc) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
    assertProjectAccess(user, doc.project_id);
    assertEgressEnabled(user.user_id); // 解析是外发内容源头（P0 合规）

    const baselineProject=get<{current_revision_id:string|null}>(`SELECT current_revision_id FROM tbl_project WHERE project_id=?`,doc.project_id);
    const baselineKb=get<{version:number}>(`SELECT version FROM tbl_kb_doc WHERE project_id=? AND document_id=?`,doc.project_id,doc.document_id);
    const revisionId = uid("rev");
    const ts = nowIso();
    run(`INSERT INTO tbl_doc_revision (revision_id, project_id, document_id, parse_status, empty_document, created_at)
         VALUES (?,?,?,?,?,?)`, revisionId, doc.project_id, doc.document_id, "parsing", 0, ts);

    const task = createTask({ projectId: doc.project_id, type: "parse" });
    startTask(task.task_id, async ({ progress, commit }) => {
      progress(10);
      // 取该 document 的最新上传文件（飞书来源则走适配器）
      const upload = get<{ file_id: string; file_name: string }>(
        `SELECT file_id, file_name FROM tbl_upload_file WHERE document_id = ? ORDER BY created_at DESC LIMIT 1`, doc.document_id,
      );
      let markdown = ""; let title = ""; let parts: ParsedParts;
      let status: string; let empty: boolean;
      if (upload) {
        const parsed = parseDocument(upload.file_name, readUpload(upload.file_id));
        ({markdown,title,parts}=parsed); status=parsed.parseStatus; empty=parsed.emptyDocument;
      } else {
        const parsed = await feishu.readDocument(doc.title);
        ({markdown,title,parts}=parsed);
        const failed = parts.body.status === "failed" || [...parts.tables,...parts.whiteboards,...parts.attachments].some(p=>p.status === "failed");
        status = failed ? "partial" : "succeeded"; empty = !markdown.trim();
      }
      progress(80);
      return commit(() => {
        const curProject=get<{current_revision_id:string|null}>(`SELECT current_revision_id FROM tbl_project WHERE project_id=?`,doc.project_id);
        const curKb=get<{version:number}>(`SELECT version FROM tbl_kb_doc WHERE project_id=? AND document_id=?`,doc.project_id,doc.document_id);
        if(curProject?.current_revision_id!==baselineProject?.current_revision_id || curKb?.version!==baselineKb?.version)
          throw new ApiError("TASK_STALE","解析期间 PRD 已更新，未覆盖已保存的内容。");
        run(`UPDATE tbl_doc_revision SET parse_status=?,empty_document=?,parts_json=? WHERE revision_id=?`,status,empty?1:0,json.stringify(parts),revisionId);
        writeMeta(doc.project_id, `revision:${revisionId}`, {markdown,title});
        if (!empty && status !== "failed") {
          run(`UPDATE tbl_project SET current_revision_id=?,updated_at=? WHERE project_id=?`,revisionId,nowIso(),doc.project_id);
          materialize(doc.project_id,doc.document_id,markdown,title);
          invalidateReviews(doc.project_id);
        }
        return revisionId;
      });
    }, {onFailure: () => { run(`UPDATE tbl_doc_revision SET parse_status='failed' WHERE revision_id=? AND parse_status='parsing'`,revisionId); }});

    void reply.status(202).send({
      code: "OK", message: "", request_id: String(req.id),
      data: { task_id: task.task_id, revision_id: revisionId },
    });
  });

  /** #13 revision 列表（倒序） */
  app.get<{ Params: { document_id: string } }>("/api/v1/documents/:document_id/revisions", async (req, reply) => {
    const user = currentUser(req);
    const doc = get<{ project_id: string }>(`SELECT project_id FROM tbl_document WHERE document_id = ?`, req.params.document_id);
    if (!doc) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
    assertProjectAccess(user, doc.project_id);
    const rows = all<{ revision_id: string; document_id: string; parse_status: string; created_at: string }>(
      `SELECT revision_id, document_id, parse_status, created_at FROM tbl_doc_revision
        WHERE document_id = ? ORDER BY created_at DESC`, req.params.document_id,
    );
    void reply.send({ code: "OK", message: "", request_id: String(req.id), data: { items: rows } });
  });

  /** #14 分块解析结果 */
  app.get<{ Params: { revision_id: string } }>("/api/v1/revisions/:revision_id/parse-result", async (req, reply) => {
    const user = currentUser(req);
    const r = authorizedRevision(user, req.params.revision_id);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: {
        parse_status: r.parse_status,
        empty_document: !!r.empty_document,
        parts: json.parse<ParsedParts>(r.parts_json, { body: { status: "skipped" }, tables: [], whiteboards: [], attachments: [] }),
        manual: json.parse<Record<string, string>>(r.manual_json, {}),
      },
    });
  });

  /** #15 部分解析失败的手动补充 */
  app.post<{ Params: { revision_id: string; part_key: string }; Body: { content?: string } }>(
    "/api/v1/revisions/:revision_id/parts/:part_key/manual-supplement", async (req, reply) => {
      const user = currentUser(req);
      const r = authorizedRevision(user, req.params.revision_id);
      const key = req.params.part_key;
      const content = String(req.body?.content ?? "").trim();
      if (!content) throw new ApiError("INVALID_ARGUMENT", "补充内容不能为空。");
      const current=get<{current_revision_id:string}>(`SELECT current_revision_id FROM tbl_project WHERE project_id=?`,r.project_id);
      if(current?.current_revision_id!==r.revision_id) throw new ApiError("TASK_STALE","不能把历史版本的补充写入当前 PRD。");
      if (r.parse_status !== "partial") throw new ApiError("INVALID_ARGUMENT", "只有解析缺失的分块可以手动补充。");
      const parts = json.parse<ParsedParts>(r.parts_json, {body:{status:"skipped"},tables:[],whiteboards:[],attachments:[]});
      const candidates = [
        {key:"body",part:parts.body},
        ...parts.tables.map(p=>({key:`table:${p.token}`,part:p})),
        ...parts.whiteboards.map(p=>({key:`whiteboard:${p.token}`,part:p})),
        ...parts.attachments.map(p=>({key:`attachment:${p.name}`,part:p})),
      ];
      const selected = candidates.find(p=>p.key === key || p.key.split(":").slice(1).join(":") === key);
      if (!selected || selected.part.status !== "failed") throw new ApiError("INVALID_ARGUMENT", "该分块不是待补充的缺失项。");
      const manual = json.parse<Record<string,string>>(r.manual_json, {}); manual[key]=content;
      selected.part.status="ok";
      const stillMissing = candidates.some(p=>p.part.status === "failed");
      tx(() => {
        run(`UPDATE tbl_doc_revision SET manual_json=?,parts_json=?,parse_status=? WHERE revision_id=?`,json.stringify(manual),json.stringify(parts),stillMissing?"partial":"succeeded",r.revision_id);
        const kb = get<{kb_doc_id:string;content_md:string}>(`SELECT kb_doc_id,content_md FROM tbl_kb_doc WHERE project_id=? AND document_id=? AND sector='prd'`,r.project_id,r.document_id);
        if (!kb) throw new ApiError("TASK_STALE","补充对应正文不存在。");
        const next=`${kb.content_md}\n\n## 手动补充（${key}）\n\n${content}`;
        run(`UPDATE tbl_kb_doc SET content_md=?,origin='user_edited',version=version+1,updated_at=? WHERE kb_doc_id=?`,next,nowIso(),kb.kb_doc_id);
        materializeEditedRevision(r.project_id,r.document_id,next);
      });

      void reply.send({
        code: "OK", message: "", request_id: String(req.id),
        data: { part_key: key, supplemented: true },
      });
    });
}
