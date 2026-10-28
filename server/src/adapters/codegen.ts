/** B3 code generation only. No Feishu credentials, server builds, or source/secret logging. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { ApiError } from "../core/envelope.ts";

export interface CodeFile { path: string; kind: string; content: string; encoding?: 'base64' }
export interface CodegenInput { tree: any[]; pageName: string; moduleCode: string; capabilities?: string[] }

/**
 * **能真实产出可编译代码**的能力：只用 Android 平台 API 实现，不引入任何第三方 SDK、不采集任何密钥。
 * 其余能力（`push` / `apm` / `stats_sdk` / `hardening`）必须绑定具体厂商与 SDK 坐标，
 * 没有厂商决策就不能凭空生成 —— 它们**不会**产出代码，保持现状（见 `reviews/B5-真实上游接入验收记录.md §8`）。
 */
export const REAL_CAPABILITY_GENERATORS = new Set(["privacy_dialog", "crash_report", "log_report"]);
export interface CodegenAdapter {
  kind: 'development' | 'real' | 'unconfigured';
  generate(input: CodegenInput, signal: AbortSignal): Promise<CodeFile[]>;
}

export const ANDROID_CLASSES: Readonly<Record<string, string>> = Object.freeze({
  TEXT: "TextView", MULTILINE_TEXT: "TextView", RICH_TEXT: "TextView", LABEL: "TextView",
  BUTTON: "Button", INPUT: "EditText", MULTILINE_INPUT: "EditText", PASSWORD_INPUT: "EditText",
  SEARCH_BOX: "SearchView", IMAGE: "ImageView", AVATAR: "ImageView", VIDEO: "VideoView",
  LINEAR_LAYOUT: "LinearLayout", CONSTRAINT_LAYOUT: "androidx.constraintlayout.widget.ConstraintLayout",
  RELATIVE_LAYOUT: "RelativeLayout", SCROLL_VIEW: "ScrollView", CARD: "androidx.cardview.widget.CardView",
  LIST: "androidx.recyclerview.widget.RecyclerView", GRID: "GridView", BANNER: "androidx.viewpager2.widget.ViewPager2",
  RADIO_BUTTON: "RadioButton", CHECK_BOX: "CheckBox", RADIO_GROUP: "RadioGroup", CHECK_GROUP: "LinearLayout",
  SWITCH: "Switch", SPINNER: "Spinner", SEEKBAR: "SeekBar", RATING_BAR: "RatingBar",
  DATE_PICKER: "DatePicker", TIME_PICKER: "TimePicker", PROGRESS_BAR: "ProgressBar", LOADING: "ProgressBar",
  TOOLBAR: "Toolbar", BOTTOM_NAV: "com.google.android.material.bottomnavigation.BottomNavigationView",
  TAB_LAYOUT: "com.google.android.material.tabs.TabLayout", DIVIDER: "View", SPACE: "Space",
});
export const WRAPPER_JAR_SHA256 = "498495120a03b9a6ab5d155f5de3c8f0d986a449153702fb80fc80e134484f17";
export const WRAPPER_SHA256: Readonly<Record<string, string>> = Object.freeze({
  "gradlew": "9cbbb4d68ff7fb5211c4d58f598ac9d8664c05fdcd1e5f59b7f2c3ac1ee00af0",
  "gradlew.bat": "0f3ed8f03b50934cb8c48b15a470d5c20a30a5385825e48b55bcc8ea3d8f8e18",
  "gradle/wrapper/gradle-wrapper.jar": WRAPPER_JAR_SHA256,
  "gradle/wrapper/gradle-wrapper.properties": "4c2158e858a54c55c5f8a2b508242b22b99f6fb6b6ffdee12131e9f1be116cff",
});
const CONTAINERS = new Set(["LINEAR_LAYOUT", "CONSTRAINT_LAYOUT", "RELATIVE_LAYOUT", "SCROLL_VIEW", "CARD", "LIST", "GRID", "BANNER", "RADIO_GROUP", "CHECK_GROUP", "TOOLBAR", "TAB_LAYOUT"]);
const ADAPTER_CONTAINERS = new Set(["LIST", "GRID", "BANNER", "TAB_LAYOUT"]);
const TEXT_WIDGETS = new Set(["TEXT", "MULTILINE_TEXT", "RICH_TEXT", "LABEL", "BUTTON", "INPUT", "MULTILINE_INPUT", "PASSWORD_INPUT", "RADIO_BUTTON", "CHECK_BOX", "SWITCH"]);
const MAX_BYTES = 20 * 1024 * 1024;

export function normalizeElementId(value: unknown): string {
  if (typeof value !== "string") throw new ApiError("INVALID_ARGUMENT", "元素必须使用服务端正式 element_id。");
  const m = /^EL-([A-Z][A-Z0-9_]*)-(\d{1,4})$/i.exec(value.trim());
  if (!m || Number(m[2]) < 1 || value.trim().length > 24) throw new ApiError("INVALID_ARGUMENT", "element_id 格式不正确。");
  return `EL-${m[1]!.toUpperCase()}-${String(Number(m[2])).padStart(3, "0")}`;
}
export function androidId(value: unknown): string { return normalizeElementId(value).toLowerCase().replace(/-/g, "_"); }

/** Active tree only; a void parent voids its subtree. Bounds also reject cycles without recursive stack overflow. */
export function activeNodes(tree: any[]): any[] {
  if (!Array.isArray(tree)) throw new ApiError("INVALID_ARGUMENT", "tree 必须为数组。");
  const result: any[] = [], seen = new Set<object>(), ids = new Set<string>();
  const visit = (nodes: any[], depth: number) => {
    if (depth > 200) throw new ApiError("INVALID_ARGUMENT", "元素树层级超过上限。");
    for (const n of nodes) {
      if (!n || typeof n !== "object" || Array.isArray(n) || seen.has(n)) throw new ApiError("INVALID_ARGUMENT", "元素树包含无效节点或循环。");
      seen.add(n);
      if (n.status === "void") continue;
      if (n.status !== undefined && n.status !== "active") throw new ApiError("INVALID_ARGUMENT", "元素状态不正确。");
      const id = normalizeElementId(n.element_id);
      if (ids.has(id)) throw new ApiError("INVALID_ARGUMENT", "element_id 归一化后重复。");
      ids.add(id); result.push(n);
      if (result.length > 200) throw new ApiError("INVALID_ARGUMENT", "单页元素不得超过 200 个。");
      if (!Object.hasOwn(ANDROID_CLASSES, n.widget_type)) throw new ApiError("INVALID_ARGUMENT", "控件类型不在 37 项白名单中。");
      if (n.children !== undefined && !Array.isArray(n.children)) throw new ApiError("INVALID_ARGUMENT", "children 必须为数组。");
      const children = (n.children ?? []).filter((c: any) => c?.status !== "void");
      if (children.length && !CONTAINERS.has(n.widget_type)) throw new ApiError("INVALID_ARGUMENT", "非容器控件不能包含子元素。");
      if (n.widget_type === "SCROLL_VIEW" && children.length > 1) throw new ApiError("INVALID_ARGUMENT", "ScrollView 只能有一个直接子元素。");
      if (["RADIO_GROUP", "CHECK_GROUP"].includes(n.widget_type) && children.some((c: any) => c.widget_type !== (n.widget_type === "RADIO_GROUP" ? "RADIO_BUTTON" : "CHECK_BOX")))
        throw new ApiError("INVALID_ARGUMENT", "选择组子元素类型不正确。");
      visit(n.children ?? [], depth + 1);
    }
  };
  visit(tree, 0); return result;
}

/** UI aliases and E7 canonical field names are both accepted. Invalid values never get clamped. */
export function checkedStyle(node: any): any {
  const s = node.style;
  const bad = (field: string): never => { throw new ApiError("INVALID_ARGUMENT", "样式字段取值不正确。", { element_id: normalizeElementId(node.element_id), field }); };
  if (!s || typeof s !== "object" || Array.isArray(s)) bad("style");
  const integer = (v: any, min: number, max: number, f: string) => {
    if (!Number.isInteger(v) || v < min || v > max) bad(f); return v;
  };
  const color = (v: any, f: string) => {
    if (typeof v !== "string" || !/^#?[0-9a-f]{6}$/i.test(v)) bad(f);
    return "#" + v.replace(/^#/, "").toUpperCase();
  };
  const dim = (v: any, f: string) => {
    if (!v || typeof v !== "object") bad(f);
    const mode = ({ wrap: "wrap_content", match: "match_parent" } as Record<string, string>)[v.mode] ?? v.mode;
    if (mode === "dp") return { mode, value: integer(v.value, 1, 2000, f) };
    if (!["wrap_content", "match_parent"].includes(mode) || v.value !== null) bad(f);
    return { mode, value: null };
  };
  const edges = (v: any, f: string) => {
    v ??= { top: 0, right: 0, bottom: 0, left: 0 };
    const out: Record<string, number> = {};
    for (const side of ["top", "right", "bottom", "left"]) out[side] = integer(v[side], 0, 200, `${f}.${side}`);
    return out;
  };
  const choice = (v: any, values: string[], f: string) => { if (!values.includes(v)) bad(f); return v; };
  const b = s.border ?? { width_dp: 0, color: "#D9D9D9", style: "solid" };
  return {
    width: dim(s.width, "width"), height: dim(s.height, "height"),
    background: color(s.background_color ?? s.background ?? "#FFFFFF", "background_color"),
    font_color: color(s.text_color ?? s.font_color ?? "#1F2329", "text_color"),
    font_size: integer(s.text_size_sp ?? s.font_size ?? 14, 8, 72, "text_size_sp"),
    padding: edges(s.padding, "padding"), margin: edges(s.margin, "margin"),
    radius: integer(s.corner_radius_dp ?? s.radius ?? 0, 0, 200, "corner_radius_dp"),
    border: { width_dp: integer(b.width_dp, 0, 10, "border.width_dp"), color: color(b.color, "border.color"), style: choice(b.style, ["solid", "dashed", "dotted"], "border.style") },
    alpha: integer(s.alpha ?? 100, 0, 100, "alpha"),
    align_h: choice(s.align_h ?? "left", ["left", "center", "right"], "align_h"),
    align_v: choice(s.align_v ?? "top", ["top", "center", "bottom"], "align_v"),
    visibility: choice(s.visibility ?? "visible", ["visible", "invisible", "gone"], "visibility"),
  };
}

/** Portable relative paths only; reject traversal, Windows aliases, case collisions and oversized payloads. */
export function validateCodeFiles(value: unknown): CodeFile[] {
  const fail = (): never => { throw new ApiError("UPSTREAM_UNAVAILABLE", "代码产物结构、编码或路径不合法；未应用结果。"); };
  if (!Array.isArray(value) || !value.length || value.length > 1024) fail();
  const paths = new Set<string>(); let bytes = 0;
  return (value as any[]).map(f => {
    if (!f || typeof f !== "object" || typeof f.path !== "string" || typeof f.kind !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(f.kind) || typeof f.content !== "string") fail();
    if (f.encoding !== undefined && f.encoding !== "base64") fail();
    if (!f.path || f.path.length > 240 || !/^[A-Za-z0-9_./-]+$/.test(f.path) || f.path.startsWith("/") || f.path.split("/").some((p: string) => !p || p === "." || p === ".." || p.endsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail();
    const key = f.path.toLowerCase(); if (paths.has(key)) fail(); paths.add(key);
    if (f.encoding === "base64" && (!f.content.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.content) || Buffer.from(f.content, "base64").toString("base64") !== f.content)) fail();
    if (f.encoding !== "base64" && f.content.includes("\0")) fail();
    bytes += Buffer.byteLength(f.content); if (bytes > MAX_BYTES) fail();
    return f.encoding === "base64" ? { path: f.path, kind: f.kind, content: f.content, encoding: "base64" } : { path: f.path, kind: f.kind, content: f.content };
  });
}

function checkInput(input: CodegenInput): any[] {
  if (!input || typeof input.pageName !== "string" || !input.pageName.trim() || input.pageName.length > 100 || typeof input.moduleCode !== "string" || !/^[A-Z][A-Z0-9_]{0,19}$/i.test(input.moduleCode)) throw new ApiError("INVALID_ARGUMENT", "页面名或模块代码不正确。");
  const nodes = activeNodes(input.tree);
  for (const n of nodes) {
    if (!normalizeElementId(n.element_id).startsWith(`EL-${input.moduleCode.toUpperCase()}-`)) throw new ApiError("INVALID_ARGUMENT", "element_id 与 moduleCode 不一致。");
    checkedStyle(n); eventFlags(n);
  }
  return nodes;
}
function eventFlags(n: any): Set<string> {
  const flags = new Set<string>();
  const enable = (key: string, action = "none") => {
    key = key === "long_press" || key === "long_click" ? "long_click" : key;
    if (!["click", "long_click", "double_click"].includes(key) || action !== "none" || flags.has(key)) throw new ApiError("INVALID_ARGUMENT", "本期仅支持三类事件的 none 空回调。");
    flags.add(key);
  };
  if (Array.isArray(n.events)) for (const e of n.events) { if (!e || typeof e !== "object") throw new ApiError("INVALID_ARGUMENT", "事件格式不正确。"); enable(e.event_type, e.action_type ?? "none"); }
  else if (n.events !== undefined) {
    if (!n.events || typeof n.events !== "object") throw new ApiError("INVALID_ARGUMENT", "事件格式不正确。");
    for (const [k, v] of Object.entries(n.events)) { if (typeof v !== "boolean") throw new ApiError("INVALID_ARGUMENT", "事件开关必须为布尔值。"); if (v) enable(k); else if (!["click", "long_press", "long_click", "double_click"].includes(k)) throw new ApiError("INVALID_ARGUMENT", "未知事件。"); }
  }
  return flags;
}
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const stringValue = (s: string) => escapeXml(s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/^([@?])/, "\\$1"));
const dimValue = (d: any) => d.mode === "dp" ? `${d.value}dp` : d.mode;
const attr = (k: string, v: string | number) => ` ${k}="${escapeXml(String(v))}"`;

/**
 * 能力接入代码（**真实实现**）：只用 Android 平台 API。
 * 隐私弹窗负责在用户同意前挡住其它采集能力；崩溃与日志都写 App 私有目录，上报通道由使用方自行接入。
 */
function capabilityBootstrapKotlin(caps: Set<string>): string {
  const parts: string[] = [
    "package com.autodevelopment.generated",
    "",
    "import android.app.Activity",
    "import android.app.AlertDialog",
    "import android.content.Context",
    "import java.io.File",
    "import java.io.PrintWriter",
    "import java.io.StringWriter",
    "import java.text.SimpleDateFormat",
    "import java.util.Date",
    "import java.util.Locale",
    "",
    "/**",
    " * 由 AutoDevelopment 生成的能力接入代码。",
    " * 只用 Android 平台 API：不引入第三方 SDK，也不包含、不采集任何密钥。",
    " * 需要厂商 SDK 的能力（推送 / 性能采集 / 统计 / 加固）不在此文件内，请按厂商文档自行接入。",
    " */",
    "object CapabilityBootstrap {",
    "",
    '    private const val PREFS = "autodevelopment_privacy"',
    '    private const val KEY_ACCEPTED = "accepted"',
    '    private const val LOG_FILE = "runtime.log"',
    "    private const val LOG_MAX_BYTES = 262144L",
    "",
  ];
  if (caps.has("privacy_dialog")) parts.push(
    "    /** 隐私合规：用户同意之前，不得初始化任何采集或上报能力。 */",
    "    fun ensureConsent(activity: Activity, onReady: () -> Unit) {",
    "        val sp = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)",
    "        if (sp.getBoolean(KEY_ACCEPTED, false)) {",
    "            onReady()",
    "            return",
    "        }",
    "        AlertDialog.Builder(activity)",
    '            .setTitle("隐私政策")',
    '            .setMessage("为保障你的权益，请阅读并同意《隐私政策》后再继续使用。")',
    "            .setCancelable(false)",
    '            .setPositiveButton("同意并继续") { _, _ ->',
    "                sp.edit().putBoolean(KEY_ACCEPTED, true).apply()",
    "                onReady()",
    "            }",
    '            .setNegativeButton("不同意") { _, _ -> activity.finish() }',
    "            .show()",
    "    }",
    "",
  );
  if (caps.has("crash_report")) parts.push(
    "    /** 崩溃捕获（本地实现）：拦截未处理异常并落盘，供下次启动上传到你的通道。 */",
    "    fun installCrashHandler(context: Context) {",
    '        val dir = File(context.filesDir, "crash")',
    "        if (!dir.exists()) dir.mkdirs()",
    "        val previous = Thread.getDefaultUncaughtExceptionHandler()",
    "        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->",
    "            try {",
    "                val sw = StringWriter()",
    "                throwable.printStackTrace(PrintWriter(sw))",
    '                val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())',
    '                File(dir, "crash-" + stamp + ".log")',
    '                    .writeText("thread=" + thread.name + "\\n" + sw.toString())',
    "            } catch (ignored: Throwable) {",
    "            }",
    "            previous?.uncaughtException(thread, throwable)",
    "        }",
    "    }",
    "",
  );
  if (caps.has("log_report")) parts.push(
    "    /** 运行日志（本地实现）：写入 App 私有目录，超出上限自动轮转；上报由你接自己的通道。 */",
    "    @Synchronized",
    "    fun logLine(context: Context, line: String) {",
    "        try {",
    "            val f = File(context.filesDir, LOG_FILE)",
    "            if (f.exists() && f.length() > LOG_MAX_BYTES) f.delete()",
    '            val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())',
    '            f.appendText(stamp + " " + line + "\\n")',
    "        } catch (ignored: Throwable) {",
    "        }",
    "    }",
    "",
  );
  parts.push("}", "");
  return parts.join("\n");
}

async function generateDevelopment(input: CodegenInput, signal: AbortSignal): Promise<CodeFile[]> {
  signal.throwIfAborted(); const nodes = checkInput(input);
  for (const n of nodes) if (ADAPTER_CONTAINERS.has(n.widget_type) && n.children?.some((c: any) => c.status !== "void")) throw new ApiError("FORMAT_UNSUPPORTED", "开发生成器暂不支持列表/网格/轮播 item 模板或标签页子元素；不会静默丢弃。");
  const files: CodeFile[] = [], strings: string[] = [`  <string name="app_name">${stringValue(input.pageName)}</string>`];
  const add = (path: string, content: string, kind = path.endsWith(".xml") ? "xml" : "text") => files.push({ path, kind, content });
  const emit = (n: any, parent: any, previous: any, depth: number): string => {
    const id = androidId(n.element_id), s = checkedStyle(n), type = n.widget_type, tag = ANDROID_CLASSES[type]!;
    let a = attr("android:id", `@+id/${id}`) + attr("android:tag", normalizeElementId(n.element_id)) + attr("android:layout_width", dimValue(s.width)) + attr("android:layout_height", dimValue(s.height));
    a += attr("android:alpha", s.alpha / 100) + attr("android:visibility", s.visibility);
    for (const side of ["top", "right", "bottom", "left"]) {
      const cap = side[0]!.toUpperCase() + side.slice(1);
      a += attr(`android:padding${cap}`, `${s.padding[side]}dp`) + attr(`android:layout_margin${cap}`, `${s.margin[side]}dp`);
    }
    const gravity = `${s.align_h === "center" ? "center_horizontal" : s.align_h}|${s.align_v === "center" ? "center_vertical" : s.align_v}`;
    a += attr("android:layout_gravity", gravity);
    if (TEXT_WIDGETS.has(type) || ["LINEAR_LAYOUT", "CHECK_GROUP", "RADIO_GROUP"].includes(type)) a += attr("android:gravity", gravity);
    if (type === "CARD") a += attr("app:cardCornerRadius", `${s.radius}dp`) + attr("app:cardBackgroundColor", s.background);
    else {
      a += attr("android:background", `@drawable/bg_${id}`);
      const dash = s.border.style === "solid" ? "" : ` android:dashWidth="${s.border.style === "dotted" ? 1 : 4}dp" android:dashGap="3dp"`;
      add(`app/src/main/res/drawable/bg_${id}.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="${s.background}"/><corners android:radius="${s.radius}dp"/><stroke android:width="${s.border.width_dp}dp" android:color="${s.border.color}"${dash}/></shape>\n`);
    }
    if (TEXT_WIDGETS.has(type)) {
      const text = String(n.text ?? n.alias ?? ""); if (text.length > 10000) throw new ApiError("INVALID_ARGUMENT", "元素文案过长。");
      strings.push(`  <string name="text_${id}">${stringValue(text)}</string>`);
      a += attr(type.includes("INPUT") ? "android:hint" : "android:text", `@string/text_${id}`) + attr("android:textColor", s.font_color) + attr("android:textSize", `${s.font_size}sp`);
    }
    if (type === "LABEL") a += attr("android:singleLine", "true");
    if (type === "MULTILINE_TEXT") a += attr("android:singleLine", "false");
    if (type === "INPUT") a += attr("android:inputType", "text");
    if (type === "MULTILINE_INPUT") a += attr("android:inputType", "textMultiLine");
    if (type === "PASSWORD_INPUT") a += attr("android:inputType", "textPassword");
    if (["LINEAR_LAYOUT", "CHECK_GROUP", "RADIO_GROUP"].includes(type)) a += attr("android:orientation", "vertical");
    if (type === "PROGRESS_BAR") a += attr("style", "?android:attr/progressBarStyleHorizontal");
    if (type === "LOADING") a += attr("android:indeterminate", "true");
    if (["IMAGE", "AVATAR"].includes(type)) a += attr("android:scaleType", "centerCrop");
    if (parent?.widget_type === "CONSTRAINT_LAYOUT") {
      a += attr("app:layout_constraintStart_toStartOf", "parent") + attr(previous ? "app:layout_constraintTop_toBottomOf" : "app:layout_constraintTop_toTopOf", previous ? `@id/${androidId(previous.element_id)}` : "parent");
    }
    if (parent?.widget_type === "RELATIVE_LAYOUT" && previous) a += attr("android:layout_below", `@id/${androidId(previous.element_id)}`);
    const pad = "  ".repeat(depth), children = (n.children ?? []).filter((c: any) => c.status !== "void");
    if (!children.length) return `${pad}<${tag}${a}/>\n`;
    return `${pad}<${tag}${a}>\n${children.map((c: any, i: number) => emit(c, n, children[i - 1], depth + 1)).join("")}${pad}</${tag}>\n`;
  };
  const roots = input.tree.filter(n => n.status !== "void");
  add("app/src/main/res/layout/activity_main.xml", `<?xml version="1.0" encoding="utf-8"?>\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">\n${roots.map(n => emit(n, null, null, 1)).join("")}</LinearLayout>\n`);
  add("app/src/main/res/values/strings.xml", `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${strings.join("\n")}\n</resources>\n`);
  add("app/src/main/res/values/styles.xml", '<resources><style name="AppTheme" parent="Theme.MaterialComponents.DayNight.NoActionBar"/></resources>\n');
  add("app/src/main/AndroidManifest.xml", '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:theme="@style/AppTheme" android:label="@string/app_name" android:allowBackup="false"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>\n');
  const setup: string[] = [], callbacks: string[] = [];
  for (const n of nodes) {
    const id = androidId(n.element_id), flags = eventFlags(n);
    if (n.widget_type === "AVATAR") setup.push(`        findViewById<View>(R.id.${id}).apply {\n            clipToOutline = true\n            outlineProvider = object : ViewOutlineProvider() {\n                override fun getOutline(view: View, outline: Outline) { outline.setOval(0, 0, view.width, view.height) }\n            }\n        }`);
    if (n.widget_type === "RICH_TEXT") setup.push(`        findViewById<android.widget.TextView>(R.id.${id}).apply { text = android.text.SpannableString(text) }`);
    if (n.widget_type === "LIST") setup.push(`        findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.${id}).layoutManager = androidx.recyclerview.widget.LinearLayoutManager(this)`);
    if (!flags.size) continue;
    const names = ["click", "long_click", "double_click"];
    for (const e of flags) callbacks.push(`    private fun on_${id}_${e}() { /* empty callback: action_type=none */ }`);
    setup.push(`        bindEvents(findViewById(R.id.${id}), ${names.map(e => flags.has(e) ? `::on_${id}_${e}` : "null").join(", ")})`);
  }
  // ---------- 能力接入（只有不依赖厂商的三项会真产出代码）----------
  const caps = new Set((input.capabilities ?? []).filter((c) => REAL_CAPABILITY_GENERATORS.has(c)));
  const bootCalls: string[] = [];
  if (caps.has("crash_report")) bootCalls.push("        CapabilityBootstrap.installCrashHandler(this)");
  if (caps.has("log_report")) bootCalls.push('        CapabilityBootstrap.logLine(this, "MainActivity created")');
  // 有隐私弹窗时，**所有采集类初始化都必须放在同意回调里**，否则「同意前不得采集」就是空话
  const onCreateBody = caps.has("privacy_dialog")
    ? `        CapabilityBootstrap.ensureConsent(this) {\n${[...bootCalls, ...setup].join("\n")}\n        }`
    : [...bootCalls, ...setup].join("\n");
  add("app/src/main/java/com/autodevelopment/generated/MainActivity.kt", `package com.autodevelopment.generated\n\nimport android.app.Activity\nimport android.os.Bundle\nimport android.os.Handler\nimport android.os.Looper\nimport android.view.View\nimport android.view.ViewOutlineProvider\nimport android.graphics.Outline\n\n// Deterministic development output. L1 is not Kotlin compilation or L2 evidence.\nclass MainActivity : Activity() {\n    private val handler = Handler(Looper.getMainLooper())\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n        setContentView(R.layout.activity_main)\n${onCreateBody}\n    }\n    private fun bindEvents(view: View, click: (() -> Unit)?, longClick: (() -> Unit)?, doubleClick: (() -> Unit)?) {\n        var pending: Runnable? = null\n        if (click != null || doubleClick != null) view.setOnClickListener {\n            if (doubleClick == null) { click?.invoke() }\n            else if (pending != null) {\n                pending?.let { handler.removeCallbacks(it) }; pending = null; doubleClick.invoke()\n            } else {\n                val single = Runnable { pending = null; click?.invoke() }\n                pending = single; handler.postDelayed(single, 300L)\n            }\n        }\n        if (longClick != null) view.setOnLongClickListener {\n            pending?.let { handler.removeCallbacks(it) }; pending = null; longClick.invoke(); true\n        }\n    }\n    override fun onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy() }\n${callbacks.join("\n")}\n}\n`, "kotlin");
  if (caps.size)
    add("app/src/main/java/com/autodevelopment/generated/CapabilityBootstrap.kt", capabilityBootstrapKotlin(caps), "kotlin");
  add("settings.gradle.kts", 'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name = "GeneratedLayout"\ninclude(":app")\n', "gradle");
  add("build.gradle.kts", 'plugins { id("com.android.application") version "8.7.3" apply false; id("org.jetbrains.kotlin.android") version "2.0.21" apply false }\n', "gradle");
  add("app/build.gradle.kts", 'plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }\nandroid { namespace = "com.autodevelopment.generated"; compileSdk = 35\n    defaultConfig { applicationId = "com.autodevelopment.generated"; minSdk = 23; targetSdk = 35; versionCode = 1; versionName = "1.0" }\n    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }\n    kotlinOptions { jvmTarget = "17" }\n}\ndependencies {\n    implementation("androidx.constraintlayout:constraintlayout:2.2.0")\n    implementation("androidx.cardview:cardview:1.0.0")\n    implementation("androidx.recyclerview:recyclerview:1.3.2")\n    implementation("androidx.viewpager2:viewpager2:1.1.0")\n    implementation("com.google.android.material:material:1.12.0")\n}\n', "gradle");
  add("gradle.properties", 'android.useAndroidX=true\norg.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8\n', "gradle");
  add("dependency-versions.json", JSON.stringify({ gradle: "8.9", agp: "8.7.3", kotlin: "2.0.21", java: "17", compileSdk: 35, minSdk: 23, targetSdk: 35, direct: { "androidx.constraintlayout:constraintlayout": "2.2.0", "androidx.cardview:cardview": "1.0.0", "androidx.recyclerview:recyclerview": "1.3.2", "androidx.viewpager2:viewpager2": "1.1.0", "com.google.android.material:material": "1.12.0" }, transitive_lock: "not_resolved_no_build" }, null, 2) + "\n", "json");
  add("README.md", '# Deterministic Android layout project — development, not real AI\n\nL1 is static checking only. Kotlin/Android compilation and L2 have NOT been run. No APK.\n\n37 widget types map to the baseline Android classes. LIST/GRID/BANNER/TAB_LAYOUT with children are rejected: adapters/item templates are not implemented. Empty instances are empty views; SPINNER and BOTTOM_NAV have no data/menu. IMAGE/AVATAR/VIDEO have no media sources. RICH_TEXT uses SpannableString without authored spans. AVATAR uses an oval outline (circle only at square size).\n\nWidth/height, padding/margin, background, text color/size, radius, border, alpha, visibility and gravity are emitted where supported. Constraint/relative children use a deterministic vertical chain; no authored constraint editing. CARD applies card background/radius; custom border is not rendered. Native complex widgets may ignore text/gravity, margins depend on parent, themed controls may differ. Native clickable child controls can consume parent events. DIVIDER uses input height (set 1dp for baseline default), LABEL uses input padding. Click/long/double empty callbacks coexist; click is delayed 300ms when double-click enabled.\n\nLocal build prerequisites: JDK17, Android SDK35, network to Google/Maven/Gradle. Restore base64 wrapper JAR as binary; chmod +x gradlew after export. Fixed direct dependency versions are listed in dependency-versions.json; transitive Gradle lockfiles have not been resolved.\n');
  for (const path of ["gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.properties", "gradle/wrapper/gradle-wrapper.jar"]) {
    signal.throwIfAborted();
    let bytes: Buffer;
    try { bytes = await readFile(new URL(`../../resources/gradle/${path}`, import.meta.url), { signal }); }
    catch { signal.throwIfAborted(); throw new ApiError("UPSTREAM_UNAVAILABLE", "真实 Gradle wrapper 资源缺失；不能返回完整工程。"); }
    if (createHash("sha256").update(bytes).digest("hex") !== WRAPPER_SHA256[path]) throw new ApiError("UPSTREAM_UNAVAILABLE", "Gradle wrapper 资源完整性校验失败。");
    if (path.endsWith(".jar")) {
      files.push({ path, kind: "binary", content: bytes.toString("base64"), encoding: "base64" });
    } else add(path, bytes.toString("utf8"), "gradle");
  }
  signal.throwIfAborted(); return validateCodeFiles(files);
}

function realAdapter(base: string, key: string): CodegenAdapter {
  let endpoint: URL;
  try {
    endpoint = new URL(base);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || /[\r\n]/.test(key)) throw new Error();
    endpoint.pathname = endpoint.pathname.replace(/\/$/, "") + "/v1/codegen";
  } catch { return unavailable("代码生成网关配置不合法。"); }
  return { kind: "real", async generate(input, signal) {
    signal.throwIfAborted(); checkInput(input);
    let body: string;
    try { body = JSON.stringify(input); } catch { throw new ApiError("INVALID_ARGUMENT", "生成输入不可序列化。"); }
    if (Buffer.byteLength(body) > MAX_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", "生成输入过大。");
    // Stable per-payload key: gateway must honor it to avoid duplicate generation on retries.
    const requestKey = createHash("sha256").update(body).digest("hex");
    let last: ApiError = new ApiError("UPSTREAM_UNAVAILABLE", "代码生成网关暂不可用。");
    for (let attempt = 0; attempt <= 2; attempt++) {
      signal.throwIfAborted(); const local = new AbortController();
      const combined = AbortSignal.any([signal, local.signal]); let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; local.abort(); }, 60_000);
      let retry = true;
      try {
        const res = await fetch(endpoint, { method: "POST", redirect: "error", signal: combined,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "Idempotency-Key": requestKey }, body });
        if (!res.ok) {
          retry = res.status === 408 || res.status === 429 || res.status >= 500;
          await res.body?.cancel();
          throw new ApiError("UPSTREAM_UNAVAILABLE", "代码生成网关返回错误。");
        }
        // The same 60s timer stays armed through the entire streamed body, not just response headers.
        const reader = res.body?.getReader(); if (!reader) { retry = false; throw new ApiError("UPSTREAM_UNAVAILABLE", "代码生成网关响应为空。"); }
        const chunks: Buffer[] = []; let length = 0;
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > MAX_BYTES) { retry = false; await reader.cancel(); throw new ApiError("UPSTREAM_UNAVAILABLE", "代码生成网关响应超过上限。"); }
          chunks.push(Buffer.from(value));
        }
        signal.throwIfAborted();
        if (timedOut) throw new ApiError("UPSTREAM_TIMEOUT", "代码生成响应超时（60s，含响应体）。");
        retry = false;
        let payload: unknown;
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ApiError("UPSTREAM_UNAVAILABLE", "代码生成网关未返回合法 JSON。"); }
        return validateCodeFiles(Array.isArray(payload) ? payload : (payload as any)?.files);
      } catch {
        signal.throwIfAborted();
        last = new ApiError(timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE", timedOut ? "代码生成响应超时（60s，含响应体）。" : "代码生成网关不可用或产物不合法；未应用结果。");
        if (!retry || attempt === 2) throw last;
      } finally { clearTimeout(timer); local.abort(); }
      // Cancellation aborts backoff too. Never translate caller cancellation into failed/timeout.
      try { await delay(400 * 2 ** attempt + Math.floor(Math.random() * 200), undefined, { signal }); } catch { signal.throwIfAborted(); throw last; }
    }
    throw last;
  } };
}
function unavailable(message = "未配置代码生成网关；请显式启用 development 或配置真实网关。"): CodegenAdapter {
  return { kind: "unconfigured", async generate(_input, signal) { signal.throwIfAborted(); throw new ApiError("UPSTREAM_UNAVAILABLE", message); } };
}
export function createCodegenAdapter(): CodegenAdapter {
  const mode = process.env.AD_CODEGEN_MODE;
  if (mode === "development" || (!mode && process.env.AD_LLM_MODE === "development")) return { kind: "development", generate: generateDevelopment };
  if (mode && mode !== "real") return unavailable("AD_CODEGEN_MODE 不合法或已禁用。");
  const base = process.env.AD_CODEGEN_BASE_URL, key = process.env.AD_CODEGEN_API_KEY;
  return base && key ? realAdapter(base, key) : unavailable();
}
