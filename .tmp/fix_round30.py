# -*- coding: utf-8 -*-
"""§㊻ 销项：把第 30 轮列出的 6 条阻断 + M-7 全量修掉。"""
import io, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:60])); return s
    return s.replace(old, new, cnt)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ============ 测试-Spec ============
P = "platform/specs/测试-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "| ④ E2E | `TC-E2E-0xx` | `TC-E2E-001`~`TC-E2E-009`（S0→S9） | `验收标准 §1` |",
        "| ④ E2E | `TC-E2E-0xx` | `TC-E2E-001`~`TC-E2E-010`（S0→S9 + 工程接入） | `验收标准 §1` |")
s = rep(P, s, "| `TC-E2E-001`~`TC-E2E-009` | **E2E 串联**（§7，共 9 条） | `TC-E2E-007` = S7 核心链路 |",
        "| `TC-E2E-001`~`TC-E2E-010` | **E2E 串联**（§7，共 **10 条**） | `TC-E2E-007` = S7 核心链路；`TC-E2E-010` = 工程接入 → 严格档审核 → 拆解 → Spec |")
s = rep(P, s, "| 6 | **E2E 覆盖 `E2E-01`~`09`** 全部 9 个 P0 主流程节点。 |",
        "| 6 | **E2E 覆盖 `E2E-01`~`09`** 全部 9 个 P0 主流程节点；另有 **`TC-E2E-010`** 覆盖工程接入（`AC-INTAKE-07`/`08`）。 |")
s = rep(P, s, "`items[] = {code,level,title}`；", "`items[] = {code,group,level,title}`；")
s = rep(P, s, "故 §12 追溯表**行数仍为 91 行**", "故 §12 追溯表**行为 94 行**（2026-10-29 工程接入 +3）")
s = rep(P, s, "用例编号 `TC-E2E-001`~`TC-E2E-009`。", "用例编号 `TC-E2E-001`~`TC-E2E-010`。")
s = rep(P, s, "| AC-T-004 | E2E **`E2E-01`~`09`** 全部走通且各环节数据一致 |",
        "| AC-T-004 | E2E **`E2E-01`~`09`** 全部走通且各环节数据一致（另有 `TC-E2E-010` 覆盖工程接入） |")
s = rep(P, s, "| **其中：正 + 异常均可完整判定（`OK`）** | **89**（较 v0.1 **机核实值 86 增加 3 条**",
        "| **其中：正 + 异常均可完整判定（`OK`）** | **92**（2026-10-29 工程接入 +3；较 v0.1 **机核实值 86 增加 3 条**")
s = rep(P, s, "| **埋点覆盖（EVT 数 / 已覆盖）** | **54 / 54** + 通用断言 12 条〔2026-10-21 本机落地后；**冻结基线 52/52**〕 |",
        "| **埋点覆盖（EVT 数 / 已覆盖）** | **57 / 57** + 通用断言 12 条〔2026-10-29 工程接入 +3；2026-10-21 本机落地后；**冻结基线 52/52**〕 |")
s = rep(P, s, "| **E2E 覆盖** | **9 / 9**（`E2E-01`~`E2E-09`） |",
        "| **E2E 覆盖** | **10 / 10**（`TC-E2E-001`~`TC-E2E-010`；其中 `E2E-01`~`E2E-09` 为验收标准 P0 节点、`TC-E2E-010` 为工程接入） |")
run(P, s)

# ============ App-Spec ============
P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "（**75 个**：`#1`~`#62` + `#44a` + `#63`~`#70` + **`#71`/`#71a`/`#72`/`#72a`**",
        "（**78 个**：`#1`~`#62` + `#44a` + `#63`~`#70` + **`#71`/`#71a`/`#72`/`#72a`** + **`#73`/`#74`/`#75`**〔2026-10-29 工程接入〕")
s = rep(P, s, "✅ 引用 **75 个**（`API-PLAT-001`~`070` + `API-PLAT-044A` + **`API-PLAT-071`/`071A`/`072`/`072A`**）",
        "✅ 引用 **78 个**（`API-PLAT-001`~`070` + `API-PLAT-044A` + **`API-PLAT-071`/`071A`/`072`/`072A`** + **`API-PLAT-073`/`074`/`075`**〔2026-10-29 工程接入〕）")
run(P, s)

# ============ baseline/需求追溯矩阵 ============
P = "baseline/需求追溯矩阵.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "App §10.1 **27 行** + §10.2", "App §10.1 **30 行** + §10.2")
run(P, s)

# ============ UI-Spec ============
P = "platform/specs/UI-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "| `items[] = {code, level, title}` |", "| `items[] = {code, group, level, title}` |")
run(P, s)

# ============ 接口-Spec ============
P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "`[{code, level, title}]`，`code ∈ A1~I4 族`", "`[{code, group, level, title}]`，`code ∈ A1~J2 族`（`group` 含新增 **`J`**）")
run(P, s)

# ============ 数据模型 ============
P = "platform/design/数据模型.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "`items` json Y（`[{code, level, title}]`，code ∈ A1~I4 族）", "`items` json Y（`[{code, group, level, title}]`，code ∈ A1~J2 族〔2026-10-29 增 `group` 与 `J` 组〕）")
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: §㊻ 销项完成")
