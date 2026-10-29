# -*- coding: utf-8 -*-
"""§㊸ 销项 · 第一批：B1/B2/B3/B4/B6 + O-1/O-2/O-3（接口-Spec / UI-Spec / App-Spec / 埋点-Spec / RTM 骨架）。"""
import io, re, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt:
        FAILED.append("%s :: count=%d(expect %d) :: %r" % (p, n, cnt, old[:70])); return s
    return s.replace(old, new, cnt)
def ins_before(p, s, anchor, text):
    if s.count(anchor) != 1:
        FAILED.append("%s :: anchor x%d :: %r" % (p, s.count(anchor), anchor[:60])); return s
    return s.replace(anchor, text + "\n" + anchor, 1)
def ins_after_last(p, s, line_re, text):
    lines = s.split("\n"); idx = -1
    for i, ln in enumerate(lines):
        if re.match(line_re, ln): idx = i
    if idx < 0:
        FAILED.append("%s :: no line %r" % (p, line_re)); return s
    lines.insert(idx + 1, text); return "\n".join(lines)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ==================== 1) 接口-Spec ====================
P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.16** ｜", "> 版本：**v0.17** ｜")
s = rep(P, s, "| **v0.13** | **2026-10-29** | **「工程接入（一期）", "| **v0.17** | **2026-10-29** | **「工程接入（一期）")
# B1：§3 计数 84 → 91
for old, new in [
  ("（**84 行**，本 Spec §3 逐行覆盖）", "（**91 行**，本 Spec §3 逐行覆盖）"),
  ("本节逐行覆盖 `UI-Spec §5` 的 84 行，**无空白**", "本节逐行覆盖 `UI-Spec §5` 的 91 行，**无空白**"),
  ("## 3 UI 数据供给对照表（★ 第一优先级章节 · 逐行覆盖 `UI-Spec §5` 的 84 行）", "## 3 UI 数据供给对照表（★ 第一优先级章节 · 逐行覆盖 `UI-Spec §5` 的 91 行）"),
  ("> **现构成：✅ 84 行 ｜ ⚠️ 0 行 ｜ ❌ 0 行 = 合计 84 行。**", "> **现构成：✅ 91 行 ｜ ⚠️ 0 行 ｜ ❌ 0 行 = 合计 91 行。**"),
  ("### 3.2 对照表（84 行，逐行对齐 `UI-Spec §5`）", "### 3.2 对照表（91 行，逐行对齐 `UI-Spec §5`）"),
  ("| ✅ 满足 | **84** | B9 +2数据组", "| ✅ 满足 | **91** | 2026-10-29 工程接入 +7；B9 +2数据组"),
  ("`UI-Spec §5` 当前为 84 行〔B9 +2〕", "`UI-Spec §5` 当前为 91 行〔2026-10-29 工程接入 +7；B9 +2〕"),
  ("| 合计 | **84** | 84✅ + 0⚠️ + 0❌ |", "| 合计 | **91** | 91✅ + 0⚠️ + 0❌ |"),
  ("| 1 | 是否逐行覆盖 `UI-Spec §5` 的 84 行 | ✅ **84 / 84**（`UI-Spec §5` 同为 84 行），行序与 EL-ID 一致 |",
   "| 1 | 是否逐行覆盖 `UI-Spec §5` 的 91 行 | ✅ **91 / 91**（`UI-Spec §5` 同为 91 行），行序与 EL-ID 一致 |"),
  ("| 2 | 「是否满足」列是否有空白 | ✅ **无空白**（✅ **84** / ⚠️ 0 / ❌ 0 = **84 行**） |",
   "| 2 | 「是否满足」列是否有空白 | ✅ **无空白**（✅ **91** / ⚠️ 0 / ❌ 0 = **91 行**） |"),
  ("✅ 当前 **81 行**追到既有接口 + **3 行**不走接口（EL-AUTH-003/EL-EDIT-004/EL-UPLOAD-022）= **84 行**",
   "✅ 当前 **84 行**追到既有接口 + **7 行**不走接口（EL-AUTH-003/EL-EDIT-004/EL-UPLOAD-022/EL-PROJ-048/051/052/053）= **91 行**"),
  ("✅ **84 行全覆盖**，✅ 84 / ⚠️ 0 / ❌ 0（2026-10-21 口径）", "✅ **91 行全覆盖**，✅ 91 / ⚠️ 0 / ❌ 0（2026-10-29 口径）"),
]:
    s = rep(P, s, old, new)
# B2：接口总数 75 → 78
for old, new in [
  ("（**75 个接口** = 基线 71 + 本机落地 4〔2026-10-21〕+ SSE + 13 错误码）",
   "（**78 个接口** = 基线 71 + 本机落地 4〔2026-10-21〕+ 工程接入 3〔2026-10-29〕+ SSE + 13 错误码）"),
  ("### 5.4 接口总表（**覆盖全部 75 个**：基线 63 + 补口 8 + 本机落地 4）",
   "### 5.4 接口总表（**覆盖全部 78 个**：基线 63 + 补口 8 + 本机落地 4 + 工程接入 3）"),
  ("#### 5.4.14 内部端点（**不占编号、不计入 75 个对外接口**）",
   "#### 5.4.14 内部端点（**不占编号、不计入 78 个对外接口**）"),
  ("✅ **75 个接口全部挂 REQ-ID**", "✅ **78 个接口全部挂 REQ-ID**"),
]:
    s = rep(P, s, old, new)
# B4：§10 追溯表
s = rep(P, s, "## 10 需求追溯表（91 行，REQ 集合与 `需求条目表.md` 一致；模块内行序按本 Spec 自定）",
        "## 10 需求追溯表（94 行，REQ 集合与 `需求条目表.md` 一致；模块内行序按本 Spec 自定）")
ROWS10 = """| `REQ-INTAKE-001` | 接入已有工程（只读扫描 + 幂等） | `#73` | OK | `confirm≠true` / 非法路径 / 非 Android 工程 → 400；同键重放返回首次结果 |
| `REQ-INTAKE-002` | 工程约束（读 / 编辑） | `#74`、`#75`、`#7`、`#1`、`#3` | OK | `sector=constraints`；`#75` 须 `If-Match`；未接入 → 404 |
| `REQ-INTAKE-003` | 约束注入下游 + 门禁 J 组 | —（注入服务端提示词；`#24` 门禁标准可含 `group:"J"`） | OK | **不新增接口**；`J` 组仅严格档运行 |"""
s = ins_before(P, s, "**覆盖统计**：`OK` **86 条** ｜ `N/A` **4 条**（`REQ-AUTH-007`、`REQ-PREVIEW-003`、`REQ-UIEDIT-006`、`REQ-UIEDIT-010`）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ **`GAP` 0 条** —— **合计 91 条**，与 `需求条目表.md` **集合一致**（模块内行序按本 Spec 自定）。", ROWS10)
s = rep(P, s, "**覆盖统计**：`OK` **86 条** ｜ `N/A` **4 条**（`REQ-AUTH-007`、`REQ-PREVIEW-003`、`REQ-UIEDIT-006`、`REQ-UIEDIT-010`）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ **`GAP` 0 条** —— **合计 91 条**，与 `需求条目表.md` **集合一致**（模块内行序按本 Spec 自定）。",
        "**覆盖统计**：`OK` **89 条** ｜ `N/A` **4 条**（`REQ-AUTH-007`、`REQ-PREVIEW-003`、`REQ-UIEDIT-006`、`REQ-UIEDIT-010`）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ **`GAP` 0 条** —— **合计 94 条**，与 `需求条目表.md` **集合一致**（2026-10-29 工程接入 +3）。")
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.", "| **v0.18** | **2026-10-29** | **「第 27 轮一致性校对（`§㊸`）销项」**：① §3 计数 **84 → 91** 全量回扫（标题 / 小表 / §3.4 自检 / §0 清单共 12 处，**同文件不再互斥**）；② 接口总数 **75 → 78** 回扫（§1 底稿 / §5.4 表头 / §5.4.14 / §11 自检）；③ 变更记录重号修正：本轮「工程接入」行由 `v0.13` 改 **`v0.17`**（原与 2026-10-22 的 `v0.13` 撞号、且低于版本头），版本头 **v0.16 → v0.17**；④ §10 追溯表 **91 → 94 行**（+`REQ-INTAKE-001/002/003`）。**未重排任何编号** | 接口角色（§㊸ 销项） |")
run(P, s)

# ==================== 2) UI-Spec ====================
P = "platform/specs/UI-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.1.16** ｜", "> 版本：**v0.1.17** ｜")
# B5：文案（复用 EL-GLOBAL-001 Toast，不新增元素）
s = rep(P, s, "| `EL-PROJ-057` | `已接入工程` | 卡片标签（`source_kind=imported`） |",
        "| `EL-PROJ-057` | `已接入工程` | 卡片标签（`source_kind=imported`） |\n"
        "| `EL-GLOBAL-001` | `请先确认授权平台只读扫描这个目录。` | 接入弹窗**提交前置拦截**（未勾选授权）Toast（与 `#73` 的 400 `message` 逐字一致） |\n"
        "| `EL-GLOBAL-001` | `{服务端 message}` | 接入失败原样展示（如「这个目录里没找到 Android 工程（缺少 settings.gradle / build.gradle / AndroidManifest.xml）。」） |")
# B4：§9 追溯表
ROWS9 = """| `REQ-INTAKE-001` | 接入已有工程（入口与路径登记） | `UI-PROJ-001` | OK | 弹窗 + 只读授权勾选（`EL-PROJ-048`~`057`） |
| `REQ-INTAKE-002` | 工程约束（可查看 / 编辑） | `UI-KB-001` | OK | 第 5 分区 `EL-KB-025`/`026`；编辑复用 `EL-KB-017`~`020` |
| `REQ-INTAKE-003` | 约束注入下游与工程一致性 | — | N/A | 本轮未分配 UI；判定点在严格档审核页（`J` 组）与 Spec 内容 |"""
s = ins_before(P, s, "**覆盖统计**：`OK` **68 条** ｜ `N/A` **22 条** ｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 91 条**，与 `需求条目表.md` 逐行对齐。", ROWS9)
s = rep(P, s, "**覆盖统计**：`OK` **68 条** ｜ `N/A` **22 条** ｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 91 条**，与 `需求条目表.md` 逐行对齐。",
        "**覆盖统计**：`OK` **70 条** ｜ `N/A` **23 条** ｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 94 条**，与 `需求条目表.md` 逐行对齐（2026-10-29 工程接入 +3）。")
# O-3
s = rep(P, s, "| 4 | 《元素-数据需求表》覆盖所有要展示数据的元素 | ✅ **84 行**（B9 +2）", "| 4 | 《元素-数据需求表》覆盖所有要展示数据的元素 | ✅ **91 行**（2026-10-29 工程接入 +7；B9 +2）")
s = ins_after_last(P, s, r"^\| \*\*v0\.1", "| **v0.1.17** | **2026-10-29** | **「第 27 轮一致性校对（`§㊸`）销项」**：① §9 追溯表 **91 → 94 行**（+`REQ-INTAKE-001/002/003`；统计 `OK` 68→**70**、`N/A` 22→**23**）；② **补 `AC-INTAKE-01` 的文案定义**（`§4.2 ④`：`EL-GLOBAL-001` Toast「请先确认授权平台只读扫描这个目录。」+「{服务端 message}」，**复用既有元素、不新增 `EL-*`**，元素总数仍 **447**）；③ §11 自检第 4 项 `84 行 → 91 行`。**元素计数与编号零重排** | UI 角色（`§㊸` 销项） |")
run(P, s)

# ==================== 3) App-Spec ====================
P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.2.15** ｜", "> 版本：**v0.2.16** ｜")
s = rep(P, s, "`platform/requirements/需求条目表.md`（91 条 REQ）", "`platform/requirements/需求条目表.md`（94 条 REQ）")
# B6-a：§4.2.2 / §4.2.3 补行
def ins_after_table_header(p, s, section_title, rows):
    lines = s.split("\n"); i = -1
    for k, ln in enumerate(lines):
        if ln.strip() == section_title.strip(): i = k; break
    if i < 0:
        FAILED.append("%s :: section not found :: %r" % (p, section_title)); return s
    for j in range(i + 1, len(lines)):
        if lines[j].startswith("|---"):
            lines.insert(j + 1, rows); return "\n".join(lines)
    FAILED.append("%s :: table header row not found after %r" % (p, section_title)); return s
s = ins_after_table_header(P, s, "#### 4.2.2 `UI-PROJ-001` / `RT-PROJ-001`（项目列表 / 新建）",
"""| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-048` | 点击时打开 `EL-PROJ-049`（**不发请求**） | — | — | — | — |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-051`/`052`/`053` | 弹窗内输入 / 勾选（**局部状态**） | — | — | — | 未填根目录 / 未勾选授权 → `EL-GLOBAL-001` Toast（文案见 `UI-Spec §4.2 ④`） |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-055` | 点「扫描并接入」：首次**先建项目**再调 `#73` | `API-PLAT-073`（`#73`） | `{root: EL-PROJ-051 值, confirm: EL-PROJ-053}` | `data.source_kind`/`engineering_root`/`project_name`/`counts`/`warnings` → **无既有本地模型**，`source_kind` 直接驱动 `EL-PROJ-057` | 400 → 服务端 `message` 落 Toast，**保留已填内容**；重试**复用同一项目** |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-057` | 卡片渲染（随 `#1` 列表） | `API-PLAT-001`（`#1`）/`API-PLAT-003`（`#3`） | — | `data.source_kind` → 标签显示 | `new` → 不显示标签 |""")
s = ins_after_table_header(P, s, "#### 4.2.3 `UI-KB-001` / `RT-KB-001`（知识库）",
"""| `UI-KB-001` | `RT-KB-001` | `EL-KB-025` | 切到第 5 分区「工程约束」 | `API-PLAT-007`（`#7`）/`API-PLAT-074`（`#74`） | `sector=constraints` | `data.items[]`、`data.content_md` | 未接入 → 空态 `EL-KB-026` |""")
# B6-b：§10.1 埋码点
s = ins_after_last(P, s, r"^\| `EVT_llm_model_switch` \|",
"""| `EVT_intake_click` | `RT-PROJ-001` / `UI-PROJ-001` | `EL-PROJ-048` | `EL-PROJ-048` 的 `onClick`（弹窗打开前） | 点击「接入已有工程」 | — |
| `EVT_intake_done` | `RT-PROJ-001` / `UI-PROJ-001` | `EL-PROJ-055`、`EL-PROJ-049` | `#73` 成功回调内（Toast 之后、列表刷新之前） | 接入成功 | `data.counts`、`data.warnings`（**不上报路径/工程名文本**） |
| `EVT_intake_failed` | `RT-PROJ-001` | `EL-PROJ-055`、`EL-PROJ-051`、`EL-PROJ-053` | `#73` 失败分支回调内 | 接入失败（含前置拦截） | `error_code`、`block_reason` |""")
# B4：§11 追溯表
ROWS11 = """| `REQ-INTAKE-001` | 接入已有工程（入口与路径登记） | `RT-PROJ-001` | OK | 弹窗**局部状态**；首次失败重试**复用同一项目** |
| `REQ-INTAKE-002` | 工程约束（可查看 / 编辑） | `RT-KB-001` | OK | 第 5 分区；编辑复用草稿保存链路 |
| `REQ-INTAKE-003` | 约束注入下游与工程一致性 | `RT-REVIEW-001`/`RT-SPLIT-001`/`RT-SPEC-001`（仅展示） | OK | 严格档审核页出现 `J` 组；**不新增客户端行为** |"""
s = ins_before(P, s, "**覆盖统计**：`OK` **89 条** ｜ `N/A` **1 条**（`REQ-AUTH-007`，负向约束）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 91 条**，与 `需求条目表.md` **集合一致**（模块内行序按本 Spec 自定）。", ROWS11)
s = rep(P, s, "**覆盖统计**：`OK` **89 条** ｜ `N/A` **1 条**（`REQ-AUTH-007`，负向约束）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 91 条**，与 `需求条目表.md` **集合一致**（模块内行序按本 Spec 自定）。",
        "**覆盖统计**：`OK` **92 条** ｜ `N/A` **1 条**（`REQ-AUTH-007`，负向约束）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 94 条**，与 `需求条目表.md` **集合一致**（2026-10-29 工程接入 +3）。")
s = rep(P, s, "> **REQ 集合与 `需求条目表.md` 的 91 条 `REQ-ID` 一致**", "> **REQ 集合与 `需求条目表.md` 的 94 条 `REQ-ID` 一致**")
# O-2：沿革串
s = rep(P, s, "→ **427**〔2026-10-26 审核流程优化 `EL-REVIEW-054` +1〕〕）",
        "→ **427**〔2026-10-26 审核流程优化 `EL-REVIEW-054` +1〕→ **435**〔2026-10-26 B9 +8：`EL-REVIEW-055`~`062`〕→ **447**〔2026-10-29 工程接入 +12：`EL-PROJ-048`~`057`、`EL-KB-025`/`026`〕〕）")
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.", "| **v0.2.16** | **2026-10-29** | **「工程接入（一期）`F17`/`F18` + 第 27 轮一致性校对（`§㊸`）销项」**：① **§4.2.2 补 4 行**（`EL-PROJ-048`/`051`/`052`/`053`/`055`/`057` ↔ `#73`/`#1`/`#3`，含 `source_kind` 映射与失败处理）、**§4.2.3 补 1 行**（`EL-KB-025` ↔ `#7`/`#74`、空态 `EL-KB-026`）；② **§10.1 补 3 行埋码点**（`EVT_intake_click`/`done`/`failed`），§10 埋码点 **54 → 57 行**；③ **§11 追溯表 91 → 94 行**（+`REQ-INTAKE-001/002/003`；统计 `OK` 89→**92**）；④ §1 关联文档与 §1 上游主输入同步 94；⑤ 沿革串补 `435`/`447`（原止于 427）。**未重排任何编号** | App 角色（工程接入 + `§㊸` 销项） |")
run(P, s)

# ==================== 4) 埋点-Spec ====================
P = "platform/specs/埋点-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.1.10** ｜", "> 版本：**v0.1.11** ｜")
# O-2 沿革（:6/:50 两处）
s = rep(P, s, "→ **427**〔2026-10-26 审核流程优化 `EL-REVIEW-054` +1〕）",
        "→ **427**〔2026-10-26 审核流程优化 `EL-REVIEW-054` +1〕→ **435**〔2026-10-26 B9 +8〕→ **447**〔2026-10-29 工程接入 +12〕）", cnt=2)
s = rep(P, s, "A 线用**平台自己的** **435** 个元素（B9 +8）", "A 线用**平台自己的** **447** 个元素（2026-10-29 工程接入 +12；B9 +8）")
# O-3
s = rep(P, s, "事件定义、参数、上报时机与去重规则**均不变**（`EVT_chat_*` 仍为 4 条，事件总数仍 **54**）。",
        "事件定义、参数、上报时机与去重规则**均不变**（`EVT_chat_*` 仍为 4 条；**事件总数 57**〔2026-10-29 工程接入 +3 后〕）。")
s = rep(P, s, "| V-01 | 事件名 ∈ 本 Spec 的 **54 条**枚举 |", "| V-01 | 事件名 ∈ 本 Spec 的 **57 条**枚举 |")
s = rep(P, s, "上表 **54 条** = §3 各分节之和", "上表 **57 条** = §3 各分节之和")
s = rep(P, s, "（**§3.1 = 6**、§3.2 = 5、§3.3 = 5", "（**§3.1 = 6**、§3.2 = 8、§3.3 = 5")
s = rep(P, s, "+ **辅助 32 条**（原 30 + 本机落地 2）= 54。", "+ **辅助 35 条**（原 30 + 本机落地 2 + 工程接入 3）= 57。")
# B4：§9 追溯表
s = rep(P, s, "> **逐行对齐 `需求条目表.md` 的 91 条 `REQ-ID`**", "> **逐行对齐 `需求条目表.md` 的 94 条 `REQ-ID`**")
ROWS9 = """| `REQ-INTAKE-001` | 接入已有工程 | `EVT_intake_click`、`EVT_intake_done`、`EVT_intake_failed` | OK | 辅助事件（**非漏斗节点**）；参数不含路径 / 工程名文本 |
| `REQ-INTAKE-002` | 工程约束（查看 / 编辑） | — | N/A | 无独立业务问题，**显式不埋** |
| `REQ-INTAKE-003` | 约束注入下游 | — | N/A | 服务端提示词层，客户端不可观测，**显式不埋** |"""
s = ins_before(P, s, "**覆盖率小结（本表口径，机核）**：**91 行**已逐行对齐 = `OK` **68 条** + `N/A` **23 条** + `GAP` **0 条** + `Deferred` **0 条**；**无空白行**。", ROWS9)
s = rep(P, s, "**覆盖率小结（本表口径，机核）**：**91 行**已逐行对齐 = `OK` **68 条** + `N/A` **23 条** + `GAP` **0 条** + `Deferred` **0 条**；**无空白行**。",
        "**覆盖率小结（本表口径，机核）**：**94 行**已逐行对齐 = `OK` **69 条** + `N/A` **25 条** + `GAP` **0 条** + `Deferred` **0 条**；**无空白行**（2026-10-29 工程接入 +3）。")
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.1", "| **v0.1.11** | **2026-10-29** | **「第 27 轮一致性校对（`§㊸`）销项」**：① §9 追溯表 **91 → 94 行**（+`REQ-INTAKE-001`/`002`/`003`；覆盖率小结 `OK` 68→**69**、`N/A` 23→**25**）；② §2 V-01 与 §3 计数核对、附节 C 沿革与 §0 处的 `54` **全量改为 57**（§3.2 = 5 → **8**、辅助 32 → **35**）；③ 沿革串补 `435`/`447`（原止于 427）。**事件名与编号零重排** | 埋点角色（`§㊸` 销项） |")
run(P, s)

# ==================== 5) RTM 骨架（O-1 表格修复） ====================
P = "platform/requirements/需求追溯矩阵-骨架.md"; s = io.open(P, encoding="utf-8").read()
STRAY = """
| `REQ-INTAKE-001` | 接入已有工程（入口与路径登记；只读扫描） | P0 | —待填 | —待填 | —待填 | —待填 | —待填 | GAP |
| `REQ-INTAKE-002` | 工程约束（提取物可查看 / 编辑） | P0 | —待填 | —待填 | —待填 | —待填 | N/A | —待填 | GAP |
| `REQ-INTAKE-003` | 约束注入下游与工程一致性（门禁 J 组） | P0 | —待填 | —待填 | —待填 | —待填 | N/A | —待填 | GAP |
"""
INROW = """| `REQ-INTAKE-001` | 接入已有工程（入口与路径登记；只读扫描） | P0 | —待填 | —待填 | —待填 | —待填 | —待填 | GAP |
| `REQ-INTAKE-002` | 工程约束（提取物可查看 / 编辑） | P0 | —待填 | —待填 | —待填 | N/A | —待填 | GAP |
| `REQ-INTAKE-003` | 约束注入下游与工程一致性（门禁 J 组） | P0 | —待填 | —待填 | —待填 | N/A | —待填 | GAP |"""
# 先删掉插错位置的 3 行（可能在 --- 之后、标题之前）
s = rep(P, s, STRAY, "\n")
s = rep(P, s, INROW + "\n", "")
# 再插到 TRACK-003 行之后（表内）
s = ins_after_last(P, s, r"^\| `REQ-TRACK-003` \|", INROW)
run(P, s)

if FAILED:
    print("!! 有 %d 处未命中：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: 第一批销项完成")
