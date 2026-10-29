# -*- coding: utf-8 -*-
"""第 37 轮（§53）销项：5 阻断 + M-1 + 建议项（§7.1 补 5 行、:196 括注、RTM 口径注、O-23 实现对齐）。"""
import io

FAILED = []


def load(p):
    return io.open(p, encoding="utf-8").read()


def save(p, s):
    io.open(p, "w", encoding="utf-8").write(s)


def rep(p, s, old, new, cnt=1):
    n = s.count(old)
    if n != cnt:
        FAILED.append("%s :: x%d(exp %d) :: %r" % (p, n, cnt, old[:70]))
        return s
    return s.replace(old, new, cnt)


# ==================== B-1 接口-Spec :5 ====================
P = "platform/specs/接口-Spec.md"
s = load(P)
s = rep(P, s, "**冻结基线 71 个平台自身接口** + 本机落地 4 + 工程接入 3 = **82**",
        "**冻结基线 71 个平台自身接口** + 本机落地 4 + 工程接入 3 + 二期写回 4 = **82**")
save(P, s)

# ==================== B-2 / B-5 测试-Spec ====================
P = "platform/specs/测试-Spec.md"
s = load(P)
s = rep(P, s, "+ **工程接入 `#73`~`#75` 3 条**〔2026-10-29〕、13 错误码、SSE）",
        "+ **工程接入 `#73`~`#75` 3 条** + **二期写回 `#76`~`#79` 4 条**〔2026-10-29〕、13 错误码、SSE）")
s = rep(P, s, "`TC-E2E-001`~`TC-E2E-010`（S0→S9 + 工程接入）", "`TC-E2E-001`~`TC-E2E-011`（S0→S9 + 工程接入 + 二期写回）")
s = rep(P, s, "| `TC-E2E-001`~`TC-E2E-010` | **E2E 串联**（§7，共 **10 条**） |",
        "| `TC-E2E-001`~`TC-E2E-011` | **E2E 串联**（§7，共 **11 条**） |")
s = rep(P, s, "另有 **`TC-E2E-010`** 覆盖工程接入（`AC-INTAKE-07`/`08`）。",
        "另有 **`TC-E2E-010`** 覆盖工程接入（`AC-INTAKE-07`/`08`）、**`TC-E2E-011`** 覆盖二期写回（`AC-PATCH-01`~`04`）。")
s = rep(P, s, "用例编号 `TC-E2E-001`~`TC-E2E-010`。", "用例编号 `TC-E2E-001`~`TC-E2E-011`。")
s = rep(P, s, "（另有 `TC-E2E-010` 覆盖工程接入）", "（另有 `TC-E2E-010` 覆盖工程接入、`TC-E2E-011` 覆盖二期写回）")
save(P, s)

# ==================== B-3 / B-4 App-Spec ====================
P = "platform/specs/App-Spec.md"
s = load(P)
s = rep(P, s, "**`#73`/`#74`/`#75`**〔2026-10-29 工程接入〕",
        "**`#73`/`#74`/`#75`** + **`#76`~`#79`**〔2026-10-29 工程接入 + 二期写回〕")
s = rep(P, s, "**`API-PLAT-073`/`074`/`075`**〔2026-10-29 工程接入〕",
        "**`API-PLAT-073`/`074`/`075`** + **`API-PLAT-076`~`079`**〔2026-10-29 工程接入 + 二期写回〕")
save(P, s)

# ==================== M-1 验收标准 :287 ====================
P = "platform/design/验收标准.md"
s = load(P)
s = rep(P, s, "二期写回（`REQ-PATCH-001`，`Deferred`）。", "二期写回（`REQ-PATCH-001`，**已转正**，见 §17B）。")
save(P, s)

# ==================== 埋点-Spec：:196 括注 + §7.1 补 5 行 ====================
P = "platform/specs/埋点-Spec.md"
s = load(P)
s = rep(P, s, "**事件总数 59**〔2026-10-29 工程接入 +3 后〕）", "**事件总数 59**〔2026-10-29 二期写回 +2、工程接入 +3 后〕）")
NEW71 = (
    "| `EVT_intake_click` | 在项目列表点「接入已有工程」入口 → 查上报日志 | 恰 1 条；`entry=header`；**不含工程路径 / 工程名文本** | 同一 `element_id` **300ms** 内连点 → 只 1 条（弹窗打开前上报） |\n"
    "| `EVT_intake_done` | 接入一次合法的本机 Android 工程 → 查日志 | 恰 1 条；`counts_items`/`counts_modules`/`counts_dependencies`/`warnings_count` 与 `#73` 返回一致；`project_name_chars` = 工程名长度；`duration_ms ≥ 0`；**不上报工程名与工程根路径文本** | 同目录重复接入（`Idempotency-Key` 重放）→ 同一 `project_id` 只 1 条 |\n"
    "| `EVT_intake_failed` | ① 根目录为空；② 未勾选只读授权；③ 填相对路径 / 目录不存在 / 非 Android 工程；④ 服务端 400/404/超时 → 各查日志 | 每次失败 1 条；`error_code` ∈ `{INVALID_ARGUMENT,NOT_FOUND,VERSION_CONFLICT,UPSTREAM_TIMEOUT,UPSTREAM_UNAVAILABLE,NETWORK_ERROR}`、`block_reason` ∈ `{no_root,no_consent,not_android,other}`（前端拦截**不发 `#73`** 也上报）；**不得上报路径 / 工程名文本** | 同一 `Idempotency-Key` 只报 1 次 |\n"
    "| `EVT_patch_writeback_done` | 已有成功生成任务的项目点「写回工程」→ 查日志 | 恰 1 条；`create_count`/`replace_count`/`skipped_count` 与 `#79` 出参一致；`duration_ms ≥ 0`；**不上报文件路径文本** | 同一 `patch_id` 重放 → 只 1 条（`dedup_key = patch_id`） |\n"
    "| `EVT_patch_writeback_failed` | ① 提交与既有文件冲突的补丁（未带 overwrite）；② 命中硬禁碰 / 越界；③ 替换 `res/layout/*.xml` 丢失既有 `@+id`；④ 无安全增量 → 各查日志 | 每次失败 1 条；`error_code` ∈ `{INVALID_ARGUMENT,VERSION_CONFLICT,UPSTREAM_TIMEOUT,UPSTREAM_UNAVAILABLE,INTERNAL,NETWORK_ERROR}`；`block_reason` ∈ `{conflict,forbidden_path,id_removal,no_increment,other}` | 同一 `Idempotency-Key` 只报 1 次 |"
)
lines = s.split("\n")
k = [i for i, l in enumerate(lines) if l.startswith("### 7.2")]
if len(k) != 1:
    FAILED.append("%s :: §7.2 anchor x%d" % (P, len(k)))
else:
    lines.insert(k[0], NEW71)
    s = "\n".join(lines)
save(P, s)

# ==================== RTM §四 口径注 ====================
P = "baseline/需求追溯矩阵.md"
s = load(P)
NOTE = ("> **与 `测试-Spec §11.1` 的分态差异（**口径，不是漏改**）**：本表 `汇总` 行为**五列并集**口径 —— `REQ-DESIGN-001` 记 `Deferred`（1 条），其余 **94** 条计 `OK`（`N/A` 并入 `OK`）；"
        "`测试-Spec §11.1` 为**测试列**口径 —— `REQ-DESIGN-001` 计 `OK`、`REQ-BASE-001`/`REQ-AUTH-007` 单列 `N/A`（`OK 93 + N/A 2`）。两者分母同为 `需求条目表` **95 条**，**覆盖率一致（95/95）**，仅分态归并方式不同。")
old = "> 本表口径按 `baseline/需求追溯矩阵.md` 原文定义 —— **`GAP` 不计入覆盖**，故为 `95/95 = 100.0%`。两者不矛盾，是两个不同的分母定义。"
s = rep(P, s, old, old + "\n" + NOTE)
save(P, s)

# ==================== O-23：实现对齐 Spec 文案（去掉 Spec 未定义的后缀） ====================
P = "web/src/components/PatchWriteback.tsx"
s = load(P)
s = rep(P, s, 'message.success(`已写回工程：新增 ${r.totals.create} 个、替换 ${r.totals.replace} 个文件${skippedN ? `，跳过 ${skippedN} 项` : ""}。`);',
        'message.success(`已写回工程：新增 ${r.totals.create} 个、替换 ${r.totals.replace} 个文件。`);')
save(P, s)

print("FAILED = %d" % len(FAILED))
for f in FAILED:
    print("  !! " + f)
