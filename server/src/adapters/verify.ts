/** L1 only: XML parsing + project structure + identity + style ranges + resource references.
 * Never invokes Gradle, Kotlin, Android, OCR or image processing. No generated source enters diagnostics.
 * Python3's standard-library ElementTree is used via stdin; missing parser fails closed.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { CodeFile } from "./codegen.ts";
import { activeNodes, ANDROID_CLASSES, androidId, checkedStyle, normalizeElementId, validateCodeFiles, WRAPPER_JAR_SHA256, WRAPPER_SHA256 } from "./codegen.ts";

interface XmlNode { tag: string; attrs: Record<string, string>; text: string; parent: number }
interface ParsedXml { path: string; nodes: XmlNode[] }
interface Rule { rule: string; ok: boolean; detail?: string }
const ANDROID = "{http://schemas.android.com/apk/res/android}";
const APP = "{http://schemas.android.com/apk/res-auto}";
const RULE_NAMES = ["xml_syntax", "project_structure", "element_id_bijection", "style_ranges", "resource_references"];
const PARSER = String.raw`
import sys,json,re,xml.etree.ElementTree as ET
out=[]
try:
    files=json.load(sys.stdin)
    for f in files:
        src=f['content']
        if re.search(r'<!\s*(DOCTYPE|ENTITY)\b',src,re.I): raise ValueError('DTD disabled')
        root=ET.fromstring(src.encode('utf-8'))
        nodes=[]
        def walk(e,parent,depth):
            if depth>256 or len(nodes)>20000: raise ValueError('XML bounds')
            i=len(nodes)
            nodes.append({'tag':e.tag,'attrs':e.attrib,'text':e.text or '', 'parent':parent})
            for c in e: walk(c,i,depth+1)
        walk(root,-1,0)
        out.append({'path':f['path'],'nodes':nodes})
    print(json.dumps({'ok':True,'files':out}))
except Exception:
    print(json.dumps({'ok':False}))
`;
function parseXml(files: CodeFile[]): { files: ParsedXml[]; detail?: string } {
  const xml = files.filter(f => f.path.endsWith(".xml"));
  if (!xml.length) return { files: [], detail: "工程中没有 XML，无法校验。" };
  const result = spawnSync("python3", ["-I", "-c", PARSER], {
    input: JSON.stringify(xml.map(f => ({ path: f.path, content: f.encoding === "base64" ? Buffer.from(f.content, "base64").toString("utf8") : f.content }))),
    encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024,
    // Never forward parser stderr (which might contain source fragments).
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return { files: [], detail: "Python3 XML 解析器缺失、超时或不可用；请主 Agent 提供 Python3。" };
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed.ok ? { files: parsed.files } : { files: [], detail: "XML 语法不合法或包含禁用 DTD/实体声明。" };
  } catch { return { files: [], detail: "XML 解析器未返回有效结果。" }; }
}
const decode = (f: CodeFile) => f.encoding === "base64" ? Buffer.from(f.content, "base64").toString("utf8") : f.content;
const resLocation = (path: string) => /(?:^|\/)src\/main\/res\/([^/]+)\/([^/]+)$/.exec(path);
const layoutFile = (path: string) => resLocation(path)?.[1]?.split("-")[0] === "layout";
const className = (tag: string) => tag.includes(".") ? tag : tag === "View" ? "android.view.View" : `android.widget.${tag}`;
const stripKotlin = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");

function projectStructure(files: CodeFile[], xml: ParsedXml[]): boolean {
  const byPath = new Map(files.map(f => [f.path, f]));
  const required = ["settings.gradle.kts", "build.gradle.kts", "app/build.gradle.kts", "gradle.properties", "gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.jar", "gradle/wrapper/gradle-wrapper.properties", "app/src/main/AndroidManifest.xml", "dependency-versions.json"];
  if (required.some(p => !byPath.has(p) || !byPath.get(p)!.content.trim())) return false;
  const jar = byPath.get("gradle/wrapper/gradle-wrapper.jar")!;
  if (jar.encoding !== "base64" || createHash("sha256").update(Buffer.from(jar.content, "base64")).digest("hex") !== WRAPPER_JAR_SHA256) return false;
  for (const [path, digest] of Object.entries(WRAPPER_SHA256)) {
    const f = byPath.get(path)!;
    const bytes = f.encoding === "base64" ? Buffer.from(f.content, "base64") : Buffer.from(f.content);
    if (createHash("sha256").update(bytes).digest("hex") !== digest) return false;
  }
  if (!decode(byPath.get("gradlew")!).startsWith("#!/bin/sh") || !decode(byPath.get("gradlew")!).includes("org.gradle.wrapper.GradleWrapperMain") || !decode(byPath.get("gradlew.bat")!).includes("org.gradle.wrapper.GradleWrapperMain")) return false;
  const props = decode(byPath.get("gradle/wrapper/gradle-wrapper.properties")!);
  if (!/^distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-8\.9-bin\.zip\s*$/m.test(props)
      || !/^distributionSha256Sum=d725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab\s*$/m.test(props)) return false;
  const manifest = xml.find(f => f.path === "app/src/main/AndroidManifest.xml");
  if (manifest?.nodes[0]?.tag !== "manifest" || !manifest.nodes.some(n => n.tag === "application")) return false;
  const activities = manifest.nodes.filter(n => n.tag === "activity");
  if (!activities.length || !xml.some(f => layoutFile(f.path))) return false;
  const kt = files.filter(f => /app\/src\/main\/(?:java|kotlin)\/.+\.kt$/.test(f.path));
  if (!kt.length || !kt.some(f => /\bclass\s+\w+/.test(stripKotlin(decode(f))))) return false;
  const appBuild = decode(byPath.get("app/build.gradle.kts")!);
  const namespace = /\bnamespace\s*=\s*"([\w.]+)"/.exec(appBuild)?.[1];
  if (!namespace || !/com\.android\.application/.test(appBuild) || !/org\.jetbrains\.kotlin\.android/.test(appBuild) || !/include\(\s*":app"\s*\)/.test(decode(byPath.get("settings.gradle.kts")!))) return false;
  if (!activities.every(a => {
    const name = a.attrs[ANDROID + "name"];
    if (!name) return false;
    const qualified = name.startsWith(".") ? namespace + name : name.includes(".") ? name : namespace + "." + name;
    const split = qualified.lastIndexOf("."), pkg = qualified.slice(0, split), cls = qualified.slice(split + 1);
    return /^[A-Za-z_]\w*$/.test(cls) && kt.some(f => {
      const source = stripKotlin(decode(f));
      return new RegExp(`\\bclass\\s+${cls}\\b`).test(source) && new RegExp(`\\bpackage\\s+${pkg.replace(/\./g, "\\.")}\\b`).test(source);
    });
  })) return false;
  try {
    const v = JSON.parse(decode(byPath.get("dependency-versions.json")!));
    if (v.gradle !== "8.9" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v.agp) || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v.kotlin) || !v.direct || !Object.keys(v.direct).length) return false;
    const rootBuild = decode(byPath.get("build.gradle.kts")!);
    if (!rootBuild.includes(`version "${v.agp}"`) || !rootBuild.includes(`version "${v.kotlin}"`)) return false;
    if (!Object.entries(v.direct).every(([name, version]) => typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) && appBuild.includes(`"${name}:${version}"`))) return false;
  } catch { return false; }
  return true;
}

function bijection(nodes: any[], xml: ParsedXml[]): boolean {
  const expected = new Map(nodes.map(n => [androidId(n.element_id), n]));
  const found = new Set<string>(), allIds = new Set<string>();
  for (const file of xml.filter(f => layoutFile(f.path))) for (const n of file.nodes) {
    const raw = n.attrs[ANDROID + "id"], tag = n.attrs[ANDROID + "tag"];
    if (tag?.toUpperCase().startsWith("EL-") && !raw) return false;
    if (!raw) continue;
    const match = /^@\+?id\/([a-z][a-z0-9_]*)$/.exec(raw);
    if (!match || allIds.has(match[1]!)) return false;
    const id = match[1]!; allIds.add(id);
    const element = expected.get(id);
    if (!element) { if (id.startsWith("el_") || tag?.toUpperCase().startsWith("EL-")) return false; continue; }
    if (found.has(id) || className(n.tag === "view" ? n.attrs.class ?? "" : n.tag) !== className(ANDROID_CLASSES[element.widget_type]!)) return false;
    if (tag !== undefined && normalizeElementId(tag) !== normalizeElementId(element.element_id)) return false;
    found.add(id);
  }
  return found.size === expected.size;
}

function stylesInRange(nodes: any[], xml: ParsedXml[]): boolean {
  for (const n of nodes) checkedStyle(n);
  const literals = new Map<string, string>();
  for (const f of xml) if (resLocation(f.path)?.[1]?.split("-")[0] === "values") for (const n of f.nodes) {
    if (["dimen", "color", "integer"].includes(n.tag) && n.attrs.name) literals.set(`${n.tag}/${n.attrs.name}`, n.text.trim());
  }
  const resolve = (v: string, seen = new Set<string>()): string => {
    if (!v.startsWith("@")) return v;
    const key = v.slice(1); if (seen.has(key) || !literals.has(key)) return v;
    seen.add(key); return resolve(literals.get(key)!, seen);
  };
  const range = (v: string, min: number, max: number, unit: string, integer = true) => {
    const m = new RegExp(`^(-?\\d+(?:\\.\\d+)?)${unit}$`).exec(resolve(v));
    return !!m && Number(m[1]) >= min && Number(m[1]) <= max && (!integer || Number.isInteger(Number(m[1])));
  };
  for (const file of xml) for (const n of file.nodes) {
    if (n.tag === "color" && resLocation(file.path)?.[1]?.split("-")[0] === "values" && !/^#[0-9a-f]{6}$/i.test(resolve(n.text.trim()))) return false;
    const attributes = Object.entries(n.attrs);
    if (n.tag === "item" && n.attrs.name?.startsWith("android:")) attributes.push([ANDROID + n.attrs.name.slice(8), n.text.trim()]);
    for (const [key, value] of attributes) {
    if (!key.startsWith(ANDROID) && !key.startsWith(APP)) continue;
    const k = key.slice(key.indexOf("}") + 1);
    if (["layout_width", "layout_height"].includes(k) && !["wrap_content", "match_parent", "fill_parent"].includes(value) && !range(value, 1, 2000, "dp")) {
      // 0dp is legal only as Android weight / ConstraintLayout match-constraint semantics.
      if (value !== "0dp" || !(n.attrs[ANDROID + "layout_weight"] || Object.keys(n.attrs).some(a => a.startsWith(APP + "layout_constraint")))) return false;
    }
    if (/^(padding(?:Top|Right|Bottom|Left|Start|End)?|layout_margin(?:Top|Right|Bottom|Left|Start|End)?|radius|topLeftRadius|topRightRadius|bottomLeftRadius|bottomRightRadius|cardCornerRadius)$/.test(k) && !range(value, 0, 200, "dp")) return false;
    if (k === "textSize" && !range(value, 8, 72, "sp")) return false;
    if (k === "alpha" && !range(value, 0, 1, "", false)) return false;
    if (n.tag === "stroke" && k === "width" && !range(value, 0, 10, "dp")) return false;
    if (["textColor", "color", "cardBackgroundColor"].includes(k) && !/^#[0-9a-f]{6}$/i.test(resolve(value))) return false;
    if (k === "background" && !value.startsWith("@drawable/") && !/^#[0-9a-f]{6}$/i.test(resolve(value))) return false;
    if (k === "visibility" && !["visible", "invisible", "gone"].includes(value)) return false;
    }
  }
  return true;
}

function resourceReferences(files: CodeFile[], xml: ParsedXml[]): boolean {
  const declarations = new Set<string>(), refs = new Set<string>(), styleParents = new Set<string>();
  const addRef = (v: string) => {
    // Framework references belong to Android SDK, not project resources.
    if (/^[@?](?:\+)?android:/.test(v) || v === "@null" || v === "@empty") return;
    const m = /^[@?](\+)?(?:([\w.]+):)?([A-Za-z_][\w]*)\/([A-Za-z_][\w.]*)$/.exec(v);
    if (!m) { if (/^[@?]/.test(v) && !v.startsWith("\\")) refs.add("INVALID_REFERENCE"); return; }
    if (m[2]) { refs.add("UNSUPPORTED_EXTERNAL_REFERENCE"); return; }
    const key = `${m[3]}/${m[4]}`;
    if (m[1] && m[3] === "id") declarations.add(key); else refs.add(key);
  };
  for (const file of files) {
    const location = resLocation(file.path);
    if (location) {
      const type = location[1]!.split("-")[0]!;
      if (type !== "values") {
        const name = location[2]!.replace(/\.9\.png$/, "").replace(/\.[^.]+$/, "");
        if (!/^[a-z][a-z0-9_]*$/.test(name)) return false;
        declarations.add(`${type}/${name}`);
      }
    }
    if (file.path.endsWith(".kt")) {
      const source = stripKotlin(decode(file));
      for (const m of source.matchAll(/\bR\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\b/g)) {
        if (source.slice(Math.max(0, m.index! - 8), m.index).endsWith("android.")) continue;
        refs.add(`${m[1]}/${m[2]}`);
      }
    }
  }
  for (const file of xml) {
    const location = resLocation(file.path), values = location?.[1]?.split("-")[0] === "values";
    if (values && file.nodes[0]?.tag !== "resources") return false;
    const inFile = new Set<string>();
    for (const n of file.nodes) {
      if (values && n.parent === 0 && n.attrs.name) {
        const type = n.tag === "item" ? n.attrs.type : n.tag === "string-array" || n.tag === "integer-array" ? "array" : n.tag === "declare-styleable" ? "styleable" : n.tag;
        const key = `${type}/${n.attrs.name}`;
        if (!type || inFile.has(key)) return false;
        inFile.add(key); declarations.add(key);
      }
      if (values && n.tag === "attr" && n.attrs.name && !n.attrs.name.startsWith("android:")) declarations.add(`attr/${n.attrs.name}`);
      for (const [k, v] of Object.entries(n.attrs)) {
        if (k.startsWith("{http://schemas.android.com/tools}")) continue;
        if (v.startsWith("@") || v.startsWith("?")) addRef(v);
      }
      if (values && /^[@?]/.test(n.text.trim())) addRef(n.text.trim());
      if (n.tag === "style" && n.attrs.parent && !n.attrs.parent.startsWith("@")) styleParents.add(n.attrs.parent);
    }
  }
  // Only explicitly known dependency-provided symbols are exempt; no blanket missing-resource pass.
  const appBuild = files.find(f => f.path === "app/build.gradle.kts");
  const material = !!appBuild && /"com\.google\.android\.material:material:1\.12\.0"/.test(decode(appBuild));
  const dependencyStyles = new Set(material ? ["Theme.MaterialComponents.DayNight.NoActionBar"] : []);
  for (const p of styleParents) {
    if (p.startsWith("android:")) continue;
    if (!declarations.has(`style/${p}`) && !dependencyStyles.has(p)) return false;
  }
  for (const r of refs) if (!declarations.has(r) && !(r.startsWith("style/") && dependencyStyles.has(r.slice(6)))) return false;
  return true;
}

export function verifyL1(tree: any[], files: CodeFile[]): { passed: boolean; rules: { rule: string; ok: boolean; detail?: string }[]; log_digest: string } {
  const rules: Rule[] = [];
  let safeFiles: CodeFile[] = [], nodes: any[] = [], validFiles = true, validTree = true;
  try { safeFiles = validateCodeFiles(files); } catch { validFiles = false; }
  try { nodes = activeNodes(tree); } catch { validTree = false; }
  const parsed = validFiles ? parseXml(safeFiles) : { files: [], detail: "CodeFile 结构、编码、路径或大小不合法。" };
  const xmlOk = !parsed.detail;
  rules.push({ rule: RULE_NAMES[0]!, ok: xmlOk, detail: parsed.detail ?? `ElementTree 已解析 ${parsed.files.length} 个 XML（禁用 DTD/实体）。` });
  const check = (rule: string, fn: () => boolean, success: string, failure: string) => {
    let ok = false; try { ok = fn(); } catch { /* do not expose input/source/error text */ }
    rules.push({ rule, ok, detail: ok ? success : failure });
  };
  check(RULE_NAMES[1]!, () => validFiles && xmlOk && projectStructure(safeFiles, parsed.files), "工程入口、布局、Kotlin 类、固定版本清单及官方完整 wrapper 静态存在。", "工程结构、入口、固定版本清单或官方 wrapper 资源不完整/不一致。");
  check(RULE_NAMES[2]!, () => validTree && xmlOk && bijection(nodes, parsed.files), `正式元素与 Android 类/布局 ID 一一对应，共 ${nodes.length} 项。`, "元素树无效、正式 ID 缺失/重复/额外，或 Android 类与控件不一致。");
  check(RULE_NAMES[3]!, () => validTree && xmlOk && stylesInRange(nodes, parsed.files), "输入 E7/UI 样式与生成 XML 数值范围静态检查通过。", "输入样式或 XML 样式取值超范围、不合法或无法静态解析。");
  check(RULE_NAMES[4]!, () => validFiles && xmlOk && resourceReferences(safeFiles, parsed.files), "XML/Kotlin 显式资源引用均有声明或属于明确的 SDK/锁定库白名单。", "资源缺失、非法/不支持的引用或声明重复；无法证明引用完整。");
  const passed = rules.every(r => r.ok);
  const summary = rules.map(r => `${r.rule}=${r.ok ? "pass" : "fail"}`).join(";");
  // Summary contains counts/results only, never generated content, parser stderr, PRD, URLs or secrets.
  return { passed, rules, log_digest: `L1-static:${passed ? "passed" : "failed"};${summary};Kotlin_compile=not_run;L2=not_reported;sha256=${createHash("sha256").update(summary).digest("hex")}` };
}
