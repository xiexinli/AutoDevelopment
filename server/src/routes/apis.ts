/**
 * `§1.9 接口定义管理` —— #50 清单/新建 / #51 详情/编辑 / #52 ⬛删除 / #53 字段表。
 *
 * ⚠️ 本页管理的是**被开发 App 的接口定义**（`API-<模块>-<三位>` 命名空间），
 * 与「平台自身接口（`接口契约 #n`）」是**两套**，**不得混称**。
 *
 * 契约要点：
 *  - `#50`：`q` 匹配 `code`/`name`/`path`，支持**状态筛选**与分页（`§0.3` 统一分页包）；
 *  - `#51` `PATCH` 与 `#53` `PUT` **须带 `If-Match`**，不匹配 → 409 `VERSION_CONFLICT` + `current_version`；
 *  - `#52` `⬛` 删除：**服务端亦须校验**；删除后**下次生成版本后生效**，引用它的 Spec 标「需复核」；
 *  - `#53` `field_type` 为**完整 8 项枚举**（`string|int|long|double|bool|object|array|date`），**禁「等」**。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser, type User } from "../core/auth.ts";
import { assertIfMatch } from "../core/idempotency.ts";
import { parsePage, withMeta } from "../core/pagination.ts";
import { all, get, json, nowIso, run, tx, uid } from "../db/index.ts";

export const FIELD_TYPES = ["string", "int", "long", "double", "bool", "object", "array", "date"] as const;
export const API_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
export const API_STATUSES = ["draft", "effective", "deprecated"] as const;

interface ApiRow {
  api_id: string; project_id: string; code: string; name: string; method: string; path: string;
  status: string; fields_json: string; version: number; created_at: string; updated_at: string; deleted_at: string | null;
}

function validateFields(value: unknown): { name: string; field_type: string; required: boolean;
  length: number | null; precision: number | null; unit: string; description: string }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError("INVALID_ARGUMENT", "字段表必须是一个数组。");
  const seen = new Set<string>();
  return value.map((raw, i) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const name = String(f.name ?? "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,49}$/.test(name))
      throw new ApiError("INVALID_ARGUMENT", `第 ${i + 1} 个字段的名字不合法（只能是字母、数字、下划线，且不以数字开头）。`, { field: `fields[${i}].name`, received: String(f.name ?? "") });
    if (seen.has(name))
      throw new ApiError("INVALID_ARGUMENT", `字段名「${name}」重复了。`, { field: `fields[${i}].name`, received: name });
    seen.add(name);
    const type = String(f.field_type ?? "");
    if (!(FIELD_TYPES as readonly string[]).includes(type))
      throw new ApiError("INVALID_ARGUMENT", `字段「${name}」的类型不合法（完整 8 项：${FIELD_TYPES.join(" / ")}）。`, { field: `fields[${i}].field_type`, received: type });
    const num = (v: unknown, label: string): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new ApiError("INVALID_ARGUMENT", `字段「${name}」的${label}只能是不小于 0 的整数。`, { field: `fields[${i}]`, received: String(v) });
      return n;
    };
    return {
      name, field_type: type, required: Boolean(f.required),
      length: num(f.length, "长度"), precision: num(f.precision, "精度"),
      unit: String(f.unit ?? "").slice(0, 16), description: String(f.description ?? "").slice(0, 200),
    };
  });
}

function publicApi(r: ApiRow) {
  return {
    api_id: r.api_id, code: r.code, name: r.name, method: r.method, path: r.path,
    status: r.status, fields: json.parse<unknown[]>(r.fields_json, []),
    version: r.version, created_at: r.created_at, updated_at: r.updated_at,
  };
}

function loadApi(user: User, apiId: string): ApiRow {
  const row = get<ApiRow>(`SELECT * FROM tbl_api_def WHERE api_id = ?`, apiId);
  if (!row || row.deleted_at) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
  assertProjectAccess(user, row.project_id);
  return row;
}

export function registerApiRoutes(app: FastifyInstance) {
  const send = (req: { id: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }, data: unknown, status = 200) =>
    reply.status(status).send({ code: "OK", message: "", data, request_id: String(req.id) });

  /** #50 清单（`q` / 状态筛选 / 分页） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/apis", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const p = parsePage(req);
    let rows = all<ApiRow>(`SELECT * FROM tbl_api_def WHERE project_id = ? AND deleted_at IS NULL`, projectId);
    if (p.q) {
      const q = p.q.toLowerCase();
      rows = rows.filter((r) => `${r.code} ${r.name} ${r.path}`.toLowerCase().includes(q));
    }
    const status = String((req.query as Record<string, unknown> | undefined)?.status ?? "");
    if (status) {
      if (!(API_STATUSES as readonly string[]).includes(status))
        throw new ApiError("INVALID_ARGUMENT", "状态只能是 draft / effective / deprecated。");
      rows = rows.filter((r) => r.status === status);
    }
    const paged = withMeta(rows.map(publicApi), p, "api_id");
    return send(req, reply, { ...paged, status_filter: status });
  });

  /** #50 新建 */
  app.post<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/apis", async (req, reply) => {
    const user = currentUser(req);
    const projectId = req.params.project_id;
    assertProjectAccess(user, projectId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const code = String(body.code ?? "").trim();
    const name = String(body.name ?? "").trim();
    const method = String(body.method ?? "GET").toUpperCase();
    const path = String(body.path ?? "").trim();
    if (!code || code.length > 64) throw new ApiError("INVALID_ARGUMENT", "接口编号不能为空，长度 1~64。");
    if (!name || name.length > 64) throw new ApiError("INVALID_ARGUMENT", "接口名称不能为空，长度 1~64。");
    if (!(API_METHODS as readonly string[]).includes(method))
      throw new ApiError("INVALID_ARGUMENT", `请求方法只能是 ${API_METHODS.join(" / ")}。`);
    if (!path.startsWith("/")) throw new ApiError("INVALID_ARGUMENT", "路径要以 / 开头。");
    if (get(`SELECT api_id FROM tbl_api_def WHERE project_id = ? AND code = ? AND deleted_at IS NULL`, projectId, code))
      throw new ApiError("INVALID_ARGUMENT", "该接口编号已存在。");
    const apiId = uid("api");
    const ts = nowIso();
    tx(() => {
      run(`INSERT INTO tbl_api_def (api_id, project_id, code, name, method, path, status, fields_json, version, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        apiId, projectId, code, name, method, path, "draft", "[]", 1, ts, ts);
      // 接口变更 → 引用它的 Spec 标「需复核」
      run(`UPDATE tbl_spec_doc SET change_point = ? WHERE project_id = ? AND stale = 0`,
        `接口 ${code} 新增，需复核`, projectId);
    });
    return send(req, reply, publicApi(get<ApiRow>(`SELECT * FROM tbl_api_def WHERE api_id = ?`, apiId)!), 201);
  });

  /** #51 详情 */
  app.get<{ Params: { api_id: string } }>("/api/v1/apis/:api_id", async (req, reply) => {
    const user = currentUser(req);
    return send(req, reply, publicApi(loadApi(user, req.params.api_id)));
  });

  /** #51 编辑（须 `If-Match`） */
  app.patch<{ Params: { api_id: string } }>("/api/v1/apis/:api_id", async (req, reply) => {
    const user = currentUser(req);
    const row = loadApi(user, req.params.api_id);
    assertIfMatch(req, row.version);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const next = { code: row.code, name: row.name, method: row.method, path: row.path, status: row.status };
    if (body.code !== undefined) {
      const code = String(body.code).trim();
      if (!code || code.length > 64) throw new ApiError("INVALID_ARGUMENT", "接口编号不能为空，长度 1~64。");
      const dup = get<{ api_id: string }>(
        `SELECT api_id FROM tbl_api_def WHERE project_id = ? AND code = ? AND deleted_at IS NULL AND api_id <> ?`,
        row.project_id, code, row.api_id);
      if (dup) throw new ApiError("INVALID_ARGUMENT", "该接口编号已存在。");
      next.code = code;
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name || name.length > 64) throw new ApiError("INVALID_ARGUMENT", "接口名称不能为空，长度 1~64。");
      next.name = name;
    }
    if (body.method !== undefined) {
      const m = String(body.method).toUpperCase();
      if (!(API_METHODS as readonly string[]).includes(m)) throw new ApiError("INVALID_ARGUMENT", `请求方法只能是 ${API_METHODS.join(" / ")}。`);
      next.method = m;
    }
    if (body.path !== undefined) {
      const path = String(body.path).trim();
      if (!path.startsWith("/")) throw new ApiError("INVALID_ARGUMENT", "路径要以 / 开头。");
      next.path = path;
    }
    if (body.status !== undefined) {
      const s = String(body.status);
      if (!(API_STATUSES as readonly string[]).includes(s)) throw new ApiError("INVALID_ARGUMENT", "状态只能是 draft / effective / deprecated。");
      next.status = s;
    }
    tx(() => {
      run(`UPDATE tbl_api_def SET code=?, name=?, method=?, path=?, status=?, version=version+1, updated_at=? WHERE api_id=?`,
        next.code, next.name, next.method, next.path, next.status, nowIso(), row.api_id);
      run(`UPDATE tbl_spec_doc SET change_point = ? WHERE project_id = ? AND stale = 0`,
        `接口 ${next.code} 已修改，需复核`, row.project_id);
    });
    return send(req, reply, publicApi(get<ApiRow>(`SELECT * FROM tbl_api_def WHERE api_id = ?`, row.api_id)!));
  });

  /** #52 `⬛` 删除（**下次生成版本后生效**；引用它的 Spec 标「需复核」） */
  app.delete<{ Params: { api_id: string } }>("/api/v1/apis/:api_id", async (req, reply) => {
    const user = currentUser(req);
    const row = loadApi(user, req.params.api_id);
    const body = (req.body ?? {}) as { confirm?: boolean };
    // `⬛` 破坏性操作 —— **服务端亦须校验**
    if (body.confirm !== true) throw new ApiError("INVALID_ARGUMENT", "删除接口需要显式确认。");
    tx(() => {
      run(`UPDATE tbl_api_def SET deleted_at = ?, updated_at = ? WHERE api_id = ?`, nowIso(), nowIso(), row.api_id);
      // 引用它的 Spec 标「需复核」（下次生成版本后才真正移除）
      const pattern = `%${row.code}%`;
      run(`UPDATE tbl_spec_doc SET change_point = ? WHERE project_id = ? AND (content_md LIKE ? OR content_md LIKE ?)`,
        `接口 ${row.code} 已删除，需复核`, row.project_id, pattern, `%${row.path}%`);
    });
    return send(req, reply, { api_id: row.api_id, status: "deleted", effective: "下次生成版本后生效" });
  });

  /** #53 字段表（完整 8 项枚举；须 `If-Match`） */
  app.put<{ Params: { api_id: string } }>("/api/v1/apis/:api_id/schema", async (req, reply) => {
    const user = currentUser(req);
    const row = loadApi(user, req.params.api_id);
    assertIfMatch(req, row.version);
    const body = (req.body ?? {}) as { fields?: unknown };
    const fields = validateFields(body.fields);
    tx(() => {
      run(`UPDATE tbl_api_def SET fields_json = ?, version = version + 1, updated_at = ? WHERE api_id = ?`,
        JSON.stringify(fields), nowIso(), row.api_id);
      run(`UPDATE tbl_spec_doc SET change_point = ? WHERE project_id = ? AND stale = 0`,
        `接口 ${row.code} 的字段表已修改，需复核`, row.project_id);
    });
    const fresh = get<ApiRow>(`SELECT * FROM tbl_api_def WHERE api_id = ?`, row.api_id)!;
    return send(req, reply, { api_id: fresh.api_id, fields: json.parse<unknown[]>(fresh.fields_json, []), version: fresh.version });
  });
}
