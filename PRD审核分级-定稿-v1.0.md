# PRD 审核分级 · 定稿（v1.0）

> **状态：已定稿 + 已实施**（需求方 2026-10-28 决策："按推荐定稿" → "按清单改代码"）。
> 取代 v0.1 提案 / v0.2 五档规则 / v0.3 简化候选，为**唯一有效版本**。
> 命名：**简审 / 标准 / 严格**，默认 **标准**。实施与验证结果见 §10。

---

## 0. 定稿决策记录（Q-A ~ Q-D，全部采纳推荐值）

| 编号 | 决策问题 | **定稿值** | 含义 |
|---|---|---|---|
| **Q-A** | 是否采纳三档简化 | **采纳三档** | 5 档（A~E）归并为 3 档 |
| **Q-B** | 档位命名 | **简审 / 标准 / 严格** | 不用 A/B/C/D/E，也不用 L1/L2/L3 作为对外名称（内部 code 见 §2.2） |
| **Q-C** | 默认档是否上移到 L2 | **是** | 新建项目默认 **标准**（= 原 C 强度，比原默认 B 更严） |
| **Q-D** | 等级能否放松门禁标准 #24 | **能** | 等级可整体放松；简审档必须打"非可开发级"标记 |

**其余（原 Q1/Q4/Q5/Q6/Q7/Q8/Q9）按推荐值写死**：等级同时管拆解；废弃 `depth` 统一为 `review_level`；存量项目默认迁到"标准"；引入管理员最低等级约束；简审档完全跳过角落扫描并记 `na`；超严扩展的"建议项阻断"由 L3 扩展开关承载；等级切换记埋点。

---

## 1. 三档总览

| 档 | 名称 | 定位（一句话） | 默认 |
|---|---|---|---|
| **简审** | 快速 | 只回答：这份需求**能不能实现**？内部**有没有自相矛盾**？ | |
| **标准** | 常规 | 需求**完整/清晰/无歧义**，且**数据接口可落地、核心角落已收敛** | ✅ |
| **严格** | 完整 | 全量细则 + 边界穷举，重要项不过也阻断；可开"超严扩展" | |

---

## 2. 参数定稿表

### 2.1 三档参数

| 参数 | **简审** | **标准（默认）** | **严格** |
|---|---|---|---|
| 内部 code | `quick` | `standard` | `strict` |
| 检查表 | 专项（可实现性 + 冲突） | 精简表 **14 项全评** | 完整表 **40 项** |
| 不评项 | 其余全 `na` | 无 | 无 |
| 阻断门槛 | 仅"不可实现""内部冲突" | 表内 `blocking` | `blocking + major` |
| 角落扫描 | 不跑（`na`） | **核心 6 面** + 扫描表 | **全 14 面** + 扫描表 |
| 出题等级 | 仅 `blocking` | `blocking + major` | `blocking + major + suggestion` |
| 假设清单 | 不强制（校验豁免） | 必列全 + 逐条选完 | 同标准 |
| 来源标注铁律 | 不启用 | **强制** | 强制 |
| 歧义强制检测 | 不启用 | 启用 | 启用 + 二轮复检 |
| 复审轮次上限 | 1 | 3 | 3 |
| 回写原 PRD | 不回写 | 回写已 Accept 项 | 同标准 |
| 放行标记 | "简审放行 · 非可开发级" | 无 | 无 |
| 进拆解确认 | 需 | 不需 | 不需 |
| 拆解深度映射 | `minimal` | `standard` | `comprehensive` |
| **超严扩展（默认关）** | — | — | 开 = 叠加安全/合规/性能/无障碍/国际化/隐私/成本 扩展面，且"建议项"也阻断 + 二次交叉复核 + 回写后自动复审 |

### 2.2 内部 code 与存储值
- `review_level` ∈ `quick | standard | strict`（对外显示：简审 / 标准 / 严格）。
- `review_extended` ∈ `0 | 1`（仅 `strict` 有意义；`quick`/`standard` 强制 0）。

### 2.3 第 1 节之外的两个固定清单

**（a）精简表 14 项**（= `PRD-门禁骨架.md` = 代码 `DEFAULT_STANDARD`，平台当前实际运行的表）
`A1 A2 A3 B1 B2 C1 C2 D1 D2 E1 F1 G1 H1 I1` —— 其中表内 `blocking` = `A1 A2 B1 B2 C1 E1 F1`。
**（b）完整表 40 项** = `baseline/可开发性门禁清单.md`（A~I 展开细则；严格档用）。

**（c）角落扫描 14 个条件面**：① 文件与路径 ② 解析的格式 ③ 文本 ④ 数字/单位与金额 ⑤ 时间 ⑥ 事物标识 ⑦ 集合与列表 ⑧ 网络与远程服务 ⑨ 存储与状态 ⑩ 并发/任务与会话 ⑪ 界面与用户输入 ⑫ 配置/构建与环境 ⑬ 身份/安全与个人数据 ⑭ AI 与智能体输出。
**核心 6 面** = ⑧ ⑪ ⑦ ⑨ ⑩ ③。

---

## 3. 三档详细规则

### 简审（`quick`）
- **检查范围**：专项 2 项。
  - `quick-P1 可实现性` —— 逐条判定（清单见 §4.1）。
  - `quick-P2 内部一致性/冲突` —— 逐条判定（清单见 §4.2）。
- 其余项全部记 `na`。
- **阻断集**：`quick-P1=fail` 或 `quick-P2=fail`。
- 角落扫描不跑、记 `na`；报告末附"未做角落扫描，建议至少升到「标准」"。
- **假设不强制**；放行时**豁免**"假设未选完不得放行/回写"的校验。
- 放行 → 打"**简审放行 · 非可开发级**"，进拆解前确认。

### 标准（`standard`，默认）
- **检查范围**：精简表 14 项全评。
- **阻断集**：`A1 A2 B1 B2 C1 E1 F1`。
- 角落扫描：**核心 6 面**，每适用条件三态收敛，出《角落扫描表》。
- 出题 `blocking + major`；假设必列全并逐条选完。
- 来源标注强制：不得有无来源标签的实质段落。
- 复审上限 3 轮。回写已 Accept 项。

### 严格（`strict`）
- **检查范围**：完整表 40 项。
- **阻断集**：`blocking + major`。
- 角落扫描：**全 14 面**；不适用面记 `not-applicable` 并写理由。
- 出题 `blocking + major + suggestion`；假设必列全并逐条选完。
- 复审上限 3 轮。回写已 Accept 项。
- **超严扩展开关**（`review_extended=1`）：扩展检查面 + 建议项阻断 + 二次交叉复核 + 回写后自动复审。

---

## 4. 补充完善的判定清单

### 4.1 「可实现性」逐条判定（简审-P1）
- [ ] 主流程每一步都有对应的界面/系统行为，无"到这里就没了"的黑洞步骤
- [ ] 要展示的每项数据都有来源（已有系统 / 接口 / 用户输入），无凭空产生的数据
- [ ] 不存在"需要一项尚未定义的新技术/新能力"才能实现的要求
- [ ] 不存在两条互斥的硬性要求（如"必须离线"且"必须实时同步"）

### 4.2 「内部一致性/冲突」逐条判定（简审-P2）
- [ ] 同一事实在不同处的数字/文案/流程说法一致
- [ ] 范围（做什么/不做什么）与目标不互斥
- [ ] 状态定义与流程步骤对得上
- [ ] 角色定义与权限对得上

> 任一打叉 → 该专项判 `fail`，且**必须能指到两处原文位置**作为证据。

### 4.3 复审与等级的交互
- 复审是"同一档下的再检查"，**不是重新选档**。
- 想换档 → 走「重新审核」，生成新报告、旧报告 `superseded`、轮次从 0 起算。
- 复审报告记录本次 `review_level`，与首审一致。

---

## 5. 全局规则 R-01 ~ R-24（定稿）

| 编号 | 规则 |
|---|---|
| R-01 | 等级来源优先级：单次请求 > 项目默认 > 系统默认 **standard** |
| R-02 | 报告必须记录 `review_level` 与 `review_extended` |
| R-03 | 复用键 = revision + standard_version + **review_level + review_extended** + 未 superseded + 文档哈希 |
| R-04 | 切档不改写已出报告；提示"需重新审核" |
| R-05 | 不评记 `na`，**na ≠ pass**，界面可视区分 |
| R-06 | 单调性：阻断集合 简审 ⊆ 标准 ⊆ 严格 → 阻断数 **简审 ≤ 标准 ≤ 严格**（回归强制断言） |
| R-07 | `verdict = fail数>0 ? blocked : passed`；`na` 不算 fail |
| R-08 | 无证据不判 `pass`（指不到原文 → 判 `fail`） |
| R-09 | **仅简审档**放行打"非可开发级"标记，不与标准/严格的 `passed` 同款展示 |
| R-10 | 仅 `passed` 可进拆解；**简审档**放行时进拆解前确认 + 埋点 |
| R-11 | 切到严格档（或开超严扩展）提示预计成本与耗时更高 |
| R-12 | 复审只重查前次 fail 项 + 被 PM 改动波及项，不推翻已过项 |
| R-13 | 超轮次上限 → 升级处理（接受并记录 / 中止），与 `loopback_round` 取 min |
| R-14 | 回写前必有原文快照，只写已 Accept，不删改原文 |
| R-15 | 标准档及以上收答复后强制歧义检测 |
| R-16 | 模型返回条目数须等于应评条目数，否则不应用 |
| R-17 | 「门禁标准」#24 定"有哪些项"，等级定"多严"；**等级可整体放松**（Q-D） |
| R-18 | 废弃 `tbl_project.depth`，统一为 `review_level`；拆解深度由档位映射 |
| R-19 | `model` 与 `review_level` 正交，报告同时记录 |
| R-20 | 存量项目默认迁到 **标准**（只写默认值，不重算历史报告） |
| R-21 | 复审必须沿用同一档；换档 = 一次新审核（新报告、旧报告 superseded、轮次重置） |
| R-22 | 不允许在复审中途改档 |
| R-23 | 复审结论的等级标记沿用首次放行档 |
| R-24 | 超严扩展开关是独立可追溯字段，开关变化同样触发"新审核"，不与严格档本体混记 |
| **R-25** | **简审档豁免"假设全部选定"校验**（`#21` 的 `unset` 拦截、`#23` 回写前的 `unset` 拦截，仅对 `review_level='quick'` 的报告放行） |

---

## 6. 放行前自检矩阵

| # | 自检项 | 简审 | 标准 | 严格 |
|---|---|---|---|---|
| 1 | 应评条目齐评且 `pass` 有证据 | ✔ | ✔ | ✔ |
| 2 | 不评项记 `na` 且与 `pass` 可区分 | ✔ | — | — |
| 3 | 出题带选项 + 兜底项 | ✔ | ✔ | ✔ |
| 4 | 假设清单无空白未选 | 豁免 | ✔ | ✔ |
| 5 | 角落扫描无沉默角落 | — | ✔ | ✔ |
| 6 | 无"无来源标签"的实质段落 | — | ✔ | ✔ |
| 7 | 阻断数 = 本次等级门槛下的 fail 数 | ✔ | ✔ | ✔ |
| 8 | 复审轮次未超上限 | ✔ | ✔ | ✔ |
| 9 | 回写前有原文快照、只写已 Accept | — | ✔ | ✔ |
| 10 | 报告已记录 `review_level` (+`review_extended`) | ✔ | ✔ | ✔ |
| — | **回归断言**：阻断数 简审 ≤ 标准 ≤ 严格 | 强制（不满足即实现缺陷） | | |

---

## 7. 示例走查

某 PRD：主流程清楚、字段没写全、无接口契约、状态迁移没写、无内部矛盾。

| 档 | 结论 | 原因 |
|---|---|---|
| 简审 | `passed`（"非可开发级"） | 可实现、无冲突 |
| 标准 | `blocked` | C1（字段）、E1（接口）是 blocking 且 fail |
| 严格 | `blocked` | 同标准，且 major 项（D1/D2/G1…）也 fail |

---

## 8. 落地改动清单（实现级）· **已于 2026-10-28 实施，见 §10**

> 目标仓库：`server/`（Fastify + SQLite）、`web/`（React + Vite）。以下为**改动点**，未实施。

### 8.1 数据模型（`server/src/db/schema.sql`）
| # | 改动 |
|---|---|
| D1 | `tbl_project`：`depth` 列保留但废弃（迁移为只读/忽略），新增 `review_level TEXT NOT NULL DEFAULT 'standard'`、`review_extended INTEGER NOT NULL DEFAULT 0` |
| D2 | `tbl_review_report`：新增 `review_level TEXT NOT NULL DEFAULT 'standard'`、`review_extended INTEGER NOT NULL DEFAULT 0`（与 `model` 并列，作为"结论变量"可追溯） |
| D3 | `tbl_review_item`：`verdict` 已支持 `pass/fail/na`，无需改；但 `counts_json` 增记 `na` |
| D4 | 迁移脚本：存量 `tbl_project.depth` → `review_level`（minimal→quick、standard→standard、comprehensive→strict）；存量项目默认 `standard`（R-20） |

### 8.2 判定逻辑（`server/src/routes/review.ts`）
| # | 改动 |
|---|---|
| L1 | 触发 `#16`：`depth` 参数改为 `level`（`quick/standard/strict`）+ 可选 `extended`；非法值 → `INVALID_ARGUMENT "审核等级只能是 quick / standard / strict。"` |
| L2 | `standardItems` 裁剪：`quick` → 不走表（走专项检查，见 L4）；`standard` → 精简表 14 项；`strict` → 完整表 40 项（需新增"完整表"常量，现 `DEFAULT_STANDARD` 只有 14 项） |
| L3 | `counts` 判定：门槛按档位（`quick`：专项 fail；`standard`：`level==='blocking' && verdict==='fail'`；`strict`：`blocking|major`）；`verdict` 计算不变，但输入集合变；额外统计 `na` 计数 |
| L4 | **新增 quick 专项分支**：不走 `llm.review` 的逐项模式，改调一个"可实现性+冲突"提示词变体；返回 `{p1, p2, conflicts[]}`；映射为两条 `tbl_review_item`（`code=quick-P1/quick-P2`，其余 14 项批量插 `na`） |
| L5 | 复用分支：比对 key 加 `review_level` 与 `review_extended`（现只比 `depth` 落 meta）；meta 里存 `{level, extended}` |
| L6 | 复用/强制重跑的服务端兜底：**`quick` 档跳过 `unset` 假设拦截**（R-25），`standard/strict` 保持 |
| L7 | `stage` 流转不变（`reviewing → gate_passed | gate_blocked`） |

### 8.3 接口
| # | 改动 |
|---|---|
| A1 | `#16` `POST /api/v1/revisions/{id}/reviews`：body `{depth}` → `{level?, extended?, force?}`；响应 `data` 回显 `level`/`extended` |
| A2 | `#17` `GET /api/v1/reviews/{id}`：返回增 `review_level`、`review_extended`、`counts.na` |
| A3 | `#18` `GET /api/v1/reviews/{id}/items`：`quick` 档返回 2 条专项 + 14 条 `na`（供评分卡渲染） |
| A4 | `#69` 导出：报告头增"审核等级：X（+超严扩展）· 模型：Y" |
| A5 | `#28` 拆解 `POST /projects/{id}/splits`：`depth` 由等级映射（快捷：`minimal`… 见 §2.1 映射表），不再由前端直接指定 |

### 8.4 提示词（`server/src/adapters/llm.ts`）
| # | 改动 |
|---|---|
| P1 | `llm.review` 的 user content：`审核深度：${depth}` → 注入**档位全文说明**（该档的检查范围/门槛/角落面/出题等级） |
| P2 | **新增** quick 专项提示词：要求模型只输出 `{p1:{verdict,evidence,suggestion}, p2:{...}, conflicts:[{a,b}]}` |
| P3 | mock 适配器：`review` 增按档位分支；`quick` 只返回两条专项 + 批量 `na` |

### 8.5 前端（`web/src/`）
| # | 改动 |
|---|---|
| W1 | `pages/ReviewPage.tsx`：顶部加 `Segmented` 三档 + **同屏强度说明**；切换确认语「等级已改为「X」。已出的审核报告不会重算，需点『重新审核』才生效。」 |
| W2 | 严格档展开区：`Switch`"开启超严扩展"（默认关），开启提示成本 |
| W3 | 评分卡：`na` 用灰色 + "未评"标签，与绿色 `pass` 明显区分；简审档显示"非可开发级"横幅 |
| W4 | 进拆解按钮：简审档 `passed` 时弹确认框（R-10） |
| W5 | `domain/types.ts`：`depth` → `review_level`/`review_extended`；`api/mock.ts` 同步 |
| W6 | `pages/SplitPage.tsx`：深度三档改为**只读展示**（由审核等级映射），或移除 |

### 8.6 埋点
| # | 事件 |
|---|---|
| E1 | `EVT_review_level_change`（切档时；携带 `from`/`to`） |
| E2 | `EVT_review_extended_toggle`（超严扩展开关） |
| E3 | `EVT_review_override_continue`（简审档放行仍进拆解） |

### 8.7 测试
| # | 用例 |
|---|---|
| T1 | 三档各自的"该断不断 / 不该断乱断"用例 |
| T2 | **单调性回归**：同一 PRD 跑三档，断言 阻断数 简审 ≤ 标准 ≤ 严格（R-06） |
| T3 | 复用键：切档后不误复用旧报告（R-03） |
| T4 | 简审档假设未选完仍可放行（R-25） |
| T5 | 换档 = 新审核，旧报告 superseded、轮次重置（R-21） |
| T6 | `na` 不计入阻断、界面可区分（R-05） |
| T7 | 存量项目迁移后默认 `standard` 且历史报告不重算（R-20） |

---

## 9. 变更记录
| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1 | 2026-10-28 | 提案：五档维度对照，9 个待拍板问题 |
| v0.2 | 2026-10-28 | 详细规则：两张检查表、14 条件面、R-01~R-20、自检矩阵 |
| v0.3 | 2026-10-28 | 简化候选：三档归并、R-21~R-24、4 个待拍板问题 |
| **v1.0** | **2026-10-28** | **定稿：采纳三档（简审/标准/严格）、默认标准、R-25、实现级落地清单** |

---

## 10. 实施记录（2026-10-28）

### 10.1 已改动文件
| 层 | 文件 | 改动 |
|---|---|---|
| 数据模型 | `server/src/db/schema.sql` | `tbl_project` + `tbl_review_report` 各增 `review_level` / `review_extended`（`depth` 保留但标注废弃） |
| 迁移 | `server/src/db/index.ts` | 旧库 `ALTER TABLE ADD COLUMN`（幂等），已在**真实旧库副本**上验证：16 个项目数据保留、列已补 |
| 适配器 | `server/src/adapters/llm.ts` | 新增 `ReviewLevel` / `REVIEW_LEVEL_PROFILE` / `reviewLevelProfile()`；`review()` 入参 `depth`→`level`+`extended`；提示词注入档位全文；mock 改为**按 `standardItems` 逐条对齐**（含简审 Q1/Q2；未覆盖项判 `na`，不编造） |
| 审核路由 | `server/src/routes/review.ts` | 新增 `REVIEW_LEVELS` / `QUICK_ITEMS` / `FULL_STANDARD_EXTRA`(29 项) / `itemsForLevel()` / `isBlocking()` / `depthOfLevel()`；`#16` 解析 `level`+`extended`（兼容旧 `depth`）、复用键加等级与扩展位、**R-25 简审豁免前置校验**、`counts` 增 `na` 且 `verdict` 按档位门槛；`#17` 回 `review_level`/`review_extended`；`#69` 导出带等级；`GROUP_TITLES` 增 `Q` |
| 拆解路由 | `server/src/routes/split.ts` | 深度**默认由 `review_level` 映射**（R-18），显式 `depth` 仍兼容 |
| 项目路由 | `server/src/routes/projects.ts` | `#3` 返回 `review_level`/`review_extended`；`#6` `gate` 增 `review_level`/`review_extended` |
| 前端类型 | `web/src/domain/types.ts`、`web/src/domain/api.ts` | `Project`/`ReviewReport` 增两字段；`#16` 说明更新 |
| 前端 store | `web/src/store/session.ts` | 新增 `ReviewLevel`；`triggerReview(opts.level/extended)`；`fetchReview`/`fetchProject`/`fetchStats` 返回新字段 |
| 前端 mock | `web/src/api/mock.ts` | `ProjectRow`/`ReviewRow` 增字段；审核按等级生成（简审两项）；复用按等级；`#6` 补 `gate` |
| 审核页 | `web/src/pages/ReviewPage.tsx` | 三档 `Segmented` + **同屏强度说明** + 严格档「超严扩展」开关；切档提示与埋点；`na` 显示为「未评」（与 `pass` 区分）；结论区显示等级；简审放行横幅 + 进拆解确认弹窗（R-10） |
| 拆解页 | `web/src/pages/SplitPage.tsx` | 深度由三档 `Segmented` 改为**只读展示**（由审核等级映射） |
| 设计文档 | `platform/design/数据模型.md`、`platform/design/接口契约.md` | `E1`/`E17` 字段与 `#16` 契约同步 |
| 测试 | `server/test/review-level-regression.mjs`（**新增**）、`server/test/review-writeback-regression.mjs`、`server/test/upstream-conformance.mjs` | 新增 T1~T7 共 8 例；另两处按新入参契约更新断言 |

### 10.2 验证结果
| 验证 | 结果 |
|---|---|
| `cd server && npx tsc --noEmit` | ✅ 通过 |
| `cd web && npx tsc --noEmit` / `npm run build` | ✅ 通过（构建成功） |
| `server/test/review-level-regression.mjs` | ✅ 8/8（含**单调性**断言 简审 0 ≤ 标准 5 ≤ 严格 10） |
| `server/test/b2-regression.mjs` | ✅ 25/25 |
| `server/test/b3-regression.mjs` | ✅ 21/21 |
| `server/test/b4-regression.mjs` | ✅ 18/18 |
| `server/test/review-writeback-regression.mjs` | ✅ 50/50 |
| 旧库迁移（`data/app.db` 副本） | ✅ 项目数不变（16），新列就位 |
| 真实启动（全新库 + 开发适配器） | ✅ 启动正常；`#3` 返回 `review_level=standard`、`review_extended=false`；上传→解析→任务轮询走通 |

### 10.3 未完成 / 待办
- **真实大模型下的三档效果未验证**（本次全部用确定性 mock 适配器；真实模型对 43 项严格档的产出质量需实测）。
- **严格档检查项为代码常量**（`FULL_STANDARD_EXTRA` 29 项）：本期不提供 UI 编辑；管理员改严格档需改 `baseline/可开发性门禁清单.md` + 该常量。
- **`web/src/domain/{types,api}.ts` 是生成物**：仓库现状与生成器输出本就存在漂移（如 `SpecDoc.content_md` vs `content`、`#71/#72` 缺失、75 vs 71 个接口），本期**未做整份再生**，仅手改相关字段；`pnpm gen:types` 会引入大量无关 diff，需另行收口。
- 未做：埋点后端接收验证、`EVT_review_level_change` 等三事件的端到端核对、平台文档（`页面规格`/`验收标准`）同步、一致性校对。

