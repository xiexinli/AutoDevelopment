# -*- coding: utf-8 -*-
"""二期校对第 1 轮（§52）销项：9 阻断 + M-1/M-2/M-4。"""
import io, re, sys
FAILED = []
def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt: FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:56])); return s
    return s.replace(old, new, cnt)
def run(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ==================== B-2：埋点 §3.7 / 附节C / §7.1 三处归位 ====================
P = "platform/specs/埋点-Spec.md"; s = io.open(P, encoding="utf-8").read()
R10_DONE = "| `EVT_patch_writeback_done` | 增量写回**成功** | `#79` 返回成功、Toast「已写回工程：新增 {n} 个、替换 {m} 个文件」**渲染之后**、面板刷新**之前** | `project_id:string(36)`、`patch_id:string(36)`、`create_count:int`、`replace_count:int`、`skipped_count:int`、`duration_ms:int` | 即时 flush | `dedup_key` = `patch_id`；同一 `patch_id` 只报 1 次 | `REQ-PATCH-001` | `UI-WORK-001` / `RT-WORK-001` | `EL-WORK-037` | `#79` 成功回调内（Toast 之后）；**不上报文件路径文本** |"
R10_FAIL = "| `EVT_patch_writeback_failed` | 增量写回**失败** | `#79` 返回 400/409/超时/网络异常，且**错误提示渲染之后**（含**冲突整批拒绝**、**硬禁碰/越界拦截**、**XML 既有 id 丢失拦截**） | `project_id:string(36)`、`error_code:string`（`INVALID_ARGUMENT`/`VERSION_CONFLICT`/`UPSTREAM_TIMEOUT`/`UPSTREAM_UNAVAILABLE`/`INTERNAL`/`NETWORK_ERROR`）、`block_reason:enum{conflict,forbidden_path,id_removal,no_increment,other}\\|null` | 批量 | 同一 `Idempotency-Key` 只报 1 次 | `REQ-PATCH-001` | `UI-WORK-001` | `EL-WORK-037` | `#79` 失败分支回调内；**不上报文件路径文本** |"
R4_DONE = "| `EVT_patch_writeback_done` | §3.7 | `REQ-PATCH-001` | 辅助（写回成功） |"
R4_FAIL = "| `EVT_patch_writeback_failed` | §3.7 | `REQ-PATCH-001` | 旁路（写回失败） |"
# 1) 摘掉错位到「附节C」的 10 列表体行
s = rep(P, s, "\n" + R10_DONE + "\n" + R10_FAIL, "")
# 2) 摘掉错位到「§7.1」的 4 列摘要行
s = rep(P, s, R4_DONE + "\n" + R4_FAIL + "\n", "")
# 3) 10 列表体行归位到 §3.7（插在 §3.7 的 EVT_gen_task_canceled 行之后）
anchor37 = [ln for ln in s.split("\n") if ln.startswith("| `EVT_gen_task_canceled` | 用户主动取消生成")][0]
s = rep(P, s, anchor37, anchor37 + "\n" + R10_DONE + "\n" + R10_FAIL)
# 4) 4 列摘要行归位到 附节C
anchorC = [ln for ln in s.split("\n") if ln.startswith("| `EVT_gen_task_canceled` | §3.7 |")][0]
s = rep(P, s, anchorC, anchorC + "\n" + R4_DONE + "\n" + R4_FAIL)
# B-4/B-5/B-6/B-7/B-8：活值与分解式
s = rep(P, s, "**82 接口** = 63 基线 + 补口 `#63`~`#70` 8 条 + 本机落地 `#71`/`#71a`/`#72`/`#72a` 4 条 + 工程接入 `#73`~`#75` 3 条〔2026-10-29〕、",
        "**82 接口** = 63 基线 + 补口 `#63`~`#70` 8 条 + 本机落地 `#71`/`#71a`/`#72`/`#72a` 4 条 + 工程接入 `#73`~`#75` 3 条 + 二期写回 `#76`~`#79` 4 条〔2026-10-29〕、")
s = rep(P, s, "所以 8 个方框", "所以 8 个方框")   # noop 保护，忽略
s = rep(P, s, "事件定义、参数、上报时机与去重规则**均不变**（`EVT_chat_*` 仍为 4 条；**事件总数 57**", "事件定义、参数、上报时机与去重规则**均不变**（`EVT_chat_*` 仍为 4 条；**事件总数 59**")
s = rep(P, s, "`EL-*` 由 2026-10-23 由 424", "`EL-*` 由 2026-10-23 由 424")
s = rep(P, s, "A 线用**平台自己的** **447** 个元素", "A 线用**平台自己的** **450** 个元素")
s = rep(P, s, "需求以 `需求条目表` 的 94 条 `REQ-ID` 为唯一权威来源", "需求以 `需求条目表` 的 95 条 `REQ-ID` 为唯一权威来源")
run(P, s)

# ==================== B-1：接口-Spec §3.2 补 2 行 + 残余 91 ====================
P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
ROW_A = "| `EL-WORK-037` | 工作台 · 「写回工程」按钮与结果摘要 | `totals{create,replace}`、`notes[]`、`skipped[]` | 数量与文案数组 | `API-PLAT-079`（`#79`） | 是 | — | ✅ | 〔2026-10-29 二期写回新增〕 |"
ROW_B = "| `EL-WORK-038` | 工作台 · 补丁记录（状态 / 新增数 / 替换数 / 时间） | `patch_id`、`status ∈ {applied,rolled_back}`、`totals`、`created_at` | 枚举 + 计数 + 时间（UTC→本地） | `API-PLAT-077`（`#77`）／`API-PLAT-078`（`#78`） | 是 | — | ✅ | 〔2026-10-29 二期写回新增〕 |"
NV = [ln for ln in s.split("\n") if ln.startswith("| `EL-VER-028` | 版本归档页 · 未验证构建标记")][0]
s = rep(P, s, NV, NV + "\n" + ROW_A + "\n" + ROW_B)
s = rep(P, s, "`UI-Spec §5` 当前为 93 行〔2026-10-29 二期写回 +2、工程接入 +7；B9 +2〕", "`UI-Spec §5` 当前为 93 行〔2026-10-29 二期写回 +2、工程接入 +7；B9 +2〕")
s = rep(P, s, "| ✅ 满足 | **93** | 2026-10-29 二期写回 +2；2026-10-29 工程接入 +7；B9 +2数据组", "| ✅ 满足 | **93** | 2026-10-29 二期写回 +2；2026-10-29 工程接入 +7；B9 +2数据组")
s = rep(P, s, "## 10 需求追溯表（95 行", "## 10 需求追溯表（95 行")
run(P, s)

# ==================== B-3 / M-1：测试-Spec 与 RTM 用例数 ====================
for P in ["platform/specs/测试-Spec.md", "baseline/需求追溯矩阵.md"]:
    s = io.open(P, encoding="utf-8").read()
    s = rep(P, s, "**628 条**（表内定义行 **617 条** + §7 E2E 串联 **11 条**", "**632 条**（表内定义行 **621 条** + §7 E2E 串联 **11 条**")
    s = rep(P, s, "**2026-10-29 二期写回 +10**：§4.19 接口层 7 + §5.16 App 层 4 + §6.1.15 埋点层 2 + §7.11 E2E 1", "**2026-10-29 二期写回 +14**：§4.19 接口层 7 + §5.16 App 层 4 + §6.1.15 埋点层 2 + §7.11 E2E 1（表内 +13 / E2E +1）")
    s = rep(P, s, "**628**（表内 **617** + E2E 11", "**632**（表内 **621** + E2E 11")
    s = rep(P, s, "TC628（表内617+E2E11）", "TC632（表内621+E2E11）")
    s = rep(P, s, "**628**（表内 **617** + E2E **11**", "**632**（表内 **621** + E2E **11**")
    run(P, s)

# ==================== B-4：接口活值 78 → 82 ====================
for P, olds in [
  ("platform/specs/接口-Spec.md", ["= **78**，已确认基线", "因此 **接口总数仍 78**）。", "（现为 **78**；纳入后需连带更新）"]),
  ("platform/specs/测试-Spec.md", ["**78 接口** = 63 基线", "**接口覆盖 71 → 78**（本节 4 个接口", "现为 78**）→ 本 Spec **一律按 78 统计"]),
  ("platform/specs/App-Spec.md", ["（**78 个**：`#1`~`#62`", "✅ 引用 **78 个**（`API-PLAT-001`~`070`"]),
]:
    s = io.open(P, encoding="utf-8").read()
    for o in olds:
        n = s.count(o)
        if n == 0: FAILED.append("%s :: miss %r" % (P, o[:40])); continue
        s = s.replace(o, o.replace("78", "82"), 1)
    io.open(P, "w", encoding="utf-8").write(s)

# ==================== B-6 / B-7：元素 447→450、REQ 94→95 ====================
for P in ["platform/specs/埋点-Spec.md", "platform/specs/测试-Spec.md"]:
    s = io.open(P, encoding="utf-8").read()
    s = s.replace("**447** 个 `EL-*`", "**450** 个 `EL-*`").replace("**447 个**", "**450 个**")
    s = s.replace("`EL-*`，**447 个**", "`EL-*`，**450 个**")
    s = s.replace("的 94 条 `REQ-ID`", "的 95 条 `REQ-ID`").replace("91 条 `REQ-ID`", "95 条 `REQ-ID`")
    s = s.replace("**94 条 REQ**", "**95 条 REQ**").replace("94 REQ", "95 REQ")
    s = s.replace("§12 追溯表**行数为 94 行**", "§12 追溯表**行数为 95 行**")
    io.open(P, "w", encoding="utf-8").write(s)
P = "baseline/需求条目表.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "`REQ` 总数 **91**（PRD/基线已有的正式编号 25 条沿用不改 + 本次追加 66 条）；", "`REQ` 总数 **91**（PRD/基线已有的正式编号 25 条沿用不改 + 本次追加 66 条）；")
s = s.replace("→ 现为 **94**", "→ 现为 **95**")
run(P, s)

# ==================== B-8：§5 行数 91 → 93（残余） ====================
P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = s.replace("**统计**：本表 **91 行**", "**统计**：本表 **93 行**").replace("（同 91 行）", "（同 93 行）")
s = s.replace("✅ **91 行全覆盖**", "✅ **93 行全覆盖**")
run(P, s)
P = "platform/specs/UI-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = s.replace("本表 **84 → 91 行**，与 `接口-Spec §3`（同 91 行）逐行对应", "本表 **84 → 93 行**，与 `接口-Spec §3`（同 93 行）逐行对应")
run(P, s)

# ==================== B-9：App §10.1/§10.4 ====================
P = "platform/specs/App-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = rep(P, s, "共 **30 行**（2026-10-29 工程接入 +3）；", "共 **32 行**（2026-10-29 二期写回 +2、工程接入 +3）；")
s = rep(P, s, "**§10.1 + §10.4 = 57 行，与事件字典逐条对应**。", "**§10.1 + §10.4 = 59 行，与事件字典逐条对应**。")
s = rep(P, s, "§10.1 **30 行** + §10.4 **27 行**〔§10.1 的 30 行 = ", "§10.1 **32 行** + §10.4 **27 行**〔§10.1 的 32 行 = ")
s = rep(P, s, "（全小写下划线，**59 行** = §10.1 **30 行** + §10.4 **27 行**", "（全小写下划线，**59 行** = §10.1 **32 行** + §10.4 **27 行**")
run(P, s)

# ==================== M-2：UI-Spec EL-WORK-038 行多余单元格 ====================
P = "platform/specs/UI-Spec.md"; s = io.open(P, encoding="utf-8").read()
for ln in s.split("\n"):
    if ln.startswith("| `EL-WORK-038`") and "回滚" in ln and "step_id" in ln:
        fixed = ln.split("同 `step_id` 原地更新")[0].rstrip().rstrip("|").rstrip() + " |"
        s = s.replace(ln, fixed); print("M-2 修复 EL-WORK-038 行"); break
run(P, s)

# ==================== M-4：接口-Spec #78 出参补全 ====================
P = "platform/specs/接口-Spec.md"; s = io.open(P, encoding="utf-8").read()
s = s.replace("出参 `{restored,removed}`", "出参 `{patch_id,status,rolled_back_at,restored,removed}`")
run(P, s)

if FAILED:
    print("!! 未命中 %d 处：" % len(FAILED))
    for f in FAILED: print("   -", f)
    sys.exit(2)
print("OK: 二期校对第 1 轮销项完成")
