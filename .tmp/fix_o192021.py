# -*- coding: utf-8 -*-
"""O-19 / O-20 / O-21：补 AC、补变更记录留痕、修 C2 的「未改动」清单。"""
import io, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:58])); return s
    return s.replace(old, new, cnt)
def ins_after_last(p, s, line_re, text):
    import re
    lines = s.split("\n"); idx = -1
    for i, ln in enumerate(lines):
        if re.match(line_re, ln): idx = i
    if idx < 0: FAILED.append("%s :: no line %r" % (p, line_re)); return s
    lines.insert(idx + 1, text); return "\n".join(lines)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ============ O-21：AC-INTAKE-01 覆盖两个互斥分支 ============
P = "platform/design/验收标准.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "| `AC-INTAKE-01` | P0 | **G** 已登录，项目列表 · **W** 点「扫描并接入」但**未勾选只读授权** · **T** **不发起** `#73`，Toast 提示「请先确认授权平台只读扫描这个目录。」，**保留已填内容**（服务端对 `confirm≠true` 兜底返回 400 `INVALID_ARGUMENT`，message 同此文案） |",
        "| `AC-INTAKE-01` | P0 | **G** 已登录、接入弹窗已打开 · **W** 提交，但（① **未填工程根目录** ／ ② 填了根目录但**未勾选只读授权**，**两分支互斥**）· **T** 两分支**均不发起** `#73`、**均保留已填内容**：① Toast「**请填写本机 Android 工程的根目录（绝对路径）。**」；② Toast「**请先确认授权平台只读扫描这个目录。**」（服务端对 `confirm≠true` 兜底返回 400 `INVALID_ARGUMENT`，message 同 ② 文案） |")
run(P, s)

# ============ O-20：三份 Spec 补变更记录留痕并升版本头 ============
P = "platform/specs/UI-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.1.17** ｜", "> 版本：**v0.1.18** ｜")
s = ins_after_last(P, s, r"^\| \*\*v0\.1",
  "| **v0.1.18** | **2026-10-29** | **「intake 前置校验文案两分支落定（`§㊿` 销项留痕）」**：① `§4.2 ④` 明确**两条互斥分支文案** —— `EL-GLOBAL-001` Toast「请填写本机 Android 工程的根目录（绝对路径）。」（**根目录为空**）与「请先确认授权平台只读扫描这个目录。」（**未勾选授权**）；② `§4.2 ②` 与 `§5` 的 `EL-PROJ-051` 行由「`EL-PROJ-054` 处提示」改为 **`EL-GLOBAL-001` Toast**（`EL-PROJ-054` 恢复为纯静态说明文本，**不占提示宿主**）；③ **元素计数仍 447、编号零重排**（复用既有 `EL-GLOBAL-001`） | UI 角色（`§㊿` 销项留痕） |")
run(P, s)

P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.2.16** ｜", "> 版本：**v0.2.17** ｜")
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.2",
  "| **v0.2.17** | **2026-10-29** | **「intake 前置校验两分支落文案（`§㊿` 销项留痕）」**：§4.2.2 的 `EL-PROJ-051`/`052`/`053` 行失败处理改为**两分支各指各自文案** —— 未填根目录 → Toast「请填写本机 Android 工程的根目录（绝对路径）。」；未勾选授权 → Toast「请先确认授权平台只读扫描这个目录。」（均见 `UI-Spec §4.2 ④`）。**未新增 `RT-*` / 未改路由表、编号零重排** | App 角色（`§㊿` 销项留痕） |")
run(P, s)

P = "platform/specs/测试-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.2.16**（2026-10-29 工程接入（一期）F17/F18 + §㊸ 销项；",
        "> 版本：**v0.2.17**（2026-10-29 intake 前置校验两分支；上一版 v0.2.16 = 工程接入（一期）F17/F18 + §㊸ 销项；")
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.2",
  "| **v0.2.17** | **2026-10-29** | **「intake 前置校验两分支用例（`§㊿` 销项留痕）」**：§5.15 的 `TC-INTAKE-201` 扩为**两个互斥分支**（① 不填根目录 ② 不勾选授权），分别断言两条 Toast、**均不发 `#73`**、均保留已填内容。**用例总数仍 618、编号零重排** | 测试角色（`§㊿` 销项留痕） |")
run(P, s)

# ============ O-19：C2 的「未改动」清单 ============
P = "reviews/C2-下游文档同步记录-20261029.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> **未改动**：`platform/specs/测试-Spec.md`、`baseline/需求追溯矩阵.md`、`platform/requirements/*`、`README.md`（见 §3 残余）。",
        "> **本次未改动**（当时）：`platform/specs/测试-Spec.md`、`baseline/需求追溯矩阵.md`、`platform/requirements/*`、`README.md` —— ⚠️ **该清单已随后续销项失效**：`R1`/`R2`/`R3` 补做后，**上述文件均已改动**（见 §3 状态列与 `reviews/C3`/`C4`）。")
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: O-19 / O-20 / O-21 完成")
