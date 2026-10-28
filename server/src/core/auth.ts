/**
 * 鉴权与**逐对象鉴权**（`接口契约 §0.1`）：
 *  - `Authorization: Bearer <token>`，飞书扫码登录后签发（`D-Q6` 已确认）；
 *  - **每一次读写都做逐对象鉴权（含列表、搜索、导出）**；越权 → `FORBIDDEN`（403）
 *    且**不泄露对象是否存在**（统一文案「你没有权限访问这个项目。」，与 `NOT_FOUND` 文案不同但不区分对象）。
 */
import type { FastifyRequest } from "fastify";
import { ApiError } from "./envelope.ts";
import { all, get, nowIso, run, uid } from "../db/index.ts";

export interface User { user_id: string; nickname: string; avatar_url: string; role: "requester" | "admin" }

/** 会话有效期（登录后 7 天；与前端 401 回跳配合） */
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function issueToken(userId: string, feishuState?: string): string {
  const token = uid("tk");
  run(
    `INSERT INTO tbl_session (token, user_id, feishu_state, created_at, expires_at) VALUES (?,?,?,?,?)`,
    token, userId, feishuState ?? null, nowIso(), new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  );
  return token;
}

export function revokeToken(token: string) {
  run(`UPDATE tbl_session SET revoked_at = ? WHERE token = ?`, nowIso(), token);
}

function bearer(req: FastifyRequest): string | null {
  const h = String(req.headers.authorization ?? "");
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/** 解析当前用户；未登录/过期 → `UNAUTHENTICATED` */
export function currentUser(req: FastifyRequest): User {
  const token = bearer(req);
  if (!token) throw new ApiError("UNAUTHENTICATED");
  const row = get<{ user_id: string; expires_at: string; revoked_at: string | null }>(
    `SELECT user_id, expires_at, revoked_at FROM tbl_session WHERE token = ?`, token,
  );
  if (!row || row.revoked_at || row.expires_at < nowIso()) throw new ApiError("UNAUTHENTICATED");
  const u = get<User>(`SELECT user_id, nickname, avatar_url, role FROM tbl_user WHERE user_id = ?`, row.user_id);
  if (!u) throw new ApiError("UNAUTHENTICATED");
  return u;
}

/** 确保用户存在（首次扫码登录时建档） */
export function ensureUser(userId: string, nickname: string, avatarUrl = ""): User {
  const hit = get<User>(`SELECT user_id, nickname, avatar_url, role FROM tbl_user WHERE user_id = ?`, userId);
  if (hit) return hit;
  run(`INSERT INTO tbl_user (user_id, nickname, avatar_url, role, created_at) VALUES (?,?,?,?,?)`,
    userId, nickname, avatarUrl, "requester", nowIso());
  return { user_id: userId, nickname, avatar_url: avatarUrl, role: "requester" };
}

/**
 * 逐对象鉴权：当前用户必须是该项目的成员，否则 `FORBIDDEN`
 * （**不区分「不存在」与「无权限」**，避免泄露存在性）。
 */
export function assertProjectAccess(user: User, projectId: string): void {
  const p = get<{deleted_at: string | null}>(`SELECT deleted_at FROM tbl_project WHERE project_id=?`, projectId);
  if (!p || p.deleted_at) throw new ApiError("FORBIDDEN");
  if (user.role === "admin") return;
  const hit = get<{ project_id: string }>(
    `SELECT project_id FROM tbl_project_member WHERE project_id = ? AND user_id = ?`, projectId, user.user_id,
  );
  if (!hit) throw new ApiError("FORBIDDEN");
}

/** 列出当前用户可访问的项目 id（**列表也要逐对象过滤**） */
export function accessibleProjectIds(user: User): string[] {
  if (user.role === "admin") return all<{project_id:string}>(`SELECT project_id FROM tbl_project WHERE deleted_at IS NULL`).map(r=>r.project_id);
  return all<{ project_id: string }>(
    `SELECT project_id FROM tbl_project_member WHERE user_id = ?`, user.user_id,
  ).map((r) => r.project_id);
}
