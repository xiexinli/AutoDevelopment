# -*- coding: utf-8 -*-
"""§㊺ 销项：把第 29 轮校对列出的 10 条阻断逐条修掉（按值全量定位，不点名式改）。"""
import io, re, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:62])); return s
    return s.replace(old, new, cnt)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ================= 接口-Spec =================
P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "因底稿基线为 71 个接口、本机落地再增 4 个（共 **75**）", "因底稿基线为 71 个接口、本机落地再增 4 个、工程接入再增 3 个（共 **78**）")
s = rep(P, s, "**不占 `#n` 编号**，", "**不占 `#n` 编号**，")
s = rep(P, s, "因此 **接口总数仍 75**）。", "因此 **接口总数仍 78**）。")
s = rep(P, s, "> **其余 37 个接口**（`#4`、`#5`、", "> **其余 40 个接口**（`#4`、`#5`、")
s = rep(P, s, "`#71`/`#71a`/`#72`/`#72a`）的契约以 **§5.4 总表 + `接口契约` 底稿**为准", "`#71`/`#71a`/`#72`/`#72a`、`#73`/`#74`/`#75`）的契约以 **§5.4 总表 + `接口契约` 底稿**为准")
s = rep(P, s, "反向见 §10 追溯表（91 行） |", "反向见 §10 追溯表（94 行） |")
s = rep(P, s, "| `items[] = {code, level, title}` |", "| `items[] = {code, group, level, title}` |")
s = rep(P, s, "`items[] = {code,level,title}`/`version`/`is_current`/`project_id`", "`items[] = {code,group,level,title}`/`version`/`is_current`/`project_id`（`group` 含新增 **`J` 工程一致性**，2026-10-29）")
run(P, s)

# ================= 测试-Spec =================
P = "platform/specs/测试-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "**A 线：平台自身 54 个事件**", "**A 线：平台自身 57 个事件**")
s = rep(P, s, "| 5 | **埋点层覆盖全部 54 个事件**", "| 5 | **埋点层覆盖全部 57 个事件**")
s = rep(P, s, "> **覆盖对象**：`埋点-Spec §3` 的 **54 个事件全量**（§3.1=6、§3.2=5、", "> **覆盖对象**：`埋点-Spec §3` 的 **57 个事件全量**（§3.1=6、§3.2=8、")
s = rep(P, s, "现为 75**）→ 本 Spec **一律按 75 统", "现为 78**）→ 本 Spec **一律按 78 统")
s = rep(P, s, "| AC-T-003 | 埋点层覆盖 **54/54** 事件（含 V-01~V-12 通用断言）〔2026-10-21 本机落地后；**冻结基线为 52**〕 | `REQ-TRACK-001`~`003` | 是 | §6 用例全通过（**108 = 54 × 2**） |",
        "| AC-T-003 | 埋点层覆盖 **57/57** 事件（含 V-01~V-12 通用断言）〔2026-10-29 工程接入 +3；2026-10-21 本机落地后；**冻结基线为 52**〕 | `REQ-TRACK-001`~`003` | 是 | §6 用例全通过（**114 = 57 × 2**） |")
s = rep(P, s, "`OK` **89 条中含 2 条结论待复核**", "`OK` **92 条中含 2 条结论待复核**")
run(P, s)

# ================= 埋点-Spec =================
P = "platform/specs/埋点-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "其余 19 条的理由逐条写在备注列", "其余 21 条的理由逐条写在备注列")
run(P, s)

# ================= App-Spec =================
P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "`items[].code`、`items[].level`、`items[].title`", "`items[].code`、`items[].group`、`items[].level`、`items[].title`")
s = rep(P, s, "`data.items[].code`/`.level`/`.title`、`data.version`", "`data.items[].code`/`.group`/`.level`/`.title`、`data.version`")
s = rep(P, s, "共 **27 行**；", "共 **30 行**（2026-10-29 工程接入 +3）；")
s = rep(P, s, "**§10.1 + §10.4 = 54 行，与事件字典逐条对应**。", "**§10.1 + §10.4 = 57 行，与事件字典逐条对应**。")
s = rep(P, s, "### 10.4 其余 30 条事件的埋码点（**与 §10.1 合计 57 条**", "### 10.4 其余 27 条事件的埋码点（**与 §10.1 合计 57 条**")
s = rep(P, s, "§4.2 实际展开 **295（页面元素供给294+外壳1）**", "§4.2 实际展开 **299（页面元素供给298+外壳1）**")
s = rep(P, s, "§10.1 **30 行** + §10.4 **27 行**〔§10.1 的 27 行 = ", "§10.1 **30 行** + §10.4 **27 行**〔§10.1 的 30 行 = ")
run(P, s)

# ================= baseline/需求追溯矩阵 =================
P = "baseline/需求追溯矩阵.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "| `EVT_*` 事件 | `埋点-Spec 附节 C` | **54**（+2：`EVT_auth_password_login`、`EVT_llm_model_switch`〔2026-10-21〕） |",
        "| `EVT_*` 事件 | `埋点-Spec 附节 C` | **57**（+5：`EVT_auth_password_login`、`EVT_llm_model_switch`〔2026-10-21〕；`EVT_intake_click`/`done`/`failed`〔2026-10-29 工程接入〕） |")
s = rep(P, s, "54/54/54", "57/57/57")
s = rep(P, s, "附节 C **54 条**〔2026-10-21 本机落地后；", "附节 C **57 条**〔2026-10-29 工程接入 +3；2026-10-21 本机落地后；")
s = rep(P, s, "测试 **54 条**全覆盖、未覆盖 **0**", "测试 **57 条**全覆盖、未覆盖 **0**")
run(P, s)

# ================= UI-Spec：删掉重复的 050/051 文案行 =================
P = "platform/specs/UI-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "| `EL-PROJ-050` | `接入已有工程` | 弹窗标题 |\n| `EL-PROJ-051` | `/Users/you/StudioProjects/MyApp` | 工程根目录占位（**绝对路径**示例） |\n| `EL-PROJ-054` |",
        "| `EL-PROJ-054` |")
run(P, s)

if FAILED:
    print("!! 有 %d 处未命中：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: §㊺ 销项完成")
