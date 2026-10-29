/**
 * 工程代理接口（`F17` / `D2=A`）—— **本机只读扫描既有 Android 工程**，提取「项目约束包」。
 *
 * 为什么单独抽一层：`D2=A` 定的是「本期以本机后端直读实现」，
 * 但**业务代码只依赖 `EngineeringAgent` 接口**——将来切「本地工程代理（可上云）」时
 * （见 `D-R1` / 接口契约 `#46`）只换实现，不改调用方。
 *
 * 安全（`D3` 的最小边界，一期为**只读**）：
 *  - 只接受**绝对路径**，必须是存在的**目录**；
 *  - 必须是**识别得出的 Android 工程**（否则拒绝，不猜）；
 *  - 遍历有**深度与文件数上限**，跳过构建产物目录（`.git`/`build`/`.gradle`…）；
 *  - 单文件读取有**大小上限**；任何读取失败只记 `warnings`，**不抛异常**（部分失败不阻断）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { ApiError } from "../core/envelope.ts";

export type Confidence = "high" | "medium" | "low";

export interface ConstraintItem {
  key: string; label: string; value: string;
  /** 来源：`<相对路径>:<行号>` 或 `（推断）` */
  source: string; confidence: Confidence;
}
export interface DependencyRef { name: string; version: string; source: string }
export interface AndroidFacts {
  agp: string | null; kotlin: string | null; gradle: string | null;
  compile_sdk: number | null; min_sdk: number | null; target_sdk: number | null; java: string | null;
}
export interface ConstraintPack {
  root: string; scanned_at: string; android_detected: boolean;
  project_name: string | null; namespace: string | null; application_id: string | null;
  modules: string[]; android: AndroidFacts; dependencies: DependencyRef[];
  agent_config_files: string[]; style_tools: string[]; naming_samples: string[];
  build_commands: string[]; items: ConstraintItem[]; warnings: string[]; markdown: string;
}

export interface EngineeringAgent {
  readonly kind: string;
  scan(root: string): Promise<ConstraintPack>;
}

// ------------------------------------------------------------------ 常量

const SKIP_DIRS = new Set([".git", ".gradle", "build", ".idea", "node_modules", ".tmp", ".kotlin", ".cxx", ".fleet", "out"]);
const MAX_FILES = 8000;
const MAX_DEPTH = 12;
const MAX_TEXT = 262_144; // 单文件 256KB

/** agent / AI 工程化配置的**候选文件**（存在即收录；不存在不报错） */
const AGENT_CONFIG_CANDIDATES = [
  "AGENTS.md", "CLAUDE.md", "GEMINI.md", "README.md",
  ".cursor/rules", ".cursorrules", ".github/copilot-instructions.md",
  ".github/AGENTS.md", "docs/AGENTS.md", "CONTRIBUTING.md",
];

/** 代码风格 / 静态检查配置候选 */
const STYLE_TOOL_CANDIDATES = [
  ".editorconfig", "detekt.yml", "detekt.yaml", "config/detekt/detekt.yml",
  ".ktlint", "ktlint.gradle", "ktlint.gradle.kts",
];

// ------------------------------------------------------------------ 工具

function readText(p: string, max = MAX_TEXT): string | null {
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size > max) return null;
    return readFileSync(p, "utf8");
  } catch { return null; }
}

/** 首次命中的**行号**（1 基）；找不到返回 null —— 用于「来源可追溯」 */
function lineOf(text: string, re: RegExp): number | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) if (re.test(lines[i]!)) return i + 1;
  return null;
}
function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m?.[1]?.trim() ?? null;
}

/** 有界遍历（深度 + 文件数），返回相对路径列表 */
function walk(root: string, opts: { onFile?: (abs: string, rel: string) => void } = {}): void {
  let files = 0;
  const stack: { dir: string; rel: string; depth: number }[] = [{ dir: root, rel: "", depth: 0 }];
  while (stack.length) {
    const { dir, rel, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) continue;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (files >= MAX_FILES) return;
      const abs = join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isSymbolicLink()) continue;              // 不跟随符号链接（防逃逸）
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
        stack.push({ dir: abs, rel: childRel, depth: depth + 1 });
      } else if (st.isFile()) {
        files += 1;
        opts.onFile?.(abs, childRel);
      }
    }
  }
}

// ------------------------------------------------------------------ 校验

/** 校验并归一化工程根目录；不合法一律 `INVALID_ARGUMENT`（不猜、不放行） */
export function validateEngineeringRoot(input: string): string {
  const root = String(input ?? "").trim();
  if (!root) throw new ApiError("INVALID_ARGUMENT", "请填写本机 Android 工程的根目录（绝对路径）。");
  if (!isAbsolute(root)) throw new ApiError("INVALID_ARGUMENT", "工程根目录必须是**绝对路径**。");
  let st;
  try { st = statSync(root); } catch { throw new ApiError("INVALID_ARGUMENT", "这个目录不存在或读不到，请检查路径。"); }
  if (!st.isDirectory()) throw new ApiError("INVALID_ARGUMENT", "这个路径不是目录，请指向工程根目录。");
  if (!looksLikeAndroid(root)) throw new ApiError("INVALID_ARGUMENT", "这个目录里没找到 Android 工程（缺少 settings.gradle / build.gradle / AndroidManifest.xml）。");
  return root;
}

function looksLikeAndroid(root: string): boolean {
  const marks = [
    "settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts",
    join("app", "src", "main", "AndroidManifest.xml"),
    join("app", "build.gradle"), join("app", "build.gradle.kts"),
  ];
  for (const m of marks) if (existsSync(join(root, m))) return true;
  // 兜底：根目录下任意 `*/src/main/AndroidManifest.xml`
  let hit = false;
  walk(root, { onFile: (_abs, rel) => { if (/^[^/]+\/src\/main\/AndroidManifest\.xml$/.test(rel)) hit = true; } });
  return hit;
}

// ------------------------------------------------------------------ 解析

function parseTomlVersions(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) { section = sec[1]!.trim(); continue; }
    if (section !== "versions" && section !== "libraries" && section !== "plugins") continue;
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/.exec(line);
    if (kv) out[`${section}.${kv[1]}`] = kv[2]!;
  }
  return out;
}

const DEP_LINE = /^\s*(?:implementation|api|compileOnly|runtimeOnly|debugImplementation|releaseImplementation|testImplementation|androidTestImplementation|kapt|ksp|annotationProcessor)\s*\(?\s*["']([^"']+)["']/;

function parseDependencies(text: string, source: string): DependencyRef[] {
  const out: DependencyRef[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const m = DEP_LINE.exec(lines[i]!);
    if (!m) continue;
    const coord = m[1]!.trim();
    const parts = coord.split(":");
    if (parts.length < 2) continue;
    const name = parts[0]!.includes(".") ? `${parts[0]}:${parts[1]}` : coord;
    const version = parts.length >= 3 ? parts[2]! : "";
    out.push({ name, version, source: `${source}:${i + 1}` });
  }
  return out;
}

function collectAgentConfigs(root: string): string[] {
  const found: string[] = [];
  for (const c of AGENT_CONFIG_CANDIDATES) {
    const abs = join(root, c);
    if (existsSync(abs)) found.push(c);
  }
  return found;
}

function collectStyleTools(root: string): string[] {
  return STYLE_TOOL_CANDIDATES.filter((c) => existsSync(join(root, c)));
}

function collectNamingSamples(root: string, limit = 12): string[] {
  const samples = new Set<string>();
  walk(root, { onFile: (abs, rel) => {
    if (samples.size >= 60) return;
    if (!/\/res\/layout\/[^/]+\.xml$/.test(rel) && !/^res\/layout\/[^/]+\.xml$/.test(rel)) return;
    const t = readText(abs, 64 * 1024);
    if (!t) return;
    for (const m of t.matchAll(/@\+id\/([A-Za-z0-9_]+)/g)) {
      samples.add(m[1]!);
      if (samples.size >= 60) break;
    }
  } });
  return [...samples].slice(0, limit);
}

// ------------------------------------------------------------------ 扫描

export function createLocalEngineeringAgent(): EngineeringAgent {
  return {
    kind: "local_fs",
    async scan(rootInput: string): Promise<ConstraintPack> {
      const root = validateEngineeringRoot(rootInput);
      const warnings: string[] = [];
      const items: ConstraintItem[] = [];
      const push = (key: string, label: string, value: string | number | null | undefined, source: string, confidence: Confidence = "high") => {
        if (value === null || value === undefined || value === "") return;
        items.push({ key, label, value: String(value), source, confidence });
        if (confidence !== "high") warnings.push(`${label} 取自 ${source}（${confidence}）：${value}`);
      };

      // ---- 工程文件 ----
      const settingsPath = ["settings.gradle.kts", "settings.gradle"].map((f) => join(root, f)).find(existsSync) ?? null;
      const settings = settingsPath ? readText(settingsPath) : null;
      const settingsRel = settingsPath ? settingsPath.slice(root.length + 1) : "";
      const rootBuildPath = ["build.gradle.kts", "build.gradle"].map((f) => join(root, f)).find(existsSync) ?? null;
      const rootBuild = rootBuildPath ? readText(rootBuildPath) : null;
      const rootBuildRel = rootBuildPath ? rootBuildPath.slice(root.length + 1) : "";
      const tomlPath = join(root, "gradle", "libs.versions.toml");
      const toml = existsSync(tomlPath) ? readText(tomlPath) : null;

      // ---- 项目名 / 模块 ----
      const projectName = settings ? firstMatch(settings, /rootProject\.name\s*=\s*["']([^"']+)["']/) : null;
      const modules: string[] = [];
      if (settings) {
        for (const m of settings.matchAll(/include\s*\(?\s*([^\n)]+)/g)) {
          for (const q of m[1]!.matchAll(/["']([^"']+)["']/g)) modules.push(q[1]!.trim());
        }
      }

      // ---- 版本（AGP / Kotlin / Gradle）----
      const tv = toml ? parseTomlVersions(toml) : {};
      const agp = tv["versions.agp"] ?? tv["plugins.android-application"] ?? (rootBuild ? firstMatch(rootBuild, /com\.android\.application["')]*\s*version\s*["']([^"']+)["']/) : null);
      const kotlin = tv["versions.kotlin"] ?? (rootBuild ? firstMatch(rootBuild, /(?:kotlin\.android|org\.jetbrains\.kotlin\.android)["')]*\s*version\s*["']([^"']+)["']/) : null);
      const wrapperPath = join(root, "gradle", "wrapper", "gradle-wrapper.properties");
      const gradle = existsSync(wrapperPath) ? firstMatch(readText(wrapperPath) ?? "", /gradle-([\d.]+)-/) : null;

      // ---- 模块级 build 文件（找带 namespace/applicationId 的那个）----
      const moduleDirs = modules.map((m) => m.replace(/^:/, "")).filter(Boolean);
      let appBuild: string | null = null; let appBuildRel = "";
      for (const dir of moduleDirs) {
        for (const f of ["build.gradle.kts", "build.gradle"]) {
          const p = join(root, dir, f);
          const t = readText(p);
          if (t && /namespace|applicationId|com\.android\.application/.test(t)) { appBuild = t; appBuildRel = `${dir}/${f}`; break; }
        }
        if (appBuild) break;
      }
      if (appBuildPath(root, moduleDirs) && !appBuild) warnings.push("未能在模块目录里找到含 namespace/applicationId 的 build 文件。");

      const namespace = appBuild ? firstMatch(appBuild, /namespace\s*=\s*["']([^"']+)["']/) : null;
      const applicationId = appBuild ? firstMatch(appBuild, /applicationId\s*=\s*["']([^"']+)["']/) : null;
      const compileSdk = appBuild ? intOf(firstMatch(appBuild, /compileSdk\s*=?\s*(\d+)/)) : null;
      const minSdk = appBuild ? intOf(firstMatch(appBuild, /minSdk\s*=?\s*(\d+)/)) : null;
      const targetSdk = appBuild ? intOf(firstMatch(appBuild, /targetSdk\s*=?\s*(\d+)/)) : null;
      const java = appBuild ? (firstMatch(appBuild, /(?:sourceCompatibility|JavaVersion\.VERSION_)(?:JavaVersion\.)?VERSION_(\d+)/) ?? firstMatch(appBuild, /jvmTarget\s*=\s*["']?(\d+)/)) : null;

      // ---- 依赖 ----
      const dependencies: DependencyRef[] = [];
      if (appBuild) dependencies.push(...parseDependencies(appBuild, appBuildRel));
      if (rootBuild) dependencies.push(...parseDependencies(rootBuild, rootBuildRel));
      if (toml) {
        for (const [k, v] of Object.entries(tv)) {
          if (k.startsWith("libraries.")) {
            const parts = v.split(":");
            if (parts.length >= 2) dependencies.push({ name: `${parts[0]}:${parts[1]}`, version: parts.length >= 3 ? parts[2]! : "", source: "gradle/libs.versions.toml" });
          }
        }
      }

      // ---- agent 配置 / 风格工具 / 命名抽样 / 构建命令 ----
      const agentConfigFiles = collectAgentConfigs(root);
      const styleTools = collectStyleTools(root);
      const namingSamples = collectNamingSamples(root);
      const hasWrapper = existsSync(join(root, "gradlew"));
      const buildCommands = hasWrapper ? ["./gradlew assembleDebug", "./gradlew test", "./gradlew lint"] : [];

      // ---- items（带来源）----
      push("project_name", "项目名", projectName, settingsRel ? `${settingsRel}:${lineOf(settings ?? "", /rootProject\.name/) ?? 1}` : "（推断）", settingsRel ? "high" : "low");
      push("namespace", "命名空间 namespace", namespace, `${appBuildRel}:${appBuild ? lineOf(appBuild, /namespace/) ?? 1 : 1}`);
      push("application_id", "应用 ID applicationId", applicationId, `${appBuildRel}:${appBuild ? lineOf(appBuild, /applicationId/) ?? 1 : 1}`);
      push("agp", "Android Gradle Plugin", agp, tv["versions.agp"] ? "gradle/libs.versions.toml" : `${rootBuildRel}`, tv["versions.agp"] ? "high" : "medium");
      push("kotlin", "Kotlin 版本", kotlin, tv["versions.kotlin"] ? "gradle/libs.versions.toml" : `${rootBuildRel}`, tv["versions.kotlin"] ? "high" : "medium");
      push("gradle", "Gradle 版本", gradle, "gradle/wrapper/gradle-wrapper.properties");
      push("compile_sdk", "compileSdk", compileSdk, `${appBuildRel}:${appBuild ? lineOf(appBuild, /compileSdk/) ?? 1 : 1}`);
      push("min_sdk", "minSdk", minSdk, `${appBuildRel}:${appBuild ? lineOf(appBuild, /minSdk/) ?? 1 : 1}`);
      push("target_sdk", "targetSdk", targetSdk, `${appBuildRel}:${appBuild ? lineOf(appBuild, /targetSdk/) ?? 1 : 1}`);
      push("java", "Java / jvmTarget", java, appBuildRel, "medium");
      push("modules", "Gradle 模块", modules.join("、"), settingsRel, "high");
      push("dependencies_count", "依赖条数", String(dependencies.length), appBuildRel, "medium");
      push("agent_config_files", "agent / AI 配置", agentConfigFiles.join("、"), "（工程根）", "high");
      push("style_tools", "代码风格工具", styleTools.join("、"), "（工程根）", "high");
      push("naming_samples", "既有 @+id 命名抽样", namingSamples.join("、"), "（res/layout 抽样）", "medium");

      const pack: ConstraintPack = {
        root, scanned_at: new Date().toISOString(), android_detected: true,
        project_name: projectName, namespace, application_id: applicationId,
        modules, android: { agp, kotlin, gradle, compile_sdk: compileSdk, min_sdk: minSdk, target_sdk: targetSdk, java },
        dependencies, agent_config_files: agentConfigFiles, style_tools: styleTools,
        naming_samples: namingSamples, build_commands: buildCommands, items, warnings,
        markdown: renderMarkdown({ root, projectName, namespace, applicationId, modules, android: { agp, kotlin, gradle, compile_sdk: compileSdk, min_sdk: minSdk, target_sdk: targetSdk, java }, dependencies, agentConfigFiles, styleTools, namingSamples, buildCommands, items, warnings, scannedAt: new Date().toISOString() }),
      };
      return pack;
    },
  };
}

function appBuildPath(root: string, moduleDirs: string[]): boolean {
  return moduleDirs.some((d) => existsSync(join(root, d, "build.gradle")) || existsSync(join(root, d, "build.gradle.kts")));
}
function intOf(s: string | null): number | null {
  if (s === null) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------ 渲染

interface RenderInput {
  root: string; projectName: string | null; namespace: string | null; applicationId: string | null;
  modules: string[]; android: AndroidFacts; dependencies: DependencyRef[];
  agentConfigFiles: string[]; styleTools: string[]; namingSamples: string[];
  buildCommands: string[]; items: ConstraintItem[]; warnings: string[]; scannedAt: string;
}
function renderMarkdown(i: RenderInput): string {
  const L: string[] = [];
  L.push(`# 工程约束包${i.projectName ? `（${i.projectName}）` : ""}`, "");
  L.push(`> 由平台在 **${i.scannedAt}** 对本机工程**只读扫描**生成；每项均标注来源，可在《假设确认清单》中复核。`, "");
  L.push(`- 工程根：\`${i.root}\``, "");
  L.push("## 1 框架与依赖", "");
  L.push("| 项 | 值 |", "|---|---|");
  L.push(`| Android Gradle Plugin | ${i.android.agp ?? "—"} |`);
  L.push(`| Kotlin | ${i.android.kotlin ?? "—"} |`);
  L.push(`| Gradle | ${i.android.gradle ?? "—"} |`);
  L.push(`| compileSdk / minSdk / targetSdk | ${i.android.compile_sdk ?? "—"} / ${i.android.min_sdk ?? "—"} / ${i.android.target_sdk ?? "—"} |`);
  L.push(`| Java / jvmTarget | ${i.android.java ?? "—"} |`);
  L.push(`| 模块 | ${i.modules.join("、") || "—"} |`);
  L.push("");
  L.push("## 2 架构与命名", "");
  L.push(`- namespace：\`${i.namespace ?? "—"}\``);
  L.push(`- applicationId：\`${i.applicationId ?? "—"}\``);
  L.push(`- 既有 @+id 命名抽样：${i.namingSamples.length ? i.namingSamples.map((s) => `\`${s}\``).join("、") : "—"}`);
  L.push("");
  L.push("## 3 agent / AI 工程化配置", "");
  L.push(i.agentConfigFiles.length ? i.agentConfigFiles.map((f) => `- \`${f}\``).join("\n") : "- （无）");
  L.push("");
  L.push("## 4 代码风格与工具", "");
  L.push(i.styleTools.length ? i.styleTools.map((f) => `- \`${f}\``).join("\n") : "- （无）");
  L.push("");
  L.push("## 5 依赖（版本锁定）", "");
  L.push(i.dependencies.length ? i.dependencies.map((d) => `- \`${d.name}\`${d.version ? ` : ${d.version}` : ""}　<span style="opacity:.6">${d.source}</span>`).join("\n") : "- （未解析到）");
  L.push("");
  L.push("## 6 构建与验证命令", "");
  L.push(i.buildCommands.length ? i.buildCommands.map((c) => `- \`${c}\``).join("\n") : "- （未发现 gradlew）");
  L.push("");
  L.push("## 7 约束清单（带来源）", "");
  L.push("| 约束 | 值 | 来源 | 置信度 |", "|---|---|---|---|");
  for (const it of i.items) L.push(`| ${it.label} | ${String(it.value).replace(/\|/g, "\\|")} | ${it.source} | ${it.confidence} |`);
  L.push("");
  if (i.warnings.length) {
    L.push("## 8 待确认（低置信 / 缺失）", "");
    for (const w of i.warnings) L.push(`- ${w}`);
    L.push("");
  }
  return L.join("\n");
}

/** 供**提示词注入**用的紧凑摘要（不含大表格；控制长度） */
export function summarizeConstraints(pack: Pick<ConstraintPack, "project_name" | "namespace" | "application_id" | "modules" | "android" | "dependencies" | "naming_samples" | "style_tools">): string {
  const L: string[] = [];
  if (pack.project_name) L.push(`- 工程：${pack.project_name}`);
  if (pack.namespace) L.push(`- namespace：${pack.namespace}`);
  if (pack.application_id) L.push(`- applicationId：${pack.application_id}`);
  if (pack.modules.length) L.push(`- 模块：${pack.modules.join("、")}`);
  const a = pack.android;
  const sdk = [a.compile_sdk !== null ? `compileSdk ${a.compile_sdk}` : null, a.min_sdk !== null ? `minSdk ${a.min_sdk}` : null, a.target_sdk !== null ? `targetSdk ${a.target_sdk}` : null].filter(Boolean).join(" / ");
  if (sdk) L.push(`- SDK：${sdk}`);
  if (a.agp || a.kotlin || a.gradle || a.java) L.push(`- 版本：AGP ${a.agp ?? "?"} / Kotlin ${a.kotlin ?? "?"} / Gradle ${a.gradle ?? "?"} / Java ${a.java ?? "?"}`);
  if (pack.dependencies.length) L.push(`- 依赖（版本锁定）：${pack.dependencies.slice(0, 30).map((d) => `${d.name}${d.version ? `:${d.version}` : ""}`).join("、")}${pack.dependencies.length > 30 ? ` 等 ${pack.dependencies.length} 项` : ""}`);
  if (pack.naming_samples.length) L.push(`- 既有控件命名抽样：${pack.naming_samples.join("、")}`);
  if (pack.style_tools.length) L.push(`- 代码风格工具：${pack.style_tools.join("、")}`);
  return L.join("\n");
}

/** 给「相对路径」做跨平台归一（Windows 反斜杠 → 斜杠） */
export type { ConstraintItem as _ConstraintItem };
export const _sep = sep;
