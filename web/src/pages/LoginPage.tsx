import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Form, Input, Segmented, Spin, Typography } from "antd";
import qrcodeGenerator from "qrcode-generator";
import {
  fetchAuthMethods, fetchMe, fetchQrcode, fetchScanStatus, passwordLogin, session,
} from "@/store/session";
import { track, trackRenewSession, trackRoute } from "@/track";

/**
 * `UI-AUTH-001` 登录与鉴权（全局页）。
 *
 * 两种方式（由 `#72 GET /auth/methods` 决定默认展示哪种，**不猜**）：
 *  - **账号 + 密码**（本地开发阶段）：`#72 POST /auth/password/login`；
 *  - **飞书扫码**：`#63` 取二维码 → `#64` 1.5s 轮询 → confirmed 签发 token。
 * 文案沿用 `UI-Spec §4.1` 的口径（原有「登录没成功，请重试。」等字样不得改写）。
 */
type Phase = "loading" | "idle" | "expired" | "signing" | "failed";

export default function LoginPage() {
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>("loading");
  const [qrcode, setQrcode] = useState<string>("");
  const [left, setLeft] = useState(0);
  const genRef = useRef(0); // 代次：StrictMode 双执行 / 重复刷新时，旧请求的结果一律丢弃
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  // 埋点用：二维码首次展示时刻（`EVT_auth_scan_success.duration_ms` 的起点）与刷新次数
  const qrShownAt = useRef<number | null>(null);
  const qrRefresh = useRef(0);
  const failStreak = useRef(0);

  const [pwEnabled, setPwEnabled] = useState(false);
  const [pwHint, setPwHint] = useState("");
  const [method, setMethod] = useState<"password" | "feishu">("password");
  const [submitting, setSubmitting] = useState(false);
  const [pwError, setPwError] = useState("");

  // 埋点：登录页在本页上报（不在 AppShell 内）
  useEffect(() => { trackRoute("RT-AUTH-001", null); }, []);

  /**
   * 把**授权页地址**渲染成可扫的二维码（内联 SVG data URL，无外链）。
   * 生成失败返回空串（只影响二维码显示，**不阻断登录**）。
   */
  const qrSrc = useMemo(() => {
    if (!qrcode || qrcode.startsWith("data:image")) return "";
    try {
      const qr = qrcodeGenerator(0, "M"); // 0 = 按内容长度自动选版本；M 级纠错足够 URL 场景
      qr.addData(qrcode);
      qr.make();
      return `data:image/svg+xml;utf8,${encodeURIComponent(qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true }))}`;
    } catch {
      return "";
    }
  }, [qrcode]);

  const stop = useCallback(() => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const load = useCallback(async () => {
    const gen = ++genRef.current;
    stop();
    setPhase("loading");
    try {
      const r = await fetchQrcode();
      if (gen !== genRef.current) return; // 已被更新的调用取代
      setQrcode(r.qrcode_url);
      setLeft(r.expires_in_seconds);
      setPhase("idle");
      if (qrShownAt.current === null) qrShownAt.current = Date.now(); else qrRefresh.current += 1;

      // 有效期倒计时（120s）—— 过期后显示「二维码已过期。」+「刷新二维码」
      tickRef.current = window.setInterval(() => {
        if (gen !== genRef.current) return;
        setLeft((v) => {
          if (v <= 1) { stop(); setPhase("expired"); return 0; }
          return v - 1;
        });
      }, 1000);

      // 扫码状态轮询（契约：1.5s）
      pollRef.current = window.setInterval(async () => {
        try {
          const s = await fetchScanStatus(r.state);
          if (gen !== genRef.current) return;
          if (s.scan_status === "confirmed" && s.token) {
            stop();
            setPhase("signing");
            session.token = s.token;
            trackRenewSession();
            // 飞书扫码登录成功：token 写入之后、跳转之前
            track("EVT_auth_scan_success", {
              duration_ms: qrShownAt.current ? Date.now() - qrShownAt.current : null,
              qr_refresh_count: qrRefresh.current,
              reentry: typeof window !== "undefined" && new URLSearchParams(window.location.search).has("next"),
            }, { dedupKey: "scan_success", immediate: true });
            nav("/projects", { replace: true });
          } else if (s.scan_status === "expired") {
            stop();
            setPhase("expired");
          }
        } catch (err) {
          if (gen !== genRef.current) return;
          stop();
          setPhase("failed");
          // 扫码换取 token 失败（`EL-AUTH-010` 渲染之后）；同一 state 只报 1 次
          track("EVT_auth_login_failed", {
            error_code: (err as { code?: string })?.code ?? "UPSTREAM_UNAVAILABLE",
            retry_index: failStreak.current,
          }, { dedupKey: `login_failed:${r.state}`, immediate: true });
        }
      }, 1500);
    } catch {
      setPhase("failed");
    }
  }, [nav, stop]);

  useEffect(() => {
    // 先问服务端支持哪些登录方式，再决定默认展示哪一种
    fetchAuthMethods()
      .then((m) => {
        setPwEnabled(m.password_login);
        setPwHint(m.password_login_hint);
        // 配了**真实飞书应用**就以飞书扫码为默认方式（2026-10-23：登录方式改回飞书扫码）；
        // 应用不可用/未配置时才退回账号密码（它仍作为兜底入口保留，不静默放宽）。
        setMethod(m.feishu_login === "real" ? "feishu" : (m.password_login ? "password" : "feishu"));
      })
      .catch(() => setMethod("feishu"));

    // 有 token 时**先校验**再跳转；失效则由全局 401 处理清 token（避免死循环）
    if (session.token) {
      let alive = true;
      fetchMe()
        .then(() => { if (alive) nav("/projects", { replace: true }); })
        .catch(() => { if (alive) setPhase("idle"); });
      return () => { alive = false; stop(); };
    }
    setPhase("idle");
    return stop;
  }, [load, nav, stop]);

  // 切到飞书时才真正取二维码（避免不需要时白轮询）
  useEffect(() => {
    if (method === "feishu" && !qrcode) void load();
    if (method === "password") stop();
  }, [method, qrcode, load, stop]);

  const onPasswordLogin = useCallback(async (v: { username: string; password: string }) => {
    setSubmitting(true);
    setPwError("");
    const startedAt = Date.now();
    try {
      const r = await passwordLogin(v.username.trim(), v.password);
      session.token = r.token;
      trackRenewSession(); // 登录成功 → 新会话（`埋点-Spec §5`）
      // `success` = token 写入之后、跳转之前；**绝不携带用户名/密码**
      track("EVT_auth_password_login", {
        result: "success", reason: null, block_reason: null,
        duration_ms: Date.now() - startedAt, retry_index: 0, reentry: false,
      }, { immediate: true });
      nav("/projects", { replace: true });
    } catch (e) {
      const msg = (e as Error).message || "登录没成功，请重试。";
      setPwError(msg);
      // `failed` = #72 失败且错误提示渲染之后；**不得区分「账号不存在」与「密码错误」**
      track("EVT_auth_password_login", {
        result: "failed", reason: (e as { code?: string }).code ?? "NETWORK_ERROR", block_reason: null,
        duration_ms: Date.now() - startedAt, retry_index: 0, reentry: false,
      }, { immediate: true });
    } finally {
      setSubmitting(false);
    }
  }, [nav]);

  /** 字段级校验拦截 → 请求未发出（`blocked` 分支） */
  const onPasswordLoginFailed = useCallback((info: { errorFields?: { name: (string | number)[] }[] }) => {
    const first = info.errorFields?.[0]?.name?.[0];
    track("EVT_auth_password_login", {
      result: "blocked", reason: null,
      block_reason: first === "username" ? "empty_username" : "empty_password",
      duration_ms: null, retry_index: 0, reentry: false,
    }, { immediate: true });
  }, []);

  const passwordPanel = (
    <>
      <Form layout="vertical" onFinish={onPasswordLogin} onFinishFailed={onPasswordLoginFailed} disabled={submitting} style={{ textAlign: "left" }}>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名。" }]}>
          <Input size="large" autoComplete="username" placeholder="请输入用户名" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码。" }]}>
          <Input.Password size="large" autoComplete="current-password" placeholder="请输入密码" />
        </Form.Item>
        <Button type="primary" size="large" htmlType="submit" block loading={submitting}>
          登录
        </Button>
      </Form>
      {pwError && (
        <Alert type="error" showIcon style={{ marginTop: 12, textAlign: "left" }} message={pwError} />
      )}
      {pwHint && (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
          {pwHint}
        </Typography.Text>
      )}
    </>
  );

  const feishuPanel = (
    <>
      <div style={{ height: 200, display: "grid", placeItems: "center", marginBottom: 12 }}>
        {phase === "loading" && <Spin />}
        {phase === "expired" && <Typography.Text type="secondary">二维码已过期。</Typography.Text>}
        {phase === "failed" && <Typography.Text type="danger">登录没成功，请重试。</Typography.Text>}
        {(phase === "idle" || phase === "signing") && qrcode && (
          // 开发登录返回的是**内联二维码图片**；真实飞书登录返回**授权页地址**
          // （`accounts.feishu.cn/.../authorize`）—— 这里把它**渲染成二维码**：
          // 手机用飞书「扫一扫」即可授权（页面 120s 过期，过期后点「刷新二维码」）。
          // 同时保留「在本机打开授权页」的入口，方便没有手机或同在电脑上操作的场景。
          qrcode.startsWith("data:image") ? (
            <img src={qrcode} alt="飞书登录二维码" width={180} height={180} style={{ border: "1px solid var(--ad-border)", borderRadius: 6 }} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              {qrSrc && (
                <img
                  src={qrSrc}
                  alt="飞书登录二维码"
                  width={180}
                  height={180}
                  style={{ border: "1px solid var(--ad-border)", borderRadius: 6, background: "var(--ad-bg-container)" }}
                />
              )}
              <Button size="small" type="link" style={{ padding: 0, fontSize: 12 }} href={qrcode} target="_blank" rel="noreferrer">
                或在本机打开授权页
              </Button>
            </div>
          )
        )}
      </div>

      {phase === "idle" && (
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
          {qrcode && !qrcode.startsWith("data:image")
            ? "用飞书「扫一扫」上面的二维码授权（也可以在本机打开授权页），授权完成后回到这里即可。"
            : "请用飞书扫一扫，登录后开始。"}
        </Typography.Text>
      )}
      {phase === "signing" && (
        <Typography.Text style={{ display: "block", marginBottom: 4 }}>
          <Spin size="small" /> 正在登录…
        </Typography.Text>
      )}
      {(phase === "idle" || phase === "signing") && left > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{left}s 后失效</Typography.Text>
      )}

      {phase === "failed" && (
        <Alert type="error" showIcon style={{ marginTop: 12, textAlign: "left" }} message="登录没成功，请重试。" />
      )}

      <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center" }}>
        {phase === "expired" && <Button type="primary" onClick={load}>刷新二维码</Button>}
        {phase === "failed" && <Button type="primary" onClick={load}>重新扫码</Button>}
        {phase === "idle" && <Button onClick={load}>刷新二维码</Button>}
      </div>

      <Typography.Text type="secondary" style={{ display: "block", marginTop: 20, fontSize: 12 }}>
        首次登录会自动创建账号，角色默认为需求方。
      </Typography.Text>
    </>
  );

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--ad-bg-page)", padding: 24 }}>
      <Card
        style={{ width: 420, textAlign: "center", borderRadius: 8, boxShadow: "var(--ad-shadow-2)" }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="ad-brand-mark" style={{ width: 28, height: 28, fontSize: 14 }}>A</span>
          <Typography.Title level={3} style={{ margin: 0 }}>AutoDevelopment</Typography.Title>
        </div>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
          把你的 PRD 拆成五份 Spec，并直接生成原生安卓工程。
        </Typography.Paragraph>

        {pwEnabled && (
          <Segmented
            block
            style={{ marginBottom: 20 }}
            value={method}
            onChange={(v) => setMethod(v as "password" | "feishu")}
            options={[{ label: "账号密码", value: "password" }, { label: "飞书扫码", value: "feishu" }]}
          />
        )}

        {pwEnabled && method === "password" ? passwordPanel : feishuPanel}
      </Card>
    </div>
  );
}
