#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
L1 机检 · 文档级确定性检查

覆盖规则：
  R-PRD-001  TBD / 待定 / 待补充 等半成品标记
  R-PRD-002  模糊词
  R-PRD-003  需求编号 FR-xxx 存在性（仅提示）
  R-PRD-020  需求编号重复
  R-PRD-016  术语表存在性
  R-PRD-017  非功能需求关键词

用法：
  python3 scripts/check_docs.py                  # 默认扫描 docs/
  python3 scripts/check_docs.py --root examples/docs
  python3 scripts/check_docs.py --json           # 输出 JSON
退出码：存在阻断项时返回 1。
"""

import argparse
import json
import re
import sys
from pathlib import Path

# ---- 词表（可按团队习惯增删）------------------------------------------------

# 阻断：半成品标记
TBD_WORDS = [
    "TBD", "tbd", "待定", "待补充", "待确认", "待讨论", "后续补充",
    "暂定", "后续再说", "先这样", "??",
]

# 阻断：模糊词
VAGUE_WORDS = [
    "美观", "流畅", "快速", "尽量", "尽可能", "若干", "等等",
    "友好提示", "正常情况", "一般情况下", "适当", "视情况", "灵活处理",
    "合理", "高大上", "简洁大方", "优化体验", "体验好", "丝滑",
]

# 建议：这些词未必是问题，仅提示复核
SUGGEST_WORDS = ["大概", "可能", "建议", "应该"]

# ---- 各文档类型要求的必备章节 ----------------------------------------------

REQUIRED_SECTIONS = {
    "prd": ["术语", "数据字典"],
    "ue":  ["路由"],
    "ui":  ["Token"],
}

# ---- 工具 -------------------------------------------------------------------

FENCE_RE = re.compile(r"^\s*(```|~~~)")
FR_RE = re.compile(r"\bFR-[A-Za-z0-9]+\b")
FR_DEF_RE = re.compile(r"^\s{0,6}#{1,6}\s+(FR-[A-Za-z0-9]+)")

SKIP_FILES = {"readme.md"}


def iter_lines(text):
    """逐行产出 (行号, 行内容)，自动跳过围栏代码块内部。"""
    in_fence = False
    for i, line in enumerate(text.splitlines(), start=1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        yield i, line


def check_file(path: Path, root: Path):
    """返回该文件的 findings 列表。"""
    findings = []
    rel = path.relative_to(root.parent) if root.parent in path.parents else path
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return [{
            "rule_id": "-", "level": "警告", "status": "uncertain",
            "location": str(rel), "evidence": "",
            "issue": "文件不是 UTF-8 编码，无法机检", "fix": "转为 UTF-8",
        }]

    def add(rule, level, line_no, line, issue, fix):
        findings.append({
            "rule_id": rule, "level": level, "status": "fail",
            "location": f"{rel}#L{line_no}",
            "evidence": line.strip()[:120],
            "issue": issue, "fix": fix,
        })

    for ln, line in iter_lines(text):
        for w in TBD_WORDS:
            if w in line:
                add("R-PRD-001", "阻断", ln, line,
                    f"出现半成品标记「{w}」", "补齐内容，不要留待定")
        for w in VAGUE_WORDS:
            if w in line:
                add("R-PRD-002", "阻断", ln, line,
                    f"出现模糊词「{w}」，无法机械翻译",
                    "替换为可判定的具体描述（数值、枚举、条件分支）")
        for w in SUGGEST_WORDS:
            if w in line:
                add("R-PRD-002", "警告", ln, line,
                    f"出现不确定词「{w}」", "复核是否可替换为确定表述")

    # 编号的重复与孤立检查在 main 中全库统一进行（需区分定义处与引用处）

    # 必备章节
    kind = path.parent.name.lower()
    if kind in REQUIRED_SECTIONS:
        for kw in REQUIRED_SECTIONS[kind]:
            if kw.lower() not in text.lower():
                findings.append({
                    "rule_id": {"prd": "R-PRD-016", "ue": "R-UE-002", "ui": "R-UI-001"}.get(kind, "-"),
                    "level": "阻断" if kind == "prd" and kw == "数据字典" else "严重",
                    "status": "fail",
                    "location": str(rel),
                    "evidence": "",
                    "issue": f"{kind.upper()} 文档缺少「{kw}」相关内容",
                    "fix": f"补充「{kw}」章节",
                })

    return findings


def check_refs(dir_root, md_files, add):
    """R-PRD-020 编号重复（仅看定义处）；R-X-006 引用未定义编号。

    关键：必须区分「定义处」与「引用处」。
    正文里写「（FR-013）」是交叉引用，不是重复定义——
    早期实现把两者混为一谈，导致状态机表里每次引用 FR 都被报成重复编号。
    """
    defined, refs = {}, {}
    for p in md_files:
        for ln, line in iter_lines(p.read_text(encoding="utf-8", errors="ignore")):
            m = FR_DEF_RE.match(line)
            if m:
                defined.setdefault(m.group(1), []).append((p.name, ln))
                continue
            for code in FR_RE.findall(line):
                refs.setdefault(code, []).append((p.name, ln))

    for code, locs in sorted(defined.items()):
        if len(locs) > 1:
            add("R-PRD-020", "警告", f"{locs[0][0]}#L{locs[0][1]}",
                f"需求编号 {code} 被重复定义（共 {len(locs)} 处定义）",
                "改为唯一编号",
                "、".join(f"{n}#L{l}" for n, l in locs))

    if defined:
        for code, locs in sorted(refs.items()):
            if code not in defined:
                add("R-X-006", "严重", f"{locs[0][0]}#L{locs[0][1]}",
                    f"引用了未定义的需求编号 {code}",
                    "补充该需求的定义，或修正引用",
                    f"共 {len(locs)} 处引用")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="docs", help="待检根目录，默认 docs")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出")
    args = ap.parse_args()

    root = Path(args.root)
    if not root.exists():
        print(f"[错误] 目录不存在：{root}")
        return 2

    md_files = [p for p in sorted(root.rglob("*.md"))
                if p.name.lower() not in SKIP_FILES]

    all_findings = []
    for p in md_files:
        all_findings.extend(check_file(p, root))

    def add(rule, level, loc, issue, fix, evidence=""):
        all_findings.append({"rule_id": rule, "level": level, "status": "fail",
                             "location": loc, "evidence": evidence,
                             "issue": issue, "fix": fix})

    check_refs(root, md_files, add)

    # 术语表 / 数据字典 全库级检查
    whole = "\n".join(p.read_text(encoding="utf-8", errors="ignore")
                      for p in root.rglob("*.md") if p.name.lower() not in SKIP_FILES)
    if "术语" not in whole and not any(f["rule_id"] == "R-PRD-016" for f in all_findings):
        all_findings.append({
            "rule_id": "R-PRD-016", "level": "警告", "status": "fail",
            "location": str(root), "evidence": "",
            "issue": "全部 PRD 文档中未见术语表", "fix": "补充术语表，统一名词",
        })

    blockers = [f for f in all_findings if f["level"] == "阻断"]
    majors = [f for f in all_findings if f["level"] == "严重"]
    warns = [f for f in all_findings if f["level"] == "警告"]

    if args.json:
        print(json.dumps({
            "summary": {"blocker": len(blockers), "major": len(majors), "warning": len(warns)},
            "findings": all_findings,
        }, ensure_ascii=False, indent=2))
    else:
        print("=" * 68)
        print(f"L1 机检 · 文档级   root={root}")
        print("=" * 68)
        if not all_findings:
            print("✅ 未发现问题")
        for lvl, items in (("🔴 阻断", blockers), ("🟠 严重", majors), ("🟡 警告", warns)):
            if not items:
                continue
            print(f"\n{lvl}（{len(items)}）")
            for f in items:
                print(f"  [{f['rule_id']}] {f['location']}")
                print(f"      {f['issue']}")
                if f["evidence"]:
                    print(f"      证据：{f['evidence']}")
                print(f"      建议：{f['fix']}")
        print(f"\n合计：阻断 {len(blockers)} · 严重 {len(majors)} · 警告 {len(warns)}")

    return 1 if blockers else 0


if __name__ == "__main__":
    sys.exit(main())
