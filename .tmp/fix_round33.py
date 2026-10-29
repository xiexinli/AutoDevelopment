# -*- coding: utf-8 -*-
"""§㊾ 销项：第 33 轮的 1 阻断（App §4.2 行数口径）+ 2 重要 + 1 建议。"""
import io, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:56])); return s
    return s.replace(old, new, cnt)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ============ B-1：App §4.2 行数 300 → 301（口径 = 全表行数） ============
P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "实测**300 = 299页面元素供给行 + 1应用外壳行**", "实测**301 = 300 页面元素行（含应用外壳行）+ 1 页面进入控制行**")
s = rep(P, s, "§4.2当前**300行（299页面元素供给+1外壳）**", "§4.2当前**301行（300 页面元素行含外壳 + 1 页面进入控制行）**")
s = rep(P, s, "§4.2 实际展开 **300（页面元素供给299+外壳1）**", "§4.2 实际展开 **301（300 页面元素行含外壳 + 1 页面进入控制行）**")
s = rep(P, s, "App表实测**300（299页面元素供给+1外壳）**", "App表实测**301（300 页面元素行含外壳 + 1 页面进入控制行）**")
run(P, s)

P = "baseline/需求追溯矩阵.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "App§4.2展开**300（299页面元素供给+1外壳）**", "App§4.2展开**301（300 页面元素行含外壳 + 1 页面进入控制行）**")
run(P, s)

# ============ M-1：接口-Spec §0 作业性质「75」→ 78 ============
P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "（**冻结基线 71 个平台自身接口** + 本机落地 4 = **75**，已确认基线 · 2026-10-21 补口落地后）",
        "（**冻结基线 71 个平台自身接口** + 本机落地 4 + 工程接入 3 = **78**，已确认基线 · 2026-10-29 补口落地后）")
# S-1：§5.5 节数 31 → 32（与 :1166 一致）
s = rep(P, s, "+ §5.5 关键接口完整契约（31 节）**」", "+ §5.5 关键接口完整契约（32 节）**」")
s = rep(P, s, "> 本节 31 节共覆盖", "> 本节 32 节共覆盖")
s = rep(P, s, "§5.5 的 31 节关键接口给出", "§5.5 的 32 节关键接口给出")
run(P, s)

# ============ M-2：平台需求概要 §13.E 的 R1 陈述已过时 ============
P = "platform/平台需求概要.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "**残余**见该文件 §3（其中 `REQ-INTAKE-*` 尚未登记进 `platform/requirements/需求条目表.md`，为**下一轮校对的前置**）。",
        "**残余**见该文件 §3 —— 其中 `REQ-INTAKE-001`~`003` **已于 2026-10-29 补登**进 `platform/requirements/需求条目表.md`（`REQ` 总数 **91 → 94**、新模块 `INTAKE`）及五角色需求包 + RTM 骨架 + `AC-INTAKE-01`~`08`（`验收标准 §17A`）；**C2 §3 的 R1 已闭合**。")
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: §㊾ 销项完成")
