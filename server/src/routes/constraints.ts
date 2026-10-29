/**
 * `F17 / F18 工程接入与约束` —— #N1 接入扫描 / #N2 读约束 / #N3 编辑约束。
 *
 * 一期（`D1=B`）**只读**：登记本机工程根目录 → 只读扫描 → 约束包落库，**不写任何工程文件**。
 *  - 约束正文落 `tbl_kb_doc`（`sector='constraints'`），结构化索引落 `tbl_project_meta['constraints']`；
 *  - 项目标记 `source_kind='imported'` + `engineering_root`；
 *  - 提交类操作**幂等**（对齐 `D-A12`）；编辑带 `If-Match`（对齐 `D-Q14`）。
 */
import type { FastifyInstance } from "fastify";
import { ApiError, ok } from "../core/envelope.ts";
import { assertProjectAccess, currentUser } from "../core/auth.ts";
import { assertIfMatch, idempotentReplay, rememberIdempotent } from "../core/idempotency.ts";
import { readMeta, writeMeta } from "../core/revisions.ts";
import { createLocalEngineeringAgent, summarizeConstraints, validateEngineeringRoot, type ConstraintPack, type EngineeringAgent } from "../adapters/engineering.ts";
import { all, get, nowIso, run, tx, uid } from "../db/index.ts";

const TITLE = "工程约束包";
const SECTOR = "constraints";

interface KbRow { kb_doc_id: string; version: number; content_md: string; origin: string; updated_at: string | null }

function loadConstraintDoc(projectId: string): KbRow | undefined {
  return get<KbRow>(
    `SELECT kb_doc_id, version, content_md, origin, updated_at FROM tbl_kb_doc
      WHERE project_id = ? AND sector = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1`, projectId, SECTOR);
}

export function registerConstraintRoutes(app: FastifyInstance, agent?: EngineeringAgent): void {
  const eng = agent ?? createLocalEngineeringAgent();

  /** #N1 接入已有工程：登记本地路径 → 只读扫描 → 约束包落库 */
  app.post<{ Params: { project_id: string }; Body: { root?: string; confirm?: boolean } }>(
    "/api/v1/projects/:project_id/engineering-intake", async (req, reply) => {
      const user = currentUser(req);
      const projectId = req.params.project_id;
      assertProjectAccess(user, projectId);

      const replay = idempotentReplay(req, user.user_id);
      if (replay) { void reply.status(200).send(replay); return; }

      if (req.body?.confirm !== true)
        throw new ApiError("INVALID_ARGUMENT", "请先确认授权平台只读扫描这个目录。");
      const root = validateEngineeringRoot(String(req.body?.root ?? ""));

      let pack: ConstraintPack;
      try {
        pack = await eng.scan(root);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError("INVALID_ARGUMENT", `扫描工程失败：${(e as Error).message}`);
      }
      if (!pack.android_detected)
        throw new ApiError("INVALID_ARGUMENT", "这个目录里没找到 Android 工程，未接入。");

      const ts = nowIso();
      const existing = loadConstraintDoc(projectId);
      let kbDocId: string;
      tx(() => {
        if (existing) {
          kbDocId = existing.kb_doc_id;
          run(`UPDATE tbl_kb_doc SET title = ?, content_md = ?, origin = 'agent_extracted', version = version + 1, updated_at = ?
               WHERE kb_doc_id = ?`, TITLE, pack.markdown, ts, kbDocId);
        } else {
          kbDocId = uid("kb");
          run(`INSERT INTO tbl_kb_doc (kb_doc_id, project_id, document_id, title, sector, origin, content_md, version, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)`, kbDocId, projectId, null, TITLE, SECTOR, "agent_extracted", pack.markdown, 1, ts, ts);
        }
        run(`UPDATE tbl_project SET source_kind = 'imported', engineering_root = ?, updated_at = ? WHERE project_id = ?`, root, ts, projectId);
      });
      // 结构化索引 + 授权留痕（不写工程文件，只记"读过")
      writeMeta(projectId, "constraints", {
        root, scanned_at: pack.scanned_at, source_kind: "imported",
        consent_acknowledged_at: ts, engine_kind: eng.kind,
        android: pack.android, namespace: pack.namespace, application_id: pack.application_id,
        modules: pack.modules, dependencies: pack.dependencies,
        agent_config_files: pack.agent_config_files, style_tools: pack.style_tools,
        naming_samples: pack.naming_samples, build_commands: pack.build_commands,
        items: pack.items, warnings: pack.warnings, kb_doc_id: kbDocId!,
      });

      const envelope = ok({
        source_kind: "imported", engineering_root: root, kb_doc_id: kbDocId!,
        android: pack.android, project_name: pack.project_name,
        counts: { modules: pack.modules.length, dependencies: pack.dependencies.length,
          agent_config_files: pack.agent_config_files.length, items: pack.items.length,
          naming_samples: pack.naming_samples.length },
        warnings: pack.warnings,
      }, String(req.id));
      rememberIdempotent(req, user.user_id, envelope);
      void reply.status(200).send(envelope);
    });

  /** #N2 读约束包（结构化 + 正文 + 版本，供编辑回显） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/constraints", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const meta = readMeta<Record<string, unknown>>(projectId, "constraints");
    const doc = loadConstraintDoc(projectId);
    if (!meta && !doc)
      throw new ApiError("NOT_FOUND", "这个项目还没有接入工程约束。");
    const proj = get<{ source_kind: string; engineering_root: string | null }>(
      `SELECT source_kind, engineering_root FROM tbl_project WHERE project_id = ?`, projectId);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: {
        source_kind: proj?.source_kind ?? "new",
        engineering_root: proj?.engineering_root ?? null,
        pack: meta ?? null,
        kb_doc_id: doc?.kb_doc_id ?? null,
        content_md: doc?.content_md ?? "",
        origin: doc?.origin ?? null,
        version: doc?.version ?? 0,
        updated_at: doc?.updated_at ?? null,
        summary: meta ? summarizeConstraints(meta as never) : "",
      },
    });
  });

  /** #N3 编辑约束正文（`origin → user_edited`；`If-Match` 不匹配 → 409） */
  app.put<{ Params: { project_id: string }; Body: { content_md?: string } }>(
    "/api/v1/projects/:project_id/constraints", async (req, reply) => {
      const user = currentUser(req);
      const projectId = req.params.project_id;
      assertProjectAccess(user, projectId);
      const doc = loadConstraintDoc(projectId);
      if (!doc) throw new ApiError("NOT_FOUND", "这个项目还没有接入工程约束。");
      assertIfMatch(req, doc.version);
      const content = String(req.body?.content_md ?? "");
      const next = doc.version + 1;
      const ts = nowIso();
      run(`UPDATE tbl_kb_doc SET content_md = ?, origin = 'user_edited', version = ?, updated_at = ? WHERE kb_doc_id = ?`,
        content, next, ts, doc.kb_doc_id);
      void reply.send({
        code: "OK", message: "", request_id: String(req.id),
        data: { kb_doc_id: doc.kb_doc_id, origin: "user_edited", version: next, updated_at: ts },
      });
    });

  /** 供其它模块复用：取某项目的**约束摘要**（无约束 → null） */
  void 0;
}

/** 供下游（审核 / 拆解 / Spec）复用：项目约束摘要文本（无约束返回 null） */
export function constraintsNoteFor(projectId: string): string | null {
  const meta = readMeta<Parameters<typeof summarizeConstraints>[0]>(projectId, "constraints");
  if (!meta) return null;
  const s = summarizeConstraints(meta);
  return s.trim() ? s : null;
}

/** 供列表/统计复用：项目是否已接入工程 */
export function isImportedProject(projectId: string): boolean {
  const r = get<{ source_kind: string }>(`SELECT source_kind FROM tbl_project WHERE project_id = ?`, projectId);
  return r?.source_kind === "imported";
}

void all;
