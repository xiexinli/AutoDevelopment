# -*- coding: utf-8 -*-
"""§㊿ 销项：第 34 轮的 1 阻断（intake 前置校验文案三处互斥）+ O-18。"""
import io, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:58])); return s
    return s.replace(old, new, cnt)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ============ UI-Spec：统一为 EL-GLOBAL-001 Toast，并补「根目录为空」独立文案 ============
P = "platform/specs/UI-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "校验：根目录非空 + 已勾选授权 → 无则 `EL-PROJ-054` 处提示；",
        "校验：根目录非空 + 已勾选授权 → 无则 `EL-GLOBAL-001` Toast（**两个互斥分支文案见 ④**，**不占 `EL-PROJ-054`**）；")
s = rep(P, s, "| 空 → `EL-PROJ-054` 处字段提示 |",
        "| 空 → `EL-GLOBAL-001` Toast「请填写本机 Android 工程的根目录（绝对路径）。」 |")
s = rep(P, s, "| `EL-GLOBAL-001` | `请先确认授权平台只读扫描这个目录。` | 接入弹窗**提交前置拦截**（未勾选授权）Toast（与 `#73` 的 400 `message` 逐字一致） |",
        "| `EL-GLOBAL-001` | `请填写本机 Android 工程的根目录（绝对路径）。` | 接入弹窗**提交前置拦截**（**根目录为空**）Toast |\n"
        "| `EL-GLOBAL-001` | `请先确认授权平台只读扫描这个目录。` | 接入弹窗**提交前置拦截**（**未勾选授权**）Toast（与 `#73` 的 400 `message` 逐字一致） |")
run(P, s)

# ============ App-Spec：两个分支分别指向各自文案 ============
P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "| 未填根目录 / 未勾选授权 → `EL-GLOBAL-001` Toast（文案见 `UI-Spec §4.2 ④`） |",
        "| 未填根目录 → Toast「请填写本机 Android 工程的根目录（绝对路径）。」；未勾选授权 → Toast「请先确认授权平台只读扫描这个目录。」（两分支互斥，文案见 `UI-Spec §4.2 ④`） |")
run(P, s)

# ============ 测试-Spec：TC-INTAKE-201 覆盖两个互斥分支 ============
P = "platform/specs/测试-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "| TC-INTAKE-201 | `RT-PROJ-001` | `REQ-INTAKE-001` | **★前置拦截：未勾选授权** | 接入弹窗已打开 | 1. 填工程根目录；2. **不勾选**只读授权；3. 点「扫描并接入」 | Toast「**请先确认授权平台只读扫描这个目录。**」；**不发出 `#73`**；**保留已填内容** | P0 |",
        "| TC-INTAKE-201 | `RT-PROJ-001` | `REQ-INTAKE-001` | **★前置拦截：根目录为空 / 未勾选授权（两个互斥分支）** | 接入弹窗已打开 | ① **不填**根目录 → 提交；② 填根目录但**不勾选**授权 → 提交 | ① Toast「**请填写本机 Android 工程的根目录（绝对路径）。**」；② Toast「**请先确认授权平台只读扫描这个目录。**」；**两分支均不发出 `#73`**、均**保留已填内容** | P0 |")
run(P, s)

# ============ O-18：C2 §3 的 R2/R3/R5 状态回填 ============
P = "reviews/C2-下游文档同步记录-20261029.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "| **R2** | `测试-Spec.md` 未补用例 | 新 3 接口（`#73`~`#75`）与 3 事件（`EVT_intake_*`）尚无接口层/埋点层/App 层用例与 E2E 串联 | S5/S8 测试 Spec | ⏳ 待做 |",
        "| **R2** | `测试-Spec.md` 未补用例 | 新 3 接口（`#73`~`#75`）与 3 事件（`EVT_intake_*`）尚无接口层/埋点层/App 层用例与 E2E 串联 | S5/S8 测试 Spec | ✅ **2026-10-29 已补**（+18 用例；见 `C3` §3） |")
s = rep(P, s, "| **R3** | `baseline/需求追溯矩阵.md` 未复刷 | RTM 覆盖率与孤儿检测未纳入新 REQ | 基线 | ⏳ 待做 |",
        "| **R3** | `baseline/需求追溯矩阵.md` 未复刷 | RTM 覆盖率与孤儿检测未纳入新 REQ | 基线 | ✅ **2026-10-29 已复刷**（91→94、覆盖率 94/94） |")
s = rep(P, s, "| **R5** | 门禁 J 组未进 `可开发性门禁清单.md` | `J1`/`J2` 已实现于 `review.ts` 常量，但未回写 `baseline/可开发性门禁清单.md` 的 A~I 表 | 基线 | ⏳ 待做 |",
        "| **R5** | 门禁 J 组未进 `可开发性门禁清单.md` | `J1`/`J2` 已实现于 `review.ts` 常量，但未回写 `baseline/可开发性门禁清单.md` 的 A~I 表 | 基线 | ✅ **2026-10-29 已入库**（新增 `J. 工程一致性` 节，`A~I` → `A~J`） |")
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: §㊿ 销项完成")
