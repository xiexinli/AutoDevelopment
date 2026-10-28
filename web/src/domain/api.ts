/** 平台自身接口清单 —— 由 `platform/design/接口契约.md` 生成，**请勿手改**。
 * 生成器：`.tmp/gen_types.py` ｜ 生成日期：2026-10-21 ｜ 共 71 个接口。
 * 约定：Base URL `/api/v1/`；鉴权 `Authorization: Bearer <token>`；
 * 统一响应包 `{ code, message, data, request_id }`；时间一律 UTC ISO-8601。
 */

export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
  request_id: string;
}

export interface ApiEndpoint {
  /** 接口编号（对应 `接口契约` 的 `#n`） */
  no: string;
  method: string;
  path: string;
  desc: string;
}

export const ENDPOINTS = [
  { no: "1", method: "GET", path: "/projects", desc: "列表，支持 q / 分页 / 排序（§0.3）" },
  { no: "2", method: "POST", path: "/projects", desc: "新建；body {name, description?}；返回 project_id" },
  { no: "3", method: "GET", path: "/projects/{project_id}", desc: "详情（含 stage、current_revision_id、current_version_id）" },
  { no: "4", method: "PATCH", path: "/projects/{project_id}", desc: "重命名 / 改说明；须 If-Match" },
  { no: "5", method: "DELETE", path: "/projects/{project_id}", desc: "逻辑删除，30 天后物理清除" },
  { no: "6", method: "GET", path: "/projects/{project_id}/stats", desc: "顶部状态条：门禁状态徽标、版本号、任务进行中数量、loopback_round（回流轮次 1~3，〔2026-10-21" },
  { no: "7", method: "GET", path: "/projects/{project_id}/kb-docs", desc: "列表（强制按 project_id 过滤，跨项目检索不可能发生）" },
  { no: "8", method: "GET", path: "/kb-docs/{kb_doc_id}", desc: "详情（Markdown 原文）" },
  { no: "9", method: "PUT", path: "/kb-docs/{kb_doc_id}", desc: "用户编辑（origin 置 user_edited）；须 If-Match" },
  { no: "10", method: "POST", path: "/projects/{project_id}/uploads", desc: "multipart/form-data；file + Idempotency-Key；≤20MB / ≤100 页；返回" },
  { no: "11", method: "POST", path: "/projects/{project_id}/documents", desc: "从飞书链接建文档；body {source_type:\"feishu_link\", feishu_token}" },
  { no: "12", method: "POST", path: "/documents/{document_id}/revisions", desc: "触发解析，返回 task_id；重复上传 → 新建 revision，旧的保留" },
  { no: "13", method: "GET", path: "/documents/{document_id}/revisions", desc: "revision 列表（倒序）" },
  { no: "14", method: "GET", path: "/revisions/{revision_id}/parse-result", desc: "分块结果 parts{} + parse_status + empty_document" },
  { no: "15", method: "POST", path: "/revisions/{revision_id}/parts/{part_key}/manual-supplement", desc: "部分解析失败时的手动补充入口" },
  { no: "16", method: "POST", path: "/revisions/{revision_id}/reviews", desc: "触发门禁审核，返回 task_id + review_id；请求体可带可选 level（quick/standard/strict）+ extended" },
  { no: "17", method: "GET", path: "/reviews/{review_id}", desc: "评分卡：verdict / counts{} / standard_version / superseded" },
  { no: "18", method: "GET", path: "/reviews/{review_id}/items", desc: "评分卡逐项（含 gate_code、level、verdict、evidence_ref）" },
  { no: "19", method: "GET", path: "/reviews/{review_id}/questions", desc: "待澄清清单（level / options / fallback / status / impact，〔2026-10-" },
  { no: "20", method: "POST", path: "/questions/{question_code}/answers", desc: "逐条作答；body {answer}" },
  { no: "21", method: "GET` / `POST", path: "/reviews/{review_id}/assumptions", desc: "假设清单；POST 提交 {choice:\"accept\"\\" },
  { no: "22", method: "POST", path: "/reviews/{review_id}/accept-candidates", desc: "一键采纳 = 仅批量勾选（不写 PRD）" },
  { no: "23", method: "POST", path: "/reviews/{review_id}/writeback", desc: "显式确认后才回写原 PRD；body {confirm:true, accepted_items[], snapshot" },
  { no: "24", method: "GET` / `PUT", path: "/projects/{project_id}/gate-standards", desc: "项目级门禁标准 + 版本（〔2026-10-21 裁决 · P0-补口裁决单〕 Q3）；PUT 每次保存版本 +1，历史" },
  { no: "25", method: "GET", path: "/projects/{project_id}/chat/messages", desc: "历史（按 seq 升序；串行处理，禁并发改写同一 PRD）" },
  { no: "26", method: "POST", path: "/projects/{project_id}/chat/messages", desc: "发送；body {content}（≤20000 字符）；回复经 SSE chat.delta 流式回传" },
  { no: "27", method: "POST", path: "/chat/messages/{message_id}/retry", desc: "失败重发；不重复入库" },
  { no: "28", method: "POST", path: "/projects/{project_id}/splits", desc: "重新拆解；同一项目同一时刻只允许一个，重复触发 → 409；旧 Spec 归档不删；请求体可带可选 depth（覆盖项目" },
  { no: "29", method: "GET", path: "/projects/{project_id}/requirements", desc: "角色需求包 + REQ-ID 列表（q / 分页）" },
  { no: "30", method: "POST", path: "/projects/{project_id}/specs:generate", desc: "生成 5 份 Spec；单份失败不阻断其余" },
  { no: "31", method: "GET", path: "/projects/{project_id}/specs", desc: "五份列表（含 status / stale / error_code）" },
  { no: "32", method: "GET", path: "/specs/{spec_id}", desc: "单份 Markdown 内容" },
  { no: "33", method: "GET", path: "/specs/{spec_id}/export", desc: "导出 .md（需鉴权；不写入访问日志正文）" },
  { no: "34", method: "POST", path: "/projects/{project_id}/specs/{spec_id}/proofread", desc: "角色校对 → 补充要求清单" },
  { no: "35", method: "GET", path: "/projects/{project_id}/pages", desc: "页面列表" },
  { no: "36", method: "POST", path: "/pages/{page_id}/elements", desc: "新增控件；id 由服务端集中分配（客户端只持临时 id）；超 200 → 400" },
  { no: "37", method: "PATCH", path: "/elements/{element_id}", desc: "改 alias / parent_element_id / order_index；须 If-Match" },
  { no: "38", method: "DELETE", path: "/elements/{element_id}", desc: "置 status=void（id 不可回收、不可复用）" },
  { no: "39", method: "PUT", path: "/elements/{element_id}/style", desc: "全量样式（11 项）；服务端二次校验取值域；须 If-Match（〔2026-10-21 裁决 · P0-补口裁决单〕 " },
  { no: "40", method: "PUT", path: "/elements/{element_id}/events", desc: "事件（≤3 条）；action_type 默认 none；须 If-Match（〔2026-10-21 裁决 · P0-" },
  { no: "41", method: "GET", path: "/projects/{project_id}/element-id-ledger", desc: "id 台账（含已作废 id，可查不可用）" },
  { no: "42", method: "GET", path: "/pages/{page_id}/draft` / `PUT", desc: "画布草稿读写（未提交改动绝不静默丢弃）" },
  { no: "43", method: "POST", path: "/pages/{page_id}/generations", desc: "提交变更 → 生成任务；body {input_hash, Idempotency-Key}；seq 单调递增" },
  { no: "44", method: "GET", path: "/tasks/{task_id}", desc: "任务状态（queued/running/succeeded/failed/timeout/canceled）+ prog" },
  { no: "44a", method: "POST", path: "/tasks/{task_id}/cancel", desc: "取消生成中的任务（D-Q22 已确认）：终止任务、丢弃本次产物、不写入项目版本；任务状态置 canceled；非失败态，" },
  { no: "45", method: "GET", path: "/projects/{project_id}/tasks/stream", desc: "SSE（见 §0.4）" },
  { no: "46", method: "POST", path: "/tasks/{task_id}/build-report", desc: "本地构建代理回传 {passed, log_digest}；绑定该次生成任务；未回传不阻断用户（工程仅标「未验证构建」）" },
  { no: "47", method: "GET", path: "/tasks/{task_id}/artifacts", desc: "生成的代码产物（源码 + gradle wrapper + 依赖版本锁定清单）" },
  { no: "48", method: "POST", path: "/tasks/{task_id}/verifications/{verify_id}/retry", desc: "重试（自动重试上限 3 次，超过 → 需人工介入）" },
  { no: "49", method: "GET", path: "/tasks/{task_id}/verifications", desc: "L1 / L2 两次验证的证据（逐规则结果、日志摘要）" },
  { no: "50", method: "GET` / `POST", path: "/projects/{project_id}/apis", desc: "清单（q / 状态筛选 / 分页）/ 新建" },
  { no: "51", method: "GET` / `PATCH", path: "/apis/{api_id}", desc: "详情 / 编辑（须 If-Match）→ 冲突 409" },
  { no: "52", method: "DELETE", path: "/apis/{api_id}", desc: "删除（下次生成版本后生效；引用它的 Spec 标「需复核」）" },
  { no: "53", method: "PUT", path: "/apis/{api_id}/schema", desc: "字段表（field_type 为完整 8 项枚举，禁「等」）；须 If-Match（〔2026-10-21 裁决 · P" },
  { no: "54", method: "GET", path: "/projects/{project_id}/versions", desc: "版本列表（seq 倒序；current 唯一）；每项含 created_by / created_by_name / s" },
  { no: "55", method: "POST", path: "/projects/{project_id}/versions", desc: "打版本（整包快照）" },
  { no: "56", method: "GET", path: "/versions/{version_id}/diff", desc: "diff（接口字段级、Spec 文档级）" },
  { no: "57", method: "POST", path: "/versions/{version_id}/rollback", desc: "整包回滚（Spec / 接口 / 能力配置 / 安卓代码 / 埋点方案）；多步写入要么全成要么全不成；快照只读保留" },
  { no: "58", method: "GET` / `PUT", path: "/projects/{project_id}/capabilities", desc: "7 项（默认全关）；保存即生成；PUT 前自动备份旧代码；须 If-Match；出参含 conflicts[]=[{li" },
  { no: "59", method: "GET", path: "/projects/{project_id}/tracking-plan", desc: "埋点方案（EVT_<模块>_<动作>）" },
  { no: "60", method: "GET", path: "/projects/{project_id}/deliverables", desc: "交付归档（Spec 包 + 安卓工程）" },
  { no: "61", method: "POST", path: "/projects/{project_id}/deliverables/export", desc: "打包导出（需鉴权）" },
  { no: "62", method: "POST", path: "/metrics/events", desc: "平台自身埋点上报（批量）；请求体 {schema_version, batch:[…]}，失败响应 rejected[]" },
  { no: "63", method: "GET", path: "/auth/feishu/qrcode", desc: "取飞书登录二维码（qrcode_url / expires_in_seconds(120) / state）" },
  { no: "64", method: "GET", path: "/auth/feishu/qrcode/{state}", desc: "扫码状态（pending_scan/scanned/expired/confirmed；1.5s 轮询）；confirm" },
  { no: "65", method: "POST", path: "/auth/logout", desc: "登出（失效当前 token）" },
  { no: "66", method: "GET", path: "/users/me", desc: "当前用户信息（user_id(=open_id) / nickname / avatar_url / role）" },
  { no: "67", method: "GET", path: "/projects/{project_id}/traceability-matrix", desc: "需求追溯矩阵（四态 + 孤儿检测）；items[]={req_id,summary,targets{},coverage" },
  { no: "68", method: "GET` / `PUT", path: "/users/me/ai-egress", desc: "外发大模型：告知确认状态 + 用户级开关；egress_enabled/policy_text/disabled_rea" },
  { no: "69", method: "GET", path: "/projects/{project_id}/reviews/{review_id}/export", desc: "导出审核报告（需鉴权、不含密钥）（🆕 〔2026-10-21 裁决 · P0-补口裁决单〕 [缺口-APP-03]）" },
  { no: "70", method: "POST", path: "/projects/{project_id}/abort", desc: "中止并归档本流程（超限二选一的「中止」落点）（🆕 〔2026-10-21 裁决 · P0-补口裁决单〕 [缺口-APP-" },
] as const;

export type EndpointNo = (typeof ENDPOINTS)[number]["no"];
