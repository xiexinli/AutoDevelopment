/** 只读巡检：各项目的 Spec / 画布 / 已生成代码产物情况 */
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("server/data/app.db", { readOnly: true });

const ps = db.prepare(
  "SELECT project_id,name,stage,updated_at FROM tbl_project WHERE deleted_at IS NULL ORDER BY updated_at DESC"
).all();

console.log("项目 | 阶段 | Spec | 页面 | 元素 | 生成文件数");
for (const p of ps) {
  const n1 = (sql, ...a) => { try { return db.prepare(sql).get(...a).n; } catch { return "?"; } };
  const specs = n1("SELECT COUNT(*) n FROM tbl_spec_doc WHERE project_id=? AND trim(content_md)<>''", p.project_id);
  const pages = n1("SELECT COUNT(*) n FROM tbl_page WHERE project_id=?", p.project_id);
  const els = n1("SELECT COUNT(*) n FROM tbl_element WHERE project_id=? AND status='active'", p.project_id);
  const art = n1("SELECT COUNT(*) n FROM tbl_artifact a JOIN tbl_gen_task t ON t.task_id=a.task_id WHERE t.project_id=?", p.project_id);
  console.log(`${p.name} | ${p.stage} | ${specs} | ${pages} | ${els} | ${art}`);
}

console.log("\n=== 最近 8 个任务 ===");
for (const r of db.prepare("SELECT task_id,type,status,created_at FROM tbl_gen_task ORDER BY created_at DESC LIMIT 8").all()) {
  console.log(`  ${String(r.created_at).slice(0, 19)}  ${String(r.type).padEnd(10)} ${String(r.status).padEnd(10)} ${r.task_id}`);
}

console.log("\n=== 有产物的任务（tbl_artifact）===");
const arts = db.prepare(
  "SELECT t.task_id, t.project_id, t.status, COUNT(a.path) n, MIN(t.created_at) c FROM tbl_artifact a JOIN tbl_gen_task t ON t.task_id=a.task_id GROUP BY t.task_id ORDER BY c DESC LIMIT 5"
).all();
if (!arts.length) console.log("  (没有任何已生成代码文件)");
for (const a of arts) console.log(`  ${String(a.c).slice(0, 19)}  ${a.status}  文件数=${a.n}  项目=${a.project_id}`);

console.log("\n=== 各项目最新版本（tbl_project_version）===");
try {
  for (const v of db.prepare("SELECT project_id,seq,status,created_at FROM tbl_project_version ORDER BY created_at DESC LIMIT 6").all())
    console.log(`  ${String(v.created_at).slice(0, 19)}  seq=${v.seq}  ${v.status}  项目=${v.project_id}`);
} catch (e) { console.log("  (无此表或读取失败:", e.message, ")"); }
