# -*- coding: utf-8 -*-
"""二期文档同步 · A 批：接口契约 + 接口-Spec（78 → 82）。"""
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
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ==================== 接口契约 ====================
P = "platform/design/接口契约.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 共 **78** 个接口（编号 1~62 + `#44a` + 补口 `#63`~`#68`〔2026-10-21 由草案转基线〕+ `#69`/`#70` + `#71`/`#71a`/`#72`/`#72a`〔2026-10-21 本机落地〕+ **`#73`~`#75`〔2026-10-29 工程接入 · 一期〕**）。",
        "> 共 **82** 个接口（编号 1~62 + `#44a` + 补口 `#63`~`#68`〔2026-10-21 由草案转基线〕+ `#69`/`#70` + `#71`/`#71a`/`#72`/`#72a`〔2026-10-21 本机落地〕+ **`#73`~`#75`〔2026-10-29 工程接入 · 一期〕** + **`#76`~`#79`〔2026-10-29 工程接入 · 二期 · 增量写回〕**）。")
s = rep(P, s, "> **同步修订：C1-20261029** ｜",
        "> **同步修订：C5-20261029** ｜**工程接入（二期 · 增量写回）**：新增 `#76`/`#77`/`#78`（补丁集应用 / 记录 / 回滚）与 `#79`（生成产物按既有工程结构合并后写回），接口 **78 → 82**；依据 `reviews/C5-工程接入二期落地记录-20261029.md`。\n> **同步修订：C1-20261029** ｜")
NEW = """
### 1.15 增量写回（`F18` 二期 · **2026-10-29**）

> **来源**：`reviews/C5-工程接入二期落地记录-20261029.md`；口径 `D1=B` 二期 / `D3`（**自动写**，范围 = 登记工程根内）。
> **安全边界**（服务端强制）：只写登记工程根内 · 硬禁碰（`gradle/wrapper/**`/`gradlew*`/`local.properties`/签名文件/`.git/**`/`.gradle/**`/`.idea/**`）· **冲突不静默覆盖**（整批拒绝）· 写前快照 · 原子落盘 + 失败自动回滚 · 替换 `res/layout/*.xml` 时**既有 `@+id` 不得静默删除**（`L1` 引用完整性）。

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 76 | `POST` | `/projects/{project_id}/patch-applications` | **应用补丁集**（自动写）：body `{files:[{path,content,overwrite?,allow_id_removal?}], confirm:true, message?, overwrite_all?}`；须项目已接入；**提交类 → 幂等**。出参 `{patch_id, status, totals{create,replace,unchanged,bytes}, entries[{path,action,existed,bytes,removed_ids}], rollback{...}}`。越界/禁碰 → `INVALID_ARGUMENT`；冲突 → `VERSION_CONFLICT`（**整批拒绝、零写入**）；XML 丢 id → `INVALID_ARGUMENT` |
| 77 | `GET` | `/projects/{project_id}/patch-applications` | 补丁记录（倒序，最多 50）：`items[{patch_id,status(applied/rolled_back),message,created_at,rolled_back_at,totals,files[]}]` |
| 78 | `⬛ POST` | `/projects/{project_id}/patch-applications/{patch_id}/rollback` | **回滚**（服务端亦校验 `confirm:true`）：`replace` 从快照还原、`create` 删除文件；重复回滚 → `INVALID_ARGUMENT`；备份缺失 → `INTERNAL`。出参 `{patch_id,status,rolled_back_at,restored,removed}` |
| 79 | `POST` | `/projects/{project_id}/generation/{task_id}/writeback` | **生成产物写回**：取该次生成任务的产物 → 按既有工程结构**合并**（基座/构建文件不写回；Kotlin 包名与路径按工程 `namespace` 对齐；布局/`strings.xml`/`AndroidManifest.xml` **定点插入**既有 id/字符串/组件不重复）→ 应用为一次补丁；须 `confirm:true`；**幂等**。出参在 `#76` 基础上加 `notes[]` / `skipped[{path,reason}]`；无可写增量 → `INVALID_ARGUMENT` |

> **合并器**：`server/src/adapters/brownfield.ts`（`planBrownfieldMerge`）；**补丁引擎**：`server/src/adapters/patch.ts`。
> **manifest 落点**：`tbl_project_meta['patch_sets']`（**不新增实体**）。

"""
s = rep(P, s, "## 2 每个页面「要展示的数据 → 数据来源」对照（对应 E1）", NEW.lstrip("\n") + "## 2 每个页面「要展示的数据 → 数据来源」对照（对应 E1）")
s = rep(P, s, "**2026-10-29 工程接入再 +3 = 78**（`#73`~`#75`，见 §1.14） |",
        "**2026-10-29 工程接入再 +3 = 78**（`#73`~`#75`，见 §1.14）；**2026-10-29 二期（增量写回）再 +4 = 82**（`#76`~`#79`，见 §1.15） |")
run(P, s)

# ==================== 接口-Spec ====================
P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "> 版本：**v0.18** ｜", "> 版本：**v0.19** ｜")
s = rep(P, s, "；+ **`#73`~`#75` = 78 个**〔2026-10-29 工程接入，见 §5.4.15〕） |",
        "；+ **`#73`~`#75` = 78 个**〔2026-10-29 工程接入，见 §5.4.15〕；+ **`#76`~`#79` = 82 个**〔2026-10-29 二期 · 增量写回，见 §5.4.16〕） |")
s = rep(P, s, "| 底稿 | `platform/design/接口契约.md`（**78 个接口** = 基线 71 + 本机落地 4〔2026-10-21〕+ 工程接入 3〔2026-10-29〕+ SSE + 13 错误码）",
        "| 底稿 | `platform/design/接口契约.md`（**82 个接口** = 基线 71 + 本机落地 4〔2026-10-21〕+ 工程接入 3〔2026-10-29〕+ 二期写回 4〔2026-10-29〕+ SSE + 13 错误码）")
s = rep(P, s, "| 接口总数 | **78** = 基线 **63**（`#1`~`#62` + `#44a`）+ **补口 8**（`#63`~`#68`〔2026-10-21 由草案转基线〕+ `#69` 导出审核报告 / `#70` 中止流程）+ **本机落地 4**（`#71`/`#71a`/`#72`/`#72a`，2026-10-21）+ **工程接入 3**（`#73`~`#75`，2026-10-29） |",
        "| 接口总数 | **82** = 基线 **63**（`#1`~`#62` + `#44a`）+ **补口 8**（`#63`~`#68`〔2026-10-21 由草案转基线〕+ `#69` 导出审核报告 / `#70` 中止流程）+ **本机落地 4**（`#71`/`#71a`/`#72`/`#72a`，2026-10-21）+ **工程接入 3**（`#73`~`#75`，2026-10-29）+ **二期写回 4**（`#76`~`#79`，2026-10-29） |")
s = rep(P, s, "本机落地再增 4 个、工程接入再增 3 个（共 **78**）", "本机落地再增 4 个、工程接入再增 3 个、二期写回再增 4 个（共 **82**）")
s = rep(P, s, "`接口契约 §1` 表头已统一为 **78**（ = 基线 71 + 本机落地 4 + 工程接入 3）。",
        "`接口契约 §1` 表头已统一为 **82**（ = 基线 71 + 本机落地 4 + 工程接入 3 + 二期写回 4）。")
s = rep(P, s, "### 5.4 接口总表（**覆盖全部 78 个**：基线 63 + 补口 8 + 本机落地 4 + 工程接入 3）",
        "### 5.4 接口总表（**覆盖全部 82 个**：基线 63 + 补口 8 + 本机落地 4 + 工程接入 3 + 二期写回 4）")
s = rep(P, s, "### 5.5 关键接口完整契约（32 节，B9补展开既有 #20；对外API 78）",
        "### 5.5 关键接口完整契约（32 节，B9补展开既有 #20；对外API 82）")
s = rep(P, s, "> **其余 40 个接口**（`#4`、`#5`、", "> **其余 44 个接口**（`#4`、`#5`、")
s = rep(P, s, "`#73`、`#74`、`#75`）的契约以 **§5.4 总表 + `接口契约` 底稿**为准", "`#73`、`#74`、`#75`、`#76`、`#77`、`#78`、`#79`）的契约以 **§5.4 总表 + `接口契约` 底稿**为准")
s = rep(P, s, "反向见 §10 追溯表（94 行） |", "反向见 §10 追溯表（95 行） |")
s = rep(P, s, "| 2 | 每个 API 都有对应 REQ-ID | ✅ **78 个接口全部挂 REQ-ID**", "| 2 | 每个 API 都有对应 REQ-ID | ✅ **82 个接口全部挂 REQ-ID**")
s = rep(P, s, "`[{code, group, level, title}]`，`code ∈ A1~J2 族`（`group` 含新增 **`J`**）", "`[{code, group, level, title}]`，`code ∈ A1~J2 族`（`group` 含新增 **`J`**）")
# §5.4.16
NEW54 = """
#### 5.4.16 增量写回（组 1.15，**2026-10-29 · 二期**）

| # | 方法 | 路径 | `API-PLAT` 编号 | 说明 |
|---|---|---|---|---|
| 76 | `POST` | `/projects/{project_id}/patch-applications` | `API-PLAT-076` | **应用补丁集**（自动写）：`{files[], confirm:true, message?, overwrite_all?}`；须项目已接入；**幂等**；越界/禁碰 → 400；冲突 → 409（**整批拒绝、零写入**）；XML 丢 id → 400；出参 `{patch_id,status,totals,entries[],rollback{}}` |
| 77 | `GET` | `/projects/{project_id}/patch-applications` | `API-PLAT-077` | 补丁记录（倒序、最多 50）：`items[{patch_id,status,message,created_at,rolled_back_at,totals,files[]}]` |
| 78 | `⬛ POST` | `/projects/{project_id}/patch-applications/{patch_id}/rollback` | `API-PLAT-078` | **回滚**（`confirm:true`）：`replace` 还原、`create` 删除；重复回滚 → 400；出参 `{restored,removed}` |
| 79 | `POST` | `/projects/{project_id}/generation/{task_id}/writeback` | `API-PLAT-079` | **生成产物写回**：按既有工程结构**合并**后写回（基座不写回 / 包名对齐 / 三处定点插入）；出参加 `notes[]`/`skipped[]`；幂等 |

> 详见 `接口契约 §1.15` 与 `reviews/C5-工程接入二期落地记录-20261029.md`；合并器 `adapters/brownfield.ts`、补丁引擎 `adapters/patch.ts`；manifest 落 `tbl_project_meta['patch_sets']`（**不新增实体**）。
"""
lines = s.split("\n"); out = []; inserted = False
for i, ln in enumerate(lines):
    out.append(ln)
    if not inserted and ln.startswith("#### 5.4.15"):
        for j in range(i + 1, len(lines)):
            if re.match(r"^#{2,5} ", lines[j]):
                out.extend(lines[i + 1:j]); out.append(NEW54.rstrip("\n")); out.append(""); out.extend(lines[j:])
                inserted = True; break
        break
if not inserted: FAILED.append(P + " :: 5.4.15 anchor not found")
else: s = "\n".join(out)
# §10 追溯表 +1 行 + 统计
s = ins_before(P, s, "**覆盖统计**：`OK` **89 条** ｜ `N/A` **4 条**（`REQ-AUTH-007`、`REQ-PREVIEW-003`、`REQ-UIEDIT-006`、`REQ-UIEDIT-010`）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ **`GAP` 0 条** —— **合计 94 条**，与 `需求条目表.md` **集合一致**（2026-10-29 工程接入 +3）。",
        "| `REQ-PATCH-001` | 增量写回（应用 / 记录 / 回滚 / 生成产物合并写回） | `#76`、`#77`、`#78`、`#79` | OK | 越界/禁碰 400、冲突 409 零写入；manifest 落 `meta['patch_sets']` |")
s = rep(P, s, "**覆盖统计**：`OK` **89 条** ｜ `N/A` **4 条**（`REQ-AUTH-007`、`REQ-PREVIEW-003`、`REQ-UIEDIT-006`、`REQ-UIEDIT-010`）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ **`GAP` 0 条** —— **合计 94 条**，与 `需求条目表.md` **集合一致**（2026-10-29 工程接入 +3）。",
        "**覆盖统计**：`OK` **90 条** ｜ `N/A` **4 条**（`REQ-AUTH-007`、`REQ-PREVIEW-003`、`REQ-UIEDIT-006`、`REQ-UIEDIT-010`）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ **`GAP` 0 条** —— **合计 95 条**，与 `需求条目表.md` **集合一致**（2026-10-29 二期 `REQ-PATCH-001` 转正）。")
s = rep(P, s, "## 10 需求追溯表（94 行，REQ 集合与 `需求条目表.md` 一致；模块内行序按本 Spec 自定）",
        "## 10 需求追溯表（95 行，REQ 集合与 `需求条目表.md` 一致；模块内行序按本 Spec 自定）")
s = ins_after_last(P, s, r"^\| \*{0,2}v0\.", "| **v0.19** | **2026-10-29** | **「工程接入（二期 · 增量写回）」**：① **新增 §5.4.16**：`#76` 应用补丁集 / `#77` 补丁记录 / `#78` 回滚 / `#79` 生成产物合并写回，接口 **78 → 82**，`API-PLAT-076`~`079` 写入 §5.4.16；② §10 追溯表 **94 → 95 行**（+`REQ-PATCH-001` 转正）；③ §1 底稿 / §1 接口总数 / §5.3 覆盖边界 / §11 自检同步为 **82**。**未重排任何编号** | 接口角色（工程接入二期） |")
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: A 批完成（接口 78 → 82）")
