# -*- coding: utf-8 -*-
import io, sys
P = "server/src/routes/projects.ts"
s = io.open(P, encoding="utf-8").read()
E = [
  ('  depth: string; review_level: string; review_extended: number; version: number; element_id_seq: string;',
   '  depth: string; review_level: string; review_extended: number; version: number; element_id_seq: string;\n  source_kind: string; engineering_root: string | null;'),
  ('''      .map((r) => ({
        project_id: r.project_id, name: r.name, stage: r.stage,
        updated_at: r.updated_at, created_at: r.created_at, version: r.version,
      }));''',
   '''      .map((r) => ({
        project_id: r.project_id, name: r.name, stage: r.stage,
        updated_at: r.updated_at, created_at: r.created_at, version: r.version,
        // `new` | `imported`（F17 工程接入，2026-10-29）：列表据此显示「已接入工程」
        source_kind: r.source_kind ?? "new",
      }));'''),
  ('''        stage: row.stage, depth: row.depth, version: row.version,''',
   '''        stage: row.stage, depth: row.depth, version: row.version,
        // F17 工程接入（2026-10-29）：来源与登记的工程根目录
        source_kind: row.source_kind ?? "new",
        engineering_root: row.engineering_root ?? null,'''),
]
for old, new in E:
    n = s.count(old)
    if n != 1:
        sys.stderr.write("NOT UNIQUE (%d): %r\n" % (n, old[:70])); sys.exit(1)
    s = s.replace(old, new, 1)
io.open(P, "w", encoding="utf-8").write(s)
print("projects.ts patched: %d" % len(E))
