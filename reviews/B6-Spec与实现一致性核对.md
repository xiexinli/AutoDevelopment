# B6 · Spec ↔ 实现 一致性核对报告

日期：2026-10-22 ｜ 范围：**平台自身**（`server/` + `web/`）与五份 Spec / 设计基线
复跑：`cd server && node test/spec-impl-delta.mjs`（20 项）+ `node test/semantic-audit.mjs`（52 接口 / 14 错误分支）

> **为什么做这一刀**：文档侧今天刚验到**一致性终审 READY**（`五份Spec一致性校对报告 §㉔`），但那**只覆盖「五份 Spec + baseline 之间」**；
> 校对智能体明确声明**未读实现**（「Spec 所述与实现是否相符，本期从未验证」）。
> 本报告把两侧**合起来验**，重点覆盖**今天双方都刚改过**的面（`#25` 线程 / `#45 ai.step` / `#5` 确认 / 悬浮对话框元素）。

---

## 一、结论（先说结果）

| 层面 | 结果 |
|---|---|
| 自动化核对 20 项 | **PASS 19 / FAIL 1** |
| 错误分支（14 条实测） | **14 / 14 与声明一致** |
| 静态：契约端点 ↔ 实现路由 | **契约 82 个端点全部有实现**；实现 86 个，未登记 **4** 个（3 个已知 + **1 个本次新发现**） |
| 前端落点（`EL-WORK-031`~`035`） | **全部存在** |
| **真偏差（需处置）** | **1 条**：对话消息正文字段名 `content_md` ↔ `content` |
| 口径注意（非缺陷） | 2 条：`ai.step` 字段集按 `kind` 分两组；`#3`/`#7` 实现返回多于声明 |

**一句话**：今天双方各自改动的那批面**基本对得上**；唯一真偏差是**一个字段名**，且它**从对话功能第一天起就存在**（不是今天引入）。

---

## 二、真偏差（需处置）

### D-1 ｜ P1 ｜ 对话消息正文字段名：文档 `content_md` ↔ 实现/前端 `content`

| 侧 | 事实 | 证据 |
|---|---|---|
| **实现（DB）** | 列名 **`content`** | `server/src/db/schema.sql:359` → `content TEXT NOT NULL` |
| **实现（接口）** | `#25` 每条返回 **`content`** | 实测 itemKeys = `[message_id, project_id, seq, role, content, status, thread_key, created_at]` |
| **前端** | `ChatMessage.content` | `web/src/store/session.ts`（类型与渲染都用 `content`） |
| **文档** | **`content_md`** | `数据模型 E20`、`接口-Spec §4.2 E20`、`§5.4.5`、`§5.5.14`、`§3.2` 的 `EL-WORK-015/016` 行、`App-Spec` 的 `MODEL-CHAT-MESSAGE` |

**判定**：**声明与实现必有一错**。前端与实现一致、且**从第一天起就是 `content`**（今天的改动只加了 `thread_key`）。

**建议处置：决策 A —— 改文档对齐实现**（与今天 `gate.*`、`sector` 同一先例；改实现要连带改前端 + 迁移 DB 列，风险与收益不成比例）。
**改动面**：6 处（`数据模型 E20` 字段表 / `接口-Spec §4.2 E20` / `§5.4.5` / `§5.5.14` / `§3.2` 行 / `App-Spec` 的 `MODEL-CHAT-MESSAGE` 与调用行）。
**顺带**：`#25` 实返回 **`project_id`**（文档未列）—— 同一批补上或注明「实现额外返回」。

> ⚠️ 注意别改错：**知识库**的正文**确实叫 `content_md`**（`#8` `GET /kb-docs/{id}` 的 `content_md`，与 `E2.sector` 同族）。**只有对话消息**是 `content`。二者不是同一个东西。

---

## 三、口径注意（非缺陷，但建议在 Spec 里写明）

### D-2 ｜ P2 ｜ `ai.step` 的字段集**按 `kind` 分两组**（并集 = 冻结表 11 键）

| `kind` | 实测字段（8） | 与 11 键的差 |
|---|---|---|
| `task:*`（任务生命周期） | `step_id, task_id, kind, title, status, progress, phase, at` | **无** `detail` / `model` / `duration_ms` |
| `llm`（大模型调用） | `step_id, task_id, kind, title, status, detail, model, duration_ms, at` | **无** `phase` / `progress` |

- **并集 = `接口-Spec §5.0.3` 冻结表的 11 键** ✅（我的两项断言都过）。
- 但**单条事件不含全部 11 键** → 下游按「11 键一次性解析」会拿到 `undefined`。建议二选一：
 ① **改 Spec 加一句分型说明**（最省事）；② **改实现**：两类都补齐缺的键、缺省给 `null`（更利于下游，改动 ~5 行）。

### D-3 ｜ P3 ｜ `#3` / `#7` 实现返回**多于**声明

| 接口 | 声明（Spec） | 实现实测（多出的部分） |
|---|---|---|
| `#3` 项目详情 | `owner_user_id`/`name`/`stage`/`current_revision_id`/`current_version_id`/`created_at`/`updated_at` | ➕ `project_id`、`description`、`depth`、`version` |
| `#7` 知识库列表 `items[]` | `title`/`sector`/`origin`/`updated_at`（另含 `kb_doc_id`/`version`） | ➕ `project_id`、`document_id`、`created_at` |

不构成违约（多加字段不影响调用方），但按本项目「冻结字段名」的口径，建议在 Spec 注明「另有 …」。

---

## 四、已对齐（本轮核对中逐条确认）

| 面 | 实测 |
|---|---|
| `#25` 线程过滤 / 回落 | 不给 `thread` → 全部线程 + `data.thread=null`；`?thread=upload` → 只该线程 + 回显；`?thread=bogus` → **200 回落 `workbench`**（**不是 400**）✅ |
| `#25` 出参含 `data.thread` | ✅（今天刚补进文档，文档与实现现已一致） |
| `#26` 线程落库 / `seq` | 三个线程 `workbench/upload/kb` 各 2 条；**`seq` 线程内单增**（upload `[1,2]`、workbench `[1,2]`）✅ |
| `#45 ai.step` 覆盖式更新 | 同一任务推送 3 次、**`step_id` 唯一 1 个**、终态 `succeeded→done` ✅ |
| `#45 ai.step` 新订阅补发 | 新连接**立即收到 4 条**历史步骤 ✅ |
| `#45 ai.step` 不落库 | 全库 34 张表**无任何承载表** ✅ |
| `#5` 删除 | 缺 `confirm` → 400「删除项目需要显式确认。」；带 `confirm:true` → 200 + `{deleted_at}` ✅ |
| `#62` 埋点上报 | `schema_version` 类型错 → 400「必须是字符串。」；`event_name` 合法 → `accepted=1` ✅ |
| 错误分支 | 14/14 与声明一致（含 `#5 缺 confirm`、`#62` 两条）✅ |

---

## 五、静态核对：契约 ↔ 实现路由

- **契约侧 82 个「方法 + 路径」全部有实现** ✅
  （其中 `#37` `PATCH /elements/{id}`、`#39 /style`、`#40 /events` 由 `editor.ts` 的 **`app.route(...)` 循环注册**，本脚本按**源码形态**单独识别 —— 同 `A1-硬核对报告 §1.1` 口径；纯正则解析会误报缺失）
- **实现侧 86 个端点**，其中未被契约登记 **4 个**：

| 端点 | 判定 |
|---|---|
| `POST /auth/feishu/qrcode/{state}/simulate` | 已知：开发适配器专用，**有意**不进契约（`B5` 验收记录 §2） |
| `GET /projects/{id}/kb-sectors` | 已知：`A1 §1.2` 遗留，**建议补登记** |
| `GET /projects/{id}/tasks`（列表） | 已知：`A1 §1.2` 遗留，**建议补登记** |
| **`GET /auth/feishu/callback`** | ⚠️ **本次新发现**：真实飞书登录的 **OAuth 重定向端点**，契约与 `接口-Spec §1.13` 均无登记（真实登录未启用，属"预备"端点）→ 建议补登记或明确标为「开发/未启用」 |

---

## 六、前端落点核对（`EL-WORK-031`~`035`）

五个新元素在 `web/src` 的**落点全部存在**：

| 元素 | 落点 |
|---|---|
| `EL-WORK-031`/`032` 收起 / 关闭 | `components/FloatingChat.tsx`（`aria-label="收起对话框"/"关闭对话框"`） |
| `EL-WORK-033` 切换对话 | `FloatingChat.tsx` + `pages/ChatPanel.tsx`（线程分组）+ `chat/thread.ts` |
| `EL-WORK-034` 回到当前步骤 | `FloatingChat.tsx` + `chat/thread.ts` |
| `EL-WORK-035` AI 处理过程 | `pages/ChatPanel.tsx` + `sse/stream.ts`（`ai.step` 订阅与缓存） |

---

## 七、本轮**未覆盖**（不声称已核）

1. **只核了「今天改动面 + 关键接口」的字段级**；其余 40+ 接口只有**形状级**（`semantic-audit` 的 52 接口 `dataKeys`）。
2. **前端交互/文案与 Spec 的逐条比对未做**（只核了元素**落点存在性**，未核行为、动效、文案逐字）。
3. **592 条测试用例一条未跑**（仍缺 runner）。
4. **埋点实现缺口**（前端 `track()` 30/54、`#40` 无前端调用）—— 已知，本轮未复验。
5. `EL-*` 与真实 DOM 的**逐元素对应**（如 `EL-WORK-019` 是否就是那个 textarea）未核。
6. 安卓工程侧（生成物）与 Spec 的一致性未核。

---

## 八、建议处置（请拍板）

1. **D-1 字段名**：按**决策 A 改文档**（6 处）—— 建议直接批，改动小且消除「照文档写会取不到值」的坑。
2. **D-2 `ai.step` 分型**：① 改 Spec 加一句（省事）／② 改实现补 `null`（下游更友好）—— 二选一。
3. **D-3**：Spec 注明「另有 …」即可（或列全）。
4. **`GET /auth/feishu/callback`**：补登记到 `接口-Spec §1.13`（本机落地/未启用），与 `#71`~`#72a` 同批。
5. `kb-sectors` / `tasks` 列表：沿用 `A1` 的建议补登记（两行了事）。


---

## 九、处置结果（2026-10-22 · PM 已拍板，全部执行完毕）

| 项 | 决策 | 执行 | 复核 |
|---|---|---|---|
| **D-1** 对话正文键 `content_md` → `content` | **决策 A：改文档** | **8 处文档改完**：`数据模型 E20`、`接口-Spec §4.2 E20`／`§3.2` 的 `EL-WORK-015/016` 行（数据列 + 来源列）／`§5.4.5`／`§5.5.14`（响应结构 + 正文约束 + 渲染约束）、`App-Spec` 的 `MODEL-CHAT-MESSAGE` 与 `#25` 调用行 + SSE 两行、`测试-Spec` 的 `TC-CHAT-001`/`TC-CHAT-008`、`UI-Spec §5`、`baseline/领域模型` | ✅ **对话侧 `content_md` 残留 = 0**；知识库 `#8`／Spec `#32` 的 `content_md` **未动**（未误伤） |
| **D-2** `ai.step` 分型 | **改实现补 `null`** | `core/tasks.ts` 的任务类补 `detail/model/duration_ms = null`；`core/ai-trace.ts` 的大模型类三处补 `phase/progress = null`；`AiStep.phase` 类型放宽为 `string \| null` | ✅ **两类各 11 键、形状一致**（脚本 C3a/C3b 过） |
| **D-3** 声明列全 | **Spec 列全** | `#3` → **11 字段**（§5.4 行 + §5.5.3）；`#7` 的 `items[]` → **9 字段** | ✅ 与实测逐字一致 |
| **`feishu/callback`** | **标「开发/未启用」** | 与 `kb-sectors`、`tasks 列表`、`simulate` 一并登记为 **`接口-Spec §5.4.14 内部端点`**（**不占编号**），并在 `接口契约 §2` 前加前注 | ✅ **接口总数仍 75**（未触发计数涟漪） |

**二次复核结果**：`spec-impl-delta.mjs` **20/20 PASS**（此前唯一 FAIL 的 A3 已消除）｜ `b2/b3/b4` 回归 **25/21/18 全绿** ｜ `semantic-audit` 错误分支 **14/14** ｜ 计数面 **接口 75 / 元素 424 / §5 82 / 用例 583(+9)** 未变。

**文档变更记录**：`接口-Spec v0.9`、`App-Spec v0.2.6`、`测试-Spec v0.2.6`、`UI-Spec v0.1.8`。

> **仍未覆盖**（同 §七）：前端交互/文案逐条、592 条用例实跑、埋点 30/54 缺口、`EL-*` ↔ 真实 DOM 逐元素、安卓生成物。
