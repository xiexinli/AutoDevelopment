/**
 * 文档解析适配器 —— `#12` 触发解析的实体。
 *
 * 支持两种来源：
 *  - **`.md`**：直接按 Markdown 解析（正文 + 表格）；
 *  - **`.docx`**：`.docx` 就是一个 ZIP，内含 `word/document.xml`。本文件用 `node:zlib`
 *    手写**最小 ZIP 读取器**（只读中央目录 + 本地头 + `deflateRaw`），
 *    **零外部依赖、零原生编译**，真实提取 `<w:t>` 文本与 `<w:tbl>` 表格。
 *
 * 分块结果（`parts{}`）与前端上传页的四行进度一一对应：正文 / 内嵌表格 / 白板图 / 附件。
 * **部分失败不阻断其余**（`§0.6 D-A23`）—— 某个分块失败只把该项标 `failed`，整体置 `partial`。
 */
import { inflateRawSync } from "node:zlib";
import { ApiError } from "../core/envelope.ts";

export interface ParsedParts {
  body: { status: "ok" | "failed" | "skipped"; chars?: number };
  tables: { token: string; status: "ok" | "failed" | "skipped" }[];
  whiteboards: { token: string; status: "ok" | "failed" | "skipped" }[];
  attachments: { name: string; status: "ok" | "failed" | "skipped" }[];
}

export interface ParseResult {
  parseStatus: "succeeded" | "partial" | "failed";
  emptyDocument: boolean;
  parts: ParsedParts;
  markdown: string;
  title: string;
}

// ---------------- 最小 ZIP 读取器（只用到 EOCD + 中央目录 + 本地头） ----------------

interface ZipEntry { name: string; method: number; localOffset: number; compressedSize: number }

function readZipEntries(buf: Buffer): ZipEntry[] {
  // 1) 从尾部找 End of Central Directory（签名 0x06054b50），最多回退 64KB（含注释）
  const maxBack = Math.min(buf.length, 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ApiError("FORMAT_UNSUPPORTED", "这个文件不是有效的 .docx（找不到 ZIP 目录）。");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // 中央目录起始偏移

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (p+46>buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ApiError("FORMAT_UNSUPPORTED", "压缩包目录损坏。"); // 中央目录头签名
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({ name, method, localOffset, compressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const p = entry.localOffset;
  if (p+30>buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new ApiError("FORMAT_UNSUPPORTED", "压缩包结构异常。");
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  if (dataStart+entry.compressedSize>buf.length) throw new ApiError("FORMAT_UNSUPPORTED", "压缩包内容不完整。");
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);          // stored
  if (entry.method === 8) return inflateRawSync(raw, {maxOutputLength: 20*1024*1024});        // deflate
  throw new ApiError("FORMAT_UNSUPPORTED", "暂不支持这种压缩方式。");
}

// ---------------- .docx → 文本 / 表格 ----------------

/**
 * 从 `word/document.xml` 提取段落文本与表格（`<w:tbl>` → Markdown 表），**保持原始顺序**。
 *
 * 两个必须小心的点（都是真实踩过的坑）：
 *  1. 取文本的正则要用 `<w:t(?:\\s[^>]*)?>` —— 写成 `<w:t[^>]*>` 会**先匹配到 `<w:tbl>` / `<w:tr>` / `<w:tc>`**，
 *     把整段 XML 当成文本抓出来；
 *  2. 表格所在的 `<w:p>` 段落里，**表格之后往往还跟着下一个标题的段落**（该段落在下一个 `</w:p>` 才闭合），
 *     所以「含表格的段落」不能整段丢弃，必须把占位符两侧的文本也处理掉。
 */
function docxToMarkdown(xml: string): { markdown: string; tableCount: number } {
  const decode = (s: string) => s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

  /** 取一段 XML 里的可见文本（**只认 `<w:t>`**，不认 `<w:tbl>` / `<w:tc>`） */
  const textsOf = (frag: string): string =>
    [...frag.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decode(m[1] ?? "")).join("");

  // 1) 把表格整段挖出来，原位放占位符（不会与正文冲突）
  const tables: string[] = [];
  const withMarkers = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (m) => {
    tables.push(m);
    return ` TBL${tables.length - 1} `;
  });

  const tableToMd = (tbl: string): string[] => {
    const rows = [...tbl.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) =>
      [...(r[0] ?? "").matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) =>
        textsOf(c[0] ?? "").trim().replace(/\|/g, "/")),
    ).filter((cells) => cells.length > 0 && cells.some((c) => c !== ""));
    if (!rows.length) return [];
    const cols = Math.max(...rows.map((r) => r.length));
    const pad = (cells: string[]) => [...cells, ...Array(Math.max(0, cols - cells.length)).fill("")];
    const head = rows[0]!;
    const rest = rows.slice(1);
    return [
      `| ${pad(head).join(" | ")} |`,
      `|${" --- |".repeat(cols)}`,
      ...rest.map((c) => `| ${pad(c).join(" | ")} |`),
    ];
  };

  const out: string[] = [];
  // 2) 先按段落切；再把每段按表格占位符切开，**占位符两侧的文本都要保留**
  for (const seg of withMarkers.split(/<\/w:p>/)) {
    const pieces = seg.split(/ TBL(\d+) /);
    for (let i = 0; i < pieces.length; i += 1) {
      if (i % 2 === 1) { out.push(...tableToMd(tables[Number(pieces[i])] ?? "")); continue; }
      const frag = pieces[i] ?? "";
      const text = textsOf(frag);
      if (!text.trim()) continue;
      const lvl = frag.match(/<w:pStyle[^>]*w:val="[^"]*[Hh]eading([1-6])/)?.[1];
      out.push(lvl ? `${"#".repeat(Number(lvl))} ${text.trim()}` : text.trim());
    }
  }

  return { markdown: out.join("\n\n").replace(/(\|[^\n]*\|)\n\n(?=\|)/g, "$1\n"), tableCount: tables.length };
}

// ---------------- 对外入口 ----------------

const NAME_RE = /\.(docx|md)$/i;

export function assertSupportedFormat(fileName: string): void {
  if (!NAME_RE.test(fileName)) {
    throw new ApiError("FORMAT_UNSUPPORTED", "暂不支持该格式。请上传 .docx / .md 或飞书云文档链接。");
  }
}

export function assertSizeOk(sizeBytes: number): void {
  const LIMIT = 20 * 1024 * 1024;
  if (sizeBytes > LIMIT) {
    throw new ApiError("PAYLOAD_TOO_LARGE",
      `文件超过 20MB（当前 ${(sizeBytes / 1048576).toFixed(1)}MB）。请压缩后重试。`);
  }
}

/** 解析入口：按扩展名分派；**空白文档不算失败**（`empty_document = true`） */
export function parseDocument(fileName: string, buf: Buffer): ParseResult {
  assertSupportedFormat(fileName);
  if (/\.docx$/i.test(fileName)) return parseDocx(buf, fileName);
  return parseMarkdown(buf.toString("utf8"), fileName);
}

function finish(markdown: string, title: string, parts: ParsedParts): ParseResult {
  const empty = markdown.replace(/\s/g, "").length === 0;
  if (empty) {
    return { parseStatus: "succeeded", emptyDocument: true,
      parts: { body: { status: "skipped" }, tables: [], whiteboards: [], attachments: [] }, markdown: "", title };
  }
  const anyFailed = parts.body.status === "failed"
    || parts.tables.some((t) => t.status === "failed")
    || parts.whiteboards.some((t) => t.status === "failed")
    || parts.attachments.some((t) => t.status === "failed");
  return { parseStatus: anyFailed ? "partial" : "succeeded", emptyDocument: false, parts, markdown, title };
}

function titleOf(markdown: string, fallback: string): string {
  const h = markdown.match(/^\s*#\s+(.+)$/m);
  return (h?.[1] ?? fallback).trim().slice(0, 80);
}

function parseMarkdown(text: string, fileName: string): ParseResult {
  // 内嵌表格：Markdown 表格（`| a | b |` 且下一行是分隔行）
  const lines = text.split(/\r?\n/);
  const tables: { token: string; status: "ok" | "failed" | "skipped" }[] = [];
  let ti = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    const cur = lines[i] ?? ""; const next = lines[i + 1] ?? "";
    if (/^\s*\|.*\|\s*$/.test(cur) && /^\s*\|[\s:|-]+\|\s*$/.test(next)) { ti += 1; tables.push({ token: `tbl_${ti}`, status: "ok" }); }
  }
  // 附件：Markdown 图片 / 链接引用
  const attachments = [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
    .map((m) => ({ name: (m[1] ?? "").split("/").pop() ?? "attachment", status: "failed" as const }));

  const title = titleOf(text, fileName.replace(NAME_RE, ""));
  return finish(text, title, {
    body: { status: "ok", chars: [...text].length },
    tables,
    whiteboards: [{ token: "wb_none", status: "skipped" }],   // .md 无白板图
    attachments,
  });
}

function parseDocx(buf: Buffer, fileName: string): ParseResult {
  const entries = readZipEntries(buf);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) throw new ApiError("FORMAT_UNSUPPORTED", "这个 .docx 里没有正文（word/document.xml）。");
  const xml = readZipEntry(buf, doc).toString("utf8");
  const pages = entries.find(e=>e.name === "docProps/app.xml");
  if (pages && Number(readZipEntry(buf,pages).toString("utf8").match(/<Pages>(\d+)<\/Pages>/)?.[1] ?? 0)>100)
    throw new ApiError("PAYLOAD_TOO_LARGE", "文档超过 100 页，请拆分后重试。");
  const { markdown, tableCount } = docxToMarkdown(xml);

  const tables = Array.from({ length: tableCount }, (_, i) => ({ token: `tbl_${i + 1}`, status: "ok" as const }));
  // 附件：媒体目录里的文件
  const media = entries.filter((e) => /^word\/media\//.test(e.name))
    .map((e) => ({ name: e.name.split("/").pop() ?? "media", status: "ok" as const }));
  // 白板图：飞书来源才有；本地 .docx 一律 skipped（**不是失败**）
  const title = titleOf(markdown, fileName.replace(NAME_RE, ""));
  return finish(markdown, title, {
    body: { status: "ok", chars: [...markdown].length },
    tables,
    whiteboards: [{ token: "wb_none", status: "skipped" }],
    attachments: media,
  });
}
