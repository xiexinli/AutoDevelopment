# -*- coding: utf-8 -*-
"""R1：把 REQ-INTAKE-001/002/003 补进 S4 拆解产出（需求条目表 + 五角色需求包 + RTM 骨架 + README）。
编号续编（新模块 INTAKE），不改既有编号；91 → 94。"""
import io, sys
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

def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ---------------- 需求条目表 ----------------
P = "platform/requirements/需求条目表.md"; s = io.open(P, encoding="utf-8").read()
SECT = """### INTAKE · 工程接入与约束（`§F17`/`§F18` · **2026-10-29 追加**）

> 来源：`§13`（平台需求概要第 5 轮回写）+ `接入已有Android工程-需求提案-v0.1.md` §12（七项决策）+ `reviews/C1-工程接入一期落地记录-20261029.md`。
> **`D-X3` 已移出排除清单**（见 §0.6 注）；**一期只读、二期写回**（`REQ-PATCH-001` 属**二期**，本表先登记为 `Deferred`）。

| REQ-ID | 需求摘要 | 优先级 | 涉及角色 | 来源(§章节/表格) |
|---|---|---|---|---|
| `REQ-INTAKE-001` `[＋]` | 当需求方要接入既有的本机 Android 工程时，可从项目列表「接入已有工程」进入：填**工程根目录（绝对路径）**、项目名（默认目录名）、**显式勾选只读授权**，平台**只读扫描**并登记（`#73`）；非绝对路径 / 目录不存在 / 非 Android 工程 / 未授权 → 400；提交类**幂等**；接入后项目标记 `source_kind=imported` | P0 | UI / 接口 / App / 埋点 / 测试 | `§F17`；`§13.C`；`接口契约 §1.14 #73`；`AC-INTAKE-01~03` |
| `REQ-INTAKE-002` `[＋]` | 接入后平台提取**项目约束包**（agent 配置 / 框架与依赖 / 架构与命名 / 构建命令），**每项带来源**；约束正文进知识库 **`constraints` 分区**（`#74`），用户可编辑（`#75`，`If-Match`）；未接入读约束 → 404 | P0 | UI / 接口 / App / 测试 | `§F17`；`§13.C`（`D7=A`）；`接口契约 §1.14 #74/#75`；`AC-INTAKE-04~06` |
| `REQ-INTAKE-003` `[＋]` | 约束包摘要注入 **PRD 审核 / 需求拆解 / Spec 生成** 三处提示词；**冲突时以工程约束为准**（`D4=A`），冲突项**不静默改工程**、列入门禁 **J 组**（仅严格档）为待澄清 | P0 | 接口 / App / 测试 | `§F18`；`§13.C`；`D4=A`/`D6=C`；`AC-INTAKE-07~08` |

> **二期（`D1=B` / `D3`）**：`REQ-PATCH-001`（增量改动写回登记工程根 + 快照 + 一键回滚）—— **状态 `Deferred`**，不阻塞一期。

"""
s = ins_before(P, s, "## 二、编号来源对照（哪些是 PRD 原编号、哪些是本次追加）", SECT)
s = rep(P, s, "| `§F16` 交付与归档 | `REQ-DELIVER-001`~`004` | ✅ |",
        "| `§F16` 交付与归档 | `REQ-DELIVER-001`~`004` | ✅ |\n| `§F17` 工程接入与约束提取 | `REQ-INTAKE-001`、`REQ-INTAKE-002` | ✅ |\n| `§F18` 约束注入与工程一致性 | `REQ-INTAKE-003` | ✅ |")
s = rep(P, s, "| **本次拆解追加（`[＋]`，共 66 条，模块内顺序追加，不插号、不复用）** | 其余全部（见第一节逐行标注） |",
        "| **本次拆解追加（`[＋]`，共 66 条，模块内顺序追加，不插号、不复用）** | 其余全部（见第一节逐行标注） |\n| **2026-10-29 工程接入追加（`[＋]`，3 条；新模块 `INTAKE`）** | `REQ-INTAKE-001`、`REQ-INTAKE-002`、`REQ-INTAKE-003`（二期 `REQ-PATCH-001` 登记为 `Deferred`，未计入） |")
s = rep(P, s, "| **合计** | **REQ 总数 = 91**（`[原]` 25 + `[＋]` 66） |",
        "| **合计** | **REQ 总数 = 94**（`[原]` 25 + `[＋]` 66 + **`[＋]2026-10-29` 3**） |")
s = rep(P, s, "**拆解自检结论**：把 91 条 REQ 的摘要连起来读", "**拆解自检结论**：把 94 条 REQ 的摘要连起来读")
s = rep(P, s, "跨端（iOS/跨平台/一端生成另一端，`D-X1`）｜已有项目改样式（`D-X3`）｜图表/地图",
        "跨端（iOS/跨平台/一端生成另一端，`D-X1`）｜图表/地图")
s = rep(P, s, "——对应 `REQ-BASE-001`、`REQ-AUTH-007`。",
        "——对应 `REQ-BASE-001`、`REQ-AUTH-007`。\n\n> ⚠️ **2026-10-29 更新**：`D-X3`「已有项目改样式 / 在既有工程上作业」**已移出排除清单**，本期纳入（`§F17`/`§F18` → `REQ-INTAKE-001`~`003`；`REQ-BASE-001` 中的「从新建项目开始」一句对 **greenfield 模式**仍然有效，brownfield 为**并列**第二种模式）。")
run(P, s)

# ---------------- README（requirements） ----------------
P = "platform/requirements/README.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "**91 条需求条目表**", "**94 条需求条目表**")
s = rep(P, s, "**RTM 骨架**（91 行正向表", "**RTM 骨架**（94 行正向表")
s = rep(P, s, "| REQ 总数 | **91**（`[原]` 25 + `[＋]` 66） |", "| REQ 总数 | **94**（`[原]` 25 + `[＋]` 66 + `[＋]2026-10-29` 3） |")
s = rep(P, s, "| 模块数 | 19（PROJ / KB / UPLOAD / REVIEW / CHAT / SPLIT / SPEC / PROOF / UIEDIT / GEN / PREVIEW / API / CAP / BASE / NF / AUTH / DELIVER / DESIGN / TRACK） |",
        "| 模块数 | **20**（PROJ / KB / UPLOAD / REVIEW / CHAT / SPLIT / SPEC / PROOF / UIEDIT / GEN / PREVIEW / API / CAP / BASE / NF / AUTH / DELIVER / DESIGN / TRACK / **INTAKE**〔2026-10-29 新增〕） |")
s = rep(P, s, "| 涉及角色分布 | UI **67** ｜ 接口 **87** ｜ App **87** ｜ 埋点 **18** ｜ 测试 **90**（同一 REQ 可多角色；每条至少一个角色） |",
        "| 涉及角色分布 | UI **69** ｜ 接口 **90** ｜ App **90** ｜ 埋点 **19** ｜ 测试 **93**（2026-10-29 工程接入 +3 REQ；同一 REQ 可多角色；每条至少一个角色） |")
s = rep(P, s, "| 对应基线 | PRD `§F1`~`§F16` 全覆盖；`S0`~`S9` 由 `E2E-01`~`E2E-09` 承载 |",
        "| 对应基线 | PRD `§F1`~`§F18` 全覆盖（`§F17`/`§F18` 为 2026-10-29 工程接入新增）；`S0`~`S9` 由 `E2E-01`~`E2E-09` 承载 |")
run(P, s)

# ---------------- UI-需求包 ----------------
P = "platform/requirements/UI-需求包.md"; s = io.open(P, encoding="utf-8").read()
ROWS = """| `REQ-INTAKE-001` | 接入已有工程（入口与路径登记） | 页面 `UI-PROJ-001`：新增「**接入已有工程**」次按钮（`EL-PROJ-048`，在「新建项目」左）、接入弹窗（`EL-PROJ-049`~`056`）—— 工程根目录（绝对路径，必填）、项目名（默认目录名）、**只读授权勾选（必勾）**、说明文案、`扫描并接入`/`取消`；成功 Toast「已接入工程（{项目名}），提取约束 {n} 项」；失败**保留已填内容** + 服务端 `message` 原文；项目卡片显示「**已接入工程**」标签（`EL-PROJ-057`）；三态与逐字文案见 `UI-Spec §4.2` |
| `REQ-INTAKE-002` | 工程约束（提取物可查看 / 编辑） | 页面 `UI-KB-001`：新增第 **5 分区 Tab「工程约束」**（`EL-KB-025`）+ 该分区空态（`EL-KB-026`：「这个项目还没有接入工程约束。回到项目列表点「接入已有工程」即可。」）；约束正文为 Markdown，**复用 `EL-KB-017`~`020` 的查看/编辑三件套**（切分区保留各自关键词） |"""
s = ins_before(P, s, "## 二、页面清单（UI Spec 的页面级骨架，逐页对 `页面规格.md`）", ROWS)
run(P, s)

# ---------------- 接口-需求包 ----------------
P = "platform/requirements/接口-需求包.md"; s = io.open(P, encoding="utf-8").read()
ROWS = """| `REQ-INTAKE-001` | 接入已有工程 | `#73 POST /projects/{id}/engineering-intake`：入参 `{root: 绝对路径, confirm: true}`；**只读**扫描本机工程根目录；`confirm≠true` / 非绝对路径 / 目录不存在 / 非 Android 工程 → 400 `INVALID_ARGUMENT`（message 可直接展示）；**提交类 → 幂等**（`REQ-NF-006`）；出参 `{source_kind:"imported", engineering_root, kb_doc_id, project_name, android{agp,kotlin,gradle,compile_sdk,min_sdk,target_sdk,java}, counts{}, warnings[]}` |
| `REQ-INTAKE-002` | 工程约束 | `#74 GET /projects/{id}/constraints` → `{source_kind, engineering_root, pack{}, kb_doc_id, content_md, origin, version, updated_at, summary}`；未接入 → 404。`#75 PUT /projects/{id}/constraints`：`{content_md}`，`origin→user_edited`，**须 `If-Match`**，冲突 409。`#7` 的 `sector` 扩容值 **`constraints`**；`#1` 列表项 / `#3` 详情增 **`source_kind`**（+ 详情 `engineering_root`） |
| `REQ-INTAKE-003` | 约束注入与工程一致性 | **不新增接口**：约束摘要注入 `#16`（审核）/ `#28`（拆解）/ `#30`（Spec 生成）三处提示词；门禁标准新增 **J 组**（`J1`/`J2`，**仅严格档 `strict` 运行**）—— `#24` 项目级门禁标准 `items[]` 可含 `group:"J"`；冲突**以工程约束为准**、列为待澄清 |"""
s = ins_before(P, s, "## 3 《UI 数据供给对照表》的要求（本 Spec 最核心一节，**零缺口**）", ROWS)
run(P, s)

# ---------------- App-需求包 ----------------
P = "platform/requirements/App-需求包.md"; s = io.open(P, encoding="utf-8").read()
ROWS = """| `REQ-INTAKE-001` | 接入已有工程 | 路由 `RT-PROJ-001`；接入弹窗为**局部状态**（打开 / 校验中 / 提交中 / 失败）；提交前**两项前端校验**（根目录非空、授权已勾选）；**首次提交先建项目再调 `#73`**，失败重试**复用同一项目、不重复建**；成功后关闭弹窗 + 局部刷新列表；失败**保留已填内容**并展示服务端 `message` |
| `REQ-INTAKE-002` | 工程约束查看 / 编辑 | 路由 `RT-KB-001`；知识库**第 5 分区**（`sector=constraints`）；切分区**保留各自关键词**；编辑态**替换**预览区（复用 `EL-KB-018`）、`If-Match` 冲突 → 409 提示「该内容已被他人修改。」+ diff，**不静默覆盖** |
| `REQ-INTAKE-003` | 约束注入下游 | 路由无变化（`RT-REVIEW-001`/`RT-SPLIT-001`/`RT-SPEC-001`）；**App 侧只做展示**（严格档审核页会出现 `J` 组检查项与「工程一致性」分组标题）；**不新增任何客户端行为** |"""
s = ins_before(P, s, "## 2 页面组织与路由（`RT-*` ↔ `UI-*` 一一映射）", ROWS)
run(P, s)

# ---------------- 埋点-需求包 ----------------
P = "platform/requirements/埋点-需求包.md"; s = io.open(P, encoding="utf-8").read()
ROWS = """| `REQ-INTAKE-001` | 接入已有工程 | **辅助事件**（非漏斗节点）：① 「点击接入入口」= `EL-PROJ-048` `onClick`（弹窗打开前，**不发请求**）；② 「接入成功」= `#73` 返回成功且 Toast 渲染之后，参数含 `counts_items`/`counts_modules`/`counts_dependencies`/`warnings_count`/`duration_ms`；③ 「接入失败」= `#73` 返回 400/404/409/超时且错误提示渲染之后，参数含 `error_code` + `block_reason`（`no_root`/`no_consent`/`not_android`/`other`）。**不得上报用户填写的工程路径与项目名文本**（工程名只报长度）。见 `埋点-Spec §3.2`（`EVT_intake_click`/`done`/`failed`） |
| `REQ-INTAKE-002` | 工程约束查看 / 编辑 | **不新增事件**：约束分区浏览/编辑复用 `EL-KB-*` 既有交互，**无独立业务问题** → 显式表态**不埋**（理由：无业务问题，与「不埋」口径一致） |
| `REQ-INTAKE-003` | 约束注入下游 | **不新增事件**：注入发生在服务端提示词层，客户端不可观测 → 显式表态**不埋** |"""
s = ins_before(P, s, "## 3 漏斗定义（`AC-TR-01` 的判定依据，必须能**逐节点还原**）", ROWS)
run(P, s)

# ---------------- 测试-需求包 ----------------
P = "platform/requirements/测试-需求包.md"; s = io.open(P, encoding="utf-8").read()
ROWS = """| `REQ-INTAKE-001` | 接入已有工程 | **接口**：`root` 非绝对路径 / 目录不存在 / 非 Android 工程 / `confirm≠true` → 400；合法工程 → 200 且 `source_kind=imported`、`engineering_root` 回写；**同键重放返回首次结果**（`AC-INTAKE-01~03`）｜**App**：未勾选授权 / 根目录为空 → 提交前拦截且**保留已填内容**；首次失败后重试**复用同一项目**；成功后列表出现「已接入工程」标签｜**埋点**：`EVT_intake_done` 只报一次（幂等重放不二次计数）；**参数不含路径/工程名文本** |
| `REQ-INTAKE-002` | 工程约束 | **接口**：`#74` 未接入 → 404；`#75` `If-Match` 不匹配 → 409；`sector=constraints` 出现在 `#7` 列表；`#1`/`#3` 返回 `source_kind`（`AC-INTAKE-04~06`）｜**App**：切到第 5 分区显示约束 doc；编辑保存成功 Toast；409 提示 + 不覆盖｜**埋点**：`N/A`（显式不埋） |
| `REQ-INTAKE-003` | 约束注入 | **接口**：门禁标准含 `J` 组且**仅严格档**运行；注入后审核/拆解/Spec 提示词含约束摘要（可用可控桩断言入参）｜**App**：严格档审核页出现「工程一致性」分组｜**埋点**：`N/A`（显式不埋）｜**E2E**：接入既有工程 → 审核（strict）→ 拆解 → Spec，全程不出现与工程约束冲突的产出（`AC-INTAKE-07~08`） |"""
s = ins_before(P, s, "## 2 E2E 对照（`验收标准 §1` 的 E2E-01~09 → 本包执行要点）", ROWS)
s = rep(P, s, "| REQ 总数 | **91**（见 `需求条目表.md`） |", "| REQ 总数 | **94**（见 `需求条目表.md`；含 2026-10-29 工程接入 `REQ-INTAKE-001`~`003`） |")
run(P, s)

# ---------------- RTM 骨架 ----------------
P = "platform/requirements/需求追溯矩阵-骨架.md"; s = io.open(P, encoding="utf-8").read()
ROWS = """| `REQ-INTAKE-001` | 接入已有工程（入口与路径登记；只读扫描） | P0 | —待填 | —待填 | —待填 | —待填 | —待填 | GAP |
| `REQ-INTAKE-002` | 工程约束（提取物可查看 / 编辑） | P0 | —待填 | —待填 | —待填 | N/A | —待填 | GAP |
| `REQ-INTAKE-003` | 约束注入下游与工程一致性（门禁 J 组） | P0 | —待填 | —待填 | —待填 | N/A | —待填 | GAP |"""
s = ins_before(P, s, "## 二、反向：角色条目 → 需求（★ 孤儿检测）", ROWS)
s = rep(P, s, "## 一、正向：需求 → 角色条目（**骨架，91 行**）", "## 一、正向：需求 → 角色条目（**骨架，94 行**）")
s = rep(P, s, "**合计 91 条**（`需求条目表.md` 逐行对齐；`[原]` 25 + `[＋]` 66）。",
        "**合计 94 条**（`需求条目表.md` 逐行对齐；`[原]` 25 + `[＋]` 66 + `[＋]2026-10-29` 3）。")
s = rep(P, s, "| REQ 总数 | **91** |", "| REQ 总数 | **94** |")
s = rep(P, s, "| 全部 91 条 | 五列均未填 target |", "| 全部 94 条 | 五列均未填 target |")
run(P, s)

if FAILED:
    print("!! 有 %d 处未命中：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: R1 需求登记完成（需求条目表 + README + UI/接口/App/埋点/测试需求包 + RTM 骨架）")
