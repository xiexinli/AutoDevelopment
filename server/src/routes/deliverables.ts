/**
 * `§1.11 交付` 与平台自身埋点、流程中止 ——
 *   #60 交付归档（Spec 包 + 安卓工程）/ #61 打包导出（**需鉴权**）/
 *   #62 平台自身埋点上报（批量，**失败不阻塞业务**）/ #70 `⬛` 中止并归档本流程。
 *
 * 要点：
 *  - `#61` 打的是**真实 ZIP**（`node:zlib` + 手写 ZIP 写入器，**零外部依赖**）：5 份 Spec
 *    + 已生成安卓源码（含 Gradle wrapper）+ 埋点方案 + 接口定义 + README；
 *    **不包含任何密钥、不包含平台构建产物（apk）**；
 *  - `#62` 请求体 `{schema_version, batch:[…]}`，失败项进 `rejected[]`；**不落业务数据、不含 PRD 正文与生成代码**；
 *  - `#70` `⬛` **服务端亦须校验**：中止 → 取消进行中任务、版本归档；**归档不删**（数据仍可读）。
 */
import type { FastifyInstance } from "fastify";
import { deflateRawSync } from "node:zlib";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser } from "../core/auth.ts";
import { all, get, json, nowIso, run, tx, uid } from "../db/index.ts";
import { cancelTask, getTask } from "../core/tasks.ts";
import { SPEC_ROLES } from "./specs.ts";

// ---------------- 最小 ZIP 写入器（stored / deflate，无外部依赖） ----------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntryInput { path: string; data: Buffer }

/** 手写 ZIP（local header + central directory + EOCD）；**绝不越出包内相对路径** */
function buildZip(entries: ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.path.replace(/\\/g, "/").replace(/^\/+/, ""), "utf8");
    if (name.includes(0) || name.toString("utf8").split("/").includes(".."))
      throw new ApiError("INVALID_ARGUMENT", "产物路径不合法。");
    const raw = e.data;
    const deflated = deflateRawSync(raw);
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 名字标志
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------------- 交付内容 ----------------

function specFiles(projectId: string): ZipEntryInput[] {
  return all<{ role: string; content_md: string }>(
    `SELECT role, content_md FROM tbl_spec_doc WHERE project_id = ? ORDER BY role_order`, projectId)
    .filter((s) => s.content_md.trim())
    .map((s) => ({
      path: `specs/${SPEC_ROLES.find((r) => r.role === s.role)?.label ?? s.role}-Spec.md`,
      data: Buffer.from(s.content_md, "utf8"),
    }));
}

function latestAndroidTask(projectId: string): string | null {
  return get<{ task_id: string }>(
    `SELECT task_id FROM tbl_gen_task WHERE project_id = ? AND type='code_gen' AND status='succeeded'
      ORDER BY seq DESC LIMIT 1`, projectId)?.task_id ?? null;
}

function androidFiles(taskId: string | null): ZipEntryInput[] {
  if (!taskId) return [];
  // ⚠️ `path` 是 `tbl_artifact` 的**独立列**，不在 `content` 的 JSON 外壳里
  // （写入处只存 `{content, encoding}`）。所以必须 `SELECT path` 并从行上取，
  // 否则 `.filter(f => f.path)` 会把每一条都滤掉 —— 交付包里**一份安卓源码都不会有**。
  return all<{ path: string; content: string }>(
    `SELECT path, content FROM tbl_artifact WHERE task_id = ? ORDER BY path`, taskId)
    .map((r) => ({
      path: r.path,
      ...json.parse<{ content: string; encoding?: string }>(r.content, { content: "" }),
    }))
    .filter((f) => f.path)
    .map((f) => ({
      path: `android/${f.path}`,
      data: f.encoding === "base64" ? Buffer.from(f.content, "base64") : Buffer.from(f.content, "utf8"),
    }));
}

function extraFiles(projectId: string): ZipEntryInput[] {
  const apis = all<Record<string, unknown>>(
    `SELECT api_id, code, name, method, path, status, fields_json, version FROM tbl_api_def
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY code`, projectId);
  const tracking = all<Record<string, unknown>>(
    `SELECT event_key, trigger_desc, params_json, element_id FROM tbl_track_plan WHERE project_id = ? ORDER BY event_key`, projectId);
  const caps = all<Record<string, unknown>>(
    `SELECT cap_key, enabled, code_status FROM tbl_capability_config WHERE project_id = ? ORDER BY cap_key`, projectId);
  const readme = [
    "# 交付包说明",
    "",
    "本包含：",
    "- `specs/`：五角色 Spec（Markdown）",
    "- `android/`：生成的安卓源码与资源（含 Gradle wrapper、依赖版本锁定清单）",
    "- `apis.json`：被开发 App 的接口定义",
    "- `tracking-plan.json`：埋点方案",
    "- `capabilities.json`：能力配置",
    "",
    "说明：",
    "- **平台不做服务端构建**，本包不含 apk / aar 等构建产物；请在**你本机**用 Gradle 构建运行。",
    "- 本包**不含任何密钥**；第三方 SDK 密钥请自行在工程内填写。",
    `- 导出时间：${nowIso()}`,
  ].join("\n");
  return [
    { path: "README.md", data: Buffer.from(readme, "utf8") },
    { path: "apis.json", data: Buffer.from(JSON.stringify(apis, null, 2), "utf8") },
    { path: "tracking-plan.json", data: Buffer.from(JSON.stringify(tracking, null, 2), "utf8") },
    { path: "capabilities.json", data: Buffer.from(JSON.stringify(caps, null, 2), "utf8") },
  ];
}

export function registerDeliverableRoutes(app: FastifyInstance) {
  const send = (req: { id: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }, data: unknown, status = 200) =>
    reply.status(status).send({ code: "OK", message: "", data, request_id: String(req.id) });

  /** #60 交付归档（Spec 包 + 安卓工程） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/deliverables", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const specs = all<{ role: string; status: string; content_md: string }>(
      `SELECT role, status, content_md FROM tbl_spec_doc WHERE project_id = ? ORDER BY role_order`, projectId);
    const androidTask = latestAndroidTask(projectId);
    const artifactCount = androidTask
      ? (get<{ n: number }>(`SELECT COUNT(*) n FROM tbl_artifact WHERE task_id = ?`, androidTask)?.n ?? 0) : 0;
    const versions = all<{ version_id: string; seq: number; status: string }>(
      `SELECT version_id, seq, status FROM tbl_project_version WHERE project_id = ? ORDER BY seq DESC`, projectId);
    const trackingCount = get<{ n: number }>(`SELECT COUNT(*) n FROM tbl_track_plan WHERE project_id = ?`, projectId)?.n ?? 0;
    const apiCount = get<{ n: number }>(`SELECT COUNT(*) n FROM tbl_api_def WHERE project_id = ? AND deleted_at IS NULL`, projectId)?.n ?? 0;
    return send(req, reply, {
      items: [
        { key: "spec_bundle", name: "Spec 包", available: specs.some((s) => s.content_md.trim()),
          detail: `${specs.filter((s) => s.content_md.trim()).length} / 5 份就绪` },
        { key: "android_code", name: "安卓工程源码", available: !!androidTask,
          detail: androidTask ? `${artifactCount} 个文件（含 Gradle wrapper）` : "还没有成功生成的代码" },
        { key: "apis", name: "接口定义", available: apiCount > 0, detail: `${apiCount} 个接口` },
        { key: "tracking_plan", name: "埋点方案", available: trackingCount > 0, detail: `${trackingCount} 个事件` },
        { key: "versions", name: "版本归档", available: versions.length > 0, detail: `${versions.length} 个版本` },
      ],
      spec_bundle: {
        overall: specs.length === 0 ? "none"
          : specs.some((s) => s.status === "generating") ? "generating"
          : specs.some((s) => s.status === "failed") ? "partial" : "succeeded",
        roles: SPEC_ROLES.map((r) => ({
          role: r.role, label: r.label,
          status: specs.find((s) => s.role === r.role)?.status ?? "none",
          available: !!specs.find((s) => s.role === r.role)?.content_md.trim(),
        })),
      },
      android_project: { task_id: androidTask, artifact_count: artifactCount, unverified_build: true },
      versions: versions.map((v) => ({ version_id: v.version_id, seq: v.seq, status: v.status })),
    });
  });

  /** #61 打包导出（**需鉴权**；真实 ZIP） */
  app.post<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/deliverables/export", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const body = (req.body ?? {}) as { include?: unknown };
    const include = Array.isArray(body.include) ? body.include.map(String) : ["spec", "android", "apis", "tracking", "capabilities"];
    const androidTask = latestAndroidTask(projectId);
    const entries: ZipEntryInput[] = [];
    if (include.includes("spec")) entries.push(...specFiles(projectId));
    if (include.includes("android")) entries.push(...androidFiles(androidTask));
    entries.push(...extraFiles(projectId));
    if (!entries.length) throw new ApiError("INVALID_ARGUMENT", "还没有可交付的内容，先生成 Spec 与代码。");
    const zip = buildZip(entries);
    const name = String(get<{ name: string }>(`SELECT name FROM tbl_project WHERE project_id = ?`, projectId)?.name ?? "project")
      .replace(/[\\/:*?"<>|\s]/g, "_").slice(0, 40);
    return send(req, reply, {
      export_id: uid("exp"), format: "zip",
      filename: `${name}-deliverable.zip`,
      size_bytes: zip.length, entry_count: entries.length,
      base64: zip.toString("base64"),
      note: "平台不做服务端构建，包内不含 apk；请在本地用 Gradle 构建运行。",
    }, 201);
  });
}

/** #62 平台自身埋点上报（批量；**失败不阻塞业务**，**不落库、不含 PRD 正文与生成代码**） */
export function registerMetricRoutes(app: FastifyInstance) {
  const send = (req: { id: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }, data: unknown, status = 200) =>
    reply.status(status).send({ code: "OK", message: "", data, request_id: String(req.id) });
  app.post("/api/v1/metrics/events", async (req, reply) => {
    const body = (req.body ?? {}) as { schema_version?: unknown; batch?: unknown };
    // S6（语义核对 2026-10-22 销项）：契约只写 `{schema_version, batch}` 未声明类型，实现强制 string；
    // 区分「缺失/为空」与「类型错」，避免把类型错也报成「不能为空」误导调用方。
    if (body.schema_version === undefined || body.schema_version === null || body.schema_version === "")
      throw new ApiError("INVALID_ARGUMENT", "schema_version 不能为空。");
    if (typeof body.schema_version !== "string")
      throw new ApiError("INVALID_ARGUMENT", "schema_version 必须是字符串。");
    if (!Array.isArray(body.batch)) throw new ApiError("INVALID_ARGUMENT", "batch 必须是数组。");
    const rejected: { index: number; reason: string }[] = [];
    let accepted = 0;
    const MAX_BATCH = 500;
    body.batch.slice(0, MAX_BATCH).forEach((raw, index) => {
      const e = (raw ?? {}) as Record<string, unknown>;
      // 字段名以 `埋点-Spec §5` 为准：**`event_name`**（原实现误用 `event_key`，会让所有真实上报被判非法）。
      const key = String(e.event_name ?? e.event_key ?? "");
      if (!/^EVT_[a-z0-9_]+$/.test(key)) { rejected.push({ index, reason: "event_name 必须形如 EVT_<模块>_<动作>（小写）" }); return; }
      accepted += 1;
    });
    if (body.batch.length > MAX_BATCH)
      for (let i = MAX_BATCH; i < body.batch.length; i += 1) rejected.push({ index: i, reason: `单批最多 ${MAX_BATCH} 条` });
    // **不为埋点落业务数据**（避免 PRD 正文/生成代码进入存储）；仅回执，失败不阻塞业务
    return send(req, reply, { schema_version: body.schema_version, accepted, rejected });
  });
}

/** #70 `⬛` 中止并归档本流程（超限二选一的「中止」落点） */
export function registerAbortRoutes(app: FastifyInstance) {
  const send = (req: { id: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }, data: unknown, status = 200) =>
    reply.status(status).send({ code: "OK", message: "", data, request_id: String(req.id) });
  app.post<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/abort", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const body = (req.body ?? {}) as { confirm?: boolean };
    // `⬛` 破坏性操作 —— **服务端亦须校验**
    if (body.confirm !== true) throw new ApiError("INVALID_ARGUMENT", "中止流程需要显式确认。");

    const running = all<{ task_id: string }>(
      `SELECT task_id FROM tbl_gen_task WHERE project_id = ? AND status IN ('queued','running')`, projectId);
    let canceled = 0;
    for (const t of running) {
      try { if (getTask(t.task_id) && cancelTask(t.task_id)) canceled += 1; } catch { /* 已结束则跳过 */ }
    }
    tx(() => {
      // **归档不删**：版本与产物全部保留、可读
      run(`UPDATE tbl_project_version SET status='archived' WHERE project_id = ?`, projectId);
      run(`UPDATE tbl_project SET stage='archived', updated_at = ? WHERE project_id = ?`, nowIso(), projectId);
    });
    return send(req, reply, { status: "aborted", project_id: projectId, canceled_tasks: canceled, archived: "本流程产物已归档，数据仍可读" });
  });
}
