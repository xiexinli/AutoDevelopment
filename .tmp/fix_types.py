# -*- coding: utf-8 -*-
import io, sys
def patch(path, edits):
    s = io.open(path, encoding="utf-8").read()
    for old, new in edits:
        n = s.count(old)
        if n != 1:
            sys.stderr.write("NOT UNIQUE in %s (%d): %r\n" % (path, n, old[:80])); sys.exit(1)
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8").write(s)
    print("patched %s (%d)" % (path, len(edits)))

patch("server/src/adapters/engineering.ts", [
  ('      const push = (key: string, label: string, value: string | null | undefined, source: string, confidence: Confidence = "high") => {',
   '      const push = (key: string, label: string, value: string | number | null | undefined, source: string, confidence: Confidence = "high") => {'),
  ('  L.push(`- applicationId：\\`${i.application_id ?? "—"}\\``);',
   '  L.push(`- applicationId：\\`${i.applicationId ?? "—"}\\``);'),
])

patch("server/src/routes/constraints.ts", [
  ('import { ApiError } from "../core/envelope.ts";',
   'import { ApiError, ok } from "../core/envelope.ts";'),
  ('''      const envelope = {
        code: "OK", message: "", request_id: String(req.id),
        data: {
          source_kind: "imported", engineering_root: root, kb_doc_id: kbDocId!,
          android: pack.android, project_name: pack.project_name,
          counts: { modules: pack.modules.length, dependencies: pack.dependencies.length,
            agent_config_files: pack.agent_config_files.length, items: pack.items.length,
            naming_samples: pack.naming_samples.length },
          warnings: pack.warnings,
        },
      };''',
   '''      const envelope = ok({
        source_kind: "imported", engineering_root: root, kb_doc_id: kbDocId!,
        android: pack.android, project_name: pack.project_name,
        counts: { modules: pack.modules.length, dependencies: pack.dependencies.length,
          agent_config_files: pack.agent_config_files.length, items: pack.items.length,
          naming_samples: pack.naming_samples.length },
        warnings: pack.warnings,
      }, String(req.id));'''),
])
