/**
 * 上传文件的落盘层。
 *
 * 约定：**文件以系统 id 存储**（`E3 UploadFile`：以系统 id 存储，不用原始文件名做路径 ——
 * 避免路径穿越、避免中文名/同名冲突），原始文件名只作为元数据保存在 `tbl_upload_file.file_name`。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.AD_UPLOAD_DIR ?? join(here, "..", "..", "data", "uploads");

mkdirSync(UPLOAD_DIR, { recursive: true });

/** 只允许系统 id 作为文件名（防御路径穿越） */
function pathOf(uploadId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) throw new Error("illegal upload id");
  return join(UPLOAD_DIR, uploadId);
}

export function saveUpload(uploadId: string, buf: Buffer): void {
  writeFileSync(pathOf(uploadId), buf);
}

export function readUpload(uploadId: string): Buffer {
  return readFileSync(pathOf(uploadId));
}

export function deleteUpload(uploadId: string): void {
  try { rmSync(pathOf(uploadId)); } catch { /* 幂等 */ }
}
