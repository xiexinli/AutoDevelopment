/**
 * `§1.1 项目` —— #1 列表 / #2 新建 / #3 详情 / #4 改 / #5 逻辑删除 / #6 顶部状态条。
 *
 * 逐对象鉴权（`§0.1`）：列表按**成员关系**过滤；详情 / 改 / 删都先 `assertProjectAccess`。
 */
import type { FastifyInstance } from "fastify";
import { ApiError, ok } from "../core/envelope.ts";
import { assertProjectAccess, currentUser, type User } from "../core/auth.ts";
import { assertIfMatch, idempotentReplay, rememberIdempotent } from "../core/idempotency.ts";
import { parsePage, withMeta } from "../core/pagination.ts";
import { all, get, json, nowIso, run, tx, uid } from "../db/index.ts";

/** 17 态（`数据模型 §3.1`），未知值原样透出 */
const STAGES = new Set([
  "created", "kb_ready", "reviewing", "chatting", "gate_passed", "gate_blocked", "splitting",
  "spec_generating", "spec_ready", "ui_finalizing", "api_developing", "app_developing",
  "editing", "generating", "verifying", "preview_ready", "testing", "delivered", "manual_needed",
  // `#70` 中止并归档本流程（数据保留、仍可读）
  "archived",
]);

interface ProjectRow {
  project_id: string; owner_user_id: string; name: string; description: string; stage: string;
  depth: string; review_level: string; review_extended: number; version: number; element_id_seq: string;
  current_revision_id: string | null; current_version_id: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}

function loadProject(user: User, projectId: string): ProjectRow {
  assertProjectAccess(user, projectId); // 越权 → 403（**不区分对象是否存在**）
  const row = get<ProjectRow>(`SELECT * FROM tbl_project WHERE project_id = ? AND deleted_at IS NULL`, projectId);
  if (!row) throw new ApiError("NOT_FOUND");
  return row;
}

export function registerProjectRoutes(app: FastifyInstance) {
  /** #1 列表（逐对象过滤 + 稳定分页） */
  app.get("/api/v1/projects", async (req, reply) => {
    const user = currentUser(req);
    const p = parsePage(req);
    const rows = all<ProjectRow>(
      `SELECT * FROM tbl_project
        WHERE deleted_at IS NULL
          AND project_id IN (SELECT project_id FROM tbl_project_member WHERE user_id = ?)`,
      user.user_id,
    ).filter((r) => (p.q ? r.name.includes(p.q) : true))
      .map((r) => ({
        project_id: r.project_id, name: r.name, stage: r.stage,
        updated_at: r.updated_at, created_at: r.created_at, version: r.version,
      }));
    const paged = withMeta(rows, p, "project_id");
    void reply.send({ code: "OK", message: "", data: paged, request_id: String(req.id) });
  });

  /** #2 新建（提交类 → 幂等：同键 3s 内重放返回**首次结果**，不产生第二次副作用） */
  app.post<{ Body: { name?: string; description?: string } }>("/api/v1/projects", async (req, reply) => {
    const user = currentUser(req);

    // ① 幂等重放：命中则直接返回首次结果（含首次的 request_id —— 「返回首次结果」）
    const replay = idempotentReplay(req, user.user_id);
    if (replay) { void reply.status(201).send(replay); return; }

    const name = String(req.body?.name ?? "").trim();
    const description = String(req.body?.description ?? "");
    if (!name || [...name].length > 50) throw new ApiError("INVALID_ARGUMENT", "项目名不能为空，长度 1~50。");
    const id = uid("p");
    const ts = nowIso();
    tx(() => {
      run(
        `INSERT INTO tbl_project (project_id, owner_user_id, name, description, stage, depth, version,
           element_id_seq, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, user.user_id, name, description, "created", "standard", 1, "{}", ts, ts,
      );
      run(`INSERT INTO tbl_project_member (project_id, user_id, role) VALUES (?,?,?)`, id, user.user_id, "owner");
      run(`INSERT INTO tbl_project_meta (project_id, meta_key, value) VALUES (?,?,?)`, id, "loopback_round", "1");
    });

    // ② 记录首次结果，供窗口内重放命中
    const envelope = ok({ project_id: id, name, stage: "created", created_at: ts, version: 1 }, String(req.id));
    rememberIdempotent(req, user.user_id, envelope);
    void reply.status(201).send(envelope);
  });

  /** #3 详情 */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id", async (req, reply) => {
    const user = currentUser(req);
    const row = loadProject(user, req.params.project_id);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: {
        // S1（语义核对 2026-10-22 销项）：契约/`接口-Spec §5.5.3` 声明含 `owner_user_id`，此前漏返回。
        project_id: row.project_id, owner_user_id: row.owner_user_id,
        name: row.name, description: row.description,
        stage: row.stage, depth: row.depth, version: row.version,
        // 审核分级（2026-10-28 定稿）：项目级默认等级 + 超严扩展开关
        review_level: row.review_level ?? "standard",
        review_extended: !!(row.review_extended ?? 0),
        // S2：声明「未产生时为 `null`」（键必须存在）；`?? undefined` 会被 JSON.stringify 丢键 → 改 `?? null`。
        current_revision_id: row.current_revision_id ?? null,
        current_version_id: row.current_version_id ?? null,
        created_at: row.created_at, updated_at: row.updated_at,
      },
    });
  });

  /** #4 重命名 / 改说明（乐观锁 → `If-Match`） */
  app.patch<{ Params: { project_id: string }; Body: { name?: string; description?: string } }>(
    "/api/v1/projects/:project_id", async (req, reply) => {
      const user = currentUser(req);
      const row = loadProject(user, req.params.project_id);
      assertIfMatch(req, row.version);
      const body = req.body ?? {};
      if (body.name !== undefined) {
        const nm = String(body.name).trim();
        if (!nm || [...nm].length > 50) throw new ApiError("INVALID_ARGUMENT", "项目名不能为空，长度 1~50。");
        row.name = nm;
      }
      if (body.description !== undefined) row.description = String(body.description);
      const nextVersion = row.version + 1;
      run(`UPDATE tbl_project SET name = ?, description = ?, version = ?, updated_at = ? WHERE project_id = ?`,
        row.name, row.description, nextVersion, nowIso(), row.project_id);
      void reply.send({
        code: "OK", message: "", request_id: String(req.id),
        data: { project_id: row.project_id, name: row.name, description: row.description,
          stage: row.stage, depth: row.depth, version: nextVersion, updated_at: nowIso() },
      });
    });

  /** #5 逻辑删除（30 天后物理清除；`⬛` 破坏性操作，**服务端亦须校验二次确认**） */
  app.delete<{ Params: { project_id: string }; Body: { confirm?: boolean } }>("/api/v1/projects/:project_id", async (req, reply) => {
    const user = currentUser(req);
    const row = loadProject(user, req.params.project_id);
    // S4（语义核对 2026-10-22 销项）：契约把 #5 标 `⬛`＝破坏性操作、服务端亦须校验；
    // 对照 #38/#52/#70 同类接口一律要求显式确认。缺失 / 非 true → 400。
    if (req.body?.confirm !== true) throw new ApiError("INVALID_ARGUMENT", "删除项目需要显式确认。");
    const deletedAt = nowIso();
    run(`UPDATE tbl_project SET deleted_at = ?, updated_at = ? WHERE project_id = ?`, deletedAt, deletedAt, row.project_id);
    // 出参与契约/`接口-Spec §5.4.1 #5`、`测试-Spec TC-PROJ-019` 对齐（原实现返回 `null`）。
    void reply.send({ code: "OK", message: "", data: { deleted_at: deletedAt }, request_id: String(req.id) });
  });

  /** #6 顶部状态条：门禁徽标 / 版本号 / 进行中任务数 / `loopback_round` / 评分卡绑定哪个 revision */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/stats", async (req, reply) => {
    const user = currentUser(req);
    const row = loadProject(user, req.params.project_id);
    const latestReview = get<{ verdict: string; counts_json: string; revision_id: string }>(
      `SELECT verdict, counts_json, revision_id FROM tbl_review_report WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
      row.project_id,
    );
    const counts = json.parse<Record<string, number>>(latestReview?.counts_json, {});
    const running = get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tbl_gen_task WHERE project_id = ? AND status IN ('queued','running')`,
      row.project_id,
    );
    const currentVersion = get<{ seq: number }>(
      `SELECT seq FROM tbl_project_version WHERE project_id = ? AND status = 'current' ORDER BY seq DESC LIMIT 1`,
      row.project_id,
    );
    const lb = get<{ value: string }>(
      `SELECT value FROM tbl_project_meta WHERE project_id = ? AND meta_key = 'loopback_round'`, row.project_id,
    );
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: {
        stage: STAGES.has(row.stage) ? row.stage : row.stage,
        // 2026-10-22（D-1 残余收口）：前端据此区分「从未审核」与「已审核但 PRD 换版」，
        // 后者要显示 `EL-REVIEW-033`「已过期」+「重新审核」，**不得进页自动开审**。
        current_revision_id: row.current_revision_id ?? null,
        version_seq: currentVersion?.seq ?? 0,
        running_tasks: running?.n ?? 0,
        loopback_round: Number(lb?.value ?? 1),
        gate: {
          verdict: latestReview?.verdict ?? "unreviewed",   // unreviewed | running | passed | blocked
          blocking_count: counts.blocking ?? 0,
          major_count: counts.major ?? 0,
          /** 最新一条审核报告绑定的 revision；无报告时 `null` */
          review_revision_id: latestReview?.revision_id ?? null,
          /** 项目当前审核等级（2026-10-28 分级定稿）：前端据此回显档位 */
          review_level: row.review_level ?? "standard",
          review_extended: !!(row.review_extended ?? 0),
        },
      },
    });
  });

}
