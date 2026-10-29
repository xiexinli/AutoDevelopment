# -*- coding: utf-8 -*-
import io, sys
P = "server/src/adapters/llm.ts"
s = io.open(P, encoding="utf-8").read()
E = []

# 1) 新增 constraintsNote 常量/函数
E.append((
'''export const TARGET_PLATFORM_NOTE =
  "【目标平台】被开发项目恒为**原生 Android**（Kotlin + XML 布局），本期**不考虑其他平台**"
  + "（iOS / 跨平台 / Flutter / H5 / 小程序 / WebView 内嵌页 等一律不在范围）。"
  + "PRD 未声明平台时**按 Android 处理、不要就此提问**；也不要提出只对其他平台成立的要求。";''',
'''export const TARGET_PLATFORM_NOTE =
  "【目标平台】被开发项目恒为**原生 Android**（Kotlin + XML 布局），本期**不考虑其他平台**"
  + "（iOS / 跨平台 / Flutter / H5 / 小程序 / WebView 内嵌页 等一律不在范围）。"
  + "PRD 未声明平台时**按 Android 处理、不要就此提问**；也不要提出只对其他平台成立的要求。";

/**
 * **工程约束注入**（`F18` / `D4=A`）——项目接入了既有工程时，把「项目约束包」摘要注入提示词。
 * **冲突时以工程约束为准**（`D4=A`）；没有约束包时返回空串（既有行为完全不变）。
 */
export function constraintsNote(summary?: string): string {
  const s = (summary ?? "").trim();
  if (!s) return "";
  return [
    "【工程约束（来自被开发项目的既有工程，**优先级高于平台默认假设**）】",
    s,
    "硬规则：",
    "1) 以上是既有工程的**真实约束**（技术栈 / 依赖版本 / footer 命名 / SDK / 模块结构等），产出必须与之**一致**；",
    "2) 与既有工程约束**冲突**的要求，**不得自行改写工程**，应显式指出冲突并列为待澄清；",
    "3) 不要引入与既有依赖/版本不一致的库或写法。",
  ].join("\\n");
}'''))

# 2) LlmAdapter.review 入参加 constraints
E.append((
"  review(input: { markdown: string; level: ReviewLevel; extended?: boolean; retryHint?: string; standardItems: { code: string; level: Level; title: string }[]; model?: string }): Promise<ReviewDraft>;",
"  review(input: { markdown: string; level: ReviewLevel; extended?: boolean; retryHint?: string; standardItems: { code: string; level: Level; title: string }[]; model?: string; constraints?: string }): Promise<ReviewDraft>;"))

# 3) split 入参
E.append((
"  split(input: { markdown: string; depth: string; model?: string }): Promise<SplitDraft>;",
"  split(input: { markdown: string; depth: string; model?: string; constraints?: string }): Promise<SplitDraft>;"))

# 4) spec 入参
E.append((
"  spec(input: { role: string; requirements: string[]; projectName: string; context: string; depth: string; model?: string }): Promise<SpecDraft>;",
"  spec(input: { role: string; requirements: string[]; projectName: string; context: string; depth: string; model?: string; constraints?: string }): Promise<SpecDraft>;"))

# 5) review 实现：签名 + 系统提示注入 + join 过滤
E.append((
"    async review({ markdown, level, extended, retryHint, standardItems, model: useModel }) {",
"    async review({ markdown, level, extended, retryHint, standardItems, model: useModel, constraints }) {"))
E.append((
'''            TARGET_PLATFORM_NOTE,
            "只输出 JSON，不要任何解释文字，结构：",''',
'''            TARGET_PLATFORM_NOTE,
            constraintsNote(constraints),
            "只输出 JSON，不要任何解释文字，结构：",'''))
E.append((
'''            "7) `na` **只用于「本等级明确不评」的检查项**，不得用 `na` 回避给定清单里的项。",
          ].join("\\n"),''',
'''            "7) `na` **只用于「本等级明确不评」的检查项**，不得用 `na` 回避给定清单里的项。",
          ].filter(Boolean).join("\\n"),'''))

# 6) split 实现
E.append((
"    async split({ markdown, depth, model: useModel }) {",
"    async split({ markdown, depth, model: useModel, constraints }) {"))
E.append((
'''            TARGET_PLATFORM_NOTE,
            '只输出 JSON：{"packs":[{"role":"UI","reqs":["REQ-UI-001"]},{"role":"接口","reqs":[]},{"role":"App","reqs":[]},{"role":"埋点","reqs":[]},{"role":"测试","reqs":[]}]}',''',
'''            TARGET_PLATFORM_NOTE,
            constraintsNote(constraints),
            '只输出 JSON：{"packs":[{"role":"UI","reqs":["REQ-UI-001"]},{"role":"接口","reqs":[]},{"role":"App","reqs":[]},{"role":"埋点","reqs":[]},{"role":"测试","reqs":[]}]}','''))
E.append((
'''            "4) 每条 REQ 必须来自 PRD 里真实存在的需求点，**不要编造**；该角色没有就返回空数组。",
          ].join("\\n"),''',
'''            "4) 每条 REQ 必须来自 PRD 里真实存在的需求点，**不要编造**；该角色没有就返回空数组。",
          ].filter(Boolean).join("\\n"),'''))

# 7) spec 实现
E.append((
"    async spec({ role, requirements, projectName, context, depth, model: useModel }) {",
"    async spec({ role, requirements, projectName, context, depth, model: useModel, constraints }) {"))
E.append((
'''            TARGET_PLATFORM_NOTE,
            "要求：",''',
'''            TARGET_PLATFORM_NOTE,
            constraintsNote(constraints),
            "要求：",'''))
E.append((
'''            "5) 不要输出任何密钥、凭据。",
          ].join("\\n"),''',
'''            "5) 不要输出任何密钥、凭据。",
          ].filter(Boolean).join("\\n"),'''))

for old, new in E:
    n = s.count(old)
    if n != 1:
        sys.stderr.write("NOT UNIQUE (%d): %r\n" % (n, old[:70])); sys.exit(1)
    s = s.replace(old, new, 1)
io.open(P, "w", encoding="utf-8").write(s)
print("llm.ts patched: %d edits" % len(E))
