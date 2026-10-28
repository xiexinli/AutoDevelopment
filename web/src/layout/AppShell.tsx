import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Avatar, Badge, Dropdown, Layout, Menu, Space, Tag, Typography, message } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { logout, session, fetchMe } from "@/store/session";
import { IS_MOCK, setUnauthorizedHandler } from "@/api/client";
import ModelPicker from "@/components/ModelPicker";
import SystemSettingsModal from "@/components/SystemSettingsModal";
import FloatingChat from "@/components/FloatingChat";
import { setChatRoute, DEFAULT_THREAD } from "@/chat/thread";
import { track, trackRoute, currentRouteRt } from "@/track";
import { rtOf, projectIdOf } from "@/track/route-map";
import type { User } from "@/domain/types";

const { Header, Content } = Layout;

/**
 * 路由 → 对话**线程**（2026-10-22 修正口径）：对话的**对象恒为 Project**，
 * 线程 = 项目内的**子步骤**（与页面 tab 一一对应）—— 切到不同子步骤就是另一个对话框。
 * 未进入项目（`/projects` 列表页）→ `projectId` 为空，**面板不显示**。
 */
function stepForRoute(pathname: string): string {
  const tab = pathname.split("/")[3] ?? "";
  return tab && !tab.includes("?") ? tab : DEFAULT_THREAD;
}

const PROJECT_TABS = [
  { key: "workbench", label: "工作台" },
  { key: "kb", label: "知识库" },
  { key: "upload", label: "上传" },
  { key: "review", label: "审核" },
  { key: "split", label: "拆解" },
  { key: "editor", label: "编辑" },
  { key: "specs", label: "Spec" },
  { key: "apis", label: "接口" },
  { key: "capabilities", label: "能力" },
  { key: "versions", label: "版本" },
];

/**
 * 全局外壳：顶栏（平台名 + 项目内导航 + 用户菜单）。
 * `EL-GLOBAL-*` 为跨页全局组件；用户菜单数据来自 `#66 GET /users/me`。
 */
export default function AppShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const [sp] = useSearchParams();
  const [aiDevelopment, setAiDevelopment] = useState(false);
  useEffect(() => { if(!IS_MOCK) void fetch("/api/v1/health").then(r=>r.json()).then(r=>setAiDevelopment(r.data?.llm_mode === "development")).catch(()=>undefined); }, []);
  const [me, setMe] = useState<User | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, ctx] = message.useMessage();

  const m = loc.pathname.match(/^\/projects\/([^/]+)\//);
  const projectId = m?.[1];
  const activeTab = loc.pathname.split("/").pop() ?? "";

  // 全局 401 → 清 token 并跳登录（否则会与登录页的自动跳转形成死循环）
  // 并上报 `EVT_auth_session_expired`（跳转之后；同一 `session_id` 只报 1 次）
  useEffect(() => {
    setUnauthorizedHandler(({ source_api }) => {
      nav("/login", { replace: true });
      let hadDraft = false;
      try { hadDraft = Object.keys(localStorage).some((k) => k.includes(".draft")); } catch { /* ignore */ }
      track("EVT_auth_session_expired",
        { source_rt: currentRouteRt(), source_api, had_draft: hadDraft },
        { dedupKey: "session_expired", dedupWindowMs: 3_600_000, immediate: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [nav]);

  // 埋点：维护 `page_rt` / `prev_rt` / `project_id`（`埋点-Spec §5` 公共参数）
  // 同时切换对话框的「主体对象」（切页面即切会话线程）
  useEffect(() => {
    trackRoute(rtOf(loc.pathname, loc.search), projectIdOf(loc.pathname));
    setChatRoute({ projectId: projectIdOf(loc.pathname), stepKey: stepForRoute(loc.pathname) });
  }, [loc.pathname, loc.search]);

  useEffect(() => {
    if (!session.token) {
      nav("/login", { replace: true });
      return;
    }
    fetchMe().then(setMe).catch(() => { session.clear(); nav("/login", { replace: true }); });
  }, [nav]);

  const nickname = me?.nickname?.trim() || "未命名用户";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {ctx}
      <Header className="ad-header">
        <Link to="/projects" className="ad-brand">
          <span className="ad-brand-mark">A</span>
          AutoDevelopment
        </Link>

        {projectId && (
          <Menu
            className="ad-nav"
            mode="horizontal"
            selectedKeys={[sp.get("mode") === "preview" ? "editor" : activeTab]}
            items={PROJECT_TABS.map((t) => ({
              key: t.key,
              label: <Link to={`/projects/${projectId}/${t.key}`}>{t.label}</Link>,
            }))}
          />
        )}
        {!projectId && <div style={{ flex: 1 }} />}

        <Space size={12}>
          {!IS_MOCK && <ModelPicker />}
          {IS_MOCK && <Tag color="orange">Mock 数据</Tag>}
          {aiDevelopment && <Tag color="orange">AI 开发适配器 · 非真实审核</Tag>}
          <Badge dot={false}>
            <Dropdown
              menu={{
                items: [
                  { key: "role", label: `角色：${me?.role === "admin" ? "管理员" : "需求方"}`, disabled: true },
                  { type: "divider" },
                  { key: "settings", icon: <SettingOutlined />, label: "系统设置" },
                  { key: "logout", label: "退出登录" },
                ],
                onClick: async ({ key }) => {
                  if (key === "settings") {
                    setSettingsOpen(true);
                    return;
                  }
                  if (key !== "logout") return;
                  let forced = false;
                  try {
                    await logout();
                  } catch {
                    /* 网络失败 → 本地强制登出（契约允许） */
                    forced = true;
                  }
                  // 退出登录：`#65` 返回后（或网络失败强制登出）、清会话状态之后
                  track("EVT_auth_logout", { forced }, { dedupKey: "logout", immediate: true });
                  session.clear();
                  toast.success("已退出登录。");
                  nav("/login", { replace: true });
                },
              }}
            >
              <Space className="ad-user">
                <Avatar size={28} src={me?.avatar_url || undefined}>
                  {nickname.slice(0, 1)}
                </Avatar>
                <Typography.Text>{nickname}</Typography.Text>
              </Space>
            </Dropdown>
          </Badge>
        </Space>
      </Header>

      <Content className="ad-content">
        <Outlet />
      </Content>

      {/* 全局悬浮对话框：每个页面都在，主体对象随路由切换 */}
      <FloatingChat projectId={projectId ?? null} />

      {/* 系统设置（用户菜单 → 系统设置）：目前只有「主题」一节 */}
      <SystemSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Layout>
  );
}
