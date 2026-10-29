# -*- coding: utf-8 -*-
"""§㊼ 销项：第 31 轮的 1 条阻断 + 6 条重要。"""
import io, re, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:58])); return s
    return s.replace(old, new, cnt)
def tail427(p, s):
    """给仍止于 427 的沿革串补 435/447（幂等：已被补过的不再匹配）"""
    new, n = re.subn(r"(→ \*\*427\*\*〔[^〕]*〕)(?!→)", r"\1→ **435**〔2026-10-26 B9 +8〕→ **447**〔2026-10-29 工程接入 +12〕", s)
    if n == 0: FAILED.append("%s :: no 427-tail" % p)
    return new
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ============ 测试-Spec ============
P = "platform/specs/测试-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = tail427(P, s)
s = rep(P, s, "**78 接口** = 63 基线 + 补口 `#63`~`#70` 8 条 + **本机落地 `#71`/`#71a`/`#72`/`#72a` 4 条**、13 错误码、SSE）",
        "**78 接口** = 63 基线 + 补口 `#63`~`#70` 8 条 + **本机落地 `#71`/`#71a`/`#72`/`#72a` 4 条** + **工程接入 `#73`~`#75` 3 条**〔2026-10-29〕、13 错误码、SSE）")
s = rep(P, s, "**本机落地 `#71`/`#71a`/`#72`/`#72a` 4 条**，2026-10-21 · 开发阶段扩展 · **未过门禁**）",
        "**本机落地 `#71`/`#71a`/`#72`/`#72a` 4 条** + **工程接入 `#73`~`#75` 3 条**〔2026-10-29〕，2026-10-21 · 开发阶段扩展 · **未过门禁**）")
s = rep(P, s, "（63 基线 + 补口 8 + **本机落地 4**）", "（63 基线 + 补口 8 + **本机落地 4** + **工程接入 3**）")
s = rep(P, s, "4 条**〔§4.17，**开发阶段扩展、未过门禁**〕，**正向 + 异常**）",
        "4 条**〔§4.17，**开发阶段扩展、未过门禁**〕 + **工程接入 `#73`~`#75` 3 条**〔2026-10-29〕，**正向 + 异常**）")
s = rep(P, s, "+ **本机落地 `#71`/`#71a`/`#72`/`#72a` 4 条**，**全部按正向 + 异常/边界覆盖**",
        "+ **本机落地 `#71`/`#71a`/`#72`/`#72a` 4 条** + **工程接入 `#73`~`#75` 3 条**〔2026-10-29〕，**全部按正向 + 异常/边界覆盖**")
s = rep(P, s, "**B9当前引用435**", "**B9当前引用447**")
s = rep(P, s, "故 §12 追溯表**行为 94 行**", "故 §12 追溯表**行数为 94 行**")
s = rep(P, s, "**接口覆盖 71 → 75**", "**接口覆盖 71 → 78**")
run(P, s)

# ============ 埋点-Spec ============
P = "platform/specs/埋点-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = tail427(P, s)
s = rep(P, s, "§10.1 的 **27 行**", "§10.1 的 **30 行**", 2)
run(P, s)

# ============ 数据模型 / 接口-Spec：门禁族 A~I → A~J ============
P = "platform/design/数据模型.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "`item_code` string(16) Y（∈ 门禁 A~I 族）", "`item_code` string(16) Y（∈ 门禁 A~J 族，2026-10-29 增 `J`）")
run(P, s)
P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "**∈ 门禁 A~I 族**", "**∈ 门禁 A~J 族**（2026-10-29 增 `J`）")
run(P, s)

# ============ App-Spec：§4.2.3 补 #75 映射行（M-5） ============
P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
row = "| `UI-KB-001` | `RT-KB-001` | `EL-KB-018`/`EL-KB-019` | 点击「保存」 | `API-PLAT-009`（`#9`） | `PARAM-KB-DOC-ID` + `PARAM-KB-DRAFT` + `If-Match: <version>` | 更新后的对象（`c"
if row in s:
    idx = s.index(row); eol = s.index("\n", idx)
    s = s[:eol+1] + "| `UI-KB-001` | `RT-KB-001` | `EL-KB-018`/`EL-KB-019`（`sector=constraints` 时） | 点击「保存」 | `API-PLAT-075`（`#75`） | `PARAM-PROJ-ID` + `{content_md}` + `If-Match: <version>` | 更新结果 → 约束正文 | `VERSION_CONFLICT` → 409 提示 + diff，**不静默覆盖** |\n" + s[eol+1:]
else:
    FAILED.append("App-Spec :: §4.2.3 保存行未找到")
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: §㊼ 销项完成")
