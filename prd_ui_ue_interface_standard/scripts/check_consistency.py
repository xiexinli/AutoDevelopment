#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
L1 机检 · 跨文档一致性

以「单一真相源」为基准做确定性 diff：
  docs/数据字典.csv      ← 字段权威源
  docs/错误码文案表.csv  ← 错误码权威源
  docs/api/*.yaml|json   ← OpenAPI 契约
  docs/prd/ ui/ ue/      ← 三份说明文档

覆盖规则：
  R-PRD-004  字段权威源存在
  R-PRD-005  每个字段有英文名
  R-PRD-006  枚举字段给出用 | 分隔的枚举值
  R-PRD-007  可空性取值合法且与必填不矛盾
  R-PRD-008  ID 类字段必须是 string
  R-PRD-020  字段英文名唯一
  R-PRD-021  ★数据字典每行列数与表头严格一致（列错位）
  R-API-001  存在 OpenAPI 契约
  R-API-003  接口声明了错误码
  R-API-004  错误码都有用户文案
  R-API-005  字段与数据字典双向一致
  R-API-019  ★HTTP 状态与错误码文案表一致
  R-API-020  ★security 显式声明
  R-API-021  ★非必填字段显式 nullable
  R-UI-016   ★断点区间互斥且完备
  R-X-003    错误码有展示形态
  R-X-009    ★PRD 文案都能在 UE 文案表找到

用法：
  python3 scripts/check_consistency.py
  python3 scripts/check_consistency.py --root examples/docs --json
退出码：存在阻断项时返回 1。
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

NULLABILITY = {"必填", "可空null", "可空空串"}
ID_LIKE = re.compile(r"(?i)(id|no|code)$")

# 通用包体 / 分页包裹字段，不属于业务字段，不参与「孤立字段」判定。
ENVELOPE_FIELDS = {
    "code", "message", "msg", "data", "traceId", "trace_id", "success", "error",
    "list", "items", "records", "total", "hasMore", "has_more", "page", "pageSize",
    "pageNum", "pageNo", "pages", "current", "size",
}

# 断点区间的名字关键词
BP_NAME_HINT = ("手机", "折叠", "平板", "断点", "屏", "桌面", "PC")
RANGE_RE = re.compile(r"(\d+)\s*(?:至|到|-|—|~|～|–)\s*(\d+)")
ABOVE_RE = re.compile(r"(\d+)\s*(?:及以上|以上|\+)")


# ---------------- 基础工具 ----------------

def load_csv(path):
    if not path.exists():
        return None
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def load_openapi(paths):
    """返回 (docs, errors)。优先 PyYAML；缺库时对 .json 用标准库兜底。"""
    docs, errors = [], []
    try:
        import yaml  # noqa
        has_yaml = True
    except ImportError:
        has_yaml = False

    for p in paths:
        try:
            raw = p.read_text(encoding="utf-8")
            if p.suffix.lower() == ".json":
                docs.append((p, json.loads(raw)))
            elif has_yaml:
                import yaml
                docs.append((p, yaml.safe_load(raw)))
            else:
                errors.append(
                    f"跳过 {p}：未安装 PyYAML，无法解析 YAML。"
                    f"请执行 `pip3 install pyyaml`，或改用 .json 格式。")
        except Exception as e:  # noqa
            errors.append(f"解析失败 {p}：{e}")
    return docs, errors


def walk(node, key, found):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                found.append(v)
            walk(v, key, found)
    elif isinstance(node, list):
        for it in node:
            walk(it, key, found)


def collect_properties(doc):
    props, containers = [], []
    walk(doc, "properties", containers)
    for c in containers:
        if isinstance(c, dict):
            props.extend(c.keys())
    return set(props)


def collect_error_codes(doc):
    codes, holders = [], []
    walk(doc, "x-error-codes", holders)
    for h in holders:
        if isinstance(h, list):
            codes.extend(str(x) for x in h)
    return set(codes)


def read_docs(d):
    """把目录下所有 md 拼成一段文本。"""
    if not d.exists():
        return ""
    return "".join(p.read_text(encoding="utf-8", errors="ignore")
                   for p in sorted(d.rglob("*.md")))


def section(text, start, end):
    """取 text 中 start 到 end 之间的片段。"""
    if start not in text:
        return ""
    tail = text.split(start, 1)[1]
    if end and end in tail:
        tail = tail.split(end, 1)[0]
    return tail


# ---------------- 各项检查 ----------------

def check_dict_columns(path, add):
    """R-PRD-021 列对齐（同类问题聚合为一条）。"""
    if not path.exists():
        return
    raw = path.read_text(encoding="utf-8-sig").splitlines()
    if not raw:
        return
    hdr = raw[0].split(",")
    bad = []
    for i, line in enumerate(raw[1:], start=2):
        if not line.strip():
            continue
        n = len(line.split(","))
        if n != len(hdr):
            bad.append((i, n, line.split(",")[1] if len(line.split(",")) > 1 else ""))
    if not bad:
        return
    lines = "、".join(f"L{i}" for i, _, _ in bad)
    sample = "、".join(f"{f}({n}列)" for _, n, f in bad[:4])
    add("R-PRD-021", "阻断", f"数据字典.csv（{len(bad)} 行）",
        f"以下行与表头（{len(hdr)} 列）列数不符，存在列错位：{lines}",
        f"逐列核对，「校验规则」最容易串到「枚举值」列。涉及字段：{sample}")


def check_breakpoints(title, text, add):
    """R-UI-016 断点区间互斥。"""
    if not text:
        return
    ranges = []
    for line in text.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) < 2:
            continue
        if not any(h in cells[0] for h in BP_NAME_HINT):
            continue
        for seg in re.split(r"[；;]", cells[1]):
            m = RANGE_RE.search(seg)
            if m:
                ranges.append((seg.strip()[:20], int(m.group(1)), int(m.group(2))))
                continue
            m = ABOVE_RE.search(seg)
            if m:
                ranges.append((seg.strip()[:20], int(m.group(1)), None))
    pairs = []
    for i in range(len(ranges)):
        for j in range(i + 1, len(ranges)):
            n1, a1, b1 = ranges[i]
            n2, a2, b2 = ranges[j]
            lo1, hi1 = a1, (b1 if b1 is not None else 10 ** 9)
            lo2, hi2 = a2, (b2 if b2 is not None else 10 ** 9)
            if lo1 <= hi2 and lo2 <= hi1:
                pairs.append(f"「{n1}」与「{n2}」")
    if pairs:
        add("R-UI-016", "阻断", f"{title} 断点表",
            f"断点区间未构成互斥划分，共 {len(pairs)} 处重叠：{'；'.join(pairs)}",
            "重排为互斥且首尾相接的区间（前一区间上限 = 后一区间下限），"
            "并确保 PRD 与 UI 两处取值一致")


def check_copy(prd_text, ue_text, add, loc):
    """R-X-009 PRD 用户可见文案必须在 UE 文案表中。"""
    if not prd_text or not ue_text:
        return
    sec = section(prd_text, "## 4.", "## 5.")
    quotes = {q for q in re.findall(r"[「『]([^」』]{2,60})[」』]", sec)
              if "{" not in q and re.search(r"[一-鿿]", q)}
    for q in sorted(quotes):
        if q not in ue_text:
            add("R-X-009", "阻断", loc,
                f"PRD 中出现的用户可见文案「{q}」在 UE 文案表中不存在",
                "补进 UE 说明的文案表（i18n 唯一来源），或修正措辞使其一致")


def check_openapi_http(doc, code_map, add, http_missing):
    """R-API-019 / R-API-020。http_missing 收集 HTTP 状态缺口，稍后聚合输出。"""
    for path, ops in (doc.get("paths") or {}).items():
        if not isinstance(ops, dict):
            continue
        for method, op in ops.items():
            if not isinstance(op, dict):
                continue
            label = f"{method.upper()} {path}"
            if "security" not in op:
                add("R-API-020", "严重", label,
                    "未声明 security，无法区分「公开接口」与「漏写」",
                    "公开接口写 security: []，鉴权接口写 security: [{bearerAuth: []}]")
            declared = set((op.get("responses") or {}).keys())
            for c in op.get("x-error-codes") or []:
                row = code_map.get(c)
                if not row:
                    continue
                hs = (row.get("HTTP状态") or "").strip()
                if hs and hs != "200" and hs not in declared:
                    http_missing.setdefault(hs, []).append(label)


def report_http_missing(http_missing, add):
    """同一 HTTP 状态缺口只报一次（按协议第 6 条：同一问题只报一次）。"""
    for hs in sorted(http_missing):
        labels = sorted(set(http_missing[hs]))
        sample = "、".join(labels[:3]) + ("…" if len(labels) > 3 else "")
        add("R-API-019", "阻断", f"OpenAPI（{len(labels)} 个接口）",
            f"错误码文案表声明了 HTTP {hs}，但全部接口只声明 200 响应，"
            f"共 {len(labels)} 个接口受影响：{sample}",
            f"为每个接口补 {hs} 响应定义（引用统一包体），"
            f"或在文案表中把相关错误码的 HTTP 状态改为 200")


def check_nullable(doc, add):
    """R-API-021 非必填字段必须显式 nullable。"""
    schemas = (doc.get("components") or {}).get("schemas") or {}
    for name, s in schemas.items():
        if not isinstance(s, dict) or s.get("type") != "object":
            continue
        props = s.get("properties") or {}
        req = set(s.get("required") or [])
        loose = sorted(k for k in props
                       if k not in req and not (props[k] or {}).get("nullable"))
        if len(loose) >= 2:
            add("R-API-021", "严重", f"schemas.{name}",
                f"{len(loose)} 个非必填字段未声明 nullable：{', '.join(loose)}",
                "每个非必填字段补 nullable: true，或写进 required")


UNIT_RE = re.compile(r"单位\s*([^\s，,；;、/（(]+)")
CJK_RE = re.compile(r"[一-鿿]{2,}")


def check_units(dict_rows, add):
    """R-PRD-026 同一实体内带单位的字段口径必须一致。"""
    by_entity = {}
    for r in dict_rows:
        name = (r.get("字段英文名") or "").strip()
        blob = (r.get("校验规则") or "") + " " + (r.get("枚举值") or "")
        m = UNIT_RE.search(blob)
        if m:
            by_entity.setdefault((r.get("所属实体") or "").strip(), []).append((name, m.group(1)))
    for ent, items in by_entity.items():
        units = {u for _, u in items}
        if len(units) > 1:
            detail = "、".join(f"{n}={u}" for n, u in items)
            add("R-PRD-026", "阻断", f"数据字典.csv 实体 {ent}",
                f"同一实体内带单位的字段口径不一致：{detail}",
                "统一单位（建议金额与积分类一律用「分」，展示层格式化为 2 位小数）")


def check_synonyms(prd_text, ui_text, ue_text, add):
    """R-PRD-025 术语表「禁止的同义词」全库反查。

    注意：本规则**只产出候选集，不产出结论**。
    机器无法区分「真的术语漂移」与「该词是另一个独立概念」，
    因此等级为警告、结果聚合为一条，交由 AI / 人工判定。
    """
    sec = section(prd_text, "## 8. 术语表", "## 9.")
    if not sec:
        return
    # 关键：必须把术语表自身从搜索域中剔除，否则每个禁止词都会命中它自己那一行
    body = {
        "PRD": prd_text.replace(sec, ""),
        "UI": ui_text,
        "UE": ue_text,
    }
    cands = []
    for line in sec.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) < 3 or set(cells[0]) <= set("-: "):
            continue
        term, banned = cells[0], cells[2]
        if not term or "禁止" in banned or banned in ("—", "-", "无", ""):
            continue
        for w in re.split(r"[、,，/]", banned):
            w = w.strip()
            if len(w) < 2 or not CJK_RE.fullmatch(w) or w == term:
                continue
            hits = {k: v for k, v in ((k, t.count(w)) for k, t in body.items()) if v}
            if hits:
                cands.append((term, w, hits))
    if cands:
        detail = "；".join(
            f"{t}→「{w}」({', '.join(f'{k}×{v}' for k, v in h.items())})"
            for t, w, h in cands[:12])
        if len(cands) > 12:
            detail += f"…（共 {len(cands)} 处）"
        add("R-PRD-025", "警告", f"术语表（{len(cands)} 处候选）",
            f"禁止的同义词在正文中疑似出现：{detail}",
            "逐条判定：确属术语漂移则全库替换；若该词是另一个独立概念"
            "（如「评分」指智能体评分、「确认」是按钮动作、「结果」是表格行名），"
            "应把它从禁止清单中移除——不能既禁又用")


# ---------------- 主流程 ----------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="docs")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    root = Path(args.root)
    findings = []
    notes = []

    dict_csv = root / "数据字典.csv"
    code_csv = root / "错误码文案表.csv"
    dict_rows = load_csv(dict_csv)
    code_rows = load_csv(code_csv)
    api_dir = root / "api"
    api_files = sorted([p for p in api_dir.glob("*")
                        if p.suffix.lower() in (".yaml", ".yml", ".json")]) if api_dir.exists() else []

    prd_text = read_docs(root / "prd")
    ui_text = read_docs(root / "ui")
    ue_text = read_docs(root / "ue")

    def add(rule, level, loc, issue, fix, evidence=""):
        findings.append({"rule_id": rule, "level": level, "status": "fail",
                         "location": loc, "evidence": evidence,
                         "issue": issue, "fix": fix})

    # ---------- 字段字典自身合法性 ----------
    dict_fields = {}
    if dict_rows is None:
        add("R-PRD-004", "阻断", str(dict_csv),
            "未找到字段权威源 数据字典.csv",
            "从 templates/数据字典.csv 复制到 docs/ 并填写")
    else:
        check_dict_columns(dict_csv, add)
        for i, r in enumerate(dict_rows, start=2):
            name = (r.get("字段英文名") or "").strip()
            if not name:
                add("R-PRD-005", "阻断", f"数据字典.csv#L{i}",
                    "存在没有英文名的字段", "补齐字段英文名",
                    (r.get("字段中文名") or "")[:40])
                continue
            if name in dict_fields:
                add("R-PRD-020", "警告", f"数据字典.csv#L{i}",
                    f"字段英文名 {name} 重复定义", "合并或改名")
            dict_fields[name] = r

            nul = (r.get("可空性") or "").strip()
            if nul not in NULLABILITY:
                add("R-PRD-007", "阻断", f"数据字典.csv#L{i}",
                    f"字段 {name} 的可空性取值非法：「{nul}」",
                    "只能填 必填 / 可空null / 可空空串")
            if (r.get("必填") or "").strip() == "否" and nul == "必填":
                add("R-PRD-007", "阻断", f"数据字典.csv#L{i}",
                    f"字段 {name} 必填=否 但可空性=必填，自相矛盾",
                    "修正二者之一")
            typ = (r.get("类型") or "").strip().lower()
            if ID_LIKE.search(name) and typ and typ not in ("string", "enum"):
                add("R-PRD-008", "阻断", f"数据字典.csv#L{i}",
                    f"ID 类字段 {name} 类型为 {typ}",
                    "改为 string（JS Number 超过 2^53 会丢精度）")
            if typ == "enum" and "|" not in (r.get("枚举值") or ""):
                add("R-PRD-006", "严重", f"数据字典.csv#L{i}",
                    f"枚举字段 {name} 未给出用 | 分隔的枚举值",
                    "穷举全部枚举值，用 | 分隔，不要用「等」")

    # ---------- 错误码表自身合法性 ----------
    code_map = {}
    if code_rows is None:
        add("R-API-004", "阻断", str(code_csv),
            "未找到错误码权威源 错误码文案表.csv",
            "从 templates/错误码文案表.csv 复制到 docs/ 并填写")
    else:
        for i, r in enumerate(code_rows, start=2):
            c = (r.get("错误码") or "").strip()
            if not c:
                add("R-API-004", "阻断", f"错误码文案表.csv#L{i}",
                    "存在空错误码行", "补齐或删除")
                continue
            code_map[c] = r
            if not (r.get("用户文案") or "").strip() and c != "OK":
                add("R-API-004", "阻断", f"错误码文案表.csv#L{i}",
                    f"错误码 {c} 缺少用户文案", "填写最终展示给用户的原话")
            if not (r.get("展示形态") or "").strip():
                add("R-X-003", "阻断", f"错误码文案表.csv#L{i}",
                    f"错误码 {c} 缺少展示形态",
                    "填 toast / 页面级 / 弹窗 / 字段级 / 静默")

    # ---------- OpenAPI 一致性 ----------
    if not api_files:
        add("R-API-001", "阻断", str(api_dir),
            "未找到 OpenAPI 契约文件（.yaml/.yml/.json）",
            "从 templates/openapi模板.yaml 复制到 docs/api/ 并填写")
    else:
        docs, errors = load_openapi(api_files)
        notes.extend(errors)

        api_props, api_codes = set(), set()
        for _, doc in docs:
            api_props |= collect_properties(doc)
            api_codes |= collect_error_codes(doc)
        api_props -= ENVELOPE_FIELDS

        if docs:
            for f in sorted(api_props - set(dict_fields)):
                add("R-API-005", "阻断", "OpenAPI",
                    f"接口字段 {f} 不在 数据字典.csv 中（孤立字段）",
                    "补进 数据字典.csv 或修正接口字段名")
            for f in sorted(set(dict_fields) - api_props):
                add("R-API-005", "警告", "OpenAPI",
                    f"数据字典字段 {f} 在任何接口中都未出现（疑似冗余）",
                    "确认是否真的不需要暴露给客户端")

            if code_map:
                for c in sorted(api_codes - set(code_map)):
                    add("R-API-004", "阻断", "OpenAPI",
                        f"接口声明了错误码 {c}，但错误码文案表中没有它",
                        "补进 错误码文案表.csv（含用户文案与展示形态）")
                for c in sorted(set(code_map) - api_codes):
                    if c == "OK":
                        continue
                    add("R-API-003", "警告", "OpenAPI",
                        f"错误码 {c} 从未被任何接口通过 x-error-codes 声明",
                        "确认是否为废弃码，或给接口补上声明")

            if not api_codes:
                add("R-API-003", "阻断", "OpenAPI",
                    "没有任何接口声明 x-error-codes",
                    "每个接口必须用 x-error-codes 列出全部业务错误码")

            http_missing = {}
            for _, doc in docs:
                check_openapi_http(doc, code_map, add, http_missing)
                check_nullable(doc, add)
            report_http_missing(http_missing, add)

    # ---------- 断点互斥 ----------
    check_breakpoints("PRD", prd_text, add)
    check_breakpoints("UI", ui_text, add)

    # ---------- 文案一致性 ----------
    check_copy(prd_text, ue_text, add, "docs/prd §4")

    # ---------- 单位口径与术语反查 ----------
    if dict_rows:
        check_units(dict_rows, add)
    check_synonyms(prd_text, ui_text, ue_text, add)

    # ---------- 输出 ----------
    blockers = [f for f in findings if f["level"] == "阻断"]
    majors = [f for f in findings if f["level"] == "严重"]
    warns = [f for f in findings if f["level"] == "警告"]

    if args.json:
        print(json.dumps({
            "summary": {"blocker": len(blockers), "major": len(majors), "warning": len(warns)},
            "notes": notes, "findings": findings,
        }, ensure_ascii=False, indent=2))
    else:
        print("=" * 68)
        print(f"L1 机检 · 跨文档一致性   root={root}")
        print("=" * 68)
        for n in notes:
            print(f"⚠️  {n}")
        if notes:
            print()
        if not findings:
            print("✅ 未发现不一致")
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
