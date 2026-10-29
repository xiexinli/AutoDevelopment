# -*- coding: utf-8 -*-
"""第 5 轮回写：工程接入与约束（2026-10-29 · PM 授权）。
只追加「平台补充」块，不改动任何原文行。每个锚点必须唯一命中，否则报错退出。"""
import io, sys

P = "platform/平台需求概要.md"
src = io.open(P, encoding="utf-8").read()

PTR = "\n> **[平台补充 · 第 5 轮回写 · 2026-10-29 · PM 授权]** {}\n"

edits = [
    ("| **远期补充** | 已有项目改样式；跨端与「开发完一端自主生成另一端」 | [S 10-20 17:52] [S 10-20 09:58] |",
     PTR.format("「已有项目」自本轮起**提前进入本期**（至少「在既有工程上新增 / 修改」）。结论与依据见 **§13**。")),
    ("| **输出（工程）** | 可编译运行的原生**安卓**工程 | [S 10-20 18:35] |",
     PTR.format("工程输出**新增**一种形态：「**对既有工程的增量改动**（patch + 变更清单 + 一键回滚）」。见 **§13**。")),
    ("（由 §F1 与 `D-Q17` 推导），**已一并列入《假设确认清单》请 PM 确认**。",
     PTR.format("知识库分区自本轮起由 4 个扩为 **5 个**（新增 **`constraints` 工程约束**）。见 **§13-C**。")),
    ("- 需求：`REQ-BASE-001`",
     PTR.format("目标端**新增**「既有工程（brownfield）」形态，并**设为默认入口**。见 **§13**（F17/F18）。")),
    ("任务中断不产生半成品文件，`D-A16`）。",
     PTR.format("生成机制**新增** brownfield 模式（在既有工程上增量改写）；原文「不采用以预置工程为基座做结构化改写」**仍对 greenfield 模式有效**，两者并列。见 **§13-D**。")),
    ("- 需求：`REQ-DELIVER-001`",
     PTR.format("交付**新增**形态：「**写回本地工程 + 变更清单 + 一键回滚**」（二期）。见 **§13**。")),
    ("| `D-X3` | 已有项目改样式、在既有工程上作业 | §1.1（远期） |",
     "\n> **[平台补充 · 第 5 轮回写 · 2026-10-29 · PM 授权]** `D-X3` 自本轮起**移出「不在范围」**，改为**本期纳入**（见 **§13**）。不在范围内的其余 6 条（`D-X1`/`D-X2`/`D-X4`~`D-X7`）**保持不变**。\n"),
]

for anchor, add in edits:
    n = src.count(anchor)
    if n != 1:
        sys.stderr.write("ANCHOR NOT UNIQUE (%d): %s\n" % (n, anchor[:50]))
        sys.exit(1)
    src = src.replace(anchor, anchor + add, 1)

# 追加 §13（正文在文件末尾）
section = io.open(".tmp/round5_section.md", encoding="utf-8").read()
if not src.endswith("\n"):
    src += "\n"
src += "\n" + section

io.open(P, "w", encoding="utf-8").write(src)
print("OK: 7 anchors patched + §13 appended")
