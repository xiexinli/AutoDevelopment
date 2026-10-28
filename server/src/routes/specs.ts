/**
 * `§1.6 拆解与 Spec` —— #30 ⚡生成 5 份 Spec / #31 五份列表 / #32 单份内容 / #33 导出 .md / #34 角色校对。
 *
 * 契约要点：
 *  - **顺序即生成顺序：UI → 接口 → App → 埋点 → 测试（串行）**（`AC-SC-01`）；
 *  - **单份失败不阻断其余**，`overall` **绝不置为 `succeeded`**（部分成功时）；
 *  - Spec 生成是**外发大模型**类任务 → 受 `#68` 外发开关约束（关闭则拒绝，**不静默降级**）；
 *  - `#32` 返回该份 Markdown 正文；`#33` 导出**需鉴权、不含密钥**；
 *  - `#34` 出参 `data.items[] = {content, can_loopback}`，**补不上的条目必须带「回流对话」标记**；
 *  - **每次生成 Spec 打一个项目级版本号**（`§F12` 方案 A）。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser } from "../core/auth.ts";
import { all, get, json, nowIso, run, tx, uid } from "../db/index.ts";
import { createTask, startTask } from "../core/tasks.ts";
import { createLlmAdapter, type LlmAdapter } from "../adapters/llm.ts";
import { assertEgressEnabled } from "./ai-egress.ts";
import { createProjectVersion } from "./versions.ts";
import { modelFor } from "../core/llm-models.ts";
import { traceLlm } from "../core/ai-trace.ts";

/** `spec_role` 是**固定 5 个**的拉丁枚举（`接口-Spec §4.5`）；中文名只用于展示 */
export const SPEC_ROLES: { role: string; label: string; order: number; pack: string }[] = [
  { role: "ui", label: "UI", order: 1, pack: "UI" },
  { role: "api", label: "接口", order: 2, pack: "接口" },
  { role: "app", label: "App", order: 3, pack: "App" },
  { role: "track", label: "埋点", order: 4, pack: "埋点" },
  { role: "test", label: "测试", order: 5, pack: "测试" },
];

const REQUIRED_SECTIONS: Record<string, string[]> = {
  ui: ["元素清单", "交互规则", "文案字样", "样式"],
  api: ["接口清单", "入参 / 出参", "错误码", "分页与排序"],
  app: ["页面与路由", "状态管理", "网络与降级", "本地存储"],
  track: ["事件清单", "触发时机", "参数", "漏斗"],
  test: ["接口层", "App 层", "埋点层", "E2E"],
};

function requirementsOf(projectId: string): { depth: string; packs: { role: string; reqs: string[] }[] } {
  const raw = get<{ value: string }>(
    `SELECT value FROM tbl_project_meta WHERE project_id = ? AND meta_key = 'requirements'`, projectId);
  if (!raw) throw new ApiError("INVALID_ARGUMENT", "还没有需求包，先完成一次需求拆解。");
  return json.parse(raw.value, { depth: "standard", packs: [] });
}

function reqsFor(projectId: string, packRole: string): string[] {
  const data = requirementsOf(projectId);
  return data.packs.find((p) => p.role === packRole)?.reqs ?? [];
}

function projectName(projectId: string): string {
  return get<{ name: string }>(`SELECT name FROM tbl_project WHERE project_id = ?`, projectId)?.name ?? "未命名项目";
}

export function registerSpecRoutes(app: FastifyInstance, adapter?: LlmAdapter) {
  const llm = adapter ?? createLlmAdapter();
  const send = (req: { id: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }, data: unknown, status = 200) =>
    reply.status(status).send({ code: "OK", message: "", data, request_id: String(req.id) });

  /** 列表出参（`#31`）：`overall` / `succeeded` / `failed` 由落库状态推导 */
  function listPayload(projectId: string) {
    const rows = all<{ spec_id: string; role: string; role_order: number; status: string; stale: number;
      change_point: string | null; error_code: string | null; version: number; updated_at: string }>(
      `SELECT spec_id, role, role_order, status, stale, change_point, error_code, version, updated_at
         FROM tbl_spec_doc WHERE project_id = ? ORDER BY role_order`, projectId);
    const succeeded = rows.filter((r) => r.status === "succeeded" || r.status === "stale").map((r) => r.role);
    const failed = rows.filter((r) => r.status === "failed").map((r) => ({ role: r.role, error_code: r.error_code ?? "INTERNAL" }));
    const overall = !rows.length ? "none"
      : rows.some((r) => r.status === "generating") ? "generating"
      : failed.length ? (succeeded.length ? "partial" : "failed")
      : "succeeded";
    return {
      overall, succeeded, failed,
      items: rows.map((r) => ({
        spec_id: r.spec_id, role: r.role, role_order: r.role_order, status: r.status,
        stale: r.stale === 1, change_point: r.change_point, error_code: r.error_code,
        version: r.version, updated_at: r.updated_at,
      })),
    };
  }

  /** #30 ⚡ 生成 5 份 Spec（串行；**单份失败不阻断其余**） */
  app.post<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/specs:generate", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    assertEgressEnabled(user.user_id);
    // 前置校验放在**处理器内**：没有需求包时立刻 400，而不是造一个必然失败的任务
    requirementsOf(projectId);
    if (get<{ n: number }>(`SELECT COUNT(*) n FROM tbl_gen_task WHERE project_id = ? AND type='spec_gen' AND status IN ('queued','running')`, projectId)!.n) {
      throw new ApiError("VERSION_CONFLICT", "已经有一次 Spec 生成在进行中，请等它结束。");
    }
    const depth = get<{ depth: string }>(`SELECT depth FROM tbl_project WHERE project_id = ?`, projectId)?.depth ?? "standard";
    const name = projectName(projectId);

    // 占位行（`generating`）：让 `#31` 立刻能看到五份都在排队
    tx(() => {
      for (const r of SPEC_ROLES) {
        const exists = get<{ spec_id: string }>(`SELECT spec_id FROM tbl_spec_doc WHERE project_id = ? AND role = ?`, projectId, r.role);
        if (exists) run(`UPDATE tbl_spec_doc SET status='generating', error_code=NULL, updated_at=? WHERE spec_id=?`, nowIso(), exists.spec_id);
        else run(`INSERT INTO tbl_spec_doc (spec_id, project_id, role, role_order, status, stale, content_md, version, updated_at)
                  VALUES (?,?,?,?,?,0,'',1,?)`, uid("sp"), projectId, r.role, r.order, "generating", nowIso());
      }
      run(`UPDATE tbl_project SET stage='spec_generating', updated_at=? WHERE project_id=?`, nowIso(), projectId);
    });

    const task = createTask({ projectId, type: "spec_gen" });
    startTask(task.task_id, async ({ progress, check }) => {
      let done = 0;
      for (const r of SPEC_ROLES) {
        check();
        const reqs = reqsFor(projectId, r.pack);
        const context = requirementsOf(projectId).packs.map((p) => `- ${p.role}：${p.reqs.join("、")}`).join("\n");
        try {
          const draft = await traceLlm(projectId, task.task_id, `调用大模型生成 ${r.role} Spec`, modelFor(user.user_id),
            () => llm.spec({ role: r.pack, requirements: reqs, projectName: name, context, depth, model: modelFor(user.user_id) }),
            (d) => `输出 ${typeof d?.content_md === "string" ? d.content_md.length : 0} 字`);
          if (!draft || typeof draft.content_md !== "string" || !draft.content_md.trim())
            throw new ApiError("UPSTREAM_UNAVAILABLE", "大模型没有返回可用的 Spec 内容。");
          run(`UPDATE tbl_spec_doc SET content_md=?, status='succeeded', stale=0, change_point=NULL, error_code=NULL,
                 version=version+1, updated_at=? WHERE project_id=? AND role=?`,
            draft.content_md, nowIso(), projectId, r.role);
        } catch (e) {
          // **单份失败不阻断其余**：只把这一份标 failed 并记错误码
          const code = e instanceof ApiError ? e.code : "INTERNAL";
          run(`UPDATE tbl_spec_doc SET status='failed', error_code=?, updated_at=? WHERE project_id=? AND role=?`,
            code, nowIso(), projectId, r.role);
        }
        done += 1;
        progress(Math.round((done / SPEC_ROLES.length) * 90));
      }
      // 生成完毕 → 打一个**项目级版本**（`§F12` 方案 A：每次生成 Spec 打版本）
      const payload = listPayload(projectId);
      run(`UPDATE tbl_project SET stage='spec_ready', updated_at=? WHERE project_id=?`, nowIso(), projectId);
      createProjectVersion(projectId, user,
        `生成 5 份 Spec（成功 ${payload.succeeded.length} / 失败 ${payload.failed.length}）`);
      return null;
    });
    return send(req, reply, { task_id: task.task_id, overall: "generating" }, 202);
  });

  /** #31 五份列表 */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/specs", async (req, reply) => {
    const user = currentUser(req);
    assertProjectAccess(user, req.params.project_id);
    return send(req, reply, listPayload(req.params.project_id));
  });

  /** #32 单份 Markdown 内容 */
  app.get<{ Params: { spec_id: string } }>("/api/v1/specs/:spec_id", async (req, reply) => {
    const user = currentUser(req);
    const row = get<{ spec_id: string; project_id: string; role: string; status: string; content_md: string; version: number;
      stale: number; change_point: string | null; error_code: string | null; updated_at: string }>(
      `SELECT * FROM tbl_spec_doc WHERE spec_id = ?`, req.params.spec_id);
    if (!row) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
    assertProjectAccess(user, row.project_id);
    return send(req, reply, {
      spec_id: row.spec_id, role: row.role, status: row.status, content_md: row.content_md,
      version: row.version, stale: row.stale === 1, change_point: row.change_point,
      error_code: row.error_code, updated_at: row.updated_at,
      role_label: SPEC_ROLES.find((r) => r.role === row.role)?.label ?? row.role,
    });
  });

  /** #33 导出 `.md`（**需鉴权；不写入访问日志正文**） */
  app.get<{ Params: { spec_id: string } }>("/api/v1/specs/:spec_id/export", async (req, reply) => {
    const user = currentUser(req);
    const row = get<{ spec_id: string; project_id: string; role: string; status: string; content_md: string }>(
      `SELECT * FROM tbl_spec_doc WHERE spec_id = ?`, req.params.spec_id);
    if (!row) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
    assertProjectAccess(user, row.project_id);
    if (!row.content_md.trim()) throw new ApiError("INVALID_ARGUMENT", "这份 Spec 还没有内容，先重新生成。");
    const label = SPEC_ROLES.find((r) => r.role === row.role)?.label ?? row.role;
    return send(req, reply, {
      export_id: uid("exp"), format: "md", filename: `${label}-Spec.md`, content_md: row.content_md,
    });
  });

  /** #34 角色校对 → 补充要求清单（补不上的必须带 `can_loopback`） */
  app.post<{ Params: { project_id: string; spec_id: string } }>(
    "/api/v1/projects/:project_id/specs/:spec_id/proofread", async (req, reply) => {
      const user = currentUser(req);
      const projectId = req.params.project_id;
      assertProjectAccess(user, projectId);
      const specRef = req.params.spec_id;
      const row = get<{ spec_id: string; project_id: string; role: string; content_md: string; status: string }>(
        `SELECT * FROM tbl_spec_doc WHERE spec_id = ? OR (project_id = ? AND role = ?) LIMIT 1`,
        specRef, projectId, specRef);
      if (!row) throw new ApiError("NOT_FOUND", "这份 Spec 还不存在。");
      assertProjectAccess(user, row.project_id);

      const need = REQUIRED_SECTIONS[row.role] ?? [];
      const items: { item_code: string; content: string; can_loopback: boolean }[] = [];
      const miss = need.filter((s) => !row.content_md.includes(s));
      miss.forEach((s, i) => items.push({
        item_code: `${row.role.toUpperCase()}-P${i + 1}`,
        content: `${SPEC_ROLES.find((r) => r.role === row.role)?.label ?? row.role} Spec 缺少「${s}」章节。`,
        can_loopback: true,     // 缺章节 → 只能靠对话补充
      }));
      if (row.status !== "succeeded") items.push({
        item_code: `${row.role.toUpperCase()}-P0`, content: "这份 Spec 还没成功生成，先重新生成再校对。", can_loopback: false,
      });
      tx(() => {
        run(`DELETE FROM tbl_proofread_item WHERE spec_id = ?`, row.spec_id);
        for (const it of items) {
          run(`INSERT INTO tbl_proofread_item (item_code, spec_id, text, created_at) VALUES (?,?,?,?)`,
            it.item_code, row.spec_id, it.content, nowIso());
        }
      });
      return send(req, reply, { spec_id: row.spec_id, role: row.role, items });
    });
}
