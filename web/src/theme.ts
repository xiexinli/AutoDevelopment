/**
 * 主题：**浅色 / 深色 / 跟随系统**（系统设置 → 主题）。
 *
 * 单一事实来源：把选择写进 `<html data-ad-theme="light|dark">`，
 *   - 自定义样式在 `styles.css` 里**只换变量**（`html[data-ad-theme="dark"]` 覆盖 `--ad-*`）；
 *   - AntD 由 `main.tsx` 按同一状态切 `theme.darkAlgorithm`。
 * 这样主题不需要逐组件传参，也不会出现「组件换色了、AntD 没换」的半深半浅。
 *
 * 「跟随系统」= 读 `prefers-color-scheme`，**并监听系统切换**（macOS 日落自动切换时页面跟着变）。
 * 选择存 `localStorage['ad.theme']`；首屏防闪白由 `index.html` 里的内联脚本负责（先于任何 JS 生效）。
 */
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "ad.theme";
const listeners = new Set<() => void>();
let media: MediaQueryList | null = null;

function isMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark" || v === "system";
}

/** 已保存的选择；没存过 / 值非法 → **跟随系统**（与系统设置弹窗里的默认选中一致） */
export function storedThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isMode(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** 选择 → 实际生效的主题（`system` 时由系统决定） */
export function resolvedTheme(mode: ThemeMode = storedThemeMode()): ResolvedTheme {
  if (mode !== "system") return mode;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** 应用到 `<html>`（唯一入口；`index.html` 内联脚本按同样规则先跑一次防闪白） */
export function applyTheme(mode: ThemeMode = storedThemeMode()): ResolvedTheme {
  const theme = resolvedTheme(mode);
  const el = document.documentElement;
  el.dataset.adTheme = theme;
  el.style.colorScheme = theme;   // 原生控件 / 滚动条跟着变
  return theme;
}

/** 保存选择并立即生效（弹窗里点卡片时调用） */
export function setThemeMode(mode: ThemeMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* 隐私模式下忽略 */ }
  applyTheme(mode);
  listeners.forEach((fn) => { try { fn(); } catch { /* 一个订阅者不影响其他 */ } });
}

/** 订阅「生效主题发生变化」（含跟随系统时系统自身切换） */
export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  if (!media && typeof window !== "undefined" && window.matchMedia) {
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      // 系统切换：只有「跟随系统」时才影响页面（其余模式忽略）
      media.addEventListener("change", () => {
        if (storedThemeMode() !== "system") return;
        applyTheme("system");
        listeners.forEach((f) => { try { f(); } catch { /* ignore */ } });
      });
    } catch { media = null; }
  }
  return () => listeners.delete(fn);
}

/** 启动时应用一次（`main.tsx` 在渲染前调用） */
export function initTheme(): ResolvedTheme {
  return applyTheme(storedThemeMode());
}
