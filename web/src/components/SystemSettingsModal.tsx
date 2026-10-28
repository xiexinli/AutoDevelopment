/**
 * 系统设置弹窗（顶栏用户菜单 →「系统设置」，与「退出登录」相邻）。
 *
 * 本轮只做**主题**一节（浅色 / 深色 / 跟随系统）—— 形态参照用户给的参考图：
 * 三张等宽卡片，图标在上、名称在下，选中项用主色描边 + 主色浅底。
 *
 * 约定：
 *  - 选择**即时生效并落盘**（`theme.ts`），关掉弹窗不需要「保存」；
 *  - 键盘可达、不只靠颜色表达选中态（`REQ-NF-002`）：用 `role="radiogroup"` +
 *    每张卡 `role="radio"` + `aria-checked`，选中态同时体现在描边、底色与文字色上；
 *  - 文案逐字：`系统设置` / `主题` / `浅色` / `深色` / `跟随系统`。
 */
import { useEffect, useState } from "react";
import { Modal, Typography } from "antd";
import { DesktopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { setThemeMode, storedThemeMode, resolvedTheme, type ThemeMode } from "@/theme";

const OPTIONS: { key: ThemeMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { key: "light", label: "浅色", icon: <SunOutlined style={{ fontSize: 18 }} />, hint: "始终使用浅色界面" },
  { key: "dark", label: "深色", icon: <MoonOutlined style={{ fontSize: 18 }} />, hint: "始终使用深色界面" },
  { key: "system", label: "跟随系统", icon: <DesktopOutlined style={{ fontSize: 18 }} />, hint: "跟随当前系统的浅色/深色设置" },
];

export default function SystemSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<ThemeMode>(() => storedThemeMode());

  // 每次打开都以**当前落盘的取值**为准（其他入口改过主题时也能对齐）
  useEffect(() => { if (open) setMode(storedThemeMode()); }, [open]);

  function pick(next: ThemeMode) {
    setThemeMode(next);   // 即时生效
    setMode(next);        // 立即回显选中态
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      title="系统设置"
      destroyOnClose
      styles={{ body: { padding: "8px 0 4px" } }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Typography.Text style={{ fontSize: 13, color: "var(--ad-text-secondary)" }}>主题</Typography.Text>

        <div role="radiogroup" aria-label="主题" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {OPTIONS.map((o) => {
            const active = mode === o.key;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={o.label}
                title={o.hint}
                onClick={() => pick(o.key)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                  height: 74, cursor: "pointer",
                  borderRadius: "var(--ad-radius-card)",
                  border: `1px solid ${active ? "var(--ad-primary)" : "var(--ad-border)"}`,
                  background: active ? "var(--ad-primary-bg)" : "var(--ad-bg-container)",
                  color: active ? "var(--ad-primary)" : "var(--ad-text)",
                  transition: "border-color var(--ad-transition), background var(--ad-transition), color var(--ad-transition)",
                }}
              >
                {o.icon}
                <span style={{ fontSize: 13 }}>{o.label}</span>
              </button>
            );
          })}
        </div>

        {/* 「跟随系统」时把实际生效的一侧说清楚（深色/浅色由系统决定，不是猜测） */}
        <Typography.Text style={{ fontSize: 12, color: "var(--ad-text-tertiary)" }}>
          {mode === "system"
            ? `当前系统为${resolvedTheme("system") === "dark" ? "深色" : "浅色"}，界面随之切换。`
            : "选择后立即生效。"}
        </Typography.Text>
      </div>
    </Modal>
  );
}
