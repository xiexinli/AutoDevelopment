# -*- coding: utf-8 -*-
import io, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt:
        FAILED.append("%s :: count=%d(expect %d) :: %r" % (p, n, cnt, old[:70])); return s
    return s.replace(old, new, cnt)

P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
ROWS = """| `EL-PROJ-048` | 项目列表 · 「接入已有工程」入口 | 无（本地：打开弹窗） | — | —（本地交互，不取接口） | — | ✅ | —（2026-10-29 工程接入新增） |
| `EL-PROJ-051` | 接入弹窗 · 工程根目录输入 | 绝对路径字符串 | 字符串（**绝对路径**） | —（本地输入） | — | ✅ | —（2026-10-29 工程接入新增） |
| `EL-PROJ-052` | 接入弹窗 · 项目名输入 | string(50) | 字符串；空 → 取目录名 | —（本地输入） | — | ✅ | —（2026-10-29 工程接入新增） |
| `EL-PROJ-053` | 接入弹窗 · 只读授权勾选 | bool | 布尔；未勾选 → 提交前拦截 | —（本地状态） | — | ✅ | —（2026-10-29 工程接入新增） |
| `EL-PROJ-055` | 接入弹窗 · 「扫描并接入」 | 接入扫描结果摘要 | `project_name` / `counts{items,modules,dependencies}` / `warnings[]` | `API-PLAT-073`（`#73`） | `data.project_name`、`data.counts`、`data.warnings` | ✅ | —（2026-10-29 工程接入新增） |
| `EL-PROJ-057` | 项目卡片 · 「已接入工程」标签 | `source_kind ∈ {new,imported}` | 枚举；`new` → 不显示 | `API-PLAT-001`（`#1`）／`API-PLAT-003`（`#3`） | `data.source_kind` | ✅ | —（2026-10-29 工程接入新增） |
| `EL-KB-025` | 知识库 · 「工程约束」Tab | 约束分区（`sector=constraints`）文档列表 | 知识库文档 | `API-PLAT-007`（`#7`）／`API-PLAT-074`（`#74`） | `data.items[]`、`data.content_md` | ✅ | —（2026-10-29 工程接入新增） |"""
s = rep(P, s, "| `EL-GLOBAL-009` | 应用外壳顶栏 · 大模型选择器 | 可选模型清单 + 当前所选 + 生效模型 | 下拉列表：模型名 + 描述；**不可用项置灰并给原因**；目录为空时整块不渲染 | `API-PLAT-071`（`#71`）／`API-PLAT-071A`（`#71a`） | `data.items[]`、`data.selected_model`、`data.effective_model`、`data.default_model` | ✅ | —（2026-10-21 本机落地新增） |\n",
        "| `EL-GLOBAL-009` | 应用外壳顶栏 · 大模型选择器 | 可选模型清单 + 当前所选 + 生效模型 | 下拉列表：模型名 + 描述；**不可用项置灰并给原因**；目录为空时整块不渲染 | `API-PLAT-071`（`#71`）／`API-PLAT-071A`（`#71a`） | `data.items[]`、`data.selected_model`、`data.effective_model`、`data.default_model` | ✅ | —（2026-10-21 本机落地新增） |\n" + ROWS + "\n")
s = rep(P, s, "**统计**：本表 **84 行**（B9 新增两行）",
        "**统计**：本表 **91 行**（2026-10-29 工程接入 +7：`EL-PROJ-048`/`051`/`052`/`053`/`055`/`057`、`EL-KB-025`）（B9 新增两行）")
s = rep(P, s, "），与 `UI-Spec §5`（同为 **84 行**）**逐行一一对应**；",
        "），与 `UI-Spec §5`（同为 **91 行**）**逐行一一对应**；")
io.open(P, "w", encoding="utf-8").write(s)

P2 = "platform/specs/UI-Spec.md"; s2 = io.open(P2, encoding="utf-8").read()
s2 = rep(P2, s2, "> ⚠️ **2026-10-26**：新增元素 `EL-REVIEW-054`",
         "> ⚠️ **2026-10-29**：工程接入（`F17`/`F18`）新增 7 行（`EL-PROJ-048`/`051`/`052`/`053`/`055`/`057`、`EL-KB-025`），本表 **84 → 91 行**，与 `接口-Spec §3`（同 91 行）逐行对应。\n> ⚠️ **2026-10-26**：新增元素 `EL-REVIEW-054`")
io.open(P2, "w", encoding="utf-8").write(s2)

if FAILED:
    print("!! 未命中："); [print("  -", f) for f in FAILED]; sys.exit(2)
print("OK: §3 数据供给表补 7 行 + 统计同步")
