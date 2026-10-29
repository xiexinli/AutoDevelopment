# -*- coding: utf-8 -*-
"""二期文档同步 · B 批：UI-Spec + App-Spec + 埋点-Spec（元素 447→450、事件 57→59、App §4.2 301→302）。"""
import io, re, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:58])); return s
    return s.replace(old, new, cnt)
def ins_before(p, s, anchor, text):
    if s.count(anchor) != 1: FAILED.append("%s :: anchor x%d :: %r" % (p, s.count(anchor), anchor[:56])); return s
    return s.replace(anchor, text + "\n" + anchor, 1)
def ins_after_last(p, s, line_re, text):
    lines = s.split("\n"); idx = -1
    for i, ln in enumerate(lines):
        if re.match(line_re, ln): idx = i
    if idx < 0: FAILED.append("%s :: no line %r" % (p, line_re)); return s
    lines.insert(idx + 1, text); return "\n".join(lines)
def ins_before_first(p, s, line_re, text):
    lines = s.split("\n")
    for i, ln in enumerate(lines):
        if re.match(line_re, ln):
            lines.insert(i, text); return "\n".join(lines)
    FAILED.append("%s :: no line %r" % (p, line_re)); return s
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ==================== UI-Spec ====================
P = "platform/specs/UI-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.1.18** ｜", "> 版本：**v0.1.19** ｜")
s = rep(P, s, "｜ 更新：2026-10-29（**工程接入（一期）`F17`/`F18`**：",
        "｜ 更新：2026-10-29（**工程接入（二期 · 增量写回）**：新增 `EL-WORK-036`~`038`（写回面板 / 「写回工程」按钮 / 补丁记录条目），元素总数 **447 → 450**）；上一轮 2026-10-29（**工程接入（一期）`F17`/`F18`**：")
s = rep(P, s, "| `UI-WORK-001` | 工作台（主界面） | `WORK` | `REQ-PROJ-005`、`REQ-CHAT-001`、`REQ-UIEDIT-006`、`REQ-UIEDIT-007`、`REQ-GEN-005`、`REQ-GEN-007`、`REQ-GEN-008` | P0 |",
        "| `UI-WORK-001` | 工作台（主界面） | `WORK` | `REQ-PROJ-005`、`REQ-CHAT-001`、`REQ-UIEDIT-006`、`REQ-UIEDIT-007`、`REQ-GEN-005`、`REQ-GEN-007`、`REQ-GEN-008`、**`REQ-PATCH-001`** | P0 |")
s = rep(P, s, "| `EL-WORK-035` | 对话面板 · AI 处理过程**条目**（agent 的步骤，**与消息同列混排**） | 列表条目（消息列表内） | `EL-WORK-013` | 否（无步骤时不显示） |",
        "| `EL-WORK-035` | 对话面板 · AI 处理过程**条目**（agent 的步骤，**与消息同列混排**） | 列表条目（消息列表内） | `EL-WORK-013` | 否（无步骤时不显示） |\n"
        "| `EL-WORK-036` | 写回既有工程面板（含说明文案与空态；**仅 `source_kind=imported` 时渲染**） | 面板 | — | 否 |\n"
        "| `EL-WORK-037` | 「写回工程」按钮 | 主按钮 | `EL-WORK-036` | 是 |\n"
        "| `EL-WORK-038` | 补丁记录条目（含「回滚」按钮） | 列表行 | `EL-WORK-036` | 是（回滚） |")
s = rep(P, s, "| `EL-WORK-035` | —（**不可点击**；无独立展开 / 折叠） | 步骤作为**列表条目**与用户 / 平台消息**按时间混排在同一条时间线**里，随消息列表一起滚动 | — | 否（纯展示） |",
        "| `EL-WORK-035` | —（**不可点击**；无独立展开 / 折叠） | 步骤作为**列表条目**与用户 / 平台消息**按时间混排在同一条时间线**里，随消息列表一起滚动 | — | 否（纯展示） |\n"
        "| `EL-WORK-037` | 点击 | 把**最近一次成功的代码生成任务**产物交服务端按既有工程结构合并后写回（`#79`）；成功 → 刷新面板 + Toast「已写回工程：新增 {n} 个、替换 {m} 个文件」；失败 → 展示服务端 `message`，**不改动工程** | — | 是 | 无成功生成任务 → 按钮**禁用**；写回中 loading；**冲突/禁碰整批拒绝**（服务端） |\n"
        "| `EL-WORK-038`「回滚」 | 点击 | 二次确认后调 `#78`：`replace` 还原、`create` 删除；成功 Toast「已回滚：还原 {n} 个、删除 {m} 个文件」 | — | 是 | 已回滚的记录**不再显示回滚按钮** |")
S5 = """| `EL-WORK-037` | `UI-WORK-001` | 「写回工程」按钮与结果摘要 | `totals{create,replace}`、`notes[]`、`skipped[]` | 是 | 无成功生成任务 → 按钮禁用 | `#79 POST /projects/{id}/generation/{task_id}/writeback` |
| `EL-WORK-038` | `UI-WORK-001` | 补丁记录（状态 / 新增数 / 替换数 / 时间） | `patch_id`、`status ∈ {applied,rolled_back}`、`totals`、`created_at`、`rolled_back_at` | 是 | 无记录 → `还没有写回记录。` | `#77 GET /projects/{id}/patch-applications`；回滚 `#78` |"""
s = rep(P, s, "**统计**：本表共 **91 行**（2026-10-29 工程接入 +7：`EL-PROJ-048`/`051`/`052`/`053`/`055`/`057`、`EL-KB-025`）",
        "**统计**：本表共 **93 行**（2026-10-29 二期写回 +2：`EL-WORK-037`/`038`）（2026-10-29 工程接入 +7：`EL-PROJ-048`/`051`/`052`/`053`/`055`/`057`、`EL-KB-025`）")
s = ins_before(P, s, "**统计**：本表共 **93 行**", S5)
s = rep(P, s, "**覆盖统计**：`OK` **70 条** ｜ `N/A` **23 条** ｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 94 条**，与 `需求条目表.md` 逐行对齐（2026-10-29 工程接入 +3）。",
        "**覆盖统计**：`OK` **71 条** ｜ `N/A` **23 条** ｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 95 条**，与 `需求条目表.md` 逐行对齐（2026-10-29 二期 `REQ-PATCH-001` 转正）。")
s = ins_before(P, s, "**覆盖统计**：`OK` **71 条**",
        "| `REQ-PATCH-001` | 增量写回（写回面板 / 补丁记录 / 回滚） | `UI-WORK-001` | OK | `EL-WORK-036`~`038`；**不新增路由**（挂在工作台） |")
s = ins_after_last(P, s, r"^\| \*\*v0\.1",
        "| **v0.1.19** | **2026-10-29** | **「工程接入（二期 · 增量写回）」**：① §4.4 新增 `EL-WORK-036`（写回面板，含说明与空态）/ `EL-WORK-037`（「写回工程」按钮）/ `EL-WORK-038`（补丁记录条目含「回滚」），并补 ② 交互规则 2 行；② §2 页面清单 `UI-WORK-001` 加 `REQ-PATCH-001`；③ §5 元素-数据需求表 **91 → 93 行**（+`EL-WORK-037`/`038`，落点 `#79` / `#77`+`#78`）；④ §9 追溯表 **94 → 95 行**（+`REQ-PATCH-001`，`OK` 70→**71**）；⑤ **元素总数 447 → 450**；**不新增路由、编号零重排**（回滚按钮并入 `EL-WORK-038`，不另立 id） | UI 角色（工程接入二期） |")
run(P, s)

# ==================== App-Spec ====================
P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.2.17** ｜", "> 版本：**v0.2.18** ｜")
s = rep(P, s, "`UI-Spec`（13 页 / **447** 个 `EL-*`", "`UI-Spec`（13 页 / **450** 个 `EL-*`")
s = rep(P, s, "`接口-Spec`（**78 接口** / 13 错误码", "`接口-Spec`（**82 接口** / 13 错误码")
s = rep(P, s, "`埋点-Spec`（**57 事件** / 9 节点漏斗", "`埋点-Spec`（**59 事件** / 9 节点漏斗")
s = rep(P, s, "`测试-Spec`（**618** 条用例，同批产出）", "`测试-Spec`（**628** 条用例，同批产出）")
s = rep(P, s, "`platform/requirements/需求条目表.md`（94 条 REQ）", "`platform/requirements/需求条目表.md`（95 条 REQ）")
s = rep(P, s, "| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-035` | 收到 SSE `ai.step`",
        "| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-037`/`EL-WORK-038` | 点「写回工程」/「回滚」 | `API-PLAT-079`（`#79`）／`API-PLAT-078`（`#78`）／`API-PLAT-077`（`#77`） | `PARAM-PROJ-ID` + `PARAM-TASK-ID` | `data.totals`/`notes[]`/`skipped[]` → **写回面板摘要**；`items[]` → 补丁记录 | 无成功生成任务 → 按钮**禁用**；写回失败 → 展示服务端 `message`，**工程未被改动**；已回滚记录不显示回滚按钮 |\n| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-035` | 收到 SSE `ai.step`")
s = rep(P, s, "按本表既有展开行口径实测**301 = 300 页面元素行（含应用外壳行）+ 1 页面进入控制行**", "按本表既有展开行口径实测**302 = 301 页面元素行（含应用外壳行）+ 1 页面进入控制行**")
s = rep(P, s, "§4.2当前**301行（300 页面元素行含外壳 + 1 页面进入控制行）**", "§4.2当前**302行（301 页面元素行含外壳 + 1 页面进入控制行）**")
s = rep(P, s, "§4.2 实际展开 **301（300 页面元素行含外壳 + 1 页面进入控制行）**", "§4.2 实际展开 **302（301 页面元素行含外壳 + 1 页面进入控制行）**")
s = rep(P, s, "App表实测**301（300 页面元素行含外壳 + 1 页面进入控制行）**", "App表实测**302（301 页面元素行含外壳 + 1 页面进入控制行）**")
s = rep(P, s, "> 完整 57 条事件字典见 `埋点-Spec §3`。本节**已补齐到全部 57 条**（2026-10-29 工程接入 +3）：",
        "> 完整 59 条事件字典见 `埋点-Spec §3`。本节**已补齐到全部 59 条**（2026-10-29：工程接入 +3、二期写回 +2）：")
s = ins_after_last(P, s, r"^\| `EVT_llm_model_switch` \|",
        "| `EVT_patch_writeback_done` | `RT-WORK-001` / `UI-WORK-001` | `EL-WORK-037` | `#79` 成功回调内（Toast 之后、面板刷新之前） | 写回成功 | `data.totals`（**不落路径文本**） |\n| `EVT_patch_writeback_failed` | `RT-WORK-001` / `UI-WORK-001` | `EL-WORK-037` | `#79` 失败分支回调内 | 写回失败（含冲突/禁碰拦截） | `error_code` |")
s = rep(P, s, "**覆盖统计**：`OK` **92 条** ｜ `N/A` **1 条**（`REQ-AUTH-007`，负向约束）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 94 条**，与 `需求条目表.md` **集合一致**（2026-10-29 工程接入 +3）。",
        "**覆盖统计**：`OK` **93 条** ｜ `N/A` **1 条**（`REQ-AUTH-007`，负向约束）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 95 条**，与 `需求条目表.md` **集合一致**（2026-10-29 二期 `REQ-PATCH-001` 转正）。")
s = rep(P, s, "## 11 需求追溯表", "## 11 需求追溯表")
s = ins_before(P, s, "**覆盖统计**：`OK` **93 条**",
        "| `REQ-PATCH-001` | 增量写回（应用 / 记录 / 回滚 / 生成产物合并写回） | `RT-WORK-001` | OK | 面板挂工作台；合并器 `brownfield.ts`；**不新增路由** |")
s = rep(P, s, "> **REQ 集合与 `需求条目表.md` 的 94 条 `REQ-ID` 一致**", "> **REQ 集合与 `需求条目表.md` 的 95 条 `REQ-ID` 一致**")
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.2",
        "| **v0.2.18** | **2026-10-29** | **「工程接入（二期 · 增量写回）」**：① §4.2.4 新增 1 行（`EL-WORK-037`/`038` ← `#79`/`#78`/`#77`，含失败处理与禁用态）；② §10.1 新增 2 行埋码点（`EVT_patch_writeback_done`/`_failed`），§10 埋码点 **57 → 59 行**；③ §11 追溯表 **94 → 95 行**（+`REQ-PATCH-001`，`OK` 92→**93**）；④ §4.2 展开行数 **301 → 302**（4 处 + 分解式）；⑤ §1 关联文档与上游主输入同步（450 / 82 / 59 / 628 / 95）。**未新增 `RT-*`、编号零重排** | App 角色（工程接入二期） |")
run(P, s)

# ==================== 埋点-Spec ====================
P = "platform/specs/埋点-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.1.11** ｜", "> 版本：**v0.1.12** ｜")
s = rep(P, s, "｜ 更新：2026-10-29（**工程接入（一期）`F17`/`F18`**：新增 3 条 `EVT_intake_*` 事件，事件总数 **54 → 57**，附节 C 同步）；",
        "｜ 更新：2026-10-29（**工程接入（二期 · 增量写回）**：新增 2 条 `EVT_patch_writeback_*` 事件，事件总数 **57 → 59**，附节 C 同步）；上一轮 2026-10-29（**工程接入（一期）`F17`/`F18`**：新增 3 条 `EVT_intake_*` 事件，事件总数 **54 → 57**，附节 C 同步）；")
s = rep(P, s, "| 事件总数 | **57 条**（2026-10-29 工程接入 +3：", "| 事件总数 | **59 条**（2026-10-29 二期写回 +2：`EVT_patch_writeback_done` / `EVT_patch_writeback_failed`；2026-10-29 工程接入 +3：")
s = rep(P, s, "**447 元素**", "**450 元素**", cnt=2)
s = rep(P, s, "`接口-Spec.md`（**78 接口** = 63 基线", "`接口-Spec.md`（**82 接口** = 63 基线")
s = ins_after_last(P, s, r"^\| `EVT_gen_task_canceled` \|",
        "| `EVT_patch_writeback_done` | 增量写回**成功** | `#79` 返回成功、Toast「已写回工程：新增 {n} 个、替换 {m} 个文件」**渲染之后**、面板刷新**之前** | `project_id:string(36)`、`patch_id:string(36)`、`create_count:int`、`replace_count:int`、`skipped_count:int`、`duration_ms:int` | 即时 flush | `dedup_key` = `patch_id`；同一 `patch_id` 只报 1 次 | `REQ-PATCH-001` | `UI-WORK-001` / `RT-WORK-001` | `EL-WORK-037` | `#79` 成功回调内（Toast 之后）；**不上报文件路径文本** |\n| `EVT_patch_writeback_failed` | 增量写回**失败** | `#79` 返回 400/409/超时/网络异常，且**错误提示渲染之后**（含**冲突整批拒绝**、**硬禁碰/越界拦截**、**XML 既有 id 丢失拦截**） | `project_id:string(36)`、`error_code:string`（`INVALID_ARGUMENT`/`VERSION_CONFLICT`/`UPSTREAM_TIMEOUT`/`UPSTREAM_UNAVAILABLE`/`INTERNAL`/`NETWORK_ERROR`）、`block_reason:enum{conflict,forbidden_path,id_removal,no_increment,other}\\|null` | 批量 | 同一 `Idempotency-Key` 只报 1 次 | `REQ-PATCH-001` | `UI-WORK-001` | `EL-WORK-037` | `#79` 失败分支回调内；**不上报文件路径文本** |")
s = rep(P, s, "## 附节 C 事件名总表（57 条，供一致性比对）", "## 附节 C 事件名总表（59 条，供一致性比对）")
s = rep(P, s, "| （骨架无） | **附节 C 事件名总表（57 条，供一致性比对）**", "| （骨架无） | **附节 C 事件名总表（59 条，供一致性比对）**")
s = ins_before_first(P, s, r"^\| `EVT_preview",
        "| `EVT_patch_writeback_done` | §3.7 | `REQ-PATCH-001` | 辅助（写回成功） |\n| `EVT_patch_writeback_failed` | §3.7 | `REQ-PATCH-001` | 旁路（写回失败） |")
s = rep(P, s, "> **逐行对齐 `需求条目表.md` 的 94 条 `REQ-ID`**", "> **逐行对齐 `需求条目表.md` 的 95 条 `REQ-ID`**")
s = rep(P, s, "**覆盖率小结（本表口径，机核）**：**94 行**已逐行对齐 = `OK` **69 条** + `N/A` **25 条** + `GAP` **0 条** + `Deferred` **0 条**；**无空白行**（2026-10-29 工程接入 +3）。",
        "**覆盖率小结（本表口径，机核）**：**95 行**已逐行对齐 = `OK` **70 条** + `N/A` **25 条** + `GAP` **0 条** + `Deferred` **0 条**；**无空白行**（2026-10-29 二期 `REQ-PATCH-001` 转正）。")
s = ins_before(P, s, "**覆盖率小结（本表口径，机核）**：**95 行**",
        "| `REQ-PATCH-001` | 增量写回（应用 / 记录 / 回滚） | `EVT_patch_writeback_done`、`EVT_patch_writeback_failed` | OK | 辅助 + 旁路；**不上报文件路径文本** |")
s = rep(P, s, "**计数核对**：上表 **57 条** = §3 各分节之和", "**计数核对**：上表 **59 条** = §3 各分节之和")
s = rep(P, s, "（**§3.1 = 6**、§3.2 = 8、§3.3 = 5", "（**§3.1 = 6**、§3.2 = 8、§3.3 = 5")
s = rep(P, s, "+ **辅助 35 条**（原 30 + 本机落地 2 + 工程接入 3）= 57。", "+ **辅助 37 条**（原 30 + 本机落地 2 + 工程接入 3 + 二期写回 2）= 59。")
s = rep(P, s, "（**§3.1 = 6**、§3.2 = 8、§3.3 = 5、§3.4 = 6、§3.5 = 5、§3.6 = 4、§3.7 = 8、", "（**§3.1 = 6**、§3.2 = 8、§3.3 = 5、§3.4 = 6、§3.5 = 5、§3.6 = 4、§3.7 = 10、")
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.1",
        "| **v0.1.12** | **2026-10-29** | **「工程接入（二期 · 增量写回）」**：① §3.7 新增 2 条事件 `EVT_patch_writeback_done`（写回成功，含 `create_count`/`replace_count`/`skipped_count`/`duration_ms`，**不上报路径文本**）/ `EVT_patch_writeback_failed`（写回失败，`error_code` + `block_reason`：`conflict`/`forbidden_path`/`id_removal`/`no_increment`/`other`）；② **事件总数 57 → 59**，附节 C 同步（2 行）；③ §9 追溯表 **94 → 95 行**（+`REQ-PATCH-001`，`OK` 69→**70**）；④ §1 关联文档 `UI-Spec` 元素 **447 → 450**、`接口-Spec` **78 → 82**。**未改任何既有 `EVT_*` 编号** | 埋点角色（工程接入二期） |")
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: B 批完成（元素 447→450、事件 57→59、App §4.2 301→302）")
