/**
 * `§1.11 能力配置` —— #58 `GET`/`PUT /projects/{project_id}/capabilities`。
 *
 * 契约要点（`接口契约 §1.11`、`接口-Spec §5.5.27`）：
 *  - **7 项能力固定、默认全关**；`capability` **只能是这 7 个枚举值**；
 *  - **保存即生成**；`PUT` **须带 `If-Match`**；保存前**自动备份旧代码**；
 *  - 出参含 `overall` / `failed[]` / `conflicts[] = [{library,version_a,version_b}]` / `alignment_table[]`；
 *    **整体不得返回成功**（部分失败时 `overall = "partial"`）；
 *  - **取消勾选 = 仅移除配置**（`enabled=false`），`code_status` 保留；**接口不得删除已生成代码**；
 *    取消已生成过的能力**需要二次确认**（`confirm_disable`），否则 400；
 *  - **不出参、不接收、日志不记录任何真实 key**（`REQ-CAP-004`）。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser } from "../core/auth.ts";
import { assertIfMatch } from "../core/idempotency.ts";
import { all, get, nowIso, run, tx } from "../db/index.ts";
import { readMeta, writeMeta } from "../core/revisions.ts";

/** **固定 7 项**（`接口-Spec §4.5 capability`）；`note` 只作占位说明，**不含任何真实密钥** */
export const CAPABILITIES: { key: string; name: string; description: string; note: string }[] = [
  { key: "push", name: "推送", description: "接入推送 SDK 与初始化代码。", note: "推送密钥请在本机工程内自行填写，平台不采集。" },
  { key: "apm", name: "性能采集", description: "接入性能采集 SDK 与埋点。", note: "采集密钥请在本机工程内自行填写，平台不采集。" },
  { key: "crash_report", name: "崩溃上报", description: "接入崩溃上报 SDK 与初始化代码。", note: "上报密钥请在本机工程内自行填写，平台不采集。" },
  { key: "log_report", name: "日志上报", description: "接入日志上报 SDK 与初始化代码。", note: "上报密钥请在本机工程内自行填写，平台不采集。" },
  { key: "stats_sdk", name: "统计 SDK", description: "接入统计 SDK 与初始化代码。", note: "统计 AppKey 请在本机工程内自行填写，平台不采集。" },
  { key: "hardening", name: "加固", description: "接入加固配置与占位说明。", note: "加固凭据请在本机工程内自行填写，平台不采集。" },
  { key: "privacy_dialog", name: "隐私合规弹窗", description: "生成启动时的隐私政策同意弹窗骨架。", note: "隐私政策文本请按你的合规要求自行填写。" },
];
const KEYS = CAPABILITIES.map((c) => c.key);

function devGenerationEnabled(): boolean {
  return process.env.AD_CODEGEN_MODE === "development" || process.env.AD_LLM_MODE === "development";
}

/** 依赖版本冲突（**开发适配器的确定性示例**；无冲突 → `[]`，**不返回 null**） */
function conflictsOf(enabled: Set<string>): { conflicts: { library: string; version_a: string; version_b: string }[]; alignment_table: { library: string; resolved: string }[] } {
  const conflicts: { library: string; version_a: string; version_b: string }[] = [];
  if (enabled.has("apm") && enabled.has("stats_sdk"))
    conflicts.push({ library: "okhttp", version_a: "4.9.3", version_b: "4.11.0" });
  if (enabled.has("push") && enabled.has("crash_report"))
    conflicts.push({ library: "kotlin-stdlib", version_a: "1.9.10", version_b: "1.9.22" });
  // 对齐表：统一取**较高版本**（`§F11` 补充块口径）；按数值段比较，避免字符串排序把 4.9.3 判成更高
  const higher = (a: string, b: string): string => {
    const pa = a.split(/[.\-+]/).map((x) => Number.parseInt(x, 10) || 0);
    const pb = b.split(/[.\-+]/).map((x) => Number.parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d > 0 ? a : b;
    }
    return a;
  };
  const alignment_table = conflicts.map((c) => ({ library: c.library, resolved: higher(c.version_a, c.version_b) }));
  return { conflicts, alignment_table };
}

export function registerCapabilityRoutes(app: FastifyInstance) {
  const send = (req: { id: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }, data: unknown, status = 200) =>
    reply.status(status).send({ code: "OK", message: "", data, request_id: String(req.id) });

  function ensureRows(projectId: string) {
    const rows = all<{ cap_key: string; enabled: number; code_status: string }>(
      `SELECT cap_key, enabled, code_status FROM tbl_capability_config WHERE project_id = ?`, projectId);
    if (rows.length === KEYS.length) return rows;
    // 新项目：**固定 7 行、默认全关**
    const ts = nowIso();
    for (const k of KEYS) {
      run(`INSERT OR IGNORE INTO tbl_capability_config (project_id, cap_key, enabled, code_status, updated_at)
           VALUES (?,?,0,'not_generated',?)`, projectId, k, ts);
    }
    return all<{ cap_key: string; enabled: number; code_status: string }>(
      `SELECT cap_key, enabled, code_status FROM tbl_capability_config WHERE project_id = ? ORDER BY cap_key`, projectId);
  }

  const versionOf = (projectId: string) => Number(readMeta<{ v: number }>(projectId, "capabilities:version")?.v ?? 1);

  function payload(projectId: string) {
    const rows = ensureRows(projectId);
    const byKey = new Map(rows.map((r) => [r.cap_key, r]));
    const items = CAPABILITIES.map((c) => {
      const r = byKey.get(c.key);
      return {
        capability: c.key, name: c.name, description: c.description,
        enabled: Number(r?.enabled ?? 0) === 1,
        code_status: (r?.code_status ?? "not_generated") as string,
        note: c.note,   // **仅占位说明；不含任何真实密钥**
      };
    });
    const enabledSet = new Set(items.filter((i) => i.enabled).map((i) => i.capability));
    const failed = items.filter((i) => i.enabled && i.code_status === "failed")
      .map((i) => ({ capability: i.capability, error_code: "UPSTREAM_UNAVAILABLE" }));
    const partial = items.filter((i) => i.enabled && i.code_status === "partial");
    const generated = items.filter((i) => i.enabled && i.code_status === "generated");
    const overall = enabledSet.size === 0 ? "none"
      : failed.length ? (generated.length ? "partial" : "failed")
      : partial.length ? "partial"
      : "succeeded";
    return {
      items, overall, failed,
      conflicts: conflictsOf(enabledSet).conflicts,
      alignment_table: conflictsOf(enabledSet).alignment_table,
      version: versionOf(projectId),
    };
  }

  /** #58 GET（固定 7 行，默认全关） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/capabilities", async (req, reply) => {
    const user = currentUser(req);
    assertProjectAccess(user, req.params.project_id);
    return send(req, reply, payload(req.params.project_id));
  });

  /** #58 PUT（**保存即生成**；须 `If-Match`；保存前**自动备份旧代码**） */
  app.put<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/capabilities", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    assertIfMatch(req, versionOf(projectId));

    const body = (req.body ?? {}) as { items?: unknown; confirm_disable?: boolean };
    if (!Array.isArray(body.items)) throw new ApiError("INVALID_ARGUMENT", "items 必须是数组。");
    const wanted = new Map<string, boolean>();
    for (const raw of body.items) {
      const it = (raw ?? {}) as { capability?: unknown; enabled?: unknown };
      const key = String(it.capability ?? "");
      if (!KEYS.includes(key))
        throw new ApiError("INVALID_ARGUMENT", `能力只能是这 7 项：${KEYS.join(" / ")}。`, { field: "items[].capability", received: key });
      wanted.set(key, Boolean(it.enabled));
    }

    const before = ensureRows(projectId);
    const beforeBy = new Map(before.map((r) => [r.cap_key, r]));
    // **取消勾选 = 仅移除配置**；已生成过代码的要二次确认
    const toDisable = [...wanted.entries()]
      .filter(([k, on]) => !on && Number(beforeBy.get(k)?.enabled ?? 0) === 1 && beforeBy.get(k)?.code_status !== "not_generated")
      .map(([k]) => k);
    if (toDisable.length && body.confirm_disable !== true)
      throw new ApiError("INVALID_ARGUMENT", `取消勾选 ${toDisable.length} 项已生成的能力需要二次确认。`, { capabilities: toDisable });

    const idempotencyKey = String(req.headers["idempotency-key"] ?? "");
    const backupKey = `capabilities:backup:${idempotencyKey || nowIso()}`;
    // 保存前**自动备份旧代码**（旧配置即旧代码的依据；接口不删除已生成代码）
    writeMeta(projectId, backupKey, { at: nowIso(), items: before.map((r) => ({ capability: r.cap_key, enabled: Number(r.enabled) === 1, code_status: r.code_status })) });

    const gen = devGenerationEnabled();
    const ts = nowIso();
    tx(() => {
      for (const k of KEYS) {
        const on = wanted.get(k) ?? Number(beforeBy.get(k)?.enabled ?? 0) === 1;
        const prevStatus = String(beforeBy.get(k)?.code_status ?? "not_generated");
        let status = prevStatus;
        if (on) status = gen ? "generated" : "failed";
        else if (prevStatus === "not_generated") status = "not_generated";
        // 关闭：**保留 code_status**（仅移除配置），界面加注释标记
        run(`UPDATE tbl_capability_config SET enabled = ?, code_status = ?, updated_at = ? WHERE project_id = ? AND cap_key = ?`,
          on ? 1 : 0, status, ts, projectId, k);
      }
      run(`UPDATE tbl_spec_doc SET change_point = ? WHERE project_id = ? AND stale = 0`, "能力配置已变更，需复核", projectId);
    });
    writeMeta(projectId, "capabilities:version", { v: versionOf(projectId) + 1 });
    return send(req, reply, payload(projectId));
  });
}
