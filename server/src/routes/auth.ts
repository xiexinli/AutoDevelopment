/**
 * `§1.12 认证 · 用户` —— #63 / #64 / #65 / #66（+ 开发用的扫码推进接口）。
 *
 * 扫码登录流程：前端 `GET /auth/feishu/qrcode` 拿二维码与 `state` → 每 1.5s 轮询
 * `GET /auth/feishu/qrcode/{state}` → `confirmed` 时**签发 token**（`D-Q6` 已确认走飞书扫码）。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { currentUser, ensureUser, issueToken, revokeToken } from "../core/auth.ts";
import { get } from "../db/index.ts";
import { createFeishuLoginAdapter } from "../adapters/feishu.ts";
import { USERNAME_RE, loginWithPassword, passwordLoginMode } from "../core/password.ts";

export function registerAuthRoutes(app: FastifyInstance) {
  const feishu = createFeishuLoginAdapter();

  // #63 取飞书登录二维码
  app.get("/api/v1/auth/feishu/qrcode", async (req) => {
    const q = await feishu.createQrcode();
    return { code: "OK", message: "", data: q, request_id: String(req.id) };
  });

  /**
   * `#72` 可用的登录方式（前端据此决定默认展示哪种，**不猜**）。
   */
  app.get("/api/v1/auth/methods", async (req) => ({
    code: "OK", message: "", request_id: String(req.id),
    data: {
      password_login: passwordLoginMode() === "development",
      password_login_hint: passwordLoginMode() === "development"
        ? "本地开发登录：用户名可用任意合法值，密码为开发密码。" : "",
      feishu_login: feishu.kind === "real" ? "real" : "development",
    },
  }));

  /**
   * `#72` 账号 + 密码登录。
   * 失败**不区分**「账号不存在」与「密码错误」（统一 `UNAUTHENTICATED`），避免枚举账号。
   */
  app.post<{ Body: { username?: string; password?: string } }>(
    "/api/v1/auth/password/login", async (req) => {
      if (passwordLoginMode() !== "development")
        throw new ApiError("INVALID_ARGUMENT", "当前未启用账号密码登录。");
      const username = String(req.body?.username ?? "").trim();
      const password = String(req.body?.password ?? "");
      if (!USERNAME_RE.test(username))
        throw new ApiError("INVALID_ARGUMENT", "用户名需为 2~32 位字母、数字或 _ . - @。", { field: "username" });
      if (!password || password.length > 128)
        throw new ApiError("INVALID_ARGUMENT", "请输入密码。", { field: "password" });

      const hit = loginWithPassword(username, password);
      if (!hit) throw new ApiError("UNAUTHENTICATED", "用户名或密码不正确。");
      const token = issueToken(hit.user.user_id);
      return {
        code: "OK", message: "", request_id: String(req.id),
        data: {
          token,
          created: hit.created,
          user: { user_id: hit.user.user_id, nickname: hit.user.nickname, avatar_url: hit.user.avatar_url, role: hit.user.role },
        },
      };
    },
  );

  // #64 扫码状态（1.5s 轮询）；`confirmed` 时签发 token（同 state 只签发一次）
  app.get<{ Params: { state: string } }>("/api/v1/auth/feishu/qrcode/:state", async (req) => {
    const state = req.params.state;
    const status = await feishu.scanStatus(state);
    if (status !== "confirmed") {
      return { code: "OK", message: "", data: { scan_status: status }, request_id: String(req.id) };
    }
    const issued = get<{ token: string }>(
      `SELECT token FROM tbl_session WHERE feishu_state = ? AND revoked_at IS NULL`, state,
    );
    if (issued) {
      return { code: "OK", message: "", data: { scan_status: "confirmed" }, request_id: String(req.id) };
    }
    // 真实模式：身份来自扫码回调；开发模式：内置演示身份
    const identity = feishu.takeIdentity?.(state)
      ?? { open_id: "ou_dev_user", nickname: "演示用户", avatar_url: "" };
    ensureUser(identity.open_id, identity.nickname, identity.avatar_url);
    const token = issueToken(identity.open_id, state);
    return { code: "OK", message: "", data: { scan_status: "confirmed", token }, request_id: String(req.id) };
  });

  /**
   * 开发适配器专用：显式推进扫码状态（真实环境由手机扫码推进）。
   * 真实适配器下 → `INVALID_ARGUMENT`。
   */
  app.post<{ Params: { state: string }; Body: { next?: string } }>(
    "/api/v1/auth/feishu/qrcode/:state/simulate",
    async (req) => {
      if (feishu.kind !== "mock") throw new ApiError("INVALID_ARGUMENT", "当前为真实飞书适配器，不支持模拟扫码。");
      const next = req.body?.next === "scanned" ? "scanned" : "confirmed";
      const identity = await feishu.simulate(req.params.state, next);
      if (identity) ensureUser(identity.open_id, identity.nickname, identity.avatar_url);
      return { code: "OK", message: "", data: { scan_status: next }, request_id: String(req.id) };
    },
  );

  /**
   * 真实飞书扫码登录的回调（`AD_FEISHU_REDIRECT_URI` 指向这里）。
   * 用 `code` 换用户令牌 → 建/取用户 → 把该 `state` 置 `confirmed`，前端下一次轮询即可拿到平台 token。
   * **不返回任何令牌内容**，只回一个「可以回到平台」的极简页面。
   */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/v1/auth/feishu/callback", async (req, replySend) => {
      const { code, state } = req.query;
      const html = (msg: string) =>
        `<!doctype html><meta charset="utf-8"><title>AutoDevelopment</title>`
        + `<body style="font-family:system-ui;padding:40px;line-height:1.7">${msg}</body>`;
      if (req.query.error || !code || !state) {
        void replySend.type("text/html").status(400).send(html("授权没有完成，可以回到平台重新扫码。"));
        return;
      }
      if (feishu.kind !== "real" || !feishu.completeLogin) {
        void replySend.type("text/html").status(400).send(html("当前是开发适配器，不支持真实扫码回调。"));
        return;
      }
      try {
        const identity = await feishu.completeLogin(state, code);
        ensureUser(identity.open_id, identity.nickname, identity.avatar_url);
        void replySend.type("text/html").send(html("登录成功，可以回到 AutoDevelopment 继续了。"));
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "登录没有完成";
        void replySend.type("text/html").status(502).send(html(`${msg}，请回到平台重新扫码。`));
      }
    },
  );

  // #65 登出（失效当前 token）
  app.post("/api/v1/auth/logout", async (req) => {
    const h = String(req.headers.authorization ?? "");
    if (h.startsWith("Bearer ")) revokeToken(h.slice(7));
    return { code: "OK", message: "", data: null, request_id: String(req.id) };
  });

  // #66 当前用户信息
  app.get("/api/v1/users/me", async (req) => {
    const u = currentUser(req);
    return { code: "OK", message: "", data: u, request_id: String(req.id) };
  });
}
