/**
 * 把某项目「最近一次成功生成任务」的产物还原到本地目录（只读 DB，不改库）。
 * 用法：node .tmp/dump-artifacts.cjs <project_id 或 关键词> <输出目录>
 */
const { DatabaseSync } = require("node:sqlite");
const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const key = process.argv[2];
const outDir = process.argv[3] || "/tmp/ad-deliver";
const db = new DatabaseSync("server/data/app.db", { readOnly: true });

let projectId = key;
if (!/^p_/.test(String(key))) {
  const row = db.prepare("SELECT project_id,name FROM tbl_project WHERE name LIKE ? ORDER BY updated_at DESC LIMIT 1").get(`%${key}%`);
  if (!row) { console.error("找不到项目:", key); process.exit(1); }
  projectId = row.project_id;
  console.log("目标项目:", row.name, projectId);
}

const task = db.prepare(
  `SELECT t.task_id, COUNT(a.path) n, MAX(t.created_at) c
     FROM tbl_artifact a JOIN tbl_gen_task t ON t.task_id=a.task_id
    WHERE t.project_id=? GROUP BY t.task_id ORDER BY c DESC LIMIT 1`
).get(projectId);
if (!task) { console.error("该项目没有已生成代码产物"); process.exit(1); }
console.log("选用任务:", task.task_id, "文件数:", task.n, task.c);

const rows = db.prepare("SELECT path, content FROM tbl_artifact WHERE task_id=? ORDER BY path").all(task.task_id);
let bytes = 0;
for (const r of rows) {
  let parsed;
  try { parsed = JSON.parse(r.content); } catch { console.error("  跳过（content 非 JSON）:", r.path); continue; }
  const data = parsed.encoding === "base64" ? Buffer.from(parsed.content || "", "base64") : Buffer.from(parsed.content || "", "utf8");
  const dest = join(outDir, r.path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, data);
  bytes += data.length;
  console.log(`  ${String(data.length).padStart(7)}  ${r.path}`);
}
console.log(`\n共 ${rows.length} 个文件，${(bytes / 1024).toFixed(1)} KB → ${outDir}`);
