import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, App as AntApp, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import AppShell from "@/layout/AppShell";
import LoginPage from "@/pages/LoginPage";
import ProjectListPage from "@/pages/ProjectListPage";
import UploadPage from "@/pages/UploadPage";
import ReviewPage from "@/pages/ReviewPage";
import SplitPage from "@/pages/SplitPage";
import EditPage from "@/pages/EditPage";
import ApiManagePage from "@/pages/ApiManagePage";
import CapabilitiesPage from "@/pages/CapabilitiesPage";
import SpecsPage from "@/pages/SpecsPage";
import VersionsPage from "@/pages/VersionsPage";
import KbPage from "@/pages/KbPage";
import WorkbenchPage from "@/pages/WorkbenchPage";
import { installTracking, track, currentRouteRt } from "@/track";
import { setForbiddenHandler } from "@/api/client";
import { initTheme, resolvedTheme, subscribeTheme, type ResolvedTheme } from "@/theme";
import "@/styles.css";

/**
 * 13 条路由（与 `App-Spec §3` 的 `RT-*` 一一对应）。
 * 编辑态 / 预览态同路径，用 `?mode=edit|preview` 区分。
 * S1 已实现：登录、项目列表；其余为占位（后续切片）。
 */
const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: "projects", element: <ProjectListPage /> },
      { path: "projects/:projectId/kb", element: <KbPage /> },
      { path: "projects/:projectId/workbench", element: <WorkbenchPage /> },
      { path: "projects/:projectId/upload", element: <UploadPage /> },
      { path: "projects/:projectId/review", element: <ReviewPage /> },
      { path: "projects/:projectId/split", element: <SplitPage /> },
      { path: "projects/:projectId/editor", element: <EditPage /> },
      { path: "projects/:projectId/apis", element: <ApiManagePage /> },
      { path: "projects/:projectId/capabilities", element: <CapabilitiesPage /> },
      { path: "projects/:projectId/specs", element: <SpecsPage /> },
      { path: "projects/:projectId/versions", element: <VersionsPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/projects" replace /> },
]);

installTracking();

// 全局 403 → `EVT_auth_forbidden`（统一无权限态渲染之后；不含对象名）
setForbiddenHandler(({ source_api, resource }) => {
  track("EVT_auth_forbidden", { source_rt: currentRouteRt(), source_api, resource },
    { dedupKey: `403:${source_api}:${resource}`, dedupWindowMs: 3000, immediate: true });
});

/** 浅色 token：**严格取自 `UI-Spec §3.1` 色板**，逐值冻结（改动等于改 Spec） */
const LIGHT_TOKEN = {
  colorPrimary: "#2563EB",        // C-01
  colorPrimaryHover: "#3B82F6",
  colorPrimaryActive: "#1D4ED8",  // C-02
  colorLink: "#2563EB",
  colorInfo: "#2563EB",
  colorText: "#1F2329",           // C-14
  colorTextSecondary: "#4E5969",  // C-15
  colorTextTertiary: "#6B7280",   // C-16
  colorTextQuaternary: "#8A9099", // C-18
  colorBorder: "#E5E7EB",         // C-12
  colorBorderSecondary: "#EEF0F3",// C-13
  colorBgLayout: "#F5F6F8",       // C-09
  borderRadius: 4,                // R-4：输入框 / 按钮 / 小标签
  borderRadiusLG: 8,              // R-8：卡片 / 面板
  fontSize: 14,                   // FS-4
  controlHeight: 32,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
};

/**
 * 深色 token：**不自造一套灰阶**，交给 AntD 的 `darkAlgorithm` 生成，
 * 这里只覆盖「品牌色」与「与浅色共用的尺寸」，其余跟随算法。
 * 品牌色在深底上提亮一档（#2563EB → #3B82F6），与 `styles.css` 的 `--ad-primary` 深色值一致。
 */
const DARK_TOKEN = {
  colorPrimary: "#3B82F6",
  colorPrimaryHover: "#60A5FA",
  colorPrimaryActive: "#2563EB",
  colorLink: "#3B82F6",
  colorInfo: "#3B82F6",
  borderRadius: 4,
  borderRadiusLG: 8,
  fontSize: 14,
  controlHeight: 32,
  fontFamily: LIGHT_TOKEN.fontFamily,
};

const LIGHT_COMPONENTS = {
  Layout: { headerBg: "#FFFFFF", headerHeight: 64, headerPadding: "0 24px", bodyBg: "#F5F6F8" },
  Card: { borderRadiusLG: 8, headerFontSize: 16, colorBorderSecondary: "#E5E7EB" },
  Menu: { itemHeight: 64, horizontalItemSelectedColor: "#2563EB", itemColor: "#1F2329" },
  // 表头用 C-11（表面·次），行悬浮用 C-09
  Table: { headerBg: "#F9FAFB", headerColor: "#4E5969", rowHoverBg: "#F5F6F8" },
  Button: { controlHeight: 32, paddingInline: 16, fontWeight: 500 },
  Modal: { borderRadiusLG: 8 },
  Tag: { borderRadiusSM: 2 },     // R-2：徽标
};

/** 深色下沿用同一套**布局**取值，只把颜色换成暗面（值 = `styles.css` 的深色变量） */
const DARK_COMPONENTS = {
  Layout: { headerBg: "#1D1F23", headerHeight: 64, headerPadding: "0 24px", bodyBg: "#17181A" },
  Card: { borderRadiusLG: 8, headerFontSize: 16 },
  Menu: { itemHeight: 64, horizontalItemSelectedColor: "#3B82F6", itemColor: "#E5E6EB" },
  Table: { headerBg: "#23262B", headerColor: "#A9AEB8", rowHoverBg: "#23262B" },
  Button: { controlHeight: 32, paddingInline: 16, fontWeight: 500 },
  Modal: { borderRadiusLG: 8 },
  Tag: { borderRadiusSM: 2 },
};

/**
 * 根组件：主题状态（浅色 / 深色 / 跟随系统）→ AntD 算法 + 组件色。
 * 自定义样式的换色由 `html[data-ad-theme]` 在 CSS 里完成，这里只管 AntD。
 */
function Root() {
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolvedTheme());
  useEffect(() => subscribeTheme(() => setTheme(resolvedTheme())), []);
  const dark = theme === "dark";
  return (
    <ConfigProvider
      locale={zhCN}
      // 关掉 AntD 对「两个汉字按钮」自动插入的空格：Spec 的按钮文案是逐字冻结的
      // （如 `重试` / `中止` / `保存`），插入后渲染成「重 试」「中 止」，逐字核对必判不通过。
      button={{ autoInsertSpace: false }}
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: dark ? DARK_TOKEN : LIGHT_TOKEN,
        components: dark ? DARK_COMPONENTS : LIGHT_COMPONENTS,
      }}
    >
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  );
}

initTheme(); // 渲染前先落一次（首屏防闪白另见 index.html 的内联脚本）

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
