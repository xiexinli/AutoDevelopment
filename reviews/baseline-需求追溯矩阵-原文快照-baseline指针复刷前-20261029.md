# 需求追溯矩阵（RTM）

> **文件定位**：`REQ → 五角色产物` 的正向覆盖 + 反向孤儿检测的唯一台账。
> **来源 PRD**：`platform/平台需求概要.md` v1.4（第 4 轮回写后 · 门禁阻断 0 / 重要 0 / 建议 0 / 未收敛角落 0）
> **上游**：`platform/requirements/需求条目表.md`（95 条 REQ）｜ **骨架**：`platform/requirements/需求追溯矩阵-骨架.md`
> **回填来源**：五份角色 Spec 各自的追溯表（`UI-Spec §9` / `接口-Spec §10` / `App-Spec §11` / `埋点-Spec §9` / `测试-Spec §12`，**REQ 集合一致、各 95 行**；本表按 `需求条目表.md` 统一排序）
> **同步修订：B9-20261026** ｜ **日期**：2026-10-26 ｜ **状态**：已回填文档增量；本轮仅静态自查，待主 Agent 独立校对/实机验收（原正式基线来源保持）
>
> ⚠️ **本轮（2026-10-21 本机落地）的口径边界**：新增的 **4 个接口**（`#71`/`#71a`/`#72`/`#72a`）、**7 个元素**、**2 个事件**、**26 条用例**均属
> **本机开发阶段扩展 —— 未过门禁、未进入第 4 轮基线冻结范围**（第 4 轮冻结基线仍记 **71 接口 / 412 元素 / 52 事件 / 554 用例**）。
> 其中 `#72`（本地账号密码登录）为**阶段性方案**，**生产必须 `AD_PASSWORD_LOGIN=disabled`** 并改用企业自建应用扫码或已有账号体系。
> 本表已按**扩展后**口径登记（82 / **450** / 59 / 632；B9正文与状态控件 EL-REVIEW-055~062 +8；`EL-*` 于 2026-10-23 由 424 → 425 = 审核页新增 `EL-REVIEW-052`，2026-10-26 由 425 → 426 = 审核页新增未通过项补充信息 `EL-REVIEW-053`、426 → 427 = 审核流程优化新增 `EL-REVIEW-054`），差异是**有意保留**的，不是漏改。

## 覆盖状态四态（不许用 ✅/⬜，不许留空）

| 状态 | 含义 | 要求 |
|---|---|---|
| `OK` | 已覆盖 | 必须写出 target（具体 ID） |
| `GAP` | 有缺口 | 必须暴露，不允许隐藏 |
| `N/A` | 不适用 | 必须写出理由（本表在各角色列以 `N/A` 表示，理由见 §四 与各 Spec 追溯表） |
| `Deferred` | 延后 | 必须注明由哪个后续阶段/版本覆盖 |

> **本表「覆盖状态」列的汇总口径**（机核，逐行可复算）：
> 取五列「最严重」状态，严重度序 **`GAP` > `Deferred` > `OK`**；`N/A` **计入覆盖**（等同 `OK` 参与汇总，但不掩盖它是不适用）。
> 即：任一列 `GAP` → 汇总 `GAP`；否则任一列 `Deferred` → `Deferred`；否则 `OK`。**不允许留空**。

---

## 一、正向：需求 → 角色条目（**95 行**）

| REQ-ID | 需求摘要 | 优先级 | UI页面ID | 接口ID | App页面/路由 | 埋点事件 | 测试用例ID | 覆盖状态 |
|---|---|---|---|---|---|---|---|---|
| `REQ-PROJ-001` | 新建项目（名称规则/重名/幂等） | P0 | `UI-PROJ-001` | `#2` | `RT-PROJ-001` | `EVT_proj_create_click`、`EVT_proj_create_success`、`EVT_proj_create_blocked` | `TC-PROJ-006`~`012` ｜ `TC-PROJ-101`/`107`/`110` ｜ `TC-PROJ-201`~`206` ｜ `TC-E2E-001` | OK |
| `REQ-PROJ-002` | 项目列表（分页/排序/搜索；空态 vs 无匹配） | P0 | `UI-PROJ-001` | `#1`、`#3`（项目详情） | `RT-PROJ-001` | `EVT_proj_open_workbench` | `TC-PROJ-001`~`005`/`013`/`014` ｜ `TC-PROJ-101`~`104` ｜ `TC-PROJ-207`/`208` | OK |
| `REQ-PROJ-003` | 项目重命名 | P1 | `UI-PROJ-001` | `#4` | `RT-PROJ-001` | N/A | `TC-PROJ-016`~`018` ｜ 埋点 `N/A`（§3.12） | OK |
| `REQ-PROJ-004` | 项目删除（逻辑删除 30 天） | P0 | `UI-PROJ-001` | `#5` | `RT-PROJ-001` | `EVT_proj_deleted` | `TC-PROJ-019`~`021`、`TC-PROJ-025` ｜ `TC-PROJ-108` ｜ `TC-PROJ-209`/`210` | OK |
| `REQ-PROJ-005` | 工作台顶部状态条 | P1 | `UI-WORK-001` | `#6` | `RT-WORK-001` | `EVT_proj_open_workbench`（`stage` 参数） | `TC-PROJ-022`/`023`/`024` ｜ `TC-WORK-101`/`112` ｜ `TC-PROJ-207` | OK |
| `REQ-KB-001` | 知识库当前正文与源文件只读区分 | P0 | UI-KB-001、UI-REVIEW-001（EL055~059） | #7/#8/#9/#17/#23 | RT-KB-001、RT-REVIEW-001（?sector=prd&doc深链） | N/A（浏览/深链不新增事件） | TC-KB-001/002/004~007、TC-KB-101/103/104/107、TC-REVIEW-007/101/023、TC-E2E-004 | OK |
| `REQ-KB-002` | 知识库入口（两处）+ 三态 + 403 | P1 | `UI-PROJ-001`、`UI-WORK-001`、`UI-KB-001` | `#7` + 403 | `RT-PROJ-001`、`RT-WORK-001`、`RT-KB-001` | `EVT_auth_forbidden`（`resource=kb_doc`） | `TC-KB-003` ｜ `TC-KB-101`/`103`/`105`/`108` ｜ `TC-PROJ-109` | OK |
| `REQ-UPLOAD-001` | 上传 PRD 并解析（含飞书链接） | P0 | `UI-UPLOAD-001` | `#10`、`#11`、`#12` | `RT-UPLOAD-001` | `EVT_upload_entry_click`、`EVT_upload_start`、`EVT_upload_parse_terminal` | `TC-UPLOAD-001`~`007`/`010` ｜ `TC-UPLOAD-101`/`102`/`108`/`109` ｜ `TC-UPLOAD-201`~`204`/`207`/`208` ｜ `TC-E2E-002` | OK |
| `REQ-UPLOAD-002` | 规格校验与拒绝（≤20MB/≤100 页/格式） | P0 | `UI-UPLOAD-001` | `#10` | `RT-UPLOAD-001` | `EVT_upload_rejected` | `TC-UPLOAD-002`/`003` ｜ `TC-UPLOAD-104`/`106` ｜ `TC-UPLOAD-205`/`206` | OK |
| `REQ-UPLOAD-003` | 部分解析失败不阻断 + 手动补充 | P0 | `UI-UPLOAD-001` | `#14`、`#15` | `RT-UPLOAD-001` | `EVT_upload_parse_terminal`（`partial`）、`EVT_upload_part_manual_supplement` | `TC-UPLOAD-016`~`022` ｜ `TC-UPLOAD-107` ｜ `TC-UPLOAD-209`/`210` | OK |
| `REQ-UPLOAD-004` | 空文档与解析失败区分 | P1 | `UI-UPLOAD-001` | `#14` | `RT-UPLOAD-001` | `EVT_upload_parse_terminal`（`empty_document`） | `TC-UPLOAD-018` ｜ `TC-UPLOAD-103` ｜ `TC-UPLOAD-207`（`empty_document` 参数） | OK |
| `REQ-UPLOAD-005` | revision 不覆盖 | P1 | `UI-UPLOAD-001`、`UI-KB-001` | `#13`、`#12` | `RT-UPLOAD-001`、`RT-KB-001` | `EVT_upload_parse_terminal`（`revision_id`） | `TC-UPLOAD-011`/`013`/`015` ｜ `TC-UPLOAD-108` | OK |
| `REQ-UPLOAD-006` | 解析进度与超时反馈 | P1 | `UI-UPLOAD-001` | `#12`、`#44`、`#45` | `RT-UPLOAD-001` | `EVT_upload_parse_terminal`（`duration_ms`、`error_code`） | `TC-UPLOAD-012` ｜ `TC-UPLOAD-102` ｜ `TC-UPLOAD-207`（`duration_ms`） | OK |
| `REQ-REVIEW-001` | 门禁审核与评分卡（证据/绑定 revision/过期） | P0 | `UI-REVIEW-001` | `#16`、`#17`、`#18`、`#69`（导出审核报告）、**`#71`/`#71a`**（模型清单与选择，**派生**） | `RT-REVIEW-001` | `EVT_review_submit`、`EVT_review_verdict`、**`EVT_llm_model_switch`**〔2026-10-21〕 | `TC-REVIEW-001`/`005`/`006`/`008`~`011` ｜ `TC-REVIEW-101`/`102`/`107` ｜ `TC-REVIEW-201`/`202`/`205`/`206` ｜ `TC-DRAFT-015`（`#69` 导出）｜ **`TC-REVIEW-030`~`038`**〔`#71`/`#71a`〕｜ **`TC-TRACK-221`/`222`**〔`EVT_llm_model_switch`〕｜ `TC-E2E-003`/`TC-E2E-004` | OK |
| `REQ-REVIEW-002` | 回写PRD（原子答复/补充/快照/正文核验） | P0 | `UI-REVIEW-001`（EL053、055~062） | #23、#8、#17（回读/身份） | RT-REVIEW-001 | EVT_review_writeback（核验后） | TC-REVIEW-023/024/025/101/106/108/109、TC-REVIEW-207/208、TC-E2E-004；新持久化脚本03~10映射见测试-Spec | OK |
| `REQ-REVIEW-003` | 待澄清规范化作答与复审disabled | P0 | UI-REVIEW-001（EL022/026/060） | #19/#20/#23，#16 force兜底 | RT-REVIEW-001 | EVT_review_submit_blocked（定义保留，当前可达埋码点待补） | TC-REVIEW-002/012/014~017/103/108/112/203/204、TC-REVIEW-023/024、TC-E2E-004；脚本01~04 | OK |
| `REQ-REVIEW-004` | 假设Accept/Convert（归档保答、unset拒绝） | P1 | UI-REVIEW-001（EL025+复用022） | #21/#19/#20/#23，#16 force兜底 | RT-REVIEW-001 | EVT_edit_submit_blocked（assumption_unset，其他阶段）；审核选择/答复本身不埋 | TC-REVIEW-018~020/024/108/109、TC-UIEDIT-207、TC-E2E-004；脚本01/02/04 | OK |
| `REQ-REVIEW-005` | 门禁标准维护与版本号 | P1 | `UI-REVIEW-001`（抽屉） | `#24`（**项目级**路径） | `RT-REVIEW-001`（抽屉 `?drawer=gate-standard`） | `EVT_review_standard_saved` | `TC-REVIEW-026`~`029` ｜ `TC-REVIEW-110` ｜ `TC-REVIEW-209`/`210` | OK |
| `REQ-REVIEW-006` | 一键采纳 = 仅批量勾选 | P1 | `UI-REVIEW-001` | `#22` | `RT-REVIEW-001` | `EVT_review_writeback`（`accepted_items_count`） | `TC-REVIEW-021`/`022` ｜ `TC-REVIEW-109` ｜ `TC-REVIEW-207` | OK |
| `REQ-REVIEW-007` | agent 输出校验与降级 | P1 | N/A | 全部 agent 产出接口 | `RT-REVIEW-001` | `EVT_review_verdict`（`malformed`） | `TC-REVIEW-104` ｜ `TC-REVIEW-205`/`206`（`malformed`） | OK |
| `REQ-REVIEW-008` | 回流上限 3 轮与超限升级 | P1 | `UI-REVIEW-001`、`UI-WORK-001` | `#6` → `loopback_round`；超限「中止」→ `#70` | `RT-REVIEW-001`、`RT-WORK-001` | `EVT_review_loopback_exceeded` | `TC-REVIEW-007`/`011` ｜ `TC-REVIEW-211`/`212` ｜ `TC-DRAFT-016`（`#70` 中止） | OK |
| `REQ-REVIEW-009` | 超长 PRD 分块不截断 | P2 | N/A | `#16`、`#14` | `RT-REVIEW-001` | N/A | 接口层：`#16` 出参「被分块部分清单」（`TC-REVIEW-001` 附断言）｜ 埋点 `N/A` | OK |
| `REQ-REVIEW-010` | 指令定界隔离（注入防护） | P2 | N/A | `#16`（接口层） | `RT-REVIEW-001`（App 侧） | N/A | 注入测试：PRD 含「忽略以上指令」类文本 → `TC-REVIEW-001` 附断言 + `TC-CHAT-008` | OK |
| `REQ-CHAT-001` | 对话发送与流式回复 | P0 | `UI-WORK-001` | `#25`、`#26`、`#45`（`chat.delta`） | `RT-WORK-001` | `EVT_chat_send_success`、`EVT_chat_send_blocked` | `TC-CHAT-001`~`008` ｜ `TC-WORK-103`/`104`/`107`/`108` ｜ `TC-CHAT-201`~`204` ｜ `TC-E2E-004` | OK |
| `REQ-CHAT-002` | 对话历史持久化与失败重发 | P1 | N/A | `#27`、`#25` | `RT-WORK-001` | `EVT_chat_reply_terminal`、`EVT_chat_resend` | `TC-CHAT-009`/`010` ｜ `TC-WORK-103`/`104` ｜ `TC-CHAT-205`~`208` | OK |
| `REQ-SPLIT-001` | 拆解与 REQ-ID 统一编号 | P0 | `UI-SPLIT-001` | `#29` | `RT-SPLIT-001` | `EVT_split_start`、`EVT_split_done`、`EVT_split_failed` | `TC-SPLIT-001`/`004`~`007` ｜ `TC-SPLIT-101`~`104` ｜ `TC-SPLIT-201`~`206` ｜ `TC-E2E-005` | OK |
| `REQ-SPLIT-002` | 自适应深度三档 | P1 | `UI-SPLIT-001` | `#28` / `#16` → 可选入参 `depth`（项目级 `E1.depth` 可覆盖） | `RT-SPLIT-001` | `EVT_split_start` / `EVT_split_done`（`depth_ui`） | `TC-SPLIT-003`（**改判正向**：`depth` 入参）｜ `TC-SPLIT-108`、`TC-REVIEW-003` | OK |
| `REQ-SPLIT-003` | 重新拆解（破坏性/单飞） | P1 | `UI-SPLIT-001` | `#28` | `RT-SPLIT-001` | `EVT_split_start`（`trigger=re_split`） | `TC-SPLIT-001`/`002` ｜ `TC-SPLIT-107` ｜ `TC-SPLIT-201`/`202` | OK |
| `REQ-SPLIT-004` | 被拆解项目的埋点方案（TrackPlan） | P0 | `UI-SPLIT-001` | `#59` | `RT-SPLIT-001` | 附节 B 的 `TrackPlan` 规范 | `TC-TRACK-001`~`004` ｜ `TC-SPLIT-110` ｜ `TC-E2E-005`/`TC-E2E-008` ｜ `TC-SPLIT-301` ｜ `TC-GEN-358` | OK |
| `REQ-SPEC-001` | 五角色 Spec 生成（串行/部分成功） | P0 | `UI-SPEC-001` | `#30`、`#31`、`#32` | `RT-SPEC-001` | `EVT_spec_gen_done` | `TC-SPEC-001`~`005`/`008`~`010` ｜ `TC-SPEC-101`/`103`/`104` ｜ `TC-SPEC-201`/`202` ｜ `TC-E2E-006` | OK |
| `REQ-SPEC-002` | Spec 过期与单份重试 | P1 | `UI-SPEC-001` | `#30`、`#31` | `RT-SPEC-001` | `EVT_spec_gen_done`（`duration_ms_by_role`） | `TC-SPEC-006` ｜ `TC-SPEC-102`/`108` ｜ `TC-SPEC-201` | OK |
| `REQ-SPEC-003` | Spec 导出（需鉴权/不含密钥） | P1 | `UI-SPEC-001` | `#33` | `RT-SPEC-001`、`RT-VER-001` | `EVT_spec_export`、`EVT_auth_forbidden`（`resource=spec_export`） | `TC-SPEC-011`~`013` ｜ `TC-SPEC-107` ｜ `TC-SPEC-203`/`204` | OK |
| `REQ-SPEC-004` | 需求追溯矩阵（覆盖率 + 孤儿检测） | P1 | `UI-SPEC-001`、`UI-SPLIT-001` | `#67` | `RT-SPEC-001`、`RT-SPLIT-001`（`?drawer=trace`） | N/A | `TC-DRAFT-005`/`010`/`014` ｜ `TC-SPLIT-109`、`TC-SPEC-109` | OK |
| `REQ-PROOF-001` | 角色校对与《补充要求清单》 | P1 | `UI-SPEC-001` | `#34` | `RT-SPEC-001` | N/A | `TC-SPEC-014`/`015` ｜ `TC-SPEC-110` | OK |
| `REQ-UIEDIT-001` | 拖拽控件入画布（吸附/拒收/200 上限） | P0 | `UI-EDIT-001` | `#36` | `RT-EDIT-001` | `EVT_edit_drop_rejected`、`EVT_edit_submit_blocked`、`EVT_edit_submit_success` | `TC-UIEDIT-003`~`007` ｜ `TC-UIEDIT-101`/`107`/`108`/`117` ｜ `TC-UIEDIT-201`/`202`/`207`~`210` ｜ `TC-E2E-007` | OK |
| `REQ-UIEDIT-002` | 手机样式画布（360dp/三重选中表达） | P0 | `UI-EDIT-001` | `#35` | `RT-EDIT-001` | N/A | `TC-UIEDIT-001` ｜ `TC-UIEDIT-101`/`102`/`119` ｜ `TC-UIEDIT-304` | OK |
| `REQ-UIEDIT-003` | 属性面板 11 项（取值域/校验/即时可见） | P0 | `UI-EDIT-001` | `#39` | `RT-EDIT-001` | N/A | `TC-UIEDIT-013`~`016` ｜ `TC-UIEDIT-109`/`110` ｜ `TC-E2E-007` | OK |
| `REQ-UIEDIT-004` | 事件面板 3 项（并存/300ms/仅空存根） | P0 | `UI-EDIT-001` | `#40`〔契约接口；**前端实际经 `#42` 草稿保存落库**，埋点 `EVT_edit_event_config` 亦挂 `#42`，见 `埋点-Spec §11 v0.1.4`〕 | `RT-EDIT-001` | `EVT_edit_event_config` | `TC-UIEDIT-017`~`019` ｜ `TC-UIEDIT-111`/`112` ｜ `TC-UIEDIT-203`/`204`/`303` | OK |
| `REQ-UIEDIT-005` | 控件树（双向选中/跨层级/无孤儿） | P1 | `UI-EDIT-001` | `#36`、`#37`、`#38` | `RT-EDIT-001` | N/A | `TC-UIEDIT-008`/`009` ｜ `TC-UIEDIT-103`/`113` | OK |
| `REQ-UIEDIT-006` | 编辑态/预览态两态切换 | P0 | `UI-WORK-001`、`UI-EDIT-001`、`UI-PREVIEW-001` | N/A | `RT-EDIT-001`、`RT-PREVIEW-001`、`RT-WORK-001` | N/A | `TC-UIEDIT-022` ｜ `TC-WORK-109` | OK |
| `REQ-UIEDIT-007` | 画布草稿自动保存与恢复 | P1 | `UI-EDIT-001`、`UI-WORK-001` | `#42` | `RT-EDIT-001`、`RT-WORK-001` | `EVT_auth_session_expired`（`had_draft`） | `TC-UIEDIT-022`/`023` ｜ `TC-UIEDIT-116` ｜ `TC-AUTH-107` | OK |
| `REQ-UIEDIT-008` | 删除控件（二次确认/id 作废/台账） | P1 | `UI-EDIT-001` | `#38`、`#41` | `RT-EDIT-001` | `EVT_edit_element_voided` | `TC-UIEDIT-010`~`012`/`020` ｜ `TC-UIEDIT-114` ｜ `TC-UIEDIT-205`/`206`/`301`/`302` | OK |
| `REQ-UIEDIT-009` | 元素 id 规则与分配 | P1 | `UI-EDIT-001` + **全部含 `EL-*` 的页面** | `#36`、`#41` | `RT-EDIT-001` + **全部含 `EL-*` 的页面** | 全部带 `element_id` 的事件（**参数级约束**） | `TC-UIEDIT-003`/`020` ｜ `TC-UIEDIT-115` ｜ `TC-UIEDIT-206`/`304` | OK |
| `REQ-UIEDIT-010` | 控件面板（37 项原子控件 + 本地搜索） | P0 | `UI-EDIT-001` | N/A | `RT-EDIT-001` | N/A | `TC-UIEDIT-005` ｜ `TC-UIEDIT-120` | OK |
| `REQ-GEN-001` | 提交变更 → AI 生成安卓代码（幂等/原子落盘） | P0 | `UI-EDIT-001` | `#43` | `RT-EDIT-001` | `EVT_edit_submit_success`、`EVT_gen_task_enqueued`、`EVT_gen_task_terminal` | `TC-GEN-001`~`005` ｜ `TC-UIEDIT-117` ｜ `TC-UIEDIT-209`/`210`、`TC-GEN-201`、`TC-E2E-007` | OK |
| `REQ-GEN-002` | L1 静态验证五规则（通过才刷新预览） | P0 | N/A | `#49` | `RT-PREVIEW-001`、`RT-EDIT-001` | `EVT_verify_failed`（`failed_rules`） | `TC-GEN-017`/`018`/`022` ｜ `TC-GEN-307` ｜ `TC-PREVIEW-201`/`202` | OK |
| `REQ-GEN-003` | L2 本地构建代理回传（未回传不阻断） | P1 | N/A | `#46` | `RT-PREVIEW-001`、`RT-EDIT-001`、`RT-VER-001` | `EVT_l2_reported` | `TC-GEN-008`/`015`/`016` ｜ `TC-DELIVER-111`、`TC-PREVIEW-112` ｜ `TC-PREVIEW-205`/`206`/`TC-GEN-309` | OK |
| `REQ-GEN-004` | 验证失败重试（上限 3 → 需人工介入） | P0 | `UI-PREVIEW-001`、`UI-EDIT-001` | `#48`、`#49` | `RT-PREVIEW-001`、`RT-EDIT-001` | `EVT_verify_failed`（`attempt`） | `TC-GEN-020`/`021`/`022` ｜ `TC-GEN-308` ｜ `TC-PREVIEW-201`/`202` | OK |
| `REQ-GEN-005` | 生成任务取消（丢弃产物/不入版本） | P0 | `UI-WORK-001`、`UI-PREVIEW-001` | `#44a` | `RT-PREVIEW-001`、`RT-WORK-001` | `EVT_gen_task_canceled` | `TC-GEN-009`~`011` ｜ `TC-WORK-110`、`TC-PREVIEW-111` ｜ `TC-GEN-205`/`206`/`305`/`306` ｜ `TC-E2E-007` 步骤 9 | OK |
| `REQ-GEN-006` | 单调序号，只应用最新结果 | P0 | N/A | `#43`、`#44`、`#45` | `RT-EDIT-001`、`RT-PREVIEW-001`、`RT-WORK-001` | `EVT_preview_refreshed`（`seq` 单调） | `TC-GEN-004`/`006`/`007` ｜ `TC-PREVIEW-110` ｜ `TC-GEN-204`、`TC-PREVIEW-204` | OK |
| `REQ-GEN-007` | 长任务模型 + SSE + 降级轮询 | P0 | `UI-WORK-001` | `#45`、`#44` | `RT-WORK-001` | `EVT_gen_task_terminal`、`EVT_gen_task_enqueued`（`task_id` 去重） | `TC-GEN-012`~`014`、`TC-GEN-024`~`029` ｜ `TC-WORK-106` ｜ `TC-GEN-202` | OK |
| `REQ-GEN-008` | 统一 5min 超时；生成失败 ≠ 验证失败 | P1 | `UI-WORK-001`、`UI-PREVIEW-001` | `#44`、`#49` | `RT-WORK-001`、`RT-PREVIEW-001` | `EVT_gen_task_terminal`（`timeout`）、`EVT_verify_failed` | `TC-GEN-011` ｜ `TC-WORK-111` ｜ `TC-GEN-303`/`304` | OK |
| `REQ-GEN-009` | 只出源码 + wrapper + 依赖锁定清单 | P0 | N/A | `#47`、`#60` | `RT-VER-001`、`RT-EDIT-001` | `EVT_l2_reported` | `TC-GEN-017` ｜ `TC-NF-110` ｜ `TC-GEN-355`（A-5） | OK |
| `REQ-GEN-010` | 外部依赖降级（60s/退避 2 次/不静默写入） | P1 | N/A | `#12`、`#16`、`#30`、`#43`（各 `⚡`） | `RT-PREVIEW-001`、`RT-WORK-001`、`RT-UPLOAD-001` | `EVT_gen_task_terminal`（`error_code`） | `TC-UPLOAD-009`、`TC-REVIEW-004`、`TC-SPEC-015` ｜ `TC-UIEDIT-104` ｜ `TC-GEN-203`（`error_code`） | OK |
| `REQ-PREVIEW-001` | 预览显示与刷新时机（L1 后刷新） | P0 | `UI-PREVIEW-001` | `#47`、`#45` | `RT-PREVIEW-001` | `EVT_preview_refreshed` | `TC-PREVIEW-107`/`109`/`110` ｜ `TC-PREVIEW-203`/`204` ｜ `TC-E2E-007` | OK |
| `REQ-PREVIEW-002` | 预览 6 态与文案 | P0 | `UI-PREVIEW-001` | `#44`、`#49`、`#46` | `RT-PREVIEW-001` | `EVT_gen_task_terminal`、`EVT_verify_failed`、`EVT_preview_refreshed` | `TC-GEN-006` ｜ `TC-PREVIEW-102`~`104`/`106` | OK |
| `REQ-PREVIEW-003` | 近似预览与与真机差异披露 ★ | P0 | `UI-PREVIEW-001` + **§6 全节** | N/A | `RT-PREVIEW-001` | N/A | `TC-PREVIEW-101` ｜ 接口层 N/A（前端渲染能力） | OK |
| `REQ-PREVIEW-004` | 预览溯源（任务序号 + 时间） | P1 | `UI-PREVIEW-001` | `#44`、`#45` | `RT-PREVIEW-001` | `EVT_preview_refreshed`（`seq`） | `TC-PREVIEW-107`/`108` ｜ `TC-PREVIEW-203` | OK |
| `REQ-API-001` | 接口定义增删改查（8 项类型枚举） | P0 | `UI-API-001` | `#50`、`#51`、`#53` | `RT-API-001` | N/A | `TC-API-001`~`004`/`008`~`010` ｜ `TC-API-101`/`103`/`104`/`107` | OK |
| `REQ-API-002` | 项目级版本（整包快照 + diff） | P0 | `UI-API-001`、`UI-VER-001` | `#54`、`#55`、`#56`、`#57` | `RT-API-001`、`RT-VER-001` | `EVT_deliver_done`（`version_seq`） | `TC-DELIVER-001`/`005`~`008` ｜ `TC-API-109` ｜ `TC-DELIVER-301` | OK |
| `REQ-API-003` | 删除接口（影响范围 + 需复核） | P1 | `UI-API-001` | `#52` | `RT-API-001` | N/A | `TC-API-006`/`007` ｜ `TC-API-110` | OK |
| `REQ-CAP-001` | 能力配置 7 项默认全关 + 保存即生成 | P0 | `UI-CAP-001` | `#58` | `RT-CAP-001` | `EVT_cap_save_generated` | `TC-CAP-001`~`003`/`008` ｜ `TC-CAP-101`~`104` | OK |
| `REQ-CAP-002` | 能力生成部分失败逐项重试 | P1 | `UI-CAP-001` | `#58` | `RT-CAP-001` | `EVT_cap_save_generated`（`overall=partial`、`failed_capabilities`） | `TC-CAP-003` ｜ `TC-CAP-104` ｜ `TC-CAP-201` | OK |
| `REQ-CAP-003` | 取消勾选（仅移除配置，代码保留） | P1 | `UI-CAP-001` | `#58` | `RT-CAP-001` | `EVT_cap_disable_confirmed` | `TC-CAP-004` ｜ `TC-CAP-108` ｜ `TC-CAP-203`/`204` | OK |
| `REQ-CAP-004` | 第三方密钥本期不采集 | P0 | `UI-CAP-001` | `#58` | `RT-CAP-001` | 全部事件（**上报体禁含项**） | `TC-CAP-005` ｜ `TC-CAP-107` ｜ `TC-TRACK-216` | OK |
| `REQ-CAP-005` | 依赖版本冲突与版本对齐表 | P2 | `UI-CAP-001` | `#58` → `data.conflicts[]` | `RT-CAP-001` | `EVT_cap_save_generated`（`conflicts_count`） | `TC-CAP-006` ｜ `TC-CAP-109` ｜ `TC-CAP-201`（`conflicts_count` 报实际条数） | OK |
| `REQ-BASE-001` | 本期只做安卓、从新建项目开始（范围声明） | P0 | **全部 13 页（全局约束）** | `#47`、`#60` | 全部 13 条 `RT-*`（全局约束） | N/A | `TC-NF-108` | OK |
| `REQ-NF-001` | 耗时与超时指标（L1 P95≤90s / L2 仅记录） | P1 | `UI-UPLOAD-001`、`UI-REVIEW-001`、`UI-SPEC-001`、`UI-PREVIEW-001`、`UI-EDIT-001`、`UI-VER-001` | `#44`、`#49`、`#46` | `RT-UPLOAD-001`、`RT-REVIEW-001`、`RT-SPEC-001`、`RT-PREVIEW-001`、`RT-EDIT-001`、`RT-VER-001`、`RT-CAP-001` | `EVT_gen_task_terminal`、`EVT_verify_failed`、`EVT_l2_reported`、`EVT_upload_parse_terminal`、`EVT_spec_gen_done` | `TC-NF-104`、`TC-GEN-022` ｜ `TC-WORK-112`/`TC-NF-103` ｜ `TC-PREVIEW-206`/`TC-TRACK-219` ｜ `TC-E2E-007` 步骤 10 | OK |
| `REQ-NF-002` | 可用性底线（键盘/不只靠颜色/无动效/保留输入） | P2 | **全部 13 页（全局约束 §3.5 / §3.7）** | 全部接口（字段级错误 + 状态码可区分） | 全部 13 条 `RT-*` | N/A | `TC-NF-103`/`TC-NF-111` ｜ `TC-UIEDIT-119`、`TC-WORK-101`、`TC-DELIVER-107` | OK |
| `REQ-NF-003` | 并发编辑冲突（乐观锁 + diff） | P1 | `UI-API-001`、`UI-KB-001`、`UI-EDIT-001`、`UI-CAP-001` | `#4`、`#9`、`#37`、`#51`、`#39`、`#40`、`#53`、`#58` | `RT-EDIT-001`、`RT-API-001`、`RT-CAP-001`、`RT-KB-001` | N/A | `TC-PROJ-017`、`TC-KB-007`、`TC-UIEDIT-009`/`023`、`TC-API-005`、`TC-DELIVER-011` ｜ `TC-API-108` ｜ `TC-CAP-007` | OK |
| `REQ-NF-004` | 分页/排序/搜索全站统一 | P1 | N/A | 全站统一（§5.3） | `RT-PROJ-001`、`RT-API-001`、`RT-KB-001`、`RT-UPLOAD-001`、`RT-REVIEW-001`、`RT-SPLIT-001`、`RT-SPEC-001`、`RT-VER-001` | N/A | `TC-PROJ-002`~`005`、`TC-UPLOAD-014`、`TC-UIEDIT-021`、`TC-API-003` ｜ `TC-API-103` | OK |
| `REQ-NF-005` | 时间口径与"未知/零/不适用" | P2 | `UI-PROJ-001`、`UI-UPLOAD-001`、`UI-API-001`、`UI-VER-001`、`UI-PREVIEW-001` | 全站统一（§4.6） | `RT-PROJ-001`、`RT-UPLOAD-001`、`RT-API-001`、`RT-VER-001`、`RT-PREVIEW-001`、`RT-KB-001`、`RT-WORK-001` | 全部带时间参数的事件 | `TC-PROJ-023`、`TC-PREVIEW-108` ｜ `TC-NF-112` ｜ `TC-TRACK-217` | OK |
| `REQ-NF-006` | 提交类操作幂等（3s） | P0 | N/A | `#2`、`#10`、`#16`、`#26`、`#43` | 全部含提交动作的 `RT-*` | `EVT_proj_create_success`、`EVT_upload_start`、`EVT_chat_send_success`、`EVT_edit_submit_success`、`EVT_review_submit`（均带 `dedup_key`） | `TC-PROJ-009`、`TC-UPLOAD-004`、`TC-CHAT-006`、`TC-UIEDIT-007`、`TC-REVIEW-025`、`TC-GEN-002`、`TC-SPEC-004`、`TC-DELIVER-006` ｜ `TC-PROJ-110` ｜ `TC-PROJ-204` | OK |
| `REQ-NF-007` | 多步写入原子性 | P1 | N/A | `#47`、`#57` | `RT-VER-001`（回滚）、`RT-REVIEW-001`（回写） | `EVT_gen_task_terminal`（`failed`） | `TC-DELIVER-010`、`TC-UPLOAD-012` ｜ `TC-DELIVER-104` ｜ `TC-GEN-305`、`TC-DELIVER-302` | OK |
| `REQ-NF-008` | API 版本前缀与统一响应包 | P2 | N/A | 全站（`/api/v1/` + 统一包 + 错误码） | 全部 `RT-*` | N/A | `TC-DRAFT-012`（统一响应包）｜ `TC-NF-105`（未知字段容忍） | OK |
| `REQ-AUTH-001` | 登录与 401 行为（**现为本地账号密码，飞书扫码保留**） | P0 | `UI-AUTH-001` | `#63`、`#64`、`#65`、`#66` + 全局 401 + **`#72`/`#72a`**（本地账号密码，**阶段替换**） | `RT-AUTH-001` | `EVT_auth_scan_success`、`EVT_auth_login_failed`、`EVT_auth_session_expired`、`EVT_auth_logout`、**`EVT_auth_password_login`**〔2026-10-21〕 | `TC-SPEC-012`、`TC-DELIVER-015` ｜ `TC-AUTH-101`~`107`、`TC-NF-101` ｜ `TC-AUTH-201`~`208` ｜ `TC-DRAFT-007`~`009` ｜ **`TC-AUTH-001`~`013`**〔`#72`/`#72a`〕｜ **`TC-AUTH-233`/`234`**〔`EVT_auth_password_login`〕 | OK |
| `REQ-AUTH-002` | 两角色权限矩阵 + 逐对象鉴权 | P0 | `UI-AUTH-001` + **全部 13 页（403 文案统一）** | 全局鉴权中间件（覆盖 `#1`~`#70`）+ `#66` | `RT-AUTH-001` + 全部 13 条 `RT-*` | `EVT_auth_forbidden` | `TC-PROJ-004`/`015`/`021`/`024` 等 12 处越权 ｜ `TC-AUTH-105`/`TC-PROJ-105` 等 ｜ `TC-AUTH-209`/`210` | OK |
| `REQ-AUTH-003` | 权限撤销 ≤5min 生效 | P2 | N/A | 全局 token / 缓存策略 | `RT-EDIT-001`、`RT-KB-001`、`RT-API-001`、`RT-CAP-001` | `EVT_auth_forbidden` | `TC-REVIEW-028` ｜ `TC-NF-102` ｜ `TC-AUTH-205`/`209` | OK |
| `REQ-AUTH-004` | ★ 外发大模型告知与开关（P0 合规） | P0 | `UI-AUTH-001`、`UI-UPLOAD-001`、`UI-EDIT-001`、`UI-CAP-001` | `#68` + `#10`/`#12`/`#43`/`#58` 的**不可用分支** | `RT-AUTH-001`、`RT-UPLOAD-001`、`RT-EDIT-001`、`RT-CAP-001`、`RT-WORK-001` | `EVT_aiegress_notice_shown`、`..._confirmed`、`..._write_failed`、`..._canceled`、`EVT_aiegress_disabled`、`EVT_aiegress_enabled`、`EVT_gen_blocked_by_egress` | `TC-UPLOAD-005`、`TC-GEN-005` ｜ `TC-UPLOAD-109`、`TC-CAP-110`/`111`、`TC-UIEDIT-118`、`TC-AUTH-108` ｜ `TC-AUTH-211`~`232`、`TC-DRAFT-006`/`011` | OK |
| `REQ-AUTH-005` | 日志脱敏与密钥管理 | P0 | N/A | 全局（全部接口） | 全部 13 条 `RT-*`（负向约束） | 全部事件（**禁含项**） | `TC-SPEC-013`、`TC-TRACK-008` ｜ `TC-NF-106` ｜ `TC-TRACK-216` | OK |
| `REQ-AUTH-006` | 项目隔离（project_id 强制过滤） | P0 | N/A | `#7`、`#8`、`#9` + 全局 | 全部项目级 `RT-*` | 全部带 `project_id` 的事件 | `TC-KB-002` ｜ `TC-KB-108`、`TC-NF-107` | OK |
| `REQ-AUTH-007` | 增强策略本期不做（范围声明） | P2 | N/A | N/A | N/A | N/A | `TC-NF-109` | OK |
| `REQ-AUTH-008` | 个人数据最小化与清理〔推断〕 | P2 | N/A | `#66` + `E22 User` | `RT-PROJ-001`、`RT-WORK-001`（用户菜单） | `EVT_proj_deleted` | `TC-PROJ-019`/`TC-PROJ-209` ｜ `TC-PROJ-110`（只展示 open_id/昵称/头像）｜ `TC-DRAFT-009`；**保留期/清理口径**：`TC-PROJ-209`、`TC-TRACK-211` | OK |
| `REQ-DELIVER-001` | 交付归档与导出（需鉴权） | P0 | `UI-VER-001`、`UI-SPEC-001` | `#60`、`#61` | `RT-VER-001`、`RT-SPEC-001` | `EVT_deliver_done`、`EVT_auth_forbidden`（`resource=deliverable`） | `TC-DELIVER-012`~`016` ｜ `TC-DELIVER-109` ｜ `TC-DELIVER-201`/`202` ｜ `TC-E2E-009` | OK |
| `REQ-DELIVER-002` | 版本归档页（时间线/diff） | P1 | `UI-VER-001` | `#54`、`#56` | `RT-VER-001` | N/A | `TC-DELIVER-001`/`002`/`004` ｜ `TC-DELIVER-101`/`103`/`107`/`110` | OK |
| `REQ-DELIVER-003` | 整包回滚（全成或全不成） | P0 | `UI-VER-001` | `#57` | `RT-VER-001` | `EVT_version_rolled_back` | `TC-DELIVER-009`~`011` ｜ `TC-DELIVER-104`/`108` ｜ `TC-DELIVER-203`/`204`/`302` | OK |
| `REQ-DELIVER-004` | 回环产物归档不物理删除 | P1 | N/A | `#57`、`#54` | `RT-VER-001`、`RT-SPEC-001` | N/A | `TC-DELIVER-009` ｜ `TC-PROJ-313`、`TC-DELIVER-303` | OK |
| `REQ-DESIGN-001` | 设计参考（UE 仅作交互/动效参考） | P2 | Deferred | Deferred | Deferred | N/A | `TC-DESIGN-101` | Deferred |
| `REQ-TRACK-001` | 平台自身埋点：主流程漏斗 9 节点 | P1 | N/A | `#62` | 全部漏斗节点页 | §6 的 9 个节点事件（+ 旁路 9 条） | `TC-TRACK-005`~`007` ｜ 埋点层全量（`TC-AUTH-201`~`224`、`TC-PROJ-201`~`210`、`TC-UPLOAD-201`~`210`、`TC-REVIEW-201`~`212`、`TC-SPLIT-201`~`206`、`TC-SPEC-201`~`204`、`TC-CHAT-201`~`208`、`TC-UIEDIT-201`~`210`、`TC-GEN-201`~`206`、`TC-PREVIEW-201`~`206`、`TC-DELIVER-201`~`204`、`TC-CAP-201`~`204`）｜ `TC-TRACK-201`~`212` ｜ `TC-E2E-008` | OK |
| `REQ-TRACK-002` | 代码生成成功/失败与耗时事件 | P1 | N/A | `#62` | `RT-EDIT-001`、`RT-PREVIEW-001` | `EVT_gen_task_terminal`、`EVT_verify_failed`、`EVT_preview_refreshed`（`l1_duration_ms`）、`EVT_l2_reported` | `TC-GEN-203`/`205` ｜ `TC-PREVIEW-205`/`206` ｜ `TC-TRACK-219` | OK |
| `REQ-TRACK-003` | 埋点上报批量 + 失败静默重试 | P2 | N/A | `#62` | 全部 `RT-*` | 全部事件的上报通道（§5） | `TC-TRACK-005`~`009`/`213`~`220` ｜ `TC-TRACK-211`/`212` ｜ `TC-TRACK-218` | OK |

**合计 95 条**（`需求条目表.md` 逐行对齐；`[原]` 25 + `[＋]` 66 + `[＋]2026-10-29` 4）。`N/A` 单元格 = 该角色本轮未分配（理由见 §四）。

---

| `REQ-INTAKE-001` | 接入已有工程（入口与路径登记；只读扫描） | P0 | OK | OK | OK | OK | OK | 全 OK |
| `REQ-INTAKE-002` | 工程约束（提取物可查看 / 编辑） | P0 | OK | OK | OK | N/A | OK | 埋点显式不埋 |
| `REQ-INTAKE-003` | 约束注入下游与工程一致性（门禁 J 组） | P0 | N/A | OK | OK | N/A | OK | UI / 埋点不适用（已写理由） |
| `REQ-PATCH-001` | 增量写回（应用 / 记录 / 回滚 / 生成产物合并写回） | P0 | OK | OK | OK | OK | OK | 全 OK |
## 二、反向：角色条目 → 需求（★ 孤儿检测）

> **方法**：对每一族的 Spec 产物（页面 `UI-*` / 元素 `EL-*` / 接口 `#n` / 路由 `RT-*` / 事件 `EVT_*` / 用例 `TC-*`）反向查其上游 `REQ-ID`；查不到上游者 = **孤儿**，必须解释或删除。
> **检测结论（本轮）**：**孤儿 0**。

| 产物族 | 权威域 | 数量 | 反向挂 `REQ-ID` 情况 | 孤儿 |
|---|---|---|---|---|
| `UI-*` 页面 | `UI-Spec §2` | 13 | 13 个页面全部由 §9 追溯到 REQ | **0** |
| `EL-*` 元素 | `UI-Spec 全文唯一ID`（含全局规范；剔除4个非活跃引用：示例/已移除；不是只数§5） | **450 = 447 + 3**（2026-10-29 二期 `EL-WORK-036`~`038`）（2026-10-29 工程接入 `EL-PROJ-048`~`057` + `EL-KB-025`/`026`；B9 新增 EL-REVIEW-055~062；EL022 converted答复复用不新增） | 8个新增元素挂REQ-REVIEW-001/002/003/004及REQ-KB-001；正文与状态各1组进入UI§5/API§3.2 | **0** |
| `#n` 接口 | `接口-Spec §5.4` | **82**（63 基线 + 8 补口 `#63`~`#70` + **4 本机落地 `#71`/`#71a`/`#72`/`#72a`** + **3 工程接入 `#73`~`#75`** + **4 二期写回 `#76`~`#79`**〔2026-10-29〕） | 82 个接口全部挂 `REQ-ID`（§5.4 总表逐行） | **0** |
| `RT-*` 路由 | `App-Spec §3` | 13（+3 区域锚点，不计入） | 13 条路由与 `UI-*` 一一映射，均挂 REQ | **0** |
| `EVT_*` 事件 | `埋点-Spec 附节 C` | **59**（+7：`EVT_auth_password_login`、`EVT_llm_model_switch`〔2026-10-21〕；`EVT_intake_click`/`done`/`failed`〔2026-10-29 工程接入〕） | 每个事件挂 ≥1 个 `REQ-ID`（B8 判据） | **0** |
| `TC-*` 用例 | `测试-Spec §12` | **632**（表内 **621** + E2E 11〔2026-10-29 工程接入 +18 = §4.18 7 + §5.15 4 + §6.1.14 6 + §7.10 1；2026-10-21 本机落地 +26；2026-10-22 语义核对 +1 = `TC-PROJ-025`，线程/AI 过程 +11，`#16` 复用语义 +3 = `TC-REVIEW-001a`/`001b`/`001c`，评分卡归属三态 +4 = `TC-PROJ-026`/`027`、`TC-REVIEW-001d`/`001e`，过程与消息共列 +1 = `TC-GEN-029`〕） | 每个 `TC-*` 挂 ≥1 个 `REQ-ID` | **0** |

**孤儿解释表**（存在但**有意不挂**本平台 REQ 的条目 —— 均为**已声明示例**，非本平台需求）

| 产物 ID | 所属 Spec | 为什么不挂 REQ | 结论 |
|---|---|---|---|
| `EL-HOME-001` | 接口 / App / 测试（归一化示例） | 接口字段归一化演示用示例元素，非本平台页面元素 | **保留（示例，标注）** |
| `EL-CART-007` | 埋点（B 线格式示意） | 用户生成 App 的 B 线 `TrackPlan` 埋点格式示意，不属平台 A 线埋点 | **保留（示例，标注）** |

**历史孤儿（已销项，留痕）**：`TC-REVIEW-111` / `TC-REVIEW-112` 第 3 列曾缺 `REQ-ID`（一致性校对第 1 轮 `[校对-D2]`）——
现已分别补挂 `REQ-REVIEW-005`（+ `[冲突-UI-02]`）与 `REQ-REVIEW-003`、`REQ-REVIEW-008`（+ 缺口编号），**孤儿数声明已回正为 0**。

---

## 三、一致性比对（校对 Agent 执行，五类）

> 依据：`reviews/五份Spec一致性校对报告.md` **最新一轮结论**；旧基线（63 接口 / 21 实体 / `EL-*` 413 / §5 79 行）已被 2026-10-21 变更取代。

| # | 比对 | 结论 | 差异条目 |
|---|---|---|---|
| 1 | UI 页面清单 ↔ App 路由表（数量 + ID 映射一一对应） | **第 4 轮一致**；**2026-10-22 第 5 轮**见校对报告 `§⑲`/`§⑳`/`§㉑`（`§⑳` 判 NOT-READY，其条目已逐条销项，**以最新一轮校对报告为准**） | 13 个 `UI-ID` ↔ 13 条 `RT-*` 一一映射；3 条区域锚点（`RT-REVIEW-002`/`RT-TRACE-001`/`RT-DELIVER-001`）已由 `App-Spec §3` 注 2 显式排除 |
| 2 | 接口字段名 ↔ App 响应字段映射（逐字） | **第 4 轮一致**；**2026-10-22 第 5 轮**见校对报告 `§⑲`/`§⑳`/`§㉑`（`§⑳` 对**比对②**判「不一致（3 组）」→ 已逐条销项，**以最新一轮为准**） | 接口冻结字段名在 App 中缺失 **0**；`E7` 的 `width`/`height`/`align_h`/`align_v` 逐字一致、未合并 |
| 3 | UI 文案 ↔ App 失败提示 ↔ 测试预期结果（三处） | **第 4 轮一致**；**2026-10-22 第 5 轮**见校对报告 `§⑲`/`§⑳`/`§㉑`（`§⑳` 对**比对③**判「不一致（1 处）」→ 已销项，**以最新一轮为准**） | UI §3.6 ↔ App §6.3 **13/13 逐字**；接口页专属文案三处相同（「该接口已被他人修改。」） |
| 4 | 埋点事件名 ↔ App 埋点位置 ↔ 测试用例事件名（三处） | **第 4 轮一致**；**2026-10-22 第 5 轮**见校对报告 `§⑲`/`§⑳`/`§㉑`（`§⑳` 对**比对④**判「**一致**」，59/59/59；“部分通过”系对**比对⑤**而言 → **以最新一轮为准**） | App §10.1 **32 行** + §10.2 `EVT_chat_send_blocked` 全部 ⊆ 附节 C **59 条**〔2026-10-29 二期写回 +2、工程接入 +3；2026-10-21 本机落地后；原 52〕；测试 **59 条**全覆盖、未覆盖 **0** |
| 5 | 覆盖率 + 孤儿检测 | **第 4 轮通过**；**2026-10-22 第 5 轮**见校对报告 `§⑲`/`§⑳`/`§㉑`（**以最新一轮为准**） | 五份各自追溯表 95/95 行、**REQ 集合一致**（模块内行序按各 Spec 自定，本文件按 `需求条目表.md` 统一排序）、**孤儿 0**；已按各表回填 |

---

## 四、覆盖率统计

| 指标 | 数值 |
|---|---|
| REQ 总数 | **95** |
| 汇总 `OK` | **94** |
| 汇总 `Deferred`（计入覆盖） | **1** |
| 五列齐全（`OK`/`N/A`/`Deferred` 计入，`GAP` 不计）的 REQ 数 | **95** |
| 汇总 `GAP`（有缺口，不计入覆盖） | **0** |
| **覆盖率（本表口径）** | **95/95 = 100.0%** |
| 孤儿数量 | **0**（见 §二） |
| 五类跨文档不一致项 | **第 4 轮为 0**；**2026-10-22 第 5 轮**复查发现问题并已逐条销项 —— **以校对报告 `§⑲`/`§⑳`/`§㉑` 为准**（本行不再单独声明 0） |

> **口径说明（避免与 `测试-Spec §11` 的「95/95 = 100%」混淆）**：`测试-Spec §11.1` 的 100% 是「**已编制用例**口径」——即 95 条 REQ **全部挂了用例**（含以「证明其不存在」方式覆盖的 `N/A` 条）。
> 本表口径按 `baseline/需求追溯矩阵.md` 原文定义 —— **`GAP` 不计入覆盖**，故为 `95/95 = 100.0%`。两者不矛盾，是两个不同的分母定义。
> **与 `测试-Spec §11.1` 的分态差异（**口径，不是漏改**）**：本表 `汇总` 行为**五列并集**口径 —— `REQ-DESIGN-001` 记 `Deferred`（1 条），其余 **94** 条计 `OK`（`N/A` 并入 `OK`）；`测试-Spec §11.1` 为**测试列**口径 —— `REQ-DESIGN-001` 计 `OK`、`REQ-BASE-001`/`REQ-AUTH-007` 单列 `N/A`（`OK 93 + N/A 2`）。两者分母同为 `需求条目表` **95 条**，**覆盖率一致（95/95）**，仅分态归并方式不同。

### 4.1 各角色列分态（机核，逐列可复算）

| 角色列 | `OK` | `N/A` | `Deferred` | `GAP` | 合计 |
|---|---|---|---|---|---|
| UI | 71 | 23 | 1 | 0 | 95 |
| 接口 | 90 | 4 | 1 | 0 | 95 |
| App | 93 | 1 | 1 | 0 | 95 |
| 埋点 | 70 | 25 | 0 | 0 | 95 |
| 测试 | 93 | 2 | 0 | 0 | 95 |

### 4.2 缺口清单（`GAP` / `Deferred`，逐条可核查）

**`GAP`：0 条** —— 原 3 条经 `platform/decisions/P0-补口裁决单.md` 落地后**已全部解除**：

| 原 `GAP` | 解除依据 | 现状态 |
|---|---|---|
| `REQ-SPLIT-002` 自适应深度无落点 | `E1 Project.depth`（项目级）+ `#16`/`#28` 可选 `depth` 入参 | **OK**（`AC-SP-05` 可执行） |
| `REQ-AUTH-008` 埋点保留期无口径 | `Q7`/`[埋点-Q4]` 裁决：只走 `#62`、不留业务库；`埋点-Spec §8.2` 口径转正式 | **OK** |
| `REQ-DESIGN-001` `§F15` 无可验收 | `Q10` 拍板：仅设计态参考，验收 = 仅「无动效」（`AC-NF-07`） | **Deferred**（依 PM 口径归档，非未决） |

**`Deferred`：1 条** —— `REQ-DESIGN-001`：四侧一致按「设计态参考、验收=无动效」处理，**已按 PM 拍板归档**。

> **另有 2 条「已覆盖但结论带条件」**（不计入 `GAP`）：`REQ-KB-002`、`REQ-UIEDIT-005` —— 已随基线固化。

---

## 五、消费关系（设计性缺席 vs 真缺口）

| 消费方 | 被消费物 | 是否存在 | 判定 |
|---|---|---|---|
| App Spec | UI Spec | 存在 | — |
| App Spec | 接口 Spec | 存在 | — |
| 埋点 Spec | App Spec（埋码点） | 存在 | — |
| 测试 Spec | UI / 接口 / App / 埋点 | 存在 | — |

- **设计性缺席**：生产者不在本次交付范围内 → 不算缺口（如 iOS/跨平台 Spec，见 `REQ-BASE-001`）。
- **真缺口**：生产者本应产出却没产出 → 必须暴露（见 §4.2）。
- 可选项缺席（非必需输入不存在）→ 直接忽略，永远不算缺口。

---

## 六、维护与消费方

| 项 | 说明 |
|---|---|
| 唯一权威源 | 五份 Spec 各自的追溯表；**本文件是汇聚台账**，与五表须保持一致 |
| 回填口径 | 「覆盖状态」= 五列最严重状态（`GAP` > `Deferred` > `OK`），`N/A` 计入覆盖 |
| 消费方 | `测试-Spec` 准出条件 `AC-T-016`（本文件「测试用例ID」列已回填、孤儿数 0）；`REQ-SPEC-004` 的 RTM 接口 ★`#67`（四态 + 孤儿检测由接口给出，不只在文档） |
| 更新时机 | 任一角色 Spec 变更 → 重跑汇聚 → 本文件与 §三/§四 同步刷新 |


## 六、B9 文档同步增量（2026-10-26，非一致性校对）

- 五Spec版本：UI v0.1.15 / App v0.2.15 / 接口 v0.16 / 埋点 v0.1.9 / 测试 v0.2.15；设计底稿与本RTM修订B9-20261026。
- 当前计数：接口82，EL450（447+3），事件59、漏斗9、路由/页面13、实体23、TC632（表内621+E2E11）。UI§5与接口§3.2各93行（93✅/0⚠️/0❌）；App§4.2展开**302（301 页面元素行含外壳 + 1 页面进入控制行）**，旧表实测287而历史声明286，原历史不改。
- 新真实元素：055入口、056正文Drawer/关闭、057元信息、058精确KB doc深链、059Markdown正文、060禁用原因、061写回核验通知、062错误。每项只在UI①定义一次；converted复用022。
- 测试Spec就地增强既有TC并附新脚本 `server/test/review-writeback-regression.mjs` 01~10映射；没有新增TC定义/删除/重排，脚本内部test数量不当Spec用例数。
- **覆盖OK是文档映射存在，不是实现/验收全通过**：submit_blocked当前缺可达埋码点、离页作答草稿恢复未实现、accepted suggestion一致分支正文门槛/手动核验错误入口等待补，详见B9。前轮§㊶结论保留不代表本轮READY；主Agent独立校对。
- 本轮记录 `reviews/B9-审核补充与复审闭环-20261026.md`；历史一致性报告只读，不运行旧任务、不改业务/测试文件/真实DB。
