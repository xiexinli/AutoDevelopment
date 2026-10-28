# AutoDevelopment 平台 · 后端（server/）

> 严格实现 `platform/design/接口契约.md` 的 **71 个接口**。前端 `web/` 把 `VITE_USE_MOCK` 置 `0` 即切到本服务。

## 1 技术栈（**本工程裁决，记录于 `platform/decisions/后端技术栈裁决-20261021.md`**）

| 项 | 选择 | 理由 |
|---|---|---|
| 运行时 | **Node.js ≥ 22.5**（本机 v26.7.0） | 原生 TypeScript 类型剥离，**无需构建步骤**；`node:sqlite` 内置 |
| HTTP | **Fastify 5** | 路由 / 钩子 / 错误处理齐备，性能与 TS 支持好 |
| 存储 | **SQLite（`node:sqlite`）** | **零原生编译**（不需要 node-gyp），单文件 `data/app.db`，可直接换成 PostgreSQL |
| 校验 | **手写守卫 + 统一 `ApiError`** | 契约只有 13 个错误码、参数面窄，引入 zod 反而多一层翻译 |
| 语言 | **TypeScript（`.ts` 直接运行）** | 与前端同语言；`allowImportingTsExtensions` + `erasableSyntaxOnly` 保证可被 Node 直接执行 |

```bash
cd server
pnpm install
pnpm dev        # node --watch src/server.ts  → http://127.0.0.1:8787/api/v1
pnpm typecheck  # tsc --noEmit
pnpm reset      # 清库重来（删 data/app.db）
```

## 2 已实现的契约硬性约定

| 约定（`接口契约`） | 实现位置 |
|---|---|
| 统一响应包 `{code,message,data,request_id}`（§0.2） | `src/core/envelope.ts` + `src/app.ts` 的 `setErrorHandler` |
| **13 个错误码 → HTTP 状态**（§0.5） | `src/core/envelope.ts` `HTTP_STATUS` |
| 分页 / 排序 / 筛选，**`page_size` 只允许 20/50/100**、**稳定次序键 = 排序键 + id 升序**（§0.3） | `src/core/pagination.ts` |
| **幂等**：`Idempotency-Key` 同键 3s 内重放返回**首次结果**（§0.1） | `src/core/idempotency.ts` |
| **乐观锁**：写操作带 `If-Match`，不匹配 → `VERSION_CONFLICT` + `current_version`（§0.1） | `src/core/idempotency.ts` `assertIfMatch` |
| **逐对象鉴权**：列表 / 详情 / 搜索 / 导出一律按成员关系过滤；越权 403 且**不泄露对象是否存在**（§0.1） | `src/core/auth.ts` `assertProjectAccess` / `accessibleProjectIds` |
| 时间一律 **UTC ISO-8601**（§0.1） | `src/db/index.ts` `nowIso()` |
| **敏感数据不入日志与 URL**（§0.2） | `app.ts` 的 logger 只记方法 + 去 query 的路径 |

## 3 进度（后端切片）

| 切片 | 范围 | 状态 |
|---|---|---|
| **B1** | 工程骨架 + 23 实体 DDL + 核心层（响应包/错误码/幂等/乐观锁/分页/鉴权）+ 飞书适配器 + **#63~#66 认证** + **#1~#6 项目** + **#7~#9 知识库** + **#68 外发开关** | ✅ **已完成并实测**（curl 全链路 + 浏览器联调） |
| **B2** | #10~#15 上传解析 + #16~#24 门禁/回写 + #28/#29 拆解 + #67 追溯 + 部分 #44/#44a/#45/#59/#69 | 核心 HTTP/存储链路回归通过；**真实上游/语义验收未完成**（见验收记录） |
| **B3** | #35~#44a 编辑/草稿/任务 + #45 Bearer SSE + #46~#49 验证与源码产物 | **核心链路本轮验收通过**；21/21回归，独立限定评审READY；真实AI/Android编译/L2代理未验 |
| **B4** | #25~#27 对话 + #30~#34 Spec + #50~#57 接口定义与版本 + #58 能力配置 + #59 埋点 + #60/#61 交付 + #62 平台埋点 + #69/#70 | **核心 HTTP/存储链路本轮验收通过**；15/15 回归，真实上游未验（见验收记录） |

## 4 第三方适配器（**可替换**）

`src/adapters/feishu.ts` 给出两个同接口实现：

- **`FeishuRealAdapter`**：走 `open.feishu.cn`，读 `AD_FEISHU_APP_ID` / `AD_FEISHU_APP_SECRET`（**密钥只在服务端环境变量，绝不下发浏览器、绝不入日志**）；
- **`FeishuMockAdapter`（开发适配器）**：不联网，返回结构**与真实实现完全一致**；扫码状态落在 `tbl_qrcode`，
  由 `POST /api/v1/auth/feishu/qrcode/{state}/simulate` **显式推进**（真实环境由手机扫码推进）。
  真实适配器下该接口返回 `INVALID_ARGUMENT`。

未配置 `AD_FEISHU_APP_ID` 时自动使用开发适配器，并在启动日志中**明示**。
⚠️ 真实飞书扫码登录需要在开放平台创建应用并配置回调，**当前工程未代持任何应用凭据**。

## 5 不伪造原则

- 建库**不预置任何业务数据**（不塞假 PRD、假 Spec）；数据只由接口写入。
- 上游不可用时**绝不静默写入**：一律返回对应错误码（`UPSTREAM_TIMEOUT` / `UPSTREAM_UNAVAILABLE`）。
- 前端 `web/src/api/mock.ts` 仍是**可用的开发数据源**（`VITE_USE_MOCK=1`），两套互不干扰。

## 6 前端联调

`web/.env.local`（已创建）：

```
VITE_USE_MOCK=0
VITE_API_TARGET=http://127.0.0.1:8787
```

还原成 mock：把 `VITE_USE_MOCK` 改成 `1`（或删除该文件）。

## 7 B2 本轮验收边界

报告：`../reviews/B2-核心链路验收记录.md`。测试：`node --test test/b2-regression.mjs`（23子项+父test=24/24）。
测试用内存数据库，不 reset 业务库。

- #29 `items`=角色包、`total`=包数量、`requirement_count`=REQ总数；三侧已同步。
- 同键副作用一次、未通过审核不能拆解、旧revision不可写当前正文、取消/超时不能提交、用户编辑/快照/新revision事务原子。
- 默认缺少LLM配置时**拒绝生成**，不会自动用标题规则桩。临时联调须显式：
  `AD_LLM_MODE=development node --watch src/server.ts`。
  浏览器顶栏会提示「AI 开发适配器 · 非真实审核」。普通 `node src/server.ts` 不设置该变量时返回明确上游错误。
- 真实LLM仅约定自建网关 `/v1/review` 和 `/v1/split`，不是通用模型聊天API；真实兼容性、语义审核未验收。
- **飞书真实登录/读取尚未实现**；上面“真实适配器”是接口框架，不能理解为已成功接入。开发扫码/文档为测试用途。
- #67 无明确五角色落点即 gap；自动精确追溯/孤儿检测仍待后续实现，不虚报100%覆盖。
- 当前 schema 增量迁移：KB document_id、项目级事件复合主键；不删除现有库。旧revision无正文快照时提示重新解析，不凭最新KB补造历史。

## 8 B3 验收与运行

详见 `../reviews/B3-核心链路验收记录.md`、`../platform/decisions/B3-工程兼容与安全方案-20261021.md`。

- 回归：`node --test test/b3-regression.mjs`（20子项+父test=21/21）；B2回归保持24/24。
- 本地运行保留现有 `AD_LLM_MODE=development` 时，B3也显式继承development布局编译器；顶栏仍显示开发模式。
- 正式代码生成需配置 `AD_CODEGEN_BASE_URL` / `AD_CODEGEN_API_KEY`，网关协议POST /v1/codegen；默认缺配置拒绝，不静默生成假AI结果。
- L1需Python3，仅解析XML/静态证据，不跑Android构建；官方完整Gradle8.9 wrapper已随源码资源放入。
- 元素ID作用域为项目内唯一，遇多项目ID歧义须带project_id。数据库已做无损增量复合主键迁移，不reset现库。
- #46普通Bearer403；受信构建代理另需任务绑定HMAC签名。鉴权候选方案待架构确认，实际代理未执行，不能宣称L2构建通过。
- 下一步B4仍待实现；整包下载、真实AI、复杂控件数据和传递依赖锁不在本轮验收完成声明内。

## 9 B4 验收与运行

报告：`../reviews/B4-核心链路验收记录.md`。回归：`node --test test/b4-regression.mjs`（15 子项 + 父 test = 15/15，内存库，不 reset 业务库）。

- **对话**（`#25~#27`）：历史按 `seq` 升序；发送 202 + SSE `chat.delta`；空内容/超 20000 字符 400；重发**不重复入库**；回复受 `#68` 外发开关约束（关闭 → 503，不静默降级）。
- **Spec**（`#30~#34`）：顺序即生成顺序 `ui→api→app→track→test`，**串行**；**单份失败不阻断其余**，`overall` 部分成功时**绝不报 `succeeded`**；没有需求包时处理器内直接 400（不造必然失败的任务）；生成完成**自动打一个项目级版本**（`§F12` 方案 A）。
- **接口定义**（`#50~#53`）：`field_type` 为**完整 8 项枚举**、禁「等」；`PATCH`/`PUT` 须 `If-Match`；⬛删除须 `confirm`，并把引用它的 Spec 标「需复核」。
- **版本**（`#54~#57`）：`current` 唯一；diff 的 `change` 用**文字**；⬛回滚须 `confirm` 且**要么全成要么全不成**；**快照只读保留**；历史快照缺失字段时按空快照归一化，**旧数据仍可读**（不 500）。
- **能力配置**（`#58`）：固定 7 项拉丁枚举、默认全关；`If-Match`；**保存即生成**；`conflicts[]`/`alignment_table[]` 按契约形状；**取消勾选需二次确认**，且只移除配置、`code_status` 保留。
- **交付**（`#60/#61`）：`#61` 产出**真实 ZIP**（自写 ZIP 写入器，零外部依赖）；**不含 apk**（平台不做服务端构建）、**不含密钥**；`#61`/`#69` 均需鉴权。
- **埋点上报**（`#62`）：只做结构校验与计数，**不落业务数据**；失败项进 `rejected[]`，**不阻塞业务**。
- **中止流程**（`#70`）：⬛须 `confirm`；取消进行中任务、版本归档；**归档不删、数据仍可读**。

**仍属未验收**：真实大模型网关的兼容性与语义产出、真实飞书登录/读取、交付包内安卓工程的真实构建、能力接入代码的真实生成。开启临时联调仍须显式 `AD_LLM_MODE=development`（或 `AD_CODEGEN_MODE=development`）。

## 10 接真实上游（2026-10-21）

### 10.0 一句话

**不配就 fail-closed**：没配上游时生成类接口直接返回明确错误；想用确定性桩必须**显式** `AD_LLM_MODE=development`（或 `AD_CODEGEN_MODE=development`），浏览器顶栏会标「AI 开发适配器 · 非真实审核」。

### 10.1 大模型：任意 OpenAI 兼容的 `/chat/completions`

```bash
# 本机 LM Studio（无需密钥）
export AD_LLM_BASE_URL=http://127.0.0.1:1234/v1
export AD_LLM_MODEL=qwen/qwen3.6-35b-a3b
# 云端示例
# export AD_LLM_BASE_URL=https://api.deepseek.com/v1
# export AD_LLM_MODEL=deepseek-chat
# export AD_LLM_API_KEY=***
```

- **不再自造私有网关协议**（原实现假设上游有 `/v1/review` `/v1/split`，真实上游不具备）。
- 严格 JSON 由**提示词 + 结构校验**保证；`AD_LLM_JSON_MODE` 可选 `none`（默认）/`json_object`/`json_schema`
  —— 因为不同上游对 `response_format` 的支持不一致（实测 LM Studio 只接受 `json_schema`/`text`，发 `json_object` 会 400）。
- 结构不合法一律判上游失败：**空审核结论、非五角色需求包、编号不合规都不放行**。
- 单次 60s 上限（`AD_LLM_TIMEOUT_MS` 可覆盖）、退避重试 ≤2 次、**4xx 不重试**、调用方取消原样上抛。
  **deadline 覆盖「请求 + 响应体 + 流式读取」**：只把 signal 给 `fetch()` 不够 ——
  上游回完响应头就挂住时，`res.text()` 不会被那次 abort 打断，会一直等到 undici 自己的 300s body 超时。
- 对话走 `stream:true`，增量直接转成 SSE `chat.delta`（**真流式**，不是「先取整段再假装分段」）。
- 本机大模型较慢时（单次 40s+）可调大 `AD_LLM_TIMEOUT_MS`；5 份 Spec 串行会超 5min 契约上限，
  本地联调可临时调 `AD_TASK_TIMEOUT_MS`（**生产按契约 5min**）。

### 10.2 飞书：登录与云文档是两个适配器

| 场景 | 需要什么 | 说明 |
|---|---|---|
| **扫码登录** | `AD_FEISHU_APP_ID` + `AD_FEISHU_APP_SECRET` + `AD_FEISHU_REDIRECT_URI` | 走**授权码流程**：`#63` 返回飞书授权页地址 → 用户扫码授权 → 回调 `GET /api/v1/auth/feishu/callback` 换用户令牌并建档 → `#64` 轮询到 `confirmed`。回调地址必须与开放平台「重定向 URL」白名单一致。 |
| **读云文档** | 应用凭据，**或** `AD_FEISHU_USER_TOKEN` | 应用凭据走 `tenant_access_token`；用户令牌走 `user_access_token`（以**当前用户身份**读他有权限的文档，**仅本地联调**，个人令牌不是平台凭据）。 |

`readDocument` 支持 **docx / 旧版 doc / wiki 节点 / 电子表格**：
- wiki 链接先 `wiki/v2/spaces/get_node` 解析出 `obj_token`；
- docx 正文用 `raw_content`（保证拿得到），**表格/附件/白板/内嵌表格用 `blocks`**（分页拉全）；
- **docx 内嵌电子表格**的 token 形如 `<spreadsheetToken>_<sheetId>`，按最后一个下划线拆开直接取区间；
- 白板**只有缩略图、取不到结构化文本** → 如实标 `skipped` 并在正文里说明，不假装已解析；
- **部分失败不阻断其余**：某个表格取不到只把该项标 `failed`，整体置 `partial`；
- 无权限 → `FORBIDDEN`（文案不泄露存在性）、节点不存在 → `NOT_FOUND`、不支持的类型 → `FORMAT_UNSUPPORTED`。

> `AD_FEISHU_BASE_URL` / `AD_FEISHU_AUTH_BASE_URL` 可覆盖（Lark 国际版为 `open.larksuite.com`；一致性测试也用它指向本地桩）。

### 10.3 一致性测试（可离线复跑）

```bash
node --test test/upstream-conformance.mjs
```

用**本地桩**模拟 OpenAI 兼容协议与飞书开放平台，覆盖：JSON 解析与围栏、空结构不放行、五角色校验、
真流式增量、503 重试 / 400 不重试 / 401 可读报错 / 非法 JSON、**响应体挂起触发 deadline**、**调用方取消原样上抛**、
飞书链接解析、wiki→docx、表格与内嵌表格、附件/白板/图片、分页拉全 blocks、无权限/不存在/不支持类型、租户令牌缓存、授权码登录。
