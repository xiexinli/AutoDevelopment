/**
 * 分页 / 排序 / 筛选 —— 全站统一（`接口契约 §0.3`，对应 E2）。
 *
 * 入参：`page`（默认 1，≥1）、`page_size`（默认 20，可选 20/50/100）、`q`（≤100 字符）、`sort`、`order`。
 * 出参：`{items, page, page_size, total, has_more, sort, failed_parts}`。
 * 规则：`page_size` 超 100 → `INVALID_ARGUMENT`；`page` 超出总页数 → **空 items + 真实 total（不报错）**；
 *      **稳定次序键** = 排序键相同时再按 `id` 升序（避免翻页乱序 / 重复）。
 */
import type { FastifyRequest } from "fastify";
import { ApiError } from "./envelope.ts";

export const PAGE_SIZES = [20, 50, 100] as const;

export interface PageQuery {
  page: number;
  page_size: number;
  q: string;
  sort: string;
  order: "asc" | "desc";
}

export function parsePage(req: FastifyRequest): PageQuery {
  const qs = (req.query ?? {}) as Record<string, unknown>;
  const page = Number(qs.page ?? 1);
  const pageSize = Number(qs.page_size ?? 20);
  const q = String(qs.q ?? "").trim();
  const sort = String(qs.sort ?? "updated_at:desc");
  const [sortKey, sortDir] = sort.includes(":") ? sort.split(":", 2) : [sort, "desc"];
  const order = (String(qs.order ?? sortDir ?? "desc").toLowerCase() === "asc" ? "asc" : "desc");

  if (!Number.isFinite(page) || page < 1) throw new ApiError("INVALID_ARGUMENT", "页码必须 ≥ 1。");
  if (!PAGE_SIZES.includes(pageSize as 20 | 50 | 100)) {
    throw new ApiError("INVALID_ARGUMENT", "每页条数只能是 20 / 50 / 100。");
  }
  if ([...q].length > 100) throw new ApiError("INVALID_ARGUMENT", "关键词最多 100 个字符。");
  return { page: Math.trunc(page), page_size: pageSize, q, sort: `${sortKey}:${order}`, order };
}

export interface Paged<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
  sort: string;
  /** 部分来源失败时列出失败的数据来源（E5） */
  failed_parts: string[];
}

export function paginate<T>(rows: T[], p: PageQuery, failedParts: string[] = []): Paged<T> {
  const total = rows.length;
  const start = (p.page - 1) * p.page_size;
  return {
    items: rows.slice(start, start + p.page_size),
    page: p.page,
    page_size: p.page_size,
    total,
    has_more: start + p.page_size < total,
    sort: p.sort,
    failed_parts: failedParts,
  };
}

/** 抽取排序键（`sort` 形如 `updated_at:desc`） */
export function sortKeyOf(p: PageQuery): { key: string; dir: "asc" | "desc" } {
  const [key, dir] = p.sort.split(":", 2);
  return { key, dir: dir === "asc" ? "asc" : "desc" };
}

/**
 * 稳定排序：先按 `key`，再按 `idKey`（**恒为升序**，保证翻页稳定）。
 * 缺值（null/undefined）一律排在末位，避免与前端展示冲突。
 */
export function stableSort<T extends Record<string, unknown>>(
  rows: T[], key: string, dir: "asc" | "desc", idKey: string,
): T[] {
  const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return [...rows].sort((a, b) => {
    const av = norm(a[key]); const bv = norm(b[key]);
    if (av !== bv) {
      const c = av < bv ? -1 : 1;
      return dir === "asc" ? c : -c;
    }
    const ai = norm(a[idKey]); const bi = norm(b[idKey]);
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
}

/** 单据化的一行（供 SQL 排序后回填） */
export function withMeta<T>(rows: T[], p: PageQuery, idKey: string, failedParts: string[] = []): Paged<T> {
  const { key, dir } = sortKeyOf(p);
  return paginate(stableSort(rows as never, key, dir, idKey) as T[], p, failedParts);
}
