/**
 * S5 `UI-Spec` → 元素树 —— 「Spec 直出代码」的输入解析（`K1`/`K2`/`K5`）。
 *
 * 依据：`platform/design/接口契约.md §1.8 #43`（生成输入由「页面画布草稿 `tree`」改为
 * 「S5 的 `UI-Spec`（该页面 + 其元素 `EL-*`）」）+ `主流程变更-去拖拽编辑-Spec直出代码-需求提案-v0.1.md`
 * （`K1` = 由平台从 `UI-Spec` 自动解析页面 + 元素 → 生成；`K2` = `EL-*` 由 `UI-Spec` 定义）。
 *
 * 设计原则（与仓库既有风格一致：**确定性、不脑补、无来源不生成**）：
 *  - 只从 `UI-Spec` 的 **§4.x ① 元素清单表** 里读元素（表头逐字 = `| 元素 ID | 元素名 | 类型 | 层级/父元素 | 是否可交互 |`），
 *    其余同名以 `EL-*` 开头的表（§4.x ②交互 / ⑤样式、§5 元素-数据需求表）**一律不当元素来源**，避免张冠李戴；
 *  - 读不到该模块的任一元素 → **报错**（不静默生成空页）；
 *  - 中文「类型」→ 37 项控件白名单 key 用**有序规则**映射，未命中回落 `TEXT`（映射表是确定性资产，见 `TYPE_RULES`）；
 *  - 样式/文案：本期只保证「结构 + 控件类型 + 层级 + 是否可交互」，样式取 `defaultStyle()`（数值必在 `L1` 合法域内），
 *    文案取「元素名」。**不从自由文本猜样式**（避免 `L1` 取值域校验失败）。
 *
 * ⚠️ 本文件是**纯函数适配器**：不读数据库、不发网络、不碰文件系统。调用方（`routes/*`）负责取 `UI-Spec` 正文与落库。
 */
import { createHash } from "node:crypto";
import { ApiError } from "../core/envelope.ts";
import { ANDROID_CLASSES, defaultStyle, normalizeElementId } from "./codegen.ts";

/** 与 `core/editor.Node` **结构等价**的元素节点（此处自带定义以避开 core↔adapters 依赖环）。 */
export interface SpecNode {
  element_id: string; temp_id: string; widget_type: string; alias: string;
  style: Record<string, unknown>; events: Record<string, boolean>; status: string; children: SpecNode[];
}

/**
 * 中文「类型」单元格 → 控件白名单 key。**有序**，先匹配先赢；未命中回落 `TEXT`。
 * 说明：`UI-Spec` 的「类型」列是自由中文（如「主按钮」「多行输入」「空态卡」），
 * 本表把常见词归一到 `ANDROID_CLASSES` 的 37 项；新增词只在此处补，不改解析逻辑。
 */
export const TYPE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/多行输入|多行文本|文本域|备注输入/, "MULTILINE_INPUT"],
  [/密码|密文/, "PASSWORD_INPUT"],
  [/输入框|输入/, "INPUT"],
  [/开关/, "SWITCH"],
  [/勾选框|复选框|多选框|多选/, "CHECK_BOX"],
  [/单选组|单选按钮|双向选择组|单选/, "RADIO_GROUP"],
  [/下拉|选择器|分段控件|分段项/, "SPINNER"],
  [/标签页|选项卡|步骤条|导航/, "TAB_LAYOUT"],
  [/进度条|进度/, "PROGRESS_BAR"],
  [/加载|转圈|loading/i, "LOADING"],
  [/装饰线|分割线|分隔线|divider/i, "DIVIDER"],
  [/列表|表格|grid|网格/i, "LIST"],
  [/图片|图标|头像|二维码|image|avatar/i, "IMAGE"],
  [/卡片|card/i, "CARD"],
  [/容器|区块|面板|分组|浮层|遮罩|弹窗|抽屉|状态条|状态行|骨架块/, "LINEAR_LAYOUT"],
  [/主按钮|次按钮|危险按钮|图标按钮|按钮|链接/, "BUTTON"],
  [/文本|文字|标题|标签|文案|提示|错误|空态|徽标|说明|正文|字段|值|气泡|原文案|项目名/, "TEXT"],
];

/** 去掉 markdown 修饰（反引号 / 加粗）并 trim */
function stripMd(s: string): string {
  return s.replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
}

/** 表格行 → 单元格数组；非表格行返回 `null` */
function splitRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return null;
  return t.slice(1, -1).split("|").map((c) => c.trim());
}

const isSeparator = (cells: string[]) => cells.every((c) => c === "" || /^:?-{2,}:?$/.test(c));

/** 读一张 Markdown 表：`headerMatch` 命中表头后，返回其后所有数据行（表头 + 分隔行已剔除）。 */
function readTable(
  contentMd: string,
  headerMatch: (header: string[]) => boolean,
): string[][] {
  const out: string[][] = [];
  let active = false;
  for (const line of contentMd.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (!cells) { active = false; continue; }
    if (!active) {
      if (headerMatch(cells.map(stripMd))) { active = true; }
      continue;
    }
    if (isSeparator(cells.map(stripMd))) continue;
    out.push(cells);
  }
  return out;
}

/** 尝试把单元格规范化为 `EL-<模块>-<三位>`；不是元素 id → `null` */
function maybeElementId(cell: string): string | null {
  try { return normalizeElementId(stripMd(cell)); } catch { return null; }
}

export function mapWidgetType(cell: string): string {
  const t = stripMd(cell);
  for (const [re, w] of TYPE_RULES) if (re.test(t)) return w;
  return "TEXT"; // 兜底：始终落在一个白名单 key 内
}

export interface UiSpecElement { element_id: string; name: string; widget_type: string; parent: string | null; interactive: boolean }

/** **§4.x ① 元素清单表** → 元素行（全站，不区分模块；表头逐字对齐 `templates/UI-Spec.md` §4.1）。 */
export function uiSpecElements(contentMd: string): UiSpecElement[] {
  const rows = readTable(contentMd, (h) => h[0] === "元素 ID" && h[1] === "元素名" && h[2] === "类型");
  const out: UiSpecElement[] = [];
  const seen = new Set<string>();
  for (const cells of rows) {
    const id = maybeElementId(cells[0] ?? "");
    if (!id || seen.has(id)) continue; // 同一元素在多页复述时只取首次定义
    seen.add(id);
    out.push({
      element_id: id,
      name: stripMd(cells[1] ?? ""),
      widget_type: mapWidgetType(cells[2] ?? ""),
      parent: maybeElementId(cells[3] ?? ""),
      interactive: /^(是|可点击|是（|是 )/.test(stripMd(cells[4] ?? "")),
    });
  }
  return out;
}

/** **§2 页面清单表** → 页面（`module_code` 取页面 id 的模块段）。用于把 `tbl_page` 对齐到 `UI-Spec`。 */
export function uiSpecPages(contentMd: string): { module_code: string; name: string }[] {
  const rows = readTable(contentMd, (h) => h[0] === "页面 ID" && h[1] === "页面名");
  const out: { module_code: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const cells of rows) {
    const m = /^UI-([A-Z0-9_]+)-\d{1,4}$/i.exec(stripMd(cells[0] ?? ""));
    if (!m) continue;
    const mod = m[1]!.toUpperCase();
    if (seen.has(mod)) continue;
    seen.add(mod);
    out.push({ module_code: mod, name: stripMd(cells[1] ?? "") || mod });
  }
  return out;
}

/** 该 `UI-Spec` 正文里出现过的所有元素模块段（去重，保序）。 */
export function uiSpecModules(contentMd: string): string[] {
  const mods: string[] = [];
  for (const e of uiSpecElements(contentMd)) {
    const m = /^EL-([A-Z0-9_]+)-\d+$/.exec(e.element_id);
    if (m && !mods.includes(m[1]!)) mods.push(m[1]!);
  }
  return mods;
}

/**
 * 把 `UI-Spec` 正文解析为该 `moduleCode` 页面的元素树。
 * 读不到该模块任一元素 → `INVALID_ARGUMENT`（不静默生成空页）。
 * 结构：父 id 在同模块内则挂为其子；父缺失/跨模块 → 视为根；检测环与重复（确定性，不做无限递归）。
 */
export function parseUiSpec(contentMd: string, moduleCode: string): SpecNode[] {
  const mod = moduleCode.toUpperCase();
  const prefix = `EL-${mod}-`;
  const rows = uiSpecElements(contentMd).filter((e) => e.element_id.startsWith(prefix));
  if (!rows.length) throw new ApiError("INVALID_ARGUMENT", `UI-Spec 里没有页面模块 ${mod} 的元素（${prefix}*），先生成 / 补全 S5 的 UI-Spec。`);

  const byId = new Map(rows.map((e) => [e.element_id, e]));
  const childrenOf = new Map<string, UiSpecElement[]>();
  const isRoot = new Map<string, boolean>();
  for (const e of rows) {
    const parent = e.parent && byId.has(e.parent) ? e.parent : null;
    if (!parent) { isRoot.set(e.element_id, true); continue; }
    const list = childrenOf.get(parent) ?? [];
    list.push(e); childrenOf.set(parent, list);
  }

  const built = new Set<string>();
  const build = (e: UiSpecElement, depth: number): SpecNode => {
    if (depth > 200) throw new ApiError("INVALID_ARGUMENT", "UI-Spec 元素层级超过上限。");
    if (built.has(e.element_id)) throw new ApiError("INVALID_ARGUMENT", `UI-Spec 元素出现环：${e.element_id}。`);
    built.add(e.element_id);
    const children = (childrenOf.get(e.element_id) ?? []).map((c) => build(c, depth + 1));
    return {
      element_id: e.element_id, temp_id: e.element_id, widget_type: e.widget_type,
      alias: e.name, style: defaultStyle(),
      events: { click: e.interactive, long_press: false, double_click: false },
      status: "active", children,
    };
  };

  const tree: SpecNode[] = [];
  for (const e of rows) if (isRoot.get(e.element_id)) tree.push(build(e, 0));
  // 环里的元素既非根也不可达 → 兜底为根，避免静默丢元素（此时 `build` 会因环而报错，宁可失败也不产半页）。
  for (const e of rows) if (!built.has(e.element_id)) tree.push(build(e, 0));

  // 白名单兜底校验：任何时候都不得产出白名单外的控件（与 `codegen.activeNodes` 同口径）。
  for (const e of rows) if (!Object.hasOwn(ANDROID_CLASSES, e.widget_type)) throw new ApiError("INVALID_ARGUMENT", `UI-Spec 控件类型无法映射到白名单：${e.name || e.element_id}。`);
  return tree;
}

/**
 * `#43` 输入快照的规范化哈希：= `UI-Spec` 中该页面的**规范结构**（模块 + 页面名 + 元素 id/控件类型/别名/层级）
 * 的 SHA-256。**元素顺序与子节点顺序均参与**（保序），字段固定 → 同一 Spec 恒得同一哈希。
 */
export function uiSpecInputHash(moduleCode: string, pageName: string, tree: SpecNode[]): string {
  const norm = (n: SpecNode): unknown => [n.element_id, n.widget_type, n.alias, n.children.map(norm)];
  const payload = JSON.stringify({ module_code: moduleCode.toUpperCase(), page_name: pageName, elements: tree.map(norm) });
  return createHash("sha256").update(payload).digest("hex");
}
