# -*- coding: utf-8 -*-
import io, sys

def patch(path, edits):
    s = io.open(path, encoding="utf-8").read()
    for old, new in edits:
        n = s.count(old)
        if n != 1:
            sys.stderr.write("NOT UNIQUE in %s (%d): %r\n" % (path, n, old[:70])); sys.exit(1)
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8").write(s)
    print("patched %s (%d)" % (path, len(edits)))

# --- llm.ts 错字修正 ---
patch("server/src/adapters/llm.ts", [(
  '"1) 以上是既有工程的**真实约束**（技术栈 / 依赖版本 / footer 命名 / SDK / 模块结构等），产出必须与之**一致**；",',
  '"1) 以上是既有工程的**真实约束**（技术栈 / 依赖版本 / 命名 / SDK / 模块结构等），产出必须与之**一致**；",')])

# --- schema.sql ---
patch("server/src/db/schema.sql", [
  ("  sector      TEXT NOT NULL,               -- prd | spec | glossary | domain",
   "  sector      TEXT NOT NULL,               -- prd | spec | glossary | domain | constraints（F17 工程接入，2026-10-29）"),
  ("""  review_extended     INTEGER NOT NULL DEFAULT 0,        -- 严格档的「超严扩展」开关（仅 strict 有意义）
  version             INTEGER NOT NULL DEFAULT 1,""",
   """  review_extended     INTEGER NOT NULL DEFAULT 0,        -- 严格档的「超严扩展」开关（仅 strict 有意义）
  source_kind         TEXT NOT NULL DEFAULT 'new',       -- new | imported（F17 工程接入，2026-10-29）
  engineering_root    TEXT,                              -- 接入的既有工程根目录（本机绝对路径；imported 时非空）
  version             INTEGER NOT NULL DEFAULT 1,"""),
])

# --- db/index.ts 迁移 ---
patch("server/src/db/index.ts", [(
"""if(!reviewCols.some(c=>c.name==='review_level')) db.exec("ALTER TABLE tbl_review_report ADD COLUMN review_level TEXT NOT NULL DEFAULT 'standard'");
if(!reviewCols.some(c=>c.name==='review_extended')) db.exec("ALTER TABLE tbl_review_report ADD COLUMN review_extended INTEGER NOT NULL DEFAULT 0");""",
"""if(!reviewCols.some(c=>c.name==='review_level')) db.exec("ALTER TABLE tbl_review_report ADD COLUMN review_level TEXT NOT NULL DEFAULT 'standard'");
if(!reviewCols.some(c=>c.name==='review_extended')) db.exec("ALTER TABLE tbl_review_report ADD COLUMN review_extended INTEGER NOT NULL DEFAULT 0");

// 工程接入（F17，2026-10-29）：项目来源 + 登记的工程根目录（一期只读，不写工程文件）
if(!projCols2.some(c=>c.name==='source_kind')) db.exec("ALTER TABLE tbl_project ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'new'");
if(!projCols2.some(c=>c.name==='engineering_root')) db.exec("ALTER TABLE tbl_project ADD COLUMN engineering_root TEXT");""")])

# --- kb.ts sector 扩值 ---
patch("server/src/routes/kb.ts", [(
  'const SECTORS = new Set(["prd", "spec", "glossary", "domain"]);',
  'const SECTORS = new Set(["prd", "spec", "glossary", "domain", "constraints"]);')])

# --- app.ts 注册 ---
patch("server/src/app.ts", [
  ('import { registerKbRoutes } from "./routes/kb.ts";',
   'import { registerKbRoutes } from "./routes/kb.ts";\nimport { registerConstraintRoutes } from "./routes/constraints.ts";'),
  ("  registerKbRoutes(app);", "  registerKbRoutes(app);\n  registerConstraintRoutes(app);"),
])
