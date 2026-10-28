/**
 * `§1.10 版本` —— #54 列表 / #55 打版本（整包快照）/ #56 diff / #57 整包回滚。
 *
 * 契约要点（`接口契约 §1.10`、`接口-Spec §5.5.28`）：
 *  - `#54`：`seq` 倒序，**`current` 唯一**；每项含 `created_by` / `created_by_name` / `summary` / `artifacts[]`；
 *  - `#55`：整包快照，**快照范围穷举 5 项**（Spec / 接口定义 / 能力配置 / 已生成安卓代码 / 埋点方案）；
 *          旧版本置 `superseded`；**触发时机 = 每次生成 Spec 打一个项目级版本号**（`§F12` 方案 A）；
 *  - `#56`：`{path, left, right, change}`，`change ∈ {新增,删除,修改}`（**文字标识，不只靠颜色**）；
 *          接口定义按**字段级**、Spec 按**文档级**；
 *  - `#57`：`⬛` 整包回滚，**要么全成要么全不成**；目标版本置 `current`，被回滚掉的置 `rolled_back`；
 *          **快照只读保留，回滚后数据仍可读**；服务端亦须校验（不能只靠前端确认弹窗）。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser, type User } from "../core/auth.ts";
import { all, get, json, nowIso, run, tx, uid } from "../db/index.ts";

export const ARTIFACT_KEYS = ["spec", "apis", "capabilities", "android_code", "tracking_plan"] as const;

export interface VersionSnapshot {
  specs: { role: string; content_md: string; status: string }[];
  apis: Record<string, unknown>[];
  capabilities: Record<string, unknown>[];
  tracking: Record<string, unknown>[];
  android_code: { task_id: string | null; artifact_count: number };
}

interface VersionRow {
  version_id: string; project_id: string; seq: number; status: string;
  created_by: string; created_by_name: string; summary: string;
  artifacts_json: string; snapshot_json: string; created_at: string;
}

/**
 * 采集当前项目状态（**整包快照的 5 项范围**）。
 *
 * `androidTaskId` 用于「刚跑完的这次代码生成」——它尚未提交为 `succeeded`，
 * 不能靠「最近一次成功任务」推断，必须显式传入。
 */
export function buildSnapshot(projectId: string, androidTaskId?: string | null): VersionSnapshot {
  const specs = all<{ role: string; content_md: string; status: string }>(
    `SELECT role, content_md, status FROM tbl_spec_doc WHERE project_id = ? ORDER BY role_order`, projectId);
  const apis = all<Record<string, unknown>>(
    `SELECT api_id, code, name, method, path, status, fields_json, version FROM tbl_api_def
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY code`, projectId);
  const capabilities = all<Record<string, unknown>>(
    `SELECT cap_key, enabled, code_status FROM tbl_capability_config WHERE project_id = ? ORDER BY cap_key`, projectId);
  const tracking = all<Record<string, unknown>>(
    `SELECT event_key, trigger_desc, params_json, element_id FROM tbl_track_plan WHERE project_id = ? ORDER BY event_key`, projectId);
  const taskId = androidTaskId !== undefined ? androidTaskId : (get<{ task_id: string }>(
    `SELECT task_id FROM tbl_gen_task WHERE project_id = ? AND type='code_gen' AND status='succeeded'
      ORDER BY seq DESC LIMIT 1`, projectId)?.task_id ?? null);
  const artifactCount = taskId
    ? (get<{ n: number }>(`SELECT COUNT(*) n FROM tbl_artifact WHERE task_id = ?`, taskId)?.n ?? 0) : 0;
  return { specs, apis, capabilities, tracking, android_code: { task_id: taskId ?? null, artifact_count: artifactCount } };
}

/** 快照里实际带内容的产物项（`artifacts[]` 用它生成，**不虚报**） */
export function artifactsOf(snap: VersionSnapshot): string[] {
  const out: string[] = [];
  if (snap.specs.some((s) => s.content_md.trim())) out.push("spec");
  if (snap.apis.length) out.push("apis");
  if (snap.capabilities.some((c) => Number(c.enabled) === 1)) out.push("capabilities");
  if (snap.android_code.task_id) out.push("android_code");
  if (snap.tracking.length) out.push("tracking_plan");
  return out;
}

/**
 * 写一条版本记录（**不自行开事务**，供已在事务里的调用方复用）。
 * 契约：**旧版本置 `superseded`**，`current` 唯一。
 */
export function insertVersion(projectId: string, user: User, summary: string, androidTaskId?: string | null): { version_id: string; seq: number } {
  const snap = buildSnapshot(projectId, androidTaskId);
  const id = uid("v");
  const seq = (get<{ m: number }>(`SELECT MAX(seq) AS m FROM tbl_project_version WHERE project_id = ?`, projectId)?.m ?? 0) + 1;
  run(`UPDATE tbl_project_version SET status='superseded' WHERE project_id = ? AND status='current'`, projectId);
  run(`INSERT INTO tbl_project_version
         (version_id, project_id, seq, status, created_by, created_by_name, summary, artifacts_json, snapshot_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, projectId, seq, "current", user.user_id, user.nickname || "未命名用户",
    summary, json.stringify(artifactsOf(snap)), json.stringify(snap), nowIso());
  return { version_id: id, seq };
}

/** #55 打版本（整包快照），自带事务 */
export function createProjectVersion(projectId: string, user: User, summary: string, androidTaskId?: string | null): { version_id: string; seq: number } {
  return tx(() => insertVersion(projectId, user, summary, androidTaskId));
}

function loadVersion(user: User, versionId: string): VersionRow {
  const v = get<VersionRow>(`SELECT * FROM tbl_project_version WHERE version_id = ?`, versionId);
  if (!v) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
  assertProjectAccess(user, v.project_id);
  return v;
}

function publicVersion(v: VersionRow) {
  return {
    version_id: v.version_id, seq: v.seq, status: v.status,
    created_by: v.created_by, created_by_name: v.created_by_name,
    summary: v.summary, artifacts: json.parse<string[]>(v.artifacts_json, []),
    created_at: v.created_at,
  };
}

/** `#56` diff：Spec **文档级**、接口定义 **字段级**；`change` 用**文字**（新增 / 删除 / 修改） */
function diffSnapshots(prev: VersionSnapshot | null, cur: VersionSnapshot) {
  const out: { path: string; left: string; right: string; change: string }[] = [];
  const specBy = (s: VersionSnapshot | null) => new Map((s?.specs ?? []).map((x) => [x.role, x.content_md]));
  const a = specBy(prev), b = specBy(cur);
  for (const [role, md] of b) {
    if (!a.has(role)) out.push({ path: `specs/${role}.md`, left: "—", right: md.split("\n")[0] ?? "", change: "新增" });
    else if (a.get(role) !== md) out.push({ path: `specs/${role}.md`, left: "上一版内容", right: "本版内容", change: "修改" });
  }
  for (const role of a.keys()) if (!b.has(role)) out.push({ path: `specs/${role}.md`, left: "存在", right: "已删除", change: "删除" });

  const apiBy = (s: VersionSnapshot | null) =>
    new Map((s?.apis ?? []).map((x) => [`${x.method} ${x.path}`, x as { code: string; fields_json: string }]));
  const pa = apiBy(prev), pb = apiBy(cur);
  for (const [key, row] of pb) {
    const old = pa.get(key);
    if (!old) {
      out.push({ path: `apis/${key}`, left: "—", right: `字段 ${json.parse<unknown[]>(row.fields_json, []).length} 个`, change: "新增" });
    } else if (old.fields_json !== row.fields_json) {
      const before = json.parse<{ name: string }[]>(old.fields_json, []).map((f) => f.name).join(", ") || "—";
      const after = json.parse<{ name: string }[]>(row.fields_json, []).map((f) => f.name).join(", ") || "—";
      out.push({ path: `apis/${key}`, left: `字段：${before}`, right: `字段：${after}`, change: "修改" });
    }
  }
  for (const key of pa.keys()) if (!pb.has(key)) out.push({ path: `apis/${key}`, left: "存在", right: "已删除", change: "删除" });

  const capBy = (s: VersionSnapshot | null) =>
    new Map((s?.capabilities ?? []).map((x) => [String(x.cap_key), Number(x.enabled) === 1]));
  const ca = capBy(prev), cb = capBy(cur);
  for (const [key, on] of cb) {
    if (!ca.has(key)) out.push({ path: `capabilities/${key}`, left: "—", right: on ? "开启" : "关闭", change: "新增" });
    else if (ca.get(key) !== on) out.push({ path: `capabilities/${key}`, left: ca.get(key) ? "开启" : "关闭", right: on ? "开启" : "关闭", change: "修改" });
  }
  const trBy = (s: VersionSnapshot | null) => new Set((s?.tracking ?? []).map((x) => String(x.event_key)));
  const ta = trBy(prev), tb = trBy(cur);
  for (const k of tb) if (!ta.has(k)) out.push({ path: `tracking/${k}`, left: "—", right: "已定义", change: "新增" });
  for (const k of ta) if (!tb.has(k)) out.push({ path: `tracking/${k}`, left: "存在", right: "已删除", change: "删除" });

  if ((prev?.android_code.task_id ?? null) !== cur.android_code.task_id) {
    out.push({
      path: "android_code", left: prev?.android_code.task_id ?? "—",
      right: cur.android_code.task_id ?? "—", change: prev?.android_code.task_id ? "修改" : "新增",
    });
  }
  return out;
}

export function registerVersionRoutes(app: FastifyInstance) {
  const send = (req: { id: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }, data: unknown, status = 200) =>
    reply.status(status).send({ code: "OK", message: "", data, request_id: String(req.id) });

  /** #54 版本列表（`seq` 倒序；`current` 唯一） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/versions", async (req, reply) => {
    const user = currentUser(req);
    assertProjectAccess(user, req.params.project_id);
    const rows = all<VersionRow>(
      `SELECT * FROM tbl_project_version WHERE project_id = ? ORDER BY seq DESC`, req.params.project_id);
    return send(req, reply, { items: rows.map(publicVersion) });
  });

  /** #55 打版本（整包快照） */
  app.post<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/versions", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const snap = buildSnapshot(projectId);
    const body = (req.body ?? {}) as { summary?: string };
    const summary = (body.summary ?? "").trim()
      || `Spec ${snap.specs.filter((s) => s.content_md.trim()).length} 份 · 接口 ${snap.apis.length} 个 · 能力 ${snap.capabilities.filter((c) => Number(c.enabled) === 1).length} 项`;
    const created = createProjectVersion(projectId, user, summary);
    return send(req, reply, created, 201);
  });

  /** #56 diff（与上一版对比；接口字段级、Spec 文档级） */
  app.get<{ Params: { version_id: string } }>("/api/v1/versions/:version_id/diff", async (req, reply) => {
    const user = currentUser(req);
    const v = loadVersion(user, req.params.version_id);
    const prev = get<VersionRow>(
      `SELECT * FROM tbl_project_version WHERE project_id = ? AND seq < ? ORDER BY seq DESC LIMIT 1`,
      v.project_id, v.seq);
    const diff = diffSnapshots(prev ? normalizeSnapshot(json.parse<unknown>(prev.snapshot_json, null)) : null,
      normalizeSnapshot(json.parse<unknown>(v.snapshot_json, null)));
    return send(req, reply, { version_id: v.version_id, seq: v.seq, diff });
  });

  /** #57 `⬛` 整包回滚（要么全成要么全不成） */
  app.post<{ Params: { version_id: string } }>("/api/v1/versions/:version_id/rollback", async (req, reply) => {
    const user = currentUser(req);
    const v = loadVersion(user, req.params.version_id);
    const body = (req.body ?? {}) as { confirm?: boolean };
    // `⬛` 破坏性操作 —— **服务端亦须校验**，不能只靠前端确认弹窗
    if (body.confirm !== true) throw new ApiError("INVALID_ARGUMENT", "回滚需要显式确认。");
    const snap = normalizeSnapshot(json.parse<unknown>(v.snapshot_json, null));
    const ts = nowIso();
    tx(() => {
      // 接口定义：整表恢复（当前行删除后按快照重建）
      run(`DELETE FROM tbl_api_def WHERE project_id = ?`, v.project_id);
      for (const a of snap.apis) {
        run(`INSERT INTO tbl_api_def (api_id, project_id, code, name, method, path, status, fields_json, version, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          String(a.api_id), v.project_id, String(a.code), String(a.name), String(a.method), String(a.path),
          String(a.status ?? "draft"), String(a.fields_json ?? "[]"), Number(a.version ?? 1), ts, ts);
      }
      // 能力配置
      run(`DELETE FROM tbl_capability_config WHERE project_id = ?`, v.project_id);
      for (const c of snap.capabilities) {
        run(`INSERT INTO tbl_capability_config (project_id, cap_key, enabled, code_status, updated_at) VALUES (?,?,?,?,?)`,
          v.project_id, String(c.cap_key), Number(c.enabled) === 1 ? 1 : 0, String(c.code_status ?? "not_generated"), ts);
      }
      // 埋点方案
      run(`DELETE FROM tbl_track_plan WHERE project_id = ?`, v.project_id);
      for (const t of snap.tracking) {
        run(`INSERT INTO tbl_track_plan (event_key, project_id, trigger_desc, params_json, element_id) VALUES (?,?,?,?,?)`,
          String(t.event_key), v.project_id, String(t.trigger_desc ?? ""), String(t.params_json ?? "[]"), String(t.element_id ?? ""));
      }
      // Spec：正文恢复（**快照只读保留**，不删任何历史版本行）
      for (const s of snap.specs) {
        run(`UPDATE tbl_spec_doc SET content_md = ?, status = ?, stale = 0, change_point = NULL, error_code = NULL, updated_at = ?
              WHERE project_id = ? AND role = ?`, s.content_md, s.status || "succeeded", ts, v.project_id, s.role);
      }
      // 安卓代码：恢复「当前预览」指向该版本的成功产物（产物本身不可变，只重新指认）
      if (snap.android_code.task_id) {
        const page = get<{ page_id: string }>(`SELECT page_id FROM tbl_page WHERE project_id = ? ORDER BY order_index LIMIT 1`, v.project_id);
        if (page) run(`INSERT OR REPLACE INTO tbl_project_meta (project_id, meta_key, value) VALUES (?,?,?)`,
          v.project_id, `version_android:${page.page_id}`, json.stringify({ task_id: snap.android_code.task_id }));
      }
      run(`UPDATE tbl_project_version SET status='rolled_back' WHERE project_id = ? AND status='current' AND version_id <> ?`,
        v.project_id, v.version_id);
      run(`UPDATE tbl_project_version SET status='current' WHERE version_id = ?`, v.version_id);
    });
    return send(req, reply, { status: "rolled_back", version_id: v.version_id, seq: v.seq });
  });
}

export function emptySnap(): VersionSnapshot {
  return { specs: [], apis: [], capabilities: [], tracking: [], android_code: { task_id: null, artifact_count: 0 } };
}

/**
 * 读取历史快照并**容错归一化**：老版本记录可能缺字段（`android_code` 等）。
 * 契约要求「**快照只读保留，回滚后数据仍可读**」——旧形状不得导致 500。
 */
export function normalizeSnapshot(raw: unknown): VersionSnapshot {
  const base = emptySnap();
  const v = (raw ?? {}) as Partial<VersionSnapshot>;
  const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const ac = (v.android_code ?? {}) as { task_id?: unknown; artifact_count?: unknown };
  return {
    specs: arr<VersionSnapshot["specs"][number]>(v.specs).filter((x) => x && typeof x.role === "string"),
    apis: arr(v.apis), capabilities: arr(v.capabilities), tracking: arr(v.tracking),
    android_code: {
      task_id: typeof ac.task_id === "string" ? ac.task_id : null,
      artifact_count: typeof ac.artifact_count === "number" ? ac.artifact_count : 0,
    },
  };
}
