/**
 * `§1.6 拆解` 与追溯 —— #28 ⚡重新拆解 / #29 角色需求包 / #59 埋点方案 / #67 追溯矩阵。
 *
 * 要点：
 *  - `#28`：**同一项目同一时刻只允许一个**，重复触发 → 409；旧 Spec **归档不删**；可带可选 `depth`；
 *  - `#29`：五角色需求包 + REQ-ID 列表；
 *  - `#59`：埋点方案 `EVT_<模块>_<动作>`（**被开发项目**的，不是平台自身的）；
 *  - `#67`：**四态（已覆盖 / 有缺口 / 不适用 / 延后）必须由服务端给出**，前端不得估算；含孤儿检测。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser } from "../core/auth.ts";
import { assertSplitGate, readMeta } from "../core/revisions.ts";
import { paginate, parsePage, withMeta } from "../core/pagination.ts";
import { all, get, json, nowIso, run } from "../db/index.ts";
import { createTask, hasRunning, startTask } from "../core/tasks.ts";
import { createLlmAdapter, type LlmAdapter, type ReviewLevel } from "../adapters/llm.ts";
import { depthOfLevel } from "./review.ts";
import { assertEgressEnabled } from "./ai-egress.ts";
import { modelFor } from "../core/llm-models.ts";
import { traceLlm } from "../core/ai-trace.ts";

export function registerSplitRoutes(app: FastifyInstance, adapter?: LlmAdapter) {
  const llm = adapter ?? createLlmAdapter();

  /** #28 ⚡ 重新拆解 */
  app.post<{ Params: { project_id: string }; Body: { depth?: string } }>(
    "/api/v1/projects/:project_id/splits", async (req, reply) => {
      const user = currentUser(req);
      const projectId = req.params.project_id;
      assertProjectAccess(user, projectId);
      assertEgressEnabled(user.user_id);

      if (hasRunning(projectId, "split")) {
        throw new ApiError("VERSION_CONFLICT", "已经有一次拆解在进行中，请等它结束。");
      }
      const proj = get<{ depth: string; review_level: string; stage: string }>(
        `SELECT depth, review_level, stage FROM tbl_project WHERE project_id = ?`, projectId);
      if (!proj) throw new ApiError("NOT_FOUND");
      // 拆解深度**默认由审核等级映射**（R-18，2026-10-28 定稿）；显式 `depth` 仍可覆盖（兼容旧调用）
      const requested = req.body?.depth === undefined ? undefined : String(req.body.depth);
      if (requested !== undefined && !["minimal", "standard", "comprehensive"].includes(requested)) {
        throw new ApiError("INVALID_ARGUMENT", "深度无效。");
      }
      const depth = requested ?? depthOfLevel((proj.review_level ?? "standard") as ReviewLevel);
      const gate=assertSplitGate(projectId);
      const ts = nowIso();
      run(`UPDATE tbl_project SET stage = 'splitting', depth = ?, updated_at = ? WHERE project_id = ?`, depth, ts, projectId);

      const task = createTask({ projectId, type: "split" });
      startTask(task.task_id, async ({ progress, commit }) => {
        progress(25);
        const draft = await traceLlm(projectId, task.task_id, "调用大模型拆解需求", modelFor(user.user_id),
          () => llm.split({ markdown: gate.markdown, depth, model: modelFor(user.user_id) }),
          (d) => `角色包 ${Array.isArray(d?.packs) ? d.packs.length : 0} 个`);
        const roles=["UI","接口","App","埋点","测试"];
        if(!draft || !Array.isArray(draft.packs) || draft.packs.length!==5 || new Set(draft.packs.map(p=>p.role)).size!==5 || draft.packs.some(p=>!roles.includes(p.role)||!Array.isArray(p.reqs)||p.reqs.some(r=>typeof r!=="string"||!/^REQ-[A-Z0-9]+-\d{3}$/.test(r)))) throw new ApiError("UPSTREAM_UNAVAILABLE", "拆解返回结构无效，未应用结果。");
        progress(70);

        return commit(() => {
          const current=assertSplitGate(projectId);
          if(current.reviewId!==gate.reviewId) throw new ApiError("TASK_STALE", "审核版本已更新，未应用旧拆解结果。");
          run(`UPDATE tbl_spec_doc SET status='stale' WHERE project_id=?`,projectId);
          // 旧需求包**归档不删**：轮次递增并留档，历史不丢
          const round = Number(get<{ value: string }>(
            `SELECT value FROM tbl_project_meta WHERE project_id = ? AND meta_key = 'split_round'`, projectId)?.value ?? 0) + 1;
          const prev = get<{ value: string }>(
            `SELECT value FROM tbl_project_meta WHERE project_id = ? AND meta_key = 'requirements'`, projectId);
          if (prev) {
            run(`INSERT OR REPLACE INTO tbl_project_meta (project_id, meta_key, value) VALUES (?,?,?)`,
              projectId, `requirements_archived_r${round - 1}`, prev.value);
          }
          run(`INSERT OR REPLACE INTO tbl_project_meta (project_id, meta_key, value) VALUES (?,?,?)`,
            projectId, "split_round", String(round));
          run(`INSERT OR REPLACE INTO tbl_project_meta (project_id, meta_key, value) VALUES (?,?,?)`,
            projectId, "requirements", JSON.stringify({ depth, packs: draft.packs, round }));

          // 埋点方案（#59）：按需求包推导 `EVT_<模块>_<动作>`，**只展示不配置**
          run(`DELETE FROM tbl_track_plan WHERE project_id = ?`, projectId);
          for (const pack of draft.packs) {
            const mod = MODULE_OF[pack.role] ?? "APP";
            for (const [idx, suffix] of ["start", "done"].entries()) {
              run(`INSERT INTO tbl_track_plan (event_key, project_id, trigger_desc, params_json, element_id)
                   VALUES (?,?,?,?,?)`,
                `EVT_${mod.toLowerCase()}_${suffix}`, projectId,
                `${pack.role} 阶段${idx === 0 ? "开始" : "完成"}`,
                json.stringify(idx === 0 ? ["project_id", "round"] : ["project_id", "duration_ms"]),
                "");
            }
          }
          run(`UPDATE tbl_project SET stage='gate_passed',updated_at=? WHERE project_id=?`,nowIso(),projectId);
          return null;
        });
      }, {onFailure:()=>{run(`UPDATE tbl_project SET stage='gate_passed' WHERE project_id=? AND stage='splitting'`,projectId);}});

      void reply.status(202).send({
        code: "OK", message: "", request_id: String(req.id),
        data: { task_id: task.task_id, depth },
      });
    });

  /**
   * #29 角色需求包 + REQ-ID 列表（`q` / 分页）。
   *
   * 出参用**全站统一的分页包**（`§0.3`）：`items` = 角色需求包；`total` = 角色包数量；`requirement_count` = 当前筛选的 REQ 数量。
   */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/requirements", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const raw = get<{ value: string }>(
      `SELECT value FROM tbl_project_meta WHERE project_id = ? AND meta_key = 'requirements'`, projectId);
    if (!raw) throw new ApiError("NOT_FOUND", "还没有需求包，先做一次拆解。");
    const data = json.parse<{ depth: string; packs: { role: string; reqs: string[] }[] }>(
      raw.value, { depth: "standard", packs: [] });
    const p = parsePage(req);
    const rows = data.packs.map((pack) => ({
      role: pack.role,
      reqs: p.q ? pack.reqs.filter((r) => r.includes(p.q)) : pack.reqs,
    }));
    const total = rows.reduce((n, x) => n + x.reqs.length, 0);
    const paged = withMeta(rows, p, "role");
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: { ...paged, requirement_count: total, depth: data.depth },
    });
  });

  /** #59 埋点方案（**被开发项目**的；`EVT_<模块>_<动作>`） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/tracking-plan", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const rows = all<{ event_key: string; trigger_desc: string; params_json: string; element_id: string }>(
      `SELECT * FROM tbl_track_plan WHERE project_id = ? ORDER BY event_key`, projectId);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: { items: rows.map((r) => ({
        event_key: r.event_key, trigger_desc: r.trigger_desc,
        params: json.parse<string[]>(r.params_json, []), element_id: r.element_id,
      })) },
    });
  });

  /**
   * #67 需求追溯矩阵（`接口-Spec §5.5.29`，**四态由服务端给出**）。
   *
   * 契约口径：
   *  - 五列 `ui` / `api` / `app` / `track` / `test` **每列必有值**；未产出 → `"—待填"` 并计入 `GAP`；
   *  - `coverage_status ∈ {OK, GAP, N/A, Deferred}`（`N/A` 必须写理由，如 `"N/A：本轮未分配该角色"`）；
   *  - **不凭「项目有页面/接口」臆测覆盖**：只采用明确的 REQ → 五角色落点；
   *  - `orphan`：**有 target 但无 REQ** 或 **有 REQ 但无 target**；
   *  - 页码式分页 + `q`（匹配 `req_id`）+ `coverage_status` 筛选。
   */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/traceability-matrix", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);

    const raw = get<{ value: string }>(
      `SELECT value FROM tbl_project_meta WHERE project_id = ? AND meta_key = 'requirements'`, projectId);
    if (!raw) throw new ApiError("NOT_FOUND", "还没有需求包，先做一次拆解。");
    const data = json.parse<{ packs: { role: string; reqs: string[] }[] }>(raw.value, { packs: [] });

    // 只采用**明确登记**的 REQ → 五角色落点（`trace_targets`）；未登记即「—待填」
    const explicit = readMeta<Record<string, { targets?: Record<string, string>; status?: string; summary?: string }>>(
      projectId, "trace_targets") ?? {};
    const FILL = "—待填";
    const COLS = ["ui", "api", "app", "track", "test"] as const;

    const reqIds = new Set(data.packs.flatMap((p) => p.reqs));
    const items = data.packs.flatMap((pack) => pack.reqs.map((reqId) => {
      const known = explicit[reqId];
      const targets: Record<string, string> = {};
      for (const k of COLS) targets[k] = known?.targets?.[k]?.trim() || FILL;
      const filled = COLS.filter((k) => targets[k] !== FILL);
      const orphan = filled.length === 0;                       // 有 REQ 但无 target
      const status = (known?.status ?? "").toLowerCase();
      const coverage_status = status === "na" ? "N/A"
        : status === "deferred" ? "Deferred"
        : filled.length === COLS.length ? "OK" : "GAP";
      return {
        req_id: reqId, summary: known?.summary ?? `${pack.role} 需求条目`,
        targets, coverage_status, orphan,
      };
    }));

    // **有 target 但无 REQ** → 也计入孤儿，且必须出现在列表里（总数才对得上）
    for (const [reqId, known] of Object.entries(explicit)) {
      if (reqIds.has(reqId)) continue;
      const targets: Record<string, string> = {};
      for (const k of COLS) targets[k] = known.targets?.[k]?.trim() || FILL;
      items.push({ req_id: reqId, summary: known.summary ?? "产物引用了未登记的需求编号",
        targets, coverage_status: "GAP", orphan: true });
    }

    const wantStatus = String((req.query as Record<string, unknown> | undefined)?.coverage_status ?? "").trim();
    const q = String((req.query as Record<string, unknown> | undefined)?.q ?? "").trim();
    let rows = items;
    if (wantStatus) {
      const norm = (v: string) => (v.toLowerCase() === "n/a" ? "N/A" : v.charAt(0).toUpperCase() + v.slice(1).toLowerCase());
      rows = rows.filter((r) => norm(r.coverage_status) === norm(wantStatus));
    }
    if (q) rows = rows.filter((r) => r.req_id.toLowerCase().includes(q.toLowerCase()));
    rows = [...rows].sort((a, b) => (a.req_id < b.req_id ? -1 : a.req_id > b.req_id ? 1 : 0));

    const p = parsePage(req);
    const paged = paginate(rows, { ...p, sort: "req_id:asc" });
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: { ...paged, orphan_count: rows.filter((r) => r.orphan).length,
        total_orphan_count: items.filter((r) => r.orphan).length },
    });
  });
}


/** 角色 → 模块码（`EL-<模块>-###` 与 `EVT_<模块>_<动作>` 共用） */
const MODULE_OF: Record<string, string> = {
  UI: "UI", 接口: "API", App: "APP", 埋点: "TRACK", 测试: "TEST",
};

/** 小工具：给埋点条数加一点确定性扰动（避免所有项目完全一样） */
function pi_(i: number): number { return i % 2; }
void pi_;
