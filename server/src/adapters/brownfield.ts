/**
 * Brownfield 合并器（二期 `F18` · 生成侧衔接）—— 把**整包生成物**转成**针对既有工程的增量补丁**。
 *
 * 为什么需要它：`codegen.ts` 产出的是 greenfield 的**整套工程**（含 `settings.gradle.kts` /
 * `build.gradle.kts` / `gradle wrapper` / 硬编码包名 `com.autodevelopment.generated`）。
 * 直接写回既有工程会**破坏基座**。本模块按既有工程的真实结构做**路径重写 + 定点合并**，
 * 只产出**可安全写回**的增量文件，交给 `adapters/patch.ts` 落盘。
 *
 * 合并规则（逐条）：
 *  1. **基座/构建文件一律不写回**（`settings.gradle*` / `build.gradle*` / `gradle.properties` / `gradle/**` / `gradlew*`）—— 依赖与插件以**工程约束包**为准（`D4=A`）；
 *  2. **包名对齐**：`java/com/autodevelopment/generated/X.kt` → `<module>/src/main/java/<namespace 路径>/X.kt`，并把 `package` 行改写为工程 `namespace`；目标已存在 → **不覆盖**（提示人工合并）；
 *  3. **布局合并**：既有 `res/layout/<name>.xml` 存在时，只把**新增 id** 的子节点插入到既有根节点末尾；既有 id 不重复插入；
 *  4. **`strings.xml` 合并**：只追加**缺失的** `<string name=...>`；
 *  5. **`AndroidManifest.xml` 合并**：只在 `</application>` 前插入**尚未声明**的 `<activity>`；
 *  6. 其余文件：目标不存在 → 新建；已存在 → 走补丁引擎的冲突规则（默认拒绝）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PatchFile } from "./patch.ts";

export interface MergeFile { path: string; content: string; kind?: string }
export interface MergeInput {
  root: string;
  generated: MergeFile[];
  /** 工程约束包里的 namespace（`#73` 提取）；缺失则退回 `app`/`com.autodevelopment.generated` */
  namespace?: string | null;
  /** 生成物的默认包名（codegen 侧写死） */
  generatedPackage?: string;
}
export interface MergeResult {
  files: PatchFile[];
  skipped: { path: string; reason: string }[];
  notes: string[];
  module: string;
}

const GEN_PKG = "com.autodevelopment.generated";
const BASE_SKIP: [RegExp, string][] = [
  [/^settings\.gradle(\.kts)?$/i, "基座文件（settings.gradle）不写回"],
  [/^build\.gradle(\.kts)?$/i, "基座文件（根 build.gradle）不写回"],
  [/^(app|[^/]+)\/build\.gradle(\.kts)?$/i, "模块构建文件不写回（依赖以工程约束包为准）"],
  [/^gradle\.properties$/i, "gradle.properties 不写回"],
  [/^gradle\//i, "gradle 目录（wrapper / libs.versions.toml）不写回"],
  [/^gradlew(\.bat)?$/i, "gradlew 不写回"],
];

/** 选出工程的主模块目录（`:app` 优先；否则唯一含 src/main 的模块；再否则 `app`） */
export function pickModule(root: string, modules: string[] = []): string {
  const names = modules.map((m) => m.replace(/^:/, "")).filter(Boolean);
  if (names.includes("app")) return "app";
  const hasMain = (d: string) => existsSync(join(root, d, "src", "main"));
  for (const n of names) if (hasMain(n)) return n;
  try {
    const dirs = readdirSync(root).filter((d) => { try { return statSync(join(root, d)).isDirectory() && hasMain(d); } catch { return false; } });
    if (dirs.length) return dirs[0]!;
  } catch { /* ignore */ }
  return "app";
}

function idsOf(xml: string): Set<string> {
  return new Set([...xml.matchAll(/@\+id\/([A-Za-z0-9_]+)/g)].map((m) => m[1]!));
}
/** 取 XML 根节点开/闭标签与内部内容（仅支持「无同名嵌套」的常规布局文件） */
function splitXml(xml: string): { head: string; inner: string; foot: string; tag: string } | null {
  const m = /^\s*(<\?xml[^>]*\?>\s*)?(<([A-Za-z0-9_.:]+)[\s\S]*?>)\s*([\s\S]*?)\s*(<\/\3>)\s*$/.exec(xml);
  if (!m) return null;
  return { head: (m[1] ?? "") + m[2]!, inner: m[4] ?? "", foot: m[5]!, tag: m[3]! };
}
/** 把一段子节点切成顶层节点数组（按标签深度切） */
function topNodes(inner: string): string[] {
  const out: string[] = [];
  const re = /<([A-Za-z0-9_.:]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null, start = -1, depth = 0;
  while ((m = re.exec(inner))) {
    if (depth === 0 && start === -1) start = m.index;
    if (m[3] === "/") { if (depth === 0) { out.push(inner.slice(start, re.lastIndex)); start = -1; } continue; }
    depth += 1;
    // 找同名闭合
    const close = new RegExp(`</${m[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`, "g");
    close.lastIndex = re.lastIndex;
    const c = close.exec(inner);
    if (!c) { break; }
    depth -= 1;
    if (depth === 0) { out.push(inner.slice(start, c.index + c[0].length)); re.lastIndex = c.index + c[0].length; start = -1; }
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

function mergeLayout(existing: string, incoming: string): { content: string; added: number } | null {
  const a = splitXml(existing), b = splitXml(incoming);
  if (!a || !b) return null;
  const have = idsOf(existing);
  const add = topNodes(b.inner).filter((n) => {
    const ids = idsOf(n);
    return ids.size === 0 || [...ids].every((id) => !have.has(id));
  });
  if (!add.length) return { content: existing, added: 0 };
  const content = existing.replace(a.foot, add.join("\n    ") + "\n" + a.foot);
  return { content, added: add.length };
}

function mergeStrings(existing: string, incoming: string): { content: string; added: number } | null {
  const a = splitXml(existing), b = splitXml(incoming);
  if (!a || !b) return null;
  const have = new Set([...existing.matchAll(/<string\s+name="([^"]+)"/g)].map((m) => m[1]!));
  const add = [...incoming.matchAll(/<string\s+name="([^"]+)"[\s\S]*?<\/string>/g)]
    .filter((m) => !have.has(m[1]!)).map((m) => m[0]);
  if (!add.length) return { content: existing, added: 0 };
  return { content: existing.replace(a.foot, "    " + add.join("\n    ") + "\n" + a.foot), added: add.length };
}

function mergeManifest(existing: string, incoming: string): { content: string; added: number } | null {
  if (!/<\/application>/.test(existing)) return null;
  const have = new Set([...existing.matchAll(/<activity[^>]*android:name="([^"]+)"/g)].map((m) => m[1]!));
  const add = [...incoming.matchAll(/<activity[\s\S]*?<\/activity>|<activity[^>]*\/>/g)]
    .filter((m) => { const n = /android:name="([^"]+)"/.exec(m[0])?.[1]; return n && !have.has(n); })
    .map((m) => m[0]);
  if (!add.length) return { content: existing, added: 0 };
  return { content: existing.replace("</application>", "    " + add.join("\n        ") + "\n    </application>"), added: add.length };
}

/** 生成「针对既有工程的增量补丁集」 */
export function planBrownfieldMerge(input: MergeInput): MergeResult {
  const { root } = input;
  const ns = (input.namespace ?? "").trim() || GEN_PKG;
  const genPkg = input.generatedPackage ?? GEN_PKG;
  const module = pickModule(root, []);
  const nsPath = ns.split(".").join("/");
  const files: PatchFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const notes: string[] = [];

  for (const f of input.generated) {
    const rel = f.path.replace(/\\/g, "/");
    const baseSkip = BASE_SKIP.find(([re]) => re.test(rel));
    if (baseSkip) { skipped.push({ path: rel, reason: baseSkip[1] }); continue; }

    // 2) 包名对齐（Kotlin / Java）
    if (/^app\/src\/main\/(java|kotlin)\//.test(rel)) {
      const rest = rel.replace(/^app\/src\/main\/(java|kotlin)\//, "");
      const lang = rel.includes("/kotlin/") ? "kotlin" : "java";
      const tail = rest.startsWith(genPkg.split(".").join("/") + "/") ? rest.slice(genPkg.split(".").join("/").length + 1) : rest.split("/").pop()!;
      const target = `${module}/src/main/${lang}/${nsPath}/${tail}`;
      if (existsSync(join(root, target))) { skipped.push({ path: target, reason: "目标已存在同名文件（不覆盖，需人工合并）" }); continue; }
      files.push({ path: target, content: f.content.replaceAll(`package ${genPkg}`, `package ${ns}`), kind: f.kind });
      notes.push(`包名对齐：${rel} → ${target}`);
      continue;
    }

    // 3) 布局合并
    if (/\/res\/layout\/[^/]+\.xml$/.test(rel)) {
      const target = rel.startsWith("app/") ? `${module}/${rel.slice(4)}` : rel;
      const abs = join(root, target);
      if (!existsSync(abs)) { files.push({ path: target, content: f.content, kind: "xml" }); continue; }
      const merged = mergeLayout(readFileSync(abs, "utf8"), f.content);
      if (!merged) { skipped.push({ path: target, reason: "既有布局结构无法安全合并（需人工）" }); continue; }
      if (!merged.added) { skipped.push({ path: target, reason: "无新增控件（既有布局已含相同 id）" }); continue; }
      files.push({ path: target, content: merged.content, kind: "xml", overwrite: true });
      notes.push(`布局合并：${target} 追加 ${merged.added} 个控件（既有 id 未动）`);
      continue;
    }

    // 4) strings.xml 合并
    if (/\/res\/values\/strings\.xml$/.test(rel)) {
      const target = rel.startsWith("app/") ? `${module}/${rel.slice(4)}` : rel;
      const abs = join(root, target);
      if (!existsSync(abs)) { files.push({ path: target, content: f.content, kind: "xml" }); continue; }
      const merged = mergeStrings(readFileSync(abs, "utf8"), f.content);
      if (!merged) { skipped.push({ path: target, reason: "既有 strings.xml 结构异常（需人工）" }); continue; }
      if (!merged.added) { skipped.push({ path: target, reason: "无新增字符串" }); continue; }
      files.push({ path: target, content: merged.content, kind: "xml", overwrite: true });
      notes.push(`字符串合并：${target} 追加 ${merged.added} 条（既有未动）`);
      continue;
    }

    // 5) AndroidManifest 合并
    if (/\/AndroidManifest\.xml$/.test(rel)) {
      const target = rel.startsWith("app/") ? `${module}/${rel.slice(4)}` : rel;
      const abs = join(root, target);
      if (!existsSync(abs)) { files.push({ path: target, content: f.content, kind: "xml" }); continue; }
      const merged = mergeManifest(readFileSync(abs, "utf8"), f.content);
      if (!merged) { skipped.push({ path: target, reason: "既有 Manifest 结构异常（需人工）" }); continue; }
      if (!merged.added) { skipped.push({ path: target, reason: "无新增组件声明" }); continue; }
      files.push({ path: target, content: merged.content, kind: "xml", overwrite: true });
      notes.push(`Manifest 合并：${target} 追加 ${merged.added} 条组件声明（既有未动）`);
      continue;
    }

    // 6) 其余（styles.xml 等）：既有则跳过（避免覆盖主题），否则新建
    const target = rel.startsWith("app/") ? `${module}/${rel.slice(4)}` : rel;
    if (existsSync(join(root, target))) { skipped.push({ path: target, reason: "目标已存在（不覆盖）" }); continue; }
    files.push({ path: target, content: f.content, kind: f.kind });
  }
  return { files, skipped, notes, module };
}
