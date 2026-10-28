/**
 * 编辑器数据模型 —— 对齐 `platform/design/数据模型.md` 的 `E6 Element` / `E7 StyleProps` / `E8 ElementEvent`。
 *
 * 关键契约：
 * - 元素 id 规则 `EL-<模块>-<三位>`，**项目内全局唯一、不可复用、不可回收**；展示一律归一化大写零填充。
 * - 属性面板 **11 行**（以 `§F14` 为准；宽/高合并为一行），落到 `E7` 为 **13 个字段**。
 * - 事件 3 项（点击/长按/双击）**可并存**；本期只生成**空回调存根**，`action_type` 只取 `none`。
 * - 改值 → **画布即时生效（本地）**，**不触发代码生成**；只有「提交变更」才入队生成。
 * - 非法输入 → 字段级红框 + 气泡，**已输入内容全部保留**。
 */

export type SizeMode = "dp" | "wrap" | "match";
export interface Dim { mode: SizeMode; value: number | null }

export type EventKind = "click" | "long_press" | "double_click";
export const EVENT_LABEL: Record<EventKind, string> = {
  click: "点击", long_press: "长按", double_click: "双击",
};

export interface StyleProps {
  width: Dim;          // E7.width
  height: Dim;         // E7.height
  background: string;  // #RRGGBB
  font_color: string;
  font_size: number;   // sp，8~72
  padding: { top: number; right: number; bottom: number; left: number };
  margin: { top: number; right: number; bottom: number; left: number };
  radius: number;      // 0~200
  border: { width_dp: number; color: string; style: "solid" | "dashed" | "dotted" };
  alpha: number;       // 0~100
  align_h: "left" | "center" | "right";
  align_v: "top" | "center" | "bottom";
  visibility: "visible" | "invisible" | "gone";
}

export interface ElementNode {
  /** 服务端分配后的正式 id；未提交前为 null（客户端只持临时 id） */
  element_id: string | null;
  /** 客户端临时 id（仅本地使用，不落库） */
  temp_id: string;
  widget_type: string;
  alias: string;
  children: ElementNode[];
  style: StyleProps;
  events: Record<EventKind, boolean>;
  status: "active" | "void";
}

// ---------- 校验（文案逐字取自 `UI-Spec §4.8 ④`） ----------
export const VALIDATION_COPY = {
  width: "宽只能是 1~2000dp，或选「自适应 / 撑满」。",
  height: "高只能是 1~2000dp，或选「自适应 / 撑满」。",
  font_size: "字体大小只能是 8~72sp。",
  padding: "内边距只能是 0~200dp。",
  radius: "圆角只能是 0~200。",
  border_width: "边框线宽只能是 0~10dp。",
  alpha: "透明度只能是 0~100。",
  color: "色值只能是 #RRGGBB 六位。",
  negative: "这里不能填负数。",
} as const;

export type FieldKey = keyof typeof VALIDATION_COPY;

export function validateDim(d: Dim): string | null {
  if (d.mode !== "dp") return null;
  if (d.value === null) return null;
  if (d.value < 0) return VALIDATION_COPY.negative;
  if (d.value < 1 || d.value > 2000) return null; // 由调用方决定用 width/height 文案
  return null;
}
export function validateNumber(v: number, kind: FieldKey): string | null {
  if (Number.isNaN(v)) return VALIDATION_COPY[kind];
  if (v < 0) return VALIDATION_COPY.negative;
  switch (kind) {
    case "font_size": return v >= 8 && v <= 72 ? null : VALIDATION_COPY.font_size;
    case "padding": return v >= 0 && v <= 200 ? null : VALIDATION_COPY.padding;
    case "radius": return v >= 0 && v <= 200 ? null : VALIDATION_COPY.radius;
    case "border_width": return v >= 0 && v <= 10 ? null : VALIDATION_COPY.border_width;
    case "alpha": return v >= 0 && v <= 100 ? null : VALIDATION_COPY.alpha;
    default: return null;
  }
}
export function validateColor(v: string): string | null {
  return /^#[0-9a-fA-F]{6}$/.test(v) ? null : VALIDATION_COPY.color;
}

// ---------- 默认值 ----------
export function defaultStyle(w?: number | "wrap" | "match", h?: number | "wrap" | "match"): StyleProps {
  const dim = (v?: number | "wrap" | "match"): Dim =>
    v === "wrap" ? { mode: "wrap", value: null }
    : v === "match" ? { mode: "match", value: null }
    : { mode: "dp", value: typeof v === "number" ? v : 40 };
  return {
    width: dim(w), height: dim(h),
    background: "#FFFFFF", font_color: "#1F2329", font_size: 14,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 8, left: 0 },
    radius: 0,
    border: { width_dp: 0, color: "#E5E7EB", style: "solid" },
    alpha: 100, align_h: "left", align_v: "top", visibility: "visible",
  };
}

let seq = 0;
export function newTempId(): string {
  seq += 1;
  return `tmp_${Date.now().toString(36)}_${seq}`;
}

export function newNode(widgetType: string, w?: number | "wrap" | "match", h?: number | "wrap" | "match"): ElementNode {
  return {
    element_id: null, temp_id: newTempId(), widget_type: widgetType, alias: "",
    children: [], style: defaultStyle(w, h), events: { click: false, long_press: false, double_click: false },
    status: "active",
  };
}

// ---------- 树操作 ----------
export function walk(nodes: ElementNode[], fn: (n: ElementNode, parent: ElementNode | null) => void, parent: ElementNode | null = null) {
  for (const n of nodes) { fn(n, parent); walk(n.children, fn, n); }
}
export function countNodes(nodes: ElementNode[]): number {
  let c = 0; walk(nodes, () => { c += 1; }); return c;
}
export function findNode(nodes: ElementNode[], tempId: string): ElementNode | null {
  let hit: ElementNode | null = null;
  walk(nodes, (n) => { if (n.temp_id === tempId) hit = n; });
  return hit;
}
export function removeNode(nodes: ElementNode[], tempId: string): ElementNode[] {
  return nodes
    .filter((n) => n.temp_id !== tempId)
    .map((n) => ({ ...n, children: removeNode(n.children, tempId) }));
}
export function insertInto(nodes: ElementNode[], parentTempId: string | null, node: ElementNode): ElementNode[] {
  if (parentTempId === null) return [...nodes, node];
  return nodes.map((n) =>
    n.temp_id === parentTempId
      ? { ...n, children: [...n.children, node] }
      : { ...n, children: insertInto(n.children, parentTempId, node) });
}

/** id 归一化（`D-A2`）：`el-home-1` 与 `EL-HOME-001` 视为同一元素 */
export function normalizeElementId(raw: string): string {
  const m = raw.trim().match(/^([A-Za-z]+)-([A-Za-z]+)-(\d+)$/);
  if (!m) return raw.trim().toUpperCase();
  return `EL-${m[1].toUpperCase()}-${m[2].toUpperCase()}-${String(Number(m[3])).padStart(3, "0")}`;
}
