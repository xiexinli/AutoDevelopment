# -*- coding: utf-8 -*-
"""C1-20261029 下游文档同步：接口契约 / 数据模型 / 页面规格 / 接口-Spec / UI-Spec / 埋点-Spec / App-Spec。
增量：接口 75→78(#73~#75)；UI 元素 435→447(+12)；埋点事件 54→57(+3)；Project +2 字段；KbDoc.sector +constraints。
编号一律续编，不重排。"""
import io, re, sys

FAILED = []

def load(p): return io.open(p, encoding="utf-8").read()
def save(p, s): io.open(p, "w", encoding="utf-8").write(s)

def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt:
        FAILED.append("%s :: count=%d(expect %d) :: %r" % (p, n, cnt, old[:70])); return s
    return s.replace(old, new, cnt)

def ins_after_last(p, s, line_re, new_text):
    lines = s.split("\n"); idx = -1
    for i, ln in enumerate(lines):
        if re.match(line_re, ln): idx = i
    if idx < 0:
        FAILED.append("%s :: no line matches %r" % (p, line_re)); return s
    lines.insert(idx + 1, new_text); return "\n".join(lines)

def ins_after_first(p, s, line_re, new_text):
    lines = s.split("\n")
    for i, ln in enumerate(lines):
        if re.match(line_re, ln):
            lines.insert(i + 1, new_text); return "\n".join(lines)
    FAILED.append("%s :: no line matches %r" % (p, line_re)); return s

# ============================================================ 1) 接口契约
P = "platform/design/接口契约.md"; s = load(P)
s = rep(P, s, "| 1 | `GET` | `/projects` | 列表，支持 `q` / 分页 / 排序（§0.3） |",
        "| 1 | `GET` | `/projects` | 列表，支持 `q` / 分页 / 排序（§0.3）；每项含 **`source_kind`**（`new`/`imported`，工程接入 `F17`）〔2026-10-29〕 |")
s = rep(P, s, "| 3 | `GET` | `/projects/{project_id}` | 详情（含 `stage`、`current_revision_id`、`current_version_id`） |",
        "| 3 | `GET` | `/projects/{project_id}` | 详情（含 `stage`、`current_revision_id`、`current_version_id`，以及 **`source_kind`** / **`engineering_root`**〔2026-10-29 工程接入〕） |")
s = rep(P, s, "> 共 **75** 个接口（编号 1~62 + `#44a` + 补口 `#63`~`#68`〔2026-10-21 由草案转基线〕+ `#69`/`#70` + `#71`/`#71a`/`#72`/`#72a`〔2026-10-21 本机落地〕）。",
        "> 共 **78** 个接口（编号 1~62 + `#44a` + 补口 `#63`~`#68`〔2026-10-21 由草案转基线〕+ `#69`/`#70` + `#71`/`#71a`/`#72`/`#72a`〔2026-10-21 本机落地〕+ **`#73`~`#75`〔2026-10-29 工程接入 · 一期〕**）。")
s = rep(P, s, "> **同步修订：B9-20261026** ｜按本轮磁盘实现增量同步；",
        "> **同步修订：C1-20261029** ｜**工程接入（一期）**：新增 `#73`/`#74`/`#75`（`F17`/`F18`），接口 **75 → 78**；`#1` 列表补 `source_kind`、`#3` 详情补 `source_kind`/`engineering_root`〔来源：`接入已有Android工程-需求提案-v0.1.md` §12 + `reviews/C1-工程接入一期落地记录-20261029.md`〕。\n> **同步修订：B9-20261026** ｜按本轮磁盘实现增量同步；")
s = rep(P, s, "**2026-10-21 本机落地再 +4 = 75**（`#71`/`#71a`/`#72`/`#72a`，**开发阶段扩展、未过门禁**，见 §1.13） |",
        "**2026-10-21 本机落地再 +4 = 75**（`#71`/`#71a`/`#72`/`#72a`，**开发阶段扩展、未过门禁**，见 §1.13）；**2026-10-29 工程接入再 +3 = 78**（`#73`~`#75`，见 §1.14） |")
NEW = """
### 1.14 工程接入与约束（`F17` / `F18` · **2026-10-29 · 一期**）

> **来源**：`platform/平台需求概要.md` §13（第 5 轮回写）+ `接入已有Android工程-需求提案-v0.1.md` §12（七项决策）+ `reviews/C1-工程接入一期落地记录-20261029.md`。
> **一期口径（`D1=B`）**：**只读**接入，**不写任何工程文件**；二期才做增量写回（`D3`）。

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 73 | `POST` | `/projects/{project_id}/engineering-intake` | **接入已有工程**：body `{root: string(绝对路径), confirm: true}` → **只读**扫描本机工程根目录，提取 agent 配置 / 框架与依赖 / 架构与命名 / 构建命令，落「工程约束包」。`confirm≠true` → `INVALID_ARGUMENT`；非绝对路径 / 目录不存在 / 非 Android 工程 → `INVALID_ARGUMENT`。**提交类 → 幂等**（`D-A12`）。出参：`{source_kind:"imported", engineering_root, kb_doc_id, project_name, android{}, counts{}, warnings[]}` |
| 74 | `GET` | `/projects/{project_id}/constraints` | 读**工程约束包**：`{source_kind, engineering_root, pack{}, kb_doc_id, content_md, origin, version, updated_at, summary}`。未接入 → `NOT_FOUND` |
| 75 | `PUT` | `/projects/{project_id}/constraints` | 编辑约束正文 `{content_md}`；`origin → user_edited`；**须 `If-Match`**；不匹配 → `VERSION_CONFLICT`。未接入 → `NOT_FOUND` |

> **注入下游（`F18` / `D4=A`）**：约束摘要注入 `#16`（审核）/ `#28`（拆解）/ `#30`（Spec 生成）三处提示词；**冲突时以工程约束为准**，冲突项列入门禁 **J 组**（仅严格档运行）为待澄清，**不静默改工程**。
> **存储（`D7=A`）**：约束正文落 `tbl_kb_doc`（`sector='constraints'`，知识库第 5 分区）；结构化索引落 `tbl_project_meta['constraints']`；项目标记 `tbl_project.source_kind='imported'` + `engineering_root`。
> **同机前提（`D2=A`）**：平台后端须与被接入工程**同机**；上云需切「本地工程代理」（`D-R1` / `#46` 同族）。

"""
s = rep(P, s, "## 2 每个页面「要展示的数据 → 数据来源」对照（对应 E1）", NEW.lstrip("\n") + "## 2 每个页面「要展示的数据 → 数据来源」对照（对应 E1）")
save(P, s)

# ============================================================ 2) 数据模型
P = "platform/design/数据模型.md"; s = load(P)
s = rep(P, s, "| `review_extended` | bool | Y | 严格档的**「超严扩展」开关**；仅 `strict` 有意义，默认 `false`〔2026-10-28 定稿〕 | `PRD审核分级-定稿-v1.0` |",
        "| `review_extended` | bool | Y | 严格档的**「超严扩展」开关**；仅 `strict` 有意义，默认 `false`〔2026-10-28 定稿〕 | `PRD审核分级-定稿-v1.0` |\n| `source_kind` | enum{`new`,`imported`} | Y | **项目来源**：`new`=从零新建（默认）/ `imported`=接入已有工程〔2026-10-29 `F17`〕 | `§F17` |\n| `engineering_root` | string(path) | N | **接入的既有工程根目录**（本机绝对路径）；`source_kind=imported` 时非空〔2026-10-29 `F17`〕 | `§F17` |")
s = rep(P, s, "| `sector` | enum{`prd`,`spec`,`glossary`,`domain`} | Y | `[prd §F1]` 列出的四类〔2026-10-22 按实现对齐：原 `doc_type`、枚举含 `domain_model`/`other`；实况列名 `sector`、取值 `domain`〕 |",
        "| `sector` | enum{`prd`,`spec`,`glossary`,`domain`,`constraints`} | Y | `[prd §F1]` 列出的四类 + **`constraints`（工程约束，2026-10-29 `F17`/`D7=A` 新增第 5 分区）**〔2026-10-22 按实现对齐：原 `doc_type`、枚举含 `domain_model`/`other`；实况列名 `sector`、取值 `domain`〕 |")
save(P, s)

# ============================================================ 3) 页面规格
P = "platform/design/页面规格.md"; s = load(P)
s = rep(P, s, "- 顶部：页面标题、搜索框（占位文案「搜索项目名」）、「新建项目」主按钮、用户菜单",
        "- 顶部：页面标题、搜索框（占位文案「搜索项目名」）、**「接入已有工程」次按钮**〔2026-10-29 `F17`〕、「新建项目」主按钮、用户菜单")
s = rep(P, s, "- 新建项目弹窗：`项目名`（必填）、`说明`（选填）、`确定` / `取消`",
        "- 新建项目弹窗：`项目名`（必填）、`说明`（选填）、`确定` / `取消`\n- **接入已有工程弹窗**〔2026-10-29 `F17`〕：`工程根目录`（必填，**绝对路径**）、`项目名`（默认取目录名）、**只读授权勾选**（必须显式勾选）、说明文案、`扫描并接入` / `取消`")
s = rep(P, s, "| 新建项目 | 成功 → 卡片出现在列表首位 + Toast「**项目已创建**」；失败 → **保留已填内容** + 字段级错误 |",
        "| 新建项目 | 成功 → 卡片出现在列表首位 + Toast「**项目已创建**」；失败 → **保留已填内容** + 字段级错误 |\n| 接入已有工程 | 先建项目、再登记路径并**只读扫描**（`#73`）；成功 → Toast「**已接入工程（{项目名}），提取约束 {n} 项**」+ 该项目出现在列表（标「**已接入工程**」）；失败（路径不存在／非 Android 工程／未授权）→ **保留已填内容** + 服务端 `message` 原文；扫描失败可重试，**不重复建项目** |")
save(P, s)

# ============================================================ 4) UI-Spec
P = "platform/specs/UI-Spec.md"; s = load(P)
s = rep(P, s, "> 版本：**v0.1.15** ｜", "> 版本：**v0.1.16** ｜")
s = rep(P, s, "｜ 更新：2026-10-26（**B9 审核补充与复审闭环**；新增 `EL-REVIEW-055`~`062`，元素总数 **435**；",
        "｜ 更新：2026-10-29（**工程接入（一期）`F17`/`F18`**：新增 `EL-PROJ-048`~`057`（接入入口 + 弹窗）+ `EL-KB-025`/`026`（工程约束分区），元素总数 **435 → 447**）；上一轮 2026-10-26（**B9 审核补充与复审闭环**；新增 `EL-REVIEW-055`~`062`，元素总数 **435**；")
s = rep(P, s, "| `UI-PROJ-001` | 项目列表 / 新建 | `PROJ` | `REQ-PROJ-001`~`004`、`REQ-PROJ-002`、`REQ-KB-002` | P0 |",
        "| `UI-PROJ-001` | 项目列表 / 新建 / **接入已有工程** | `PROJ` | `REQ-PROJ-001`~`004`、`REQ-PROJ-002`、`REQ-KB-002`、**`REQ-INTAKE-001`** | P0 |")
s = rep(P, s, "| `UI-KB-001` | 知识库页 | `KB` | `REQ-KB-001`、`REQ-KB-002` | P1 | 四分区 Tab + revision 历史；页首常驻「只含本项目内容」 |",
        "| `UI-KB-001` | 知识库页 | `KB` | `REQ-KB-001`、`REQ-KB-002`、**`REQ-INTAKE-002`** | P1 | **五分区 Tab**（+ **工程约束**）+ revision 历史；页首常驻「只含本项目内容」 |")
PROJ_ROWS = """| `EL-PROJ-048` | 「接入已有工程」按钮 | 次按钮 | `EL-PROJ-001` | 是 |
| `EL-PROJ-049` | 接入已有工程弹窗 | 弹窗 | — | 是 |
| `EL-PROJ-050` | 弹窗标题「接入已有工程」 | 文本 | `EL-PROJ-049` | 否 |
| `EL-PROJ-051` | 「工程根目录」输入框（绝对路径） | 输入框（必填） | `EL-PROJ-049` | 是 |
| `EL-PROJ-052` | 「项目名」输入框 | 输入框（选填，默认目录名） | `EL-PROJ-049` | 是 |
| `EL-PROJ-053` | 「只读授权」勾选框 | 复选框（必勾） | `EL-PROJ-049` | 是 |
| `EL-PROJ-054` | 弹窗底部说明文案（提取范围） | 文本 | `EL-PROJ-049` | 否 |
| `EL-PROJ-055` | 「扫描并接入」按钮 | 主按钮 | `EL-PROJ-049` | 是 |
| `EL-PROJ-056` | 「取消」按钮（接入弹窗） | 次按钮 | `EL-PROJ-049` | 是 |
| `EL-PROJ-057` | 卡片 · 「已接入工程」标签 | 标签 | `EL-PROJ-010` | 否 |"""
s = rep(P, s, "| `EL-PROJ-047` | 「取消」按钮 | 次按钮 | `EL-PROJ-043` | 是 |\n",
        "| `EL-PROJ-047` | 「取消」按钮 | 次按钮 | `EL-PROJ-043` | 是 |\n" + PROJ_ROWS + "\n")
s = rep(P, s, "| `EL-PROJ-006` | 点击 | 展开用户菜单（昵称 / 头像 / 退出登录） | — | 是 | 昵称缺失 → 显示 `未命名用户`（`[缺口-UI-Q4 相关]`，见 §10） |\n",
        "| `EL-PROJ-006` | 点击 | 展开用户菜单（昵称 / 头像 / 退出登录） | — | 是 | 昵称缺失 → 显示 `未命名用户`（`[缺口-UI-Q4 相关]`，见 §10） |\n"
        "| `EL-PROJ-048` | 点击 | 打开 `EL-PROJ-049` 接入弹窗，焦点落 `EL-PROJ-051` | — | 是 | 已建项目（`intakePid`）时重开复用同一项目，**不重复建** |\n"
        "| `EL-PROJ-055` | 点击 | 校验：根目录非空 + 已勾选授权 → 无则 `EL-PROJ-054` 处提示；通过 → 建项目（首次）→ `#73` 只读扫描；成功 → 关闭弹窗 + Toast「已接入工程（{项目名}），提取约束 {n} 项」+ 刷新列表 | 留在本页 | 是 | `#73` 返回 400 → 展示服务端 `message`，**保留已填内容**；扫描中按钮 loading；`Esc` 同 `EL-PROJ-056` |\n")
s = rep(P, s, "| `EL-PROJ-030` | `重试` | — |",
        "| `EL-PROJ-030` | `重试` | — |\n| `EL-PROJ-048` | `接入已有工程` | 次按钮 |\n| `EL-PROJ-050` | `接入已有工程` | 弹窗标题 |\n| `EL-PROJ-051` | `/Users/you/StudioProjects/MyApp` | 占位（绝对路径示例） |\n| `EL-PROJ-052` | `默认取目录名` | 占位 |\n| `EL-PROJ-053` | `我确认授权平台只读扫描这个目录，提取 agent 配置与框架约束（一期不写任何工程文件）` | 复选框文案（**`只读` 三字加粗**） |\n| `EL-PROJ-055` | `扫描并接入` | 主按钮 |\n| `EL-PROJ-057` | `已接入工程` | 卡片标签（`source_kind=imported`） |")
KB_ROWS = """| `EL-KB-025` | Tab · 工程约束 | 标签项 | `EL-KB-004` | 是 |
| `EL-KB-026` | 工程约束分区空态文案 | 文本 | — | 否 |"""
s = rep(P, s, "| `EL-KB-024` | 403 区块 + 「返回」 | 空态 | — | 是 |\n",
        "| `EL-KB-024` | 403 区块 + 「返回」 | 空态 | — | 是 |\n" + KB_ROWS + "\n")
s = rep(P, s, "| `EL-KB-005`~`008` | 点击 | 切换分区；**无动效**直接切换 | — | 是 | 切换保留各自 `EL-KB-009` 关键词 |\n",
        "| `EL-KB-005`~`008`、`EL-KB-025` | 点击 | 切换分区；**无动效**直接切换 | — | 是 | 切换保留各自 `EL-KB-009` 关键词 |\n")
s = rep(P, s, "| `EL-KB-019` | `保存` | — |",
        "| `EL-KB-019` | `保存` | — |\n| `EL-KB-025` | `工程约束` | 第 5 分区 Tab（`sector=constraints`） |\n| `EL-KB-026` | `这个项目还没有接入工程约束。回到项目列表点「接入已有工程」即可。` | 工程约束分区空态 |")
S5_ROWS = """| `EL-PROJ-048` | `UI-PROJ-001` | 「接入已有工程」入口 | 无（本地：打开弹窗） | 是 | — | —（本地交互，不取接口） |
| `EL-PROJ-051` | `UI-PROJ-001` | 工程根目录输入 | 绝对路径字符串 | 是 | 空 → `EL-PROJ-054` 处字段提示 | —（本地输入） |
| `EL-PROJ-052` | `UI-PROJ-001` | 接入后的项目名 | string(50) | 否 | 空 → 取目录名；仍空 → `接入的工程` | —（本地输入） |
| `EL-PROJ-053` | `UI-PROJ-001` | 只读授权勾选态 | bool | 是 | 未勾选 → 提交前拦截 | —（本地状态） |
| `EL-PROJ-055` | `UI-PROJ-001` | 接入扫描结果摘要 | `project_name` / `counts{items,modules,dependencies}` / `warnings[]` | 是 | 失败 → 服务端 `message` | `#73 POST /projects/{id}/engineering-intake` |
| `EL-PROJ-057` | `UI-PROJ-001` | 「已接入工程」标签 | `source_kind ∈ {new,imported}` | 否 | `new` → 不显示 | `#1 GET /projects` → `source_kind`；`#3` |
| `EL-KB-025` | `UI-KB-001` | 工程约束分区（列表） | 知识库文档（`sector=constraints`） | 是 | 空 → `EL-KB-026` | `#7 GET /projects/{id}/kb-docs?sector=constraints`；`#74 GET /projects/{id}/constraints` |"""
s = rep(P, s, "| `EL-VER-028` | `UI-VER-001` | 未验证构建标记 | `l2_result.reported` | 否 | 不显示 | `#46` / `#44` |",
        "| `EL-VER-028` | `UI-VER-001` | 未验证构建标记 | `l2_result.reported` | 否 | 不显示 | `#46` / `#44` |\n" + S5_ROWS)
s = rep(P, s, "**统计**：本表共 **84 行**（B9 +2：当前正文与闭环状态两组）",
        "**统计**：本表共 **91 行**（2026-10-29 工程接入 +7：`EL-PROJ-048`/`051`/`052`/`053`/`055`/`057`、`EL-KB-025`）（B9 +2：当前正文与闭环状态两组）")
s = ins_after_last(P, s, r"^\| \*\*v0\.1", "| **v0.1.16** | **2026-10-29** | **工程接入（一期）`F17`/`F18`**：① §4.2 新增 `EL-PROJ-048`~`057`（「接入已有工程」次按钮 + 接入弹窗：根目录/项目名/只读授权勾选/说明/确定/取消 + 卡片「已接入工程」标签），补 ② 交互规则 2 行、④ 文案 7 行；② §4.3 新增 `EL-KB-025`「工程约束」Tab + `EL-KB-026` 该分区空态；③ §2 页面清单 `UI-PROJ-001` 加 `REQ-INTAKE-001`、`UI-KB-001` 加 `REQ-INTAKE-002` 并改「五分区」；④ §5 元素-数据需求表 **84 → 91 行**（+7，逐行给 `#73`/`#74`/`#1`/`#3` 落点，**无 `❌`**）；⑤ **元素总数 435 → 447**（+12）；**编号一律续编、零重排**。来源：`平台需求概要 §13` / `接入已有Android工程-需求提案-v0.1.md §12` / `reviews/C1-工程接入一期落地记录-20261029.md` | UI 角色（工程接入一期） |")
save(P, s)

# ============================================================ 5) 埋点-Spec
P = "platform/specs/埋点-Spec.md"; s = load(P)
s = rep(P, s, "> 版本：**v0.1.9** ｜", "> 版本：**v0.1.10** ｜")
s = rep(P, s, "｜ 更新：2026-10-26（**B9：", "｜ 更新：2026-10-29（**工程接入（一期）`F17`/`F18`**：新增 3 条 `EVT_intake_*` 事件，事件总数 **54 → 57**，附节 C 同步）；上一轮 2026-10-26（**B9：")
s = rep(P, s, "| 事件总数 | **54 条**（其中", "| 事件总数 | **57 条**（2026-10-29 工程接入 +3：`EVT_intake_click` / `EVT_intake_done` / `EVT_intake_failed`；此前 **54 条** = 其中")
s = rep(P, s, "**435 元素**", "**447 元素**", cnt=2)
s = rep(P, s, "`接口-Spec.md`（**75 接口** = 63 基线", "`接口-Spec.md`（**78 接口** = 63 基线 + 8 补口 + 本机落地 `#71`/`#71a`/`#72`/`#72a` + **工程接入 `#73`~`#75`**；原 **75** = 63 基线")
s = rep(P, s, "| （骨架无） | **附节 C 事件名总表（54 条，供一致性比对）**", "| （骨架无） | **附节 C 事件名总表（57 条，供一致性比对）**")
s = rep(P, s, "## 附节 C 事件名总表（54 条，供一致性比对）", "## 附节 C 事件名总表（57 条，供一致性比对）")
INTAKE_ROWS = """| `EVT_intake_click` | 点击「接入已有工程」入口 | `EL-PROJ-048` 的 `onClick` 内、`EL-PROJ-049` 弹窗打开**之前**（**不发请求**） | `entry:enum{header}` | 批量 | 同一 `element_id` **300ms** 内连点只报 1 次 | `REQ-INTAKE-001` | `UI-PROJ-001` / `RT-PROJ-001` | `EL-PROJ-048` | `EL-PROJ-048` 的 `onClick`（弹窗打开前） |
| `EVT_intake_done` | 接入已有工程**成功** | `#73` 返回成功、约束包落库、Toast「已接入工程（{项目名}），提取约束 {n} 项」**渲染之后** | `project_id:string(36)`、`project_name_chars:int`（**只报长度，不上报工程名文本**）、`counts_items:int`、`counts_modules:int`、`counts_dependencies:int`、`warnings_count:int`、`duration_ms:int` | 即时 flush | `dedup_key` = `Idempotency-Key`；同一 `project_id` 只报 1 次 | `REQ-INTAKE-001`、`REQ-INTAKE-002` | `RT-PROJ-001` | `EL-PROJ-055`、`EL-PROJ-049` | `#73` 成功回调内（Toast 之后、列表刷新之前）；**工程根路径文本不上报** |
| `EVT_intake_failed` | 接入已有工程**失败** | `#73` 返回 400/404/409/超时/网络异常，且弹窗内错误提示**渲染之后**（**含「未勾选授权」「路径非法」「非 Android 工程」三类前端与服务端拦截**） | `error_code:string`（`INVALID_ARGUMENT`/`NOT_FOUND`/`VERSION_CONFLICT`/`UPSTREAM_TIMEOUT`/`UPSTREAM_UNAVAILABLE`/`NETWORK_ERROR`）、`block_reason:enum{no_root,no_consent,not_android,other}|null` | 批量 | 同一 `Idempotency-Key` 只报 1 次 | `REQ-INTAKE-001` | `RT-PROJ-001` | `EL-PROJ-055`、`EL-PROJ-051`、`EL-PROJ-053` | `#73` 失败分支回调内；**不得上报用户填写的路径 / 项目名文本** |"""
s = rep(P, s, "| `EVT_proj_deleted` | 项目删除 | 二次确认 `EL-PROJ-046` 后 `#5` 返回成功、卡片已移除、Toast「项目已删除，30 天后彻底清除」**渲染之后** | `project_id:string(36)`、`deleted_at:datetime`（UTC） | 即时 flush | 同一 `project_id` 只报 1 次 | `REQ-PROJ-004`、`REQ-AUTH-008` | `RT-PROJ-001` | `EL-PROJ-046`、`EL-PROJ-018` | `#5` 成功回调内（列表移除之后） |\n",
        "| `EVT_proj_deleted` | 项目删除 | 二次确认 `EL-PROJ-046` 后 `#5` 返回成功、卡片已移除、Toast「项目已删除，30 天后彻底清除」**渲染之后** | `project_id:string(36)`、`deleted_at:datetime`（UTC） | 即时 flush | 同一 `project_id` 只报 1 次 | `REQ-PROJ-004`、`REQ-AUTH-008` | `RT-PROJ-001` | `EL-PROJ-046`、`EL-PROJ-018` | `#5` 成功回调内（列表移除之后） |\n" + INTAKE_ROWS + "\n")
s = ins_after_last(P, s, r"^\| 坏?`EVT_intake_failed`", "")  # no-op guard
s = rep(P, s, "| `EVT_intake_failed` |", "| `EVT_intake_failed` |")  # keep
s = ins_after_last(P, s, r"^\| `EVT_gen_", "| `EVT_intake_click` | §3.2 | `REQ-INTAKE-001` | 辅助（点击） |\n| `EVT_intake_done` | §3.2 | `REQ-INTAKE-001`、`REQ-INTAKE-002` | 辅助（接入成功） |\n| `EVT_intake_failed` | §3.2 | `REQ-INTAKE-001` | 旁路（接入失败） |")
s = ins_after_last(P, s, r"^\| v0\.1", "| **v0.1.10** | **2026-10-29** | **「工程接入（一期）`F17`/`F18`」**：① §3.2 新增 3 条事件 `EVT_intake_click`（点击接入入口）/ `EVT_intake_done`（接入成功，含 `counts_*` 与 `duration_ms`，**只报工程名长度、不上报工程名与路径文本**）/ `EVT_intake_failed`（接入失败，`error_code` + `block_reason`）；② **事件总数 54 → 57**，附节 C 事件名总表同步（3 行）；③ §1 关联文档 `UI-Spec` 元素 **435 → 447**、`接口-Spec` 接口 **75 → 78**；④ **既有 `EVT_*` / `G-0xx` 编号一律未改，只增不改**。依据：`平台需求概要 §13` / `接入已有Android工程-需求提案-v0.1.md §12` / `reviews/C1-工程接入一期落地记录-20261029.md` | 埋点角色（工程接入一期） |")
save(P, s)

# ============================================================ 6) 接口-Spec
P = "platform/specs/接口-Spec.md"; s = load(P)
s = rep(P, s, "| **`#n`**（基线 `#1`~`#62` + `#44a` + `#63`~`#70` = **71 个**；+ `#71`/`#71a`/`#72`/`#72a` = **75 个**〔2026-10-21 本机落地，见 §5.4.13〕） |",
        "| **`#n`**（基线 `#1`~`#62` + `#44a` + `#63`~`#70` = **71 个**；+ `#71`/`#71a`/`#72`/`#72a` = **75 个**〔2026-10-21 本机落地，见 §5.4.13〕；+ **`#73`~`#75` = 78 个**〔2026-10-29 工程接入，见 §5.4.15〕） |")
s = rep(P, s, "本 Spec 采「**§5.4 接口总表（覆盖全部 75 个）+ §5.5 关键接口完整契约（31 节）**」的写法",
        "本 Spec 采「**§5.4 接口总表（覆盖全部 78 个）+ §5.5 关键接口完整契约（31 节）**」的写法")
s = rep(P, s, "+ **本机落地 4 个**（`#71`/`#71a`/`#72`/`#72a`，2026-10-21，见 §5.4.13）= **75 个**。",
        "+ **本机落地 4 个**（`#71`/`#71a`/`#72`/`#72a`，2026-10-21，见 §5.4.13）+ **工程接入 3 个**（`#73`/`#74`/`#75`，2026-10-29，见 §5.4.15）= **78 个**。")
s = rep(P, s, "**2026-10-21 本机落地再 +4 = 75**（`#71`/`#71a`/`#72`/`#72a`，见 §5.4.13） |",
        "**2026-10-21 本机落地再 +4 = 75**（`#71`/`#71a`/`#72`/`#72a`，见 §5.4.13）；**2026-10-29 工程接入再 +3 = 78**（`#73`~`#75`，见 §5.4.15） |")
NEW54 = """
#### 5.4.15 工程接入（组 1.14，**2026-10-29 · 一期**）

| # | 方法 | 路径 | `API-PLAT` 编号 | 说明 |
|---|---|---|---|---|
| 73 | `POST` | `/projects/{project_id}/engineering-intake` | `API-PLAT-073` | 接入已有工程：body `{root, confirm:true}` → 只读扫描本机工程根目录，落「工程约束包」；`confirm≠true` / 非绝对路径 / 非 Android 工程 → 400；**幂等**。出参 `{source_kind:'imported', engineering_root, kb_doc_id, project_name, android{}, counts{}, warnings[]}` |
| 74 | `GET` | `/projects/{project_id}/constraints` | `API-PLAT-074` | 读工程约束包（结构化 + 正文 + `summary` + `version`）；未接入 → 404 |
| 75 | `PUT` | `/projects/{project_id}/constraints` | `API-PLAT-075` | 编辑约束正文；**须 `If-Match`**，冲突 409；未接入 → 404 |

> **注入下游**：约束摘要注入 `#16` / `#28` / `#30` 三处提示词，**冲突以工程约束为准**（`D4=A`）；门禁新增 **J 组**（仅严格档）。**存储**：`tbl_kb_doc.sector='constraints'` + `tbl_project_meta['constraints']`。详见 `接口契约 §1.14`、`reviews/C1-工程接入一期落地记录-20261029.md`。
"""
lines = s.split("\n"); out = []; inserted = False
for i, ln in enumerate(lines):
    out.append(ln)
    if not inserted and ln.startswith("#### 5.4.14"):
        # 跳过 5.4.14 段落，插到下一个 ##### / ## 标题前
        for j in range(i + 1, len(lines)):
            if re.match(r"^#{2,5} ", lines[j]):
                out.extend(lines[i + 1:j]); out.append(NEW54.rstrip("\n")); out.append(""); out.extend(lines[j:])
                inserted = True; break
        break
if not inserted:
    FAILED.append(P + " :: 5.4.14 anchor not found")
else:
    s = "\n".join(out)
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.", "| **v0.13** | **2026-10-29** | **「工程接入（一期）`F17`/`F18`」**：① **新增 §5.4.15**：`#73` `POST /projects/{id}/engineering-intake`（只读接入扫描，幂等）、`#74` `GET /projects/{id}/constraints`、`#75` `PUT /projects/{id}/constraints`（`If-Match`），接口 **75 → 78**，`API-PLAT-073/074/075` 编号映射写入 §5.4.15；② **`#1` 列表项补 `source_kind`**、**`#3` 详情补 `source_kind`/`engineering_root`**；③ §3 数据供给表新增 7 行（`EL-PROJ-048`/`051`/`052`/`053`/`055`/`057`、`EL-KB-025`），与 `UI-Spec §5`（**91 行**）逐行对应；④ §1 文档信息 / §5.3 覆盖边界 / §10 计数口径同步为 **78**；⑤ **未重排任何既有编号**。来源：`平台需求概要 §13` / `接入已有Android工程-需求提案-v0.1.md §12` / `reviews/C1-工程接入一期落地记录-20261029.md` | 接口角色（工程接入一期） |")
save(P, s)

# ============================================================ 7) App-Spec
P = "platform/specs/App-Spec.md"; s = load(P)
s = rep(P, s, "`UI-Spec`（13 页 / **435** 个 `EL-*`", "`UI-Spec`（13 页 / **447** 个 `EL-*`")
s = rep(P, s, "`接口-Spec`（**75 接口** / 13 错误码", "`接口-Spec`（**78 接口** / 13 错误码")
s = rep(P, s, "`埋点-Spec`（**54 事件** / 9 节点漏斗", "`埋点-Spec`（**57 事件** / 9 节点漏斗")
save(P, s)

if FAILED:
    print("!! 有 %d 处未命中：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: 7 份文档全部同步完成")
