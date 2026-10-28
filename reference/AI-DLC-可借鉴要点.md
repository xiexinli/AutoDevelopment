# AWS Labs AI-DLC Workflows —— 可借鉴要点

> 来源：https://github.com/awslabs/aidlc-workflows （v2.11.1，MIT-0）
> 定位：把 AI 编码助手变成"有结构、可验证"的软件交付流水线，横跨 Claude Code / Kiro / Codex / Cursor / Copilot 等。
> 规模：5 阶段（initialization / ideation / inception / construction / operation）、33 个 stage、14 个 agent、11 个 workflow profile、121 事件审计轨迹。
> 原始文件已存于 `reference/aidlc-raw/`（22 个）。

---

## 一、它的骨架

```
initialization → ideation → inception → construction → operation
                  意图/范围    需求/领域/ 设计/编码/
                  可行性       契约/拆分   测试
```

对我们最有用的那段是 **ideation → inception**（对应「PRD → 拆需求 → 出 Spec」）：

| AI-DLC stage | 我们的对应物 |
|---|---|
| `intent-capture` | PRD 初审（问题/客户/成功指标/触发原因/边界） |
| `requirements-analysis` | PRD 完善（六维度完整性分析 + 澄清问题） |
| `user-stories` | 需求条目化（我们压成 REQ-ID 条目表） |
| `domain-design` / `contract-design` | 领域模型 / 接口契约 |
| `units-generation` | 需求拆分（我们按角色拆） |
| `functional-design` | 各角色 Spec（我们按角色分 5 份） |
| `delivery-planning` | 交付排期（我们不做） |

---

## 二、真正值得抄的 10 条

### 1. ★★★「角落检查表」——最有价值的单个资产
原文 `core/knowledge/aidlc-product-agent/corner-checklist.md`。核心洞见一句话：

> **漏掉的缺陷不是缺失的功能，而是「角落」：一个组件遇到一个不寻常条件。**
> 没人想到要问，所以**多问问题找不到它们；把每个组件与固定条件清单做叉乘扫描才能找到。**

它的做法：① 先定部署形态（单机/多租户/受监管）决定哪些条件适用；② 列出组件（用请求里已有的，不新增）；
③ 组件 × 条件面 叉乘；④ **每个适用的角落必须收敛为三态之一**：写成需求或验收标准 / 记为「假设 + 理由」 / 明确列入「不在范围」。
⑤ 只问 agent 不可能知道的事（用户的团队、预算、账号、合规义务）；能靠合理默认解决的，写成需求或假设让用户纠正，**不许变成问题**。

条件面覆盖：文件与路径、解析格式、文本、数字金钱、时间、身份标识、集合列表、网络、存储状态、并发作业会话、界面与输入、配置构建环境、身份安全隐私、AI 输出。
→ **已落地为 `baseline/角落检查清单.md`。**

### 2. ★★ 每一段实质内容必须带「来源标注」，未标注的只能叫假设
`intent-capture` 的 grounding contract 很硬：
- 问题文件开头有 `## Sources` 注册表，是**本阶段唯一允许的来源全集**；背景知识、行业惯例、推断都不许注册为来源。
- 正文里**每个实质段落/列表项/表格行都必须带内联来源标签**。
- 无法确认但值得保留的，只能放进 `## Assumptions & Open Questions` 并标 `[assumption]`。
- **假设必须人工确认**：`Accept assumptions` 或 `Convert to follow-up questions`，二选一，不允许默默带过。而且明确写了 **"Acceptance does not turn an assumption into fact."**（接受假设≠变成事实）。

→ 直接修正我们原来的漏洞：`[平台补充]` 不是自动生效，应该走「假设确认」二选一。

### 3. ★★ 评审是「双人制」，而且评审者只评审、不改文档
每个 stage 的 YAML 里声明 `reviewer` + `review_artifact` + `reviewer_max_iterations`（默认 2）+ `review_class`。
- `review_class: adversarial | advisory`。adversarial = 「默认你要证伪它，READY 是你搜寻后达不到的结论，不是你的起点」；advisory = 一遍过，结论给人看，不门禁。
- reviewer 有硬性输出契约：**第一行必须是身份标记**，然后是 `READY` / `NOT-READY` + 逐条**可核查证据**（要指名 story ID、验收标准、缺失章节）。仅凭"品味"的判断只能算建议，不足以给 NOT-READY。
- reviewer 明确被禁止写被评审的产物。

Product Lead 的四个核心拷问，**直接可以当我们门禁的判词**：
1. 开发者能从这份东西知道**确切要建什么**吗？不能 → NOT-READY
2. QA 能从这些验收标准**写出测试**吗？不能 → NOT-READY
3. 有没有**只被暗示、从未写明**的东西？假设就是缺口
4. 每一条都交付用户/业务价值吗？镀金就是范围蔓延

→ 修正我们的设计：`07-角色校对Agent` 应拆成**每个角色一个独立 reviewer**，只出 verdict + 证据，不改文档。

### 4. ★★ 追溯用四态，还要查「孤儿」
不用 ✅/⬜，而用：
- `OK`（有 target）/ `GAP`（有缺口，必须暴露）/ `N/A`（并给出理由，如"由 u2-profile 交付"）/ `Deferred`（并注明由哪个后续阶段覆盖）
- 还有 `reverse` 反向数组：**解释了"没有上游 ID"的规则**；任何未解释的规则会被机械判定为**孤儿**。

→ 我们的 RTM 应该加四态 + 反向查孤儿（有 Spec 条目但找不到对应 REQ = 凭空造需求）。

### 5. ★★ 回流（loop-back）必须有次数上限和 append-only 日志
失败可以跳回上游修，但：**每个 intent 最多 3 次**，计数写在 `## Loop-Back Log` 里（append-only，跳转重置勾选框但**永不重置 artifact**）。人工主动跳转不计入额度。额度耗尽就退化为「接受失败 / 中止」两个选项。

→ 我们的「PM 打回 → 重审」循环必须加上限，否则会无限空转。

### 6. ★ 自适应深度：不是所有输入都走全套流程
11 个 workflow profile（也叫 scope），每个 = **阶段路线 + 深度 + 测试策略 + 评审上限 + 仪式开关**：
`Classic 18/33 · Express 10/33 · Feature 33/33 · Enterprise 33/33 · MVP 23/33 · PoC 8/33 · Bugfix 9/33 · Refactor 10/33 · Infra 13/33 · Security-patch 10/33 · Workshop 26/33`
深度只有三档：**Minimal / Standard / Comprehensive**（`requirements-analysis` 的 Step 3 明确按复杂度选档）。
仪式开关（可覆盖）：`sensors` / `learnings` / `summary-confirmation` / `plan-approval`。

→ 我们平台应该按 PRD 复杂度选深度，而不是所有 PRD 都跑五角色全量。

### 7. ★ 澄清问题的格式是硬规定
- 每题必须有 A–E 选项 + `X. Other (please specify)` 收尾。
- 每题必须有一个兜底选项：`Not yet defined` / `None` / `Not identified` / `Not applicable`——**为了让意图狭窄的用户不必编造细节**。
- 收完答案后**强制做歧义检测**：扫 "mix of" / "not sure" / "depends" / "probably" / "maybe" 这类措辞，再查答案之间的矛盾，有则追问，不放过。
- 生成产物前有一个 **Consolidated Summary Confirmation**：把答案汇总成清单，问 "Does this all look correct before I generate…?"，只有显式 `Looks correct` 才允许生成。

→ 直接改进我们的「待澄清清单」：加选项、加兜底项、加歧义扫词、加"生成前汇总确认"。

### 8. ★ 确定性检查器（sensors）与 LLM 判断分离
每个 stage 声明 `sensors`：`required-sections`（章节是否齐）、`upstream-coverage`（上游是否被覆盖）、`traceability`（追溯是否完整、孤儿检测）、`claim-sources`、`linter`、`type-check`。
这些是**程序化检查**，不靠模型感觉。

→ 我们平台的门禁应尽量做成确定性检查：章节存在性、ID 覆盖率、字段名 diff、禁用词扫描（"等等/若干/根据实际情况"）都能程序化。

### 9. 消费（consumes）的语义很讲究
`consumes[].required: true` 的含义是 **"如果生产它的阶段会跑，那这一条就必须被满足"**，而不是"这个产物永远存在"。
- 声明了 required 但文件不存在 → 进 `consumes_absent` 并标注：
  - `expected: true` = 生产者在当前路线之外，或被条件跳过（**缺席是设计如此**）
  - `expected: false` = 路线内的生产者没被跳过，文件却还是没有（**这才是缺口**）
- `required: false` 且缺席 → 直接丢弃，**"不存在的可选输入不是输入，永远不算缺口"**。

→ 我们的 Spec 之间互相消费（UI→接口→App）应该照此区分"设计性缺席"与"真缺口"。

### 10. 产物要有稳定的、永久的追溯键
`FR{n}` / `FR{n}.{m}` / `NFR{n}` / `US{x}.{y}` / `AC{x}.{y}.{z}` / `BR{group}.{seq}` / `U{n}`。
原文硬规定：**"These IDs are permanent traceability keys. Downstream stages must preserve them exactly rather than renumbering."**
另外 `unit-of-work` 的 `kind`（`service|spec|ui|packaging|library`）决定它适用哪套设计产物矩阵——`spec` 不需要可扩展性文档，`packaging` 不需要业务逻辑模型。

→ 印证并强化我们的编号纪律；`kind` 的思路可用来做我们的"角色切片"。

---

## 三、参考但不必照搬（工程实现层）

- **引擎驱动**：stage 定义是带 YAML frontmatter 的 md，编译成 `stage-graph.json`，CI 跑 `compile --check` 防漂移；图支持拓扑排序、环检测、按 scope 取子图。
- **审计**：121 类事件、状态持久化、每次人工回复都留痕。
- **Hooks**：`session-start`、`state-transition-guard`、`plan-approval-guard`、`review-freeze`（评审冻结：评审后文档被改动就要求重审）、`runtime-integrity`。
- **恢复协议**：崩溃/中断的恢复、`rereview`（已评审单元被改动后的重审）。
- 体量参考：`stage-protocol.md` 90KB、`swarm` 协议 85KB——**这套东西的重心在"协议"，不在"提示词"**。

---

## 四、我应该改自己配置包的地方（行动清单）

| # | 改动 | 落到哪 |
|---|---|---|
| 1 | 引入「角落检查表」作为门禁的核心扫描器 | ✅ 新增 `baseline/角落检查清单.md` |
| 2 | 门禁加「三态收敛」原则：每个角落必须落为 需求 / 假设+理由 / 明确排除 | ✅ 改 `baseline/可开发性门禁清单.md` |
| 3 | `[平台补充]` 不再自动生效，走「假设确认」二选一 | ✅ 改 `agents/00-PRD审核完善Agent.md` |
| 4 | 每段实质内容带来源标注；无来源只能进「假设」区 | ✅ 同上 |
| 5 | 待澄清问题加选项 + 兜底项 + 歧义扫词 + 生成前汇总确认 | ✅ 同上 |
| 6 | 校对 Agent 拆成 5 个独立 reviewer，只评审不改，输出 READY/NOT-READY + 证据 | ✅ 改 `agents/07-角色校对Agent.md` |
| 7 | RTM 改四态（OK/GAP/N/A/Deferred）+ 反向孤儿检测 | ✅ 改 `baseline/需求追溯矩阵.md` |
| 8 | PM 打回循环加上限（建议 3 次）+ append-only 日志 | ✅ 改 `platform/平台需求概要.md` |
| 9 | 平台支持三档深度（Minimal/Standard/Comprehensive） | ✅ 同上 |
| 10 | 门禁尽量做成确定性 sensor | 记在改动 1、2 里 |

---

## 五、一句话总结

它最值得我们学的不是"33 个阶段"这种体量，而是**三个纪律**：
**(1) 每个角落都必须收敛到"需求 / 假设 / 排除"三态之一，不许沉默；**
**(2) 评审者独立于生产者，只出可核查证据的 verdict，不改被评的东西；**
**(3) 所有循环都有上限，所有回流都留 append-only 日志。**
