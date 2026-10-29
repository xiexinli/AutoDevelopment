/**
 * SQLite 访问层 —— 使用 Node 内置 `node:sqlite`（**零原生编译**）。
 * 启动时执行 `schema.sql`（幂等，全部 `IF NOT EXISTS`）。
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.AD_DB_PATH ?? join(here, "..", "..", "data", "app.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(readFileSync(join(here, "schema.sql"), "utf8"));

// 增量迁移：不删除现有业务库。旧 DDL 的事件键需在项目内唯一而非全库唯一。
// 对话「线程」维度（2026-10-22）：对象恒为**项目**，线程 = 项目内的**子步骤**。
// 老库有历史数据，用 RENAME（保数据）而不是重建表；`subject_*` 是上一版的列名。
const chatCols = db.prepare("PRAGMA table_info(tbl_chat_message)").all() as {name:string}[];
const chatHas = (n: string) => chatCols.some(c=>c.name === n);
if (!chatHas("thread_key")) {
  if (chatHas("subject_id")) db.exec("ALTER TABLE tbl_chat_message RENAME COLUMN subject_id TO thread_key");
  else db.exec("ALTER TABLE tbl_chat_message ADD COLUMN thread_key TEXT");
}
// 上一版遗留的列：能删就删（SQLite ≥3.35；失败也不影响运行）
if (chatHas("subject_type")) {
  // 先删依赖它的旧索引，否则 SQLite 拒绝 DROP COLUMN（会静默失败、留下无用列）
  try { db.exec("DROP INDEX IF EXISTS idx_chat_subject"); } catch { /* ignore */ }
  try { db.exec("ALTER TABLE tbl_chat_message DROP COLUMN subject_type"); } catch { /* 留着无害 */ }
}
// 历史消息（无线程）→ 归入「工作台」线程（对话原就长在工作台右栏）
db.exec("UPDATE tbl_chat_message SET thread_key='workbench' WHERE thread_key IS NULL");
db.exec("CREATE INDEX IF NOT EXISTS idx_chat_thread ON tbl_chat_message(project_id, thread_key, seq)");

const kbCols = db.prepare("PRAGMA table_info(tbl_kb_doc)").all() as {name:string}[];
if (!kbCols.some(c=>c.name === "document_id")) db.exec("ALTER TABLE tbl_kb_doc ADD COLUMN document_id TEXT");
const trackCols = db.prepare("PRAGMA table_info(tbl_track_plan)").all() as {name:string;pk:number}[];
if (trackCols.find(c=>c.name === "event_key")?.pk === 1 && !trackCols.find(c=>c.name === "project_id")?.pk) {
  db.exec(`BEGIN; ALTER TABLE tbl_track_plan RENAME TO tbl_track_plan_legacy;
    CREATE TABLE tbl_track_plan (event_key TEXT NOT NULL,project_id TEXT NOT NULL,trigger_desc TEXT NOT NULL DEFAULT '',params_json TEXT NOT NULL DEFAULT '[]',element_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(project_id,event_key));
    INSERT INTO tbl_track_plan SELECT * FROM tbl_track_plan_legacy; DROP TABLE tbl_track_plan_legacy; COMMIT;`);
}

// B3 migration: Element IDs are unique WITHIN project, not across all projects.
const elementCols=db.prepare('PRAGMA table_info(tbl_element)').all() as {name:string;pk:number}[];
if(!elementCols.find(c=>c.name==='project_id')?.pk) {
 db.exec(`BEGIN;
 ALTER TABLE tbl_element RENAME TO tbl_element_legacy;
 CREATE TABLE tbl_element(element_id TEXT NOT NULL,project_id TEXT NOT NULL,page_id TEXT NOT NULL,parent_element_id TEXT,widget_type TEXT NOT NULL,alias TEXT NOT NULL DEFAULT '',order_index INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',temp_id TEXT,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,voided_at TEXT,PRIMARY KEY(project_id,element_id));
 INSERT INTO tbl_element SELECT * FROM tbl_element_legacy;
 ALTER TABLE tbl_style_props RENAME TO tbl_style_props_legacy;
 CREATE TABLE tbl_style_props(project_id TEXT NOT NULL,element_id TEXT NOT NULL,props_json TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(project_id,element_id));
 INSERT INTO tbl_style_props SELECT e.project_id,s.* FROM tbl_style_props_legacy s JOIN tbl_element e ON e.element_id=s.element_id;
 ALTER TABLE tbl_element_event RENAME TO tbl_element_event_legacy;
 CREATE TABLE tbl_element_event(project_id TEXT NOT NULL,element_id TEXT NOT NULL,event_kind TEXT NOT NULL,action_type TEXT NOT NULL DEFAULT 'none',payload_json TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(project_id,element_id,event_kind));
 INSERT INTO tbl_element_event SELECT e.project_id,s.* FROM tbl_element_event_legacy s JOIN tbl_element e ON e.element_id=s.element_id;
 DROP TABLE tbl_style_props_legacy;DROP TABLE tbl_element_event_legacy;DROP TABLE tbl_element_legacy;
 CREATE INDEX idx_element_page ON tbl_element(page_id,order_index);
 CREATE INDEX idx_element_project ON tbl_element(project_id,status);COMMIT;`);
}
const qrCols=db.prepare('PRAGMA table_info(tbl_qrcode)').all() as {name:string}[];
if(!qrCols.some(c=>c.name==='identity_json')) db.exec('ALTER TABLE tbl_qrcode ADD COLUMN identity_json TEXT');

const draftCols=db.prepare('PRAGMA table_info(tbl_page_draft)').all() as {name:string}[];
if(!draftCols.some(c=>c.name==='version')) db.exec('ALTER TABLE tbl_page_draft ADD COLUMN version INTEGER NOT NULL DEFAULT 0');

// 审核报告记录「本次实际使用的大模型」——门禁结论随模型而变，必须可追溯
const reviewCols=db.prepare('PRAGMA table_info(tbl_review_report)').all() as {name:string}[];
if(!reviewCols.some(c=>c.name==='model')) db.exec("ALTER TABLE tbl_review_report ADD COLUMN model TEXT NOT NULL DEFAULT ''");

// PRD 审核分级（2026-10-28 定稿）：结论随「等级 + 超严扩展」而变，两处都要可追溯。
// 老库补列（保数据）；`tbl_project.depth` 保留但废弃，改由 `review_level` 映射。
const projCols2=db.prepare('PRAGMA table_info(tbl_project)').all() as {name:string}[];
if(!projCols2.some(c=>c.name==='review_level')) db.exec("ALTER TABLE tbl_project ADD COLUMN review_level TEXT NOT NULL DEFAULT 'standard'");
if(!projCols2.some(c=>c.name==='review_extended')) db.exec("ALTER TABLE tbl_project ADD COLUMN review_extended INTEGER NOT NULL DEFAULT 0");
if(!reviewCols.some(c=>c.name==='review_level')) db.exec("ALTER TABLE tbl_review_report ADD COLUMN review_level TEXT NOT NULL DEFAULT 'standard'");
if(!reviewCols.some(c=>c.name==='review_extended')) db.exec("ALTER TABLE tbl_review_report ADD COLUMN review_extended INTEGER NOT NULL DEFAULT 0");

// 工程接入（F17，2026-10-29）：项目来源 + 登记的工程根目录（一期只读，不写工程文件）
if(!projCols2.some(c=>c.name==='source_kind')) db.exec("ALTER TABLE tbl_project ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'new'");
if(!projCols2.some(c=>c.name==='engineering_root')) db.exec("ALTER TABLE tbl_project ADD COLUMN engineering_root TEXT");

// 审核页「未通过项 · 补充信息」（2026-10-26）：用户对未通过检查项补充的说明，随 `#23` 写回 PRD
const reviewItemCols=db.prepare('PRAGMA table_info(tbl_review_item)').all() as {name:string}[];
if(!reviewItemCols.some(c=>c.name==='supplement')) db.exec("ALTER TABLE tbl_review_item ADD COLUMN supplement TEXT NOT NULL DEFAULT ''");

export const nowIso = () => new Date().toISOString();

let seq = 0;
export function uid(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(4, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

/** 便捷查询：`q.all` / `q.get` / `q.run`（**参数一律走占位符，杜绝拼接**） */
export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}
export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}
export function run(sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...(params as never[]));
}

/** 事务（`node:sqlite` 无内建 tx 包装；用 BEGIN/COMMIT + 回滚保证「要么全成要么全不成」） */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const json = {
  parse<T>(s: unknown, fallback: T): T {
    if (typeof s !== "string" || !s) return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  },
  stringify(v: unknown): string { return JSON.stringify(v ?? null); },
};
