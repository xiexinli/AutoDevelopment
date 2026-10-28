# AutoDevelopment 平台 App Spec

> 版本：**v0.2.15** ｜ 来源 PRD：`platform/平台需求概要.md`（平台自身的产品需求）v1.4 · 第 4 轮回写后 · 门禁阻断 0（document_id: `platform/平台需求概要.md`, revision: v1.4/S 2026-10-20）｜ 角色：App ｜ 更新：2026-10-26（**B9 审核补充与复审闭环**；正文回读与精确深链、原子写入、disabled；前轮审核流程优化：`EL-REVIEW-054` 自动审核开关、回写落章 + 澄清答复、复审继承勾选态；上一版 v0.2.14 = 审核流程优化；更早v0.2.13 = 未通过项补充信息）；**本轮同版增量补正**：#8服务端哈希、初载/手动文档门禁、严格正文继承与当前doc历史；不另开轮次。
>
> **本次作业性质**：以 `platform/design/页面规格.md`、`platform/design/数据模型.md` 为**底稿**做**格式转换 + 一致性对齐 + 缺口补齐**，
> **不重新设计**。冲突时**以 `platform/平台需求概要.md` 为准**并登记，**不自行裁决**。
>
> **来源标签**（沿用基线记法）：`§FX` / `§X` = `platform/平台需求概要.md`；`页面规格§X` = `platform/design/页面规格.md`；
> `数据模型§X` = `platform/design/数据模型.md`；`接口契约 #n` = `platform/design/接口契约.md`；`AC-*` / `E2E-*` = `platform/design/验收标准.md`；
> `UI-Spec §X` / `接口-Spec §X` = 同批上游产出；`[来源: 推断，待确认]` = 平台推导（属**假设**性质，原文标签**原样保留**，不阻塞开工）。

## 0 阅读约定：**三件事必须先分清（不混写）**

> 本项目最容易犯的错，是把「平台的 App」与「平台生成出来的安卓工程」混为一谈，以及把两条埋点线合流。
> 故单列本节，后续所有章节一律按此分层。

| # | 名称 | 是什么 | 谁产出 | 本 Spec 中的角色 |
|---|---|---|---|---|
| **①** | **平台自身 App（前端）** | AutoDevelopment 平台**自己的前端应用** —— **桌面浏览器中的 Web 工作台**（B/S 形态），用户在这里建项目、上传 PRD、审核、拆解、拖拽画布、预览、交付 | 平台侧开发 | **★ §1~§10 的产出对象**（`RT-*` 路由、`STORE-*` 状态、页面五态、埋码点） |
| **②** | **生成到安卓工程侧的产物约束** | 平台**为用户生成的那个原生安卓工程**（布局 XML + Kotlin）应当遵守什么 | 平台内部的代码生成链路（S7 开发按本 Spec 实现） | **★ 附节 A 的产出对象**（App 需求包 §4 的 7 条，写给 S7） |
| **③** | **被开发 App 的接口** | 用户在平台里为**他自己那个 App** 定义的业务接口（编号 `API-<模块>-<三位>`，如 `API-ORDER-001`） | **平台生成**（`REQ-API-001`，实体 `E9 ApiDef`） | **不是本 Spec 的接口**，只是被 `UI-API-001` 管理的**数据**（`接口-Spec §0`） |

**两条"埋点"也必须分清**（`埋点-需求包 §0`）：

| | **A. 平台自身埋点** | **B. 被开发项目的埋点方案** |
|---|---|---|
| 埋的是什么 | **平台自己**的用户行为（漏斗 9 节点） | **用户那个 App** 的业务埋点 |
| 需求来源 | `REQ-TRACK-001`~`003` | `REQ-SPLIT-004` |
| 载体 | `API-PLAT-062`（`#62 POST /metrics/events`，批量 + 失败静默重试） | `TrackPlan`（`数据模型 E12`），经 `API-PLAT-059`（`#59`）展示 |
| 本 Spec 落点 | **§10 埋点埋码点（A 线）** | **§4 对应表 + 附节 A 第 3 条（B 线，由 App 角色在 S7 写入用户安卓工程）** |

**接口编号与红线（★ 必须遵守）**：

| # | 约定 | 说明 |
|---|---|---|
| 1 | 平台自身接口一律沿用基线 **`#n`**；本 Spec 引用时**同时给出** `接口-Spec §1.2 约定 1` 的文档内引用键 **`API-PLAT-<三位>`**（`#44a` → `API-PLAT-044A`），二者**一一对应** | **严禁**给平台接口另编 `API-*` 编号；**严禁**把被开发 App 的 `API-*` 当平台接口用 |
| 2 | **补口 `#63`~`#70` 与字段级补口已于 2026-10-21 转正式基线**（`platform/decisions/P0-补口裁决单.md`） | `接口-Spec §5.4.12` 已去草案语义。本 Spec 引用时**按既有接口使用**；表内 **★** 仅作**章节强调**，不再表示待确认 |
| 3 | 字段名**逐字**取自 `接口-Spec §5.0.3 字段名冻结建议` 与 `数据模型`，**不改写、不意译、不合并** | 「宽 / 高」在 `数据模型 E7` 中**分立**为 `width` / `height` |
| 4 | 页面写 `UI-*`，路由写 `RT-*`，元素写 `EL-*`，状态模块写 `STORE-*`，接口写 `API-PLAT-*`（↔ `#n`）—— **引用而不复制** | 避免各自维护一份字段清单导致漂移 |
| 5 | 上游 `UI-Spec` 已点名 **`[冲突-UI-02]`**：13 页清单中**没有独立「门禁标准配置页」**，UI Spec 把它落成 `UI-REVIEW-001` 内的**抽屉** | 本 Spec **按 UI Spec 现状（13 页）处理**，路由表 = **13 条**（§3），并在 §12 原样登记该冲突，**不自行裁决**（若 PM 改为独立成页 → 页面数变 14，路由表须同步 +1） |

---

## 1 文档信息

| 项 | 内容 |
|---|---|
| 文档目的 | 定义 **UI 与接口的对应关系** 及**可实现级详细需求**（路由、状态管理、五态、缓存、权限、异常降级、跳转、埋码点） |
| 不在范围 | 视觉规范（`UI-Spec §3`）｜接口服务端实现（`接口-Spec`）｜被开发 App 的界面设计与 `API-*` 枚举（那是画布产物）｜平台的服务端构建（**平台不做服务端构建**，项目约束 1） |
| 关联文档 | `UI-Spec`（13 页 / **435** 个 `EL-*`〔沿革：412 → **419**〔2026-10-21 本机落地 +7〕→ **424**〔2026-10-22 对话面板 +5〕→ **425**〔2026-10-23 审核页写回入口 `EL-REVIEW-052` +1〕→ **426**〔2026-10-26 审核页未通过项补充信息 `EL-REVIEW-053` +1〕→ **427**〔2026-10-26 审核流程优化 `EL-REVIEW-054` +1〕〕）、`接口-Spec`（**75 接口** / 13 错误码 / SSE〔2026-10-21 本机落地后；原 71〕）、`埋点-Spec`（**54 事件** / 9 节点漏斗，已定稿并回填 §10）、`测试-Spec`（**600** 条用例，同批产出）、`baseline/需求追溯矩阵.md` |
| 上游主输入 | `platform/requirements/App-需求包.md`（`RT-*` ↔ `UI-*` 映射 + 状态管理 + 兜底 + **生成到安卓工程侧的 7 条实现约束**）、`platform/requirements/需求条目表.md`（91 条 REQ） |
| 路由条数 | **13 条 `RT-*`**（= `UI-Spec §2` 的 13 个 `UI-ID`，**一一映射、不允许多对一**） |
| 元素覆盖 | §4.2覆盖UI-Spec §5当前**84/84行**；按本表既有展开行口径实测**295 = 294页面元素供给行 + 1应用外壳行**，本轮8个新EL各补1行。该计数不是全局唯一EL数（UI活跃EL为435）；同步前旧表实测287、旧声明286，历史版本行不追改 |
| 接口引用 | 全部 `API-PLAT-*` 均真实存在于 `接口-Spec §5.4`（**75 个**：`#1`~`#62` + `#44a` + `#63`~`#70` + **`#71`/`#71a`/`#72`/`#72a`**〔2026-10-21 本机落地，见 `接口-Spec §5.4.13`〕；其中 `#63`~`#68` 由草案转基线、`#69`/`#70` 为 2026-10-21 新增 —— 见 `P0-补口裁决单`） |
| 本机落地扩展（★ 状态标注） | **`#71`/`#71a`/`#72`/`#72a` 4 个接口 + `EL-AUTH-017`~/`EL-AUTH-021`、`EL-REVIEW-051`、`EL-GLOBAL-009` 共 **7 个元素** = 本机开发阶段扩展**：**未过门禁、未进入第 4 轮基线冻结范围**（第 4 轮基线仍记 **71 接口 / 412 元素**）。其中 `API-PLAT-072`（`#72`）为**阶段性本地登录**，**生产必须关闭**（`AD_PASSWORD_LOGIN=disabled`） |

### 1.1 本 Spec 相对模板骨架的结构说明

严格按 `templates/App-Spec.md` 的 13 节骨架填写，**模板节号一节未改、一节未删**；另**新增 2 节**（均显式登记，不占用模板节号）：

| 模板节 | 本 Spec 节 | 说明 |
|---|---|---|
| （骨架无） | **§0 阅读约定** | 新增（本项目上下文强制：三件事分清 + 两条埋点分清 + 补口已转基线）。`接口-Spec §0` 同构 |
| §1~§10 | §1~§10 | **一一对应，节号不变**（模板 §10「埋点埋码点」= 本 Spec §10，**已填**） |
| （骨架无） | **附节 A ★ 生成到安卓工程侧的实现约束** | 新增（`App-需求包 §4` 的 7 条，写给 S7；**与 §1~§10 的平台自身 App 是两回事**，故单列成节） |
| §11~§13 | §11~§13 | 一一对应（需求追溯表 / 待澄清清单 / 变更记录），**置于文末** |

### 1.2 本 Spec 的编号与引用约定（PRD 未定义者属平台推导，带标签）

| # | 命名空间 | 归属 | 例子 |
|---|---|---|---|
| 1 | `RT-<模块>-<三位>` | App 路由（**与 `UI-*` 一一映射**） | `RT-UPLOAD-001` |
| 2 | `STORE-<模块>` | 页面状态模块（状态容器） | `STORE-UPLOAD` |
| 3 | `EL-<模块>-<三位>` | **元素唯一主键**（逐字取自 `UI-Spec`，**项目内全局唯一、不可复用、不可回收**） | `EL-EDIT-010` |
| 4 | `API-PLAT-<三位>` ↔ `#n` | 平台自身接口（本 Spec 引用键 ↔ 基线权威编号） | `API-PLAT-043` ↔ `#43` |
| 5 | `PARAM-*` | 请求参数来源的**具名来源**（见 §4.1 表） | `PARAM-EDIT-TREE` |
| 6 | `MODEL-*` | **本地模型**（前端状态的规范化形态，字段名逐字取自响应） | `MODEL-TASK` |

> **[来源: 推断，待确认]**：`STORE-*` / `PARAM-*` / `MODEL-*` 三套编号为**本 Spec 自定**（PRD 与上游两份 Spec 均未定义），
> 仅用于本 Spec 内部与 S7 开发对齐，**不改变上游任何编号**。

---

## 2 端范围与技术栈

> **本节的"目标端"指平台自身 App。** 生成到安卓工程侧的端与版本见 **附节 A**。

| 项 | 内容 |
|---|---|
| 目标平台与最低版本 | **桌面浏览器 Web 前端（B/S）**：Chrome ≥ 120 / Edge ≥ 120；基准视口 **1440×900**（`UI-Spec §1`）；最小可用视口 **1280×720**（各页适配规则见 `UI-Spec §4.x ⑦`） |
| 生成目标端（★ 非本 App 的端） | **Android 原生**（布局 XML + Kotlin），**本期固定、界面不得出现 iOS / 跨平台 / 已有项目导入入口**（`REQ-BASE-001`）；`minSdkVersion` / `targetSdkVersion` **PRD 未给** → `[待澄清-A01]` |
| 技术栈/框架 | **PRD 未指定前端框架** → `[待澄清-A02]`。本 Spec 只冻结**形态约束**（不得因框架选择而违反）：① 单页应用 + 客户端路由（§3）；② **单条 SSE 连接**承载全部任务与对话流（`REQ-GEN-007`，`API-PLAT-045`）；③ **本地草稿栈**（`REQ-UIEDIT-007`）；④ 画布为 DOM/Canvas 自研渲染器（`REQ-PREVIEW-003`）。`[来源: 推断，待确认]` |
| 工程结构约定 | ① **一个 `RT-*` = 一个路由 + 一个页面级状态容器 `STORE-*`**（§3 + §5）；② 全局状态仅 4 个：`STORE-GLOBAL/SESSION`（会话与用户）、`STORE-GLOBAL/PROJECT`（`ProjectContext`，`REQ-PROJ-005`）、`STORE-GLOBAL/TASK`（任务与 SSE 单一入口，`REQ-GEN-007`）、`STORE-GLOBAL/TRACK`（埋点队列，`REQ-TRACK-003`）；③ **画布与控件树共用同一棵元素树**（禁止第二份数据，`REQ-UIEDIT-005`）；④ 组件库按 `UI-Spec §7` 的 `CMP-001`~`CMP-015` 落地，**`EL-GLOBAL-*` 只用于 **5 个**真跨页共用组件（`CMP-001`~`004` + `CMP-017`〔2026-10-21 新增〕） |
| 多端复用策略 | **本期单端（Web 桌面）**，不涉及多端共用一套代码。 |
| 深链接（`REQ-PROJ-001` 之外的入口） | 本期**不提供**对外深链接（无分享链接需求）；**仅支持端内跳转**（§5 各页「跳转与深链接」）。→ 是否需要「项目链接可直接粘贴给同事」**PRD 未定义** → `[待澄清-A03]` |
| 离线能力 | 本期**不做离线可用**：仅做**离线检测 + 顶栏提示 + 恢复后重取**（§9）。→ `[来源: 推断，待确认]` |

---

## 3 路由表（必须与 UI 页面清单一一对应）

> **校验**：本表 **13 条** = `UI-Spec §2` 页面清单 **13 个 `UI-ID`**，**逐行一一映射，不允许多对一**（校对 Agent 会做 diff）。

| 路由 ID | 路由路径 | 对应 UI 页面 ID | 对应 REQ-ID | 状态容器 | 是否需登录 |
|---|---|---|---|---|---|
| `RT-AUTH-001` | `/login`（`?next=<path>` 携带登录后回跳目标） | `UI-AUTH-001` | `REQ-AUTH-001`、`REQ-AUTH-002`、`REQ-AUTH-004` | `STORE-AUTH` | **否** |
| `RT-PROJ-001` | `/projects` | `UI-PROJ-001` | `REQ-PROJ-001`~`004`、`REQ-KB-002` | `STORE-PROJ` | 是 |
| `RT-KB-001` | `/projects/{project_id}/kb`（`?sector=<prd\|spec\|terms\|domain>&doc={kb_doc_id}`） | `UI-KB-001` | `REQ-KB-001`、`REQ-KB-002` | `STORE-KB` | 是 |
| `RT-WORK-001` | `/projects/{project_id}` | `UI-WORK-001` | `REQ-PROJ-005`、`REQ-CHAT-001`、`REQ-UIEDIT-006`、`REQ-UIEDIT-007`、`REQ-GEN-005`、`REQ-GEN-007`、`REQ-GEN-008` | `STORE-WORK` | 是 |
| `RT-UPLOAD-001` | `/projects/{project_id}/upload` | `UI-UPLOAD-001` | `REQ-UPLOAD-001`~`006` | `STORE-UPLOAD` | 是 |
| `RT-REVIEW-001` | `/projects/{project_id}/review`（`?drawer=gate-standard` 打开门禁标准抽屉） | `UI-REVIEW-001` | `REQ-REVIEW-001`~`006`、`REQ-REVIEW-008` | `STORE-REVIEW` | 是 |
| `RT-SPLIT-001` | `/projects/{project_id}/split`（`?drawer=trace` 打开追溯矩阵抽屉） | `UI-SPLIT-001` | `REQ-SPLIT-001`~`004`、`REQ-SPEC-004` | `STORE-SPLIT` | 是 |
| `RT-EDIT-001` | `/projects/{project_id}/editor?mode=edit` | `UI-EDIT-001` | `REQ-UIEDIT-001`~`010`、`REQ-GEN-001`、`REQ-GEN-004` | `STORE-EDIT` | 是 |
| `RT-PREVIEW-001` | `/projects/{project_id}/editor?mode=preview`（**与 `RT-EDIT-001` 同路径、由 `mode` 区分**，见下注） | `UI-PREVIEW-001` | `REQ-PREVIEW-001`~`004`、`REQ-GEN-004` | `STORE-PREVIEW` | 是 |
| `RT-API-001` | `/projects/{project_id}/apis` | `UI-API-001` | `REQ-API-001`~`003` | `STORE-API` | 是 |
| `RT-CAP-001` | `/projects/{project_id}/capabilities` | `UI-CAP-001` | `REQ-CAP-001`~`005`、`REQ-AUTH-004` | `STORE-CAP` | 是 |
| `RT-SPEC-001` | `/projects/{project_id}/specs`（`?tab=<ui\|api\|app\|track\|test>`、`?drawer=trace`） | `UI-SPEC-001` | `REQ-SPEC-001`~`004`、`REQ-PROOF-001` | `STORE-SPEC` | 是 |
| `RT-VER-001` | `/projects/{project_id}/versions`（`?version=<version_id>` 选中某版本） | `UI-VER-001` | `REQ-DELIVER-001`~`003` | `STORE-VER` | 是 |

**注 1（`RT-EDIT-001` 与 `RT-PREVIEW-001` 的映射关系 —— ★ 必须显式说明，否则会被判"多对一"）**：
`UI-Spec §2` 与 `REQ-UIEDIT-006` 明确二者是**同一区域的两个状态**（`editing` / `preview_ready`，`数据模型 §3.1`）。
本 Spec 的处理：**仍是两条 `RT-*`、两个 `UI-*`，一一映射不变**；实现上**共享同一路由路径** `/projects/{project_id}/editor`，
由查询参数 `mode` 区分（`mode=edit` / `mode=preview`），**由 `EL-WORK-010` 分段控件驱动**，
切换**不得丢未提交改动**（草稿本地自动保存 + `API-PLAT-042` 双保险）。**`mode` 不进后端接口**（纯前端视图态，不落库）。

**注 2（区域锚点 —— 不占独立页面、不占独立路由，不计入 13 条）**：
`App-需求包 §2` 中另有 3 条 `RT-*` 指向**同一 `UI-*` 页面的区域**。它们**不是页面路由**，本 Spec 落为**同路由的锚点参数**：

| 区域路由 ID（`App-需求包 §2`） | 宿主页面 / 宿主路由 | 本 Spec 落法 | 依据 |
|---|---|---|---|
| `RT-REVIEW-002` | `UI-REVIEW-001` / `RT-REVIEW-001` | `?drawer=gate-standard` 打开 `EL-REVIEW-043` 抽屉（**不开新页**） | `[冲突-UI-02]`：13 页清单无独立「门禁标准配置页」 |
| `RT-TRACE-001` | `UI-SPEC-001` / `RT-SPEC-001`（并由 `RT-SPLIT-001` 侧 `?drawer=trace` 复用同一抽屉组件） | `?drawer=trace` 打开 `EL-SPEC-021` 抽屉 | `REQ-SPEC-004`；两页共用 `API-PLAT-067`★ |
| `RT-DELIVER-001` | `UI-VER-001` / `RT-VER-001` | 交付区 = 同页内的 `EL-VER-025`~`027` 区块（**不开新页**） | `REQ-DELIVER-001` |

> **为什么不给它们独立路径**：`UI-Spec §2` 页面计数 = 13、`UI-Spec §8` 跳转总览 = 13 节点，且明示
> 「上图 13 个节点 = App Spec 的 13 条 `RT-*` 路由，一一映射」。若为三者各开一条路径，将变成 16 条路由 ≠ 13 页，
> **直接违反本条校验**。故按**区域锚点**处理，并在 §11 追溯表中把对应 REQ 挂到宿主 `RT-*`。

**注 3（`[冲突-UI-02]` 的处置与影响）**：若 PM 裁定「门禁标准配置页」必须**独立成页**，则：

- `UI-Spec` 页面数 13 → **14**；本表随之 **+1 行**（`RT-REVIEW-002` `/projects/{project_id}/gate-standard` ↔ 新 `UI-REVIEW-002`，`STORE-REVIEW-STD`）；
- 此时 `RT-REVIEW-002` 从「区域锚点」升为**页面路由**，`?drawer=gate-standard` 参数废弃；
- **本 Spec 不自行裁决**，按现状（13 页）产出，冲突原样登记于 §12。

**路由守卫（全局，`REQ-AUTH-001`）**：

| 规则 | 行为 |
|---|---|
| 目标路由「是否需登录 = 是」且 `SessionStore.token == null` | **重定向 `RT-AUTH-001`**，`?next=` 携带原目标；**不渲染任何业务数据**（`UI-Spec §4.1` 交互规则） |
| 目标路由需登录但 `project_id` **无权** | 不停留在当前页发请求，由**首个业务接口的 403 兜底**（`FORBIDDEN` → 统一无权限态；**不区分"不存在"与"无权限"**） |
| 会话过期（任意接口 401） | 跳 `RT-AUTH-001` + `EL-AUTH-012`「登录已过期，已为你保留未提交的内容。」→ 重新认证后**恢复草稿与目标页**（`REQ-AUTH-001`） |
| 权限撤销 ≤5min 生效（`REQ-AUTH-003`） | 长停留页面（`RT-EDIT-001`/`RT-KB-001`/`RT-API-001`/`RT-CAP-001`）**每 60s 轻量重校验**（`API-PLAT-06`…见 §5；或任一写操作返回 403 兜底）。周期值 `[来源: 推断，待确认]` → `[待澄清-A04]` |

---

## 4 UI ↔ 接口对应关系表（★ 核心章节 · 第一优先级）

> **本表是端到端联调的契约**。规则：
> 1. 覆盖 `UI-Spec §5`《元素-数据需求表》**全部 84 行**所涉 `EL-*`（**展开为逐元素一行**），并补入**触发接口的元素**与**呈现接口驱动状态的元素**〔2026-10-21 本机落地后：78 → 80 行〕；
> 2. 每个 `API-PLAT-*` 都真实存在于 `接口-Spec §5.4`；**★ = 章节强调标记**（`#63`~`#68` 补口与字段级补口已于 2026-10-21 经 `P0-补口裁决单` **批准转正式基线**，不再是待确认草案）；**2026-10-21 本机落地的 `#71`/`#71a`/`#72`/`#72a` 属「本机开发阶段扩展」——未过门禁、未进入第 4 轮基线冻结范围**；
> 3. 响应字段名**逐字**照抄 `接口-Spec §5.0.3` / `§5.5` / `数据模型`，**不改写、不意译**；
> 4. **无空白格**：不走接口的元素也必须写明「本地/前端常量」及其失败语义（`接口-Spec §3.4` 已确立「静态文案 / 本地枚举 / 本地计时」三类不走接口）。

### 4.1 本地模型与请求参数来源（本表的两个缩写列）

**（a）本地模型 `MODEL-*`** —— 前端状态的规范化形态；**字段名逐字取自响应**（本表「响应字段 → 本地模型」列的右端即此表字段）。

| 本地模型 | 来源接口 | 字段（逐字） |
|---|---|---|
| `MODEL-AUTH-UI` | 无（前端常量） | `platformName`、`slogan`、`logoUrl` |
| `MODEL-AUTH-QRCODE` | `API-PLAT-063`★ | `qrcode_url`、`expires_in_seconds`、`state` |
| `MODEL-AUTH-SCAN` | `API-PLAT-064`★ | `scan_status`、`token` |
| `MODEL-USER` | `API-PLAT-066`★ | `user_id`、`nickname`、`avatar_url`、`role` |
| `MODEL-PROJECT-LIST` | `API-PLAT-001` | `items[].project_id`、`items[].name`、`items[].stage`、`items[].updated_at`、`page`、`page_size`、`total`、`has_more`、`sort`、`failed_parts[]` |
| `MODEL-PROJECT` | `API-PLAT-002`/`003`/`004` | `project_id`、`name`、`description`、`stage`、`current_revision_id`、`current_version_id`、`owner_user_id`、`created_at`、`updated_at`、`deleted_at` |
| `MODEL-PROJECT-STATS` | `API-PLAT-006` | `stage`、`current_revision_id`、`version_seq`、`running_tasks`、`loopback_round`、`gate{verdict,blocking_count,major_count,review_revision_id}`〔`current_revision_id` 与 `gate.review_revision_id` 为 2026-10-22 新增；其余按实现对齐〕 |
| `MODEL-KB-DOC-LIST` | `API-PLAT-007` | `items[].kb_doc_id`、`items[].title`、`items[].sector`、`items[].origin`、`items[].updated_at`、分页四项〔2026-10-22 按实现对齐：原 `doc_type`〕 |
| `MODEL-KB-DOC` | `API-PLAT-008`/`009` | `kb_doc_id`、`title`、`sector`、`content_md`、`origin`、`updated_at`、`version`；#8 另返回 `document_id:string\|null` 与 `content_hash:string`（服务端本次正文 SHA-256；#9 不声称返回该摘要） |
| `MODEL-REVISION-LIST` | `API-PLAT-013` | `items[].revision_id`、`items[].document_id`、`items[].parse_status`、`items[].created_at` |
| `MODEL-CHAT-MESSAGE` | `API-PLAT-025` + `API-PLAT-045`(`chat.delta`) | `message_id`、`seq`、`role`、**`content`**、`status`、`created_at`、**`thread_key`**、`delta` |
| `MODEL-TASK` | `API-PLAT-044` / `API-PLAT-045`(`task`) | `task_id`、`type`、`status`、`progress`、`seq`、`result_ref`、`error_code`、`started_at`、`finished_at`、`l2_result{reported,passed,log_digest}` |
| `MODEL-UPLOAD-FILE` | `API-PLAT-010`/`011` | `file_id`、`document_id`、`source_type`、`size_bytes`、`status`、`reject_reason` |
| `MODEL-PARSE-RESULT` | `API-PLAT-014` | `parse_status`、`parts.body.status`、`parts.tables[].token/.status`、`parts.whiteboards[].token/.status`、`parts.attachments[].name/.status`、`empty_document` |
| `MODEL-REVIEW` | `API-PLAT-017` | review_id/revision_id/standard_version/verdict/counts{blocking,major,suggestion}/superseded/model；**prd{revision_id,document_id,kb_doc_id,version,content_hash}或null**当前正文；loopback_round仍由#6提供，不发明#17字段 |
| `MODEL-REVIEW-ITEM` | `API-PLAT-018` | `item_code`、`group`、`group_title`、`level`、`verdict`、`evidence_ref`（string）、`suggestion`、`accepted`、`supplement`（缺省空串；#23 后落库回显；同文档链且当前正文存在才继承补充） |
| `MODEL-GATE-QUESTION` | `API-PLAT-019`/`020` | `question_code`、`level`、`title`、`options`、`fallback`、`answer`、`status`、`impact`★ |
| `MODEL-ASSUMPTION` | `API-PLAT-021` | `assumption_code`、`content`、`source_tag`、`choice` |
| `MODEL-GATE-STANDARD` | `API-PLAT-024` | `items[].code`、`items[].level`、`items[].title`、`version`、`is_current` |
| `MODEL-ROLE-PACKAGE` | `API-PLAT-029` | `items[].role`、`items[].req_ids[]` |
| `MODEL-TRACK-PLAN-ITEM` | `API-PLAT-059` | `items[].event_key`、`items[].trigger_desc`、`items[].params`、`items[].element_id`、`items[].status` |
| `MODEL-TRACE-ROW` | `API-PLAT-067`★ | `items[].req_id`、`items[].summary`、`items[].targets.ui/.api/.app/.track/.test`、`items[].coverage_status`、`items[].orphan`、`orphan_count` |
| `MODEL-PAGE` | `API-PLAT-035` | `items[].page_id`、`items[].name`、`items[].module_code`、`items[].order_index`、`items[].status` |
| `MODEL-ELEMENT-TREE` | `API-PLAT-036`/`037`/`038`/`035` | `element_id`、`alias`、`parent_element_id`、`order_index`、`widget_type`、`status`、`voided_at` |
| `MODEL-STYLE-PROPS` | `API-PLAT-039`（13 字段，`数据模型 E7`） | `width`、`height`、`background_color`、`text_color`、`text_size_sp`、`padding`、`margin`、`corner_radius_dp`、`border`、`alpha`、`align_h`、`align_v`、`visibility` |
| `MODEL-ELEMENT-EVENTS` | `API-PLAT-040` | `events[].event_type`、`events[].action_type`、`events[].action_payload` |
| `MODEL-ELEMENT-LEDGER` | `API-PLAT-041` | `items[].element_id`、`items[].alias`、`items[].status`、`items[].voided_at` |
| `MODEL-PAGE-DRAFT` | `API-PLAT-042` | `draft` |
| `MODEL-VERIFICATION` | `API-PLAT-049` / `API-PLAT-048` | `items[].layer`、`items[].status`、`items[].attempt`、`items[].evidence.checks[]{rule,ok,evidence}`、剩余重试次数 |
| `MODEL-ARTIFACTS` | `API-PLAT-047` | `artifacts[]`（源码 + `gradle wrapper` + 依赖版本锁定清单） |
| `MODEL-API-DEF` | `API-PLAT-050`/`051`/`052`/`053` | `api_id`、`code`、`name`、`method`、`path`、`status`、`updated_at`、`req_schema[]`、`resp_schema[]` |
| `MODEL-API-SCHEMA-FIELD` | `API-PLAT-051`/`053` | `name`、`type`、`required`、`length`、`precision`、`unit`、`desc` |
| `MODEL-VERSION` | `API-PLAT-054`/`055` | `version_id`、`project_id`、`seq`、`status`、`snapshot_ref`、`diff_ref`、`created_at`、`created_by_name`★、`summary`★、`artifacts[]`★ |
| `MODEL-DIFF-ROW` | `API-PLAT-056` | `path`、`left`、`right`、`change` |
| `MODEL-CAPABILITY` | `API-PLAT-058` | `items[].capability`、`items[].enabled`、`items[].code_status`、`items[].note`、`overall`、`failed[]`、`conflicts[]`★、`alignment_table[]`★ |
| `MODEL-AI-EGRESS` | `API-PLAT-068`★ | `egress_enabled`、`policy_text`、`disabled_reason`、`consent_acknowledged_at` |
| `MODEL-SPEC-DOC` | `API-PLAT-031`/`032` | `spec_id`、`role`、`status`、`stale`、`error_code`、`content_md` |
| `MODEL-SPEC-GEN-RESULT` | `API-PLAT-030` | `succeeded[]`、`failed[].role`、`failed[].error_code`、`overall` |
| `MODEL-PROOFREAD-ITEM` | `API-PLAT-034` | `items[].content`、`items[].can_loopback` |
| `MODEL-DELIVERABLE` | `API-PLAT-060`/`061` | `artifacts[]`、版本号 |
| `MODEL-WRITEBACK-DIFF` | `API-PLAT-023` | `deleted_lines` / `modified_lines` / `added_lines` / `diff_summary{deleted_lines,modified_lines,added_lines}` / `changed` / `new_revision_id` / `kb_doc_id` / `kb_version` / `content_hash` / `sections_added[]` / `snapshot` / `snapshot_id`；flat diff 与 diff_summary 同值，sections_added 不保证是新建标题 |
| `MODEL-TRACK-EVENT` | `API-PLAT-062`（上报）/ 本地 | `accepted`、`rejected[]`、**`event_name`**（`埋点-Spec §5` 规定**字段名逐字固定**）、`params` |
| `MODEL-AUTH-METHODS` ★本机落地 | `API-PLAT-072A`（`#72a`，2026-10-21） | `password_login`、`password_login_hint`、`feishu_login` |
| `MODEL-AUTH-PASSWORD` ★本机落地 | `API-PLAT-072`（`#72`，2026-10-21；**阶段性本地登录，生产关闭**） | `token`、`created`、`user`（`user` → `MODEL-USER`：`user_id`、`nickname`、`avatar_url`、`role`） |
| `MODEL-LLM-MODEL` ★本机落地 | `API-PLAT-071`（`#71`）/ `API-PLAT-071A`（`#71a`，2026-10-21） | `items[].id`、`items[].name`、`items[].description`、`items[].available`、`items[].reason`、`default_model`、`selected_model`、`effective_model` |

**（b）请求参数来源 `PARAM-*`** —— 每个参数写**它从哪儿来**（路由 / 本地状态 / 上一个响应 / 用户输入 / 常量）。

| 参数来源 | 定义 | 典型取值来源 |
|---|---|---|
| `PARAM-PROJ-ID` | 路由路径参数 `project_id` | `RT-*` 的 `/projects/{project_id}/…` |
| `PARAM-PAGE-ID` | 路由/画布当前页 | `MODEL-PAGE.items[].page_id`（`API-PLAT-035`） |
| `PARAM-ELEMENT-ID` | 画布当前选中元素（**归一化大写零填充**，`REQ-UIEDIT-009`） | `STORE-EDIT.selection`（画布 / 控件树**同一份数据**） |
| `PARAM-EDIT-TREE` | 元素树 + 样式 + 事件 + 元素 id 的**规范化序列化** | `MODEL-ELEMENT-TREE` + `MODEL-STYLE-PROPS` + `MODEL-ELEMENT-EVENTS` |
| `PARAM-LIST` | 统一列表状态机（`page`/`page_size`/`q`/`sort`） | 各页搜索框 / 排序下拉 / 分页器（`REQ-NF-004`） |
| `PARAM-AUTH-STATE` | `#63` 返回的 `state` | `MODEL-AUTH-QRCODE.state` |
| `PARAM-CONSENT` | 告知弹窗的确认动作 | `EL-GLOBAL-007` 点击 |
| `PARAM-PROJ-DRAFT` | 新建弹窗局部状态 | `EL-PROJ-038`/`EL-PROJ-040` 输入值 |
| `PARAM-PROJ-NAME-EDIT` | 行内重命名的输入值 | `EL-PROJ-019` |
| `PARAM-UPLOAD-FILE` | 已选本地文件（`File` 对象） | `EL-UPLOAD-005` / `EL-UPLOAD-003` 拖入 |
| `PARAM-FEISHU-LINK` | 飞书云文档链接 | `EL-UPLOAD-007` |
| `PARAM-DOC-ID` | `document_id` | 文件路径：`#10` 出参 `document_id`（`[缺口-APP-01]` **已闭合**，2026-10-21）；链接路径：`#11` 的 `data.document_id` |
| `PARAM-REVISION-ID` | `revision_id` | `#12` 的 `data.revision_id`；或 `#13` 列表选中项 |
| `PARAM-PART-KEY` | 手动补充的块标识 | `#14` 的 `parts.tables[].token` / `parts.whiteboards[].token` / `parts.attachments[].name` |
| `PARAM-REVIEW-ID` | `review_id` | `#16` 的 `data.review_id`；或 `#17` |
| `PARAM-ANSWER-DRAFT` | 页面内存答复态（不自动落盘） | EL-REVIEW-022；规范化后随 #23 answers[]，独立 #20 可保存但本页不在 blur 调用 |
| `PARAM-ACCEPT-CANDIDATES` | 已勾选「采纳」的条目集合 | `EL-REVIEW-013` 本地勾选 |
| `PARAM-STANDARD-ITEMS` | 门禁标准检查项编辑结果 | `EL-REVIEW-044`/`EL-REVIEW-045` |
| `PARAM-REQ-ID` | `REQ-<模块>-<三位>` | `#29` / `#67`★ / `#32` 正文内锚点 |
| `PARAM-KB-DOC-ID` | `kb_doc_id` | `#7` 列表项 |
| `PARAM-KB-DRAFT` | 知识库编辑中的 Markdown | `EL-KB-018` |
| `PARAM-API-DEF-ID` | `api_id` | `#50` 列表行 |
| `PARAM-API-SCHEMA-DRAFT` | 字段表编辑结果（`name/type/required/length/precision/unit/desc`） | `EL-API-019`~`EL-API-025` |
| `PARAM-VERSION-ID` | `version_id` | `#54` 列表项 / 路由 `?version=` |
| `PARAM-CAP-SWITCH` | 7 项能力的受控开关值 | `EL-CAP-007`，`capability` 固定 7 枚举 |
| `PARAM-SPEC-ROLE` | `spec_role` ∈ {`ui`,`api`,`app`,`track`,`test`} | `EL-SPEC-003`~`007` 当前 tab |
| `PARAM-SPEC-ID` | `spec_id` | `#31` 列表项 |
| `PARAM-DEPTH` | 拆解/审核深度档位（**项目级**） | `EL-SPLIT-005`；落点 = 项目级 `E1 Project.depth`（enum，默认 `standard`）；`#16`/`#28` 请求体**可带可选 `depth`**（已落 `接口契约`）→ 提交时**传当前档位** |
| `PARAM-MESSAGE-ID` | `message_id` | `#25` 列表项（失败态那条） |
| `PARAM-CHAT-DRAFT` | 待发送消息内容 | `EL-WORK-019` |
| `PARAM-TASK-ID` | `task_id` | `#12`/`#16`/`#26`/`#28`/`#30`/`#43` 的 202 响应 |
| `PARAM-INPUT-HASH` | 元素树 + 样式 + 事件 + 元素 id 的规范化哈希 | `PARAM-EDIT-TREE` 派生的 64 位摘要 |
| `PARAM-BASE-SEQ` | 客户端已应用的最新任务序号 | `STORE-GLOBAL/TASK.appliedSeq`（`REQ-GEN-006`） |
| `PARAM-IDEM-KEY` | `Idempotency-Key` | 同一次用户意图 **3s 内复用同一 key**（`REQ-NF-006`） |
| `PARAM-AUTH-CREDENTIAL` ★本机落地 | 账号密码登录入参 `{username,password}` | `EL-AUTH-018`/`EL-AUTH-019` 输入值；**仅内存持有，不落缓存、不入 URL / 日志 / 上报**（`REQ-AUTH-005`） |
| `PARAM-LLM-MODEL` ★本机落地 | 所选大模型 id（`#71a` 请求体 `{model}`） | `EL-GLOBAL-009` 下拉选中项的 `items[].id` |

### 4.2 对应关系表（逐元素 · **无空白格**）

> ⚠️ **小节数 ≠ 页面数**：本表小节为 **14 个**（`4.2.1`~`4.2.14`），其中 **`4.2.14` 是「应用外壳」**（跨 13 页共用的 `EL-GLOBAL-009` 大模型选择器），
> **不是第 14 个页面** —— `RT-*` 路由仍 **13 条**、`UI-*` 页面仍 **13 个**（见 §3 与 §1）。

> 列释义：**触发时机** = 该元素何时取数/发请求；**失败处理** = **失败时用户看到什么**（文案逐字引用 `UI-Spec`）。

#### 4.2.1 `UI-AUTH-001` / `RT-AUTH-001`（登录与鉴权 · 全局页）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-001`/`EL-AUTH-002`/`EL-AUTH-004`/`EL-AUTH-005` | 页面挂载即渲染 | 无（前端常量与静态资源） | 无 | 常量 → `MODEL-AUTH-UI.logoUrl/slogan` | 不适用（本地常量不失败） |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-003` | 页面挂载即渲染 | 无（前端常量） | 无 | 常量 `AutoDevelopment` → `MODEL-AUTH-UI.platformName` | 不适用 |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-006` | 页面首次进入 / 二维码过期 / 点 `EL-AUTH-008` | `API-PLAT-063`（`#63`，**已转基线**）** | 无（公开端点、无入参） | `data.qrcode_url`/`data.expires_in_seconds`/`data.state` → `MODEL-AUTH-QRCODE` | `UPSTREAM_UNAVAILABLE`/`RATE_LIMITED` → 「二维码加载失败。」+「刷新二维码」（`EL-AUTH-008`）；`EL-AUTH-007` 保持默认态 |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-007` | 取得二维码后每 **1.5s** 轮询，至 `confirmed`/`expired` | `API-PLAT-064`（`#64`，**已转基线**）** | `PARAM-AUTH-STATE` ← `MODEL-AUTH-QRCODE.state` | `data.scan_status`、`data.token` → `MODEL-AUTH-SCAN` | `NOT_FOUND`（`state` 失效）→ 「二维码已过期。」+ 显示 `EL-AUTH-008`；`UPSTREAM_TIMEOUT`/`UPSTREAM_UNAVAILABLE` → 指数退避续轮询（1.5s→3s→6s，封顶 15s），**界面不显示错误** |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-008` | 点击 | `API-PLAT-063`（`#63`）** | 无 | 同 `EL-AUTH-006` | 同 `EL-AUTH-006`；点击后 **1s 内禁用**（串行，允许但限流） |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-009` | `scan_status = confirmed` 后签发 token 期间 | `API-PLAT-064`（`#64`）** | `PARAM-AUTH-STATE` | `data.token` → `MODEL-AUTH-SCAN.token` → `STORE-GLOBAL/SESSION.token` | 超时/失败 → 转 `EL-AUTH-010` 错误态 |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-010`/`EL-AUTH-011` | `#64` 返回失败 / token 换取失败 / 网络异常 | `API-PLAT-064`（`#64`）** | `PARAM-AUTH-STATE` | `code`/`message`（**界面文案不取服务端 `message`**，取 `UI-Spec §4.1` 定稿） | 呈现「登录没成功，请重试。」+「重新扫码」；`RATE_LIMITED` → 倒计时后允许重试 |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-012` | 任意业务接口返回 **401 `UNAUTHENTICATED`** | 无独立接口（**全局响应包 `code`**，见 §6） | 无 | `code` → `STORE-GLOBAL/SESSION.sessionExpired = true` | 跳本页；文案「登录已过期，已为你保留未提交的内容。」；**恢复草稿** |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-013` | 点击 | `API-PLAT-063`（`#63`，重新认证起点）** | 无 | 同 `EL-AUTH-006` | 认证失败 → 停留本页 + `EL-AUTH-010`；成功后回 `?next=` 目标页并 Toast「已恢复上次未提交的改动。」 |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-014`/`EL-AUTH-015` | 任意业务接口返回 **403 `FORBIDDEN`** | 无独立接口（全局响应包 `code`） | 无 | `code` → `STORE-GLOBAL/SESSION.forbidden = true` | 「你没有权限访问这个项目。」+「返回上一级」；**不显示对象名、不提示是否存在** |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-016`/`EL-GLOBAL-003` | 未登录访问任意 `RT-*`（路由守卫先拦） | 无（本地会话态判定） | 无 | `STORE-GLOBAL/SESSION.token == null` → 遮罩可见 | **不渲染任何业务数据**（`REQ-AUTH-001`） |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-017`（**本机落地扩展**） | 页面挂载即取 `#72a`（**决定默认展示哪种登录方式**）/ 点击切换 | `API-PLAT-072A`（`#72a`，2026-10-21 本机落地） | 无（公开端点、无入参） | `data.password_login`、`data.feishu_login` → `MODEL-AUTH-METHODS`；两段文案 `账号密码` / `飞书扫码`（`UI-Spec §4.1 ④`） | **默认展示哪一段由 `#72a` 决定**：`password_login = true` → 默认落「账号密码」段（渲染 `EL-AUTH-018`~`021`）；`password_login = false` → **本控件整块不渲染**，直接呈现「飞书扫码」（`UI-Spec §4.1 ②`）；**切到「飞书扫码」才拉 `#63`**（避免白轮询）；`#72a` 本身失败 → **降级为只呈现「飞书扫码」，界面不显示错误**（不阻塞登录）；`feishu_login` 的**类型已冻结为 string 枚举 `real`/`development`**（`接口-Spec §5.4.13`），**不是 bool** —— 故默认段只由 `password_login` 决定；`#72a` 未给「默认登录方式」字段 → `[来源: 推断，待确认]`（App 侧暂取「账号密码」优先，**未自行裁决**） |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-018`（**本机落地扩展**） | 输入（本地）/ `Enter` 等价于点 `EL-AUTH-020` | 无（本地输入态；**提交时随 `API-PLAT-072` 出参**） | `PARAM-AUTH-CREDENTIAL.username` | 无（本地态）→ `STORE-AUTH.username`（**仅内存、不落缓存、不入 URL / 日志 / 上报**） | 空 → 前端先拦，**「字段级提示」** + 焦点回本框、描边 `C-04`（`UI-Spec §4.1 ②` 边界：用户名 / 密码为空 → 字段级提示；**该提示的逐字文案 `UI-Spec` 未定义 → 本 Spec 不编造**）；**不发起请求**；标签 `用户名`、占位 `请输入用户名` |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-019`（**本机落地扩展**） | 输入（密文）/ `Enter` 等价于点 `EL-AUTH-020` | 无（本地输入态；**提交时随 `API-PLAT-072` 出参**） | `PARAM-AUTH-CREDENTIAL.password` | 无（本地态）→ `STORE-AUTH.password`（**仅内存持有，任何情况下不落缓存、不进日志与埋点参数**） | 同 `EL-AUTH-018` 行（空值 → 字段级提示 + 不发起请求；**逐字文案未定义 → 不编造**）；标签 `密码`、占位 `请输入密码`、**密文显示** |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-020`（**本机落地扩展**） | 点击（或 `EL-AUTH-018`/`EL-AUTH-019` 回车） | `API-PLAT-072`（`#72`，2026-10-21 本机落地；**阶段性本地登录，生产关闭**：`AD_PASSWORD_LOGIN=disabled`） | `PARAM-AUTH-CREDENTIAL`（`{username,password}`）+ `PARAM-IDEM-KEY`（提交串行，3s 内复用） | `data.token`、`data.created`、`data.user` → `MODEL-AUTH-PASSWORD`；`token` → `STORE-GLOBAL/SESSION.token`，`user` → `MODEL-USER`；成功 `replace` 到 `?next=` 或 `RT-PROJ-001` | `UNAUTHENTICATED`（**凭据错误；「账号不存在」与「密码错误」同码同文案**）→ 复用 `EL-AUTH-010` 错误条「用户名或密码不正确。」（`UI-Spec §4.1 ④`，**不得提示账号是否存在**）；未启用或入参非法 → `INVALID_ARGUMENT` → 复用 `EL-AUTH-010` **显示服务端 `message`**；提交中按钮**禁用**、`Enter` 不可重复触发；网络异常 → 同上错误条（**保留已输入的用户名**，密码**不保留**） |
| `UI-AUTH-001` | `RT-AUTH-001` | `EL-AUTH-021`（**本机落地扩展**） | 页面挂载（随 `#72a` 一次性取回） | `API-PLAT-072A`（`#72a`，2026-10-21 本机落地） | 无（公开端点、无入参） | `data.password_login_hint` → `MODEL-AUTH-METHODS.passwordLoginHint`；渲染为 `本地开发登录：用户名可用任意合法值，密码为开发密码。`（**文案由服务端下发，前端不得硬编码**） | `password_login = false` 或 `password_login_hint` 为空 → **本提示条整块不渲染**（**不显示占位、不显示兜底文案**）；`#72a` 失败 → 同 `EL-AUTH-017` 行（降级为飞书扫码、不显示错误） |

#### 4.2.2 `UI-PROJ-001` / `RT-PROJ-001`（项目列表 / 新建）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-001`/`EL-PROJ-002` | 页面挂载即渲染 | 无（前端常量） | 无 | 常量 → `MODEL-AUTH-UI` | 不适用 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-006`（昵称 / 头像） | 登录成功后首次进入 | `API-PLAT-066`（`#66`，**已转基线**）** | 无 | `data.user_id`/`data.nickname`/`data.avatar_url`/`data.role` → `MODEL-USER` | `UNAUTHENTICATED` → 跳 `RT-AUTH-001`；`nickname` 缺省 → 「未命名用户」；`avatar_url` 缺省 → 默认头像 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-006`（下拉内「退出登录」） | 点击「退出登录」 | `API-PLAT-065`（`#65`，**已转基线**）** | 无 | 无业务数据（`code`/`message`）→ 清 `STORE-GLOBAL/SESSION` + 清缓存（§7） | `UNAUTHENTICATED` → 视为已登出，仍跳 `RT-AUTH-001`；网络失败 → 本地强制登出 + Toast |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-010`/`EL-PROJ-011` | 列表加载（首屏 / 翻页 / 搜索 / 排序变更） | `API-PLAT-001`（`#1`） | `PARAM-LIST`（`page`/`page_size`/`q`/`sort`） | `data.items[].project_id`、`data.items[].name` → `MODEL-PROJECT-LIST` | 失败 → `EL-PROJ-029`「项目列表没加载出来。」+「原因：服务暂时不可用（{code}）。」+「重试」；`failed_parts[]` 非空 → **顶部「部分加载」标记**（不得当作完整展示） |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-012` | 同上 | `API-PLAT-001` | `PARAM-LIST` | `data.items[].stage` → `MODEL-PROJECT-LIST.items[].stage`（17 态 → 中文，`数据模型 §3.1`） | 未知值（对端新增字段容忍）→ 「未知阶段」 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-013` | 同上 | `API-PLAT-001` | `PARAM-LIST` | `data.items[].updated_at` → `MODEL-PROJECT-LIST.items[].updatedAt` | `null` → 「时间未知」（**禁 `0` / `1970`**）；文案「最后更新于 {相对时间}」 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-014` | —（**展示项已移除**） | 无（`[拆解缺口-Q5]` **已闭合** 2026-10-21：`页面规格 §1.1` 已移除「元素 id 前缀示例」，`#1` 无对应字段） | — | —（**不渲染**） | 不适用（**本元素无数据需求**；`UI-Spec §5` 该行待同批移除） |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-034` | 同上 | `API-PLAT-001` | `PARAM-LIST` | `data.page`/`data.page_size`/`data.total` → `MODEL-PROJECT-LIST` | `total = 0` → 「共 0 个项目」；`page` 超总页数 → 空 `items` + **真实 `total`**，**不报错** |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-003`/`EL-PROJ-004` | 输入（防抖 **300ms**）/ 点击清除 | `API-PLAT-001` | `PARAM-LIST.q`（≤100 字符，**前端截断**） | 无独立字段（仅刷新 `MODEL-PROJECT-LIST`） | `INVALID_ARGUMENT` → 「每页最多 100 条。」→ 收起筛选、**保留已输入**；`q` 超长前端先截断 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-007` | 选择排序项 | `API-PLAT-001` | `PARAM-LIST.sort` ∈ {`updated_at:desc`,`created_at:desc`,`name:asc`} | `data.sort` → `STORE-PROJ.listQuery.sort` | 同 `EL-PROJ-010` 行；失败保留原排序 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-008` | 选择每页条数 | `API-PLAT-001` | `PARAM-LIST.page_size` ∈ {20,50,100}（`[冲突-UI-04]`，取 `REQ-NF-004` 三值） | `data.page_size` → `STORE-PROJ.listQuery.pageSize` | `INVALID_ARGUMENT`（`>100`）→ 「每页最多 100 条。」 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-009` | 列表加载 | `API-PLAT-001` | `PARAM-LIST` | `data.items[]` → `MODEL-PROJECT-LIST.items[]` | 同 `EL-PROJ-010` 行 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-015` | 点击 / 键盘 `Enter` | 无（**路由跳转 `RT-WORK-001`**） | `PARAM-PROJ-ID` ← 卡片 `project_id` | 无 | 目标页首请求 403 → 「你没有权限访问这个项目。」 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-016` | 点击 | `API-PLAT-007`（`#7`，**入口先鉴权**，`REQ-KB-002`） | `PARAM-PROJ-ID` | `code`（仅探测可见性）→ `STORE-KB.entryAllowed` | 403 → 统一无权限态「你没有权限访问这个项目。」（**不区分"不存在"与"无权限"**）；通过 → 跳 `RT-KB-001` |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-017` | 点击 | 无（切换为行内编辑） | 无 | 无 | 不适用 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-019` | `Enter` / 失焦提交 | `API-PLAT-004`（`#4`） | `PARAM-PROJ-ID` + `PARAM-PROJ-NAME-EDIT` + `If-Match: <version>` | 更新后的对象（`name`）→ `MODEL-PROJECT-LIST.items[].name` | **乐观更新失败回滚** + Toast「名称不能为空，长度 1~50。」；`VERSION_CONFLICT` → 统一冲突组件「该内容已被他人修改。」 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-018`/`EL-PROJ-043`~`EL-PROJ-047` | 点击删除 → 二次确认（**弹窗内需二次 Tab 到「删除」**） | `API-PLAT-005`（`#5`，⬛ 破坏性，**服务端亦须校验**） | `PARAM-PROJ-ID` + `body {confirm:true}`〔2026-10-22 语义核对销项〕 | `data.deleted_at` → 列表移除 + **清空该项目维度全部缓存**（§7） | 失败 → 保留卡片 + Toast；`INTERNAL` → 「出了点问题。」+「请把 request_id {id} 提供给我们。」+「重试」；403 → 统一无权限态 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-020`/`EL-PROJ-021`/`EL-PROJ-022`/`EL-PROJ-023` | 请求成功且 `total = 0` 且 **无搜索词** | `API-PLAT-001` | `PARAM-LIST`（`q` 为空） | `data.total = 0` + `data.items = []` → `STORE-PROJ.listState = empty` | 与「搜索无结果」**必须是两个不同状态**（`REQ-PROJ-002`，禁止用一个 `isEmpty` 判断） |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-024`/`EL-PROJ-025`/`EL-PROJ-026` | 请求成功且 `total = 0` 且 **`q` 非空** | `API-PLAT-001` | `PARAM-LIST.q` | `data.total = 0` + `data.items = []` → `STORE-PROJ.listState = no_match` | 文案「没有匹配「{关键词}」的项目。」+「清除搜索」 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-027`/`EL-PROJ-028` | 首屏 / 翻页请求进行中 | `API-PLAT-001` | `PARAM-LIST` | 无（pending 态）→ `STORE-PROJ.listState = loading` | 「正在加载项目…」（>3s 追加「还在加载，已用 {n} 秒…」）；骨架**静态无 shimmer** |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-029`/`EL-PROJ-030` | 列表请求失败（503/504/500） | `API-PLAT-001` | `PARAM-LIST` | `code`/`message`‑> `STORE-PROJ.listError.code` | 「项目列表没加载出来。」+ 原因 +「重试」；`RATE_LIMITED` → 「请求太频繁，{n} 秒后重试。」+ 倒计时 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-031` | 列表请求返回 403 | `API-PLAT-001` | `PARAM-LIST` | `code = FORBIDDEN` → `STORE-PROJ.listState = forbidden` | 「你没有权限查看这些项目。」+「返回」（**不透露对象是否存在**） |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-032`/`EL-PROJ-033`/`EL-PROJ-035` | 点击翻页 | `API-PLAT-001` | `PARAM-LIST.page`（首页禁用「上一页」，末页禁用「下一页」） | `data.page`/`data.total`/`data.has_more` → `MODEL-PROJECT-LIST` | `page` 超总页数 → 空 `items` + 真实 `total`，**不报错** |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-036`~`EL-PROJ-038`/`EL-PROJ-040` | 打开弹窗（局部状态） | 无（局部状态） | `PARAM-PROJ-DRAFT` | 无 | 不适用 |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-041` | 点击「确定」 | `API-PLAT-002`（`#2`） | `PARAM-PROJ-DRAFT.name/description` + `PARAM-IDEM-KEY`（3s 内复用） | `data.project_id`/`data.name`/`data.stage`/`data.created_at` → `MODEL-PROJECT` + 列表**局部插入首位** | `INVALID_ARGUMENT` → `EL-PROJ-039`「项目名不能为空，长度 1~50。」**保留已填内容**；`IDEMPOTENT_REPLAY` → **无提示**，采用首次结果；`RATE_LIMITED` → 倒计时；失败**不停留在提交中** |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-PROJ-039` | 提交返回 400 | `API-PLAT-002` | —（响应驱动） | `message` + `data.field` → `STORE-PROJ.createFieldError` | 字段级错误展示；**输入内容全部保留**、输入框描边 `C-04` |
| `UI-PROJ-001` | `RT-PROJ-001` | `EL-GLOBAL-001`（Toast） | 各动作成功/失败回调 | 复用上述接口 | 无（复用上述接口的入参，本元素无独立请求参数） | 本地文案 → Toast 队列 | 成功：`项目已创建` / `名称已更新` / `项目已删除，30 天后彻底清除`；失败：`名称不能为空，长度 1~50。` |

#### 4.2.3 `UI-KB-001` / `RT-KB-001`（知识库）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-KB-001` | `RT-KB-001` | `EL-KB-001`/`EL-KB-003`/`EL-KB-004`~`EL-KB-008` | 页面挂载即渲染（分区 Tab 为常量 4 项） | 无（前端常量） | 无 | 常量 → `STORE-KB.tabs` | 不适用 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-002` | 页面首次进入 | `API-PLAT-003`（`#3`） | `PARAM-PROJ-ID` | `data.name` → `MODEL-PROJECT.name` | 缺省 → 「未命名项目」；`FORBIDDEN` → 统一无权限态；`NOT_FOUND` → 「这个内容已经不在了。」+「返回上一级」 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-009` | 输入（防抖）/ 清除 | `API-PLAT-007`（`#7`） | `PARAM-LIST.q`（≤100 字符） | 无独立字段（刷新 `MODEL-KB-DOC-LIST`） | 无匹配 → 「没有匹配「{关键词}」的内容。」+「清除搜索」 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-010` | 首次进入 / 切换分区 / 搜索 | `API-PLAT-007` | `PARAM-PROJ-ID` + `PARAM-LIST` | `data.items[]` + `page`/`page_size`/`total`/`has_more` → `MODEL-KB-DOC-LIST` | 403 → 「你没有权限访问这个项目。」+「返回」；失败 → `EL-KB-023`「知识库没加载出来。」+「重试」；`failed_parts[]` 非空 → 部分加载标记 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-011` | 同上 | `API-PLAT-007` | `PARAM-LIST` | `data.items[].title` → `MODEL-KB-DOC-LIST.items[].title` | 缺省 → 「（无标题）」 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-012` | 同上 | `API-PLAT-007` | `PARAM-LIST` | `data.items[].origin` → `MODEL-KB-DOC-LIST.items[].origin`（→「平台抽取」/「你编辑过」/「你上传的」） | 未知值 → 「未知来源」 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-013` | 同上 | `API-PLAT-007` | `PARAM-LIST` | `data.items[].updated_at` → `MODEL-KB-DOC-LIST.items[].updatedAt` | `null` → 「时间未知」（文案「更新于 {相对时间}」） |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-014` | 点击「编辑」 | `API-PLAT-008`（`#8`） | `PARAM-KB-DOC-ID` | `data.content_md` → `MODEL-KB-DOC.contentMd` | `NOT_FOUND` → 「这个内容已经不在了。」+「返回上一级」；进入编辑态后焦点落 `EL-KB-018` |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-017` | 选中文档 / 非编辑态 | `API-PLAT-008` | `PARAM-KB-DOC-ID` | `data.content_md` → `MODEL-KB-DOC.contentMd`（**Markdown 渲染、转义 HTML、不执行标签**） | 空串 → 「这份文档还没有内容。」 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-018`/`EL-KB-019` | 点击「保存」 | `API-PLAT-009`（`#9`） | `PARAM-KB-DOC-ID` + `PARAM-KB-DRAFT` + `If-Match: <version>` | 更新后的对象（`content_md`、`origin = user_edited`）→ `MODEL-KB-DOC` | `VERSION_CONFLICT` → 「该内容已被他人修改。」+ diff + 「以我的为准」/「放弃我的改动」（**统一冲突组件**，与 `UI-API-001`/`UI-CAP-001` 共用，`REQ-NF-003`）；保存中按钮禁用 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-020` | 点击「取消」 | 无（本地） | 无 | 丢弃 `PARAM-KB-DRAFT` → 回 `MODEL-KB-DOC` | 有未保存改动才二次确认：「放弃这次编辑？」+「你改过的内容不会保存。」 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-015`/`EL-KB-016` | 展开 PRD 分区 | `API-PLAT-013`（`#13`） | `PARAM-DOC-ID` | `data.items[].revision_id`、`data.items[].parse_status`、`data.items[].created_at` → `MODEL-REVISION-LIST` | 空 → 空态；`created_at` 为 `null` → 「时间未知」；点「查看」只读，**不覆盖、不弹确认**（`REQ-UPLOAD-005`） |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-021` | 请求成功且 `total = 0` 且无关键词 | `API-PLAT-007` | `PARAM-PROJ-ID` | `data.total = 0` → `STORE-KB.listState = empty` | 「知识库还是空的。上传 PRD 后，平台会自动把内容抽进来。」+ CTA「上传 PRD」（**新项目空库不报错**） |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-022` | 首次进入 / 切分区请求中 | `API-PLAT-007` | `PARAM-PROJ-ID` | pending → `STORE-KB.listState = loading` | 「正在加载知识库…」+ 骨架列表 ×5（静态） |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-023` | 接口失败 | `API-PLAT-007` | `PARAM-PROJ-ID` | `code` → `STORE-KB.listError` | 「知识库没加载出来。」+「重试」 |
| `UI-KB-001` | `RT-KB-001` | `EL-KB-024` | 逐对象鉴权失败（403） | `API-PLAT-007`/`008`/`009` | `PARAM-PROJ-ID` | `code = FORBIDDEN` → `STORE-KB.listState = forbidden` | 「你没有权限访问这个项目。」+「返回」（**不透露是否存在**） |
| `UI-KB-001` | `RT-KB-001` | `EL-GLOBAL-001`（Toast） | 保存成功 | `API-PLAT-009` | 无（复用上述接口的入参，本元素无独立请求参数） | 本地文案 | 「知识库内容已保存」 |

#### 4.2.4 `UI-WORK-001` / `RT-WORK-001`（工作台 · 顶部状态条 + 左栏容器；**对话已改为全局悬浮对话框**，见下注）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-001`/`EL-WORK-009`/`EL-WORK-013`/`EL-WORK-010`~`012` | 页面挂载即渲染（分段控件为本地视图态，**不落库**） | 无（前端常量/视图态） | 无 | `STORE-GLOBAL/URL.mode` ∈ {`edit`,`preview`} | 不适用（切换**不得丢未提交改动**，见 §5.4） |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-002` | 页面首次进入 | `API-PLAT-003`（`#3`） | `PARAM-PROJ-ID` | `data.name` → `MODEL-PROJECT.name` | 缺省 → 「未命名项目」；`FORBIDDEN` → 统一无权限态 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-003` | 首次进入 / **订阅 SSE `task` 事件刷新（不轮询）** / 从其他页返回 | `API-PLAT-006`（`#6`） | `PARAM-PROJ-ID` | `data.stage` → `MODEL-PROJECT-STATS.stage`（17 态 → 中文） | 失败 → 状态条字段降级为「—」占位 + 顶栏黄条「连接已断开，正在重连…」；未知值 → 「未知阶段」 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-004` | 同上 | `API-PLAT-006` | `PARAM-PROJ-ID` | `data.gate.verdict`、`data.gate.blocking_count` → `MODEL-PROJECT-STATS.gate.verdict/gate.blocking_count`〔2026-10-22 按实现对齐〕 | `verdict="unreviewed"` → 「未审核」；`blocking_count` 与「未知」由 `verdict` 区分 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-005` | 同上 | `API-PLAT-006`（或 `API-PLAT-054`） | `PARAM-PROJ-ID` | `data.version_seq` → `MODEL-PROJECT-STATS.versionSeq`〔2026-10-22 按实现对齐〕 | **`version_seq = 0` → 「尚无版本」**（实现用 `0` 作哨兵；前端判 `> 0` 才显示 `v{n}`） |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-006` | 同上 | `API-PLAT-006` | `PARAM-PROJ-ID` | `data.running_tasks` → `MODEL-PROJECT-STATS.runningTasks`〔2026-10-22 按实现对齐〕 | `0` → 「没有进行中的任务」（`0` 是零、不是未知） |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-007` | 点击「知识库」 | `API-PLAT-007`（`#7`，**固定入口 ②**，先鉴权） | `PARAM-PROJ-ID` | `code` → `STORE-KB.entryAllowed` | 403 → 「你没有权限访问这个项目。」 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-008` | 页面首次进入 | `API-PLAT-066`（`#66`，**已转基线**）** | 无 | `data.nickname`/`data.avatar_url`/`data.role` → `MODEL-USER` | `UNAUTHENTICATED` → 跳 `RT-AUTH-001`；缺省 → 「未命名用户」/ 默认头像 |
> **2026-10-22 载体变更（含复核修正）**：`EL-WORK-013`~`EL-WORK-023`（对话容器与内部元素）**不再驻留在工作台右栏**，改为**全局悬浮对话框**：
> **进入项目后（新建项目及以后的各子步骤）显示、默认打开**，右下角可拖动面板，`Esc`/收起按钮收起；**项目列表页不显示**（未进入项目时 `projectId` 为空 → 不渲染）。
> **对象 = Project**（面板头部显示项目名）；**线程 = 项目内的子步骤** —— `#25`/`#26` 带 `thread`（`workbench`/`kb`/`upload`/`review`/`split`/`editor`/`specs`/`apis`/`capabilities`/`versions`），**切换子步骤即换一个对话框**；
> 顶部「切换对话」列出本项目**有消息的线程**（含条数）可**切回原对话**，手选偏离当前步骤时给「回到当前步骤」。
> 下表各行的**宿主路由随当前页面变化**（`page_rt` 取实际路由，不再是固定 `RT-WORK-001`）。
> 另：**「AI 处理过程」与消息共用一个列表**〔2026-10-22 口径〕—— agent 的步骤（SSE `ai.step`；任务生命周期 + 大模型调用）作为**列表条目**与用户/平台消息**按时间混排**在同一条时间线里（`at` = 该步**首次发生**时刻，同 `step_id` 原地更新；**刷新/重连后由服务端补发**；按项目、不按线程）。

| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-014` | 页面首次进入（**历史随项目加载**，按 `seq` **升序**） | `API-PLAT-025`（`#25`） | `PARAM-PROJ-ID` + `PARAM-LIST`（**`seq` 升序**，与全站默认 `updated_at:desc` 不同） | **`data.thread`**（回显生效线程；未给 `thread` 时为 `null`）+ `data.items[].message_id`、`.seq`、`.role`、**`.content`**、`.status`、**`.thread_key`**、`.created_at` → `MODEL-CHAT-MESSAGE[]` | 空 → `EL-WORK-030` 空态；失败 → `EL-WORK-029`「对话没加载出来。」+「重试」；403 → 统一无权限态 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-031`/`032`/`034` | 收起 / 关闭 / 回到当前步骤 | **无**（纯前端视图态） | 无 | `STORE-CHAT.open` / `STORE-CHAT.picked` | 不适用；**收起 ≠ 结束会话**（草稿与滚动位置保留）〔2026-10-22〕 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-033` | 打开「切换对话」 | `API-PLAT-025`（`#25`，**不给 `thread`** → 返回全部线程） | `PARAM-PROJ-ID` | `data.items[].thread_key` 分组 → 线程列表 + 条数 | 无任何线程 → 选择器**禁用**〔2026-10-22〕 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-035` | 收到 SSE `ai.step` | `API-PLAT-045`（SSE **`ai.step`**） | `PARAM-PROJ-ID` | `data.{step_id,task_id,kind,title,detail,model,status,progress,duration_ms,phase,at}` → **对话时间线里的步骤条目** | 同 `step_id` **原地更新**（**`at` 为首次发生时刻**，不刷新）；步骤**与消息按时间混排在同一条列表**；无步骤 → **不出现条目**；**不含正文**〔2026-10-22 口径：共用一个列表〕 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-015`/`EL-WORK-016` | 历史加载 / 流式增量 | `API-PLAT-025` + `API-PLAT-045`（SSE `chat.delta`） | `PARAM-PROJ-ID` | `data.items[].role`/**`.content`**/`.status`；SSE `data.message_id`/`data.seq`/`data.delta`/**`data.thread_key`** → `MODEL-CHAT-MESSAGE` | **`content`** **按 Markdown 渲染并转义 HTML**；流式按 `delta` **增量合并**（不整段重绘导致跳动） |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-017` | 消息 `status = failed`（60s 超时）→ 点击「重发」 | `API-PLAT-027`（`#27`） | `PARAM-MESSAGE-ID` ← 失败项 `message_id` | 同一 `message_id`（**不重复入库**）→ `MODEL-CHAT-MESSAGE.status` | `UPSTREAM_TIMEOUT` → 保持失败态「这条没发出去。」+「重发」；不得新增一条记录 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-018` | SSE `chat.delta` 持续到达 | `API-PLAT-045`（SSE `chat.delta`） | SSE 连接随 `RT-WORK-001` 挂载建立（`PARAM-PROJ-ID`） | `data.delta` 增量并入 `MODEL-CHAT-MESSAGE.content` | 断线 → `EL-WORK-024`「连接已断开，正在重连…」+ 自动重连 + **按 `seq` 取最新**；降级 2s 轮询 `API-PLAT-044` 时**界面无差别** |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-019`/`EL-WORK-022` | 点击「发送」/ `Enter`（无 `Shift`） | `API-PLAT-026`（`#26`，⚡ 202） | `PARAM-CHAT-DRAFT`（≤20000 字符）+ `PARAM-IDEM-KEY` | `data.message_id`、`data.seq` → 追加 `MODEL-CHAT-MESSAGE`（`status = sent`） | 空内容 → `INVALID_ARGUMENT` → **输入框抖动（240ms）+「先说点什么再发送。」，不发起请求**；超长 → 「消息最多 20000 字符，当前 {n} 字符。」；3s 内连点**只入库一条**；`UPSTREAM_TIMEOUT` → 「这条没发出去。」+「重发」 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-020` | 空消息被拦截 | 无（前端先拦，`REQ-CHAT-001`） | `PARAM-CHAT-DRAFT` 为空 | 无 → `STORE-WORK.emptySendHint = true` | 文案「先说点什么再发送。」；**同时触发输入框抖动**；**不产生接口调用** |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-021` | 输入超 20000 字符 | 无（前端先拦） | `PARAM-CHAT-DRAFT` 长度 | 无 → `STORE-WORK.overLengthHint = true` | 「消息最多 20000 字符，当前 {n} 字符。」；**保留已输入内容** |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-023` | 点击「停止生成」 | `API-PLAT-044A`（`#44a`） | `PARAM-TASK-ID` ← `MODEL-TASK.taskId` | `data.status = canceled` → `MODEL-TASK.status` | 非 `running` → 400 `INVALID_ARGUMENT`（提示当前状态）；**界面回编辑态、预览保持上次成功结果、不呈现为错误态、不计重试**（`REQ-GEN-005`） |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-024` | SSE 连接断开 | `API-PLAT-045`（`#45`） | SSE 端点 `PARAM-PROJ-ID` | 无（本地连接态）→ `STORE-GLOBAL/TASK.sseState` | 「连接已断开，正在重连…」；连续失败 → 指数退避 + **降级 2s 轮询 `API-PLAT-044`**；断线期间**允许继续操作** |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-025` | SSE `task` 事件（`queued`/`running`）或降级轮询 | `API-PLAT-045` / `API-PLAT-044` | `PARAM-TASK-ID` | `data.task_id`/`.type`/`.status`/`.progress`/`.seq` → `MODEL-TASK` | 超 **5min** → `timeout` 可重试失败态（**不静默卡死**）；`TASK_STALE` → **静默丢弃** + 「已为你使用最新一次生成的结果。」；旧 `seq` 响应**不应用** |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-026` | 首次进入 / 状态条刷新 | `API-PLAT-006` | `PARAM-PROJ-ID` | `data.stage` → 前端**常量映射表**（9 节点，**不走接口**） | 未知阶段 → 全部节点置灰；未到达阶段点击 → 置灰 + 原因「先完成上一步：{上一步名}。」（**不做静默降级**） |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-027` | 点击「上传 PRD」 | 无（路由跳转 `RT-UPLOAD-001`）；**首次上传前先过 `EL-GLOBAL-004`** | `MODEL-AI-EGRESS.consent_acknowledged_at`（本地会话态） | 无 | 未确认 → 弹告知弹窗，**不发起跳转**（`REQ-AUTH-004`） |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-028` | 对话历史请求中 | `API-PLAT-025` | `PARAM-PROJ-ID` | pending → `STORE-WORK.chatState = loading` | 「正在加载对话…」 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-029` | 对话接口失败 | `API-PLAT-025` | `PARAM-PROJ-ID` | `code` → `STORE-WORK.chatState = error` | 「对话没加载出来。」+「重试」 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-WORK-030` | `items = []` | `API-PLAT-025` | `PARAM-PROJ-ID` | `data.items = []` → `STORE-WORK.chatState = empty` | 「还没有对话。说说要改什么，或回答平台的问题。」 |
| `UI-WORK-001` | `RT-WORK-001` | `EL-GLOBAL-004`（首次生成前触发） | 对话触发的生成入口被点击 | `API-PLAT-068`（`#68`，PUT，**已转基线**）** | `PARAM-CONSENT` | `data.consent_acknowledged_at` → `MODEL-AI-EGRESS.consentAcknowledgedAt` | 写入失败 → 弹窗内错误条「确认状态没保存成功。」+ 按钮恢复可用；`egress_enabled = false` → 生成入口置灰 + 「你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。」+「去开启」（`EL-CAP-021`） |

#### 4.2.5 `UI-UPLOAD-001` / `RT-UPLOAD-001`（上传页）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-001`/`EL-UPLOAD-002`/`EL-UPLOAD-003`/`EL-UPLOAD-004`/`EL-UPLOAD-006` | 页面挂载即渲染 | 无（前端常量） | 无 | 常量 → `STORE-UPLOAD.staticCopy` | 不适用 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-005` | 选择文件（本地） | 无（本地 `File` 对象；**前端先校验**，`REQ-UPLOAD-002`） | `PARAM-UPLOAD-FILE` | `File.size`/`File.name` + 前端页数估算 → `STORE-UPLOAD.pendingFiles[]` | 格式/体积/页数不合格 → `EL-UPLOAD-028`/`029`/`030` 三条独立错误条，**不进入列表、不产生半成品记录** |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-010`/`EL-UPLOAD-011` | 选入 / 拖入 / 移除 | 无（本地列表） | `PARAM-UPLOAD-FILE` | 本地 → `STORE-UPLOAD.pendingFiles[]` | 不适用 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-012` | 上传响应返回后回填 | `API-PLAT-010`（`#10`） | 无（响应回填） | `data.size_bytes` → `MODEL-UPLOAD-FILE.sizeBytes`（展示 `{n} MB`，1 位小数） | 上传中先用本地 `File.size`；服务端回填**以服务端为准** |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-013` | 点击「移除」 | 无（本地移出；已上传条目移除需确认） | `PARAM-UPLOAD-FILE` | 无 → `STORE-UPLOAD.pendingFiles` 移除 | 不适用 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-007`/`EL-UPLOAD-008`/`EL-UPLOAD-009` | 失焦即校验 / 随「开始解析」提交 | `API-PLAT-011`（`#11`） | `PARAM-FEISHU-LINK` | `data.document_id`、`data.source_type` → `MODEL-UPLOAD-FILE.documentId/sourceType` | 无效链接 → 「链接无效或已失效。」；无权限 → 「平台没有这篇文档的访问权限。」+「去飞书授权」（**两条不同文案**）；`UPSTREAM_TIMEOUT` → 「上游服务响应超时（{n}s）。」+「重试」；`UPSTREAM_UNAVAILABLE` → 「服务暂时不可用（{code}）。」+「重试」 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-014` | 点击「开始解析」（**首次上传前先过 `EL-GLOBAL-004`**） | `API-PLAT-010`（`#10`，`multipart`）→ `API-PLAT-012`（`#12`，⚡ 202） | `PARAM-UPLOAD-FILE` + `PARAM-IDEM-KEY`；`document_id` = `PARAM-DOC-ID`（**文件路径的 `document_id` = `#10` 出参 `document_id`**；`[缺口-APP-01]` **已闭合**） | `data.file_id`/`data.size_bytes`/`data.status`/`data.reject_reason` → `MODEL-UPLOAD-FILE`；`data.task_id`/`data.revision_id` → `MODEL-TASK`/`MODEL-REVISION-LIST` | `PAYLOAD_TOO_LARGE` → 「文件超过 20MB（当前 {n}MB）。请压缩后重试。」；`FORMAT_UNSUPPORTED` → 「暂不支持该格式。请上传 .docx / .md 或飞书云文档链接。」；**★`UPSTREAM_UNAVAILABLE`（外发开关关闭）** → 「你已关闭「PRD 与代码外发大模型」，上传后的解析暂不可用。可在「能力配置」里重新打开。」（**不得静默降级**）；`IDEMPOTENT_REPLAY` → 采用首次结果 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-015`/`EL-UPLOAD-016` | 上传过程中（XHR `upload.onprogress`） | `API-PLAT-010`（**服务端不推上传进度**，`接口-Spec §5.5.5`） | 本地 `loaded`/`total` | 无（本地计算 0~100）→ `STORE-UPLOAD.progress` | 中断 → `EL-UPLOAD-031`「上传中断了。」+「重试」；**不产生半成品记录** |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-017`/`EL-UPLOAD-018` | 解析任务终态 / 轮询 | `API-PLAT-014`（`#14`） | `PARAM-REVISION-ID` | `data.parts.body.status`、`data.parse_status` → `MODEL-PARSE-RESULT` | `failed` → 「没取到」（⚠ 图标 + 文字）；`skipped` → 「跳过」；`ok` → 「已取到」（✓） |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-019` | 同上 | `API-PLAT-014` | `PARAM-REVISION-ID` | `data.parts.tables[].token`、`data.parts.tables[].status` → `MODEL-PARSE-RESULT` | 同上；**无表格 → `[]` 而非缺字段**（不显示为失败） |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-020` | 同上 | `API-PLAT-014` | `PARAM-REVISION-ID` | `data.parts.whiteboards[].token/.status` → `MODEL-PARSE-RESULT` | 同上 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-021` | 同上 | `API-PLAT-014` | `PARAM-REVISION-ID` | `data.parts.attachments[].name/.status` → `MODEL-PARSE-RESULT` | 同上 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-022` | 本地计时 > 30s（基准取 `#44` 的 `started_at`） | `API-PLAT-044`（`#44`） | `PARAM-TASK-ID` | `data.started_at` → 本地计时基准 | `≤30s` **不显示**；超时 → 可重试失败态（**不静默卡死**） |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-023`/`EL-UPLOAD-024` | `parse_status = partial`（**HTTP 200 + `code = "OK"`，非错误**） | `API-PLAT-014` | `PARAM-REVISION-ID` | `data.parts.*` 中 `status = failed` 的项 → `MODEL-PARSE-RESULT.failedParts[]` | **顶部标黄**「解析完成，但有 {n} 处没取到：」+ 逐条清单；**不得显示为完全成功**；`partial` 是**独立终态**（不是错误态、不是成功态） |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-025` | 点击「手动补充」（仅 `partial` 出现） | `API-PLAT-015`（`#15`） | `PARAM-REVISION-ID` + `PARAM-PART-KEY` ← `parts.tables[].token` / `parts.whiteboards[].token` / `parts.attachments[].name` | 该块的 `status` → `ok` → `MODEL-PARSE-RESULT` | `INVALID_ARGUMENT` → 字段级提示 + **保留输入**；`NOT_FOUND` → 「这个内容已经不在了。」+「返回上一级」 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-026` | 解析任务 `failed` / `timeout` | `API-PLAT-014` / `API-PLAT-044` | `PARAM-REVISION-ID` / `PARAM-TASK-ID` | `data.parse_status` / `data.error_code` → `STORE-UPLOAD.parseState = failed` | 「解析失败了。」+「原因：{可读原因}。」+「重试」 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-027` | `succeeded` 且 `empty_document = true` | `API-PLAT-014` | `PARAM-REVISION-ID` | `data.empty_document` → `STORE-UPLOAD.parseState = empty_document` | 「这是个空文档，没有可解析的内容。」（**非错误态，无危险色**；与解析失败区分） |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-028` | 前端预校验 / `#10` 返回 | `API-PLAT-010` | `PARAM-UPLOAD-FILE` | `data.reject_reason` / `code = FORMAT_UNSUPPORTED` | 「暂不支持该格式。请上传 .docx / .md 或飞书云文档链接。」（**不写入记录**） |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-029` | 同上 | `API-PLAT-010` | `PARAM-UPLOAD-FILE` 的 `File.size` | `code = PAYLOAD_TOO_LARGE` | 「文件超过 20MB（当前 {n}MB）。请压缩后重试。」 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-030` | 同上 | `API-PLAT-010` | 前端页数估算 | `data.reject_reason`（超 100 页） | 「文档超过 100 页（当前 {n} 页）。请拆分后分批上传。」 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-031` | 上传中断（网络） | `API-PLAT-010` | `PARAM-UPLOAD-FILE` | 无（本地网络态）→ `STORE-UPLOAD.uploadState = interrupted` | 「上传中断了。」+「重试」；**不产生半成品记录** |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-UPLOAD-032`/`EL-UPLOAD-033` | 页面进入 / 解析完成 | `API-PLAT-013`（`#13`） | `PARAM-DOC-ID` | `data.items[].revision_id`、`data.items[].created_at`（**倒序**）→ `MODEL-REVISION-LIST` | 空 → 空态；时间 `null` → 「时间未知」；点查看**不覆盖、不弹确认** |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-GLOBAL-004`（首次上传前） | 点「开始解析」时拦截 | `API-PLAT-068`（`#68`，PUT，**已转基线**）** | `PARAM-CONSENT` | `data.consent_acknowledged_at` → `MODEL-AI-EGRESS.consentAcknowledgedAt` | 未点「我已知悉，继续」→ 弹窗关闭、**不发起上传**；写入失败 → 「确认状态没保存成功。」 |
| `UI-UPLOAD-001` | `RT-UPLOAD-001` | `EL-GLOBAL-001`（Toast） | 上传完成 / 解析全部成功 | `API-PLAT-010` / `API-PLAT-014` | 无（复用上述接口的入参，本元素无独立请求参数） | 本地文案 | 「文件已上传，开始解析。」/「解析完成」（全部成功后**自动跳 `RT-REVIEW-001`**） |

#### 4.2.6 `UI-REVIEW-001` / `RT-REVIEW-001`（审核结果页 · 含门禁标准抽屉）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-001`/`EL-REVIEW-002` | 页面挂载即渲染 | 无（前端常量） | 无 | 常量 | 不适用 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-003` | 页面进入 / 审核任务完成 / SSE `task` 终态 | `API-PLAT-017`（`#17`） | `PARAM-REVIEW-ID` | `data.verdict`、`data.counts.blocking` → `MODEL-REVIEW.verdict/counts` | 未开始 → `EL-REVIEW-039`「还没开始审核。」+「开始审核」；`superseded = true` → 走**独立「已过期」视图**（`EL-REVIEW-033`，**不参与放行判定**，不得与「未通过」混淆） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-004` | 同上 | `API-PLAT-017` | `PARAM-REVIEW-ID` | `data.revision_id` → `MODEL-REVIEW.revisionId` | 缺省 → 「未知版本」 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-005` | 同上 | `API-PLAT-017` | `PARAM-REVIEW-ID` | `data.standard_version` → `MODEL-REVIEW.standardVersion` | 缺省 → 「未知版本」 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-006`/`EL-REVIEW-007` | 页面进入 / 提交复审后重新拉取 | `API-PLAT-018`（`#18`，**分页**；条目数 = 按 `standard_version` 的全部检查项，**不写死「43 项」**） | `PARAM-REVIEW-ID` + `PARAM-LIST` | `data.items[]` → `MODEL-REVIEW-ITEM[]`（按 A~I 九类分组） | 空 → 「暂无内容」；失败 → `EL-REVIEW-041`「审核没跑完。」+ 原因 +「重试」，**已出的部分结果保留展示** |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-008` | 同上 | `API-PLAT-018` | `PARAM-REVIEW-ID` | `data.items[].gate_code` → `MODEL-REVIEW-ITEM.gateCode` | 缺省 → 该行不渲染（**无证据的判定不得输出**） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-009` | 同上 | `API-PLAT-018` | `PARAM-REVIEW-ID` | `data.items[].level` → `MODEL-REVIEW-ITEM.level`（`blocking`→「阻断」/`major`→「重要」/`suggestion`→「建议」） | 未知值 → 按「建议」中性呈现（不静默丢弃该行） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-010` | 同上 | `API-PLAT-018` | `PARAM-REVIEW-ID` | `data.items[].verdict` → `MODEL-REVIEW-ITEM.verdict` | 文字 + 图标（✓ / ✕，**不只靠颜色**） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-012` | 同上 | `API-PLAT-018`（`#18` 逐项含 `gate_code`/`level`/`verdict`/`evidence_ref`；**`suggestion` 未在出参中显式列出**） | `PARAM-REVIEW-ID` | `data.items[].suggestion`（字段级待接口补全）→ `MODEL-REVIEW-ITEM.suggestion` | 字段缺失 → 该行**不显示建议区**（不编造文案） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-053` | fail 行默认展开，输入 trim 非空自动勾选 | 回显 #18；写入 #23 supplements[] | item_code/text，仅随 accepted_items | supplement | 写回前内存，写回后落库；仍 fail 时继承已写入说明但不免审；用户可取消采纳 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-054` | 〔2026-10-26〕切换（即时生效并落盘） | **无接口调用**（**设备级**界面偏好，取数/落盘走 `localStorage['ad.v1.device.reviewAuto']`，见 §7） | — | 本地偏好态；**开** → 进页无报告自动开审 + 回写后自动重审 | 默认**开**；**自动发起的审核不报 `EVT_review_submit`**（`埋点-Spec §3.12`）；空态 / 过期态 / 底部操作条三处同一控件 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-011` | 同上 | `API-PLAT-018` | `PARAM-REVIEW-ID` | `data.items[].evidence_ref{chapter,line}` → `MODEL-REVIEW-ITEM.evidenceRef` | 该行**无 `evidence_ref` 时不返回**（不补空证据）；点击跳原文，行号不存在 → 「这条证据的原文已变更，请重新审核。」 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-013`/`EL-REVIEW-014` | 勾选采纳/一键采纳 | #22仅批量勾选不写PRD | item_codes | accepted | 有建议或补充可勾；全采纳按钮canWrite=false disabled，成功立即弹EL28；旧unset定位函数保留但禁用正常点击不触发 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-015`/`EL-REVIEW-016` | 页面进入 | `API-PLAT-019`（`#19`，分页） | `PARAM-REVIEW-ID` + `PARAM-LIST` | `data.items[]` → `MODEL-GATE-QUESTION[]`（按 `level` 分三组） | 空 → `EL-REVIEW-038`「没有待澄清项，可以直接进入拆解。」+「进入需求拆解」 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-017`/`EL-REVIEW-018` | 同上 | `API-PLAT-019` | `PARAM-REVIEW-ID` | `data.items[].question_code`、`data.items[].title` → `MODEL-GATE-QUESTION` | 缺省 → 该条不渲染 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-019` | 同上 | `API-PLAT-019` | `PARAM-REVIEW-ID` | `data.items[].options` → `MODEL-GATE-QUESTION.options`（**A~E + `X. Other`**） | 选项缺失 → 该条不可作答并高亮（不得静默跳过） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-020` | 同上 | `API-PLAT-019` | `PARAM-REVIEW-ID` | `data.items[].fallback` → `MODEL-GATE-QUESTION.fallback` | 缺省 → 「未定义」 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-021` | 同上 | `API-PLAT-019`（`impact`，**已转基线**） | `PARAM-REVIEW-ID` | `data.items[].impact` → `MODEL-GATE-QUESTION.impact` | **已闭合**：`#19` 出参提供 `impact`，正常显示（按 `UI-Spec §5` 兜底口径），并挂 `[缺口-API-02]` |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-022` | 输入（含假设下 convert 复用） | 本地内存态；确认 #23 answers[]；独立 #20 仍存在 | question_code + 规范化答案 | answerDrafts，与问题区/假设下框同源 | 当前不在 blur 调 #20、不自动恢复离页草稿；__other/空白不算已答，失败保留页面输入 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-023`/`EL-REVIEW-024` | 页面进入 | `API-PLAT-021`（`#21`，GET） | `PARAM-REVIEW-ID` | `data.items[].assumption_code`/`.content`/`.source_tag`/`.choice` → `MODEL-ASSUMPTION[]` | 空 → 该区块隐藏；`source_tag` 原样显示（含 `[assumption]`） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-025` | 选择 `accept` / `convert` | `API-PLAT-021`（`#21`，POST） | `PARAM-REVIEW-ID` + `assumption_code` + `choice` ∈ {`accept`,`convert`} | `choice` → `MODEL-ASSUMPTION.choice` | **`choice = unset` 不允许留空**：存在 `unset` → 生成入口禁用 + 「还有 {n} 条假设没有选择，先逐条选完再继续。」（前端拦截 + 服务端 400 双保险） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-052` | 点击写回已勾选（n项） | 不调 #22，弹 #23 确认 | 本地 accepted+answers | EL-REVIEW-028 | canWrite=false 禁用；n=0且无规范化非空答复才禁用；0项可只写答复 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-026`/`EL-REVIEW-050` | 可用后点击→确认 | #16 force:true | 当前 revision/depth/幂等键 | review_id/task_id | `disabled = !reviewId \|\| !!documentError \|\| busy \|\| blockingOpen>0 \|\| unset>0 \|\| dirty \|\| !revisionChanged`；`busy = writing \|\| deciding \|\| loading`，`revisionChanged = 当前 PRD revision !== 报告 revision`。未答阻断按规范化后的答案判定，`dirty` 比较当前答复/补充与已加载的落库值；**评分项 `fail` 本身不是禁用条件**，修正后仍必须调用模型复审，不可静默免审。禁用不发 #16、不弹窗；force 服务端只兜底同 revision 既有报告阻断/unset |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-027` | 点击「导出审核报告」 | `API-PLAT-069`（`#69`，GET，**需鉴权、不含密钥**） | `PARAM-PROJ-ID` + `PARAM-REVIEW-ID` | 报告文件流 → 浏览器直接下载（**不写本地模型、不入缓存**） | 成功 → Toast「审核报告已导出」（`UI-Spec §4.6` Toast ③）；`FORBIDDEN` → 统一无权限态；失败 → **可重试失败态**（**不呈现为成功**）；**导出内容不含密钥与内部凭据**（`REQ-GEN-010` 口径） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-028`~`EL-REVIEW-032` | 确认写入 | #23 后 GET #8 | confirm/snapshot=true + accepted_items + supplements[] + optional answers[] | `deleted_lines` / `modified_lines` / `added_lines` / `diff_summary{deleted_lines,modified_lines,added_lines}` / `changed` / `new_revision_id` / `kb_doc_id` / `kb_version` / `content_hash` / `sections_added[]` / `snapshot` / `snapshot_id` | `#23` 在一次事务中保存规范化答复、采纳集合、有效补充、原文快照；正文有变化才更新知识库 version 并产生同 document_id 的新 revision、作废旧审核。`#23` 成功后用返回的 `kb_doc_id` 调 `GET #8`，回读 `doc.version === kb_version`、`doc.content_hash === #23.content_hash`，并逐条确认补充正文存在。**#8 的 content_hash 由服务端对本次返回的 content_md 算 SHA-256**；前端仅比对返回字段，兼容 192.168 局域网 HTTP，不依赖浏览器安全上下文或客户端摘要 API。仅 `changed=true` 且核验成功、自动开关为开才发 `#16 force:true`；缺字段/GET8失败/版本或hash不匹配/正文缺补充 → documentError，停止自动复审并禁用手动复审与写回，不得手动绕过；`changed=false` 不生新版本、不自动重审。保存中禁止关闭/取消，失败不宣称生效 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-033`/`EL-REVIEW-034` | **进页**：`#6` 的 `gate.review_revision_id ≠ data.current_revision_id`（PRD 出新 revision） | `API-PLAT-006`（`#6`，判定用）+ `API-PLAT-016`（点「重新审核」，**带 `force:true`**） | `PARAM-PROJ-ID` / `PARAM-REVISION-ID` | `data.current_revision_id`、`data.gate.review_revision_id` → 判「已过期」 | 「这份评分卡已过期（PRD 已更新到 {revision}）。」+「重新审核」；**已过期视图不参与放行判定**；**进页只提示、不自动开审**〔2026-10-22〕；superseded提示入口disabled=!canSubmit，独立phase=stale入口disabled=writing \|\| deciding \|\| !!documentError，核验失败不得手动绕过 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-035` | 点提交复审且阻断未答 | 〔2026-10-23〕**无接口调用**（前端预检）；`API-PLAT-019` / `API-PLAT-016` 的 400 仅为**绕过兜底** | `PARAM-REVIEW-ID` | 〔2026-10-23〕`code = INVALID_ARGUMENT` + 未答条目 → `STORE-REVIEW.blockingOpen`（**仅绕过兜底时**；主路径为前端预检、无接口调用） | 「还有 {n} 项阻断没有作答，无法进入拆解。」；点击高亮并跳转对应条目 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-036` | 页面进入 / 每轮复审后 | `API-PLAT-017`（`loopback_round`，**已转基线**） | `PARAM-REVIEW-ID` | `data.loopback_round` → `MODEL-REVIEW.loopbackRound` | 字段缺省 → 显示「第 0/3 轮」；**已闭合**（`#6` 出参提供 `loopback_round`） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-037` | 回流轮次 > 3 时出现 | **轮次来源 `API-PLAT-006`（`#6` `GET /projects/{id}/stats` → `loopback_round`，**项目级**；`[缺口-API-03]` 已裁决，**`#17` 不含该字段**）** + 「接受并记录」→ `API-PLAT-028`（`#28`，进入拆解）；「中止」→ `API-PLAT-070`（`#70`，⬛ POST，**归档并终止本流程**） | `PARAM-PROJ-ID` | `data.loopback_round`（**来自 `API-PLAT-006`**，非 `#17`）→ `MODEL-REVIEW.loopbackRound` | 「接受并记录」失败 → 保留已出的部分结果 + 可重试；「中止」→ **二次确认后**调用（`⬛` 破坏性，服务端亦校验），成功后**本流程归档并终止**（回 `RT-WORK-001`），失败 → 可重试失败态且**当前流程保持不变**（不部分成功）；二选一**必须可判定**（`REQ-REVIEW-008`） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-038` | 待澄清清单为空 | `API-PLAT-019` | `PARAM-REVIEW-ID` | `data.items = []` → `STORE-REVIEW.questionsState = empty` | 「没有待澄清项，可以直接进入拆解。」+「进入需求拆解」（**与「尚未审核」区分**） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-039` | 无 `ReviewReport` | `API-PLAT-016`（`#6` 的 `gate.verdict="unreviewed"` 先行判定） | `PARAM-REVISION-ID` | `code = OK` + `data.review_id` → `STORE-REVIEW` | 「还没开始审核。」+「开始审核」（点后调 `API-PLAT-016`，带 **`force:true`** —— 这是用户主动开审） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | 页面进入（**三态判定**） | 页面进入 | `API-PLAT-006`（`#6`，**先探状态**） | `PARAM-PROJ-ID` | ① `gate.verdict="unreviewed"` → 空态（`EL-REVIEW-039`）；② `gate.review_revision_id ≠ current_revision_id` → 已过期（`EL-REVIEW-033`）；③ 其余 → `API-PLAT-016`（`#16`，**不带 `force`**） | ③：`data.reused=true` + `task_id` 可能为 `null` → **不新建、不作废、不调模型**，直接用 `review_id` 拉 `#17`/`#18`/`#19`/`#21`；`task_id` 非空（上次仍在跑）→ 照常轮询该任务至终态〔2026-10-22 决策 D-1〕 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-040` | 审核任务 `running` | `API-PLAT-044` / `API-PLAT-045` | `PARAM-TASK-ID` | `data.status`/`data.progress` → `MODEL-TASK` | 「正在审查这份 PRD…」；**>5min 追加**「已超过 5 分钟，可以继续等待或稍后回来查看。」 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-041` | 审核任务失败 / 超时 | `API-PLAT-044` / `API-PLAT-016` | `PARAM-TASK-ID` | `data.error_code` → `STORE-REVIEW.errorCode` | 「审核没跑完。」+「原因：{…}。」+「重试」；**已出的部分结果保留展示** |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-042` | agent 输出畸形（自动重试 1 次仍失败） | `API-PLAT-044`（`data.error_code`）/ `API-PLAT-017`（`verdict = failed`） | `PARAM-TASK-ID` | `data.error_code` → `STORE-REVIEW.errorCode` | 「平台的输出格式不对，已自动重试一次仍失败。」+「需人工确认」→ **提示态 + 人工入口**，不自动重试到死、不静默丢弃 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-043`/`EL-REVIEW-044`/`EL-REVIEW-045`/`EL-REVIEW-048` | 点 `EL-REVIEW-049` 打开抽屉（**`?drawer=gate-standard`**） | `API-PLAT-024`（`#24`，GET） | 无（**项目级**：`#24` 已在项目作用域下；`[拆解缺口-Q3]` **已闭合** 2026-10-21） | `data.items[].code`/`.level`/`.title`、`data.version`、`data.is_current` → `MODEL-GATE-STANDARD` | 空清单 → 「还没有检查项。」；`FORBIDDEN` → 统一无权限态（`EL-REVIEW-049` **仅管理员可见**） |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-046`/`EL-REVIEW-047` | 点「保存」 | `API-PLAT-024`（`#24`，PUT，**需 admin**） | `PARAM-STANDARD-ITEMS` + `If-Match: <version>` | `data.version` → `MODEL-GATE-STANDARD.version` | `INVALID_ARGUMENT` → 字段级提示 + **保留输入**；`VERSION_CONFLICT` → 统一冲突组件；`FORBIDDEN` → 统一无权限态；**保存成功后版本号必须回显**「门禁标准已保存（v{n}）。历史评分不重算。」 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-049` | 点开户入口 | `API-PLAT-066`★（`data.role`，判断管理员可见性） | 无 | `data.role` → `MODEL-USER.role` | 非管理员 → 入口不渲染（**不做"点了没反应"**）；角色缺失 → 默认隐藏 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-051`（**本机落地扩展**） | 页面进入 / 审核任务完成（随 `#17` 一并返回，不单独发请求） | `API-PLAT-017`（`#17`，出参**本机落地新增 `model`**） | `PARAM-REVIEW-ID` | `data.model` → `MODEL-REVIEW.model`；渲染为 `模型：{model}`（`UI-Spec §5`） | `model` 为空（历史数据）→ **整块不渲染**（`UI-Spec §5` 该行兜底；**不显示「未知模型」等占位文案**）；`#17` 本身失败 → 同 `EL-REVIEW-003` 行（「还没开始审核。」/「审核没跑完。」+「重试」） |

| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-055` | 「查看当前 PRD」/「查看已写入正文」入口 | #17 prd 与 #8 当前正文（按钮打开本地 Drawer） | 当前 doc/revision 或页面条件 | savedPrd / content_md | 无新增 API；不访问原始上传文件，异常停止自动复审 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-056` | 当前 PRD 正文 Drawer（含关闭） | #8 当前正文缓存 | 当前 doc/revision 或页面条件 | savedPrd / content_md | 无新增 API；不访问原始上传文件，异常停止自动复审 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-057` | 当前 PRD 标题、知识库版本及 revision 元信息 | #17 prd + #8 title/version | 当前 doc/revision 或页面条件 | savedPrd / content_md | 无新增 API；不访问原始上传文件，异常停止自动复审 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-058` | 「在知识库中打开」精确文档深链 | #17/#23 kb_doc_id，导航后 KbPage #7/#8 | 当前 doc/revision 或页面条件 | savedPrd / content_md | 无新增 API；不访问原始上传文件，异常停止自动复审 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-059` | 当前 PRD Markdown 正文 | #8 content_md | 当前 doc/revision 或页面条件 | savedPrd / content_md | 无新增 API；不访问原始上传文件，异常停止自动复审 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-060` | 提交复审暂不可用及原因 | reviewState.reviewSubmitReasons（本地条件） | 当前 doc/revision 或页面条件 | submitReasons / writeNotice / documentError | 无新增 API；不访问原始上传文件，异常停止自动复审 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-061` | 写回核验成功/无变化通知 | #23 回执与 #8 核验 | 当前 doc/revision 或页面条件 | submitReasons / writeNotice / documentError | 无新增 API；不访问原始上传文件，异常停止自动复审 |
| `UI-REVIEW-001` | `RT-REVIEW-001` | `EL-REVIEW-062` | 正文读取/写回核验错误 | #8/#23 异常与核验错误 | 当前 doc/revision 或页面条件 | submitReasons / writeNotice / documentError | 无新增 API；不访问原始上传文件，异常停止自动复审 |

#### 4.2.7 `UI-SPLIT-001` / `RT-SPLIT-001`（需求拆解页 · 含追溯矩阵抽屉）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-001`/`EL-SPLIT-002`/`EL-SPLIT-004` | 页面挂载即渲染 | 无（前端常量） | 无 | 常量 | 不适用 |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-003` | 点「重新拆解」→ `EL-SPLIT-014` 二次确认后提交 | `API-PLAT-028`（`#28`，⬛ ⚡ 202，**同项目同时刻只允许一个**） | `PARAM-PROJ-ID` + `PARAM-DEPTH`（默认取 `E1 Project.depth`，**可显式传 `depth`**，`#28` 已支持）+ `PARAM-IDEM-KEY` | `data.task_id` → `MODEL-TASK` | **409**（已有在跑）→ `EL-SPLIT-015`「上一次拆解还没结束。」+ 按钮禁用；`RATE_LIMITED` → 倒计时；旧 Spec 转「已归档」展示（**不删除**） |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-005`/`EL-SPLIT-006`/`EL-SPLIT-007` | 切换档位（本地）/ 提交拆解时带出 | `API-PLAT-028`（`#28`）/ `API-PLAT-016`（`#16`）（**请求体均可带可选 `depth`**） | `PARAM-DEPTH` ← `EL-SPLIT-005` | 无（档位为**项目级 `E1 Project.depth`**；本 Spec 不自创字段） | 落点已定（`[拆解缺口-Q6]` **已闭合** 2026-10-21）：前端可切、**提交时传当前档位**；不传 → 服务端取项目级 `E1 Project.depth` |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-008` | 页面进入 / 拆解任务完成 | `API-PLAT-029`（`#29`，**分页**） | `PARAM-PROJ-ID` + `PARAM-LIST` | `data.items[]` → `MODEL-ROLE-PACKAGE[]` | 失败 → `EL-SPLIT-017`「拆解失败了。」+「重试」；403 → 统一无权限态 |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-009` | 同上 | `API-PLAT-029` | `PARAM-PROJ-ID` | `data.items[].role` → `MODEL-ROLE-PACKAGE.role`（**固定 5 值**：`ui`/`api`/`app`/`track`/`test`） | 多出/缺少角色 → 只渲染已知 5 值，其余不渲染（**不得自造角色**） |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-010` | 同上 | `API-PLAT-029` | `PARAM-PROJ-ID` | `data.items[].req_ids[]` → `MODEL-ROLE-PACKAGE.reqIds` | 该角色 `req_ids = []` → `EL-SPLIT-012`「这一角色没有拆出需求。」+「回到对话补充」 |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-011` | 点击展开/收起 | 无（本地视图态，**无动效**） | 无 | 无 | 不适用 |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-012` | 某角色包为空 | `API-PLAT-029` | `PARAM-PROJ-ID` | `data.items[].req_ids = []` → `STORE-SPLIT.emptyRoles[]` | 文案同上；「回到对话补充」→ 跳 `RT-WORK-001`（**不视为错误**） |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-013` | 页面进入 / 展开摘要 | `API-PLAT-059`（`#59`） | `PARAM-PROJ-ID` + `PARAM-LIST` | `data.items[].event_key`、`data.items[].trigger_desc` → `MODEL-TRACK-PLAN-ITEM[]` | 空 → 「还没有埋点方案。」；**埋点方案不在此处配置**（与 `REQ-UIEDIT-004` 是两条独立路径） |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-014` | 二次确认弹窗 | 无（本地，确认后调 `API-PLAT-028`） | 无 | 无 | `Esc` 同效取消 |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-015` | 已有进行中拆解任务时再次触发 | `API-PLAT-028` 的 409 分支 | `PARAM-PROJ-ID` | `code`（409）→ `STORE-SPLIT.rejected = true` | 「上一次拆解还没结束。」（**不做静默降级**） |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-016` | 拆解任务 `running` | `API-PLAT-044` / `API-PLAT-045` | `PARAM-TASK-ID` | `data.status`/`data.progress` → `MODEL-TASK` | 「正在按角色拆分需求…」+ 骨架卡片 ×5；超 5min → 可重试失败态 |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-017` | 拆解任务失败 / 接口失败 | `API-PLAT-044` / `API-PLAT-029` | `PARAM-TASK-ID` / `PARAM-PROJ-ID` | `data.error_code` → `STORE-SPLIT.errorCode` | 「拆解失败了。」+「重试」 |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-018` | 无拆解结果 | `API-PLAT-029` | `PARAM-PROJ-ID` | `data.total = 0` → `STORE-SPLIT.state = empty` | 「还没有需求包。」+「开始拆解」（点后调 `API-PLAT-028`） |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-SPLIT-019`/`EL-SPLIT-020`/`EL-SPLIT-021` | 点 `EL-SPLIT-004` 打开抽屉（**`?drawer=trace`**） | `API-PLAT-067`（`#67`，**已转基线**）** | `PARAM-PROJ-ID` + `PARAM-LIST` + `coverage_status`（筛选四态之一） | `data.items[].req_id`/`.summary`/`.targets.ui/.api/.app/.track/.test`/`.coverage_status`/`.orphan`、`data.orphan_count` → `MODEL-TRACE-ROW[]` | 入口可用；加载失败 → 「追溯矩阵没加载出来。」+「重试」；**四态覆盖状态由接口给出、前端只渲染**（`REQ-SPEC-004`，**不得前端自行估算**）；**不允许留空** |
| `UI-SPLIT-001` | `RT-SPLIT-001` | `EL-GLOBAL-001`（Toast） | 拆解任务成功终态 | `API-PLAT-044` | 无（复用上述接口的入参，本元素无独立请求参数） | 本地文案 | 「拆解完成，共 {n} 条需求。」 |

#### 4.2.8 `UI-EDIT-001` / `RT-EDIT-001`（可视化编辑页 · 画布）★ 本期核心

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-001`/`EL-EDIT-003`/`EL-EDIT-036` | 面板挂载即渲染 | 无（前端常量） | 无 | 常量（10 个分组名） | 不适用 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-002` | 输入（**本地过滤**） | 无（**控件面板本地筛选、不走接口**，`REQ-UIEDIT-010` + `接口契约 §0.3`） | 本地 37 项枚举（`数据模型 §4`） | 本地常量 → `STORE-EDIT.controlFilter` | 无匹配 → 「没有这个控件。」+「清除搜索」 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-004` | 面板渲染 / 拖拽入画布 | 无（面板项为**本地静态数据**）；拖入落点 → `API-PLAT-036`（`#36`，id **由服务端集中分配**） | `widget_type`（37 项之一）+ `parent_element_id` + `order_index` + `alias` + `temp_id` + `PARAM-IDEM-KEY` | `data.element_id`（**归一化大写零填充**）/`data.status`/`data.order_index` → `MODEL-ELEMENT-TREE` | 落点非法（画布外 / 层级不合法）→ **前端先拦** + `EL-EDIT-012`「这个位置放不了：{原因}。」；第 201 个 → `EL-EDIT-013`「单页最多 200 个控件。」+ 拒收；`INVALID_ARGUMENT` → 「这个容器不能再放控件。」/「不支持的控件类型。」（服务端二次校验）；**id 未返回前不写入本地元素树**（只持临时 id） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-005`/`EL-EDIT-006`/`EL-EDIT-008`/`EL-EDIT-009`/`EL-EDIT-011` | 画布渲染 / 选中 / 拖拽 / 方向键微调 | 无（画布基准 360dp、1dp=3px 为**前端渲染约定，接口不承载**）；**样式改动仅本地渲染**（`D-Q12`） | `PARAM-PAGE-ID` + `PARAM-ELEMENT-ID` | 无（本地视图态与选中态）→ `STORE-EDIT.selection` | 不适用；**selection 是一个状态**，同时驱动画布框 + 手柄 + 控件树高亮（**三重表达同源**） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-007`/`EL-EDIT-048` | 页面元素数为 0 | `API-PLAT-035`（`#35`） | `PARAM-PAGE-ID` | `data.items[].page_id` 无元素 → `STORE-EDIT.tree = []` | 「这个页面还是空的。」+「从左边拖一个控件进来试试。」（**空态，不是错误态**） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-010`/`EL-EDIT-020` | 元素创建后 / 选中元素后 | `API-PLAT-036`（新建时返回）/ 元素详情 | `PARAM-ELEMENT-ID` | `data.element_id` → `MODEL-ELEMENT-TREE.elementId` | 复制失败（剪贴板被拒）→ Toast 提示手动复制；**只显示归一化大写零填充形式** |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-013` | 第 201 个控件 | `API-PLAT-036` 的 400 分支 | `PARAM-PAGE-ID` | `code = INVALID_ARGUMENT` → `STORE-EDIT.limitHint` | 「单页最多 200 个控件。」（**前端先拦 + 服务端再校验**） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-014`/`EL-EDIT-015`/`EL-EDIT-016` | 页面进入 / 过滤输入 / 跨层级拖拽 | `API-PLAT-035`（`#35`）→ 元素列表；调整层级/顺序 → `API-PLAT-037`（`#37`） | `PARAM-PAGE-ID`；`PATCH` 入参：`alias`/`parent_element_id`/`order_index` | `data.items[].page_id`/`.module_code` → `MODEL-PAGE`；`element_id`/`alias`/`parent_element_id`/`order_index` → `MODEL-ELEMENT-TREE` | `VERSION_CONFLICT` → 统一冲突组件；跨层级非法 → **拒收 + 给出原因**；**永不出现孤儿节点**；树与画布**同一份数据**（接口不得出现第二份元素树） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-017`/`EL-EDIT-040`/`EL-EDIT-043`~`EL-EDIT-047` | 点击删除 → 二次确认「删除」 | `API-PLAT-038`（`#38`，⬛ DELETE） | `PARAM-ELEMENT-ID` | `data.status = void`、`data.voided_at` → `MODEL-ELEMENT-TREE.status` | `FORBIDDEN` → 统一无权限态；失败 → 保留节点 + Toast；**节点置 `void` 并从渲染树移除，但 id 台账可查、不可复用** |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-018` | 控件树为空 | `API-PLAT-035` | `PARAM-PAGE-ID` | `data` 无元素 → `STORE-EDIT.tree = []` | 「画布上还没有控件。从左边控件面板拖一个进来。」 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-019`/`EL-EDIT-021`/`EL-EDIT-022` | 选中元素后渲染属性行 | 元素详情（`API-PLAT-035` 的元素列表出参 / `API-PLAT-039` 回执） | `PARAM-ELEMENT-ID` | `MODEL-STYLE-PROPS` 的 **13 字段**（`数据模型 E7`）；**行清单以 `§F14` 为准，本 Spec 不写死** | 未选中控件 → 面板整体置灰 + 「先在画布上选中一个控件。」 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-023` | 改值（**画布即时生效，仅本地渲染，不触发任务**） | 无（本地）；提交前由 `API-PLAT-039` 二次校验 | `PARAM-ELEMENT-ID` + `PARAM-EDIT-TREE` | 无 → `STORE-EDIT.styleDraft` | 非法输入 → 字段级红框 + `EL-EDIT-029`；**已输入内容全部保留** |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-024` | 切换尺寸模式 | 同上（本地） | `size.mode` ∈ {`dp`,`wrap_content`,`match_parent`} | 无 → `STORE-EDIT.styleDraft.width/height` | 切到 `dp` 时 `value` 必填 1~2000，否则字段级提示 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-025` | 选色 | 同上（本地） | `#RRGGBB`（**只接受 6 位**） | 无 → `STORE-EDIT.styleDraft.background_color/text_color` | 「色值只能是 #RRGGBB 六位。」；`#FFF` 与 `#FFFFFF` **视为不同**并拒绝 3 位 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-026` | 输入百分比 | 同上（本地） | `alpha` 0~100 整数（**界面按百分比**） | 无 → `STORE-EDIT.styleDraft.alpha` | 「透明度只能是 0~100。」 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-027` | 选择对齐 | 同上（本地） | `align_h` ∈ {`left`,`center`,`right`}；`align_v` ∈ {`top`,`center`,`bottom`} | 无 → `STORE-EDIT.styleDraft.align_h/align_v` | 不适用（受控选择，无非法值） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-028` | 选择可见性 | 同上（本地） | `visibility` ∈ {`visible`,`invisible`,`gone`} | 无 → `STORE-EDIT.styleDraft.visibility` | 不适用 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-029` | `API-PLAT-039` 返回 422/400 | `API-PLAT-039`（`#39`，**服务端二次校验**，客户端不得假设本地合法即合法） | `PARAM-ELEMENT-ID` + `PARAM-EDIT-TREE` | `message` + `data.field` + `data.received` → `STORE-EDIT.fieldErrors[]` | 字段级提示 + **保留已输入**；文案逐字：「宽只能是 1~2000dp，或选「自适应 / 撑满」。」/「字体大小只能是 8~72sp。」/「内边距只能是 0~200dp。」/「圆角只能是 0~200。」/「边框线宽只能是 0~10dp。」/「这里不能填负数。」；`VERSION_CONFLICT` → 统一冲突组件 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-030` | 切换四边联动锁 | 无（本地视图态） | 无 | 无 → `STORE-EDIT.linkSides` | 不适用 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-031`/`EL-EDIT-032`/`EL-EDIT-033`/`EL-EDIT-034`/`EL-EDIT-035` | 勾选三类事件（**可并存**）→ 保存事件配置 | `API-PLAT-040`（`#40`，≤3 条） | `PARAM-ELEMENT-ID` + `events[].event_type` ∈ {`click`,`long_click`,`double_click`} + `action_type`（**本期仅 `none`**） + `action_payload`（`null`） | `data.events[].event_type`/`.action_type`/`.action_payload` → `MODEL-ELEMENT-EVENTS` | `>3 条` → 400 `INVALID_ARGUMENT`；**面板内不得出现跳转目标 / 接口参数 / 埋点参数控件**（约束 4）；`action_type` 显示「暂无动作（TODO）」；同时配点击+双击 → **300ms** 内第二次点击判双击并**取消单击回调** |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-035` | 已配事件时 | `API-PLAT-040` | `PARAM-ELEMENT-ID` | `data.events[].action_type = none` → 常量文案 | 「暂无动作（TODO）」；并提示「后续要配跳转或调接口，走右侧对话补充。」 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-037` | 点击「提交变更」（**首次生成前先过 `EL-GLOBAL-004` + 检查外发开关**） | `API-PLAT-043`（`#43`，⚡ 202） | `input_hash`（`PARAM-INPUT-HASH`）+ `base_seq`（`PARAM-BASE-SEQ`）+ `PARAM-IDEM-KEY` | `data.task_id`、`data.seq` → `MODEL-TASK`；**立即回编辑态但状态条显示「生成中」** | `TASK_STALE` → **静默丢弃** + 「已为你使用最新一次生成的结果。」；`IDEMPOTENT_REPLAY` → 返回首次 `task_id`，无提示；`RATE_LIMITED` → 「请求太频繁，{n} 秒后重试。」+ 倒计时（**不重复提交**）；**★外发开关关闭** → 「你已关闭「PRD 与代码外发第三方大模型」，生成不可用。可在「能力配置」里重新打开。」（**按钮置灰 + 原因，不得点了没反应**） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-038`/`EL-EDIT-039` | 点击撤销 / 重做 | 无（本地草稿栈） | `STORE-EDIT.undoStack`/`redoStack` | 无 | 栈空 → 按钮禁用 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-041` | 刷新/关闭/会话过期后重新进入且存在未提交草稿 | `API-PLAT-042`（`#42`，GET，**服务端草稿双保险**）+ 本地草稿 | `PARAM-PAGE-ID` | `data.draft` → `MODEL-PAGE-DRAFT` | 「已恢复上次未提交的改动。」；会话过期恢复需**重新认证后自动续接**；`VERSION_CONFLICT` → 统一冲突组件（**绝不静默丢弃**） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-042` | L2 未回传 | `API-PLAT-044`（`#44`）/ `API-PLAT-046`（`#46`） | `PARAM-TASK-ID` | `data.l2_result.reported = false` → `MODEL-TASK.l2Result.reported` | 「未验证构建」灰字 + 悬浮说明「本地构建结果尚未回传；不影响你继续使用。」；**不阻断任何操作** |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-049` | 打开已有页面时 | `API-PLAT-035` | `PARAM-PROJECT-ID` + `PARAM-PAGE-ID` | pending → `STORE-EDIT.pageState = loading` | 「正在载入页面…」+ 骨架（静态） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-050` | 页面 / 元素接口失败 | `API-PLAT-035` / `API-PLAT-036` | `PARAM-PAGE-ID` | `code` → `STORE-EDIT.pageState = error` | 「页面没载入出来。」+「重试」 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-EDIT-051`/`EL-EDIT-052` | 点「元素 id 台账」打开抽屉 | `API-PLAT-041`（`#41`，分页） | `PARAM-PROJ-ID` + `PARAM-LIST` | `data.items[].element_id`/`.alias`/`.status`/`.voided_at` → `MODEL-ELEMENT-LEDGER[]` | 空台账 → 「还没有分配过元素 id。」；失败 → 「台账没加载出来。」+「重试」；作废 id **可查不可用**（状态用**文字**标注） |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-GLOBAL-001`（Toast） | 复制 / 草稿恢复 | 本地 / `API-PLAT-042` | 无（复用上述接口的入参，本元素无独立请求参数） | 本地文案 | 「已复制 {id}」/「已恢复上次未提交的改动。」 |
| `UI-EDIT-001` | `RT-EDIT-001` | `EL-GLOBAL-004`（首次生成前） | 点「提交变更」时拦截 | `API-PLAT-068`（`#68`，PUT，**已转基线**）** | `PARAM-CONSENT` | `data.consent_acknowledged_at` → `MODEL-AI-EGRESS.consentAcknowledgedAt` | 未确认 → 弹窗关闭、**不发起生成**；写入失败 → 「确认状态没保存成功。」 |

#### 4.2.9 `UI-PREVIEW-001` / `RT-PREVIEW-001`（预览态 · 同区两态之一）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-001` | 切到预览态即渲染（**只读**） | 无（本地视图态） | `STORE-GLOBAL/URL.mode = preview` | 无 | 不适用 |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-002` | **仅在 L1 `passed` 后**（`REQ-PREVIEW-001`） | `API-PLAT-047`（`#47`）+ **本地渲染器** | `PARAM-TASK-ID`（`result_ref`） | `data.artifacts[]`（元素树快照）→ `MODEL-ARTIFACTS`，由本地渲染器绘制为 DOM/Canvas | L1 未过 → 接口**不得**返回「已就绪」（`CONFLICT` 分支）→ 页面保持上一成功结果 + 状态区显示失败态；渲染器自身失败 → `EL-PREVIEW-013`「预览没加载出来。」+「重试」（30s 超时） |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-003` | 预览刷新后 | `API-PLAT-045`（SSE `task`）/ `API-PLAT-044` | `PARAM-TASK-ID` | SSE `data.seq`；`data.finished_at` → `MODEL-TASK.seq/finishedAt` | **`finished_at = null`** → `EL-PREVIEW-017`「时间未知」（**不得显示 1970**）；**只应用序号最新的结果** |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-004` | 预览态常驻 | 无（前端常量，**静态说明数据**，`接口-Spec §3.2`） | 无 | 常量 → `STORE-PREVIEW.approxBadge = true` | 不适用；**任一状态下常驻可见**，空态/失败态同样显示 |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-005`/`EL-PREVIEW-006`/`EL-PREVIEW-007` | 点击展开差异清单 | 无（前端静态数据，`UI-Spec §6` 的 10 项） | 无 | 常量 → `STORE-PREVIEW.diffList` | 不适用；**默认可见差异项名称**；**不作「接近真机」的任何承诺** |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-008` | 从未生成过 | `API-PLAT-044`（无任务） | `PARAM-TASK-ID`（空） | 无 → `STORE-PREVIEW.state = empty` | 「还没生成过页面。」+「在左边拖几个控件，然后提交变更。」 |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-009` | `GenTask.status ∈ {queued, running}` | `API-PLAT-045`（SSE，进度随 `task` 事件推送）/ `API-PLAT-044`（降级 2s 轮询） | `PARAM-TASK-ID` | `data.progress`（0~100）、`data.status` → `MODEL-TASK` | 「正在生成代码…」+ `{n}%`；**与「验证中」必须可区分**；超 5min → 可重试失败态；降级轮询时**界面无差别** |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-010` | `VerifyTask(L1).status = running` | `API-PLAT-049`（`#49`） | `PARAM-TASK-ID` | `data.items[].evidence.checks[]{rule,ok,evidence}` → `MODEL-VERIFICATION` | 「正在验证生成的代码…」+ L1 五条规则逐条打勾；失败 → 转 `EL-PREVIEW-012` |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-011` | `GenTask.status = failed` | `API-PLAT-044`（`error_code`） | `PARAM-TASK-ID` | `data.error_code`/`data.status` → `MODEL-TASK` | 「代码没生成出来。」+「原因：{可读原因}。」+「重新生成」（**与验证失败是两套组件、两套文案**，`REQ-GEN-008`） |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-012` | `VerifyTask.status = failed` | `API-PLAT-049` + `API-PLAT-048`（`#48`，重试 ≤3） | `PARAM-TASK-ID` + `verify_id` | `data.error_code`、`data.attempt`、**剩余重试次数** → `MODEL-VERIFICATION` | 「生成的代码没通过验证。」+ 原因 +「重试（还剩 {n} 次）」；`n = 0` → **「需要人工介入」+「查看验证日志」**（停止自动重试）；`attempt ≥ 3` → 400 `INVALID_ARGUMENT` |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-013` | 渲染器 / 资源加载失败 | `API-PLAT-047` | `PARAM-TASK-ID` | `code`/网络态 → `STORE-PREVIEW.state = load_failed` | 「预览没加载出来。」+「重试」（30s 超时）；**不把渲染器差异渲染成"错误"**（`REQ-PREVIEW-003`） |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-014` | L2 未回传 | `API-PLAT-046`（`#46`）/ `API-PLAT-044` | `PARAM-TASK-ID` | `data.l2_result.reported`/`.passed`/`.log_digest` → `MODEL-TASK.l2Result` | 「未验证构建」+ 悬浮「本地构建结果尚未回传；不影响你继续使用。」；**是附加标记，可与其它态叠加，不是独立态** |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-015` | 点击「停止生成」 | `API-PLAT-044A`（`#44a`） | `PARAM-TASK-ID` | `data.status = canceled` → `MODEL-TASK.status` | `EL-PREVIEW-016` 显示「已停止」；预览**保持上一次成功结果不变**；回编辑态；**不呈现为错误态、不计重试** |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-016` | 任务 `canceled` | `API-PLAT-044` | `PARAM-TASK-ID` | `data.status = canceled` → `MODEL-TASK.status` | 「已停止」（**非错误态**：不用红色、不用感叹号） |
| `UI-PREVIEW-001` | `RT-PREVIEW-001` | `EL-PREVIEW-017` | `finished_at = null` | `API-PLAT-044` | `PARAM-TASK-ID` | `data.finished_at = null` → `MODEL-TASK.finishedAt` | 「时间未知」（**禁 1970**，`REQ-NF-005`） |

#### 4.2.10 `UI-API-001` / `RT-API-001`（接口管理页）

> ⚠️ 本页管理的是**被开发项目的接口定义**（`API-<模块>-<三位>`，`E9 ApiDef`），**与「平台自身接口 `#n`」是两套，不得混称**（`术语表`）。

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-API-001` | `RT-API-001` | `EL-API-001`/`EL-API-002`/`EL-API-007` | 页面挂载即渲染 | 无（前端常量） | 无 | 常量（表头 7 列） | 不适用 |
| `UI-API-001` | `RT-API-001` | `EL-API-006` | 首次进入 / 筛选 / 翻页 | `API-PLAT-050`（`#50`，GET，分页） | `PARAM-PROJ-ID` + `PARAM-LIST` | `data.items[]` + 分页四项 → `MODEL-API-DEF[]` | 失败 → `EL-API-044`「接口清单没加载出来。」+「重试」；403 → 统一无权限态；`failed_parts[]` 非空 → 部分加载标记 |
| `UI-API-001` | `RT-API-001` | `EL-API-008` | 同上 | `API-PLAT-050` | `PARAM-PROJ-ID` | `data.items[].code` → `MODEL-API-DEF.code` | 缺省 → 该行不渲染 |
| `UI-API-001` | `RT-API-001` | `EL-API-009` | 同上 | `API-PLAT-050` | `PARAM-PROJ-ID` | `data.items[].name` → `MODEL-API-DEF.name` | 缺省 → 「（未命名接口）」 |
| `UI-API-001` | `RT-API-001` | `EL-API-010` | 同上 | `API-PLAT-050` | `PARAM-PROJ-ID` | `data.items[].method` → `MODEL-API-DEF.method`（**5 值**：`GET`/`POST`/`PUT`/`DELETE`/`PATCH`） | 未知方法 → 按中性标签原样显示（不隐藏该行） |
| `UI-API-001` | `RT-API-001` | `EL-API-011` | 同上 | `API-PLAT-050` | `PARAM-PROJ-ID` | `data.items[].path` → `MODEL-API-DEF.path` | 缺省 → `—` |
| `UI-API-001` | `RT-API-001` | `EL-API-012` | 同上 | `API-PLAT-050` | `PARAM-PROJ-ID` | `data.items[].status` → `MODEL-API-DEF.status`（`draft`/`effective`/`deprecated` →「草稿」/「生效」/「已废弃」） | 未知值 → 「草稿」（不静默隐藏）；**文字 + 图标** |
| `UI-API-001` | `RT-API-001` | `EL-API-013` | 同上 | `API-PLAT-050` | `PARAM-PROJ-ID` | `data.items[].updated_at` → `MODEL-API-DEF.updatedAt` | `null` → 「时间未知」 |
| `UI-API-001` | `RT-API-001` | `EL-API-003`/`EL-API-004` | 输入（防抖）/ 选择状态 | `API-PLAT-050` | `PARAM-LIST.q`（匹配 `code`/`name`/`path`）+ `status` 筛选 | `data.total` 等 → `MODEL-API-DEF[]` | 无匹配 → `EL-API-042`「没有符合筛选条件的接口。」+「清除筛选」（**与 `EL-API-041` 不同视图**） |
| `UI-API-001` | `RT-API-001` | `EL-API-014`/`EL-API-005` | 点击「编辑」/「新建接口」 | `API-PLAT-051`（`#51`，GET 详情） | `PARAM-API-DEF-ID` | `data.req_schema[]`、`data.resp_schema[]`（`{name,type,required,length,precision,unit,desc}`）→ `MODEL-API-SCHEMA-FIELD` | `NOT_FOUND` → 「这个内容已经不在了。」+「返回上一级」；403 → 统一无权限态 |
| `UI-API-001` | `RT-API-001` | `EL-API-015` | 点击「复制」 | `API-PLAT-050`（`#50`，POST，新建草稿，`code` 追加 `-copy`） | `PARAM-PROJ-ID` + 源接口字段 | `data.items[].api_id`/`.code` → `MODEL-API-DEF` | `INVALID_ARGUMENT`（`code` 重复）→ 字段级提示 + 保留输入 |
| `UI-API-001` | `RT-API-001` | `EL-API-016`/`EL-API-033`~`EL-API-036` | 点击删除 → 二次确认「删除」 | `API-PLAT-052`（`#52`，⬛ DELETE） | `PARAM-API-DEF-ID` + `PARAM-IDEM-KEY` | 影响范围（被引用的 Spec 标「需复核」）→ `STORE-API.affectedSpecs` | `FORBIDDEN` → 统一无权限态；失败 → 保留行 + Toast；**删除在下次生成版本后生效**；引用方 Spec **拉取最新状态而非本地推断**（`REQ-API-003`） |
| `UI-API-001` | `RT-API-001` | `EL-API-017` | 翻页 | `API-PLAT-050` | `PARAM-LIST.page` | `data.page`/`data.total`/`data.has_more` → `MODEL-API-DEF[]` | `page` 超总页数 → 空 `items` + 真实 `total`，**不报错** |
| `UI-API-001` | `RT-API-001` | `EL-API-018`/`EL-API-019`/`EL-API-021`/`EL-API-022`/`EL-API-023`/`EL-API-024`/`EL-API-025` | 打开字段抽屉 / 编辑 | `API-PLAT-051` / `API-PLAT-053`（`#53`，PUT） | `PARAM-API-DEF-ID` + `PARAM-API-SCHEMA-DRAFT`（`name`/`type`/`required`/`length`/`precision`/`unit`/`desc`） | `data.req_schema[]`/`data.resp_schema[]` → `MODEL-API-SCHEMA-FIELD[]` | `INVALID_ARGUMENT` → 字段级提示 + **保留已输入**；`VERSION_CONFLICT` → `EL-API-037` 冲突提示 + diff |
| `UI-API-001` | `RT-API-001` | `EL-API-020` | 展开类型下拉 | 无（**下拉值直接来自枚举**） | 本地枚举（`数据模型 E9`） | `field_type` **完整 8 项**：`string`/`int`/`long`/`double`/`bool`/`object`/`array`/`date` → `MODEL-API-SCHEMA-FIELD.type` | **不得写「等」**；8 项之外的取值不出现 |
| `UI-API-001` | `RT-API-001` | `EL-API-026` | `#51`/`#53` 返回 400 | `API-PLAT-051`/`053` | —（响应驱动） | `message` + `data.field` → `STORE-API.fieldErrors[]` | 「字段名不能为空，且只能是字母、数字、下划线。」+ **保留输入** |
| `UI-API-001` | `RT-API-001` | `EL-API-027` | 点「保存」 | `API-PLAT-050`（新建）/ `API-PLAT-051`（PATCH）/ `API-PLAT-053`（`#53`，字段表） | `PARAM-API-DEF-ID` + `PARAM-API-SCHEMA-DRAFT` + `If-Match: <version>`（**已落 `#53`**；`[拆解缺口-Q13]` **已闭合** 2026-10-21） | 更新后的对象 → `MODEL-API-DEF` | `VERSION_CONFLICT` → `EL-API-037`「该接口已被他人修改。」+ diff + 「以我的为准」/「放弃我的改动」（**不静默覆盖**）；连点**只保存一次**；Toast「接口已保存（未纳入版本）」 |
| `UI-API-001` | `RT-API-001` | `EL-API-028` | 点「取消」 | 无（本地） | 无 | 丢弃 `PARAM-API-SCHEMA-DRAFT` | 不适用 |
| `UI-API-001` | `RT-API-001` | `EL-API-029`/`EL-API-030` | 版本区渲染 | `API-PLAT-054`（`#54`） | `PARAM-PROJ-ID` + `PARAM-LIST` | `data.items[].seq`、`data.items[].status`（`current` **唯一**）→ `MODEL-VERSION[]` | 空 → 「还没有版本记录。」；时间 `null` → 「时间未知」；**「当前」用文字标记**（不只靠颜色） |
| `UI-API-001` | `RT-API-001` | `EL-API-031` | 点「查看变更」 | `API-PLAT-056`（`#56`） | `PARAM-VERSION-ID` | `data.diff[] = {path,left,right,change}` → `MODEL-DIFF-ROW[]` | 无差异 → 「这个版本与上一版没有差异。」；`NOT_FOUND` → 「这个内容已经不在了。」+「返回上一级」 |
| `UI-API-001` | `RT-API-001` | `EL-API-032` | 点「生成新版本」 | `API-PLAT-055`（`#55`，整包快照） | `PARAM-PROJ-ID` + `PARAM-IDEM-KEY` | `data.version_id`、`data.seq`（**旧版置 `superseded`**）→ `MODEL-VERSION[]` | `INVALID_ARGUMENT` → 字段级提示；`IDEMPOTENT_REPLAY` → 采用首次结果；Toast「已生成版本 v{n}。」 |
| `UI-API-001` | `RT-API-001` | `EL-API-037`/`EL-API-038`/`EL-API-039` | `#51`/`#53` 返回 409 `VERSION_CONFLICT` | `API-PLAT-051`/`053` + `API-PLAT-056` | `PARAM-API-DEF-ID` | `code = VERSION_CONFLICT`；`#56` 的 `data.diff[]` → `MODEL-DIFF-ROW[]` | 「该接口已被他人修改。」+ diff + 两个处置按钮；**不静默覆盖**；**与画布 / 能力配置共用同一套冲突组件**（`REQ-NF-003`） |
| `UI-API-001` | `RT-API-001` | `EL-API-041` | `total = 0` 且无筛选 | `API-PLAT-050` | `PARAM-PROJ-ID` | `data.total = 0` → `STORE-API.state = empty` | 「还没有接口定义。」+「新建接口」 |
| `UI-API-001` | `RT-API-001` | `EL-API-042` | `total = 0` 且有搜索词/状态筛选 | `API-PLAT-050` | `PARAM-LIST.q` + `status` | `data.total = 0` → `STORE-API.state = no_match` | 「没有符合筛选条件的接口。」+「清除筛选」 |
| `UI-API-001` | `RT-API-001` | `EL-API-043` | 首屏 / 筛选 / 翻页请求中 | `API-PLAT-050` | `PARAM-PROJ-ID` | pending → `STORE-API.state = loading` | 「正在加载接口…」+ 骨架行 ×8（静态，无 shimmer）；>3s 追加进度说明 |
| `UI-API-001` | `RT-API-001` | `EL-API-044` | 清单接口失败 | `API-PLAT-050` | `PARAM-PROJ-ID` | `code` → `STORE-API.state = error` | 「接口清单没加载出来。」+「重试」 |
| `UI-API-001` | `RT-API-001` | `EL-API-040`/`EL-GLOBAL-001` | 保存 / 打版本成功 | `API-PLAT-051`/`053`/`055` | 无（复用上述接口的入参，本元素无独立请求参数） | 本地文案 | 「接口已保存（未纳入版本）」/「已生成版本 v{n}。」 |

#### 4.2.11 `UI-CAP-001` / `RT-CAP-001`（能力配置页 ★ 含 P0 合规开关）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-001`/`EL-CAP-002`/`EL-CAP-003`/`EL-CAP-014` | 页面挂载即渲染（目标端固定安卓） | 无（前端常量；`EL-CAP-014` 为固定说明文案） | 无 | 常量「目标端：安卓（本期固定）」→ `STORE-CAP.target` | 不适用；**界面不得出现 iOS / 跨平台入口**（`REQ-BASE-001`） |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-004`/`EL-CAP-005`/`EL-CAP-006`/`EL-CAP-007`/`EL-CAP-008` | 首次进入 / 保存后刷新 | `API-PLAT-058`（`#58`，GET） | `PARAM-PROJ-ID` | `data.items[].capability`（**固定 7 枚举**：`push`/`apm`/`crash_report`/`log_report`/`stats_sdk`/`hardening`/`privacy_dialog`）、`.enabled`（**默认 `false`**）、`.code_status`（`not_generated`/`generated`/`partial`/`failed`）、`.note` → `MODEL-CAPABILITY` | 失败 → `EL-CAP-018`「配置没保存成功。」+「重试」；403 → 统一无权限态；**每项目固定 7 行，不多不少**；`note` **只作占位说明展示，不含真实密钥** |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-007`（关闭已生成过的项） | 关闭开关 → `EL-CAP-013` 二次确认 | `API-PLAT-058`（PUT） | `PARAM-PROJ-ID` + `PARAM-CAP-SWITCH`（`enabled = false`） | `data.items[].enabled`、`.code_status` → `MODEL-CAPABILITY` | **仅置 `enabled = false`**；已生成代码**保留 + 注释标记**（前端**不得触发代码删除**）；`VERSION_CONFLICT` → 统一冲突组件 |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-009` | 点「保存并生成」 | `API-PLAT-058`（PUT，**保存即生成**） + `API-PLAT-044`/`API-PLAT-045`（`code_status` 订阅） | `PARAM-PROJ-ID` + `PARAM-CAP-SWITCH` + `PARAM-IDEM-KEY` | `data.overall`、`data.items[].code_status` → `MODEL-CAPABILITY` | 保存中按钮禁用；**生成前服务端自动备份** → 前端提示「已自动备份」；失败 → 「配置没保存成功。」+「重试」 |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-010` | 生成进行中 | `API-PLAT-045`（SSE `task`）/ `API-PLAT-044` | `PARAM-TASK-ID` | `data.status`/`data.progress` → `MODEL-TASK` | 「正在生成接入代码…」+ 转圈；超 5min → 可重试失败态 |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-011`/`EL-CAP-012` | `code_status = partial` | `API-PLAT-058` 响应 | `PARAM-PROJ-ID` | `data.overall = partial`、`data.failed[] = [{capability,error_code}]` → `MODEL-CAPABILITY.failed[]` | **顶部标黄**「{n} 项生成失败：{列表}」+ 逐项「重试」；**整体不显示为成功**；逐项重试调 `API-PLAT-058`（PUT 单能力） |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-013` | 取消勾选二次确认弹窗 | 无（本地，确认后走 `API-PLAT-058`） | 无 | 无 | 「取消「推送」？」+「只会移除这项配置，已生成的接入代码会保留并加注释标记，不会删除你手写的代码。」+「取消勾选」/「保留」 |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-015` | 两能力要求同一库不同版本 | `API-PLAT-058`（`conflicts[]`，**已转基线**） | `PARAM-PROJ-ID` | `data.conflicts[] = [{library,version_a,version_b}]`、`data.alignment_table[]` → `MODEL-CAPABILITY` | `{库名} 被两个能力要求了不同版本（{v1} / {v2}）。`+「查看版本对齐表」；只列冲突项，不列全量依赖 |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-016` | 无 `CapabilityConfig` 记录 | `API-PLAT-058` | `PARAM-PROJ-ID` | `data.items = []` → `STORE-CAP.state = empty` | 「还没有配置任何能力。」+「全部关掉也是可以的，想接入哪项再打开。」（**全关是合法状态**，不是错误） |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-017` | 保存 / 生成进行中 | `API-PLAT-058` | `PARAM-PROJ-ID` | pending → `STORE-CAP.state = loading` | 「正在保存配置…」+ 按钮转圈 |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-018` | 保存失败 | `API-PLAT-058` | `PARAM-PROJ-ID` | `code` → `STORE-CAP.state = error` | 「配置没保存成功。」+「重试」 |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-019`/`EL-CAP-020` | 页面进入（开关状态为**全局会话态**） | `API-PLAT-068`（`#68`，GET，**已转基线**）** | 无（用户级资源） | `data.egress_enabled`、`data.policy_text`、`data.disabled_reason`、`data.consent_acknowledged_at` → `MODEL-AI-EGRESS` | 开关正常渲染；读失败 → 开关置灰 + 「外发设置没加载出来。」+「重试」；`policy_text` **由服务端下发以统一口径** |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-019`（关闭动作） | 关闭开关 | `API-PLAT-068`（`#68`，PUT，**已转基线**）** | `{egress_enabled: false, consent_acknowledged: bool?}` + `PARAM-IDEM-KEY` | `data.egress_enabled`、`data.disabled_reason` → `MODEL-AI-EGRESS` | Toast「已关闭「PRD 与代码外发第三方大模型」。」；**关闭后生成类调用返回明确不可用原因，不得静默降级**（`REQ-AUTH-004`③）；**不撤销已完成的确认记录**（两者都需要满足） |
| `UI-CAP-001` | `RT-CAP-001` | `EL-CAP-021` | `egress_enabled = false` | `API-PLAT-068`（`#68`）** | 无 | `data.disabled_reason` → `MODEL-AI-EGRESS.disabledReason` | 「你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。」+「去开启」（点击跳本页开关并高亮）；**工作台/编辑页生成入口同时置灰 + 同一原因** |
| `UI-CAP-001` | `RT-CAP-001` | `EL-GLOBAL-001`（Toast） | 各动作回调 | `API-PLAT-058`/`068`★ | 无（复用上述接口的入参，本元素无独立请求参数） | 本地文案 | 「接入代码已生成（{n} 项）」/「配置已保存，正在生成接入代码…」/「已关闭「PRD 与代码外发第三方大模型」。」 |

#### 4.2.12 `UI-SPEC-001` / `RT-SPEC-001`（Spec 产出页 · 含追溯矩阵抽屉）

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-001`/`EL-SPEC-002`/`EL-SPEC-009`~`EL-SPEC-012`/`EL-SPEC-019` | 页面挂载即渲染（tab 顺序即生成顺序） | 无（前端常量） | 无 | 常量（`UI` → `接口` → `App` → `埋点` → `测试`） | 不适用 |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-003`~`EL-SPEC-007` | 页面进入 / 生成完成 / 上游变更后**重新拉取**（`REQ-SPEC-002`：不能只靠本地缓存） | `API-PLAT-031`（`#31`） | `PARAM-PROJ-ID` + `PARAM-LIST` | `data.items[].spec_id`/`.role`/`.status`/`.stale`/`.error_code` → `MODEL-SPEC-DOC[]` | 403 → 统一无权限态；失败 → 「Spec 列表没加载出来。」+「重试」；失败 tab 文字后加 16px 感叹图标（文字 + 图标） |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-008` | 切换 tab / 生成完成 | `API-PLAT-032`（`#32`） | `PARAM-SPEC-ID` | `data.content_md` → `MODEL-SPEC-DOC.contentMd`（**失败时为空**） | 空 → 「这份 Spec 还没生成内容。」；`NOT_FOUND` → 「这个内容已经不在了。」+「返回上一级」 |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-009` | 点「导出 .md」 | `API-PLAT-033`（`#33`，**需鉴权**） | `PARAM-SPEC-ID` | 文件流（**不写入访问日志正文**）→ `STORE-SPEC.exportTask` | `FORBIDDEN` → 统一 403 文案（**不泄露存在性**）；失败 → Toast「导出失败了。」+「重试」；**导出内容不含密钥与内部凭据**；导出中按钮转圈 |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-010`/`EL-SPEC-017` | 点「重新生成」→ 二次确认 | `API-PLAT-030`（`#30`，⚡） | `PARAM-PROJ-ID` + `PARAM-IDEM-KEY`（可选 `role` 限定单份） | `data.succeeded[]`/`data.failed[]`/`data.overall` → `MODEL-SPEC-GEN-RESULT` | 当前版本**归档为历史版本（不删除）**；`UPSTREAM_TIMEOUT`/`UPSTREAM_UNAVAILABLE` → 可重试失败态 |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-011` | 点「版本」 | 无（路由跳转 `RT-VER-001`） | `PARAM-PROJ-ID` | 无 | 目标页失败 → 「版本历史没加载出来。」+「重试」 |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-012`/`EL-SPEC-021`/`EL-SPEC-022` | 点「追溯矩阵」（**`?drawer=trace`**） | `API-PLAT-067`（`#67`，**已转基线**；与 `UI-SPLIT-001` 共用同一接口）** | `PARAM-PROJ-ID` + `PARAM-LIST` + `coverage_status` | `data.items[].req_id`/`.summary`/`.targets.*`/`.coverage_status`/`.orphan`、`data.orphan_count` → `MODEL-TRACE-ROW[]` | 入口可用；加载失败 → 「追溯矩阵没加载出来。」+「重试」；**四态由接口给出、前端只渲染，不得自行估算**；跳转后**高亮对应行**；**不允许留空** |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-013` | `specs:generate` 返回 | `API-PLAT-030` | `PARAM-PROJ-ID` | `data.succeeded[]`、`data.failed[].role`、`data.overall` → `MODEL-SPEC-GEN-RESULT` | **`overall` 绝不置为 `succeeded`**（部分成功 → `partial`）→ 顶部标黄「3 份已生成，2 份失败。」；全部成功 → 该条不显示 |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-014` | 单份 `status = failed` / 5min 超时 | `API-PLAT-031` + `API-PLAT-030`（`role` 限定重试） | `PARAM-PROJ-ID` + `PARAM-SPEC-ROLE` + `PARAM-SPEC-ID` | `data.items[].error_code` → `MODEL-SPEC-DOC.errorCode` | 「这份 Spec 没生成出来。」+「原因：{…}。」+「重试这一份」；**一份失败不阻断其余四份** |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-015` | 上游变更 → `status = stale` | `API-PLAT-031`（`data.items[].stale`） | `PARAM-PROJ-ID` | `data.items[].status = stale` → `MODEL-SPEC-DOC.status` | 「这份 Spec 已过期（需求变更为 {变更点}）。」+「重新生成」；**`stale` 为独立状态**，不与 `failed` 合并 |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-016` | `status = generating` | `API-PLAT-045`（SSE `task`）/ `API-PLAT-044` | `PARAM-SPEC-ROLE` + `PARAM-TASK-ID` | `data.status`/`data.progress` → `MODEL-TASK` | 「正在生成 {角色} Spec…」+ tab 右侧 12px 转圈；>3s 追加进度说明；单份 5min 超时置失败可重试 |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-018` | 无 `SpecDoc` | `API-PLAT-031` | `PARAM-PROJ-ID` | `data.items = []` → `STORE-SPEC.state = empty` | 「还没有生成 Spec。」+「开始生成」 |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-SPEC-019`/`EL-SPEC-020` | 点「角色校对」/ 页面进入 | `API-PLAT-034`（`#34`，POST） | `PARAM-PROJ-ID` + `PARAM-SPEC-ID` + `PARAM-IDEM-KEY` | `data.items[].content`、`data.items[].can_loopback` → `MODEL-PROOFREAD-ITEM[]` | 空 → 「校对完成，没有补充要求。」；`UPSTREAM_TIMEOUT` → 可重试失败态；点「回流对话补充」→ 跳 `RT-WORK-001` 并**预填上下文** |
| `UI-SPEC-001` | `RT-SPEC-001` | `EL-GLOBAL-001`（Toast） | 导出 / 生成 | `API-PLAT-033`/`030` | 无（复用上述接口的入参，本元素无独立请求参数） | 本地文案 | 「已导出 {role}-spec.md」/「导出失败了。」+「重试」/「已开始生成 {角色} Spec。」 |

#### 4.2.13 `UI-VER-001` / `RT-VER-001`（版本归档页 · 时间线 + diff + 回滚 + 交付区）

> ⚠️ **本页界面不得出现任何「平台编译 / 打包 / 构建中」的按钮或文案**（`REQ-GEN-009`，项目约束 1）：只到「下载工程源码」。

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| `UI-VER-001` | `RT-VER-001` | `EL-VER-001`/`EL-VER-002` | 页面挂载即渲染 | 无（前端常量） | 无 | 常量 | 不适用 |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-003`/`EL-VER-004` | 首次进入 / 打版本后 | `API-PLAT-054`（`#54`，`seq` 倒序，`current` **唯一**） | `PARAM-PROJ-ID` + `PARAM-LIST` + 路由 `?version=` | `data.items[].version_id`、`.seq`、`.status` → `MODEL-VERSION[]` | 失败 → `EL-VER-024`「版本历史没加载出来。」+「重试」；403 → 统一无权限态；**有且仅有一条 `current`** |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-005` | 同上 | `API-PLAT-054` | `PARAM-PROJ-ID` | `data.items[].status = current` → `MODEL-VERSION.status` | 「当前」**文字标记**（不只靠颜色） |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-006`/`EL-VER-007` | 选中版本 | `API-PLAT-054` | `PARAM-VERSION-ID` | `data.items[].seq`、`data.items[].created_at` → `MODEL-VERSION.seq/createdAt` | `created_at` 为 `null` → 「时间未知」 |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-008` | 同上 | `API-PLAT-054`（`created_by_name`，**已转基线**） | `PARAM-VERSION-ID` | `data.items[].created_by_name` → `MODEL-VERSION.createdByName` | 字段缺省 → 「未命名用户」；★ **字段级补口未确认前该项显示 `—`**（不显示 1970 / 不编造操作人） |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-009` | 同上 | `API-PLAT-054`（`summary`，**已转基线**） | `PARAM-VERSION-ID` | `data.items[].summary` → `MODEL-VERSION.summary` | 缺省 → 该行显示 `—`（不编造摘要） |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-010` | 同上 | `API-PLAT-054`（`artifacts[]`，**已转基线**） | `PARAM-VERSION-ID` | `data.items[].artifacts[]` → `MODEL-VERSION.artifacts[]`（`spec`/`apis`/`capabilities`/`android_code`/`tracking_plan`） | 缺失项 → 「未包含」；该区正常渲染 |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-011`/`EL-VER-012`/`EL-VER-013` | 点「查看变更」/ 选中版本 | `API-PLAT-056`（`#56`） | `PARAM-VERSION-ID` | `data.diff[] = {path,left,right,change}` → `MODEL-DIFF-ROW[]` | 无差异 → 「这个版本与上一版没有差异。」；**变更标识用文字**（「新增 / 删除 / 修改」）；`NOT_FOUND` → 「这个内容已经不在了。」+「返回上一级」 |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-014`/`EL-VER-015`~`EL-VER-018` | 点「回滚到此版本」→ 二次确认「确认回滚」 | `API-PLAT-057`（`#57`，⬛ 最高风险；**多步写入要么全成要么全不成**） | `PARAM-VERSION-ID` + `PARAM-IDEM-KEY` | 目标版本置 `current`、被回滚版本置 `rolled_back` → `MODEL-VERSION.status` | 失败 → `EL-VER-021`「回滚没完成，当前版本未变更。」+「重试」（**整体回退 UI 状态**，`REQ-NF-007`）；`VERSION_CONFLICT` → 统一冲突组件；`FORBIDDEN` → 统一无权限态 |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-019` | 回滚请求进行中 | `API-PLAT-057` + `API-PLAT-044`（进度） | `PARAM-VERSION-ID` | `data.status` → `STORE-VER.rollbackState = running` | 「正在回滚…」（>30s 追加「还在回滚，已用 {n} 秒…」）；**回滚中前端锁住整个项目写入口**（禁止并发写，`REQ-DELIVER-003`） |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-020` | 回滚成功 | `API-PLAT-057` / `API-PLAT-054` | `PARAM-VERSION-ID` | `data.items[].status` → `MODEL-VERSION` | 「已回滚到 {v_n}。」+「查看当前版本」；**回环产物归档可见、不物理删除**（`REQ-DELIVER-004`） |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-021` | 回滚任一步骤失败 | `API-PLAT-057` | `PARAM-VERSION-ID` | `code` → `STORE-VER.rollbackState = failed` | 「回滚没完成，当前版本未变更。」+「重试」；**当前版本未变更**（不得部分成功） |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-022` | 零版本 | `API-PLAT-054` | `PARAM-PROJ-ID` | `data.items = []` → `STORE-VER.state = empty` | 「还没有版本记录。」+「生成第一个版本」（调 `API-PLAT-055`） |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-023` | 首次进入请求中 | `API-PLAT-054` | `PARAM-PROJ-ID` | pending → `STORE-VER.state = loading` | 「正在加载版本历史…」+ 骨架行（静态） |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-024` | 接口失败 | `API-PLAT-054`/`056` | `PARAM-PROJ-ID` | `code` → `STORE-VER.state = error` | 「版本历史没加载出来。」+「重试」 |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-025`/`EL-VER-026` | 点「下载工程源码」（**需鉴权**） | `API-PLAT-060`（`#60`，GET）/ `API-PLAT-061`（`#61`，导出） | `PARAM-PROJ-ID` + `PARAM-VERSION-ID` | `data.items[].artifacts[]` → `MODEL-DELIVERABLE.artifacts[]`（源码 + `gradle wrapper` + **依赖版本锁定清单**；**不得含 apk / 构建结果**） | 未生成 → 按钮置灰 + 「还没有生成过工程源码。」；`FORBIDDEN` → 统一 403 文案；失败 → Toast「下载失败了。」+「重试」；**平台不做编译，无任何构建进度 UI** |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-027` | 点「导出 Spec 包」 | `API-PLAT-061`（`#61`） | `PARAM-PROJ-ID` + `PARAM-VERSION-ID` + `PARAM-IDEM-KEY` | 压缩包流（**不含密钥与内部凭据**）→ `MODEL-DELIVERABLE` | `FORBIDDEN` → 统一 403 文案；失败 → 可重试；**前端不得把本地缓存的密钥类数据混入导出**（`REQ-SPEC-003`） |
| `UI-VER-001` | `RT-VER-001` | `EL-VER-028` | L2 未回传 | `API-PLAT-046`（`#46`）/ `API-PLAT-044` | `PARAM-TASK-ID` | `data.l2_result.reported` → `MODEL-TASK.l2Result.reported` | 「未验证构建」+ 悬浮「本地构建结果尚未回传；不影响你继续使用。」；**不阻断交付** |
| `UI-VER-001` | `RT-VER-001` | `EL-GLOBAL-001`（Toast） | 下载 / 导出 | `API-PLAT-060`/`061` | 无（复用上述接口的入参，本元素无独立请求参数） | 本地文案 | 「已开始下载工程源码。」/「Spec 包已导出。」 |

#### 4.2.14 应用外壳（**不是第 14 个页面** · 跨 13 页共用 · `EL-GLOBAL-009`）

> ⚠️ **本小节不计入页面数**：路由表仍 **13 条 `RT-*`**、页面仍 **13 个 `UI-*`**（§3 / §4.3 自检 1 不变）。
> 单列一节的唯一原因：`EL-GLOBAL-009` 按 `UI-Spec §5`/§7 是**应用外壳顶栏的一份实现、适用全部 13 页**，
> 放进任一页的表格都会与「所属页面」语义冲突；其余 `EL-GLOBAL-*` 因各页自持实例（`CMP-001`~`004`）仍按所在页登记，本小节**不搬动任何既有行**。

| UI页面ID | 路由ID | UI元素ID | 触发时机 | API-ID | 请求参数来源 | 响应字段 → 本地模型 | 失败处理 |
|---|---|---|---|---|---|---|---|
| **全部 13 页**（应用外壳顶栏，与 `UI-AUTH-001`~`UI-VER-001` 同范围） | 全部 `RT-*`（应用外壳，非某一条路由） | `EL-GLOBAL-009`（**本机落地扩展**） | 应用外壳挂载（首次进入任一 `RT-*`）/ 展开下拉 / 选中一项 | `API-PLAT-071`（`#71`，2026-10-21 本机落地）；选择落 `API-PLAT-071A`（`#71a`） | `#71` 无入参；`#71a` 请求体 `{model}` = `PARAM-LLM-MODEL`（下拉选中项的 `items[].id`） | `data.items[]`（`{id,name,description,available,reason}`）、`data.default_model`、`data.selected_model`、`data.effective_model` → `MODEL-LLM-MODEL`；`#71a` 回 `data.selected_model`、`data.effective_model` → `MODEL-LLM-MODEL` | `items = []`（**目录为空**）→ **本控件整块不渲染**（`UI-Spec §5` 该行兜底，**不显示空下拉**）；`available = false` → 该项**置灰 + 直出 `items[].reason`**（**原因文案由接口下发，前端不改写、不编造**）；`#71` 失败/离线 → 保留上次成功值并置灰（离线统一口径 §5 引言），**不阻塞任何页面功能**；`#71a` 返回 `INVALID_ARGUMENT`（模型不存在或不可选）→ **不改动本地已选值、回显 `effective_model`**，错误按 §6.3 / `UI-Spec §3.6` 的 `INVALID_ARGUMENT` 口径呈现（字段级提示 + **保留原值**；**该 Toast 的逐字文案 `UI-Spec` 未定义 → 本 Spec 不编造**）；`UNAUTHENTICATED` → 跳 `RT-AUTH-001` |

### 4.3 本节自检（**逐项可核对**）

| # | 自检项 | 结论 |
|---|---|---|
| 1 | 是否覆盖UI-Spec §5全部数据展示组 | ✅ **84/84行**均有落点；§4.2当前**295行（294页面元素供给+1外壳）**。B9新增8行；旧展开声明286但含外壳实测287，历史记录原样保留，不靠漏数外壳维持固定计数 |
| 2 | 每个 `API-ID` 是否真实存在于 `接口-Spec` | ✅ 全部为 `API-PLAT-001`~`070`（↔ `#1`~`#70`，含 `API-PLAT-044A` ↔ `#44a`）**+ 本机落地的 `API-PLAT-071`/`API-PLAT-071A`/`API-PLAT-072`/`API-PLAT-072A`**（↔ `#71`/`#71a`/`#72`/`#72a`，见 `接口-Spec §5.4.13`）；**★ 为章节强调标记（补口已于 2026-10-21 转基线）**；本机落地 4 个**未过门禁、未进入第 4 轮基线冻结范围** |
| 3 | 是否有空白格 | ✅ **无**。不走接口的元素一律写明「无（前端常量）/（本地视图态）/（本地草稿）/（全局错误码）」，并给出失败语义 |
| 4 | 字段名是否与接口 Spec 零差异 | ✅ 右端字段名逐字照抄 `接口-Spec §5.0.3` / `§5.5` / `数据模型`（含 `E7` 的 13 个字段名，「宽/高」**分立**不合并） |
| 5 | 每个 API 调用是否写清「失败时用户看到什么」 | ✅ 每行「失败处理」列均给出**逐字文案或明确兜底**（如「该行不显示」「按钮置灰 + 原因」） |
| 6 | 补口接口状态 | ✅ **已转基线**（2026-10-21 · `P0-补口裁决单`）：`#63`~`#70` 与 7 项字段级补口已由草案**批准转正式基线**，相关兜底（禁用 + 原因文案）**已解除**，按正向流程执行 |

---

## 5 页面详细设计

> **读法**：每页给 **① 状态管理（`STORE-*`）｜② 接口调用｜③ 五种页面状态｜④ 跳转与深链接｜⑤ 待澄清** 五块，
> 与 `UI-Spec §4.x` 的 `① 元素清单 / ② 交互规则 / ④ 文案字样 / ⑥ 状态` **逐条对齐**。
>
> **五态的统一口径**（`加载中 / 空数据 / 错误 / 无权限 / 离线`）：
> - 前三态与「无权限」的**呈现文案逐字引用 `UI-Spec`**（其 `⑥ 状态` 表 + `§3.6` 错误码映射表）；
> - **「离线」态在 `UI-Spec` 中未逐页定义** → 本 Spec **统一收敛为一种呈现**：
>   **全局顶部提示条（`CMP-005` 样式，文案口径取自 `EL-WORK-024`：「连接已断开，正在重连…」）** +
>   **页内保留上一次成功结果并置灰** + **写操作禁用并给出原因**；网络恢复（`online` 事件）后**自动重取**。
>   标 `[来源: 推断，**已确认** 2026-10-21]` —— `[缺口-APP-05]` **已闭合**（**采纳 App 侧统一推断**：离线沿用 `EL-WORK-024` 文案口径 + 顶栏 `CMP-005` 样式；UI 侧已确认）。
> - **「无权限」态一律不区分「不存在」与「无权限」**（`REQ-AUTH-002`）：403 与 404 **文案不得有可区分差异**。
> - **空态与「无匹配」是两个不同状态**，禁止用一个 `isEmpty` 判断（`REQ-PROJ-002`、`REQ-NF-004`）。
> - **取消 ≠ 失败**、**生成失败 ≠ 验证失败**：不得共用错误组件（`REQ-GEN-005`/`REQ-GEN-008`）。
> - **无动效**：除进度指示器自身旋转与 `EL-WORK-020` 的 240ms 输入框抖动外，**全部瞬时**（`UI-Spec §3.7`）。

### 5.1 登录与鉴权（`RT-AUTH-001` / `UI-AUTH-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-AUTH` | `qrState` | enum{`pending`,`fetching`,`expired`,`scanned`,`confirmed`,`failed`} | `pending` | `#63` 发起/返回、`#64` 每次返回时 |
| `STORE-AUTH` | `qrcodeUrl` | string(URL) \| null | `null` | `#63` 成功后写入 |
| `STORE-AUTH` | `expiresInSeconds` | int（0~120） | `120` | `#63` 成功后写入；本地每秒递减 |
| `STORE-AUTH` | `authState` | string \| null | `null` | `#63` 成功后写入（`#64` 的路径参数） |
| `STORE-AUTH` | `scanStatus` | enum{`pending_scan`,`scanned`,`expired`,`confirmed`} \| null | `null` | `#64` 每次返回 |
| `STORE-AUTH` | `errorCode` | string \| null | `null` | `#63`/`#64` 失败时 |
| `STORE-AUTH` | `retryAfterSeconds` | int \| null | `null` | `RATE_LIMITED` 时（倒计时） |
| `STORE-AUTH` | `methods`（★本机落地） | `MODEL-AUTH-METHODS` \| null | `null` | `#72a` 返回后写入；**失败置 `null` → 降级为「飞书扫码」** |
| `STORE-AUTH` | `loginMethod`（★本机落地） | enum{`password`,`feishu`} | **由 `#72a` 决定**（`password_login = true` → `password`；否则 `feishu`；`#72a` 失败 → `feishu`） | 点 `EL-AUTH-017` 切换；`#72a` 返回后写入 |
| `STORE-AUTH` | `username`（★本机落地） | string | `''` | `EL-AUTH-018` 输入；**提交失败后保留**；登出/离开页面清空 |
| `STORE-AUTH` | `password`（★本机落地） | string | `''` | `EL-AUTH-019` 输入；**提交失败后立即清空**（不保留）；**仅内存，不落缓存、不入日志/埋点/上报** |
| `STORE-AUTH` | `submitting`（★本机落地） | bool | `false` | `#72` 提交中置 `true`（按钮禁用、回车不重复触发），返回后置 `false` |
| `STORE-AUTH` | `credentialFieldError`（★本机落地） | {`field`:`username`\|`password`} \| null | `null` | 空值前端拦截时写入；输入变更即清除；`#72` 返回 `UNAUTHENTICATED` 时**置 `null` 并改走 `EL-AUTH-010` 错误条** |
| `STORE-GLOBAL/SESSION` | `token` | string \| null | `null` | `#64` 返回 `confirmed` 且带 `token` 时（飞书扫码路径）；**`#72` 成功返回 `token` 时（账号密码路径，★本机落地）**；登出（`#65`★）时清空 |
| `STORE-GLOBAL/SESSION` | `user` | `MODEL-USER` \| null | `null` | `#66`★ 成功后 |
| `STORE-GLOBAL/SESSION` | `sessionExpired` | bool | `false` | 任意业务接口返回 401 时置 `true`；重新认证成功后置 `false` |
| `STORE-GLOBAL/SESSION` | `forbidden` | bool | `false` | 任意业务接口返回 403 时置 `true` |
| `STORE-GLOBAL/SESSION` | `nextPath` | string \| null | `null` | 路由守卫重定向时写入（`?next=`） |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 拉取二维码 | `API-PLAT-063`（`#63`，已转基线） | 页面挂载（**仅当默认段为「飞书扫码」，或用户切到该段时**）/ 点 `EL-AUTH-008` / `expired` | 无（公开端点） | 写入 `qrcodeUrl`/`expiresInSeconds`/`authState`，启动 1.5s 轮询 | 「二维码加载失败。」+「刷新二维码」；`RATE_LIMITED` → 倒计时后允许重试 |
| 轮询扫码状态 | `API-PLAT-064`（`#64`，已转基线） | 取得二维码后每 1.5s | `PARAM-AUTH-STATE` | `confirmed` → 写 `token`、`replace` 到 `nextPath` 或 `RT-PROJ-001` | `NOT_FOUND` → 「二维码已过期。」+ 显示刷新；超时/不可用 → 指数退避续轮询（**界面不显示错误**） |
| 登出 | `API-PLAT-065`（`#65`，已转基线） | 点用户菜单「退出登录」（`EL-PROJ-006`/`EL-WORK-008`） | 无 | 清 `STORE-GLOBAL/SESSION` + 清 §7 缓存 + 跳 `RT-AUTH-001` | `UNAUTHENTICATED` → 视为已登出；网络失败 → **本地强制登出** + Toast |
| 拉取当前用户 | `API-PLAT-066`（`#66`，已转基线） | 登录成功后一次 / 需要角色判定时 | 无 | 写 `MODEL-USER`（`user_id` = 飞书 `open_id`） | `UNAUTHENTICATED` → 跳本页 + 恢复草稿；`nickname` 缺省 → 「未命名用户」 |
| 取可用登录方式 ★本机落地 | `API-PLAT-072A`（`#72a`，2026-10-21 本机落地） | **页面挂载即发（先于 `#63`）**；`EL-AUTH-017` 切换不重发 | 无（公开端点、无入参） | 写 `methods`；按 `password_login` 决定 `loginMethod`（**默认展示哪一段由此决定**）；`password_login = false` → 不渲染 `EL-AUTH-017`/`EL-AUTH-018`~`021`，直接走「飞书扫码」 | **失败 → 静默降级为「飞书扫码」**（不显示错误条、不阻塞登录；公开端点无权限分支）；`password_login = false` 但用户切到该段 → 不存在该段 |
| 账号密码登录 ★本机落地 | `API-PLAT-072`（`#72`，2026-10-21 本机落地；**阶段性本地登录，生产必须关闭**） | 点 `EL-AUTH-020`；或 `EL-AUTH-018`/`EL-AUTH-019` 回车（等价） | `PARAM-AUTH-CREDENTIAL`（`{username,password}`）+ `PARAM-IDEM-KEY`（3s 内复用） | 写 `token`/`user` → `STORE-GLOBAL/SESSION`，`replace` 到 `nextPath` 或 `RT-PROJ-001`；Toast 沿用「已恢复上次未提交的改动。」（仅会话过期场景） | `UNAUTHENTICATED`（**凭据错误**）→ `EL-AUTH-010` 错误条「用户名或密码不正确。」（**与「账号不存在」同码同文案**）；`INVALID_ARGUMENT`（未启用 / 入参非法）→ 复用 `EL-AUTH-010` **显示服务端 `message`**（如「用户名需为 2~32 位字母、数字或 _ . - @。」）；提交中 `submitting = true`（按钮禁用）；**用户名与密码为空 → 前端先拦，不发起请求** |

**账号密码登录路径（★ 本机开发阶段扩展 · `API-PLAT-072` / `API-PLAT-072A`）**

> **状态标注**：这 2 个接口为 **2026-10-21 本机落地扩展**，**未过门禁、未进入第 4 轮基线冻结范围**；
> `API-PLAT-072`（`#72`）是**阶段性的本地登录**，**生产必须关闭**（`AD_PASSWORD_LOGIN=disabled`）——**不是**本项目的正式登录方式。

| 环节 | 约定 |
|---|---|
| **触发** | ① 页面挂载先发 `API-PLAT-072A`（`#72a`）；② `password_login = true` → 默认段 = 「账号密码」（`EL-AUTH-017` 左段），并渲染 `EL-AUTH-018`/`019`/`020`/`021`；③ 用户点 `EL-AUTH-020` 或输入框回车 → 发 `API-PLAT-072` |
| **请求** | `POST /auth/password/login`，body `{username,password}`（`PARAM-AUTH-CREDENTIAL`，**仅内存**）；公开端点 → **不注入 `Authorization`**；带 `Idempotency-Key`（串行提交，3s 内复用） |
| **成功分支** | 返回 `token`/`created`/`user` → 写 `STORE-GLOBAL/SESSION.token`、`MODEL-USER`；`replace` 跳 `?next=` 目标或 `RT-PROJ-001`；`created = true`（首次登录自动建用户）**不额外弹提示**（`#72` 语义，`UI-Spec` 未定义差异化 UI）；**清空 `password`**，保留 `username` |
| **失败分支** | `UNAUTHENTICATED` → 「用户名或密码不正确。」（复用 `EL-AUTH-010` 错误条；**「账号不存在」与「密码错误」同码同文案**，**不得**提示账号是否存在）；`INVALID_ARGUMENT`（未启用 / 入参非法）→ **复用 `EL-AUTH-010` 显示服务端 `message`**（如「用户名需为 2~32 位字母、数字或 _ . - @。」「请输入密码。」）；**输入为空** → `EL-AUTH-018`/`EL-AUTH-019` **字段级提示** + 焦点回框，**不发起请求**；网络异常 → 同错误条口径（`EL-AUTH-010`）。**一律停留本页，不清空用户名，立即清空密码**；`submitting` 期间按钮禁用、回车不重复触发 |
| **与飞书扫码的切换关系** | 两段**互斥展示、同页共存**：`EL-AUTH-017` 段控件切换；**切到「飞书扫码」才发 `API-PLAT-063`**（默认段为「账号密码」时不拉二维码，避免白轮询，`UI-Spec §4.1 ②`）；切换**不改变路由、不新增历史记录**，也不清除已输入的用户名；`password_login = false` → **`EL-AUTH-017` 整块不渲染**，页面只有飞书扫码一条路径（此时本小节全部不适用）；`feishu_login` 取 `"development"`（string 枚举，**不是 bool**；若服务端如此下发）**`UI-Spec` 未定义呈现口径** → `[待确认]`，App 侧**不自行裁决** |
| **本地存储** | `token` 仅**内存**（§7）；**凭证不入任何缓存键**（不落 `localStorage`/`sessionStorage`）；密码不进日志、埋点参数与错误上报（`REQ-AUTH-005`） |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | `#63` 请求进行中 | 二维码位 200×200 骨架块 + 「正在加载二维码…」（>3s 追加「还在加载，已用 {n} 秒…」） | 请求返回即退出；超时 30s → 转错误态 |
| 空数据 | — | **不适用**：本页无列表型数据（`UI-Spec §4.1 ⑥` 未定义空态） | — |
| 错误 | `#64` 换 token 失败 / **`#72` 返回 `UNAUTHENTICATED`（凭据错误）或 `INVALID_ARGUMENT`（未启用 / 入参非法）**★本机落地（**复用 `EL-AUTH-010` 显示服务端 `message`**）/ 网络异常 | 飞书段：「登录没成功，请重试。」+「重新扫码」（`EL-AUTH-010`/`EL-AUTH-011`）；**账号密码段：凭据错误复用 `EL-AUTH-010` 错误条 →「用户名或密码不正确。」**（`UI-Spec §4.1 ④`，**与「账号不存在」同码同文案**） | 飞书段：点「重新扫码」重走 `#63`；**账号密码段：保留用户名、已清空密码，可原地重试**；`RATE_LIMITED` → 倒计时后重试；`submitting = true` 期间按钮禁用 |
| 无权限 | 逐对象鉴权返回 403（`EL-AUTH-014`） | 「你没有权限访问这个项目。」+「返回上一级」（**不显示对象名、不提示是否存在**） | 返回上一级；无上一级 → `RT-PROJ-001` |
| 离线 | `navigator.onLine === false` 或 `#63` 网络层失败 | 全局顶栏「连接已断开，正在重连…」+ 卡片内「二维码加载失败。」+「刷新二维码」 | 网络恢复（`online`）→ **自动重取 `#63`**；恢复期间禁止重复点击（1s 串行） |

**跳转与深链接**：来源 = 未登录访问任意 `RT-*`（路由守卫重定向）；入口参数 = `?next=<path>`；出口 =
`replace` 到 `nextPath` 或 `RT-PROJ-001`（**`/login` 不留在返回栈**，避免回退再次进入登录页）；
会话过期场景下返回栈保留原页面，**重新认证成功后回到原页面并恢复草稿**（Toast「已恢复上次未提交的改动。」）。
**登录方式切换（`EL-AUTH-017`，★本机落地）不改变路由、不新增历史记录、不清除已输入的用户名**；两条路径（账号密码 `#72` / 飞书扫码 `#63`+`#64`）**成功后的出口完全一致**（同一 `replace` 目标）。

**待澄清**：`[缺口-UI-01]` / `[缺口-API-01]`（飞书扫码登录链路补口 `#63`~`#66` **已转基线**；`E22 User` **已补**）、`[拆解缺口-Q4]`（**已闭合**：`E22 User` 已补）、`[待澄清-A04]`（页面重校验周期）。
**新增未确认项（★ 本机落地扩展）**：① `#72a` 未给「默认登录方式」字段 → 默认段由 `password_login` 推断（取「账号密码」优先），**未自行裁决**；② `feishu_login` 为 string 枚举（`real`/`development`，**不是 bool**）时是否仍呈现「飞书扫码」段，`UI-Spec` 未定义；③ `#72` 凭据错误的**字段级提示逐字文案** `UI-Spec` 未定义 → 本 Spec **不编造**；④ 本机落地 4 接口 / 7 元素**未过门禁、未进入第 4 轮基线冻结范围**。

### 5.2 项目列表 / 新建（`RT-PROJ-001` / `UI-PROJ-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-PROJ` | `listState` | enum{`idle`,`loading`,`loaded`,`empty`,`no_match`,`partial`,`error`,`forbidden`} | `idle` | 每次 `#1` 返回；`empty` 与 `no_match` **由 `q` 是否为空区分**，**六态互斥可枚举** |
| `STORE-PROJ` | `items` | `MODEL-PROJECT-LIST.items[]` | `[]` | `#1` 成功后整体替换（翻页时追加/替换按页码式语义） |
| `STORE-PROJ` | `listQuery` | {`page`:int,`page_size`:int,`q`:string,`sort`:string} | {`1`,`20`,`''`,`updated_at:desc`} | 搜索（防抖 300ms）/ 排序 / 每页条数 / 翻页 |
| `STORE-PROJ` | `total` / `hasMore` | int / bool | `0` / `false` | `#1` 成功后 |
| `STORE-PROJ` | `failedParts` | string[] | `[]` | `#1` 的 `data.failed_parts`；**非空即显示「部分加载」标记** |
| `STORE-PROJ` | `listError` | {`code`:string,`requestId`:string} \| null | `null` | `#1` 失败时 |
| `STORE-PROJ` | `createDialog` | {`open`:bool,`submitting`:bool,`name`:string,`description`:string} | {`false`,`false`,`''`,`''`} | 打开/关闭弹窗、输入、提交中；**失败时保留已填内容** |
| `STORE-PROJ` | `createFieldError` | {`message`:string,`field`:string} \| null | `null` | `#2` 返回 400 时 |
| `STORE-PROJ` | `renamingId` | string \| null | `null` | 点 `EL-PROJ-017` / 提交 / 回滚 |
| `STORE-PROJ` | `deleteTargetId` | string \| null | `null` | 点 `EL-PROJ-018` |
| `STORE-GLOBAL/PROJECT` | `current` | `MODEL-PROJECT` \| null | `null` | 进入项目时写入（`ProjectContext`，`REQ-PROJ-005`） |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 列表加载 | `API-PLAT-001`（`#1`） | 首屏 / 翻页 / 搜索 / 排序 / 每页条数变更 | `PARAM-LIST` | 写 `items`/`total`/`hasMore`/`sort`/`failedParts`；按 `q` 与 `total` 判定 `empty` / `no_match` | 「项目列表没加载出来。」+ 原因 +「重试」 |
| 新建项目 | `API-PLAT-002`（`#2`） | 点「确定」 | `PARAM-PROJ-DRAFT` + `PARAM-IDEM-KEY` | 关闭弹窗 + 列表**局部插入首位** + Toast「项目已创建」 | 400 →「项目名不能为空，长度 1~50。」**保留已填内容**；`IDEMPOTENT_REPLAY` → **无提示**采用首次结果 |
| 重命名 | `API-PLAT-004`（`#4`） | 行内输入 `Enter` / 失焦 | `PARAM-PROJ-ID` + `PARAM-PROJ-NAME-EDIT` + `If-Match` | 乐观更新 + Toast「名称已更新」 | **失败回滚** + Toast「名称不能为空，长度 1~50。」；409 → 统一冲突组件 |
| 删除项目 | `API-PLAT-005`（`#5`，⬛） | 二次确认后（`body {confirm:true}`） | `PARAM-PROJ-ID` | 列表移除 + **清空该项目维度缓存**（§7）+ Toast「项目已删除，30 天后彻底清除」 | 失败保留卡片 + Toast；500 →「出了点问题。」+ `request_id` +「重试」 |
| 知识库入口鉴权 | `API-PLAT-007`（`#7`） | 点 `EL-PROJ-016` | `PARAM-PROJ-ID` | 跳 `RT-KB-001` | 403 →「你没有权限访问这个项目。」（**不区分存在性**） |
| 当前用户 | **★`API-PLAT-066`**（`#66`） | 登录后首次进入 | 无 | 写 `MODEL-USER` | 401 → 跳登录并恢复草稿；缺省 →「未命名用户」/ 默认头像 |
| 登出 | **★`API-PLAT-065`**（`#65`） | 用户菜单「退出登录」 | 无 | 清会话 + 跳 `RT-AUTH-001` | 网络失败 → **本地强制登出** |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 首屏 / 翻页请求进行中 | `EL-PROJ-027` 骨架卡片 ×4 + 「正在加载项目…」（>3s 追加「还在加载，已用 {n} 秒…」；骨架**静态无 shimmer**） | 请求返回即退出；超时 → 错误态 + 「重试」 |
| 空数据 | `total = 0` **且无搜索词** | 「还没有项目」+「新建一个项目，把 PRD 丢进来，平台会把它补到可开发。」+ CTA「新建项目」 | 点 CTA 打开新建弹窗；**与「搜索无结果」必须是两个不同视图** |
| 错误 | 503 / 504 / 500 | 「项目列表没加载出来。」+「原因：服务暂时不可用（{code}）。」+「重试」 | 点「重试」重发 `#1`；`RATE_LIMITED` → 倒计时重试；**保留已输入的搜索词** |
| 无权限 | 逐对象鉴权失败（403） | 「你没有权限查看这些项目。」+「返回」（`EL-PROJ-031`） | 返回；**不透露对象是否存在** |
| 离线 | 网络中断 / `#1` 网络层失败 | 全局顶栏「连接已断开，正在重连…」+ 列表区**保留上一次成功结果并置灰**；「新建 / 重命名 / 删除 / 进入」全部**禁用 + 原因「网络断开，恢复后可继续。」** | 网络恢复 → **自动重取 `#1`**；重连期间不重试提交类请求 |

**跳转与深链接**：入口 = 登录成功后默认落地页（`[来源: 推断，待确认]`，`页面规格§1`）；出口 =
`RT-WORK-001`（点卡片 /「进入」）、`RT-KB-001`（「知识库」）。**返回栈**：本页为导航根之一，从项目进入工作台后**可回退**到本页；
重新登录后按 `nextPath` 恢复目标页。**不支持外部深链接**（`[待澄清-A03]`）。

**待澄清**：`[拆解缺口-Q5]`（**已闭合** 2026-10-21：采纳「移除该展示项」，`EL-PROJ-014` 无数据需求）、`[拆解缺口-Q4]`（**已闭合**：`E22 User` 已补）、`[冲突-UI-04]`（每页条数 20/50 vs 20/50/100，本 Spec 取 `REQ-NF-004` 的 **20/50/100**）。

### 5.3 知识库页（`RT-KB-001` / `UI-KB-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-KB` | `tab` | enum{`prd`,`spec`,`terms`,`domain`} | `prd` | 点 `EL-KB-005`~`008`（**各 tab 保留各自关键词**） |
| `STORE-KB` | `listState` | enum{`idle`,`loading`,`loaded`,`empty`,`no_match`,`partial`,`error`,`forbidden`} | `idle` | 每次 `#7` 返回 |
| `STORE-KB` | `items` | `MODEL-KB-DOC-LIST.items[]` | `[]` | `#7` 成功后 |
| `STORE-KB` | `queryByTab` | map<tab,string> | `{}` | 各 tab 搜索输入（防抖） |
| `STORE-KB` | `selectedDoc` | `MODEL-KB-DOC` \| null | `null` | 点列表项 / `#8` 返回 |
| `STORE-KB` | `editing` | {`active`:bool,`draft`:string,`dirty`:bool} | {`false`,`''`,`false`} | 点「编辑」/ 输入 / 保存 / 取消 |
| `STORE-KB` | `revisions` | `MODEL-REVISION-LIST.items[]` | `[]` | 展开 PRD 分区时 `#13` 返回（**倒序**） |
| `STORE-KB` | `conflict` | `MODEL-DIFF-ROW[]` \| null | `null` | `#9` 返回 409 时 |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 文档列表 | `API-PLAT-007`（`#7`） | 首次进入 / 切分区 / 搜索 | `PARAM-PROJ-ID` + `PARAM-LIST` | 写 `items` + 分页四项；按 `q`/`total` 判 `empty`/`no_match` | 「知识库没加载出来。」+「重试」；403 → 统一无权限态 |
| 文档正文 | `API-PLAT-008`（`#8`） | 选中条目 / 点「编辑」 | `PARAM-KB-DOC-ID` | 写 `selectedDoc.content_md`（**Markdown 转义渲染**） | 「这个内容已经不在了。」+「返回上一级」 |
| 保存编辑 | `API-PLAT-009`（`#9`） | 点「保存」 | `PARAM-KB-DOC-ID` + `PARAM-KB-DRAFT` + `If-Match` | `origin` 置 `user_edited` + Toast「知识库内容已保存」 | 409 →「该内容已被他人修改。」+ diff +「以我的为准」/「放弃我的改动」（**统一冲突组件**） |
| revision 列表 | `API-PLAT-013`（`#13`） | 展开 PRD 分区 | `PARAM-DOC-ID` | 写 `revisions`（倒序） | 空 → 空态；时间 `null` →「时间未知」 |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 首次进入 / 切分区 | 「正在加载知识库…」+ 骨架列表 ×5（静态） | 请求返回即退出 |
| 空数据 | `total = 0` 且无关键词（含**新项目首次可用**） | 「知识库还是空的。上传 PRD 后，平台会自动把内容抽进来。」+ CTA「上传 PRD」（**不报错**，`AC-KB-04`） | 点 CTA 跳 `RT-UPLOAD-001`；与「搜索无结果」分开 |
| 错误 | 接口失败 | 「知识库没加载出来。」+「重试」 | 点「重试」重发当前 tab 的 `#7`；保留关键词 |
| 无权限 | 逐对象鉴权失败 | 「你没有权限访问这个项目。」+「返回」 | 返回来源页；**不透露是否存在** |
| 离线 | 网络中断 | 顶栏「连接已断开，正在重连…」+ 内容区保留上次结果并置灰；「保存 / 编辑」**禁用 + 原因** | 恢复后自动重取当前分区；**编辑草稿不丢**（本地草稿） |

**跳转与深链接**：入口 = `RT-PROJ-001` 卡片「知识库」次按钮 / `RT-WORK-001` 状态条入口（**两处固定入口**，`REQ-KB-002`）；
参数 = 路径 `project_id` + `?tab=`；出口 = 「返回」回来源页。**返回栈**：从工作台进入时**回退到工作台**，从项目列表进入时**回退到列表**
（来源页写入 `STORE-KB.from`）。

**待澄清**：`[拆解缺口-Q4]`（**已闭合**：`E22 User` 已补）、元素构成/三态为 `[来源: 推断，待确认]`、`[冲突-UI-03]`（revision 历史在上传页与知识库页**两处展示**）。

### 5.4 工作台（`RT-WORK-001` / `UI-WORK-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-GLOBAL/PROJECT` | `stats` | `MODEL-PROJECT-STATS` \| null | `null` | `#6` 返回；**并由 SSE `task` 事件触发刷新（不轮询）** |
| `STORE-WORK` | `mode` | enum{`edit`,`preview`} | `edit` | 点 `EL-WORK-010` 分段控件；**写入 URL `?mode=`**；切换**不丢未提交改动** |
| `STORE-WORK` | `chatState` | enum{`idle`,`loading`,`loaded`,`empty`,`error`,`offline`} | `idle` | `#25` 返回 / SSE 事件 |
| `STORE-WORK` | `messages` | `MODEL-CHAT-MESSAGE[]` | `[]` | `#25`（按 `seq` 升序）+ SSE `chat.delta` **增量合并** |
| `STORE-WORK` | `chatDraft` | string | `''` | 输入框；发送成功后清空 |
| `STORE-WORK` | `sending` | bool | `false` | **同一时刻一条在途**；后发排队 |
| `STORE-WORK` | `emptySendHint` | bool | `false` | 空消息被拦截时置 `true`；输入变化后复位 |
| `STORE-WORK` | `overLengthHint` | bool | `false` | 超 20000 字符时 |
| `STORE-GLOBAL/TASK` | `appliedSeq` | int | `0` | **只应用 `seq > appliedSeq` 的结果**（`REQ-GEN-006`） |
| `STORE-GLOBAL/TASK` | `sseState` | enum{`connecting`,`online`,`reconnecting`,`degraded`} | `connecting` | SSE `ping`(15s) 到达 / 断开 / 降级 2s 轮询 |
| `STORE-GLOBAL/TASK` | `runningTask` | `MODEL-TASK` \| null | `null` | SSE `task` 事件 / `#44` 轮询 |
| `STORE-GLOBAL/URL` | `mode` | enum{`edit`,`preview`} | `edit` | 分段控件切换（**纯前端视图态，不落库、不进接口**） |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 状态条 | `API-PLAT-006`（`#6`） | 首次进入 + 每次 SSE `task` 事件后 | `PARAM-PROJ-ID` | 写 `stats`（`stage`/`version_seq`/`running_tasks`/`loopback_round`/`gate{verdict,blocking_count,major_count}`） | 失败 → 状态条降级「—」+ 顶栏黄条；403 → 统一无权限态 |
| 对话历史 | `API-PLAT-025`（`#25`） | 进入项目 | `PARAM-PROJ-ID` + `PARAM-LIST`（**`seq` 升序**） | 写 `messages` | 「对话没加载出来。」+「重试」 |
| 发送消息 | `API-PLAT-026`（`#26`，⚡ 202） | 点「发送」/ `Enter` | `PARAM-CHAT-DRAFT` + `PARAM-IDEM-KEY` | 追加本地消息（`status=sent`）+ 等 SSE `chat.delta` | 空内容 → 抖动 +「先说点什么再发送。」（**不发请求**）；超长 → 「消息最多 20000 字符，当前 {n} 字符。」；超时 60s → `failed` +「这条没发出去。」+「重发」 |
| 失败重发 | `API-PLAT-027`（`#27`） | 点「重发」 | `PARAM-MESSAGE-ID` | **同一 `message_id`** 就地转 `streaming` | 再失败 → 保持失败态；**不重复入库** |
| 任务状态 | `API-PLAT-044`（`#44`）/ `API-PLAT-045`（`#45` SSE） | SSE `task` 事件 / 降级 2s 轮询 | `PARAM-TASK-ID` | 写 `runningTask`；`canceled` → 非错误态 | `TASK_STALE` → 静默丢弃 +「已为你使用最新一次生成的结果。」；5min → `timeout` 可重试失败态 |
| 停止生成 | `API-PLAT-044A`（`#44a`） | 点「停止生成」 | `PARAM-TASK-ID` | `status = canceled`、丢弃产物、不入版本、回编辑态、预览保持上次成功结果 | 非 `running` → 400 → 提示当前状态；**不呈现为错误态、不计重试** |
| 项目详情 | `API-PLAT-003`（`#3`） | 首次进入 | `PARAM-PROJ-ID` | 写项目名 | 缺省 →「未命名项目」；403 → 统一无权限态 |
| 外发告知（首次生成前） | `API-PLAT-068`（`#68`，已转基线） | 对话触发生成入口被点击 | `PARAM-CONSENT` | 写 `consentAcknowledgedAt` | 写入失败 →「确认状态没保存成功。」 |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 进入项目、拉取对话与项目状态 | **对话面板内**「正在加载对话…」+ 中部 16px 转圈 | 请求返回即退出；超时 → 「对话没加载出来。」+「重试」 |
| 空数据（该步骤无线程） | **当前线程**无消息（项目其它线程有消息也算空） | 「这个步骤还没有对话。说说要改什么，或回答平台的问题。」 | 在该线程发送首条 |
| 空数据（项目无对话） | 对话列表为空 | 「还没有对话。说说要改什么，或回答平台的问题。」 | 发送首条即退出空态 |
| 错误 | 对话接口失败 | 「对话没加载出来。」+「重试」 | 点「重试」重发 `#25`；**已收消息保留**；生成失败/验证失败**不得共用此组件** |
| 无权限 | 401 / 403 | 401 → 跳 `RT-AUTH-001` +「登录已过期，已为你保留未提交的内容。」；403 → 「你没有权限访问这个项目。」 | 401 后**恢复草稿与目标页**；403 返回上级；**本页不渲染任何业务数据** |
| 离线 | SSE 断开 / 网络中断 | 顶栏「连接已断开，正在重连…」（`EL-WORK-024`）；**断线期间允许继续操作**；写操作保留队列不丢弃 | 自动重连（`EventSource`）+ **按 `seq` 取最新**；连续失败 → 指数退避 + **降级 2s 轮询 `#44`，界面无差别** |

**跳转与深链接**：入口 = 从 `RT-PROJ-001` 进入项目；参数 = 路径 `project_id`；出口 = `RT-UPLOAD-001` / `RT-REVIEW-001` /
`RT-SPLIT-001` / `RT-EDIT-001`(=`RT-PREVIEW-001`) / `RT-SPEC-001` / `RT-API-001` / `RT-CAP-001` / `RT-VER-001` / `RT-KB-001`。
**返回栈**：工作台是本项目的**枢纽页**，从子页返回时**回到工作台并保留左栏 `mode`**；**对话面板是全局悬浮层，跨页保持开合 / 位置 / 滚动**（不随路由重建）；
`EL-WORK-026` 阶段导航未到达的节点**置灰 + 原因「先完成上一步：{上一步名}。」**（不做静默降级）。

**待澄清**：`[拆解缺口-Q11]`（**已闭合** 2026-10-21）、`[拆解缺口-Q4]`（**已闭合**：`E22 User` 已补）、`[缺口-UI-10]`（<1280px 左栏折叠）、`[缺口-UI-11]`（输入框抖动与「无动效」口径冲突，本 Spec 暂按 **240ms** 实现并显式声明）。

### 5.5 上传页（`RT-UPLOAD-001` / `UI-UPLOAD-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-UPLOAD` | `pendingFiles` | {`file`:File,`name`:string,`sizeBytes`:int,`valid`:bool}[] | `[]` | 选择 / 拖入 / 移除 |
| `STORE-UPLOAD` | `stage` | enum{`idle`,`uploading`,`parsing`,`partial`,`succeeded`,`empty_document`,`failed`,`rejected`,`interrupted`} | `idle` | 各请求与任务状态；**`partial` 与 `empty_document` 是独立终态** |
| `STORE-UPLOAD` | `progress` | int（0~100） | `0` | XHR `upload.onprogress`（**本地产生，服务端不推**） |
| `STORE-UPLOAD` | `taskId` | string \| null | `null` | `#12` 的 202 响应；**离开页面后重进按 `task_id` 续查**（`REQ-UPLOAD-001`） |
| `STORE-UPLOAD` | `revisionId` | string \| null | `null` | `#12` 的 202 响应 |
| `STORE-UPLOAD` | `parseResult` | `MODEL-PARSE-RESULT` \| null | `null` | `#14` 返回 / 终态时 |
| `STORE-UPLOAD` | `elapsedSeconds` | int | `0` | 本地计时（基准 = `#44` 的 `started_at`；**>30s 才显示**） |
| `STORE-UPLOAD` | `rejectReason` | string \| null | `null` | `#10` 返回 `rejected` / 前端预校验 |
| `STORE-UPLOAD` | `revisions` | `MODEL-REVISION-LIST.items[]` | `[]` | `#13` 返回（倒序） |
| `STORE-GLOBAL/SESSION` | `consentAcknowledged` | bool | `false` | `EL-GLOBAL-007` 确认成功后（`#68`★） |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 上传文件 | `API-PLAT-010`（`#10`，`multipart`） | 点「开始解析」（**首次先过 `EL-GLOBAL-004`**） | `PARAM-UPLOAD-FILE` + `PARAM-IDEM-KEY` | 写 `MODEL-UPLOAD-FILE`；Toast「文件已上传，开始解析。」 | 413 →「文件超过 20MB（当前 {n}MB）。请压缩后重试。」；422 →「暂不支持该格式。请上传 .docx / .md 或飞书云文档链接。」；**外发关闭（`#68` 已就绪）** → 明确不可用原因（**不静默降级**） |
| 从飞书链接建文档 | `API-PLAT-011`（`#11`） | 飞书链接失焦校验 / 随提交 | `PARAM-FEISHU-LINK` | 写 `document_id`/`source_type` | 无效 →「链接无效或已失效。」；无权限 →「平台没有这篇文档的访问权限。」+「去飞书授权」（**两条分开**） |
| 触发解析 | `API-PLAT-012`（`#12`，⚡ 202） | 上传成功 / 链接建文档成功后 | `PARAM-DOC-ID`（**文件路径 = `#10` 出参 `document_id`**；`[缺口-APP-01]` **已闭合**） | 写 `taskId`/`revisionId`；Toast「解析完成」后自动跳 `RT-REVIEW-001` | `UPSTREAM_TIMEOUT` →「上游服务响应超时（{n}s）。」+「重试」；`UPSTREAM_UNAVAILABLE` →「服务暂时不可用（{code}）。」+「重试」；**不产生半成品记录** |
| 分块结果 | `API-PLAT-014`（`#14`） | 解析任务终态 / 轮询 | `PARAM-REVISION-ID` | 写 `parseResult`；按 `parse_status` 切 `partial`/`empty_document`/`succeeded` | `failed` →「解析失败了。」+ 原因 +「重试」；**`partial` 不是错误**（200 + `code=OK`） |
| 手动补充 | `API-PLAT-015`（`#15`） | 点某块「手动补充」（仅 `partial` 出现） | `PARAM-REVISION-ID` + `PARAM-PART-KEY` | 该块 `status → ok` | 字段级提示 + **保留输入** |
| 任务状态 | `API-PLAT-044`（`#44`）/ `API-PLAT-045`（`#45`） | 解析任务进行中 | `PARAM-TASK-ID` | 写 `started_at`（计时基准）与 `status`/`progress` | 5min → `timeout` 可重试失败态（**不静默卡死**） |
| revision 历史 | `API-PLAT-013`（`#13`） | 页面进入 / 解析完成 | `PARAM-DOC-ID` | 写 `revisions`（**倒序、不覆盖**） | 空 → 空态；时间 `null` →「时间未知」 |
| 外发告知 | **★`API-PLAT-068`**（`#68`） | 点「开始解析」时拦截 | `PARAM-CONSENT` | 写 `consentAcknowledgedAt` | 未点确认 → **不发上传**；写入失败 →「确认状态没保存成功。」 |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 上传阶段 / 解析阶段 | 上传中：「正在上传…{n}%」+ 进度条（逐次赋值、**非动画**）；解析中：四块逐块打勾 + 「正在解析…」，>30s 追加「还在解析，已用 {n} 秒…」 | 失败不静默卡死；超时 → 可重试失败态；「开始解析」在上传期间禁用 |
| 空数据 | 默认未选文件 | 拖拽区 + 「把 PRD 拖到这里，或点击选择文件」+「支持 .docx / .md / 飞书云文档链接，单文件 ≤ 20MB、≤ 100 页」；「开始解析」禁用 | 选入文件 / 填链接即可继续；**响应式空态而非错误态** |
| 错误 | `parse_status = failed` / 上传中断 | 「解析失败了。」+「原因：{可读原因}。」+「重试」；「上传中断了。」+「重试」 | 点「重试」重传/重解析；**已传部分不产生半成品记录**；三条规格拒绝文案各自独立 |
| 无权限 | 403（`#10`/`#12`/`#14`） | 「你没有权限访问这个项目。」（`UI-Spec §3.6` 统一文案） | 返回来源页；**不透露是否存在**；本页不渲染该项目任何数据 |
| 离线 | 网络中断 | 顶栏「连接已断开，正在重连…」+ 上传/解析区保留已得进度并置灰；「开始解析」「重试」**禁用 + 原因** | 恢复后：**按 `task_id` 续查 `#44`/`#14`**（离开页面后重进同一策略），**不重新上传** |

**跳转与深链接**：入口 = `RT-WORK-001` →「上传 PRD」（**首次上传前必须先过 `EL-GLOBAL-004`**）；参数 = 路径 `project_id`；
出口 = 解析全部成功**自动跳 `RT-REVIEW-001`**（空文档/失败**不自动跳**，停留本页并给出下一步）。

**待澄清**：无。原 `[缺口-APP-01]`（`#10` 的 `file_id` → `#12` 的 `document_id` **链缺环**）**已闭合**（2026-10-21 · `P0-补口裁决单`：`#10` 出参已增 `document_id`）。

### 5.6 审核结果页（`RT-REVIEW-001` / `UI-REVIEW-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-REVIEW` | `reviewState` | enum{`not_started`,`running`,`done`,`stale_superseded`,`malformed`,`error`} | `not_started` | `#17` 返回 / 审核任务终态 |
| `STORE-REVIEW` | `report` | MODEL-REVIEW或null | null | #17返回报告与prd元信息，#6提供loopback_round；savedPrd由GET8读取 |
| `STORE-REVIEW` | `items` | `MODEL-REVIEW-ITEM[]` | `[]` | `#18` 返回（**整体状态：先出骨架再填充**） |
| `STORE-REVIEW` | `questions` | `MODEL-GATE-QUESTION[]` | `[]` | `#19` 返回 |
| `STORE-REVIEW` | `answerDrafts` | map<question_code,string> | `{}` | 页面内存，规范化后确认随 #23 保存；不实现 blur/离页自动落盘 |
| `STORE-REVIEW` | `assumptions` | `MODEL-ASSUMPTION[]` | `[]` | `#21` GET/POST |
| `STORE-REVIEW` | `acceptCandidates` | string[]（`gate_code`） | `[]` | 勾选 `EL-REVIEW-013` /「一键采纳」`#22`（**仅本地勾选态，不等于写入**） |
| `STORE-REVIEW` | `writebackState` | enum{`idle`,`confirming`,`writing`,`done`,`failed`} | `idle` | `EL-REVIEW-031` 提交 / `#23` 返回 |
| `STORE-REVIEW` | `standard` | `MODEL-GATE-STANDARD` \| null | `null` | `#24` GET / PUT |
| `STORE-REVIEW` | `blockingOpen` | int | `0` | `#19` / `#16` 400 分支 |
| `STORE-REVIEW` | `partialResults` | `MODEL-REVIEW-ITEM[]` | `[]` | 失败/超时时**保留已出的部分结果**（`REQ-REVIEW-008`） |
| `STORE-REVIEW` | `agentMalformed` | bool | `false` | 自动重试 1 次仍失败时（`EL-REVIEW-042`） |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 页面进入（已有报告） | `API-PLAT-016`（`#16`，**不带 `force`**） | 页面进入 | `PARAM-REVISION-ID` | `reused=true` + `task_id=null` → **直接用已有报告**，**不新建、不作废、不调模型**〔2026-10-22 决策 D-1〕 | `gate.verdict="unreviewed"` → 走「尚未审核」空态（不发 `#16`） |
| 评分卡 | `API-PLAT-017`（`#17`） | 进入 / 审核任务终态 | `PARAM-REVIEW-ID` | 写 `report`；`superseded` → 走独立「已过期」视图 | 未开始 →「还没开始审核。」+「开始审核」；失败 →「审核没跑完。」+ 原因 +「重试」 |
| 评分卡逐项 | `API-PLAT-018`（`#18`，分页） | 进入 / 提交复审后 | `PARAM-REVIEW-ID` + `PARAM-LIST` | 写 `items`（按 `standard_version` 全部检查项，**不写死 43 项**） | 空 →「暂无内容」；失败 → **保留 `partialResults`** +「重试」 |
| 待澄清清单 | `API-PLAT-019`（`#19`，分页） | 进入 | `PARAM-REVIEW-ID` + `PARAM-LIST` | 写 `questions` | 空 →「没有待澄清项，可以直接进入拆解。」 |
| 逐条作答 | 本地态；#23 answers[]（独立 #20 接口保留） | 输入；确认写入 | question_code/answer | 非空答复参与 dirty/阻断判断 | 当前无离页草稿自动恢复；不把 #20 status=answered 当作已进入 PRD |
| 假设清单 | #21 GET/POST；成功重拉 #19/#21 | 每次选择 | assumption_code/choice | `#21 POST` 返回 `converted_question_code`（convert 为 `{assumption_code}_converted`，accept 为 null）；convert 创建/恢复 blocking 问题，accept 将对应问题 status 置 converted（归档但保留 answer）。`GET #19` 排除 status=converted；前端选择成功重拉 #19/#21，在假设下显示复用 `EL-REVIEW-022` 的补充答复框，与问题区同一 question_code/answer 状态联动；切回 convert 时服务端恢复历史答复。 | 选择中锁定；与问题区共享 answer，不新增作答 API |
| 写回已勾选（{n} 项） | 不调#22，确认后#23 | 当前勾选集合/答案 | accepted/answers | 打开EL28 | canWrite=false或accepted=∅且无规范化非空答复才disabled；0项可只写答复；正常禁用无点击高亮 |
| 未通过项补充信息 | 本地态，确认随 #23 supplements[] | fail 行输入 | supplements[item_code] | trim 非空自动勾选 EL-REVIEW-013 | 保存/选择/过期时禁用；有效项写正文，不直接变 pass |
| 一键采纳 | #22 | 底部入口→立即弹EL28 | 当前候选item_codes | 仅批量勾选不写PRD | canWrite=false disabled；unset定位兜底处理函数保留但禁用正常点击不可达；不埋入口事件 |
| 提交复审 | `API-PLAT-016`（`#16`，⚡ 202，**带 `force:true`**） | **有未答阻断时不弹二次确认、不走本接口**（前端预检）；无未答阻断时二次确认后 | `PARAM-REVISION-ID` + `PARAM-DEPTH`（传当前档位；缺省取项目级 `E1 Project.depth`）+ `PARAM-IDEM-KEY` | 写新 `review_id`/`task_id`；旧卡标「已过期」 | 〔2026-10-23〕有未答阻断 → **前端预检拒绝（不发 `#16`）**；绕过（直连 API）才由服务端 `#16` 返回 400 → 「还有 {n} 项阻断没有作答，无法进入拆解。」+ 高亮跳转；**不带 `force` 会被服务端复用而不会重跑**，故「提交复审 / 重新审核 / 重试」三个入口**必须显式 `force:true`**〔2026-10-22 决策 D-1〕 |
| 回写 PRD | #23 | 确认写入 | confirm/snapshot=true，accepted_items、supplements[]、optional answers[] | `deleted_lines` / `modified_lines` / `added_lines` / `diff_summary{deleted_lines,modified_lines,added_lines}` / `changed` / `new_revision_id` / `kb_doc_id` / `kb_version` / `content_hash` / `sections_added[]` / `snapshot` / `snapshot_id` | `#23` 在一次事务中保存规范化答复、采纳集合、有效补充、原文快照；正文有变化才更新知识库 version 并产生同 document_id 的新 revision、作废旧审核。阻断空答/unset/非法编号拒绝整次；legacy title 映射只用于落章、不改历史标准 |
| 写回后自动重审 | #23→GET #8→#16 force:true（silent 仅前端标记） | `#23` 成功后用返回的 `kb_doc_id` 调 `GET #8`，回读 `doc.version === kb_version`、`doc.content_hash === #23.content_hash`，并逐条确认补充正文存在。**#8 的 content_hash 由服务端对本次返回的 content_md 算 SHA-256**；前端仅比对返回字段，兼容 192.168 局域网 HTTP，不依赖浏览器安全上下文或客户端摘要 API。仅 `changed=true` 且核验成功、自动开关为开才发 `#16 force:true`；缺字段/GET8失败/版本或hash不匹配/正文缺补充 → documentError，停止自动复审并禁用手动复审与写回，不得手动绕过；`changed=false` 不生新版本、不自动重审。 | 新 revision | 新评分卡/#18 supplement 回显 | 不报 EVT_review_submit；新报告按同项目、同 `document_id` 的上一份 passed/blocked 报告按 `item_code` 取历史项；旧 `supplement` 非空且被当前审核正文包含才继承。`accepted` 仅本轮仍 fail、旧 accepted，且（上述有效 supplement 或 **旧/新 suggestion 相同、旧 suggestion 非空且当前 markdown 包含该 suggestion**）才继承。same-suggestion 分支已按当前代码加固，不再列“未落实建议被继承”缺口；不覆盖本轮模型 verdict/counts，不静默免审。 |
| 进页自动开审 | `API-PLAT-016`（`#16`，**带 `force:true`**；`silent` 同上，**非接口入参**） | 〔2026-10-26〕进页探测为「**未审核**」且 `EL-REVIEW-054` 为**开** | `PARAM-REVISION-ID` | 直接进入加载态 → 新评分卡（**免一次「开始审核」点击**） | **不报 `EVT_review_submit`**；开关关掉 → 走空态（`EL-REVIEW-039`）+「开始审核」 |
| 门禁标准读写 | `API-PLAT-024`（`#24`） | 打开/保存抽屉 | `PARAM-STANDARD-ITEMS` + `If-Match` | `version` 回显「门禁标准已保存（v{n}）。历史评分不重算。」 | `FORBIDDEN` → 统一无权限态；409 → 统一冲突组件 |
| 审核任务进度 | `API-PLAT-044` / `API-PLAT-045` | 审核任务 `running` | `PARAM-TASK-ID` | 写进度；>5min 追加上限说明 | 失败 →「审核没跑完。」+ 原因 +「重试」 |
| 导出审核报告 | `API-PLAT-069`（`#69`，GET，**需鉴权**） | 点 `EL-REVIEW-027` | `PARAM-PROJ-ID` + `PARAM-REVIEW-ID` | 浏览器下载报告文件；Toast「审核报告已导出」 | `FORBIDDEN` → 统一无权限态；失败 → 可重试失败态（**不呈现为成功**）；**不含密钥与内部凭据** |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 审核任务 `running` | 「正在审查这份 PRD…」；**>5min 追加**「已超过 5 分钟，可以继续等待或稍后回来查看。」；评分卡先出骨架再填充 | 超时 → 失败态 +「重试」，**已出的部分结果保留展示** |
| 空数据 | ① 待澄清 0 条 ② 尚未审核 ③ **评分卡已过期** | ① 「没有待澄清项，可以直接进入拆解。」+「进入需求拆解」；② 「还没开始审核。」+「开始审核」；③ **`EL-REVIEW-033`**「这份评分卡已过期（PRD 已更新到 {revision}）。」+「重新审核」 | **三个空/特态必须是三个视图**（与「未通过」区分）；③ 的触发 = `#6` 的 `gate.review_revision_id ≠ current_revision_id`，**进页只提示、不自动开审**〔2026-10-22〕；②③ 点击后调 `#16`，均带 **`force:true`** |
| 错误 | `verdict = failed` / 超时 / agent 输出畸形 | 「审核没跑完。」+「原因：{…}。」+「重试」；畸形 → 「平台的输出格式不对，已自动重试一次仍失败。」+「需人工确认」 | 前者的部分结果保留；后者走**提示态 + 人工入口**，**不自动重试到死、不静默丢弃** |
| 无权限 | 403（`#17`/`#18`/`#19`/`#23`/`#24` PUT 需 admin） | 「你没有权限访问这个项目。」（统一文案，**不透露存在性**）；`EL-REVIEW-049` 管理员入口对非管理员**不渲染** | 返回来源页；**不做「点了没反应」** |
| 离线 | 网络中断 | 顶栏「连接已断开，正在重连…」+ 评分卡/清单保留已得内容并置灰；作答框**允许输入但禁用提交**（本地草稿继续保存） | 恢复后自动重取 `#17`/`#18`/`#19`；**草稿不丢** |

**跳转与深链接**：入口 = 解析成功后**自动进入** / `RT-WORK-001` →「审核结果」；参数 = 路径 `project_id` + `?drawer=gate-standard`；
出口 = `RT-WORK-001`（对话补充，F4）/ `RT-SPLIT-001`（进入拆解）/ 原文视图（证据跳转，**返回后回到原行位置**）。
**返回栈**：从上传页自动进入时，**返回工作台而非上传页**（上传已完成，回退无意义）；抽屉开启**不新增历史记录**（`?drawer=` 用 `replace`）。

**待澄清**：`[缺口-API-02]`/`[缺口-API-03]`（**已闭合** 2026-10-21：`#19` 增 `impact`、`#6` 增 `loopback_round`）、`[冲突-UI-02]`（**无独立门禁标准配置页** → 本 Spec 按 13 页处理，落为抽屉）。**已闭合（2026-10-21 · `P0-补口裁决单`）**：`[缺口-APP-03]`（→ 接口 `#69`，按钮**正常可用**）、`[缺口-APP-04]`（→ 接口 `#70`，**正常可用**）、`[拆解缺口-Q2-附]`（→ 按当前 `standard_version` 全部检查项）、`[拆解缺口-Q3]`（→ 项目级 + 管理员维护）、`[拆解缺口-Q6]`（→ 项目级 `E1 Project.depth`）。

### 5.7 需求拆解页（`RT-SPLIT-001` / `UI-SPLIT-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-SPLIT` | `splitState` | enum{`empty`,`running`,`done`,`error`,`partial_empty`} | `empty` | `#29` 返回 / `#28` 任务终态 |
| `STORE-SPLIT` | `packages` | `MODEL-ROLE-PACKAGE[]` | `[]` | `#29` 返回（**固定 5 角色**） |
| `STORE-SPLIT` | `depth` | enum{`minimal`,`standard`,`comprehensive`} | `standard` | 点 `EL-SPLIT-005`；初值取项目级 `E1 Project.depth`；**提交时传当前档位**（`#16`/`#28` 均可带可选 `depth`；`[拆解缺口-Q6]` **已闭合** 2026-10-21） |
| `STORE-SPLIT` | `runningTask` | `MODEL-TASK` \| null | `null` | `#28` 的 202 + SSE；**非空即禁用「重新拆解」**（单飞） |
| `STORE-SPLIT` | `rejected` | bool | `false` | `#28` 返回 409 时（「上一次拆解还没结束。」） |
| `STORE-SPLIT` | `trackPlan` | `MODEL-TRACK-PLAN-ITEM[]` | `[]` | `#59` 返回 |
| `STORE-SPLIT` | `traceRows` | `MODEL-TRACE-ROW[]` | `[]` | `#67`★ 返回（抽屉打开时） |
| `STORE-SPLIT` | `expandedRoles` | string[] | `[]` | 点 `EL-SPLIT-011`（**视图态，不落库**） |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 角色需求包 | `API-PLAT-029`（`#29`，分页） | 进入 / 拆解完成 | `PARAM-PROJ-ID` + `PARAM-LIST` | 写 `packages`（`role` + `req_ids[]`） | 「拆解失败了。」+「重试」；某角色 `req_ids = []` →「这一角色没有拆出需求。」+「回到对话补充」 |
| 重新拆解 | `API-PLAT-028`（`#28`，⬛ ⚡ 202） | 二次确认后 | `PARAM-PROJ-ID` + `PARAM-DEPTH`（传当前档位；缺省取项目级 `E1 Project.depth`）+ `PARAM-IDEM-KEY` | 写 `runningTask`；旧 Spec **归档为历史版本（不删除）** | **409** →「上一次拆解还没结束。」+ 按钮禁用（**前端禁用 + 服务端 409 双保险**） |
| 拆解任务状态 | `API-PLAT-044` / `API-PLAT-045` | 拆解任务进行中 | `PARAM-TASK-ID` | 写进度；完成后 Toast「拆解完成，共 {n} 条需求。」 | 5min → 可重试失败态 |
| 埋点方案摘要 | `API-PLAT-059`（`#59`） | 进入 / 展开摘要 | `PARAM-PROJ-ID` + `PARAM-LIST` | 写 `trackPlan`（`event_key` + `trigger_desc`） | 空 →「还没有埋点方案。」 |
| 追溯矩阵 | `API-PLAT-067`（`#67`，已转基线） | 打开 `?drawer=trace` | `PARAM-PROJ-ID` + `PARAM-LIST` + `coverage_status` | 写 `traceRows`；跳转后**高亮对应行** | 入口可用；失败 →「追溯矩阵没加载出来。」+「重试」 |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 拆解任务 `running` | 「正在按角色拆分需求…」+ 骨架卡片 ×5（静态） | 超 5min → 可重试失败态；拆解中**禁用「重新拆解」** |
| 空数据 | 无拆解结果 | 「还没有需求包。」+「开始拆解」 | 点「开始拆解」调 `#28`；**某角色 0 条是「部分空」，不是页面空态** |
| 错误 | 接口失败 / 超时 | 「拆解失败了。」+「重试」 | 点「重试」重发 `#28`/`#29`；**已得的角色包保留展示** |
| 无权限 | 403（`#29`/`#59`） | 「你没有权限访问这个项目。」 | 返回来源页；**不透露存在性** |
| 离线 | 网络中断 | 顶栏「连接已断开，正在重连…」+ 角色包保留并置灰；「重新拆解」**禁用 + 原因** | 恢复后自动重取 `#29`；拆解中任务按 `task_id` 续查 |

**跳转与深链接**：入口 = 门禁通过后 / `RT-WORK-001` 阶段导航「拆解」；参数 = 路径 `project_id` + `?drawer=trace`；
出口 = `RT-SPEC-001`（拆解完成）/ `RT-WORK-001`（「回到对话补充」）/ 追溯矩阵行 → `RT-SPEC-001` 并**高亮**。

**待澄清**：`[冲突-UI-05]`（`REQ-SPLIT-004` 的 UI 落点与 `需求条目表` 角色列不一致）、`[拆解缺口-Q7]`（**已闭合** 2026-10-21：只走 `#62` 不留库）。**已闭合**：`[拆解缺口-Q6]`（2026-10-21：落点 = 项目级 `E1 Project.depth`，默认 `standard`）。

### 5.8 可视化编辑页（`RT-EDIT-001` / `UI-EDIT-001`）★ 本期核心

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-EDIT` | `pageState` | enum{`loading`,`loaded`,`empty`,`error`,`forbidden`} | `loading` | `#35` 返回 |
| `STORE-EDIT` | `tree` | `MODEL-ELEMENT-TREE[]`（**与控件树同一份数据**，禁止第二份） | `[]` | `#35` / `#36` / `#37` / `#38` |
| `STORE-EDIT` | `selection` | {`elementId`:string,`tempId`:string\|null} \| null | `null` | 点画布 / 点树节点 / 方向键；**驱动画布框 + 手柄 + 树高亮（三重表达同源）** |
| `STORE-EDIT` | `styleDraft` | `MODEL-STYLE-PROPS`（13 字段） | 选中元素的当前值 | 属性面板改值（**仅本地渲染，不触发任务**） |
| `STORE-EDIT` | `fieldErrors` | {`field`:string,`message`:string,`received`:string}[] | `[]` | `#39` 返回 400/422 |
| `STORE-EDIT` | `eventsDraft` | `MODEL-ELEMENT-EVENTS` | `{events:[]}` | 勾选 `EL-EDIT-032`~`034`（**三类可并存，≤3 条**） |
| `STORE-EDIT` | `undoStack` / `redoStack` | 草稿快照栈 | `[]` | 每次本地变更（撤销/重做） |
| `STORE-EDIT` | `linkSides` | bool | `false` | `EL-EDIT-030` 四边联动锁 |
| `STORE-EDIT` | `controlFilter` | string | `''` | `EL-EDIT-002`（**本地过滤，不走接口**） |
| `STORE-EDIT` | `limitHint` | bool | `false` | 第 201 个控件 |
| `STORE-EDIT` | `submitState` | enum{`idle`,`submitting`,`queued`,`generating`} | `idle` | 点「提交变更」→ `#43` 202（**立即回编辑态但状态条显示「生成中」**） |
| `STORE-EDIT` | `draftRecovered` | bool | `false` | 从本地草稿 / `#42` 恢复成功 |
| `STORE-GLOBAL/TASK` | `appliedSeq` | int | `0` | **只在 `seq > appliedSeq` 时应用结果**；旧响应静默丢弃 |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 页面与元素树 | `API-PLAT-035`（`#35`） | 打开页面 | `PARAM-PROJECT-ID` + `PARAM-PAGE-ID` | 写 `tree` + `module_code` | 「页面没载入出来。」+「重试」；403 → 统一无权限态 |
| 新增元素 | `API-PLAT-036`（`#36`） | 拖拽落点合法 / 键盘放置 | `widget_type` + `parent_element_id` + `order_index` + `alias` + `temp_id` + `PARAM-IDEM-KEY` | `data.element_id` 回执后才**写入本地元素树** | 落点非法 → **前端先拦** +「这个位置放不了：{原因}。」；>200 →「单页最多 200 个控件。」；`widget_type` 非法 →「不支持的控件类型。」 |
| 层级与排序 | `API-PLAT-037`（`#37`） | 控件树拖拽 / 同级排序 | `PARAM-ELEMENT-ID` + `alias`/`parent_element_id`/`order_index` | 更新 `tree` | 409 → 统一冲突组件；跨层级非法 → **拒收 + 原因**（**永不出现孤儿节点**） |
| 删除控件 | `API-PLAT-038`（`#38`，⬛） | 二次确认后 | `PARAM-ELEMENT-ID` | `status = void` + `voided_at`；节点移出渲染树，id 台账可查 | 失败 → 保留节点 + Toast；**id 不可回收、不复用** |
| 保存样式 | `API-PLAT-039`（`#39`，**服务端二次校验**） | 提交前 / 样式失焦（按实现策略） | `PARAM-ELEMENT-ID` + `PARAM-EDIT-TREE` | 写回 `MODEL-STYLE-PROPS` | 400/422 → 字段级 `message` + `data.field` + `data.received`（**保留已输入**）；409 → 统一冲突组件 |
| 保存事件 | `API-PLAT-040`（`#40`） | 勾选三类事件后 | `PARAM-ELEMENT-ID` + `events[]`（`event_type` + `action_type = none`） | 写 `eventsDraft`；显示「暂无动作（TODO）」 | >3 条 → 400 `INVALID_ARGUMENT` |
| 草稿读写 | `API-PLAT-042`（`#42`） | 本地防抖保存 + 打开页面时恢复 | `PARAM-PAGE-ID` | 恢复草稿 +「已恢复上次未提交的改动。」 | 409 → 统一冲突组件；**绝不静默丢弃** |
| 提交变更 | `API-PLAT-043`（`#43`，⚡ 202） | 点「提交变更」（**首次先过 `EL-GLOBAL-004` + 检查外发开关**） | `PARAM-INPUT-HASH` + `PARAM-BASE-SEQ` + `PARAM-IDEM-KEY` | 写 `runningTask`；**立即回编辑态 + 状态条「生成中」**；**不阻塞继续编辑** | `TASK_STALE` → 静默丢弃 +「已为你使用最新一次生成的结果。」；`RATE_LIMITED` → 倒计时；**外发关闭（`#68` 已就绪）** → 按钮置灰 +「你已关闭「PRD 与代码外发第三方大模型」，生成不可用。」+「去开启」 |
| 元素 id 台账 | `API-PLAT-041`（`#41`，分页） | 打开抽屉 | `PARAM-PROJ-ID` + `PARAM-LIST` | 写台账（含 `void` 项） | 空 →「还没有分配过元素 id。」；失败 →「台账没加载出来。」+「重试」 |
| 取消生成 | `API-PLAT-044A`（`#44a`） | 点「停止生成」 | `PARAM-TASK-ID` | `canceled`；丢弃产物、不入版本；预览保持上次结果 | 非 `running` → 400；**非错误态** |
| L2 回传标记 | `API-PLAT-044`（`#44`）/ `API-PLAT-046`（`#46`） | 任务终态 | `PARAM-TASK-ID` | `l2_result.reported = false` → 「未验证构建」灰字 + 悬浮说明 | 不阻断任何操作（`REQ-GEN-003`） |
| 外发告知 | **★`API-PLAT-068`**（`#68`） | 点「提交变更」时拦截 | `PARAM-CONSENT` | 写 `consentAcknowledgedAt` | 未确认 → **不发起生成**；写入失败 →「确认状态没保存成功。」 |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 打开已有页面 | 「正在载入页面…」+ 骨架（静态） | 超时 → 错误态 +「重试」；**刷新后草稿恢复**（本地 + `#42`） |
| 空数据 | 页面元素数为 0 | 「这个页面还是空的。」+「从左边拖一个控件进来试试。」；控件树空态「画布上还没有控件。从左边控件面板拖一个进来。」 | 从控件面板拖入；**空态不是错误态**；未选中控件时属性/事件面板整体置灰 +「先在画布上选中一个控件。」 |
| 错误 | 页面/元素接口失败；样式校验失败 | 「页面没载入出来。」+「重试」；样式 → 字段级气泡（如「宽只能是 1~2000dp，或选「自适应 / 撑满」。」） | 点「重试」重发 `#35`；**非法输入保留全部已输入内容**；服务端二次校验（前端不假设本地合法即合法） |
| 无权限 | 403（`#35`~`#42` 任一） | 「你没有权限访问这个项目。」（统一文案） | 返回工作台；**权限撤销 ≤5min** 内由重校验或 403 兜底（`REQ-AUTH-003`），**不静默继续写** |
| 离线 | 网络中断 | 顶栏「连接已断开，正在重连…」+ 画布**仍可本地编辑**（样式即时生效仅本地）；「提交变更」「删除控件」**禁用 + 原因**；「未验证构建」灰字保持 | 恢复后：本地草稿**自动补写 `#42`**；**提交串行排队**，不并发写入；不重复提交（幂等键 3s 复用） |

**跳转与深链接**：入口 = `RT-WORK-001` 左栏切「编辑」（`?mode=edit`）；参数 = 路径 `project_id` + `?mode=`；
出口 = `RT-PREVIEW-001`（同路径切 `mode=preview`）、`EL-EDIT-011`…`EL-EDIT-052` 各抽屉（**均不新增历史记录**）。
**返回栈**：编辑↔预览切换**不产生历史记录**（`replace`），保证浏览器「后退」不会在两个模式间反复跳；
**离开页面前若草稿未提交 → 静默本地保存，不弹确认**（`REQ-UIEDIT-007`）。

**待澄清**：`[拆解缺口-Q2]`（**已闭合** 2026-10-21：11 = §F14 行数）、`[缺口-UI-09]`（键盘替代键位）、`[拆解缺口-Q13]`（**已闭合**：`#39`/`#40`/`#53`/`#58` 已补 `If-Match`）、`[缺口-UI-12]`（id 序号溢出形式）。**已闭合**：`[缺口-APP-02]`（2026-10-21：`#44` 出参已增 `l2_result{reported,passed,log_digest}`）。

### 5.9 预览态（`RT-PREVIEW-001` / `UI-PREVIEW-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-PREVIEW` | `state` | enum{`empty`,`generating`,`verifying`,`gen_failed`,`verify_failed`,`load_failed`,`stopped`,`ready`} | `empty` | 由**任务状态 + 验证状态 + 前端资源状态**合成；**互斥且可枚举**（`REQ-PREVIEW-002`） |
| `STORE-PREVIEW` | `artifacts` | `MODEL-ARTIFACTS` \| null | `null` | `#47` 返回；**只在 L1 `passed` 后替换内容**（**无淡入动画，直接替换**） |
| `STORE-PREVIEW` | `seq` | int \| null | `null` | SSE `task` / `#44`；**只应用序号最新的结果** |
| `STORE-PREVIEW` | `finishedAt` | datetime \| null | `null` | `#44`；`null` → 显示「时间未知」 |
| `STORE-PREVIEW` | `progress` | int（0~100） | `0` | SSE `task` 的 `progress` / `#44` |
| `STORE-PREVIEW` | `l1Checks` | {`rule`,`ok`,`evidence`}[] | `[]` | `#49` 返回（**5 条规则逐条打勾**） |
| `STORE-PREVIEW` | `verifyAttempt` | int（0~3） | `0` | `#49` / `#48` 返回的剩余次数 |
| `STORE-PREVIEW` | `l2Reported` | bool | `false` | `#46` / `#44` 的 `l2_result.reported`（**附加标记，可与其它态叠加，不是独立态**） |
| `STORE-PREVIEW` | `diffPanelOpen` | bool | `false` | 点 `EL-PREVIEW-004`（**近似预览标记常驻，不随状态隐藏**） |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 代码产物 | `API-PLAT-047`（`#47`） | **L1 `passed` 后** | `PARAM-TASK-ID`（`result_ref`） | 写 `artifacts` + 本地渲染器绘制为 DOM/Canvas | L1 未过 → 接口**不得**返回「已就绪」（`CONFLICT`）→ 保持上一成功结果；渲染失败 →「预览没加载出来。」+「重试」（30s 超时） |
| 任务序号与时间 | `API-PLAT-045`（`#45` SSE）/ `API-PLAT-044`（`#44`） | SSE `task` 事件 / 降级轮询 | `PARAM-TASK-ID` | 写 `seq`/`finishedAt`；刷新 `EL-PREVIEW-003` | `finished_at = null` →「时间未知」（**禁 1970**）；旧 `seq` → 不应用 |
| 生成进度 | `API-PLAT-045` / `API-PLAT-044` | `GenTask ∈ {queued,running}` | `PARAM-TASK-ID` | 写 `progress`（逐次赋值，无过渡动画） | 5min → 可重试失败态（**给进度反馈而非静默失败**） |
| L1 逐规则 | `API-PLAT-049`（`#49`） | `VerifyTask(L1)` 运行中/结束 | `PARAM-TASK-ID` | 写 `l1Checks`（5 条逐条打勾） | 失败 → 转 `verify_failed` + 原因 + 剩余次数 |
| 验证重试 | `API-PLAT-048`（`#48`） | 点「重试（还剩 {n} 次）」 | `PARAM-TASK-ID` + `verify_id` | `attempt` 递增；返回**剩余次数** | `attempt ≥ 3` → 400 → 按钮变「需要人工介入」+「查看验证日志」，**停止自动重试** |
| 重新生成 | `API-PLAT-043`（`#43`，⚡） | 点「重新生成」（生成失败态） | `PARAM-INPUT-HASH` + `PARAM-BASE-SEQ` + `PARAM-IDEM-KEY` | 新 `task_id`/`seq`；**元素树不变** | 同 §5.8 的 `#43` 失败分支（`TASK_STALE`/`RATE_LIMITED`/外发关闭） |
| 停止生成 | `API-PLAT-044A`（`#44a`） | 点「停止生成」 | `PARAM-TASK-ID` | `canceled` → `state = stopped`；**预览保持上一次成功结果不变** | 非 `running` → 400；**不呈现为错误态、不计重试** |
| L2 回传标记 | `API-PLAT-046`（`#46`）/ `API-PLAT-044` | 回传到达 | `PARAM-TASK-ID` | 写 `l2Reported` → 「未验证构建」灰标 + 悬浮说明 | **不阻断用户** |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | `GenTask ∈ {queued,running}` / `VerifyTask(L1).status = running` | 「正在生成代码…」+ `{n}%`（**与「验证中」必须可区分**）；「正在验证生成的代码…」+ L1 逐条打勾 | 5min → 可重试失败态；**给进度反馈而非失败**（`REQ-NF-001`） |
| 空数据 | 从未生成过 | 「还没生成过页面。」+「在左边拖几个控件，然后提交变更。」 | 切回编辑态拖控件；**近似预览标记仍常驻**（空态同样显示，`UI-Spec §6` 呈现要求 5） |
| 错误 | 生成失败 / 验证失败 / 渲染加载失败（**三态分开**） | 「代码没生成出来。」+ 原因 +「重新生成」；「生成的代码没通过验证。」+ 原因 +「重试（还剩 {n} 次）」/`n=0`「需要人工介入」+「查看验证日志」；「预览没加载出来。」+「重试」 | **生成失败与验证失败是两个独立组件/文案，不得共用**（`REQ-GEN-008`）；渲染失败 30s 超时；**不得把渲染器差异渲染成"错误"** |
| 无权限 | 403（`#47`/`#49`） | 「你没有权限访问这个项目。」 | 返回工作台；预览区**不渲染任何业务数据** |
| 离线 | 网络中断 / SSE 断开 | 顶栏「连接已断开，正在重连…」+ 预览区**保留上一次成功结果**并置灰；「重新生成」「重试」**禁用 + 原因** | 恢复后按 `seq` 取最新；**SSE 不可用时降级 2s 轮询 `#44`，界面无差别** |

**跳转与深链接**：入口 = `EL-WORK-012` 分段控件切「预览」（`?mode=preview`，**与 `RT-EDIT-001` 同路径、`replace` 切换**）；
出口 = 切回编辑态。**返回栈**：与编辑态共用一条历史记录，切换**不产生新记录**；**预览态只读**（所有编辑入口关闭，**不做"只读"提示弹窗轰炸**）。

**待澄清**：`[拆解缺口-Q11]`（**已闭合** 2026-10-21：来源标签已更正）。**已闭合**：`[拆解缺口-Q8]`（2026-10-21：第二组重编为 `AC-ED-21`/`AC-ED-22`，`AC-ED-18`/`AC-ED-19` 保留给「取消」语义，行序重排 18→22）。

### 5.10 接口管理页（`RT-API-001` / `UI-API-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-API` | `listState` | enum{`idle`,`loading`,`loaded`,`empty`,`no_match`,`partial`,`error`,`forbidden`} | `idle` | 每次 `#50` 返回 |
| `STORE-API` | `items` | `MODEL-API-DEF[]` | `[]` | `#50` 成功后 |
| `STORE-API` | `listQuery` | {`page`,`page_size`,`q`,`status`} | {`1`,`20`,`''`,`all`} | 搜索（`code`/`name`/`path`）/ 状态筛选 / 翻页 |
| `STORE-API` | `drawerId` | string \| null | `null` | 点「编辑」/「新建接口」 |
| `STORE-API` | `schemaDraft` | `MODEL-API-SCHEMA-FIELD[]` | `[]` | 抽屉内字段编辑 |
| `STORE-API` | `fieldErrors` | {`field`,`message`}[] | `[]` | `#51`/`#53` 返回 400 |
| `STORE-API` | `conflict` | `MODEL-DIFF-ROW[]` \| null | `null` | 409 `VERSION_CONFLICT` |
| `STORE-API` | `versions` | `MODEL-VERSION[]` | `[]` | `#54` 返回 |
| `STORE-API` | `affectedSpecs` | string[] | `[]` | `#52` 返回的影响范围（**拉取最新状态而非本地推断**） |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 接口清单 | `API-PLAT-050`（`#50`，分页） | 首屏 / 筛选 / 翻页 | `PARAM-PROJ-ID` + `PARAM-LIST` + `status` | 写 `items`；按 `q`/`status` 判 `empty`/`no_match` | 「接口清单没加载出来。」+「重试」；403 → 统一无权限态 |
| 接口详情 | `API-PLAT-051`（`#51`） | 打开字段抽屉 | `PARAM-API-DEF-ID` | 写 `schemaDraft`（含 `req_schema`/`resp_schema`） | 「这个内容已经不在了。」+「返回上一级」 |
| 删除接口 | `API-PLAT-052`（`#52`，⬛） | 二次确认后 | `PARAM-API-DEF-ID` | 写 `affectedSpecs`（引用方 Spec 标「需复核」） | `FORBIDDEN` → 统一无权限态；失败保留行 + Toast |
| 字段表保存 | `API-PLAT-053`（`#53`，8 项类型） | 点「保存」 | `PARAM-API-DEF-ID` + `PARAM-API-SCHEMA-DRAFT` + `If-Match`（**已落 `#53`**） | 写回 `schemaDraft`；Toast「接口已保存（未纳入版本）」 | 400 → 「字段名不能为空，且只能是字母、数字、下划线。」+ **保留输入**；409 → 冲突组件 + diff |
| 版本列表 | `API-PLAT-054`（`#54`） | 版本区渲染 | `PARAM-PROJ-ID` + `PARAM-LIST` | 写 `versions`（`current` 唯一，**「当前」文字标记**） | 空 →「还没有版本记录。」 |
| 打版本 | `API-PLAT-055`（`#55`） | 点「生成新版本」 | `PARAM-PROJ-ID` + `PARAM-IDEM-KEY` | 写 `versions`；旧版置 `superseded`；Toast「已生成版本 v{n}。」 | `IDEMPOTENT_REPLAY` → 采用首次结果 |
| 版本 diff | `API-PLAT-056`（`#56`） | 点「查看变更」 | `PARAM-VERSION-ID` | 写 `MODEL-DIFF-ROW[]`（**变更用文字标识**） | 无差异 →「这个版本与上一版没有差异。」 |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 首屏 / 筛选 / 翻页 | 「正在加载接口…」+ 骨架行 ×8（静态，**无 shimmer**）；>3s 追加进度说明 | 请求返回即退出；超时 → 错误态 +「重试」 |
| 空数据 | `total = 0` **且无筛选** | 「还没有接口定义。」+「新建接口」（`EL-API-041`） | 点「新建接口」开抽屉；**与「被筛掉」必须是两个不同视图** |
| 错误 | 接口失败 | 「接口清单没加载出来。」+「重试」 | 重试保留筛选条件与已输入；保存失败保留草稿 |
| 无权限 | 403（`#50`~`#53`/`#56`） | 「你没有权限访问这个项目。」 | 返回来源页；**不透露存在性**；**导出/查看同样做逐对象鉴权** |
| 离线 | 网络中断 | 顶栏「连接已断开，正在重连…」+ 表格保留上次结果并置灰；「保存」「删除」「生成新版本」**禁用 + 原因** | 恢复后重取 `#50`；**抽屉草稿不丢**（本地保留） |

**跳转与深链接**：入口 = `RT-WORK-001` 阶段导航「接口」；参数 = 路径 `project_id`（+ 实现可加 `?drawer=<api_id>`）；
出口 = `RT-VER-001`（版本区 diff）。**返回栈**：抽屉开合**用 `replace`，不新增历史记录**。

**待澄清**：`[拆解缺口-Q13]`（**已闭合** 2026-10-21：`#53` 已补 `If-Match`）。

### 5.11 能力配置页（`RT-CAP-001` / `UI-CAP-001`）★ 含 P0 合规开关

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-CAP` | `state` | enum{`idle`,`loading`,`loaded`,`empty`,`saving`,`partial`,`error`,`forbidden`} | `idle` | `#58` 返回 / 保存 / 生成 |
| `STORE-CAP` | `items` | `MODEL-CAPABILITY.items[]`（**固定 7 行**） | `[7 行，`enabled=false`]` | `#58` GET/PUT |
| `STORE-CAP` | `switches` | map<`capability`,bool> | 全 `false`（**默认全关**） | `EL-CAP-007` 切换（**需点「保存并生成」才生效**） |
| `STORE-CAP` | `overall` | enum{`succeeded`,`partial`,`failed`} \| null | `null` | `#58` 响应 |
| `STORE-CAP` | `failed` | {`capability`,`error_code`}[] | `[]` | `#58` 响应（部分失败） |
| `STORE-CAP` | `conflicts` | {`library`,`version_a`,`version_b`}[]★ | `[]` | `#58` 响应（字段级补口（已转基线）） |
| `STORE-GLOBAL/SESSION` | `aiEgress` | `MODEL-AI-EGRESS` \| null | `null` | `#68`★ GET/PUT；**全局会话态**（`REQ-AUTH-004`） |
| `STORE-CAP` | `confirmTarget` | string \| null | `null` | 关闭已生成过的能力时（`EL-CAP-013`） |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 能力读写 | `API-PLAT-058`（`#58`） | 进入 / 点「保存并生成」/ 逐项重试 | `PARAM-PROJ-ID` + `PARAM-CAP-SWITCH` + `PARAM-IDEM-KEY` | 写 `items`/`overall`/`failed`/`conflicts`★；**保存即生成**；生成前**服务端自动备份** → 前端提示「已自动备份」 | 「配置没保存成功。」+「重试」；`partial` → **顶部标黄**「{n} 项生成失败：{列表}」+ 逐项「重试」，**整体不显示为成功** |
| 生成进度 | `API-PLAT-045` / `API-PLAT-044` | 保存后立即订阅 | `PARAM-TASK-ID` | 写 `code_status`（4 态可辨识） | 5min → 可重试失败态 |
| 外发开关读 | `API-PLAT-068`（`#68`，GET） | 页面进入 | 无（用户级资源） | 写 `aiEgress`（`egress_enabled`/`policy_text`/`disabled_reason`/`consent_acknowledged_at`） | **开关正常渲染**；读失败 → 开关置灰 +「外发设置没加载出来。」+「重试」 |
| 外发开关写 | **★`API-PLAT-068`**（`#68`，PUT） | 切换开关 | `{egress_enabled, consent_acknowledged?}` + `PARAM-IDEM-KEY` | 更新全局会话态；关闭后 Toast「已关闭「PRD 与代码外发第三方大模型」。」 | **不得静默降级**；**不撤销已完成的确认记录**（两者都需满足才能生成） |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 保存 / 生成进行中 | 「正在保存配置…」+ 按钮转圈；生成中「正在生成接入代码…」 | 超时 → 可重试失败态；保存中重复点击**不产生第二次副作用**（幂等键） |
| 空数据 | 从未保存过（无 `CapabilityConfig` 记录） | 「还没有配置任何能力。」+「全部关掉也是可以的，想接入哪项再打开。」（**全关是合法状态，不是错误**） | 打开任一项 +「保存并生成」即退出空态 |
| 错误 | 保存接口失败 / 部分失败 | 「配置没保存成功。」+「重试」；部分失败 → 顶部标黄「{n} 项生成失败：{列表}」+ 逐项「重试」（**整体不显示为成功**） | 逐项重试只重试该项；失败项清单保留 |
| 无权限 | 403（`#58`） | 「你没有权限访问这个项目。」 | 返回来源页；**不透露存在性**；**接口不出参、不接收、日志不记录任何真实 key**（`REQ-CAP-004`） |
| 离线 | 网络中断 | 顶栏「连接已断开，正在重连…」+ 7 行开关**可切换但不可提交**（「保存并生成」禁用 + 原因） | 恢复后本地开关值**保留**，可继续提交；**不做乐观写入** |

**跳转与深链接**：入口 = `RT-WORK-001` 阶段导航「能力」；参数 = 路径 `project_id`；出口 = 返回工作台（或 `RT-VER-001`）。
**返回栈**：`EL-CAP-021`「去开启」跳本页开关处并高亮（**同页锚点，不新增历史记录**）。

**待澄清**：`[缺口-API-05]`/`[缺口-API-06]`（**已闭合** 2026-10-21：`#58` 增 `conflicts[]`/`alignment_table[]`、`#68` 转基线）、`[拆解缺口-Q13]`（**已闭合** 2026-10-21：`#58`/`#53`/`#39`/`#40` 已标 `If-Match`）、`[冲突-UI-05]`（`REQ-CAP-005` 的 UI 落点争议）。

### 5.12 Spec 产出页（`RT-SPEC-001` / `UI-SPEC-001`）

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-SPEC` | `state` | enum{`idle`,`loading`,`loaded`,`empty`,`partial`,`stale`,`error`} | `idle` | `#31` 返回 |
| `STORE-SPEC` | `docs` | `MODEL-SPEC-DOC[]` | `[]` | `#31`；**上游变更后必须重新拉取，不能只靠本地缓存**（`REQ-SPEC-002`） |
| `STORE-SPEC` | `activeRole` | enum{`ui`,`api`,`app`,`track`,`test`} | `ui` | 点 tab（**顺序即生成顺序**：UI→接口→App→埋点→测试） |
| `STORE-SPEC` | `contentMd` | string | `''` | `#32` 返回；**失败时为空** |
| `STORE-SPEC` | `genResult` | `MODEL-SPEC-GEN-RESULT` \| null | `null` | `#30` 返回（`succeeded[]`/`failed[]`/`overall`） |
| `STORE-SPEC` | `proofread` | `MODEL-PROOFREAD-ITEM[]` | `[]` | `#34` 返回 |
| `STORE-SPEC` | `traceRows` | `MODEL-TRACE-ROW[]` | `[]` | `#67`★ 返回（抽屉打开时） |
| `STORE-SPEC` | `exportState` | enum{`idle`,`exporting`,`failed`} | `idle` | `#33` 请求 |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 五份列表 | `API-PLAT-031`（`#31`） | 进入 / 生成完成 / 上游变更后 | `PARAM-PROJ-ID` + `PARAM-LIST` | 写 `docs`（`role`/`status`/`stale`/`error_code`） | 「Spec 列表没加载出来。」+「重试」；403 → 统一无权限态 |
| 单份正文 | `API-PLAT-032`（`#32`） | 切 tab | `PARAM-SPEC-ID` | 写 `contentMd` | 空 →「这份 Spec 还没生成内容。」 |
| 生成 5 份 | `API-PLAT-030`（`#30`，⚡） | 点「开始生成」/「重新生成」/ 单份重试 | `PARAM-PROJ-ID`（+ 可选 `role`）+ `PARAM-IDEM-KEY` | 写 `genResult`；**单份失败不阻断其余** | `overall` **绝不置 `succeeded`**（部分成功 → `partial`）；`UPSTREAM_TIMEOUT`/`UPSTREAM_UNAVAILABLE` → 可重试失败态 |
| 导出 `.md` | `API-PLAT-033`（`#33`，需鉴权） | 点「导出 .md」 | `PARAM-SPEC-ID` | 触发下载 + Toast「已导出 {role}-spec.md」 | `FORBIDDEN` → 统一 403 文案（**不泄露存在性**）；失败 → Toast「导出失败了。」+「重试」 |
| 角色校对 | `API-PLAT-034`（`#34`） | 进入 / 点校对 | `PARAM-PROJ-ID` + `PARAM-SPEC-ID` + `PARAM-IDEM-KEY` | 写 `proofread`（`content` + `can_loopback`） | 空 →「校对完成，没有补充要求。」；超时 → 可重试失败态 |
| 追溯矩阵 | `API-PLAT-067`（`#67`，已转基线） | 打开 `?drawer=trace` | `PARAM-PROJ-ID` + `PARAM-LIST` | 写 `traceRows`；跳转**高亮** | 入口可用；失败 →「追溯矩阵没加载出来。」+「重试」 |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | `SpecDoc.status = generating` | 「正在生成 {角色} Spec…」+ tab 文字右侧 12px 转圈；>3s 追加进度说明 | 单份 5min 超时 → 失败可重试（**不阻断其余四份**） |
| 空数据 | 无 `SpecDoc` | 「还没有生成 Spec。」+「开始生成」 | 点「开始生成」调 `#30`；生成顺序**串行**，界面体现「当前生成到哪个角色」 |
| 错误 | 单份 `failed` / 超时 | 「这份 Spec 没生成出来。」+「原因：{…}。」+「重试这一份」 | 单份重试；**一份失败不阻断其余**；部分成功时**顶部标黄**「3 份已生成，2 份失败。」 |
| 无权限 | 403（`#31`/`#32`/`#33`） | 「你没有权限访问这个项目。」（导出同样适用，**不泄露存在性**） | 返回来源页；**导出内容不含密钥与内部凭据** |
| 离线 | 网络中断 | 顶栏「连接已断开，正在重连…」+ 已渲染的 Markdown 保留；「导出」「重新生成」**禁用 + 原因** | 恢复后**重新拉取 `#31` 状态**（不能只靠本地缓存）；生成中任务按 `task_id` 续查 |

**跳转与深链接**：入口 = `RT-WORK-001` 阶段导航「Spec」/ 拆解完成后；参数 = 路径 `project_id` + `?tab=` + `?drawer=trace`；
出口 = `RT-VER-001`（「版本」）、`RT-WORK-001`（「回流对话补充」，**预填上下文**）、`RT-SPLIT-001`（矩阵行跳转并高亮）。
**返回栈**：`?tab=`/`?drawer=` 变更**用 `replace`**，不污染历史；从 `EL-SPEC-020` 跳到工作台后，**返回回到本页同一 tab**。

**待澄清**：`[拆解缺口-Q12]`（**已闭合** 2026-10-21：统一为 UI → 接口 → App → 埋点 → 测试）、`[缺口-API-04]`（**已闭合** 2026-10-21：`#67` 已转基线）。

### 5.13 版本归档页（`RT-VER-001` / `UI-VER-001`）

> ⚠️ **负向约束**：本页及全站**不得出现「平台编译 / 打包 / 构建中」的按钮、文案或进度条**（`REQ-GEN-009`，项目约束 1/2）。
> 交付只到「下载工程源码」（源码 + `gradle wrapper` + 依赖版本锁定清单，**不含构建产物**）。

**状态管理**

| 状态模块 | 字段 | 类型 | 初始值 | 更新时机 |
|---|---|---|---|---|
| `STORE-VER` | `state` | enum{`idle`,`loading`,`loaded`,`empty`,`error`,`forbidden`} | `idle` | `#54` 返回 |
| `STORE-VER` | `versions` | `MODEL-VERSION[]` | `[]` | `#54`（`seq` 倒序，`current` **唯一**） |
| `STORE-VER` | `selectedVersionId` | string \| null | `null` | 路由 `?version=` / 点时间线节点 |
| `STORE-VER` | `diff` | `MODEL-DIFF-ROW[]` | `[]` | `#56` 返回（接口**字段级**、Spec **文档级**） |
| `STORE-VER` | `rollbackState` | enum{`idle`,`confirming`,`running`,`succeeded`,`failed`} | `idle` | 二次确认 / `#57` |
| `STORE-VER` | `writeLock` | bool | `false` | **回滚进行中锁住整个项目写入口**（禁止并发写，`REQ-DELIVER-003`） |
| `STORE-VER` | `deliverables` | `MODEL-DELIVERABLE` \| null | `null` | `#60` 返回 |
| `STORE-VER` | `l2Reported` | bool | `false` | `#46`/`#44` 的 `l2_result.reported` |

**接口调用**

| 触发动作 | API-ID | 时机 | 参数来源 | 成功处理 | 失败处理 |
|---|---|---|---|---|---|
| 版本列表 | `API-PLAT-054`（`#54`） | 首次进入 / 打版本后 | `PARAM-PROJ-ID` + `PARAM-LIST` | 写 `versions`；**「当前」用文字标记** | 「版本历史没加载出来。」+「重试」；时间 `null` →「时间未知」；操作人缺省 →「未命名用户」 |
| 打版本 | `API-PLAT-055`（`#55`） | 点「生成第一个版本」等 | `PARAM-PROJ-ID` + `PARAM-IDEM-KEY` | 写 `versions`；旧版 `superseded` | `IDEMPOTENT_REPLAY` → 采用首次结果 |
| 版本 diff | `API-PLAT-056`（`#56`） | 选中版本 / 点「查看变更」 | `PARAM-VERSION-ID` | 写 `diff`（**变更用文字标识**「新增/删除/修改」） | 无差异 →「这个版本与上一版没有差异。」 |
| 整包回滚 | `API-PLAT-057`（`#57`，⬛ 最高风险） | 二次确认「确认回滚」后 | `PARAM-VERSION-ID` + `PARAM-IDEM-KEY` | 目标版本置 `current`；`writeLock = false`；「已回滚到 {v_n}。」+「查看当前版本」 | 任一步骤失败 → 「回滚没完成，当前版本未变更。」+「重试」（**整体回退 UI 状态**，`REQ-NF-007`）；409 → 统一冲突组件 |
| 交付产物 | `API-PLAT-060`（`#60`）/ `API-PLAT-061`（`#61`） | 进入 / 点「下载工程源码」/「导出 Spec 包」 | `PARAM-PROJ-ID` + `PARAM-VERSION-ID`（+ `PARAM-IDEM-KEY`） | 写 `deliverables`；触发下载 + Toast「已开始下载工程源码。」/「Spec 包已导出。」 | 未生成 → 按钮置灰 +「还没有生成过工程源码。」；`FORBIDDEN` → 统一 403 文案；失败 → 可重试；**不含密钥与内部凭据** |
| L2 回传标记 | `API-PLAT-046`（`#46`）/ `API-PLAT-044` | 回传到达 | `PARAM-TASK-ID` | 写 `l2Reported` →「未验证构建」灰标 + 悬浮说明 | **不阻断交付** |

**五种页面状态**

| 状态 | 触发条件 | 呈现（引用 UI 文案） | 重试/兜底 |
|---|---|---|---|
| 加载中 | 首次进入 / 回滚中 | 「正在加载版本历史…」+ 骨架行（静态）；回滚中「正在回滚…」（>30s 追加「还在回滚，已用 {n} 秒…」） | 回滚中**锁住整个项目写入口**；失败 → 整体回退 +「重试」 |
| 空数据 | 零版本 | 「还没有版本记录。」+「生成第一个版本」 | 点「生成第一个版本」调 `#55`；**不是错误态** |
| 错误 | 接口失败 / 回滚失败 | 「版本历史没加载出来。」+「重试」；回滚 → 「回滚没完成，当前版本未变更。」+「重试」 | 点「重试」重发 `#54`；**回滚失败必须整体回退 UI 状态**（不得部分成功） |
| 无权限 | 403（`#54`~`#57`/`#60`/`#61`） | 「你没有权限访问这个项目。」 | 返回来源页；**下载/导出为受鉴权动作**，**不泄露存在性** |
| 离线 | 网络中断 | 顶栏「连接已断开，正在重连…」+ 时间线保留并置灰；「回滚」「下载」「导出」**禁用 + 原因** | 恢复后重取 `#54`；**回滚不自动重试**（最高风险操作须用户重新确认） |

**跳转与深链接**：入口 = `RT-WORK-001` 阶段导航「交付」/ `RT-SPEC-001` →「版本」/ `RT-API-001`/`RT-CAP-001` → 版本区；
参数 = 路径 `project_id` + `?version=<version_id>`；出口 = 无（终点页）。**返回栈**：本页为终点页，
`?version=` 变更用 `replace`；从本页返回**回到来源页并保留其状态**。

**待澄清**：`[缺口-API-07]`（**已闭合** 2026-10-21：`E10` 三字段 + `#54` 出参已补）、`[拆解缺口-Q9]`（接口总数 62 vs 63，仅计数口径，不影响本页）。

---

## 6 网络层

### 6.1 请求封装与拦截器

| 项 | 约定 |
|---|---|
| Base URL | `API-PLAT-*` 统一走 `/api/v1/`（`接口-Spec §5.0`，`REQ-NF-008`） |
| 鉴权注入 | `Authorization: Bearer <token>`（**登录后由 `#64`★ 签发**）；**除 `#63`/`#64` 两个公开端点外全部注入** |
| 统一响应包解包 | `{ "code", "message", "data", "request_id" }` → 成功取 `data`；失败**抛结构化错误**（`code`/`message`/`request_id`/`data.field`），**不把 `message` 直接当界面文案**（界面文案以 §6.3 映射表为准） |
| 幂等头 | 提交类（`#2`/`#10`/`#11`/`#12`/`#16`/`#18`… 见 `§5.0.2`）自动带 `Idempotency-Key`；**同一次用户意图 3s 内复用同一 key**（`REQ-NF-006`） |
| 乐观锁 | 可编辑资源（`#4`/`#9`/`#24`/`#37`/`#39`/`#40`/`#51`/`#53`/`#58`）带 `If-Match: <version>`；不匹配 → 409 `VERSION_CONFLICT`（**画布/能力/接口三处共用同一冲突组件**，`REQ-NF-003`） |
| 请求标识 | 可自带 `X-Request-Id`，服务端回显；**不得含业务内容**（`REQ-AUTH-005`） |
| 重试策略 | **只读 GET 且幂等**：网络类失败（超时/断连）按 **指数退避 + 抖动** 自动重试 **最多 2 次**（与 `接口-Spec §2.3` 的「大模型/飞书外部调用 60s、退避 2 次」口径一致）；**提交类一律不自动重试**，由用户点「重试」或由幂等键保证安全 |
| 超时 | 普通请求 **30s**；长任务由 `task_id` 承载（**统一 5min 上限**）；外部依赖（大模型/飞书）60s；SSE 心跳 15s |
| 取消 | 页面离开时**取消在途只读请求**；**提交类请求不取消**（避免歧义），由幂等键兜底 |
| 并发 | **同一时刻一条在途的对话发送**（后发排队）；**同项目并发生成 > 1 由服务端 429 拦截**（前端不重复提交） |
| 冷启动缓存 | 只读列表首屏可先用本地缓存渲染（§7），**随后必须被服务端结果覆盖**；**不得**用缓存掩盖失败 |

### 6.2 长任务与 SSE（`REQ-GEN-007`）

| 项 | 约定 |
|---|---|
| 统一模型 | 全部长任务（`parse`/`review`/`split`/`spec_gen`/`code_gen`/`verify_l1`/`verify_l2`）共用 `API-PLAT-044` 状态查询 + `API-PLAT-045` SSE 推送，**不各造一套** |
| 单一连接 | **单条 SSE 连接**承载全部任务与对话流（`chat.delta`） |
| 心跳 | `ping` 每 **15s**；**15s ≪ L1 90s 指标窗口**，用于区分「慢」与「断」 |
| 断线重连 | `EventSource` 自动重连；重连成功后**先 `GET /tasks/{id}` 按 `seq` 取最新**，**只应用序号最新的结果** |
| 降级 | 连续失败 → 指数退避；**自动降级为每 2s 轮询 `API-PLAT-044`**，**界面无差别**（同一状态机，两套数据源） |
| 旧结果后到 | 服务端拒绝应用旧序号 → 409 `TASK_STALE`；前端**静默丢弃** + 提示「已为你使用最新一次生成的结果。」 |
| 序号 | 本地保存**最新已应用 `seq`**；任何结果**只在 `seq > 已应用 seq` 时应用**（`REQ-GEN-006`） |
| ★待澄清 | **SSE 鉴权**：`EventSource` 不能自定义头 → 需 `Cookie` 会话或 `query` 令牌方案，**PRD 未定义** → `[待澄清-SSE-AUTH]`（`接口-Spec §5.5.24` 同源）。本 Spec **不自行拍板**，但**本地草稿与 `seq` 台账不得写入依赖该方案的密钥** |

### 6.3 错误码统一处理（13 个 + 1 个非错误标记）

> **界面文案以 `UI-Spec §3.6` 为准**（UI 是文案权威）；服务端 `message` **仅用于开发排查与字段级提示**（**例外：登录页 `UI-AUTH-001` 的 400 分支直接展示服务端 `message`**，见 `UI-Spec §3.6` 与 §5.1），
> **不得直接渲染为界面文案**（避免两套事实来源）。`{...}` 为可填值。

| 接口错误码 | HTTP | 触发场景 | App 提示（与 UI 文案一致） | 客户端行为 |
|---|---|---|---|---|
| `INVALID_ARGUMENT` | 400 | 参数非法（项目名空白、属性超范围、`page_size > 100`、事件 > 3 条、空消息、`choice = unset` 却提交生成） | **字段级提示**（文案见各页，如「项目名不能为空，长度 1~50。」「宽只能是 1~2000dp，或选「自适应 / 撑满」。」） | **保留已输入的全部内容**；滚动到首个错误字段 |
| `UNAUTHENTICATED` | 401 | 未登录 / 会话过期 | 「登录已过期，已为你保留未提交的内容。」+「重新登录」 | 跳 `RT-AUTH-001`，**恢复草稿与目标页**；**绝不静默丢弃** |
| `FORBIDDEN` | 403 | 越权（含列表 / 搜索 / 导出） | 「你没有权限访问这个项目。」 | 统一无权限态；**不泄露对象是否存在**（与 `NOT_FOUND` 文案**不得有可区分差异**） |
| `NOT_FOUND` | 404 | 对象不存在 / 已物理清除 | 「这个内容已经不在了。」+「返回上一级」 | 返回上一级 + **刷新列表**；**文案不得比 403 更具体** |
| `VERSION_CONFLICT` | 409 | 乐观锁冲突（`If-Match` 不匹配） | 「该内容已被他人修改。」+ diff + 「以我的为准」/「放弃我的改动」 | **统一冲突组件**（画布 / 接口管理页 / 能力配置页共用）；**不静默覆盖** |
| `IDEMPOTENT_REPLAY` | 409 | 同 `Idempotency-Key` 3s 内重放 | **无提示** | **直接采用返回的首次结果**（不再产生副作用），**埋点不重复计数** |
| `PAYLOAD_TOO_LARGE` | 413 | 上传超 20MB | 「文件超过 20MB（当前 {n}MB）。请压缩后重试。」 | 保留表单；**不写入记录** |
| `FORMAT_UNSUPPORTED` | 422 | 格式不支持（`.pdf`/`.txt` 等） | 「暂不支持该格式。请上传 .docx / .md 或飞书云文档链接。」 | 同上 |
| `UPSTREAM_TIMEOUT` | 504 | 大模型 / 飞书 60s 超时（退避 2 次仍失败） | 「上游服务响应超时（{n}s）。」+「重试」 | **可重试失败态**；**绝不渲染成成功** |
| `UPSTREAM_UNAVAILABLE` | 503 | 上游不可用；**或外发开关关闭**（★ 见 `#10`/`#12`/`#43`/`#58` 的不可用分支） | 「服务暂时不可用（{code}）。」+「重试」；外发关闭 → 「你已关闭「PRD 与代码外发第三方大模型」，…不可用。可在「能力配置」里重新打开。」 | 可重试；**不得静默降级、不得返回 200 假装在跑**（`REQ-AUTH-004`③）；退避由服务端执行，**前端只展示进度与重试入口** |
| `RATE_LIMITED` | 429 | 同项目并发生成 > 1 / 限流 | 「请求太频繁，{n} 秒后重试。」+ 倒计时 | 倒计时期间**禁用提交按钮**；**不重复提交** |
| `TASK_STALE` | 409 | 提交了旧序号结果 | **静默丢弃** + 「已为你使用最新一次生成的结果。」 | **不弹错误**；不覆盖更新的结果 |
| `INTERNAL` | 500 | 未预期错误 | 「出了点问题。」+「请把 request_id {id} 提供给我们。」+「重试」 | 展示 `request_id`；**上报体不含业务内容** |
| `PARSE_PARTIAL`（**非错误**） | **200** | `parse_status = partial` | 「解析完成，但有 {n} 处没取到：」+ 逐条清单 | **顶部标黄，不得显示为完全成功**；`partial` 是独立终态（`接口-Spec §5.2` 口径登记 `[待澄清-错误码口径]`） |

**网络层之外的兜底顺序**（`App-需求包 §3`）：401 → 跳登录并恢复草稿；403 → 统一无权限态；404 → 返回上一级 + 刷新列表；
409 `VERSION_CONFLICT` → 统一冲突组件；409 `TASK_STALE` → 静默丢弃；413/422 → 上传页字段级提示；
504/503 → 上游不可用可重试态；429 → 倒计时重试；500 → 「出了点问题」+ `request_id`。

---

## 7 本地存储与缓存

> **key 命名**：`ad.<版本>.v1.<scope>.<name>`，其中 `<scope>` ∈ {`session`（会话级）/ `project.<project_id>`（项目级）/ `user.<open_id>`（用户级）/ **`device`（设备级：本浏览器/设备的界面偏好，不随账号走、登出不清）**〔2026-10-26 增〕}。
> **总原则**：**以 `project_id` 为键做项目隔离**（`REQ-AUTH-006`）；**切换项目时清空上一个项目的画布与草稿状态**（避免串台）；
> **绝不缓存任何密钥类数据**（`REQ-CAP-004`：界面不渲染 key 输入框，前端也**不得缓存/回传密钥**）；
> **PRD 正文与生成的业务代码不得进入 URL、埋点、控制台日志或错误上报**（`REQ-AUTH-005`）。

| 存储项 | key | 类型 | 过期策略 | 是否加密 | 登出清理 |
|---|---|---|---|---|---|
| 会话令牌 | 仅**内存** `STORE-GLOBAL/SESSION.token`（不落 `localStorage`，降 XSS 面） | string | 会话结束 / 401 / 登出 | 内存态，不落盘 | ✅ 清空 |
| ★ **SSE 会话凭据** | `ad.v1.session.sseTicket`（**若** PM 采纳 Cookie/query 方案才启用） | string | 与令牌同生命周期 | **待 `[待澄清-SSE-AUTH]` 决定**；**不得写 `localStorage`** | ✅ 清空 |
| 当前用户信息 | `ad.v1.user.<open_id>.profile` | `MODEL-USER` | 24h / 每次进入项目刷新 | 否（仅 `nickname`/`avatar_url`/`role`） | ✅ 清空 |
| 项目列表缓存 | `ad.v1.user.<open_id>.projectList` | `MODEL-PROJECT-LIST`（首屏用） | **5min**（`[来源: 推断，待确认]` → `[待澄清-A05]`） | 否 | ✅ 清空 |
| 项目统计（状态条） | `ad.v1.project.<project_id>.stats` | `MODEL-PROJECT-STATS` | 30s / SSE `task` 事件即刷新 | 否 | ✅ 清空 |
| ★ **画布草稿** | `ad.v1.project.<project_id>.page.<page_id>.draft` | `MODEL-PAGE-DRAFT`（元素树 + 样式 + 事件，**不含 PRD 正文**） | **不过期**，直到成功提交或用户显式放弃；服务端 `API-PLAT-042` 双保险 | 否（`[待澄清-A05]`：是否加密待定） | ✅ 清空 |
| 对话历史缓存 | `ad.v1.project.<project_id>.chat` | `MODEL-CHAT-MESSAGE[]`（**只缓存最近 N 条供秒开**，`N` 待定 → `[待澄清-A05]`） | 10min | 否；**含消息正文** → 遵守 `REQ-AUTH-005`（不入 URL/上报/日志） | ✅ 清空 |
| 待澄清作答草稿 | `ad.v1.project.<project_id>.review.<review_id>.answers` | map<`question_code`,`answer`> | 提交成功 / 复审完成后清 | 否 | ✅ 清空 |
| 上传任务续查句柄 | `ad.v1.project.<project_id>.upload.taskId` | {`task_id`,`revision_id`} | 任务终态后清；**离开页面重进按 `task_id` 续查** | 否 | ✅ 清空 |
| 知识库编辑草稿 | `ad.v1.project.<project_id>.kb.<kb_doc_id>.draft` | {`content_md`,`version`} | 保存成功 / 显式放弃后清 | 否 | ✅ 清空 |
| 接口字段编辑草稿 | `ad.v1.project.<project_id>.api.<api_id>.schemaDraft` | `MODEL-API-SCHEMA-FIELD[]` | 保存成功 / 显式取消后清 | 否 | ✅ 清空 |
| 门禁标准编辑草稿 | `ad.v1.project.<project_id>.gateStandard.draft` | {`items[]`,`version`} | 保存成功 / 显式放弃后清（**未保存改动须可恢复**，`REQ-REVIEW-005`） | 否 | ✅ 清空 |
| 能力开关暂存值 | `ad.v1.project.<project_id>.cap.switches` | map<`capability`,bool> | 保存成功后清（与服务端一致） | 否 | ✅ 清空 |
| 最新已应用任务序号 | `ad.v1.project.<project_id>.task.appliedSeq` | int | 任务终态后保留（下一个任务仍用它做比较基准） | 否 | ✅ 清空 |
| 幂等键台账 | `ad.v1.session.idemKeys`（**仅内存 + 短 TTL**） | map<意图指纹, {`key`, `ts`}> | **3s TTL**（同一次意图 3s 内复用同一 key） | 内存态 | ✅ 清空 |
| ★ **自动审核开关** | `ad.v1.device.reviewAuto`（`EL-REVIEW-054`，**设备级**） | bool（`"1"`/`"0"`） | 不过期（由用户显式切换） | 否 | ❌ **不清**（设备偏好；首次读取兼容首版键 `ad.review.auto`） |
| ★ **外发开关与告知确认状态** | `ad.v1.user.<open_id>.aiEgress`（**全局会话态**） | `MODEL-AI-EGRESS` | 会话内有效；**每次进入生成入口前以 `#68`★ 为准复核** | 否 | ✅ 清空 |
| 埋点上报队列 | `ad.v1.session.trackQueue` | `MODEL-TRACK-EVENT[]` | **批量上报成功即清**；失败静默重试（不阻塞业务、不阻塞离开页面）；**上报体不含 PRD 正文与生成代码** | 否 | ✅ 清空 |
| 台账 / 列表滚动位置等 UI 偏好 | `ad.v1.session.uiPrefs` | json | 7d | 否 | ✅ 清空 |

**登出清理范围（`REQ-AUTH-006` + `REQ-AUTH-008`）**：清 `session` 与 `user.<open_id>` 全部键；
**项目级键（`project.<project_id>.*`）在登出时一并清除**，避免多账号共用设备时串台；
**切换项目（非登出）时**：只清「上一个项目的画布草稿、对话缓存、编辑草稿、`appliedSeq`」，
**不清**项目列表与用户信息；清理动作**必须同步重置对应 `STORE-*`**（避免内存态残留）。

**时间与三态口径（`REQ-NF-005`）**：一律 **UTC 存储 → 本地时区展示**；`null` = 未知、`0` = 零、`n/a` = 不适用；
**禁止用 `0` 或 `1970-01-01` 表示未知时间**；相对时间由**前端**计算（「3 分钟前」「最后更新于 X」）。

---

## 8 权限与系统能力

> **平台自身 App 是浏览器应用**：`UI-Spec` 与 `页面规格` 中**未定义任何相机 / 相册 / 定位 / 通知的使用场景**。
> 因此下表**逐项表态**（N/A 也写理由），并**不发明未定义的能力**。

| 能力 | 申请时机 | 被拒兜底 | 对应 REQ-ID |
|---|---|---|---|
| **文件选择**（`EL-UPLOAD-005`） | 点 `EL-UPLOAD-003` 时按需触发系统文件选择器（`accept=.docx,.md`） | 用户取消 → **无提示、无副作用**（不算失败）；权限被浏览器策略拒绝 → 显示「无法打开文件选择器，请改用拖拽。」并保留拖拽入口 | `REQ-UPLOAD-001`、`REQ-UPLOAD-002` |
| **本地文件拖拽**（`EL-UPLOAD-003`、`EL-EDIT-004`） | 无需申请（浏览器原生能力） | 拖入非法类型/超限 → 对应错误条，**不进入列表**；**键盘替代路径必存**（`UI-Spec §3.7`：`Tab` 聚焦 → `Enter` 放置 → 方向键微调） | `REQ-NF-002`、`REQ-UIEDIT-001` |
| **剪贴板写入**（`EL-EDIT-010`/`EL-EDIT-020` 复制元素 id；`EL-API-015` 复制接口） | 点复制按钮时（`navigator.clipboard.writeText`） | 被拒（非安全上下文 / 用户拒绝）→ Toast「复制失败，请手动选中复制。」+ **同时把 id 呈现为可选中文本**（降级路径） | `REQ-UIEDIT-009` |
| **浏览器通知**（Notification） | **N/A**：PRD 与 UI Spec **均未定义**任何平台侧通知场景 | — | — （若后续要做「生成完成提醒」→ 需 PM 补需求） |
| **相机 / 麦克风** | **N/A**：平台自身界面**无拍照 / 录音场景**（画布内控件由用户拖拽产生，**平台不采集素材**） | — | `REQ-BASE-001`（本期只做安卓，界面不得出现无关入口） |
| **相册 / 媒体库** | **N/A**：同上；`EL-EDIT-004` 的「图片」控件**只声明控件类型**，不涉及平台侧读取用户相册 | — | 同上 |
| **定位 / 传感器** | **N/A**：`§F13` 控件白名单与本项目范围**均未涉及**（`D-X4` 明确排除图表/地图/Canvas/WebView 等；定位亦未列入） | — | `平台需求概要 §2` 范围外清单 |
| **后台任务 / 唤醒** | **N/A**：长任务由服务端承载，前端只做 SSE/轮询消费 | — | `REQ-GEN-007` |
| ★ **生成工程侧的系统能力** | **不由平台申请**：生成到安卓工程的能力接入（推送 / 性能采集 / 崩溃上报 / 日志上报 / 统计 SDK / 加固 / 隐私合规弹窗）通过 `API-PLAT-058` 的 **7 项开关**控制，**勾选即生成接入代码** | 见 **附节 A 第 6 条**；**平台界面不采集第三方 key**（`REQ-CAP-004`） | `REQ-CAP-001`~`004` |

**权限模型（两级，`REQ-AUTH-002`）**：

| 角色 | 权限范围 | 界面差异 |
|---|---|---|
| `requester`（需求方） | 自己项目的全部读写 | 与管理员**同一套界面**，仅**入口范围**不同（`REQ-AUTH-002`：**不做两套界面**） |
| `admin`（管理员） | 需求方全部权限 + 删除任意项目 + **维护门禁标准**（`#24` PUT） | 仅 `EL-REVIEW-049`（门禁标准抽屉入口）**多一个入口**；其余一致 |

**撤销生效（`REQ-AUTH-003`）**：权限撤销 ≤5min 生效；长停留页面（`RT-EDIT-001`/`RT-KB-001`/`RT-API-001`/`RT-CAP-001`）
**每 60s 轻量重校验**（或由任一写操作 403 兜底），**不得静默继续写**。周期值 `[来源: 推断，待确认]` → `[待澄清-A04]`。

---

## 9 异常与降级

### 9.1 网络异常与弱网

| 情形 | 判定 | 呈现 | 重试策略 | 降级方案 |
|---|---|---|---|---|
| **完全离线** | `navigator.onLine === false`（+ 请求层连续 network error） | 全局顶栏（`CMP-005` 样式，文案口径 `EL-WORK-024`）「连接已断开，正在重连…」 | 网络恢复（`online` 事件）→ **自动重取当前页主数据** | 只读数据**保留上一次成功结果并置灰**；写操作**禁用 + 原因**「网络断开，恢复后可继续。」；**本地草稿继续保存** |
| **弱网 / 高延迟** | 单请求 > 3s | 各页「正在…」文案 + **>3s 追加进度说明**（`REQ-NF-001`） | 只读请求退避重试 ≤2 次 | 不阻塞编辑；提交类**排队串行** |
| **请求超时** | 普通 30s / 外部依赖 60s / 长任务 5min | 对应页的可重试失败态（文案见各页） | 用户点「重试」；长任务超时 → `timeout`（**可重试**） | 保留已得的部分结果（如 `EL-REVIEW-041`） |
| **SSE 断开** | `ping` 15s 未到达 | 「连接已断开，正在重连…」 | `EventSource` 自动重连 + 指数退避 | **降级 2s 轮询 `API-PLAT-044`，界面无差别** |
| **上传中断** | XHR `onerror`/`onabort` | 「上传中断了。」+「重试」 | 用户点「重试」重传 | **不产生半成品记录**（`REQ-UPLOAD-002`） |

### 9.2 服务端错误码 → 界面文案

见 **§6.3**（13 个错误码 + `PARSE_PARTIAL` 非错误标记），**逐条给出 App 提示与客户端行为**。

### 9.3 崩溃与错误上报

| 项 | 约定 |
|---|---|
| 采集范围 | 前端未捕获异常（`window.onerror` / `unhandledrejection`）+ 关键流程失败（不含业务流程正常失败） |
| **脱敏（硬约束）** | 上报体**绝不含 PRD 正文、生成的业务代码、对话正文、任何密钥/令牌**（`REQ-AUTH-005`、`REQ-TRACK-003`）；`request_id` 可上报 |
| 上报通道 | **PRD 未定义前端错误上报通道** → `[待澄清-A06]`；**本 Spec 不自行指定**。在闭合前：仅做**本地控制台**与**平台自身埋点（`API-PLAT-062`）**可承载的最小事件 |
| 失败处理 | 上报失败**不影响任何业务流程**，**不在界面暴露上报错误**（`REQ-TRACK-003`） |
| 崩溃后恢复 | 重新进入时**必须能恢复未提交草稿**（§7 画布/作答/编辑草稿），并提示「已恢复上次未提交的改动。」 |

### 9.4 「不得混淆」的四组（逐条表态）

| 组 | 不得混淆 | 依据 |
|---|---|---|
| 1 | **取消（`canceled`）≠ 失败（`failed`）**：取消**不计重试、不入版本、不用错误态样式/文案** | `REQ-GEN-005` |
| 2 | **生成失败 ≠ 验证失败**：两个独立组件、两套文案、两个重试入口 | `REQ-GEN-008` |
| 3 | **部分成功（`partial`）≠ 成功**：上传页 / 能力配置 / Spec 生成三处**必须标黄**，**整体不得置为成功** | `REQ-UPLOAD-003`、`REQ-CAP-002`、`REQ-SPEC-001` |
| 4 | **空态 ≠ 无匹配 ≠ 错误**：三者三个视图；**空文档（`empty_document`）≠ 解析失败** | `REQ-PROJ-002`、`REQ-UPLOAD-004`、`REQ-NF-004` |

---

## 10 埋点埋码点（开发阶段落地）

> ✅ **已按 `platform/specs/埋点-Spec.md`（v0.1 定稿 + 附节 A 对照表）完成正式事件名回填**（`REQ-TRACK-001`）。
> 事件名一律采用 **`EVT_<模块>_<动作>` 全小写下划线**（早期大写草稿名已全部移除）。
> 完整 54 条事件字典见 `埋点-Spec §3`。本节**已补齐到全部 54 条**（2026-10-22）：
> **§10.1** = 核心 **9 节点漏斗 + 4 合规 + 12 旁路/任务/审核事件 + 2 本机落地事件**，共 **27 行**；
> **§10.4** = 其余 **27 行**（按 `埋点-Spec §3` 分节排列）。**§10.1 + §10.4 = 54 行，与事件字典逐条对应**。
>
> **两条埋点线必须分清**（`埋点-需求包 §0`）：本节 = **A 线（平台自身埋点，`API-PLAT-062` 上报）**；
> **B 线（被开发项目的埋点方案 `TrackPlan`）不在本节** —— 它由 `API-PLAT-059`（`#59`）承载展示（§4.2.7），
> 并由 **附节 A 第 3 条**约束「S7 写入用户安卓工程」的代码落点。
>
> **硬约束（逐条遵守）**：① 埋点**不通过事件面板上报**（事件面板只生成空回调存根，`action_type` 仅 `none`）；
> ② 埋点必须绑定 **`EL-<模块>-<三位>` 归一化 id**（禁止用别名/临时 id）；③ 上报体**不含 PRD 正文、生成代码、对话正文**；
> ④ 上报走 `API-PLAT-062` **批量**、**失败静默重试**、**不阻塞业务与离开页面**。

### 10.1 漏斗 9 节点 + 负向/合规事件的埋码点

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_proj_create_success` | `RT-PROJ-001` / `UI-PROJ-001` | `EL-PROJ-041`、`EL-PROJ-010` | `ProjectListStore.createProject()` 的 `onSuccess(resp)` 回调（**且列表已插入该项目之后**） | **创建接口成功且项目已出现在列表中之后**（**不是点击新建按钮时**；★漏斗节点 1） | `#2` 的 `data.project_id`、`stage`、`name_visible_chars`（**只报长度，不含项目名文本**）、`duration_ms` |
| `EVT_proj_create_click` | `RT-PROJ-001` | `EL-PROJ-005`、`EL-PROJ-023` | `EL-PROJ-005` / `EL-PROJ-023` 的 `onClick`（弹窗打开前） | 点击「新建项目」时（300ms 连点去重） | `entry`（`header` / `empty_state`；**区分「点击新建」与「创建成功」**） |
| `EVT_proj_create_blocked` | `RT-PROJ-001` | `EL-PROJ-041`、`EL-PROJ-039` | `#2` 的 400 分支回调（错误文案渲染之后） | 点击提交但**被校验拦截**（`INVALID_ARGUMENT`） | `code`、`data.field`（**不含用户输入内容**） |
| `EVT_upload_parse_terminal` | `RT-UPLOAD-001` / `UI-UPLOAD-001` | `EL-UPLOAD-018`~`021`、`EL-UPLOAD-026`、`EL-UPLOAD-027` | `ParseStore` 的 `onTaskTerminal(status)` 回调（SSE `task` 终态 / `#44` 轮询到终态，`#14` 写入后） | **解析任务进入终态时**；`succeeded` / `partial` / `failed` **三个取值分别上报**（★漏斗节点 2） | `#14` 的 `parse_status`、`empty_document`、`failed_parts_count`、`parts_ok_count`、`revision_id`、`duration_ms` |
| `EVT_upload_rejected` | `RT-UPLOAD-001` | `EL-UPLOAD-028`、`EL-UPLOAD-029`、`EL-UPLOAD-030`、`EL-UPLOAD-003` | `#10` 的 413/422 分支回调 / 前端预校验失败分支 | 文件被规格校验拒绝时 | `reject_reason`、前端 `File.size`（**不上报文件名**） |
| `EVT_review_verdict` | `RT-REVIEW-001` / `UI-REVIEW-001` | `EL-REVIEW-003`、`EL-REVIEW-005`、`EL-REVIEW-006` | `ReviewStore` 的 `onVerdict(report)` 回调（`#17` 首次拿到终态 `verdict` 时） | **评分卡 `verdict` 产生（`passed` / `blocked` / `superseded` / `malformed`）时**（★漏斗节点 3） | `#17` 的 `data.verdict`、`data.counts.blocking`、`data.revision_id`、`data.standard_version` |
| `EVT_review_submit` | `RT-REVIEW-001` | `EL-REVIEW-026`、`EL-REVIEW-050`、`EL-REVIEW-039` | `#16` 的 202 响应回调 | 点「提交复审」并成功入队时（**与「审核完成」是两个事件**） | `data.review_id`、`data.task_id`、`data.standard_version` |
| `EVT_review_writeback` | RT-REVIEW-001 | EL-REVIEW-031/061 | #23→GET8版本/hash/补充核验成功后 | 包括changed=false核验成功，不一致不发；当前immediate:true、dedupKey=reviewId | flat deleted_lines/modified_lines/added_lines、accepted_items_count、new_revision_id；不加正文/答案/hash参数 |
| `EVT_split_done` | `RT-SPLIT-001` / `UI-SPLIT-001` | `EL-SPLIT-008`~`010` | `SplitStore` 的 `onSuccess()` 回调（`#29` 五个角色包**落库后**） | 拆解任务成功、5 个角色包落库后（★漏斗节点 4） | `#29` 的 `items[].role` 与各自 `req_ids[].length`（REQ 总数、分角色条目数、`empty_role_count`）、任务耗时 |
| `EVT_spec_gen_done` | `RT-SPEC-001` / `UI-SPEC-001` | `EL-SPEC-013`、`EL-SPEC-003`~`007`、`EL-SPEC-014` | `SpecStore` 的 `onGenerateResponse(result)` 回调 | `#30` 返回（含 `overall`）之后（★漏斗节点 5） | `#30` 的 `data.succeeded[]`、`data.failed[].role`、`data.overall`、`duration_ms_by_role`（**`partial` 不得上报为成功**） |
| `EVT_edit_submit_success` | `RT-EDIT-001` / `UI-EDIT-001` | `EL-EDIT-037` | `EditorStore.submitChanges()` 的 `onAccepted(task_id, seq)` 回调（`#43` 202） | **生成任务创建成功、返回 `task_id` + `seq` 之后**（★漏斗节点 6；按 `埋点-Spec` 附节 A 第 11 行定名） | `#43` 的 `data.task_id`/`data.seq`；本地元素数、控件类型分布、`page_id` |
| `EVT_edit_drop_rejected` | `RT-EDIT-001` | `EL-EDIT-012`、`EL-EDIT-013`、`EL-EDIT-004` | 落点校验失败分支（前端拦截处）与 `#36` 的 400 回调 | 拖拽落点被拒收时（**独立事件：区分「拖了但没放成」**） | `reject_reason`（`outside_canvas` / `invalid_hierarchy` / `limit_exceeded` / `unsupported_widget`）；`widget_type` |
| `EVT_edit_event_config` | `RT-EDIT-001` | `EL-EDIT-032`、`EL-EDIT-033`、`EL-EDIT-034`、`EL-EDIT-035` | `#42` 草稿保存的成功回调〔2026-10-22 由 `#40` 改挂，见 `埋点-Spec §11 v0.1.4`〕 | 草稿保存成功、且本次含事件配置变更时 | **只报「配了哪类事件」**（`click`/`long_click`/`double_click`）；`action_type` **固定 `none`** |
| `EVT_gen_task_enqueued` | `RT-EDIT-001` / `RT-PREVIEW-001` | `EL-EDIT-037`、`EL-PREVIEW-009` | `TaskHub.onTaskEvent` 首次收到该 `task_id` 的 `queued` 事件时 | 生成任务入队时（**仅计一次，SSE 重连不重复计数**） | `data.task_id`、`data.seq` |
| `EVT_gen_task_terminal` | `RT-EDIT-001` / `RT-PREVIEW-001` | `EL-PREVIEW-009`、`EL-PREVIEW-011` | `TaskHub.onTaskEvent(terminal)` 回调（`succeeded` / `failed` / `timeout`） | 生成任务终态时（★漏斗节点 7） | `#44`/SSE 的 `data.status`、`data.progress`、`data.error_code`、`started_at`→`finished_at` 耗时（**L1 耗时计入指标；L2 仅记录**，`REQ-NF-001`） |
| `EVT_gen_task_canceled` | `RT-PREVIEW-001` / `UI-PREVIEW-001` | `EL-PREVIEW-015`、`EL-PREVIEW-016`、`EL-WORK-023` | `#44a` 的成功回调 | 用户点「停止生成」且任务置 `canceled` 时（**独立事件，不得与失败合并**） | `data.status = canceled` + 取消时的 `progress` |
| `EVT_preview_refreshed` | `RT-PREVIEW-001` / `UI-PREVIEW-001` | `EL-PREVIEW-002`、`EL-PREVIEW-003` | `PreviewStore.applyPreview(seq)` **替换内容之后** | **L1 `passed` 且预览内容已替换之后**（★漏斗节点 8） | `data.seq`（`#45`/`#44`）、L1 耗时（`#49`/`l1_result.duration_ms`） |
| `EVT_verify_failed` | `RT-PREVIEW-001` | `EL-PREVIEW-012`、`EL-PREVIEW-010` | `VerifyStore` 的失败回调（`#49` 终态） | 验证失败时（**与生成失败分开**） | `data.items[].attempt`、`data.error_code`、L1 逐规则结果（**只报失败规则名，不报代码内容**） |
| `EVT_l2_reported` | `RT-VER-001` / `RT-PREVIEW-001` | `EL-VER-028`、`EL-PREVIEW-014` | `TaskHub` 收到 `#46` 回传后的回调 | 本地构建结果回传时（**仅记录，不计平台指标**） | `data.l2_result.passed`、耗时（**L2 耗时不得混入 L1 指标**） |
| `EVT_deliver_done` | `RT-VER-001` / `UI-VER-001` | `EL-VER-025`、`EL-VER-027`、`EL-VER-026` | `DeliverStore.onDownloaded()` 回调 | 交付归档完成 / 导出成功后（★漏斗节点 9） | 版本号（`#54` 的 `data.items[].seq`）、导出类型（工程源码 / Spec 包） |
| `EVT_auth_forbidden` | `RT-VER-001`（及全局 403） | `EL-VER-025`、`EL-VER-027`、`EL-AUTH-014` | 全局响应拦截器 403 分支（含 `#60`/`#61` 导出被拒） | 导出或访问被拒（403）时（按 `埋点-Spec` 附节 A 第 21 行统一归入全局 403 事件，`resource=deliverable`） | `source_rt`、`source_api`、`resource=deliverable`（**不含对象名**） |
| `EVT_aiegress_notice_shown` ★合规 | `RT-UPLOAD-001` / `RT-EDIT-001` / `RT-WORK-001` | `EL-GLOBAL-004`、`EL-GLOBAL-005`、`EL-GLOBAL-006` | 弹窗容器挂载时（`onShow`） | 首次上传前 / 首次生成前弹窗展示时 | `trigger_scene`（`upload_first` / `generate_first` / `workbench_generate`） |
| `EVT_aiegress_notice_confirmed` ★合规 | 同上 | `EL-GLOBAL-007` | `#68`★ PUT 的成功回调 | 用户点「我已知悉，继续」且写入成功后 | `data.consent_acknowledged_at`、`trigger_scene`（**不上报 PRD 正文**） |
| `EVT_aiegress_disabled` ★合规 | `RT-CAP-001` / `UI-CAP-001` | `EL-CAP-019`、`EL-CAP-020`、`EL-CAP-021` | `#68`★ PUT 的成功回调（`egress_enabled = false`） | 用户关闭开关时 | `egress_enabled=false`、`disabled_reason_len`（**只报长度，不报全文**） |
| `EVT_gen_blocked_by_egress` ★合规 | `RT-EDIT-001` / `RT-WORK-001` / `RT-UPLOAD-001` / `RT-CAP-001` | `EL-EDIT-037`、`EL-WORK-027`、`EL-UPLOAD-014`、`EL-CAP-021` | 生成入口置灰分支 / `#10`/`#12`/`#43`/`#58` 的 ★`UPSTREAM_UNAVAILABLE` 分支 | 外发开关关闭导致生成不可用时（**用于证明没有静默降级**） | `code = UPSTREAM_UNAVAILABLE`、`entry` |
| `EVT_auth_password_login` | `RT-AUTH-001` | `EL-AUTH-018`、`EL-AUTH-019`、`EL-AUTH-020`、`EL-AUTH-021`、`EL-AUTH-010` | 三分支各自的回调内：`blocked` = `EL-AUTH-018`/`019` 字段级提示渲染之后（**`#72` 请求未发出**）；`failed` = `#72` 失败且 `EL-AUTH-010` 渲染之后；`success` = `#72a`/`#72` 成功、`token` 写入 `STORE-GLOBAL/SESSION` 之后、跳转之前 | 本地账号密码登录（2026-10-21 本机落地；`result` 三分支互斥、逐支可判定） | `result`、`reason`、`block_reason`、`duration_ms`、`retry_index`、`reentry`；⚠️ **绝不携带用户名/密码**（含长度、掩码、哈希），**也不得**用任何参数区分「账号不存在」与「密码错误」 |
| `EVT_llm_model_switch` | 全部 13 页（应用外壳顶栏） | `EL-GLOBAL-009` | `ModelSelectorStore.selectModel(id)` 的 `#71a` 回调内（成功 = 写入之后、`EL-GLOBAL-009` 显示新模型之后；失败 = 回到原模型之后） | 切换大模型（2026-10-21 本机落地；回答 `G-014`） | `result`、`from_model`、`to_model`、`available_model_count`、`last_verdict`；**权威模型来源仍是 `#17.model`**，本事件只提供切换时间线 |

### 10.2 易错点逐个表态（`埋点-需求包 §4` 的 6 条，**本 Spec 逐条落法**）

| 易错点 | 本 Spec 的落法（可判定） |
|---|---|
| **旧响应后到**（`REQ-GEN-006`） | 被丢弃的旧 `seq` 结果**不上报**「生成完成」—— 上报点写在 `PreviewStore.applyPreview(seq)` **内部**，而该方法**只在 `seq > appliedSeq` 时被调用** |
| **幂等重放**（`REQ-NF-006`） | `EVT_*_success` 类事件挂在**成功回调**且带 `dedup_key`（`Idempotency-Key` + 业务 id）；`IDEMPOTENT_REPLAY` 分支**不重复计数**（连点新建只报一次「创建成功」） |
| **取消**（`REQ-GEN-005`） | `canceled` **只报 `EVT_gen_task_canceled`**，**不同时报失败或成功**；上报分支按 `status` **互斥枚举**（`switch` 而非 `if` 串联） |
| **部分成功**（`REQ-UPLOAD-003` / `REQ-SPEC-001` / `REQ-CAP-002`） | `partial` **单独上报**且参数含 `failed_parts_count` / `failed_roles` / `failed_capabilities`；`overall = partial` 时**不得**走成功分支（三处上报点均在 `partial` 分支内） |
| **SSE 重连**（`REQ-GEN-007`） | 重连后按 `seq` 取最新；任务终态上报以 **`task_id` 去重**（本地 `reportedTaskIds` 集合，**重连不重复上报同一任务终态**） |
| **空消息被拦截**（`REQ-CHAT-001`） | 单独事件 `EVT_chat_send_blocked` 挂在**拦截分支**（`EL-WORK-020` 提示处），与 `EVT_chat_send_success` 区分；**参数不含消息正文** |

### 10.3 公共参数与上报

| 项 | 约定 |
|---|---|
| 批量上报 | 走 **`API-PLAT-062`（`#62 POST /metrics/events`）**，批量 + **失败静默重试**；**不阻塞业务、不阻塞离开页面**（`REQ-TRACK-003`） |
| 用户标识 | 使用飞书 `open_id`（`#66`★ 的 `data.user_id`），**脱敏/哈希口径由埋点 Spec 定义**（`[来源: 推断，待确认]`，`埋点-需求包 §5` 第 2 条） |
| 公共参数 | 设备/浏览器、平台版本、会话 id、来源页（`RT-*`）、上一页（`RT-*`）、`project_id`（脱敏口径待定） |
| 禁止项 | **不含 PRD 正文、生成代码、对话正文、任何密钥/令牌**；**不上报用户输入原文** |
| 保留期 | `埋点-需求包 §5` 第 5 条：个人数据注销 / 项目删除 30 天后物理清除 → **埋点数据须有对应清理口径**，当前**无实体承载** → `[拆解缺口-Q7]`（§12 汇总） |

### 10.4 其余 27 条事件的埋码点（**与 §10.1 合计 54 条**，与 `埋点-Spec §3` 一一对应）

> 由 `埋点-Spec §3` 事件字典逐条提取（页面 / 元素 / 埋码位置 / 触发时机 / 参数 均照录），按字典分节排列。


#### 3.1 账号与会话（辅助 · 回答 `G-010`）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_auth_scan_success` | `UI-AUTH-001` / `RT-AUTH-001` | `EL-AUTH-006`、`EL-AUTH-009` | `STORE-AUTH` 的 `#64` 回调 `onConfirmed(token)` 内（写 token 之后） | 飞书扫码登录成功 → `#64` 轮询返回 `scan_status=confirmed` 且 `token` 写入 `STORE-GLOBAL/SESSION` **之后**、`replace` 到 `nextPath` **之前** | `duration_ms:int`（二维码首次展示→confirmed）、`qr_refresh_count:int(0~n)`、`reentry:bool`（由 `?next=` 存在与否判定）〔上报时机 即时 flush；去重：同一 `session_id` 只报 1 次〕 |
| `EVT_auth_login_failed` | `RT-AUTH-001` | `EL-AUTH-010`、`EL-AUTH-011` | `#64` 失败分支回调（置 `EL-AUTH-010` 可见之后） | 扫码换取 token 失败 → `#64` 返回失败或网络异常，且 `EL-AUTH-010`「登录没成功，请重试。」**渲染之后** | `error_code:string`（`UPSTREAM_TIMEOUT`/`UPSTREAM_UNAVAILABLE`/`RATE_LIMITED`/`NOT_FOUND`）、`retry_index:int`〔上报时机 即时；去重：同一 `state` 只报 1 次（重试产生新 `state`）〕 |
| `EVT_auth_session_expired` | 全局 | `EL-AUTH-012`、`EL-AUTH-013` | 全局响应拦截器 401 分支（跳转之后） | 会话过期 → **任意业务接口返回 401** 且已跳转 `RT-AUTH-001`、`EL-AUTH-012` **渲染之后** | `source_rt:string`（`RT-*`）、`source_api:string`（`#n`）、`had_draft:bool`（是否存在未提交本地草稿）〔上报时机 即时 flush；去重：同一 `session_id` 只报 1 次〕 |
| `EVT_auth_logout` | `RT-PROJ-001`、`RT-WORK-001` | `EL-PROJ-006`、`EL-WORK-008` | 用户菜单「退出登录」项 `onClick` → `#65` 回调内 | 退出登录 → 点用户菜单「退出登录」且 `#65` 返回成功（**或**网络失败走本地强制登出）**之后**、清会话状态**之后** | `forced:bool`（`true` = 网络失败本地强制登出）〔上报时机 即时 flush；去重：同一 `session_id` 只报 1 次〕 |

#### 3.2 项目与激活（回答 `G-001` 的入口段、`G-008` 的分母）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_proj_open_workbench` | `RT-PROJ-001` → `RT-WORK-001` | `EL-PROJ-015`、`EL-PROJ-010` | `#3` 成功回调内（路由进入之后） | 进入项目（激活起点） → 点 `EL-PROJ-015` / `EL-PROJ-010` 且 `#3` 项目详情返回成功、已进入 `RT-WORK-001` **之后** | `project_id:string(36)`、`stage:enum{created,kb_ready,reviewing,supplementing,gate_passed,splitting,spec_generating,ui_ready,api_developing,app_developing,editing,code_generating,verifying,preview_ready,manual_required,testing,delivered}`（`数据模型 §3.1`）、`from_entry:enum{card,enter_button}`〔上报时机 批量；去重：同一 `project_id` 且同一 `session_id` 只报 1 次〕 |
| `EVT_proj_deleted` | `RT-PROJ-001` | `EL-PROJ-046`、`EL-PROJ-018` | `#5` 成功回调内（列表移除之后） | 项目删除 → 二次确认 `EL-PROJ-046` 后 `#5` 返回成功、卡片已移除、Toast「项目已删除，30 天后彻底清除」**渲染之后** | `project_id:string(36)`、`deleted_at:datetime`（UTC）〔上报时机 即时 flush；去重：同一 `project_id` 只报 1 次〕 |

#### 3.3 上传与解析（回答 `G-003`、漏斗节点 2）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_upload_entry_click` | `RT-WORK-001` | `EL-WORK-027` | `EL-WORK-027` 的 `onClick` 内（跳转前） | 点击「上传 PRD」入口 → `EL-WORK-027` 的 `onClick` 内、**路由跳转之前**（即使随后被 `EL-GLOBAL-004` 告知弹窗拦截，本事件**已上报**） | `project_id:string(36)`、`gate:enum{notice_required,pass}`〔上报时机 批量；去重：300ms 内连点只报 1 次〕 |
| `EVT_upload_start` | `UI-UPLOAD-001` / `RT-UPLOAD-001` | `EL-UPLOAD-014` | `#10` 请求前（前置校验通过之后） | 开始上传并触发解析 → 点 `EL-UPLOAD-014` 且**三个前置全部满足**（告知已确认 / 外发开关开启 / 前端规格预校验通过）后、`#10` 请求**发出之前** | `source_type:enum{file,feishu_link}`、`file_count:int(1~n)`、`total_size_mb:number`（**不上报文件名**）〔上报时机 批量；去重：`dedup_key` = `Idempotency-Key`；3s 内同键只报 1 次〕 |
| `EVT_upload_part_manual_supplement` | `RT-UPLOAD-001` | `EL-UPLOAD-025`、`EL-UPLOAD-023`、`EL-UPLOAD-024` | `#15` 成功回调内（该块状态更新之后） | 对部分失败分块手动补充 → 点 `EL-UPLOAD-025`「手动补充」且 `#15` 返回成功、该块 `status → ok` **之后** | `part_key:enum{body,tables,whiteboards,attachments}`〔上报时机 批量；去重：同一 `revision_id` + `part_key` 只报 1 次〕 |

#### 3.4 门禁审核（回答 `G-004`、漏斗节点 3）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_review_submit_blocked` | RT-REVIEW-001 | EL-REVIEW-026/060 | **当前无可达track点（定义保留）** | 正常disabled不弹窗、不发#16、不发本事件；负向统计实现待主Agent决定，不声称点击高亮已经发生 | blocking_open/code定义保留；不删事件、不用render循环冒充上报 |
| `EVT_review_standard_saved` | `RT-REVIEW-001`（`?drawer=gate-standard`） | `EL-REVIEW-047`、`EL-REVIEW-048`、`EL-REVIEW-049` | `#24` PUT 成功回调内（版本号回显之后） | 维护门禁标准 → 点抽屉 `EL-REVIEW-047` 保存且 `#24` 返回成功、版本号回显「门禁标准已保存（v{n}）」**之后** | `standard_version:int`、`items_count:int`〔上报时机 批量；去重：同一 `standard_version` 只报 1 次〕 |
| `EVT_review_loopback_exceeded` | `RT-REVIEW-001` | `EL-REVIEW-037` | `EL-REVIEW-037` 分支回调（动作完成之后） | 超限二选一 → 回流轮次 > 3 时 `EL-REVIEW-037` 渲染后，用户点任一按钮且该动作完成 **之后** | `choice:enum{accept_and_record,abort}`、`loopback_round:int`〔上报时机 即时 flush；去重：同一 `revision_id` 只报 1 次〕 |

#### 3.5 拆解与 Spec 生成（回答 `G-005`、`G-006`；漏斗节点 4、5）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_split_start` | `RT-SPLIT-001` | `EL-SPLIT-018`、`EL-SPLIT-014`、`EL-SPLIT-005` | `#28` 的 202 回调内（**409 分支不报**） | 发起 / 重新发起拆解 → 点空态 `EL-SPLIT-018`「开始拆解」**或** `EL-SPLIT-014` 确认「重新拆解」，且 `#28` 返回 **202**、`runningTask` 写入 **之后** | `trigger:enum{first_run,re_split}`、`depth_ui:enum{minimal,standard,comprehensive}`（**生效档位**：默认取项目级 `E1.depth`，`#28` 请求体可带可选 `depth` 覆盖 —— `[拆解缺口-Q6]` 已闭合）、`project_id:string(36)`〔上报时机 即时 flush；去重：`dedup_key` = `Idempotency-Key`；409 拒绝分支**不报**本事件〕 |
| `EVT_split_failed` | `RT-SPLIT-001` | `EL-SPLIT-017`、`EL-SPLIT-016` | `SplitStore` 失败回调内（失败态渲染之后） | 拆解失败 / 超时（**旁路**） → 拆解任务终态 `failed` 或 `timeout` 且失败态**渲染之后** | `status:enum{failed,timeout}`、`error_code:string`、`duration_ms:int`〔上报时机 即时 flush；去重：以 `task_id` 去重〕 |
| `EVT_spec_export` | `RT-SPEC-001` | `EL-SPEC-009` | `#33` 成功回调内（下载触发之后） | 导出单份 Spec → 点 `EL-SPEC-009`「导出 .md」且 `#33` 返回成功、下载已触发与 Toast **渲染之后** | `role:enum{ui,api,app,track,test}`、`doc_size_kb:number`（**不含正文**）〔上报时机 批量；去重：同一 `role` 在 3s 内只报 1 次〕 |

#### 3.6 对话（回答 `G-012`）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_chat_send_success` | **当前路由**（对话为全局悬浮窗，`page_rt` 取实际路由；下表同） | `EL-WORK-022`、`EL-WORK-019` | `#26` 成功回调内（本地消息置 `sent` 之后） | 消息发送成功 → 点 `EL-WORK-022`「发送」或 `EL-WORK-019` 回车，且内容非空、未超长，`#26` 返回后本地消息追加为 `status=sent` **之后** | `message_id:string(36)`、`char_count:int(1~20000)`、`message_seq:int`、`phase:enum{created,kb_ready,reviewing,supplementing,gate_passed}`（当前项目阶段）〔上报时机 批量；去重：`dedup_key` = `Idempotency-Key`；**3s 内连点只报 1 次**〕 |
| `EVT_chat_send_blocked` | 当前路由 | `EL-WORK-020`、`EL-WORK-021` | 拦截分支内（**不发 `#26`**） | 点击发送但**被拦截** → 空内容 → `EL-WORK-020`「先说点什么再发送。」抖动提示**渲染之后**；超长 → `EL-WORK-021`「消息最多 20000 字符，当前 {n} 字符。」**渲染之后**（**均不发请求**） | `reason:enum{empty,over_length}`、`char_count:int`、`limit:int=20000`〔上报时机 批量；去重：同一 `reason` 在 1s 内只报 1 次〕 |
| `EVT_chat_reply_terminal` | 当前路由 | `EL-WORK-016`、`EL-WORK-018`、`EL-WORK-017` | SSE `chat.delta` 完成回调 / 60s 超时分支内 | 回复结束 → 该条回复的 SSE `chat.delta` 收到**完成标记**，**或** 60s 超时置 `failed` **之后** | `status:enum{completed,failed,timeout}`、`duration_ms:int`、`message_id:string(36)`〔上报时机 批量；去重：以 `message_id` 去重〕 |
| `EVT_chat_resend` | 当前路由 | `EL-WORK-017` | `#27` 成功回调内 | 失败重发 → 点 `EL-WORK-017`「重发」且 `#27` 返回成功、该消息就地转 `streaming` **之后** | `message_id:string(36)`、`retry_index:int(≥1)`〔上报时机 批量；去重：同一 `message_id` 的同一 `retry_index` 只报 1 次〕 |

#### 3.7 编辑与生成（回答 `G-002`、`G-007`、`G-013`；漏斗节点 6、7）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_edit_element_voided` | `RT-EDIT-001` | `EL-EDIT-040`、`EL-EDIT-017`、`EL-EDIT-046`、`EL-EDIT-052` | `#38` 成功回调内（节点移出渲染树之后） | 删除控件（id 作废） → 点 `EL-EDIT-040` / `EL-EDIT-017` 并经 `EL-EDIT-043` 二次确认、`#38` 返回成功、节点已移出渲染树 **之后** | `element_id:string(24)`、`widget_type:string`、`child_count:int`〔上报时机 即时 flush；去重：同一 `element_id` 只报 1 次（**`void` 是单向终态**）〕 |
| `EVT_edit_submit_blocked` | `RT-EDIT-001` | `EL-EDIT-037` | `EL-EDIT-037` 的 `onClick` 拦截分支（**成功分支见下一条，二者互斥**） | 点「提交变更」但**被拦截** → 点 `EL-EDIT-037` 且以下任一成立并给出提示**之后**（**不发 `#43`**）：告知未确认 / 外发开关关闭 / 存在 `unset` 假设 / 离线 / 无页面 | `block_reason:enum{notice_unconfirmed,egress_disabled,assumption_unset,offline,no_page}`、`page_id:string(36)`〔上报时机 批量；去重：同一 `block_reason` 在 1s 内只报 1 次〕 |

#### 3.9 交付与版本（回答 `G-008`、漏斗节点 9）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_version_rolled_back` | `RT-VER-001` | `EL-VER-018`、`EL-VER-020`、`EL-VER-021` | `#57` 回调内（成功与失败两个分支） | 整包回滚 → 点 `EL-VER-018`「确认回滚」且 `#57` 返回（成功或失败均报）且 UI 状态已整体回退/更新 **之后** | `result:enum{succeeded,failed}`、`target_version_seq:int`、`from_version_seq:int`、`duration_ms:int`〔上报时机 即时 flush；去重：`dedup_key` = `Idempotency-Key`；同一次回滚只报 1 次〕 |

#### 3.10 能力配置（回答 `G-011`）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_cap_save_generated` | `RT-CAP-001` | `EL-CAP-009`、`EL-CAP-011`、`EL-CAP-012` | `#58` 回调内（**`partial` 不得走成功分支**） | 保存能力配置并生成接入代码 → 点 `EL-CAP-009`「保存并生成」且 `#58` 返回（含 `overall`）、`items` 写入 **之后** | `overall:enum{succeeded,partial,failed}`、`enabled_capabilities:string[]⊆{push,apm,crash_report,log_report,stats_sdk,hardening,privacy_dialog}`、`failed_capabilities:string[]`、`conflicts_count:int`、`duration_ms:int`〔上报时机 批量；去重：`dedup_key` = `Idempotency-Key`；同一 `overall` 时刻只报 1 次〕 |
| `EVT_cap_disable_confirmed` | `RT-CAP-001` | `EL-CAP-007`、`EL-CAP-013` | `#58` 成功回调内（确认之后） | 取消勾选已生成过的能力 → 关闭 `EL-CAP-007` 并经 `EL-CAP-013` 二次确认、`#58` 返回成功 **之后** | `capability:string`（7 项枚举之一）、`code_status_before:enum{not_generated,generated,partial,failed}`〔上报时机 批量；去重：同一 `capability` 只报 1 次〕 |

#### 3.11 ★ 外发大模型合规事件（P0 · 回答 `G-009`；**单独成节**，项目约束 5）

| 事件名 EVT | 所在页面 | 元素 ID (EL-) | 埋码位置（类/方法/回调） | 触发时机 | 依赖参数来源 |
|---|---|---|---|---|---|
| `EVT_aiegress_notice_write_failed` | 同上 | `EL-GLOBAL-004`、`EL-GLOBAL-007` | `#68` PUT 失败分支回调 | 确认状态写入失败 → `#68` PUT 返回失败且弹窗内错误条「确认状态没保存成功。」**渲染之后** | `error_code:string`、`trigger_scene:enum`〔上报时机 即时 flush；去重：同一 `trigger_scene` + `error_code` 在 3s 内只报 1 次〕 |
| `EVT_aiegress_notice_canceled` | 同上 | `EL-GLOBAL-008` | 弹窗关闭回调内（**判定原动作未执行之后**） | 用户拒绝 / 关闭告知弹窗 → 点 `EL-GLOBAL-008`「取消」**或**按 `Esc` 关闭弹窗，且**原动作未执行** **之后** | `trigger_scene:enum{upload_first,generate_first,workbench_generate}`〔上报时机 即时 flush；去重：同一 `trigger_scene` 在 1s 内只报 1 次〕 |
| `EVT_aiegress_enabled` | `RT-CAP-001` | `EL-CAP-019` | `#68` PUT 成功回调内（`egress_enabled=true`） | 用户重新开启外发开关 → 切换 `EL-CAP-019` 至 `true` 且 `#68` PUT 返回成功 **之后** | `egress_enabled:bool=true`〔上报时机 即时 flush；去重：同上〕 |

<!-- 共 27 行 -->

---

## 附节 A ★ 生成到安卓工程侧的实现约束（**写给 S7 开发** · `App-需求包 §4` 的 7 条）

> **本节与 §1~§10 是两回事**（见 §0 阅读约定）：§1~§10 定义**平台自身 App（Web 工作台）**；
> **本节定义「平台为用户的安卓工程生成什么」** —— 即平台内部**代码生成链路**必须遵守的 7 条实现约束。
> 落点：`REQ-GEN-001`~`010`、`REQ-UIEDIT-001`~`010`、`REQ-CAP-001`~`004`、`REQ-DELIVER-001`。
> **校验方式**：每条给「怎么验」，供 S7 自检与 S8 测试引用。

| # | 约束（**逐条可验**） | 实现落点 | 怎么验 | 依据 |
|---|---|---|---|---|
| **A-1** | 生成物 = **布局 XML + Kotlin**，由 **AI 直接生成**；**不得**走模板渲染 / 占位符替换 / 预置工程改写 | `#43` 生成的产物 → `#47` 出参 `artifacts[]` | 抽查两次不同元素树的产物：**不存在**固定骨架里被替换的占位符痕迹；同输入两次生成的文本**不逐字相同**（生成式特征），但 `input_hash` 相同 | `§F13 补充块②`（`answer:Q1`）、`REQ-BASE-001` |
| **A-2** | **元素 id → 安卓侧标识的确定性映射**：`EL-HOME-001` → `R.id.el_home_001`，**由 agent 在生成时回填**；id 一律用**归一化（大写零填充）**形式比较与存储 | 生成器在产出 XML `android:id` 时回填；`UI-Spec §5` 留对照表 | 任取页面元素树，逐个 `element_id` 校验：`EL-X-NNN` ↔ `R.id.el_x_nnn` **一一对应、无遗漏、无多余**（即 L1 规则③的等价校验） | `D-A3`、`REQ-UIEDIT-009`、`L1 规则③` |
| **A-3** | 事件**只生成空回调存根**（如 `setOnClickListener { /* TODO：由对话补充 */ }`），`action_type` 本期**仅 `none`**；**三类事件（`click`/`long_click`/`double_click`）可并存** | `#40` 的事件配置 → 生成 `MODEL-ELEMENT-EVENTS` 对应回调 | 代码里**不存在**跳转目标解析 / 接口调用 / 埋点上报参数；回调体内**只有 TODO 注释**；同一元素勾三类 → 生成三个回调 | `D-Q13`、`REQ-UIEDIT-004`、**项目约束 4** |
| **A-4** | 同时配置 `click` 与 `double_click` 时：**300ms 判定窗**，双击**取消已触发的单击回调** | 生成的事件绑定代码（`GestureDetector` 或等价实现） | 真机连点两次：**只有双击回调生效**，单击回调**不被执行**（可观测日志/计数器） | `D-A11`、`数据模型 E8 判定窗` |
| **A-5** | 工程产物含 **`gradle wrapper`** + **依赖版本锁定清单**；**本机构建** —— **平台不做服务端构建、不接第三方云 CI**；**界面不得出现任何构建/打包/编译进度** | `#60`/`#61` 的交付包；`#47` 出参 | 交付包解压后**含 `gradlew`/`gradle-wrapper.jar`/wrapper.properties** + 依赖锁定清单；平台侧**无**构建产物（apk/aab）；App Spec 与 UI Spec **无构建入口** | `answer:Q3`、`REQ-GEN-009`、**项目约束 1/2** |
| **A-6** | 能力接入代码：**勾选即生成**、**生成前自动备份**、冲突**以配置为准**；**第三方 key 只留占位**（本期不采集） | `#58` 的 7 项能力 → 生成接入代码 | ① 勾选并保存 → `code_status` 变 `generated`；② 生成前旧代码在备份路径可查；③ 冲突时**配置覆盖既有**（且有备份）；④ 代码中**不存在任何真实 key**，只有占位常量/注释 | `D-Q19`、`REQ-CAP-001`~`004` |
| **A-7** | 代码文件**原子落盘**（先写临时文件再改名）；**任务中断不产生半成品文件** | 生成链路写盘实现 | 在写入过程中强制中断任务 → 产物目录**无半成品文件**；已有文件**保持上一次完整版本** | `D-A16` |

> **与 §10 的关系（B 线埋点）**：被开发项目的埋点方案（`TrackPlan`，`REQ-SPLIT-004`，经 `#59` 展示）
> 由 **S7 按埋点 Spec 写入用户安卓工程**；其**代码落点格式与本 Spec §10.1 同构**
> （页面 `RT-*` / 元素 `EL-*` / 具体回调 / 精确时机 / 去重规则），**但事件名与参数由埋点角色定义**，
> 本 Spec **不预置**（`埋点-需求包 §4`：本节只约束「谁写、按什么格式写」）。
>
> **本节 7 条的实现依赖的补口已于 2026-10-21 转基线**：`#68`★（外发开关关闭时生成类调用须返回明确不可用原因，见 §6.3 的 `UPSTREAM_UNAVAILABLE` 不可用分支）、
> `#58`★ 的 `conflicts[]`/`alignment_table[]`、`#54`★ 的 `artifacts[]`（交付包内容清单）。

---

## 11 需求追溯表

> **REQ 集合与 `需求条目表.md` 的 91 条 `REQ-ID` 一致**（模块内行序按本 Spec 自定；摘要文本取自该表，经 `UI-Spec §9` 传递）。
> **覆盖状态四态**：`OK`（覆盖，写出承接路由）/ `GAP`（有缺口）/ `N/A`（不适用，写理由）/ `Deferred`（延后，注明由谁覆盖）。
> **本表口径是「App 侧覆盖」**：凡与 App 无关者标 `N/A` 并写理由；凡有缺口者在备注列挂编号（缺口汇总见 §12）。

| REQ-ID | 需求摘要 | 承接路由 ID | 覆盖状态 | 备注 |
|---|---|---|---|---|
| `REQ-PROJ-001` | 新建项目（名称规则/重名/幂等） | `RT-PROJ-001` | OK | `[缺口-UI-01]`（用户菜单数据）不影响本页主流程 |
| `REQ-PROJ-002` | 项目列表（分页/排序/搜索；空态 vs 无匹配） | `RT-PROJ-001` | OK | `[拆解缺口-Q5]`（**已闭合** 2026-10-21：展示项已移除，`EL-PROJ-014` 无数据需求）；`[冲突-UI-04]`（每页条数） |
| `REQ-PROJ-003` | 项目重命名 | `RT-PROJ-001` | OK | 乐观更新 + 回滚 |
| `REQ-PROJ-004` | 项目删除（逻辑删除 30 天） | `RT-PROJ-001` | OK | 清除 `project_id` 维度缓存（§7） |
| `REQ-PROJ-005` | 工作台顶部状态条 | `RT-WORK-001` | OK | SSE `task` 驱动刷新，**不轮询** |
| `REQ-KB-001` | 知识库内容 | `RT-KB-001` | OK | 三态 `[来源: 推断，待确认]` |
| `REQ-KB-002` | 知识库入口（两处）+ 三态 + 403 | `RT-PROJ-001`、`RT-WORK-001`、`RT-KB-001` | OK | 入口**先鉴权**，403 走统一无权限态 |
| `REQ-UPLOAD-001` | 上传 PRD 并解析（含飞书链接） | `RT-UPLOAD-001` | OK | `[缺口-APP-01]`（**已闭合** 2026-10-21：`#10` 出参增 `document_id`，上传链闭环） |
| `REQ-UPLOAD-002` | 规格校验与拒绝 | `RT-UPLOAD-001` | OK | 前端先校验，服务端仍校验；**不产生半成品记录** |
| `REQ-UPLOAD-003` | 部分解析失败不阻断 + 手动补充 | `RT-UPLOAD-001` | OK | `partial` 为**独立终态**（标黄，不得显示为完全成功） |
| `REQ-UPLOAD-004` | 空文档与解析失败区分 | `RT-UPLOAD-001` | OK | `empty_document = true` 走**空态**（`EL-UPLOAD-027`） |
| `REQ-UPLOAD-005` | revision 不覆盖 | `RT-UPLOAD-001`、`RT-KB-001` | OK | 只读查看，**不做「替换」语义** |
| `REQ-UPLOAD-006` | 解析进度与超时反馈 | `RT-UPLOAD-001` | OK | 进度来自任务态；本地计时只做「已用 {n} 秒」展示；超时 → 可重试失败态 |
| `REQ-REVIEW-001` | 门禁审核与评分卡 | `RT-REVIEW-001` | OK | `[拆解缺口-Q2-附]`（**已闭合** 2026-10-21：改为「按当前 `standard_version` 的全部检查项」，T0 默认 43 项）；`superseded` 走**独立「已过期」视图** |
| `REQ-REVIEW-002` | 回写原 PRD | `RT-REVIEW-001` | OK | **显式一步**：勾选（本地）→ 确认弹窗 → `#23`；**禁止点了勾选即写** |
| `REQ-REVIEW-003` | 待澄清清单与逐条作答 | `RT-REVIEW-001` | OK | 页面内存答复，确认 #23 原子保存；离页草稿恢复当前未实现；提交条件与服务端判定阻断项；`[缺口-API-02]`（`impact`） |
| `REQ-REVIEW-004` | 假设清单 Accept/Convert | `RT-REVIEW-001` | OK | 存在 `unset` → **生成入口禁用 + 说明原因**（前端拦截 + 服务端校验） |
| `REQ-REVIEW-005` | 门禁标准维护与版本号 | `RT-REVIEW-001`（抽屉 `?drawer=gate-standard`） | OK | **无独立页面** → `[冲突-UI-02]`；未保存改动可恢复；保存后**版本号必须回显** |
| `REQ-REVIEW-006` | 一键采纳 = 仅批量勾选 | `RT-REVIEW-001` | OK | 两阶段状态：`已勾选（本地）`→`已写入（服务端确认）`；**按钮文案不得混淆** |
| `REQ-REVIEW-007` | agent 输出校验与降级 | `RT-REVIEW-001` | OK | 提示态 + 人工入口（`EL-REVIEW-042`）；**不自动重试到死、不静默丢弃** |
| `REQ-REVIEW-008` | 回流上限 3 轮与超限升级 | `RT-REVIEW-001`、`RT-WORK-001` | OK | 轮次为项目级状态；`[缺口-API-03]`（`loopback_round` 无字段）；`[缺口-APP-04]`（**已闭合** 2026-10-21：接口 `#70` 已补，「中止」可用） |
| `REQ-REVIEW-009` | 超长 PRD 分块不截断 | `RT-REVIEW-001` | OK | 被分块的部分为**可见区块**，不得静默截断后当作完整结果 |
| `REQ-REVIEW-010` | 指令定界隔离 | `RT-REVIEW-001`（App 侧） | OK | 服务端责任；**App 侧保证用户输入不被拼进任何指令位、展示时转义** |
| `REQ-CHAT-001` | 对话发送与流式回复 | `RT-WORK-001` | OK | 三态 `sent/streaming/failed`；**同一时刻一条在途**；增量合并不整段重绘；Markdown **转义 HTML** |
| `REQ-CHAT-002` | 对话历史持久化与失败重发 | `RT-WORK-001` | OK | 历史按 `seq` 升序；重发**复用原消息不新增记录**；单条 60s 超时置失败 |
| `REQ-SPLIT-001` | 拆解与 REQ-ID 统一编号 | `RT-SPLIT-001` | OK | 5 张角色包卡片为可见状态集合 |
| `REQ-SPLIT-002` | 自适应深度三档 | `RT-SPLIT-001` | OK | `[拆解缺口-Q6]` **已闭合** 2026-10-21：落点 = 项目级 `E1 Project.depth`；`#16`/`#28` 均可带可选 `depth` 覆盖 |
| `REQ-SPLIT-003` | 重新拆解（破坏性/单飞） | `RT-SPLIT-001` | OK | 前端禁用 + 服务端 409 **双保险**；旧 Spec 转「已归档」 |
| `REQ-SPLIT-004` | 被拆解项目的埋点方案 | `RT-SPLIT-001` | OK | `TrackPlan` **独立于事件面板**；`status` 四态可辨识；`[冲突-UI-05]` |
| `REQ-SPEC-001` | 五角色 Spec 生成（串行/部分成功） | `RT-SPEC-001` | OK | 五 tab **各自独立状态**；**部分成功不置整体成功**；界面体现「当前生成到哪个角色」 |
| `REQ-SPEC-002` | Spec 过期与单份重试 | `RT-SPEC-001` | OK | `stale` 独立状态；上游变更后**重新拉取**（不能只靠本地缓存） |
| `REQ-SPEC-003` | Spec 导出（需鉴权/不含密钥） | `RT-SPEC-001`、`RT-VER-001` | OK | 前端**不得把本地缓存密钥类数据混入导出** |
| `REQ-SPEC-004` | 需求追溯矩阵 | `RT-SPEC-001`、`RT-SPLIT-001`（`?drawer=trace`） | OK | `[缺口-API-04]`（RTM 无接口 → `#67`★）；**四态由接口给出，前端只渲染** |
| `REQ-PROOF-001` | 角色校对与《补充要求清单》 | `RT-SPEC-001` | OK | 每条带「回流对话补充」→ 跳 `RT-WORK-001` 并**预填上下文** |
| `REQ-UIEDIT-001` | 拖拽控件入画布 | `RT-EDIT-001` | OK | id **由服务端返回后才写入本地元素树**；超 200 前端拦截 + 服务端 400 |
| `REQ-UIEDIT-002` | 手机样式画布（360dp/三重选中） | `RT-EDIT-001` | OK | 选中态三重表达由**一个 selection 状态**驱动；键盘与鼠标**产生同一份状态变更** |
| `REQ-UIEDIT-003` | 属性面板 11 项 | `RT-EDIT-001` | OK | `[拆解缺口-Q2]` **定稿前须闭合**；样式改动**仅本地渲染不触发任务**；提交前服务端二次校验 |
| `REQ-UIEDIT-004` | 事件面板 3 项 | `RT-EDIT-001` | OK | **只生成空回调存根**；**不得实现**跳转目标/接口参数/埋点参数控件（项目约束 4） |
| `REQ-UIEDIT-005` | 控件树 | `RT-EDIT-001` | OK | 与画布**同一棵元素树**（禁止第二份）；默认展开 3 层为**视图态不落库**；**永无孤儿节点** |
| `REQ-UIEDIT-006` | 编辑态/预览态两态切换 | `RT-EDIT-001`、`RT-PREVIEW-001`、`RT-WORK-001` | OK | **同一路径两个状态**（`?mode=`）；切换**不得丢未提交改动**；预览态**只读** |
| `REQ-UIEDIT-007` | 画布草稿自动保存与恢复 | `RT-EDIT-001`、`RT-WORK-001` | OK | 本地防抖 + `#42` 双保险；恢复提示「已恢复上次未提交的改动。」；会话过期**重认证后自动续接** |
| `REQ-UIEDIT-008` | 删除控件（二次确认/id 作废/台账） | `RT-EDIT-001` | OK | 节点置 `void` 并移出渲染树；**id 不可复用**，台账可查 |
| `REQ-UIEDIT-009` | 元素 id 规则与分配 | `RT-EDIT-001` + **全部含 `EL-*` 的页面** | OK | 临时 id → 服务端正式 id；**一律用归一化形式**；`EL-*` 是「画布↔安卓控件↔埋点↔测试」统一主键 |
| `REQ-UIEDIT-010` | 控件面板（37 项 + 本地搜索） | `RT-EDIT-001` | OK | **本地静态数据 + 本地过滤**；不可拖入的项不出现在面板；与生成代码 `widget_type` 一一对应 |
| `REQ-GEN-001` | 提交变更 → AI 生成安卓代码 | `RT-EDIT-001` | OK | 提交后**立即回编辑态但状态条显示「生成中」**；**不阻塞继续编辑**；提交串行排队；构造 `input_hash` + 幂等键 |
| `REQ-GEN-002` | L1 静态验证五规则 | `RT-PREVIEW-001`、`RT-EDIT-001` | OK | 前端**只消费** L1 结果、不自行判定；`checks[]` 逐条打勾；**L1 通过才刷新预览** |
| `REQ-GEN-003` | L2 本地构建代理回传 | `RT-PREVIEW-001`、`RT-EDIT-001`、`RT-VER-001` | OK | `reported = false` → 「未验证构建」灰字 + 悬浮说明；**不阻断任何操作**；回传路径**本机代理 → 平台** |
| `REQ-GEN-004` | 验证失败重试（上限 3） | `RT-PREVIEW-001`、`RT-EDIT-001` | OK | 两按钮语义：「重试（还剩 {n} 次）」vs `n=0`「需要人工介入」+「查看验证日志」 |
| `REQ-GEN-005` | 生成任务取消 | `RT-PREVIEW-001`、`RT-WORK-001` | OK | 丢弃产物、不入版本、**预览保持上次成功结果**；**非错误态、不计重试** |
| `REQ-GEN-006` | 单调序号，只应用最新结果 | `RT-EDIT-001`、`RT-PREVIEW-001`、`RT-WORK-001` | OK | 本地保存最新已应用 `seq`；旧响应**静默丢弃**；`TASK_STALE` **不弹错误** |
| `REQ-GEN-007` | 长任务模型 + SSE + 降级轮询 | `RT-WORK-001` | OK | 单条 SSE 承载任务 + 对话；**自动重连 + 按 `seq` 取最新**；15s `ping`；**降级 2s 轮询界面无差别** |
| `REQ-GEN-008` | 统一 5min 超时；生成失败 ≠ 验证失败 | `RT-WORK-001`、`RT-PREVIEW-001` | OK | 两个独立组件/文案，**不得共用一个错误组件** |
| `REQ-GEN-009` | 只出源码 + wrapper + 依赖锁定清单 | `RT-VER-001`、`RT-EDIT-001` | OK | **负向约束已落位**：全页不得出现构建/打包按钮；下载含 wrapper + 依赖锁定清单，**不含构建产物** |
| `REQ-GEN-010` | 外部依赖降级 | `RT-PREVIEW-001`、`RT-WORK-001`、`RT-UPLOAD-001` | OK | 504/503 走统一「上游不可用」可重试态；退避由服务端执行，前端只展示进度与重试入口；**绝不把失败渲染成成功** |
| `REQ-PREVIEW-001` | 预览显示与刷新时机 | `RT-PREVIEW-001` | OK | 只在 L1 `passed` 后替换内容（**无淡入**，直接替换）；`[拆解缺口-Q11]`（只读来源标签） |
| `REQ-PREVIEW-002` | 预览 6 态与文案 | `RT-PREVIEW-001` | OK | 六态**互斥且可枚举**；「生成失败」与「验证失败」文案与图形不同；「L2 未回传」是**附加标记**不是独立态 |
| `REQ-PREVIEW-003` | 近似预览与差异披露 ★ | `RT-PREVIEW-001` | OK | 常驻「近似预览」标记（任一状态可见）；差异清单**默认可见差异项名称**；**不得把渲染器差异渲染成「错误」** |
| `REQ-PREVIEW-004` | 预览溯源（序号 + 时间） | `RT-PREVIEW-001` | OK | 顶部信息条「生成 #{seq} · {时间}」；`finished_at = null` → 「时间未知」（**不得显示 1970**） |
| `REQ-API-001` | 接口定义增删改查（8 项类型枚举） | `RT-API-001` | OK | 下拉**完整 8 项、禁写「等」**；非法字段名**保留输入** + 字段级错误；保存与「生成版本」是**两个动作** |
| `REQ-API-002` | 项目级版本（整包快照 + diff） | `RT-API-001`、`RT-VER-001` | OK | `current` 唯一且**文字标记**；diff 分两级（接口**字段级** / Spec **文档级**） |
| `REQ-API-003` | 删除接口（影响范围 + 需复核） | `RT-API-001` | OK | 二次确认；引用方 Spec 置「需复核」（**拉取最新状态而非本地推断**） |
| `REQ-CAP-001` | 能力配置 7 项默认全关 + 保存即生成 | `RT-CAP-001` | OK | 保存后订阅 `code_status`；生成前服务端自动备份（**前端需提示「已自动备份」**）；配置纳入版本快照 |
| `REQ-CAP-002` | 能力生成部分失败逐项重试 | `RT-CAP-001` | OK | `partial` 独立态；逐项重试；**整体不显示为成功**（顶部标黄） |
| `REQ-CAP-003` | 取消勾选（仅移除配置，代码保留） | `RT-CAP-001` | OK | 二次确认 → 仅置 `enabled = false`；**前端不得触发代码删除** |
| `REQ-CAP-004` | 第三方密钥本期不采集 | `RT-CAP-001` | OK | 界面**不渲染任何 key 输入框**；`note` 只作占位说明；**前端不得缓存/回传密钥类数据** |
| `REQ-CAP-005` | 依赖版本冲突与版本对齐表 | `RT-CAP-001` | OK | `[缺口-API-05]`（`conflicts[]`★）；`[冲突-UI-05]` |
| `REQ-NF-001` | 耗时与超时指标 | `RT-UPLOAD-001`、`RT-REVIEW-001`、`RT-SPEC-001`、`RT-PREVIEW-001`、`RT-EDIT-001`、`RT-VER-001`、`RT-CAP-001` | OK | >3s 追加进度说明；**L1 超出 P95 时给进度反馈而非失败**；**L2 耗时只展示、不做承诺** |
| `REQ-NF-002` | 可用性底线 | 全部 13 条 `RT-*` | OK | 键盘可达（含**拖拽替代路径**）；状态**不只靠颜色**；无阻塞动效；非法输入保留；`[缺口-UI-09]`（键位） |
| `REQ-NF-003` | 并发编辑冲突（乐观锁 + diff） | `RT-EDIT-001`、`RT-API-001`、`RT-CAP-001`、`RT-KB-001` | OK | **共用同一套冲突组件**，不得各写一份；`[拆解缺口-Q13]`（画布/能力未标 `If-Match`） |
| `REQ-NF-004` | 分页/排序/搜索全站统一 | `RT-PROJ-001`、`RT-API-001`、`RT-KB-001`、`RT-UPLOAD-001`、`RT-REVIEW-001`、`RT-SPLIT-001`、`RT-SPEC-001`、`RT-VER-001` | OK | 全站**同一列表状态机**（首屏/翻页/空/无匹配/加载/错误/部分加载）；`[冲突-UI-04]` |
| `REQ-NF-005` | 时间口径与「未知/零/不适用」 | `RT-PROJ-001`、`RT-UPLOAD-001`、`RT-API-001`、`RT-VER-001`、`RT-PREVIEW-001`、`RT-KB-001`、`RT-WORK-001` | OK | UTC 入参 → 本地展示；`null` → 「未知」；**禁止 1970** |
| `REQ-NF-006` | 提交类操作幂等（3s） | 全部含提交动作的 `RT-*` | OK | 请求期内禁用 + `Idempotency-Key`（同一次意图 **3s 内复用同一 key**）；`IDEMPOTENT_REPLAY` **不重复计数** |
| `REQ-NF-007` | 多步写入原子性 | `RT-VER-001`（回滚）、`RT-REVIEW-001`（回写） | OK | 不做「部分成功」渲染；回滚失败 → 「回滚没完成，当前版本未变更。」+ **整体回退 UI 状态** |
| `REQ-NF-008` | API 版本前缀与统一响应包 | 全部 `RT-*` | OK | `/api/v1/` 前缀；统一响应包解包；错误码 → 文案映射表（§6.3）；**新增字段容忍**（未知字段忽略而不崩） |
| `REQ-AUTH-001` | 飞书扫码登录与 401 行为 | `RT-AUTH-001` | OK | `user_id` = `open_id`；401 → 跳登录 → **登录后恢复草稿与目标页**；未登录**不渲染任何业务数据**；`[缺口-API-01]`（已闭合：补口 `#63`~`#66` 转基线） |
| `REQ-AUTH-002` | 两角色权限矩阵 + 逐对象鉴权 | `RT-AUTH-001` + 全部 13 条 `RT-*` | OK | 统一 403 兜底「你没有权限访问这个项目。」；**不区分「不存在」与「无权限」**；**不做两套界面** |
| `REQ-AUTH-003` | 权限撤销 ≤5min 生效 | `RT-EDIT-001`、`RT-KB-001`、`RT-API-001`、`RT-CAP-001` | OK | 长停留页面定期重校验（或 403 兜底），**不得静默继续写**；周期 `[待澄清-A04]` |
| `REQ-AUTH-004` | ★ 外发大模型告知与开关（P0） | `RT-AUTH-001`、`RT-UPLOAD-001`、`RT-EDIT-001`、`RT-CAP-001`、`RT-WORK-001` | OK | 两处告知弹窗**未确认不能继续**；开关关闭 → **生成入口禁用 + 显示原因**；**不得点了没反应、不得静默降级**；`[缺口-API-06]`（`#68`★） |
| `REQ-AUTH-005` | 日志脱敏与密钥管理 | 全部 13 条 `RT-*`（负向约束） | OK | PRD 正文/生成代码**不入 URL、埋点、控制台日志、错误上报**；界面任何位置不得出现 key / 飞书 token |
| `REQ-AUTH-006` | 项目隔离 | 全部项目级 `RT-*` | OK | 缓存/状态一律以 `project_id` 为键；**切换项目清空上一个项目的画布与草稿** |
| `REQ-AUTH-007` | 增强策略本期不做 | — | **N/A** | **负向约束**：App 侧**不得引入**防截屏 / 水印 / 防篡改 / 防泄露的能力与入口（无实现即满足） |
| `REQ-AUTH-008` | 个人数据最小化〔推断〕 | `RT-PROJ-001`、`RT-WORK-001`（用户菜单） | OK | 前端只展示 `open_id`/昵称/头像；**带 `[来源: 推断，待确认]`**；注销入口与数据删除范围**无接口** → §12 备注 |
| `REQ-DELIVER-001` | 交付归档与导出（需鉴权） | `RT-VER-001`、`RT-SPEC-001` | OK | 下载包含源码 + `gradle wrapper` + 依赖锁定清单（**不含构建产物**） |
| `REQ-DELIVER-002` | 版本归档页（时间线/diff） | `RT-VER-001` | OK | 时间线倒序；`current` 用**文字标记**；diff 左右对照 + **变更行文字标识** |
| `REQ-DELIVER-003` | 整包回滚（全成或全不成） | `RT-VER-001` | OK | 二次确认 → **前端锁住整个项目写入口** → 成功/失败二选一呈现；失败**整体回退 UI** |
| `REQ-DELIVER-004` | 回环产物归档不物理删除 | `RT-VER-001`、`RT-SPEC-001` | OK | 回环后拉取最新 Spec 列表，**已归档版本可见**（不得从界面消失） |
| `REQ-TRACK-001` | 平台自身埋点：主流程漏斗 9 节点 | 全部漏斗节点页 | OK | **§10.1 逐节点给出埋码点**；事件名已按 `埋点-Spec` 定稿回填（全小写下划线）；`[拆解缺口-Q7]` |
| `REQ-TRACK-002` | 代码生成成功/失败与耗时事件 | `RT-EDIT-001`、`RT-PREVIEW-001` | OK | 终态回调处埋码，带结果与耗时；**L1 计入、L2 仅记录** |
| `REQ-TRACK-003` | 埋点上报批量 + 失败静默重试 | 全部 `RT-*` | OK | 批量队列 + 失败静默重试；**不阻塞业务、不阻塞离开页面**；上报体**不含 PRD 正文与生成代码** |
| `REQ-BASE-001` | 本期只做安卓、从新建项目开始 | 全部 13 条 `RT-*`（全局约束） | OK | 界面**不得出现** iOS / 跨平台 / 已有项目导入入口；生成器只产出安卓（XML + Kotlin） |
| `REQ-DESIGN-001` | 设计参考（UE 仅作交互/动效参考） | 全部 13 条 `RT-*`（动效节） | **Deferred** | `[拆解缺口-Q10]`：本轮 App 侧只能落「**无动效**」声明（§5 各页 + §9.4）；UE 参考物形态待 PM 明确 |

**覆盖统计**：`OK` **89 条** ｜ `N/A` **1 条**（`REQ-AUTH-007`，负向约束）｜ `Deferred` **1 条**（`REQ-DESIGN-001`）｜ `GAP` **0 条** —— **合计 91 条**，与 `需求条目表.md` **集合一致**（模块内行序按本 Spec 自定）。

> `GAP = 0` 的含义：App 侧**每个分配到的 REQ 都已落到具体路由/状态/元素/文案**。
> **数据链路缺口已全部闭合**（2026-10-21 · `S6.5 补口落地`）：补口接口 `#63`~`#68` 由草案转基线、新增 `#69`/`#70`（接口 **63 → 71**）、7 项字段级补口落地、App 侧 `[缺口-APP-01]`~`05` **全部销项**（见 §12.3 各行「状态」列）；`§12.1` 的 `Q3`/`Q5`/`Q6`/`Q8`/`Q2-附` 同批闭合。
> **本轮已刷新（2026-10-21）**：`§0` 红线第 2 条、`§4.1` ★ 图例、`§4.2`/`§5` 补口与字段级补口标记、`§4.3` 与文末自检的接口计数（69 → 71）、`§12.2` 缺口「状态」列均已按新基线同步。
> **本轮再次刷新（2026-10-21 · 登录方式 + 模型选择本机落地）**：`§1` 关联文档行与「接口引用」行（接口 **71 → 75**、元素 **412 → 419**）、`§1` 新增「本机落地扩展（★ 状态标注）」行、`§4` 引言规则 1/2、`§4.1` 三个 `MODEL-*`（`MODEL-AUTH-METHODS`/`MODEL-AUTH-PASSWORD`/`MODEL-LLM-MODEL`）与两个 `PARAM-*`（`PARAM-AUTH-CREDENTIAL`/`PARAM-LLM-MODEL`）、`§4.2.1` +5 行 / `§4.2.6` +1 行 / **新增 `§4.2.14`**（+1 行，**不计入页面数**）、`§4.3` 与文末自检的行数计数（**78 → 80 行 / 273 → 280 行**）、`§5.1` 账号密码登录路径、`§12.1` `Q9` 计数口径说明。**编号零重排**：`RT-*` 仍 **13 条**、`API-PLAT-*` / `EL-*` / `TC-*` **只增不改**。

---

## 12 待澄清清单

> **不自行裁决**。等级：`P0` = 定稿前必须闭合；`P1` = 影响实现细节；`P2` = 可并行。
> **本 Spec 新增的坑一律标 `[缺口-APP-##]` / `[待澄清-A##]`**，与上游编号**并列登记、不替代**。

### 12.1 既有缺口（来自 `拆解期发现的问题.md`，**原样带编号，不重复裁决**）

| 编号 | 问题 | 等级 | 影响路由/页面 | 建议方案 | 状态 |
|---|---|---|---|---|---|
| `[拆解缺口-Q2]` | 属性面板「11 项」计数口径：`§F14` 11 行 / `§8` 与 `页面规格§6.1` 12 名 / `数据模型 E7` 13 字段 | **P0** | `RT-EDIT-001` | 按项目约束 6 以 `§F14` 为准；**本 Spec 不写死清单** | **✅ 已闭合**（2026-10-21 · `P0-补口裁决单`） |
| `[拆解缺口-Q5]` | 项目卡片「元素 id 前缀示例」无接口来源 | **P0** | `RT-PROJ-001` | **已拍板：移除该展示项**（`页面规格 §1.1` 已移除；本 Spec `EL-PROJ-014` 行按「无数据需求」登记） | **已闭合**（2026-10-21） |
| `[拆解缺口-Q11]` | 预览态「只读」缺来源标签 | **P0** | `RT-PREVIEW-001`、`RT-WORK-001` | 补 `[来源: 推断，待确认]` 或确认其为正式条款 | **✅ 已闭合**（2026-10-21 · `P0-补口裁决单`） |
| `[拆解缺口-Q3]` | 门禁标准归属（项目级 vs 全局）与维护人 | P1 | `RT-REVIEW-001`、`RT-CAP-001` | **已拍板：项目级 + 管理员维护**（`E21` 增 `project_id`；`#24` 改项目作用域；需求方只读自己项目的当前标准） | **已闭合**（2026-10-21） |
| `[拆解缺口-Q4]` | 缺 `User` 实体 | P1 | `RT-PROJ-001`、`RT-AUTH-001`、`RT-VER-001` | 确认是否补 `E22 User`（`#66`★ 依赖） | **✅ 已闭合**（2026-10-21 · `P0-补口裁决单`） |
| `[拆解缺口-Q6]` | 自适应深度无字段/接口落点 | P1 | `RT-SPLIT-001`、`RT-REVIEW-001` | **已定：项目级落点** `E1 Project.depth`（enum{`minimal`,`standard`,`comprehensive`}，默认 `standard`）；`#16`/`#28` 请求体**已可带可选 `depth`** → 提交时**传当前档位** | **已闭合**（2026-10-21） |
| `[拆解缺口-Q8]` | `AC-ED-18` / `AC-ED-19` 编号复用 | P1 | `RT-PREVIEW-001`、`RT-WORK-001` | **已授权重编**：第二组改为 `AC-ED-21`/`AC-ED-22`，行序重排 18→19→20→21→22；`18`/`19` 保留给「取消」语义 | **已闭合**（2026-10-21） |
| `[拆解缺口-Q12]` | 埋点在串行链条中的位置三处不同 | P1 | `RT-SPEC-001` | 统一表述（本 Spec 按 `§6` + `AC-SC-01` 取 5 顺序） | **✅ 已闭合**（2026-10-21 · `P0-补口裁决单`） |
| `[拆解缺口-Q13]` | 画布 / 接口管理 / 能力配置写接口未标 `If-Match` | P1 | `RT-EDIT-001`、`RT-API-001`、`RT-CAP-001` | 补乐观锁标注（`D-Q14` 要求覆盖三处） | **✅ 已闭合**（2026-10-21 · `P0-补口裁决单`） |
| `[拆解缺口-Q2-附]` | 「43 项评分卡」写死，与可维护标准冲突 | P1 | `RT-REVIEW-001` | **已裁定**：`AC-RV-01` 改为「按当前 `standard_version` 的全部检查项（T0 默认 43 项）」；新增实体 `E23 ReviewItem`（含 `evidence_ref`） | **已闭合**（2026-10-21） |
| `[拆解缺口-Q10]` | `§F15` 无可验收内容 | P2 | 全部路由（动效节） | 明确产出物或确认仅作设计态参考 | **✅ 已闭合**（2026-10-21 · `P0-补口裁决单`） |
| `[拆解缺口-Q7]` | 平台自身埋点无实体承载（含埋点数据保留期与清理口径） | P2 | `RT-SPLIT-001` + §10 全节 | 确认是否新增埋点事件实体 | **✅ 已闭合**（2026-10-21 · `P0-补口裁决单`） |
| `[拆解缺口-Q9]` | 接口总数 62 vs 63 | P2 | 不影响页面 | 统一为 **71**（`#1`~`#70`+`#44a`）；**2026-10-21 本机落地 4 个后，本 Spec 的引用口径为 75**（`接口-Spec §5.4.13`）——**两者差异是有意保留**（第 4 轮基线仍记 71），**不是漏改** | **✅ 已闭合**（2026-10-21 · `P0-补口裁决单`） |
| `[拆解缺口-Q14]` | `E4` / `E16` 编号呈现不一致 | P2 | 无（仅编号） | 可不处理 | **✅ 已闭合**（2026-10-21 · `P0-补口裁决单`） |

### 12.2 上游 Spec 的缺口与冲突（引用，**逐条给 App 侧影响与兜底**）

| 编号 | 问题 | 等级 | 影响路由/页面 | **App 侧的兜底做法** | 状态 |
|---|---|---|---|---|---|
| `[缺口-UI-01]` / `[缺口-API-01]` | **飞书扫码登录无接口**（含 `E22 User` 缺失）→ `#63`/`#64`/`#65`/`#66`（**已转基线**） | **P0** | `RT-AUTH-001`、`RT-PROJ-001`、`RT-WORK-001` | **✅ 已闭合**（2026-10-21）：补口 `#63`~`#66` 与 `E22 User` 均已转基线，登录链路按正向实现 | **已闭合** |
| `[缺口-UI-02]` / `[缺口-API-02]` | 待澄清问题「影响范围」无字段（`#19` / `E18` 均无 `impact`） | P1 | `RT-REVIEW-001` | **✅ 已闭合**：`#19` 出参 + `E18` 已增 `impact`，正常显示 | 已闭合 |
| `[缺口-UI-03]` / `[缺口-API-03]` | 「回流轮次 第 {n}/3 轮」 | P1 | `RT-REVIEW-001` | **✅ 已闭合**：`#6` 出参已增 `loopback_round`，正常显示 | 已闭合 |
| `[缺口-UI-04]` / `[缺口-API-04]` | 需求追溯矩阵无接口 → `#67`★ | **P0** | `RT-SPEC-001`、`RT-SPLIT-001` | **✅ 已闭合**：`#67` 已转基线，抽屉入口正常可用 | 已闭合 |
| `[缺口-UI-05]` / `[缺口-API-05]` | 能力依赖冲突无返回结构 → `#58` 的 `conflicts[]`★ | P1 | `RT-CAP-001` | **✅ 已闭合**：`#58` 出参已增 `conflicts[]`/`alignment_table[]`，该区正常渲染 | 已闭合 |
| `[缺口-UI-06]` / `[缺口-API-06]` | 外发大模型用户级开关 | **P0 合规** | `RT-CAP-001`、`RT-UPLOAD-001`、`RT-EDIT-001`、`RT-WORK-001` | **✅ 已闭合**：`#68` 已转基线，开关正常渲染；告知弹窗仍按 `UI-Spec §7.1` 可用 | 已闭合 |
| `[缺口-API-07]` | `E10 ProjectVersion` 缺 `created_by`/`summary`/`artifacts`，`#54` 未定义 | P1 | `RT-VER-001` | **✅ 已闭合**：`E10` 已增三字段、`#54` 出参同步 | 已闭合 |
| `[缺口-UI-07]` | 全局组件的 `EL` 归属约定（`GLOBAL` 段）PRD 未定义 | P2 | 全部路由 | 本 Spec **沿用 `UI-Spec §1.2` 的 `GLOBAL` 约定**（**5 个**真跨页共用组件（`CMP-001`~`004` + `CMP-017`〔2026-10-21 新增〕）） | 待 PM |
| `[缺口-UI-08]` | 暗色模式 / 字号 / 间距栅格 PRD 未定义 | P2 | 全部路由 | 按 `UI-Spec §3` 的建议值实现并**声明为建议值**；**不承诺暗色为交付项** | 待 PM |
| `[缺口-UI-09]` | 拖拽的键盘替代键位未定义 | P1 | `RT-EDIT-001` | 按 `UI-Spec §3.7` 的键位建议实现（`Tab`→`Enter`→`方向键`），**标注为建议值** | 待 PM |
| `[缺口-UI-10]` | 工作台 < 1280px 布局未定义（**对话已改为悬浮层、不再占栏** → 只剩左栏是否折叠的问题）| P1 | `RT-WORK-001` | 本 Spec 按**左栏折叠为抽屉**实现（`[来源: 推断，待确认]`） | 待 PM |
| `[缺口-UI-11]` | 输入框抖动（240ms）与「未定义处按无动效」冲突 | P1 | `RT-WORK-001` | 本 Spec **暂按 240ms 抖动实现并显式声明**（§5.4） | 待 PM |
| `[缺口-UI-12]` | 元素 id 序号超 999 的扩展形式未给样例 | P2 | `RT-EDIT-001` | 建议 `EL-HOME-1000`；实现按**不假设位数**处理（比较一律归一化） | 待 PM |
| `[冲突-UI-01]` | `UI-需求包 §一` 把对话栏写作 `UI-CHAT-001`，页面清单无此页 | P1 | `RT-WORK-001` | 本 Spec 按**页面清单**处理（右栏归 `UI-WORK-001`），保持 13 页与 `RT-*` 一一映射 | 待确认 |
| **`[冲突-UI-02]`** | ★ `UI-需求包` 为 `REQ-REVIEW-005` 指定「**门禁标准配置页**」，但 13 页清单中无此页 | **P0** | `RT-REVIEW-001` | **本 Spec 按 UI Spec 现状（13 页）处理**：落为 `RT-REVIEW-001` 的 `?drawer=gate-standard` **区域锚点**（§3 注 2）。**若 PM 改为独立成页 → 页面数 14，本 Spec 路由表须 +1 行**（`RT-REVIEW-002` `/projects/{project_id}/gate-standard` ↔ 新 `UI-REVIEW-002`，状态容器 `STORE-REVIEW-STD`），其余章节按此顺延 | **待 PM（不自行裁决）** |
| `[冲突-UI-03]` | revision 历史展示落点：上传页 + 知识库页两处 | P2 | `RT-UPLOAD-001`、`RT-KB-001` | **保留两处**（上传页看本次、知识库看全量），两处均复用 `API-PLAT-013` | 待 PM |
| `[冲突-UI-04]` | 每页条数：`页面规格§1.1` 写 20/50，`REQ-NF-004` 写 20/50/100 | P1 | `RT-PROJ-001`、`RT-API-001` | **取 `REQ-NF-004` 的 20/50/100** | 待 PM |
| `[冲突-UI-05]` | `REQ-SPLIT-004`、`REQ-CAP-005` 的 UI 落点与 `需求条目表` 角色列不一致 | P1 | `RT-SPLIT-001`、`RT-CAP-001` | **保留 UI 展示点**并标 `OK`（§11） | 待 PM |
| `[待澄清-错误码口径]` | `数据模型 §5.4` 有 14 行（多 `PARSE_PARTIAL`），`接口契约 §0.5` 的 13 个错误码不含它 | P2 | 全部路由 | 本 Spec 采「**13 个错误码 + 1 个非错误标记 `PARSE_PARTIAL`（HTTP 200）**」（§6.3） | 待 PM |
| `[待澄清-SSE-AUTH]` | SSE 经 `EventSource` **不能自定义头** → 需 `Cookie` 会话或 `query` 令牌 | P1 | `RT-WORK-001`、`RT-PREVIEW-001`、`RT-EDIT-001` | 本 Spec **不自行拍板**；**本地不得写依赖该方案的凭据**（§7） | 待 PM |

### 12.3 本 Spec 新发现（**App 角色发现，未自行裁决**）

| 编号 | 问题 | 等级 | 影响路由/页面 | 建议方案 | 状态 |
|---|---|---|---|---|---|
| **`[缺口-APP-01]`** | ★ **上传链缺一环**：`#10`（文件上传）出参只有 `file_id`/`size_bytes`/`status`/`reject_reason`，而 `#12`（触发解析）的路径参数是 **`document_id`**；`#11`（`POST /documents`）只覆盖**飞书链接**路径。**文件路径的 `file_id → document_id` 转换接口在补口前基线（69 接口）中不存在**（现已由 `#10` 出参 `document_id` 闭环）（`UI-Spec §5` 亦未登记该数据需求） | **P0** | `RT-UPLOAD-001` | 二选一：① `#10` 出参增 `document_id`；② 补「按 `file_id` 建立 `Document`」的接口。→ **采纳方案①：`#10` 出参已增 `document_id`**（上传文件路径闭环） | **已闭合**（2026-10-21 · `P0-补口裁决单`） |
| **`[缺口-APP-02]`** | `#44` 出参口径不一致：`接口-Spec §3.2` 有 **3 行**（`EL-EDIT-042`、`EL-PREVIEW-014`、`EL-VER-028`）以「`#44` 的 `data.l2_result.reported`」为来源，但 `§5.1.2` 的 `#44` 出参表**未列 `l2_result`**（只列 `task_id/type/status/progress/seq/result_ref/error_code/started_at/finished_at`） | P1 | `RT-EDIT-001`、`RT-PREVIEW-001`、`RT-VER-001` | 二选一：① `#44` 出参增 `l2_result{reported,passed,log_digest}`；② 三处「未验证构建」标记改由 `#46` 单独取。→ **采纳方案①：`#44` 出参已增 `l2_result{reported,passed,log_digest}`**（`EL-EDIT-042`/`EL-PREVIEW-014`/`EL-VER-028` 三处来源均为基线） | **已闭合**（2026-10-21 · `P0-补口裁决单`） |
| **`[缺口-APP-03]`** | `EL-REVIEW-027`「导出审核报告」在 `UI-Spec §4.6` 有交互规则与 Toast 文案（「审核报告已导出」），但 `UI-Spec §5` **未登记其数据需求**、`接口-Spec` **无审核报告导出接口**（`#33` 是 **Spec** 导出，不是审核报告） | P1 | `RT-REVIEW-001` | 二选一：① 补「审核报告导出」接口（需鉴权、不含密钥）；② 从 UI 移除该按钮。→ **采纳方案①：新增接口 `#69 GET /projects/{project_id}/reviews/{review_id}/export`**（需鉴权、不含密钥），`EL-REVIEW-027` **正常可用** | **已闭合**（2026-10-21 · `P0-补口裁决单`） |
| **`[缺口-APP-04]`** | `EL-REVIEW-037` 超限二选一的「**中止（归档并终止本流程）**」**无接口落点**（`#28` 只覆盖「重新拆解」；`Project.stage` 有 `gate_passed → [*] 中止（记录并归档）` 的迁移，但无对应接口） | P1 | `RT-REVIEW-001` | 补「中止流程」接口，或在 `#28` 上增加中止语义。→ **已补接口 `#70 POST /projects/{project_id}/abort`**（归档并终止本流程）；「中止」**正常可用**（`⬛` 二次确认，服务端亦校验） | **已闭合**（2026-10-21 · `P0-补口裁决单`） |
| **`[缺口-APP-05]`** | **「离线」页态在 `UI-Spec` 中未逐页定义**：`UI-Spec §4.x ⑥ 状态` 只有 `加载中/空/错误/403` 等；`EL-WORK-024`「连接已断开，正在重连…」只覆盖 SSE 断线。本 Spec §5 的「离线」行为与**顶栏复用样式**属 App 侧统一推断 | P1 | 全部 13 条 `RT-*` | **已闭合**（2026-10-21）：**采纳 App 侧统一推断** —— ① 「离线」沿用 `EL-WORK-024` 的文案口径（「连接已断开，正在重连…」）；② 全局顶栏使用 `CMP-005` 样式；UI 侧已确认，逐页「⑥ 状态」同步补「离线」行 | **已闭合**（2026-10-21） |
| `[待澄清-A01]` | 生成到安卓工程的 **`minSdkVersion` / `targetSdkVersion`** PRD 未给 | P1 | 附节 A（生成产物） | 明确最低安卓版本与目标版本；未定前生成工程**不写死版本号**或写占位 | 待 PM |
| `[待澄清-A02]` | 平台自身 App 的**前端框架/技术栈** PRD 未指定 | P1 | 全部路由 | 本 Spec 只冻结**形态约束**（SPA + 单 SSE + 本地草稿栈 + 自研渲染器）；框架选择需 PM/技术负责人定 | 待 PM |
| `[待澄清-A03]` | 是否需要**对外深链接**（如「把项目链接发给同事直接打开」）PRD 未定义 | P2 | 全部项目级路由 | 本期**只做端内跳转**；若要深链接需补：URL 方案 + 鉴权 + 越权兜底（403 不泄露存在性） | 待 PM |
| `[待澄清-A04]` | 权限撤销 ≤5min 生效的**前端重校验周期**未定（本 Spec 暂用 60s） | P1 | `RT-EDIT-001`、`RT-KB-001`、`RT-API-001`、`RT-CAP-001` | 确认周期与实现方式（定时重校验 vs 纯 403 兜底） | 待 PM |
| `[待澄清-A05]` | **缓存过期与加密策略**：项目列表缓存过期（本 Spec 暂定 5min）、对话缓存条数 `N`、**画布草稿是否加密**（含用户未提交内容，可能含业务信息） | P2 | 全部路由 | 由安全与 PM 共同确认；**当前实现：草稿明文存本地但绝不入上报/日志/URL** | 待 PM/安全 |
| `[待澄清-A06]` | **前端错误上报通道**未定义（PRD 只定义了埋点上报 `#62`，未定义错误/崩溃上报） | P2 | 全部路由 | 明确通道与脱敏口径；**未定前只走 `#62` 可承载的最小事件 + 本地控制台** | 待 PM |

**等级汇总（按行计）**：`P0` **8 行**（`[拆解缺口-Q2]`、`[拆解缺口-Q5]`、`[拆解缺口-Q11]`、`[缺口-UI-01]`/`[缺口-API-01]`、`[缺口-UI-04]`/`[缺口-API-04]`、`[缺口-UI-06]`/`[缺口-API-06]`〔P0 合规〕、`[冲突-UI-02]`、`[缺口-APP-01]`）｜
`P1` **25 行** ｜ `P2` **12 行** —— **合计 45 行**（`§12.1` 既有 14 + `§12.2` 上游 20 + `§12.3` 本 Spec 新增 11）。
> **按编号计 51 个**：`§12.2` 有 6 行是 `[缺口-UI-xx]` / `[缺口-API-xx]` **成对合并登记**（同一事实的 UI 侧与接口侧编号），故行数少于编号数。
> **2026-10-21 · S6.5 补口落地**：**数据链路缺口已全部闭合** —— 补口接口 `#63`~`#68` 转基线 + 新增 `#69`/`#70`（**63 → 71**）、7 项字段级补口落地、**App 侧 `[缺口-APP-01]`~`05` 全部销项**；`§12.1` 的 `Q3`/`Q5`/`Q6`/`Q8`/`Q2-附` 已闭合。仍为 `待 PM` 的行属**口径/规范类**（`§12.1` 其余 `Q#`、`§12.2` 的 `[缺口-UI-07]`~`12` 与 `[冲突-UI-0*]`、`[待澄清-*]`）。

> **不自行裁决**：本 Spec 对以上每一条**只给 App 侧兜底做法**（禁用 + 原因 / 该行不显示 / 沿用上游建议值并标注），**未替 PM 或接口角色做任何决定**。

---


### B9 版本与路由边界（2026-10-26）

- 当前 PRD 查看：#17 prd 指向项目当前 revision 文档（可能不同于报告顶层 revision_id），#8 回读知识库正文。EL-REVIEW-055~059 完整承载入口、Drawer、元信息、深链与正文。
- 写回门禁：`canWrite = !writing && !deciding && !loading && !superseded && !unsetAssumptions && !blockingUnanswered && !documentError`；EL14/EL52与确认写入共用；EL52零勾选且无规范化非空答复才额外禁用，0项可只写答复。
- 精确深链 `/projects/{project_id}/kb?sector=prd&doc={kb_doc_id}`；KbPage 从 #7 列表匹配 doc 后 #8 自动开详情，`fetchKbDoc.document_id` 存入 `openDoc`。历史仅 PRD 且当前 `openDoc.document_id` 非空时以该 document_id 调 #13，effect 随 sector/document_id 切换；无ID清空历史，不再固定示例文档。
- 原始上传文件/旧 revision 快照只读；知识库当前版本可编辑；#23 changed 时经 materializeEditedRevision 产生新 revision，旧报告 superseded，#9 同为当前正文编辑链，不能指向旧上传文件证明写回。
- 手动提交 disabled：`!reviewId || !!documentError || busy || blockingOpen>0 || unset>0 || dirty || !revisionChanged`；busy为writing/deciding/loading，dirty比较规范化答案/trim补充与已加载值，fail评分项本身不禁用。初次 loadAll 在 GET #17 → GET #8 后比对 `doc.version === prd.version` 与 `doc.content_hash === prd.content_hash`；读取/核验失败清 savedPrd 并置 documentError。`canSubmit` 与 `canWrite` 均要求 `!documentError`；superseded 提示的“重新审核” `disabled=!canSubmit`，独立 `phase=stale` 入口 `disabled=writing || deciding || !!documentError`。核验失败不得从上述手动入口绕过；EL60仍为原五类条件原因，文档错误由已有 EL62 呈现，不新增控件/原因文案。
- 本轮新增 8 个 EL；§4.2 实际展开 **295（页面元素供给294+外壳1）**；同步前旧表实测287（旧声明286少计外壳或一行，历史不改），对齐 UI §5 两组新增后84行。计数仅为文档覆盖，不代表实机验收通过。
## 13 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|---|---|---|---|
| v0.1 | 2026-10-20 | 初稿。以 `platform/design/页面规格.md` + `数据模型.md` 为底稿做**格式转换 + 一致性对齐 + 缺口补齐**：路由表 **13 条**（与 `UI-Spec §2` 的 13 个 `UI-ID` 一一映射，含 `[冲突-UI-02]` 的处置说明）、§4《UI ↔ 接口对应关系表》**273 行**（覆盖 `UI-Spec §5` 全部 **78 行**数据需求所涉 `EL-*`，**无空白格**）、§5 页面详细设计 **13 节 ×（状态管理 + 接口调用 + 五种状态 + 跳转 + 待澄清）**、§6~§9（网络层 / 缓存 / 权限 / 异常降级）、§10 埋点埋码点 **25 行**（9 节点漏斗 + 4 合规 + 12 旁路/任务/审核事件，已按 `埋点-Spec` 附节 A 回填正式事件名）、**附节 A** 生成到安卓工程侧 **7 条**实现约束、§11 需求追溯 **91 行**（GAP 0）、§12 待澄清 **45 行**（既有 14 + 上游 20 + 本 Spec 新增 11，按编号计 51 个） | App 角色（S5） |
| v0.1.1 | 2026-10-21 | **S6.5 补口落地重同步**（按 `platform/decisions/P0-补口裁决单.md` + 更新后的 `platform/design/`）：**销项 App 侧 5 条缺口** —— `[缺口-APP-01]`（`#10` 出参增 `document_id`，上传链闭环）、`[缺口-APP-02]`（`#44` 出参增 `l2_result{reported,passed,log_digest}`）、`[缺口-APP-03]`（新增接口 `#69`，导出审核报告**正常可用**）、`[缺口-APP-04]`（新增接口 `#70`，超限「中止」**正常可用**）、`[缺口-APP-05]`（**采纳 App 侧统一推断**：离线沿用 `EL-WORK-024` 文案 + 顶栏 `CMP-005`）；同批：`接口-Spec` 计数 **69 → 71**、`[拆解缺口-Q3/Q5/Q6/Q8/Q2-附]` 标「已闭合」、`§12` 汇总口径改为「**数据链路缺口已全部闭合**」。**编号零重排**：路由表仍 **13 条** `RT-*`、五态仍 **13 页 × 5 态**、`§4.2` 仍 **273 行** | App 角色（S6.5） |
| v0.2 | 2026-10-21 | **登录方式 + 模型选择本机落地重同步**（跟随 `接口-Spec §5.4.13` 与 `UI-Spec` 的同批新增）。① **§4.1** 新增 3 个 `MODEL-*`（`MODEL-AUTH-METHODS` ← `#72a`、`MODEL-AUTH-PASSWORD` ← `#72`、`MODEL-LLM-MODEL` ← `#71`/`#71a`）与 2 个 `PARAM-*`（`PARAM-AUTH-CREDENTIAL`、`PARAM-LLM-MODEL`）；`MODEL-REVIEW` 增字段 `model`。② **§4.2 新增 7 行逐元素行**（`EL-AUTH-017`/`018`/`019`/`020`/`021` 各 1 行 → §4.2.1；`EL-REVIEW-051` → §4.2.6；`EL-GLOBAL-009` → **新增 §4.2.14「应用外壳」**，显式声明**不是第 14 个页面**），**无空白格**：登录方式默认段**由 `#72a` 决定**、`EL-REVIEW-051` 的 `model` 为空**整块不渲染**、`EL-GLOBAL-009` 目录为空**整块不渲染**、失败处理逐条按 `UI-Spec` 逐字文案（「用户名或密码不正确。」「登录没成功，请重试。」）。③ **§5.1** 补「账号密码登录路径」专块（触发 / 请求 / 成功 / 失败 / 与飞书扫码的切换关系 / 本地存储）+ 2 行接口调用 + 5 个状态字段 + 五态「错误」行分支，并修正 `#63` 的触发时机（**切到飞书才拉，避免白轮询**）。④ **计数同步**：接口 **71 → 75**、元素 **412 → 419**、`UI-Spec §5` **78 → 80 行**、本表展开 **273 → 280 行**。⑤ **变更理由**：把「登录方式（账号密码）」与「模型选择（评分卡所用模型 + 顶栏选择器）」两条已被 UI/接口先行落地的新链路，在同一份表里与 `API-PLAT-*` 对齐，避免端到端联调时出现「UI 有、接口有、App 无」的断点；模型标签的必要性在于**门禁结论随模型而变**（`reviews/B5-真实上游接入验收记录.md §9`），不记录则不可审计。⑥ **状态**：`#71`/`#71a`/`#72`/`#72a` 4 个接口与 `EL-AUTH-017`~`021`/`EL-REVIEW-051`/`EL-GLOBAL-009` **这 7 个元素**均为**本机开发阶段扩展，未过门禁、未进入第 4 轮基线冻结范围**（第 4 轮基线仍记 71 接口 / 412 元素）；其中 `API-PLAT-072`（`#72`）为**阶段性本地登录**，**生产必须关闭**（`AD_PASSWORD_LOGIN=disabled`）。**编号零重排**：`RT-*` 仍 13 条、`API-PLAT-*`/`EL-*` 只增不改、既有行全部保留 | App 角色（本机落地重同步） |
| **v0.2.1** | **2026-10-22** | **「语义核对 S5 销项」**（依据 `reviews/A2-语义核对报告-20261021.md`）：`MODEL-KB-DOC-LIST` 的 `items[].doc_type` **改 `items[].sector`**（与实现、`数据模型`、`接口-Spec` 对齐）；`#5` 调用行补 `body {confirm:true}`（`⬛` 服务端亦校验）。**编号零重排** | App 角色（语义核对销项） |
| **v0.2.3** | **2026-10-22** | **「对话框全局悬浮化 + 主体对象 + AI 处理过程」**：① §4.2.4 增载体变更注（`EL-WORK-013`~`023` 改由**全局悬浮对话框**承载，**元素 id 与计数均不变**）；② 对话调用行**宿主路由随页面变化**（`page_rt` 取实际路由）；`#25`/`#26` 带 `subject_type`/`subject_id` → **会话按主体分线程**；③ 新增「**AI 处理过程**」区块（`ai.step`，观察面、服务端补发）；④ **编号零重排**、§10 埋码点行数不变 | App 角色（对话框全局化） |
| **v0.2.4** | **2026-10-22** | **「对话框线程口径修正」**（PM 复核 v0.2.3 后明确）：① §4.2.4 的载体注修正为 **对象 = Project / 线程 = 项目内子步骤 / 默认打开 / 项目列表页不显示 / 可切回**；② 对话调用行的线程参数由 `subject_type`/`subject_id` 改为 **`thread`**；③ 「AI 处理过程」按**项目**（不按线程）；④ **编号零重排**、§10 埋码点行数不变 | App 角色（线程口径修正） |
| **v0.2.5** | **2026-10-22** | **「§4 收口 + 字段名修正」**（依据 `reviews/五份Spec一致性校对报告.md §⑲` 的 B2/B4/B7）：① §4.2.4 新增 3 行（`EL-WORK-031/032/034` 纯前端视图态、`EL-WORK-033` ← `#25`、`EL-WORK-035` ← SSE `ai.step`），**展开 280 → 283 行**（逐元素 279 → 282，应用外壳行 1 不变）、覆盖 `UI-Spec §5` 的 **82/82 行**；② `MODEL-CHAT-MESSAGE` 补 **`thread_key`**（含 `#25` 调用行与 SSE 行的字段列表）；③ **`MODEL-TRACK-EVENT` 的 `event_key` → `event_name`**（`埋点-Spec §5` 字段名逐字固定）；④ 计数：`EL-*` **419 → 424**；⑤ **未重排任何编号** | App 角色（收口） |
| **v0.2.5a** | **2026-10-22** | **「第 5 轮一致性校对销项」**：① `MODEL-CHAT-MESSAGE` 补 **`thread_key`**、`#25` 调用行补 **`data.thread`**；② `MODEL-TRACK-EVENT` 的 `event_key` → **`event_name`**；③ §4.2.4 新增 3 行（`EL-WORK-031/032/034` 视图态、`033` ← `#25`、`035` ← SSE `ai.step`），展开 **280 → 283 行**（逐元素 282 + 应用外壳 1）；④ §5.4 五态补「空数据（该步骤无线程）」并逐字对齐新文案；⑤ §12.2 缺口表补「状态」格；⑥ 计数：`EL-*` **419 → 424**、§1 关联文档用例 **580 → 592** | App 角色（第 5 轮销项） |
| **v0.2.6** | **2026-10-22** | **「Spec↔实现核对（B6）销项」**：`MODEL-CHAT-MESSAGE` 与 `#25` 调用行、SSE 两行的**对话正文键 `content_md` → `content`**（与实现/前端一致；知识库 `MODEL-KB-DOC`、Spec `MODEL-SPEC-DOC` 的 `content_md` **不变**）。**编号零重排、计数不变** | App 角色（B6 销项） |
| **v0.2.7** | **2026-10-22** | **「`#16` 复用语义 + `EVT_edit_event_config` 改挂草稿保存 随动」**（PM 裁决）：① §4 审核页调用表**新增「页面进入（已有报告）」行** —— 进页 `API-PLAT-016` **不带 `force`**、`reused=true` + `task_id=null` → 直接用已有报告（**不新建、不作废、不调模型**），`gate.verdict="unreviewed"` 走「尚未审核」空态（**不发 `#16`**）；② 评分卡行拆为「页面进入」与「审核任务终态」两行；③ 「提交复审」行显式标 **`force:true`**，并注明**「提交复审 / 重新审核 / 重试」三个入口必须显式 `force:true`**（否则被服务端复用而不重跑）；④ `EL-REVIEW-039` 行注明点「开始审核」时带 `force:true`（用户主动开审）；⑤ §10.4 的 `EVT_edit_event_config` 埋码点由 `#40` 改挂 **`#42` 草稿保存成功回调**；⑥ §1 关联文档用例数 **592 → 595**；⑦ **编号零重排、`EL-*` 424 与接口 75 均不变** | App 角色（PM 裁决落地） |
| **v0.2.8** | **2026-10-22** | **「评分卡归属三态收口（D-1 残余）」**（PM 裁决「开一轮」）：① **§4「页面进入」行改为「三态判定」** —— ①`gate.verdict="unreviewed"` → 空态；②`gate.review_revision_id ≠ current_revision_id` → 已过期；③其余 → `#16` 不带 `force`（复用）；**判定顺序不可换**；② `EL-REVIEW-033`/`034` 行的触发条件由「`superseded = true`（`#17`）」改为「`#6` 的 `gate.review_revision_id ≠ data.current_revision_id`」，并注明**进页只提示、不自动开审**，点「重新审核」带 **`force:true`**；③ §5 五态表的「空数据」行由两态扩为**三态**（未审核 / 已过期 / 待澄清 0 条）并补点击后的 `force` 口径；④ `MODEL-PROJECT-STATS` 补 **`current_revision_id`** 与 **`gate.review_revision_id`**；⑤ §1 关联文档用例数 **595 → 599**；⑥ **编号零重排、`EL-*` 424 与接口 75 均不变** | App 角色（D-1 残余收口） |
| **v0.2.9** | **2026-10-22** | **「对话：agent 处理过程与消息共用一个列表（PM 口径）」**：① §4.2.4 逐元素表 `EL-WORK-035` 行 —— 落点由「步骤列表」改为「**对话时间线里的步骤条目**」，补「步骤**与消息按时间混排在同一条列表**」「**`at` 为首次发生时刻**，不刷新」「无步骤 → **不出现条目**」；② §4.2.4 载体变更注同句改写（原「新增『AI 处理过程』区块」→「**与消息共用一个列表**」）；③ 对齐 `UI-Spec v0.1.10` / `接口-Spec v0.12`；④ **编号零重排；`EL-*` 424、§4.2.4 展开行数 283、接口 75、`§10.4` 埋码点行数均不变** | App 角色（PM 口径 · 过程与消息共列） |
| **v0.2.10** | **2026-10-22** | **「第 9 轮一致性校对（`§㉕`）销项」**：① §1 关联文档 `测试-Spec` 用例数 **599 → 600**（A8 批 599→600 时同步了 `测试-Spec`/`baseline` 三处，**唯漏本 Spec §1**；见 `reviews/五份Spec一致性校对报告.md §㉕` 的 `F1`）；② §13 附·自检第 6 条埋码点行数「**27 行**」→「**54 行**」（= §10.1 **27 行** + §10.4 **27 行**，与 §10 前言及 `埋点-Spec` 附节 C **54 条**一致；见 `§㉕` 的 `F4`）。**编号零重排；`EL-*` 424、接口 75、§4.2.4 展开 283 行、用例 600 均不变** | App 角色（第 9 轮销项） |
| **v0.2.12** | **2026-10-23** | **「审核页写回入口补 `EL-REVIEW-052`（PM 拍板『加』）」**：① §4.2 逐元素对应表新增 `EL-REVIEW-052` 行（**无接口调用**、不调 `#22`；`accepted = ∅` → 禁用；前置拦截同 `EL-REVIEW-014`；写回仍走 `EL-REVIEW-031`/`#23` 且带 `accepted_items`）；② **§5.6 审核页接口调用表**（旧称「§4 数据供给表」）新增「写回已勾选（{n} 项）」行；③ §1 关联文档 `UI-Spec` `EL-*` **424 → 425**。**编号零重排；接口 75、用例 600、§10 埋码点行数均不变；§4.2 展开行数 283 → 284（逐元素 282 → 283 + 应用外壳 1），§1/§3/§13 三处声明同批随动** | App 角色（PM 拍板 · 补子集写回入口） |
| **v0.2.13** | **2026-10-26** | **「审核页『未通过项 · 补充信息』`EL-REVIEW-053`」（PM 口径「按建议口径」）**：① §4.2 逐元素对应表新增 `EL-REVIEW-053` 行（**无独立接口** —— 回显 `#18` 的 `supplement`、写入随 `#23` 的 `supplements[]`；**仅「结论 = 未通过」的行渲染**；回写前本地态）；② `MODEL-REVIEW-ITEM` 补 **`supplement`**；③ §4.2 `EL-REVIEW-028~032` 行（点「确认写入」）与 **§5.6 回写 PRD 行**参数补 **`supplements[]`**（仅随 `accepted_items` 内条目写入，非该评分卡 / 未 Accept / 空白一律忽略）；④ `EL-REVIEW-013` 勾选行补「**有完善建议或有补充信息**才可勾选」；⑤ §1 关联文档 `UI-Spec` `EL-*` **425 → 426**。**编号零重排；接口 75、用例 600、§10 埋码点行数均不变；§4.2 展开行数 284 → 285（逐元素 283 → 284 + 应用外壳 1），§1/§3/§13 三处声明同批随动** | App 角色（PM 口径 · 未通过项补充信息） |
| **v0.2.14** | **2026-10-26** | **「审核流程优化：一次收敛」（PM 口径「按推荐口径」）**：① §4.2 逐元素表新增 **`EL-REVIEW-054`** 行（**无接口调用**，**设备级**界面偏好 `localStorage['ad.v1.device.reviewAuto']`，§7 同批登记 + 新增 `device` scope）；② `EL-REVIEW-053` 行改为**按检查项标题落章**（只勾选没填的不落章）；③ `EL-REVIEW-028~032` 行与 **§5.6 回写 PRD 行**补 `data.sections_added[]`；④ **§5.6 新增两行** ——「**写回后自动重审**」（`#16` `force:true` + 前端标记 `silent`）与「**进页自动开审**」（同），**均不报 `EVT_review_submit`**（`silent` **不是 `#16` 入参**，见该两行口径）；⑤ §1 关联文档 `UI-Spec` `EL-*` **426 → 427**。**编号零重排；接口 75、用例 600、§10 埋码点行数均不变；§4.2 展开行数 285 → 286（逐元素 284 → 285 + 应用外壳 1），§1/§3/§13 三处声明同批随动** | App 角色（PM 口径 · 审核流程优化） |
| **v0.2.11** | **2026-10-23** | **「审核页写回入口与前置拦截（PM 拍板：入口走 A + 前置拦截按 B 只跳转）」**：① §4.2 逐元素对应表 `EL-REVIEW-013`/`014` 行 —— 写回入口改为**底部操作条**的「一键采纳全部建议」（**唯一入口**），完成后**立即弹** `EL-REVIEW-028`；补**前置拦截**（有 `unset` 假设 → **不发 `#22`、不弹窗**，提示 + **滚动定位并高亮** `EL-REVIEW-025` 第一条未选）；② **§5.6 审核页接口调用表**（旧称「§4 数据供给表」）`假设清单` 行补「写回入口前置拦截」（与「`进入需求拆解` 禁用」并列，统一文案）；③ 同表 `一键采纳` 行同步（**无 `unset` 时才发 `#22`**）。**编号零重排；`EL-*` 424、接口 75、§4.2.4 展开 283 行、用例 600、§10 埋码点行数均不变** | App 角色（PM 拍板 · 入口 A + 前置拦截 B） |
| **v0.2.2** | **2026-10-22** | **「埋码点补齐至 54」**（依据 PM 裁定：`埋点-Spec §3` 定义 54 条事件、`测试-Spec §6` 逐条覆盖 108 条 → **把 §10 补到 54，而非收窄测试覆盖**）：① 新增 **§10.4「其余 27 条事件的埋码点」**，按 `埋点-Spec §3` 的分节排列（3.1 账号与会话 / 3.2 项目与激活 / 3.3 上传与解析 / 3.4 门禁审核 / 3.5 拆解与 Spec / 3.6 对话 / 3.7 编辑与生成 / 3.8 预览与验证 / 3.9 交付与版本 / 3.10 能力配置 / 3.11 合规 / 3.13 模型选择），列结构**与 §10.1 完全一致**（事件名 / 所在页面 / 元素 ID / 埋码位置 / 触发时机 / 依赖参数来源），内容**逐条照录** `埋点-Spec`（页面、元素、埋码点、参数、上报时机、去重规则）；② **§10 前言口径 27 → 54**（§10.1 27 + §10.4 27）；③ **`§10.1` 的 27 行原文未改**（编号与措辞零重排）；④ 新增的 27 条为：`EVT_auth_scan_success`/`_login_failed`/`_session_expired`/`_logout`、`EVT_proj_open_workbench`/`EVT_proj_deleted`、`EVT_upload_entry_click`/`_start`/`_part_manual_supplement`、`EVT_review_submit_blocked`/`_standard_saved`/`_loopback_exceeded`、`EVT_split_start`/`_failed`/`EVT_spec_export`、`EVT_chat_send_success`/`_send_blocked`/`_reply_terminal`/`_resend`、`EVT_edit_element_voided`/`_submit_blocked`、`EVT_version_rolled_back`、`EVT_cap_save_generated`/`_disable_confirmed`、`EVT_aiegress_notice_canceled`/`_notice_write_failed`/`_enabled` | App 角色（埋点补齐） |
| **v0.2.15** | **2026-10-26** | **B9 审核补充与复审闭环（按磁盘代码同步）**：同步 #17 prd/#18 实际DTO/#21 convert/#23 原子与回读；移除离页草稿自动保存假声明；EL 435，§4.2实测287→295（294+1；旧声明286不追改历史）、UI数据覆盖84行；接口75/事件54/用例600不新增；详见 `reviews/B9-审核补充与复审闭环-20261026.md`。本助手仅做文档静态自查；主Agent已反馈真实服务重启、supplement迁移与已执行回归，浏览器/真实写入及真实模型新正文判定仍待验收；不追加历史一致性报告 **同版增量补正**：#8摘要由服务端生成；初次#17→#8版本/hash核验，documentError禁用写回与手动复审；same-suggestion非空且正文包含才继承；KB历史绑定当前document_id。主Agent已跑b2 25/25、b3 21/21、b4 18/18；新脚本首轮47/47，门槛强化后46/47（01静态匹配待测试agent修订/复跑），不声称最终47通过。 | 文档同步 |

---

### 附：本 Spec 的自检结论（对照 `agents/04-App-角色Agent.md` 的 7 条输出前自检）

| # | 自检项 | 结论 |
|---|---|---|
| 1 | 路由表条数 == `UI-Spec` 页面条数 | ✅ **13 == 13**；`RT-*` 与 `UI-*` **逐行一一映射**；`RT-EDIT-001` / `RT-PREVIEW-001` 的「同路由两状态」已**显式说明**（§3 注 1），不构成多对一；`App-需求包 §2` 的 3 条区域路由落为**区域锚点**（§3 注 2），不计入 13 条 |
| 2 | 《UI ↔ 接口对应关系表》覆盖UI中有数据的元素 | ✅ UI-Spec §5 **84/84行**；App表实测**295（294页面元素供给+1外壳）**，新增055~062各一行；映射存在不代表实机/真实模型验收通过，B9已单列实际待补 |
| 3 | 所有 `API-ID` 在接口 Spec 中存在 | ✅ 引用 **75 个**（`API-PLAT-001`~`070` + `API-PLAT-044A` + **`API-PLAT-071`/`071A`/`072`/`072A`**），全部真实存在；补口 `#63`~`#70` 与字段级补口**已转基线**，**★ 仅作章节强调**的兜底，**未当基线使用**；**本机落地的 4 个（`#71`/`#71a`/`#72`/`#72a`）属开发阶段扩展，未过门禁、未进入第 4 轮基线冻结范围**，其中 `#72` 为阶段性本地登录（生产须 `AD_PASSWORD_LOGIN=disabled`） |
| 4 | 字段名与接口 Spec 零差异 | ✅ 右端字段名逐字照抄 `接口-Spec §5.0.3` / `§5.5` / `数据模型`；`E7` 的 13 个字段名**分立不合并**（`width`/`height`、`align_h`/`align_v`）；★ 补口字段**原样带 ★** |
| 5 | ★ 每个 UI 元素都有唯一 `EL-ID`，与 UI Spec 零差异、无重名 | ✅ 全部引用 `UI-Spec` 已发布的 `EL-*`（**不自造 id**）；`EL-GLOBAL-001`~`009` 按 `UI-Spec §7` 的授权范围使用（**5 个真跨页共用组件** = `CMP-001`~`004` + `CMP-017`／2026-10-21 本机落地新增 `EL-GLOBAL-009`） |
| 6 | ★ 埋点 Spec 中的每个 EVT 都已指定埋码位置 | ✅ **已按 `埋点-Spec` 附节 A 完成正式事件名回填**（全小写下划线，**54 行** = §10.1 **27 行** + §10.4 **27 行**〔§10.1 的 27 行 = 核心漏斗/负向/合规 25 行 **+ 本机落地 2 行**：`EVT_auth_password_login`、`EVT_llm_model_switch`；§10.4 的 27 行为其余事件〕；另 §10.2 的 `EVT_chat_send_blocked`，全部 ⊆ `埋点-Spec` 附节 C **54 条**枚举） |
| 7 | 五个页面状态齐备 + 待澄清清单已汇总 | ✅ 13 页 **每页五态齐备**（加载中 / 空数据 / 错误 / 无权限 / 离线；「空数据」不适用的页面**写明理由**）；「离线」态为 App 侧统一推断并**已确认**（`[缺口-APP-05]` **已闭合** 2026-10-21）；§12 汇总 **45 行**（按编号计 **51 个**）待澄清，**含 `[冲突-UI-02]` 的原样登记** |

> **本 Spec 不含**：视觉规范（`UI-Spec §3`）、接口服务端实现（`接口-Spec`）、被开发 App 的界面设计与 `API-*` 枚举（那是画布产物）。
> **下游开工前请先读**：§4（联调契约）→ §0（三件事分清）→ **附节 A**（S7 生成链路）→ §10（埋点埋码点）→ §12（45 行待澄清）。
