/**
 * 增量补丁引擎（二期 `REQ-PATCH-001` / `F18` · `D3`）—— **在登记工程根内写入增量改动**。
 *
 * 定位：greenfield 走「AI 生成整包工程」（`codegen.ts`）；brownfield 走本模块 ——
 * 把生成物当作**补丁集**写回用户在 `#73` 登记的既有工程根。
 *
 * 安全边界（逐条对应 `D3` 与 `平台需求概要 §13.C`）：
 *  1. **只写登记工程根内**：相对路径 + 越界（`..`/绝对/盘符）一律拒绝；
 *  2. **硬禁碰**：`gradle/wrapper/**`、`gradlew(.bat)`、`local.properties`、签名文件、`.git/**`、`.gradle/**` —— 一律拒绝（改这些会让工程不可用）；
 *  3. **冲突不静默覆盖**：目标已存在且内容不同 → **整批拒绝**，需显式 `overwrite:true`；
 *  4. **写前快照**：被替换的文件先复制到平台侧备份目录；创建的文件登记在案；
 *  5. **原子落盘**：先写临时文件再 `rename`（`D-A16`），任务中断不留半成品；
 *  6. **既有 id 不可静默删除**：替换 `res/layout/*.xml` 时，若新内容**丢失**了旧内容里的 `@+id/*` → 拒绝，需显式 `allow_id_removal:true`（`L1` 引用完整性）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError } from "../core/envelope.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PATCH_DIR = process.env.AD_PATCH_DIR ?? join(here, "..", "..", "data", "patch-backups");

export interface PatchFile { path: string; content: string; kind?: string; overwrite?: boolean; allow_id_removal?: boolean }
export interface PatchEntry {
  path: string; action: "create" | "replace" | "unchanged";
  existed: boolean; bytes: number; backup_rel: string | null; removed_ids: string[];
}
export interface PatchPlan {
  patch_id: string; project_id: string; root: string; message: string;
  created_at: string; status: "applied" | "rolled_back"; rolled_back_at?: string;
  entries: PatchEntry[];
  totals: { create: number; replace: number; unchanged: number; bytes: number };
}

/** 硬禁碰（相对工程根的 POSIX 路径） */
export const FORBIDDEN_PATTERNS: RegExp[] = [
  /^gradle\/wrapper(\/|$)/i,
  /^gradlew(\.bat)?$/i,
  /^local\.properties$/i,
  /\.(jks|keystore|pepk)$/i,
  /^\.git(\/|$)/i,
  /^\.gradle(\/|$)/i,
  /^\.idea(\/|$)/i,
];

export function isForbiddenPath(rel: string): RegExp | null {
  for (const re of FORBIDDEN_PATTERNS) if (re.test(rel)) return re;
  return null;
}

/** 校验相对路径：合法 + 不越界 + 非禁碰；返回归一化后的相对路径 */
export function assertPatchPath(rel: unknown): string {
  const p = typeof rel === "string" ? rel.trim().replace(/\\/g, "/") : "";
  if (!p || p.length > 240) throw new ApiError("INVALID_ARGUMENT", "补丁路径不合法。");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) throw new ApiError("INVALID_ARGUMENT", `补丁路径必须是工程内的相对路径：${p}`);
  const segs = p.split("/");
  if (segs.some((s) => !s || s === "." || s === "..")) throw new ApiError("INVALID_ARGUMENT", `补丁路径越界：${p}`);
  if (!/^[A-Za-z0-9_./-]+$/.test(p)) throw new ApiError("INVALID_ARGUMENT", `补丁路径含非法字符：${p}`);
  const hit = isForbiddenPath(p);
  if (hit) throw new ApiError("INVALID_ARGUMENT", `该路径属硬禁碰（${hit.source}），平台不写：${p}`);
  return p;
}

/** 目标绝对路径必须落在工程根内（双保险：归一化后再比对） */
export function resolveInside(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const prefix = resolve(root) + sep;
  if (!abs.startsWith(prefix)) throw new ApiError("INVALID_ARGUMENT", `补丁路径越界：${rel}`);
  return abs;
}

function extractIds(xml: string): Set<string> {
  return new Set([...xml.matchAll(/@\+id\/([A-Za-z0-9_]+)/g)].map((m) => m[1]!));
}

export interface ApplyOptions {
  root: string; projectId: string; patchId: string; files: PatchFile[];
  message?: string; /** 总开关：允许整批覆盖已存在且不同的文件 */ overwriteAll?: boolean;
}

/** 预检（**不落盘**）：路径 / 禁碰 / 冲突 / id 删除 / 体积 */
export function planPatch(opts: ApplyOptions): PatchEntry[] {
  const { root, files } = opts;
  if (!Array.isArray(files) || !files.length) throw new ApiError("INVALID_ARGUMENT", "补丁集为空。");
  if (files.length > 200) throw new ApiError("INVALID_ARGUMENT", "单次补丁文件数超过上限（200）。");
  let bytes = 0;
  const seen = new Set<string>();
  const entries: PatchEntry[] = [];
  for (const f of files) {
    const rel = assertPatchPath(f?.path);
    const key = rel.toLowerCase();
    if (seen.has(key)) throw new ApiError("INVALID_ARGUMENT", `补丁内路径重复（大小写不敏感）：${rel}`);
    seen.add(key);
    if (typeof f?.content !== "string" || f.content.includes("\0")) throw new ApiError("INVALID_ARGUMENT", `补丁内容不合法：${rel}`);
    bytes += Buffer.byteLength(f.content);
    if (bytes > 4 * 1024 * 1024) throw new ApiError("INVALID_ARGUMENT", "补丁集超过 4MB 上限。");
    const abs = resolveInside(root, rel);
    const existed = existsSync(abs);
    if (!existed) { entries.push({ path: rel, action: "create", existed: false, bytes: Buffer.byteLength(f.content), backup_rel: null, removed_ids: [] }); continue; }
    let old = "";
    try { old = readFileSync(abs, "utf8"); } catch { throw new ApiError("INVALID_ARGUMENT", `目标文件不可读：${rel}`); }
    if (old === f.content) { entries.push({ path: rel, action: "unchanged", existed: true, bytes: 0, backup_rel: null, removed_ids: [] }); continue; }
    if (!(f.overwrite === true || opts.overwriteAll === true))
      throw new ApiError("VERSION_CONFLICT", `目标文件已存在且内容不同：${rel}。如需覆盖请显式带 overwrite:true（整批拒绝，未写入任何文件）。`);
    // L1 引用完整性：替换 res/layout/*.xml 时不得静默丢失既有 @+id
    let removed: string[] = [];
    if (/\/res\/layout\/[^/]+\.xml$/i.test(rel) || /^res\/layout\/[^/]+\.xml$/i.test(rel)) {
      const before = extractIds(old), after = extractIds(f.content);
      removed = [...before].filter((id) => !after.has(id));
      if (removed.length && f.allow_id_removal !== true)
        throw new ApiError("INVALID_ARGUMENT",
          `替换 ${rel} 会丢失既有控件 id：${removed.join("、")}（会破坏既有 findViewById/绑定）。如确需删除请显式带 allow_id_removal:true。`);
    }
    entries.push({ path: rel, action: "replace", existed: true, bytes: Buffer.byteLength(f.content), backup_rel: null, removed_ids: removed });
  }
  return entries;
}

/** 应用补丁：快照 → 原子写 → 返回 manifest（失败中途回滚已写文件） */
export function applyPatch(opts: ApplyOptions): PatchPlan {
  const { root, projectId, patchId, files } = opts;
  const entries = planPatch(opts);
  const backupRoot = join(PATCH_DIR, patchId);
  const contentOf = new Map<string, string>();
  for (const f of files) contentOf.set(assertPatchPath(f.path), f.content);
  const done: PatchEntry[] = [];
  try {
    for (const e of entries) {
      if (e.action === "unchanged") { done.push(e); continue; }
      const abs = resolveInside(root, e.path);
      if (e.action === "replace") {
        const rel = join(e.path);                 // 备份保持相对结构
        const bak = join(backupRoot, rel);
        mkdirSync(dirname(bak), { recursive: true });
        copyFileSync(abs, bak);
        e.backup_rel = rel;
      }
      mkdirSync(dirname(abs), { recursive: true });
      const tmp = `${abs}.ad-tmp-${patchId}`;
      writeFileSync(tmp, contentOf.get(e.path)!, "utf8");
      renameSync(tmp, abs);
      if (statSync(abs).size !== Buffer.byteLength(contentOf.get(e.path)!))
        throw new ApiError("INTERNAL", `写入校验失败：${e.path}`);
      done.push(e);
    }
  } catch (err) {
    // 中途失败 → 回滚本次已写文件（**不留半成品**）
    for (const e of done) {
      try {
        const abs = resolveInside(root, e.path);
        if (e.action === "replace" && e.backup_rel) copyFileSync(join(backupRoot, e.backup_rel), abs);
        else if (e.action === "create") rmSync(abs, { force: true });
      } catch { /* 尽力回滚 */ }
    }
    throw err;
  }
  const totals = { create: 0, replace: 0, unchanged: 0, bytes: 0 };
  for (const e of done) { totals[e.action] += 1; totals.bytes += e.bytes; }
  return {
    patch_id: patchId, project_id: projectId, root, message: opts.message ?? "",
    created_at: new Date().toISOString(), status: "applied", entries: done, totals,
  };
}

/** 回滚：replace → 还原备份；create → 删除（文件与目录都不留空壳） */
export function rollbackPatch(plan: PatchPlan): { restored: number; removed: number } {
  const backupRoot = join(PATCH_DIR, plan.patch_id);
  let restored = 0, removed = 0;
  for (const e of plan.entries) {
    const abs = resolveInside(plan.root, e.path);
    if (e.action === "replace" && e.backup_rel) {
      const bak = join(backupRoot, e.backup_rel);
      if (!existsSync(bak)) throw new ApiError("INTERNAL", `备份缺失，无法回滚：${e.path}`);
      mkdirSync(dirname(abs), { recursive: true });
      copyFileSync(bak, abs); restored += 1;
    } else if (e.action === "create") {
      rmSync(abs, { force: true }); removed += 1;
    }
  }
  return { restored, removed };
}

/** 备份目录（供测试/排查） */
export function patchBackupRoot(patchId: string): string { return join(PATCH_DIR, patchId); }
