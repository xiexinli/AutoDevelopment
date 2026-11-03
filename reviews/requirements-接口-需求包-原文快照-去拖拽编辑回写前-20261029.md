# 接口需求包（S4 · 角色 ②）

> **上游**：`platform/requirements/需求条目表.md` + **UI Spec 的《元素-数据需求表》**（你的主要输入）｜ **日期** 2026-10-20
> **本包输出到**：`templates/接口-Spec.md` → 接口 Spec
> **主输入**：`platform/design/接口契约.md`（**平台自身 63 个接口**、错误码、分页排序、SSE —— 已确认基线）、`platform/design/数据模型.md`（21 实体字段级口径）
> **主输出**：`API-*` 契约 + **《UI 数据供给对照表》（零缺口）** + 错误码 + 数据模型
> **依赖顺序**：UI → **接口（本包）** → App → 埋点 → 测试。
> **硬前置**：UI Spec 的《元素-数据需求表》**未定稿，本角色不得开工**（本角色的方法是从 UI 倒推，不是正向设计）。

---

## 0 口径说明（先分清两套接口，别混）

| 名称 | 是什么 | 谁产出 | 编号 |
|---|---|---|---|
| **平台自身接口** | AutoDevelopment 平台前后端之间的接口（建项目、上传、审核、生成…） | **平台侧**，已在 `platform/design/接口契约.md` **冻结为基线** | 本文用 **`接口契约 #n`** 引用（**不要**给它另编 `API-*`） |
| **被开发 App 的接口** | 用户在平台里为**他那个 App** 定义的业务接口（`§F12` 接口能力管理） | **你（接口角色）** 产出 | `API-<模块>-<三位>`，清单落 `REQ-API-001` |

> ⚠️ 两套接口**都要在本 Spec 中体现**：一套是你的**实现依据**（平台自己跑起来），一套是你要**设计交付**的东西（被开发 App 的数据契约）。

---

## 1 全局约定（平台自身接口，直接继承基线，**不要重定义**）

| 项 | 约定 | 出处 |
|---|---|---|
| Base URL / 版本 | `/api/v1/`；对端**新增字段容忍**，删除字段 = 破坏性变更须升版本 | `接口契约§0.1`；`D-A21` |
| 统一响应包 | `{code, message, data, request_id}`；失败 `message` = **可直接展示的中文**；`request_id` 全链路透传且**不含 PRD / 代码内容** | `接口契约§0.2` |
| 鉴权 | `Authorization: Bearer <token>`（**飞书扫码登录**后签发，`user_id` = 飞书 `open_id`）；**逐对象鉴权**（含列表 / 搜索 / 导出）；越权 **403 且不泄露对象是否存在** | `接口契约§0.1`；`D-Q6`；`D-A28` |
| 时间 | 一律 **UTC ISO-8601**；展示由前端转本地时区；缺失**不得**当作 `1970` | `D-A20`；`数据模型§5.5` |
| 幂等 | 提交类接口接受 `Idempotency-Key`；**同键 3s 内重放返回首次结果** | `D-A12` |
| 乐观锁 | 可编辑资源带 `version`，`PATCH` 须带 `If-Match`；不匹配 → `VERSION_CONFLICT` | `D-Q14` |
| 分页 / 排序 / 搜索 | `page`（默认 1）/ `page_size`（默认 **20**，可选 20/50/100，>100 → `INVALID_ARGUMENT`）/ `q`（≤100 字符）/ `sort` 默认 `updated_at:desc`；**稳定次序键 = `updated_at` 相同再按 `id` 升序**；`page` 超总页数 → **空 `items` + 真实 `total`，不报错** | `接口契约§0.3`；`D-A19` |
| 部分失败 | `failed_parts[]` 与 `total` 同时返回；此时 `total` **只统计成功部分**，前端**必须显示"部分加载"标记** | `接口契约§0.3`（E5） |
| 长任务 | 统一模型：`GET /tasks/{task_id}` + **SSE** `GET /projects/{id}/tasks/stream`（事件 `task` / `chat.delta` / 15s `ping`）；断线重连后**按 `seq` 取最新**；**SSE 不可用自动降级为 2s 轮询** | `接口契约§0.4`；`D-Q15`；`D-A13` |
| 错误码 | **一次性以 `数据模型§5.4` / `接口契约§0.5` 为准**（`INVALID_ARGUMENT`/`UNAUTHENTICATED`/`FORBIDDEN`/`NOT_FOUND`/`VERSION_CONFLICT`/`IDEMPOTENT_REPLAY`/`PAYLOAD_TOO_LARGE`/`FORMAT_UNSUPPORTED`/`PARSE_PARTIAL`/`UPSTREAM_TIMEOUT`/`UPSTREAM_UNAVAILABLE`/`RATE_LIMITED`/`TASK_STALE`/`INTERNAL`），**本包不复制** | `数据模型§5.4` |
| 外部依赖降级 | 大模型 / 飞书：**60s 超时、指数退避 + 抖动、最多 2 次**；仍失败 → 任务 `failed`，**绝不静默写入**；安卓构建工具链**不在平台侧** | `接口契约§0.6`；`D-A22` |
| 脱敏 | PRD 正文与生成代码**不入日志、不入 URL**；密钥运行时从受保护存储加载，**不下发前端** | `D-Q7`；`D-A34` |

**长任务型（`⚡`）与破坏性（`⬛`）标记沿用 `接口契约` 的约定**：`⬛` 服务端亦须校验，`⚡` 配 SSE。

---

## 2 接口需求包（表）

> 「数据需求关注点」列只写**这条需求要求接口提供什么数据 / 什么时机 / 什么边界**；字段级清单**不在此复制**，一律引用 `数据模型` / `接口契约`。

| REQ-ID | 需求摘要 | 数据需求关注点 |
|---|---|---|
| `REQ-PROJ-001` | 新建项目 | `#2 POST /projects`：入参 `{name, description?}`；返回 `project_id`、`stage`、`created_at`；空白名 → 400 `INVALID_ARGUMENT`（message 可在 UI 直接展示）；**幂等键**（`REQ-NF-006`） |
| `REQ-PROJ-002` | 项目列表 | `#1 GET /projects`：`q` / `page` / `page_size` / `sort`；**每页 20、`updated_at` 倒序**；**零项目 vs 搜索无结果**必须在出参上可区分（`total=0` + `q` 是否为空） |
| `REQ-PROJ-003` | 项目重命名 | `#4 PATCH /projects/{id}`：须 `If-Match`；冲突 409 |
| `REQ-PROJ-004` | 项目删除 | `#5 ⬛ DELETE`：**逻辑删除**（写 `deleted_at`）；返回可展示的「30 天后彻底清除」语义字段（或由前端固定文案） |
| `REQ-PROJ-005` | 工作台状态条 | `#6 GET /projects/{id}/stats`：`stage`（枚举见 `数据模型§3.1`）、**门禁状态**（映射 `ReviewReport.verdict`）、`current_version_id`（展示 `v{n}`）、进行中任务数 |
| `REQ-KB-001` | 知识库内容 | `#7 GET /projects/{id}/kb-docs`（**强制按 `project_id` 过滤**）、`#8 GET /kb-docs/{id}`、`#9 PUT`（须 `If-Match`，`origin` 置 `user_edited`） |
| `REQ-KB-002` | 知识库入口 | 复用 `REQ-KB-001` 的接口；**进入即校验项目权限**，越权 **403 且不泄露存在性** |
| `REQ-UPLOAD-001` | 上传与解析 | `#10 POST /projects/{id}/uploads`（`multipart/form-data` + `Idempotency-Key`）、`#11 POST /projects/{id}/documents`（飞书链接）、`#12 ⚡ POST /documents/{id}/revisions`（返回 `task_id`） |
| `REQ-UPLOAD-002` | 规格校验与拒绝 | 413 `PAYLOAD_TOO_LARGE` / 422 `FORMAT_UNSUPPORTED` / 页数超限；**失败不产生文件记录**（`UploadFile.status=rejected` + `reject_reason` 枚举） |
| `REQ-UPLOAD-003` | 部分解析失败 | `#14 GET /revisions/{id}/parse-result` → `parts{}` 逐块 `status ∈ {ok,failed,skipped}` + `parse_status=partial`；`#15 POST …/parts/{part_key}/manual-supplement` |
| `REQ-UPLOAD-004` | 空文档 | `parse_status=succeeded` **且** `empty_document=true`（**独立标记，不是失败**） |
| `REQ-UPLOAD-005` | revision 不覆盖 | `#13 GET /documents/{id}/revisions`（倒序）；重复上传 → **新建 revision**，旧 revision 保留可查 |
| `REQ-UPLOAD-006` | 解析耗时与进度 | 解析 `⚡` 任务：进度经 SSE `task` 事件推送；`progress` + `started_at` 足以算「已用 {n} 秒」；**超时不静默**（置 `timeout` 可重试） |
| `REQ-REVIEW-001` | 门禁审核 | `#16 ⚡ POST /revisions/{id}/reviews` → `review_id` + `task_id` + `standard_version`；`#17 GET /reviews/{id}`（`verdict`/`counts`/`superseded`）；`#18 GET /reviews/{id}/items`（每项含 **`evidence_ref`**）；**无证据的判定不得输出** |
| `REQ-REVIEW-002` | 回写原 PRD | `#23 ⬛ POST /reviews/{id}/writeback`：`{confirm:true, accepted_items[], snapshot:true}`；**回写前留快照**；**只写已 Accept 内容**；返回 diff 统计（删除/修改行数 = 0 需可核验） |
| `REQ-REVIEW-003` | 待澄清清单与作答 | `#19 GET /reviews/{id}/questions`（`level`/`options`(A~E + `X. Other`)/`fallback`/`status`）；`#20 POST /questions/{code}/answers`；提交复审前服务端须校验**阻断项已作答** |
| `REQ-REVIEW-004` | 假设清单 | `#21 GET/POST /reviews/{id}/assumptions`（`choice: accept|convert`）；**`unset` 不允许进入生成阶段**（服务端在 `#23` 前校验，否则 400） |
| `REQ-REVIEW-005` | 门禁标准维护 | `#24 GET/PUT /gate-standards`：`PUT` **每次保存版本 +1**；历史评分**不重算**（按当时 `standard_version` 留痕） |
| `REQ-REVIEW-006` | 一键采纳 | `#22 POST /reviews/{id}/accept-candidates`：**只做批量勾选，不写 PRD**（与 `#23` 严格分离，接口语义上不得合并） |
| `REQ-REVIEW-007` | agent 输出校验降级 | 所有 agent 产出接口须有**结构校验**；失败重试 1 次；仍失败 → 返回「需人工确认」态而非 200 成功；**绝不静默写入** |
| `REQ-REVIEW-008` | 回流上限 | 回流轮次计数随项目持久化（可查询第 n/3 轮）；超限返回「接受并记录 / 中止」二选一状态；失败时**部分结果可读** |
| `REQ-REVIEW-009` | 超长 PRD 分块 | 审核出参须包含**被分块的部分清单**（不得静默截断）；分块与结果可对应 |
| `REQ-REVIEW-010` | 指令定界隔离 | PRD 内容与 agent 指令之间用定界符隔离；**PRD 内文字不得改变指令与权限**（接口层不得把 PRD 内容拼进指令位） |
| `REQ-CHAT-001` | 对话发送与流式 | `#25 GET /projects/{id}/chat/messages`（按 `seq` 升序）、`#26 ⚡ POST …/chat/messages`（`≤20000 字符`；SSE `chat.delta` 流式回传）；空内容 → 400；**串行处理**；幂等 |
| `REQ-CHAT-002` | 历史与重发 | `#27 POST /chat/messages/{id}/retry`：**不重复入库**；单条 60s 超时；历史随项目持久化 |
| `REQ-SPLIT-001` | 拆解与 REQ-ID | `#29 GET /projects/{id}/requirements`：5 个角色包 + `REQ-ID` 列表（`q` / 分页）；`REQ-ID` **项目内唯一** |
| `REQ-SPLIT-002` | 自适应深度 | **需在拆解入参/项目配置中表达深度档位**（当前 `接口契约` 无此参数 → `[拆解缺口-Q6]`，请与 PM 确认字段与落点，不要自创） |
| `REQ-SPLIT-003` | 重新拆解 | `#28 ⚡ POST /projects/{id}/splits`：**同一项目同一时刻只允许一个**，重复触发 → **409**；旧 Spec **归档不删** |
| `REQ-SPLIT-004` | 埋点方案（被拆解项目） | `#59 GET /projects/{id}/tracking-plan`：`event_key`（`EVT_<模块>_<动作>`）+ `trigger_desc` + `params` + `element_id` + `status`（`draft→confirmed→implemented→verified`） |
| `REQ-SPEC-001` | Spec 生成 | `#30 ⚡ POST /projects/{id}/specs:generate` → `{succeeded[], failed[{role, error_code}], overall}`，**`overall` 绝不置 `succeeded`**（部分成功）；`#31 GET /specs`、`#32 GET /specs/{id}` |
| `REQ-SPEC-002` | Spec 过期与单份重试 | `SpecDoc.status` 含 `stale`；接口须能对**单份**重触发；超时（5min）置 `failed` 可重试 |
| `REQ-SPEC-003` | 导出需鉴权 | `#33 GET /specs/{id}/export`：**需鉴权**；**不写入访问日志正文**；导出内容**不含密钥与内部凭据** |
| `REQ-SPEC-004` | 追溯矩阵 | 接口须能按 `REQ-ID` 返回四态覆盖与孤儿检测结果（正向 target 列表 + 反向上游 REQ-ID）；**四态状态必须由接口给出，不能只在前端算** |
| `REQ-PROOF-001` | 角色校对 | `#34 POST /projects/{id}/specs/{id}/proofread` → 《补充要求清单》；补不上的条目须带「回流对话」标记 |
| `REQ-UIEDIT-001` | 拖拽与生成 | `#36 POST /pages/{id}/elements`：**id 由服务端集中分配**（客户端只持临时 id）；超 200 → 400；落点非法由前端拦截且服务端亦校验父子合法性 |
| `REQ-UIEDIT-002` | 画布 | `#35 GET /projects/{id}/pages`：页面列表 + `order_index`；画布基准（360dp / 1dp=3px）为**前端渲染约定**，接口不承载 |
| `REQ-UIEDIT-003` | 属性面板 | `#39 PUT /elements/{id}/style`：**全量样式（11 项）**；**服务端二次校验取值域**；失败返回 `INVALID_ARGUMENT` + `data.field` + `received`（字段级定位）；色值只接受 **6 位** `#RRGGBB` |
| `REQ-UIEDIT-004` | 事件面板 | `#40 PUT /elements/{id}/events`：≤3 条；`event_type ∈ {click,long_click,double_click}` **可并存**；`action_type` **默认且本期仅 `none`**（其余枚举位保留、不可选）；`action_payload` 为空 |
| `REQ-UIEDIT-005` | 控件树 | 复用 `#36/#37/#38`（元素树的同级顺序与父子关系）；树与画布**同一份数据**，接口**不得出现第二份元素树** |
| `REQ-UIEDIT-006` | 两态切换 | 切换为**纯前端状态**，不产生接口调用；**切换不得丢草稿**（与 `#42` 一致） |
| `REQ-UIEDIT-007` | 草稿 | `#42 GET/PUT /pages/{id}/draft`：**未提交改动绝不静默丢弃**；会话过期后重新认证仍可取回 |
| `REQ-UIEDIT-008` | 删除控件 | `#38 ⬛ DELETE /elements/{id}`：置 `status=void`；**id 不可回收、不可复用**；`#41 GET /projects/{id}/element-id-ledger`（id 台账，含已作废 id，**可查不可用**） |
| `REQ-UIEDIT-009` | 元素 id 规则 | id 形如 `EL-<模块>-<三位>`；**归一化**（大写零填充）后存储与比较；序号溢出 999 → 扩展四位；`#41` 台账提供全量 id 与状态 |
| `REQ-UIEDIT-010` | 控件面板 | **控件面板为前端本地数据**（37 项原子控件枚举来自 `数据模型 §4`），**不走接口**（`接口契约§0.3` 明确）；`widget_type` 由 `#36` 落库校验 |
| `REQ-GEN-001` | 生成任务 | `#43 ⚡ POST /pages/{id}/generations`：`{input_hash, Idempotency-Key}`；`seq` **单调递增**；冲突：`TASK_STALE` / `IDEMPOTENT_REPLAY` / `RATE_LIMITED`（同项目并发生成 >1） |
| `REQ-GEN-002` | L1 验证 | `#49 GET /tasks/{id}/verifications`：L1 逐规则证据（规则名 / ok / evidence）；**元素 id 与元素树一一对应**（多一个少一个都失败）；L1 通过 → 才能刷新预览 |
| `REQ-GEN-003` | L2 回传 | `#46 POST /tasks/{id}/build-report`：`{passed, log_digest}`；绑定该次生成任务；**未回传 → `reported=false` 标「未验证构建」，不阻断** |
| `REQ-GEN-004` | 验证失败重试 | `#48 POST /tasks/{id}/verifications/{vid}/retry`；**上限 3 次**（`attempt` 字段），超限转「需人工介入」；返回剩余次数供前端显示 |
| `REQ-GEN-005` | 取消生成 | `#44a POST /tasks/{id}/cancel`：任务置 `canceled`；**丢弃本次产物、不写入项目版本**；**非失败态、不计重试**（接口语义上不得复用失败分支） |
| `REQ-GEN-006` | 序号与旧响应 | 所有任务/结果出参须带 `seq`；服务端**拒绝应用旧序号**（`TASK_STALE`）；前端只应用最新 |
| `REQ-GEN-007` | SSE 与降级 | `#45 GET /projects/{id}/tasks/stream`：`event: task` / `chat.delta` / `ping`(15s)；`Content-Type: text/event-stream` + `Cache-Control: no-cache`；**降级为 2s 轮询时界面无差别**（需保证 `GET /tasks/{id}` 出参足以驱动同一套 UI） |
| `REQ-GEN-008` | 超时与双路径 | 统一 **5min** 上限 → `timeout`（可重试）；**`GenTask.status=failed` 与 `VerifyTask.status=failed` 是两条独立路径**，错误码与文案必须可区分 |
| `REQ-GEN-009` | 产物形态 | `#47 GET /tasks/{id}/artifacts`：源码 + `gradle wrapper` + **依赖版本锁定清单**；**不得**返回"平台构建结果/构建产物 apk" |
| `REQ-GEN-010` | 外部依赖降级 | 大模型 / 飞书 60s 超时 + 退避 2 次；失败 → `UPSTREAM_TIMEOUT`(504) / `UPSTREAM_UNAVAILABLE`(503)；**绝不静默成功** |
| `REQ-PREVIEW-001` | 预览刷新时机 | 预览数据来源 = `#47 artifacts` + SSE `task` 的 `seq`；**只在 L1 `passed` 后提供可渲染结果**（接口不得在 L1 未过时返回"已就绪"） |
| `REQ-PREVIEW-002` | 预览各态 | 接口须让前端**可区分**：生成中（`running`+`progress`）/ 验证中（`VerifyTask.running`）/ 生成失败（`GenTask.failed`）/ 验证失败（`VerifyTask.failed`）/ 加载失败（前端资源态）/ L2 未回传（`l2_result.reported=false`） |
| `REQ-PREVIEW-003` | 近似渲染 | **纯前端渲染能力**，无接口；但接口须提供差异清单展示所需的**静态说明数据**（可由前端内置常量承载，接口可不出） |
| `REQ-PREVIEW-004` | 溯源 | 预览出参带 `seq` 与 `finished_at`（UTC）；**时间缺失返回 `null`**（不得返回 `0`/`1970`），由前端显示「未知」 |
| `REQ-API-001` | 接口定义管理 | `#50 GET/POST /projects/{id}/apis`、`#51 GET/PATCH /apis/{id}`（须 `If-Match`）、`#53 PUT /apis/{id}/schema`：`field_type` 为**完整 8 项枚举**、含 `length`/`precision`/`unit`；`code` 项目内唯一 |
| `REQ-API-002` | 项目级版本 | `#54 GET /projects/{id}/versions`（`seq` 倒序，`current` 唯一）、`#55 POST`（整包快照）、`#56 GET /versions/{id}/diff`（接口 **字段级**、Spec **文档级**） |
| `REQ-API-003` | 删除接口 | `#52 ⬛ DELETE /apis/{id}`：删除在**下次生成版本后生效**；引用它的 Spec 标「需复核」（接口须返回影响范围） |
| `REQ-CAP-001` | 能力配置 | `#58 GET/PUT /projects/{id}/capabilities`：**固定 7 行**、`enabled` 默认 `false`；**保存即生成**（`code_status`）；`PUT` 前**自动备份旧代码**；冲突**以配置为准** |
| `REQ-CAP-002` | 部分失败 | `code_status ∈ {not_generated, generated, partial, failed}` 逐项返回；**整体不得返回成功**（`partial` 必须可辨识） |
| `REQ-CAP-003` | 取消勾选 | 语义 = **仅移除配置**（`enabled=false`），`code_status` 保留 + 注释标记；接口**不得删除已生成代码** |
| `REQ-CAP-004` | 密钥不采集 | `CapabilityConfig.note` 仅承载**占位说明**；**接口不出参、不接收、日志不记录任何真实 key** |
| `REQ-CAP-005` | 依赖冲突 | 保存时若两能力要求同一库不同版本 → 报错并**指明冲突项**（返回冲突库名 + 两个版本号） |
| `REQ-NF-001` | 耗时指标 | 各 `⚡` 任务出参须带 `started_at`/`finished_at`/耗时，使 **L1 可度量（P95 ≤ 90s）**、**L2 仅记录**（`l2_result` 单独字段，不进平台指标） |
| `REQ-NF-002` | 可用性底线 | 接口层需保证：非法输入返回字段级定位（供前端保留已输入）、状态不只靠颜色所需的状态码（如 `canceled` 与 `failed` 必须可区分） |
| `REQ-NF-003` | 乐观锁 | `#4`/`#9`/`#37`/`#51` 等 `PATCH` 须带 `If-Match`；冲突 409 `VERSION_CONFLICT` + **diff 视图所需数据**（`REQ-NF-003`）｜`[拆解缺口-Q13]`：`#39` / `#58` 等未标 `If-Match`，需与 PM 确认是否补 |
| `REQ-NF-004` | 分页排序 | 全站统一（见 §1）；`q` 匹配字段：项目 → `name`；接口 → `code`/`name`/`path`；待澄清 → `title`；Spec → `role`/标题；**控件面板 → 本地筛选不走接口** |
| `REQ-NF-005` | 时间与"未知" | 时间一律 UTC ISO-8601；**`null` = 未知、`0` = 零、`n/a` = 不适用**；**禁止用 `0` 或 `1970-01-01` 表示未知时间** |
| `REQ-NF-006` | 幂等 | 新建项目 / 上传 / 发送消息 / 提交生成 / 提交审核：`Idempotency-Key`，**3s 内一次副作用**；重放返回首次结果 + `IDEMPOTENT_REPLAY` |
| `REQ-NF-007` | 原子性 | 代码文件**原子落盘**；回滚**多步写入要么全成要么全不成**（失败时数据不变，返回可重试） |
| `REQ-NF-008` | API 版本与响应包 | `/api/v1/` 前缀 + 统一响应包 + 错误码表；**新增字段容忍**（App 侧按 `REQ-NF-008` 兜底） |
| `REQ-AUTH-001` | 登录与 401 | 飞书扫码登录链路；未登录 / 会话过期 → **401 `UNAUTHENTICATED`**；鉴权头 `Bearer <token>`；`user_id` = `open_id` |
| `REQ-AUTH-002` | 权限矩阵与 403 | 两角色（`requester` / `admin`）；**每一次读写都做逐对象鉴权**（**含列表、搜索、导出**）；越权 **403 且不泄露对象是否存在**（`FORBIDDEN` 的 message 不得区分"不存在"与"无权限"） |
| `REQ-AUTH-003` | 权限撤销生效 | 权限变更 ≤5min 生效（token/缓存策略须支持） |
| `REQ-AUTH-004` | ★ 外发大模型告知与开关 | 需提供：① **告知确认状态**（`首次上传前`/`首次生成前` 是否已确认）；② **用户级开关**（读取 + 修改）；③ 开关关闭后**生成类接口返回明确的不可用原因**（**不得静默降级**，不得返回 200 假装在跑） |
| `REQ-AUTH-005` | 脱敏与密钥 | PRD 正文与生成代码**不入日志、不入 URL**；`request_id` 不含内容；**不向前端下发任何密钥** |
| `REQ-AUTH-006` | 项目隔离 | 知识库检索、缓存键、日志、文件路径**均带 `project_id`**；跨项目检索**不可能发生**（接口层强制过滤，非前端过滤） |
| `REQ-AUTH-007` | 增强策略不做 | 接口**不得提供**防截屏/水印/防篡改/防泄露相关能力 |
| `REQ-AUTH-008` | 个人数据〔推断〕 | 只存 `open_id`、昵称、头像 URL、操作日志；注销即删；项目删除 30 天后物理清除 ｜`[来源: 推断，待确认]` |
| `REQ-DELIVER-001` | 交付归档 | `#60 GET /projects/{id}/deliverables`、`#61 POST …/deliverables/export`（**需鉴权**）；出参含 Spec 包 + 安卓工程（源码 + `gradle wrapper` + 依赖锁定清单）+ 版本号 |
| `REQ-DELIVER-002` | 版本归档页 | 复用 `#54`/`#56`；时间线所需字段（版本号/时间/操作人/变更摘要/产物清单）须齐全 |
| `REQ-DELIVER-003` | 整包回滚 | `#57 ⬛ POST /versions/{id}/rollback`：回滚**全部受版本管理产物**；**多步写入要么全成要么全不成**；**快照只读保留**；二次确认由前端 + **服务端亦校验** |
| `REQ-DELIVER-004` | 回环归档不删 | 回环前 Spec 与代码**归档为历史版本保留**（`ProjectVersion.status` 用 `archived`，**不物理删除**） |
| `REQ-TRACK-001` | 平台自身埋点（漏斗） | `#62 POST /metrics/events`（**批量**上报）；9 个漏斗节点的完成信号须可由平台侧事件或接口出参确定 |
| `REQ-TRACK-002` | 生成成功/失败与耗时 | `#62` 事件须能携带生成结果与耗时；耗时口径**与 `REQ-NF-001` 一致**（L1 计入、L2 仅记录） |
| `REQ-TRACK-003` | 上报降级 | 上报**失败静默重试、不阻塞业务**；上报体**不含 PRD 正文与生成代码** |

---

| `REQ-INTAKE-001` | 接入已有工程 | `#73 POST /projects/{id}/engineering-intake`：入参 `{root: 绝对路径, confirm: true}`；**只读**扫描本机工程根目录；`confirm≠true` / 非绝对路径 / 目录不存在 / 非 Android 工程 → 400 `INVALID_ARGUMENT`（message 可直接展示）；**提交类 → 幂等**（`REQ-NF-006`）；出参 `{source_kind:"imported", engineering_root, kb_doc_id, project_name, android{agp,kotlin,gradle,compile_sdk,min_sdk,target_sdk,java}, counts{}, warnings[]}` |
| `REQ-INTAKE-002` | 工程约束 | `#74 GET /projects/{id}/constraints` → `{source_kind, engineering_root, pack{}, kb_doc_id, content_md, origin, version, updated_at, summary}`；未接入 → 404。`#75 PUT /projects/{id}/constraints`：`{content_md}`，`origin→user_edited`，**须 `If-Match`**，冲突 409。`#7` 的 `sector` 扩容值 **`constraints`**；`#1` 列表项 / `#3` 详情增 **`source_kind`**（+ 详情 `engineering_root`） |
| `REQ-INTAKE-003` | 约束注入与工程一致性 | **不新增接口**：约束摘要注入 `#16`（审核）/ `#28`（拆解）/ `#30`（Spec 生成）三处提示词；门禁标准新增 **J 组**（`J1`/`J2`，**仅严格档 `strict` 运行**）—— `#24` 项目级门禁标准 `items[]` 可含 `group:"J"`；冲突**以工程约束为准**、列为待澄清 |
## 3 《UI 数据供给对照表》的要求（本 Spec 最核心一节，**零缺口**）

- 表结构（逐条必填，`是否满足` 列**无空白**）：`EL-ID | UI 元素 | 需要的数据 | 格式要求(精度/单位/时间格式) | 来源接口 | 来源字段 | 是否满足 | 不满足时的处理`。
- 每一项 UI 要展示的数据都要能追到某个接口字段，或**明确说明为何不需要接口**（本地推导 / 静态配置），例：
  - 画布基准 360dp、1dp=3px → **本地渲染常量，无需接口**（`REQ-UIEDIT-002`）；
  - 控件面板 37 项枚举 → **本地数据 + 服务端校验**（`REQ-UIEDIT-010`）；
  - 近似预览差异清单 → **前端静态说明数据**（`REQ-PREVIEW-003`）。
- 已知**需要你与 UI / PM 确认后**才能闭合的两处：项目卡片「元素 id 前缀示例」`[拆解缺口-Q5]`、属性面板「11 项」计数口径 `[拆解缺口-Q2]`。

---

## 4 接口层的边界清单（写 Spec 时必须逐条表态）

| # | 边界 | 要求 |
|---|---|---|
| 1 | 列表为空 vs 筛掉 | 同一接口两种态必须可区分（`total=0` + `q`/筛选条件是否为空） |
| 2 | 部分来源失败 | `failed_parts[]` + `total` 只计成功部分 + 前端"部分加载"标记 |
| 3 | `page` 超总页数 | 空 `items` + 真实 `total`，**不报错** |
| 4 | 未知 vs 零 vs 不适用 | `null` / `0` / `n/a` 三者可区分，**禁止用 `0`/`1970` 表示未知时间** |
| 5 | 重复提交 | 幂等键 + `IDEMPOTENT_REPLAY` 返回**首次结果** |
| 6 | 并发编辑 | 乐观锁 + `VERSION_CONFLICT` + diff；**不静默覆盖** |
| 7 | 旧结果后到 | 单调 `seq` + `TASK_STALE`；前端只应用最新 |
| 8 | 取消 vs 失败 | `canceled` 与 `failed` 是**两个状态、两套文案、两种重试语义**（取消不计重试、不入版本） |
| 9 | 生成失败 vs 验证失败 | 两条独立路径，错误码与文案可区分 |
| 10 | 上游不可用 | 60s 超时 + 退避 2 次 + 可重试失败态，**绝不静默成功/静默写入** |
| 11 | 越权 | 403 且**不泄露对象是否存在**（含列表、搜索、导出） |
| 12 | 密钥 | 不出参、不入日志、不下发前端 |
| 13 | 长任务降级 | SSE 不可用 → 2s 轮询，**界面无差别**（`GET /tasks/{id}` 出参必须自足） |
| 14 | 破坏性操作 | `⬛` 接口服务端**亦须校验**，不能只靠前端确认弹窗 |

---

## 5 待澄清（**不自行裁决**）

| 编号 | 问题 | 证据位置 |
|---|---|---|
| `[拆解缺口-Q9]` | `接口契约.md` §1 表头写「共 **62** 个接口（编号 1~62）」，同文件 §3 写「现为 **63** 个（新增 `#44a`）」，`README` 与第 4 轮报告写 63 → **计数口径需统一** | `接口契约 §1` vs `§3`；`README §2`；`第 4 轮报告 §7.1` |
| `[拆解缺口-Q13]` | `D-Q14` 说乐观锁对"画布 / 接口管理页 / 能力配置"通用，但 `#39 PUT /elements/{id}/style`、`#58 PUT /capabilities` 等**未标注 `If-Match`** | `接口契约§0.1` vs `#39`/`#58` |
| `[拆解缺口-Q6]` | 自适应深度（Minimal/Standard/Comprehensive）**无入参、无字段落点** | `§F6` vs `接口契约 #28`、`数据模型 Project/ReviewReport` |
| `[拆解缺口-Q3]` | 门禁标准归属：`Project ||--|| GateStandard`（项目级）vs 管理员全局维护 vs `E21` 无 `project_id` | `数据模型 §1.2/E21`；`§F3`；`§9 补充块①` |
| `[拆解缺口-Q7]` | 平台自身埋点（`D-Q21`）**无实体承载**（`E12 TrackPlan` 是**被开发项目**的埋点方案）；且事件命名被归到「S4 定义」而 Spec 在 S5 产出 | `§9 补充块⑦`；`接口契约 #62`；`数据模型 §1.1` |
| `[拆解缺口-Q5]` | 项目卡片「元素 id 前缀示例」无接口来源 | `页面规格§1.1` vs `接口契约§2` |
| `[拆解缺口-Q2]` | 属性面板「11 项」计数口径（11 行 / 12 名称 / 13 字段） | `§F14`；`§8`；`数据模型 E7` |

> 全部 13 条见 `platform/requirements/拆解期发现的问题.md`。
