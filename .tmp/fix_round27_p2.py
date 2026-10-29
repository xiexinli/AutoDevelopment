# -*- coding: utf-8 -*-
"""§㊸ 销项 · 第二批：R2（测试-Spec 用例 + §12 追溯表）+ R5（门禁 J 组）+ R3（baseline RTM 复刷）。"""
import io, re, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: count=%d(exp %d) :: %r" % (p, n, cnt, old[:70])); return s
    return s.replace(old, new, cnt)
def ins_before(p, s, anchor, text):
    if s.count(anchor) != 1: FAILED.append("%s :: anchor x%d :: %r" % (p, s.count(anchor), anchor[:60])); return s
    return s.replace(anchor, text + "\n" + anchor, 1)
def ins_after_last(p, s, line_re, text):
    lines = s.split("\n"); idx = -1
    for i, ln in enumerate(lines):
        if re.match(line_re, ln): idx = i
    if idx < 0: FAILED.append("%s :: no line %r" % (p, line_re)); return s
    lines.insert(idx + 1, text); return "\n".join(lines)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ==================== R2 · 测试-Spec ====================
P = "platform/specs/测试-Spec.md"; s = io.open(P, encoding="utf-8").read()
SEC418 = """### 4.18 工程接入（`#73`~`#75` · 组 1.14）—— **2026-10-29 工程接入（一期）**

> **来源与状态**：对应 `接口-Spec §5.4.15`（组 1.14「工程接入」）与 `接口契约 §1.14`。**一期只读**（`D1=B`），不写任何工程文件。
> **判定依据**：状态码与 `code` 引 `接口-Spec §5.2`（13 错误码）；出参字段引 `§5.4.15`；界面落点引 `UI-Spec §4.2`。

| 用例 ID | API-ID | 对应 REQ-ID | 场景 | 前置条件 | 操作步骤 | 入参 | 期望状态码 | 期望错误码/文案 | 优先级 |
|---|---|---|---|---|---|---|---|---|---|
| TC-INTAKE-101 | `#73` `POST /projects/{id}/engineering-intake` | `REQ-INTAKE-001` | **正向：合法工程接入成功** | 本机存在合法 Android 工程（含 `settings.gradle*` 或 `AndroidManifest.xml`）+ 已登录 | 1. 调 `#73` | `{root:"<绝对路径>", confirm:true}` | 200 | —（出参含 `source_kind=imported`/`engineering_root`/`kb_doc_id`/`counts`） | P0 |
| TC-INTAKE-102 | `#73` | `REQ-INTAKE-001` | **★异常：未确认授权** | 同上 | 1. 不传 `confirm`；2. 传 `confirm:false` | `{root}` / `{root, confirm:false}` | 400 | `INVALID_ARGUMENT`「请先确认授权平台只读扫描这个目录。」 | P0 |
| TC-INTAKE-103 | `#73` | `REQ-INTAKE-001` | **★异常：非法路径 / 非 Android 工程** | — | 1. 相对路径；2. 不存在的目录；3. 存在的非 Android 目录 | 三组 | 400 | `INVALID_ARGUMENT`（message 可直接展示，不泄露本机其它信息） | P0 |
| TC-INTAKE-104 | `#73` | `REQ-INTAKE-001`、`REQ-NF-006` | **幂等：同键重放返回首次结果** | 已完成 `TC-INTAKE-101` | 1. 用**同一** `Idempotency-Key` 再发一次 | 同 101 | 200 | 与首次结果一致；**不产生第二个项目、不二次副作用** | P1 |
| TC-INTAKE-105 | `#74` `GET /projects/{id}/constraints` | `REQ-INTAKE-002` | **正向：读约束包** | 已完成接入 | 1. 调 `#74` | — | 200 | 含 `pack{}`/`content_md`/`summary`/`version`/`source_kind=imported` | P0 |
| TC-INTAKE-106 | `#74` | `REQ-INTAKE-002` | **异常：未接入项目** | 新建空项目 | 1. 调 `#74` | — | 404 | `NOT_FOUND` | P1 |
| TC-INTAKE-107 | `#75` `PUT /projects/{id}/constraints` | `REQ-INTAKE-002` | **正向 + 乐观锁** | 已接入 | 1. 用当前 `version` 作 `If-Match` 提交；2. 用**旧** `If-Match` 再提交 | `{content_md}` | 200 / 409 | 成功 → `origin=user_edited`；冲突 → `VERSION_CONFLICT`，**不静默覆盖** | P0 |
"""
s = ins_before(P, s, "## 5 第二层 · App 测试", SEC418)
SEC515 = """### 5.15 工程接入（跨 `RT-PROJ-001` / `RT-KB-001`）—— **2026-10-29 工程接入（一期）**

| 用例 ID | 路由 ID | 对应 REQ-ID | 场景 | 前置条件 | 操作步骤 | 预期结果（引用 UI 文案） | 优先级 |
|---|---|---|---|---|---|---|---|
| TC-INTAKE-201 | `RT-PROJ-001` | `REQ-INTAKE-001` | **★前置拦截：未勾选授权** | 接入弹窗已打开 | 1. 填工程根目录；2. **不勾选**只读授权；3. 点「扫描并接入」 | Toast「**请先确认授权平台只读扫描这个目录。**」；**不发出 `#73`**；**保留已填内容** | P0 |
| TC-INTAKE-202 | `RT-PROJ-001` | `REQ-INTAKE-001` | **正向：接入成功 + 卡片标签** | 合法工程路径 | 1. 勾选授权 → 提交 | Toast「**已接入工程（{项目名}），提取约束 {n} 项**」；列表出现该项目并显示「**已接入工程**」标签 | P0 |
| TC-INTAKE-203 | `RT-PROJ-001` | `REQ-INTAKE-001` | **★失败保留已填内容 + 重试复用同一项目** | — | 1. 用非法路径提交失败；2. 改为合法路径重试 | 失败：展示服务端 `message`、**保留已填内容**；重试：**不产生第二个项目**（复用同一 `project_id`） | P0 |
| TC-INTAKE-204 | `RT-KB-001` | `REQ-INTAKE-002` | **第 5 分区空态** | 未接入的项目 | 1. 打开知识库 → 切「工程约束」 | 「**这个项目还没有接入工程约束。回到项目列表点「接入已有工程」即可。**」 | P1 |
"""
s = ins_before(P, s, "## 6 第三层 · 埋点测试", SEC515)
SEC6114 = """#### 6.1.14 工程接入（§3.2 扩展 · 2026-10-29 新增 3 事件）

| 用例 ID | 事件名 | 对应 REQ-ID | 场景 | 前置条件 | 操作步骤 | 预期（时机 / 参数 / 条数） | 优先级 |
|---|---|---|---|---|---|---|---|
| TC-INTAKE-301 | `EVT_intake_click` | `REQ-INTAKE-001` | **正向：点击入口即上报** | 项目列表已打开 | 1. 点「接入已有工程」 | **1 条**；弹窗打开**之前**；`entry=header`；**300ms 内连点只 1 条** | P1 |
| TC-INTAKE-302 | `EVT_intake_done` | `REQ-INTAKE-001` | **★正向：成功只报 1 次** | 合法工程 | 1. 接入成功；2. 幂等重放一次 | **1 条**（重放**不二次计数**）；含 `counts_items`/`counts_modules`/`counts_dependencies`/`warnings_count`/`duration_ms`；**不含路径与工程名文本**（工程名只报长度） | P0 |
| TC-INTAKE-303 | `EVT_intake_failed` | `REQ-INTAKE-001` | **★正向：失败与拦截都上报** | — | 1. 未勾选授权提交；2. 非法路径提交 | 各 **1 条**；`block_reason` = `no_consent` / `not_android`；`error_code` 与响应一致；**不含用户填写的路径 / 工程名文本** | P1 |
| TC-INTAKE-304 | `EVT_intake_click` | `REQ-INTAKE-001` | **边界：连点去重** | — | 1. 300ms 内连点 2 次 | 仍只 **1 条** | P2 |
| TC-INTAKE-305 | `EVT_intake_done` | `REQ-INTAKE-001` | **边界：工程名为空 / 超长** | 目录名为空 | 1. 接入一个目录名异常（空 / 超 50 字）的工程 | 仍成功；`project_name_chars` 为实际长度（≤50），**不上报文本** | P2 |
| TC-INTAKE-306 | `EVT_intake_failed` | `REQ-INTAKE-001` | **边界：超时 / 网络异常** | — | 1. 断网后提交 | 上报 1 条，`error_code=NETWORK_ERROR` 或 `UPSTREAM_TIMEOUT` | P2 |

"""
s = ins_before(P, s, "### 6.2 漏斗 9 节点可串联（`AC-TR-01`、`E2E-08`）", SEC6114)
SEC710 = """### 7.10 `TC-E2E-010` · 工程接入 → 严格档审核 → 拆解 → Spec（`AC-INTAKE-07`/`AC-INTAKE-08`）

1. **接入**：选一个合法 Android 工程接入（`TC-INTAKE-101`/`202`），确认约束包已落 `sector=constraints`。
2. **严格档审核**：以 `strict` 触发审核 → 应评清单**包含 `J` 组**（`J1`/`J2`，组标题「工程一致性」）；故意让 PRD 与工程约束冲突（如 `minSdk` / 包名 / 依赖）→ 冲突项判 `fail` 并进《待澄清清单》，**不得静默改写工程**。
3. **拆解 → Spec**：走完拆解与 5 份 Spec 生成 → 产出与该工程约束一致（`AGP`/`Kotlin`/`minSdk`/包名/依赖与版本锁定）。
4. **反向校验**：以 `quick` / `standard` 重跑审核 → **不出现 `J` 组**（`AC-INTAKE-08`）。

"""
s = ins_before(P, s, "## 8 状态迁移覆盖（依据 `数据模型.md` 的状态机）", SEC710)
# §6.1 头
s = rep(P, s, "### 6.1 逐事件用例（54 事件 × 正向 + 边界 = 108 条）", "### 6.1 逐事件用例（57 事件 × 正向 + 边界 = 114 条）")
s = rep(P, s, "`埋点-Spec.md`（**54 事件** / 9 节点漏斗 / 7 条合规事件）。", "`埋点-Spec.md`（**57 事件** / 9 节点漏斗 / 7 条合规事件）。")
s = rep(P, s, "| 4 | 校验 **54 个事件** | 逐事件 | §6.1 的 **108 条**用例全通过", "| 4 | 校验 **57 个事件** | 逐事件 | §6.1 的 **114 条**用例全通过")
# §12
s = rep(P, s, "## 12 需求追溯表（91 条 REQ ↔ 测试用例）", "## 12 需求追溯表（94 条 REQ ↔ 测试用例）")
s = rep(P, s, "> **口径**：逐行对齐 `需求条目表.md` 的 91 条 REQ；", "> **口径**：逐行对齐 `需求条目表.md` 的 94 条 REQ；")
ROWS12 = """| `REQ-INTAKE-001` | `TC-INTAKE-101`~`104` ｜ `TC-INTAKE-201`~`203` ｜ `TC-INTAKE-301`~`306` ｜ `TC-E2E-010` | OK | 接入 / 幂等 / 前置拦截 / 埋点三层齐备 |
| `REQ-INTAKE-002` | `TC-INTAKE-105`~`107` ｜ `TC-INTAKE-204` | OK | 读 / 写 / 乐观锁 + 第 5 分区空态 |
| `REQ-INTAKE-003` | `TC-E2E-010` | OK | 注入发生在服务端提示词层，由 E2E 串联验证（严格档 `J` 组 + Spec 一致性） |"""
s = ins_before(P, s, "**覆盖率小结（本表口径，机核 · 2026-10-21 重算）**：**91 行**逐行对齐 = `OK` **89 条** + `GAP` **0 条** + `N/A` **2 条**（", ROWS12)
s = rep(P, s, "**覆盖率小结（本表口径，机核 · 2026-10-21 重算）**：**91 行**逐行对齐 = `OK` **89 条** + `GAP` **0 条** + `N/A` **2 条**（",
        "**覆盖率小结（本表口径，机核 · 2026-10-29 重算）**：**94 行**逐行对齐 = `OK` **92 条** + `GAP` **0 条** + `N/A` **2 条**（")
# 用例总数
s = rep(P, s, "| **用例总数** | **600 条**（表内定义行 **591 条** + §7 E2E 串联 **9 条** `TC-E2E-001`~`TC-E2E-009`）",
        "| **用例总数** | **618 条**（表内定义行 **608 条** + §7 E2E 串联 **10 条** `TC-E2E-001`~`TC-E2E-010`）（**2026-10-29 工程接入 +18**：§4.18 接口层 7 + §5.15 App 层 4 + §6.1.14 埋点层 6 + §7.10 E2E 1）。此前 **600 条**（表内定义行 **591 条** + §7 E2E 串联 **9 条** `TC-E2E-001`~`TC-E2E-009`）")
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.2", "| **v0.2.16** | **2026-10-29** | **「工程接入（一期）`F17`/`F18` + 第 27 轮一致性校对（`§㊸`）销项」**：① **新增 §4.18**（`#73`~`#75` 接口层 **7 条** `TC-INTAKE-101`~`107`）、**§5.15**（App 层 **4 条** `TC-INTAKE-201`~`204`）、**§6.1.14**（埋点层 **6 条** `TC-INTAKE-301`~`306`）、**§7.10**（E2E **1 条** `TC-E2E-010`），**+18 条**；② §12 追溯表 **91 → 94 行**（+`REQ-INTAKE-001/002/003`，全 `OK`；统计 `OK` 89→**92**）；③ §6.1 头 **54 → 57 事件**、**108 → 114 条**；④ §11 校验项 `54 → 57` / `108 → 114`；⑤ 用例总数 **600 → 618**（表内 591 → 608 + E2E 9 → 10）。**未重排任何编号** | 测试角色（工程接入 + `§㊸` 销项） |")
run(P, s)

# ==================== R5 · 门禁清单 J 组 ====================
P = "baseline/可开发性门禁清单.md"; s = io.open(P, encoding="utf-8").read()
s = s.rstrip("\n") + """

## J. 工程一致性（**仅严格档运行** · 2026-10-29 新增，`F18` / `D4=A` / `D6=C`）

> 适用条件：项目**已接入既有工程**（`tbl_project.source_kind='imported'`）。
> 运行档位：**仅 `strict`（严格档）**；`quick` / `standard` 不评本组。

| 编号 | 检查项 | 等级 |
|---|---|---|
| J1 | 产出与既有工程约束一致（依赖与版本锁定 / 包名 `namespace` / `minSdk` / 命名规范） | 重要 |
| J2 | 与既有工程约束**冲突**处已显式列为待澄清（**未擅自改写工程**） | 重要 |

> **判定依据**：`工程约束包`（知识库 `sector=constraints`，由 `#73` 提取）。**冲突时不静默改工程**，一律进《待澄清清单》交 PM。
> **实现落点**：`server/src/routes/review.ts` 的 `FULL_STANDARD_EXTRA`（`J1`/`J2`，`group:"J"`）；注入见 `server/src/adapters/llm.ts` 的 `constraintsNote()`。
> **来源**：`platform/平台需求概要.md` §13（`F18`）+ `接入已有Android工程-需求提案-v0.1.md` §12（`D4`/`D6`）。
"""
run(P, s)

# ==================== R3 · baseline RTM 复刷 ====================
P = "baseline/需求追溯矩阵.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "`platform/requirements/需求条目表.md`（91 条 REQ）", "`platform/requirements/需求条目表.md`（94 条 REQ）")
s = rep(P, s, "**REQ 集合一致、各 91 行**", "**REQ 集合一致、各 94 行**")
s = rep(P, s, "## 一、正向：需求 → 角色条目（**91 行**）", "## 一、正向：需求 → 角色条目（**94 行**）")
ROWS = """| `REQ-INTAKE-001` | 接入已有工程（入口与路径登记；只读扫描） | P0 | OK | OK | OK | OK | OK | 全 OK |
| `REQ-INTAKE-002` | 工程约束（提取物可查看 / 编辑） | P0 | OK | OK | OK | N/A | OK | 埋点显式不埋 |
| `REQ-INTAKE-003` | 约束注入下游与工程一致性（门禁 J 组） | P0 | N/A | OK | OK | N/A | OK | UI / 埋点不适用（已写理由） |"""
s = ins_before(P, s, "## 二、反向：角色条目 → 需求（★ 孤儿检测）", ROWS)
s = rep(P, s, "**合计 91 条**（`需求条目表.md` 逐行对齐；`[原]` 25 + `[＋]` 66）。", "**合计 94 条**（`需求条目表.md` 逐行对齐；`[原]` 25 + `[＋]` 66 + `[＋]2026-10-29` 3）。")
s = rep(P, s, "| REQ 总数 | **91** |", "| REQ 总数 | **94** |")
s = rep(P, s, "| 汇总 `OK` | **90** |", "| 汇总 `OK` | **93** |")
s = rep(P, s, "| 五列齐全（`OK`/`N/A`/`Deferred` 计入，`GAP` 不计）的 REQ 数 | **91** |", "| 五列齐全（`OK`/`N/A`/`Deferred` 计入，`GAP` 不计）的 REQ 数 | **94** |")
s = rep(P, s, "| **覆盖率（本表口径）** | **91/91 = 100.0%** |", "| **覆盖率（本表口径）** | **94/94 = 100.0%** |")
s = rep(P, s, "**`GAP` 不计入覆盖**，故为 `91/91 = 100.0%`。两者不矛盾，是两个不同的分母定义。",
        "**`GAP` 不计入覆盖**，故为 `94/94 = 100.0%`。两者不矛盾，是两个不同的分母定义。")
s = rep(P, s, "`测试-Spec §11.1` 的 100% 是「**已编制用例**口径」——即 91 条 REQ **全部挂了用例**",
        "`测试-Spec §11.1` 的 100% 是「**已编制用例**口径」——即 94 条 REQ **全部挂了用例**")
s = rep(P, s, "| UI | 68 | 22 | 1 | 0 | 91 |", "| UI | 70 | 23 | 1 | 0 | 94 |")
s = rep(P, s, "| 接口 | 86 | 4 | 1 | 0 | 91 |", "| 接口 | 89 | 4 | 1 | 0 | 94 |")
s = rep(P, s, "| App | 89 | 1 | 1 | 0 | 91 |", "| App | 92 | 1 | 1 | 0 | 94 |")
s = rep(P, s, "| 埋点 | 68 | 23 | 0 | 0 | 91 |", "| 埋点 | 69 | 25 | 0 | 0 | 94 |")
s = rep(P, s, "| 测试 | 89 | 2 | 0 | 0 | 91 |", "| 测试 | 92 | 2 | 0 | 0 | 94 |")
s = rep(P, s, "五份各自追溯表 91/91 行", "五份各自追溯表 94/94 行")
run(P, s)

# ==================== 关联计数（App-Spec 提到测试用例数） ====================
P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "`测试-Spec`（**600** 条用例，同批产出）", "`测试-Spec`（**618** 条用例，同批产出）")
run(P, s)

if FAILED:
    print("!! 有 %d 处未命中：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: 第二批销项完成（R2 + R5 + R3）")
