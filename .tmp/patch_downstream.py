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

# ---------------- review.ts ----------------
patch("server/src/routes/review.ts", [
  # import
  ('import { traceLlm } from "../core/ai-trace.ts";',
   'import { traceLlm } from "../core/ai-trace.ts";\nimport { constraintsNoteFor } from "./constraints.ts";'),
  # GROUP_TITLES 新增 J
  ('  E: "平台接口契约", F: "角色与权限", G: "生成与验证", H: "角落收敛", I: "假设集中确认",\n  Q: "可实现性与一致性（简审）",',
   '  E: "平台接口契约", F: "角色与权限", G: "生成与验证", H: "角落收敛", I: "假设集中确认",\n  J: "工程一致性（仅严格档）",\n  Q: "可实现性与一致性（简审）",'),
  # DEFAULT_ITEM_TITLES 新增 J
  ('  Q1: "可实现性", Q2: "内部一致性 / 冲突",\n};',
   '  J1: "与既有工程约束一致", J2: "冲突项已显式列为待澄清",\n  Q1: "可实现性", Q2: "内部一致性 / 冲突",\n};'),
  # FULL_STANDARD_EXTRA 追加 J 组（仅严格档运行）
  ('  { code: "I4", group: "I", title: "假设清单无空白未选项", level: "blocking" },\n];',
   '  { code: "I4", group: "I", title: "假设清单无空白未选项", level: "blocking" },\n  // 工程一致性（F18 / D4=A / D6=C）：**仅严格档**运行；仅当项目接入了既有工程时才判定。\n  { code: "J1", group: "J", title: "产出与既有工程约束一致（依赖 / 包名 / minSdk / 命名）", level: "major" },\n  { code: "J2", group: "J", title: "与既有工程冲突处已显式列为待澄清（未擅自改写工程）", level: "major" },\n];'),
  # 审核调用注入约束
  ('() => llm.review({markdown, level, extended, ...(retryHint ? { retryHint } : {}), standardItems:standardItems.map(i=>({code:i.code,level:i.level,title:i.title})),model:usedModel}),',
   '() => llm.review({markdown, level, extended, ...(retryHint ? { retryHint } : {}), standardItems:standardItems.map(i=>({code:i.code,level:i.level,title:i.title})),model:usedModel,constraints:constraintsNoteFor(rev.project_id) ?? undefined}),'),
])

# ---------------- split.ts ----------------
patch("server/src/routes/split.ts", [
  ('import { traceLlm } from "../core/ai-trace.ts";',
   'import { traceLlm } from "../core/ai-trace.ts";\nimport { constraintsNoteFor } from "./constraints.ts";'),
  ('() => llm.split({ markdown: gate.markdown, depth, model: modelFor(user.user_id) }),',
   '() => llm.split({ markdown: gate.markdown, depth, model: modelFor(user.user_id), constraints: constraintsNoteFor(projectId) ?? undefined }),'),
])

# ---------------- specs.ts ----------------
patch("server/src/routes/specs.ts", [
  ('import { traceLlm } from "../core/ai-trace.ts";',
   'import { traceLlm } from "../core/ai-trace.ts";\nimport { constraintsNoteFor } from "./constraints.ts";'),
  ('    startTask(task.task_id, async ({ progress, check }) => {\n      let done = 0;',
   '    startTask(task.task_id, async ({ progress, check }) => {\n      let done = 0;\n      // 工程约束（F18）：接入既有工程时注入，保证 5 份 Spec 与该工程一致\n      const constraints = constraintsNoteFor(projectId) ?? undefined;'),
  ('() => llm.spec({ role: r.pack, requirements: reqs, projectName: name, context, depth, model: modelFor(user.user_id) }),',
   '() => llm.spec({ role: r.pack, requirements: reqs, projectName: name, context, depth, model: modelFor(user.user_id), constraints }),'),
])
