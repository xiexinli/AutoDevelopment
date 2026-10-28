import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError, type Envelope } from "./envelope.ts";
import { currentUser } from "./auth.ts";
import { get, nowIso, run } from "../db/index.ts";
const WINDOW_MS = 3000;
function header(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name.toLowerCase()]; return typeof v === "string" && v ? v : null;
}
function scopedKey(req: FastifyRequest, userId: string): string | null {
  const k = header(req, "idempotency-key");
  return k ? createHash("sha256").update(JSON.stringify([userId, req.method, req.url, k])).digest("hex") : null;
}
export function idempotentReplay<T>(req: FastifyRequest, userId: string): Envelope<T> | null {
  const k = scopedKey(req, userId); if (!k) return null;
  const row = get<{ response: string; created_ms: number }>(`SELECT response,created_ms FROM tbl_idempotency WHERE idem_key=? AND user_id=?`, k, userId);
  return row && Date.now() - row.created_ms <= WINDOW_MS ? JSON.parse(row.response) as Envelope<T> : null;
}
export function rememberIdempotent<T>(req: FastifyRequest, userId: string, value: Envelope<T>): void {
  const k = scopedKey(req, userId); if (!k || value.code !== "OK") return;
  run(`INSERT OR REPLACE INTO tbl_idempotency (idem_key,user_id,response,created_at,created_ms) VALUES (?,?,?,?,?)`, k, userId, JSON.stringify(value), nowIso(), Date.now());
}
/** 单进程预约 + 持久化首次响应；副作用前等待同键请求完成，失败不缓存。 */
export function installIdempotency(app: FastifyInstance): void {
  const pending = new Map<string, Promise<void>>();
  const active = new WeakMap<FastifyRequest, { userId: string; key: string; release: () => void }>();
  app.addHook("onRequest", async (req, reply) => {
    if (!['POST','PUT','PATCH','DELETE'].includes(req.method) || !header(req, 'idempotency-key') || req.url.startsWith('/api/v1/auth/')) return;
    const userId = currentUser(req).user_id; const key = scopedKey(req, userId)!;
    while (pending.has(key)) await pending.get(key);
    const cached = idempotentReplay(req, userId) as (Envelope<unknown> & { __http?: number }) | null;
    if (cached) {
      const { __http, ...envelope } = cached;
      return reply.status(__http ?? 200).send(envelope);
    }
    let release!: () => void;
    pending.set(key, new Promise<void>((resolve) => { release = resolve; }));
    active.set(req, { userId, key, release });
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const a = active.get(req);
    if (a && reply.statusCode < 300 && typeof payload === 'string') {
      try { const e = JSON.parse(payload); if (e.code === 'OK') rememberIdempotent(req, a.userId, { ...e, __http: reply.statusCode }); } catch { /* non-JSON not cached */ }
    }
    return payload;
  });
  const release = (req: FastifyRequest) => {
    const a = active.get(req); if (!a) return; pending.delete(a.key); active.delete(req); a.release();
  };
  app.addHook("onResponse", async (req) => release(req));
  app.addHook("onError", async (req) => release(req));
}
export function assertIfMatch(req: FastifyRequest, currentVersion: number): void {
  const raw = header(req, 'if-match'); if (raw === null) throw new ApiError('INVALID_ARGUMENT', '缺少 If-Match 头。');
  if (raw.trim() !== String(currentVersion)) throw new ApiError('VERSION_CONFLICT', '该内容已被他人修改。', { current_version: currentVersion });
}
export function hasIfMatch(req: FastifyRequest): boolean { return header(req, 'if-match') !== null; }
