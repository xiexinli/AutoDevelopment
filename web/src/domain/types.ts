/** 领域类型层 —— 由 `platform/design/数据模型.md` 生成，**请勿手改**。
 * 生成器：`.tmp/gen_types.py` ｜ 生成日期：2026-10-21 ｜ 实体：23 个。
 */
export interface Project {
  /** 系统生成 UUID，主键 */
  project_id: string;
  /** trim 后 1~50 可见字符（emoji/组合字符按可见 */
  name: string;
  /** 创建者 */
  owner_user_id: string;
  /** 见 §3.1.1，默认 created */
  stage: string;
  /** 最近一次 PRD 解析版本（可选） */
  current_revision_id?: string;
  /** 当前项目级版本（可选） */
  current_version_id?: string;
  /** 自适应深度档位（§F6）；默认 standard —— 〔2026-10-28 已废弃，改由 review_level 映射〕 */
  depth: "minimal" | "standard" | "comprehensive";
  /** PRD 审核分级（2026-10-28 定稿）：简审 quick / 标准 standard / 严格 strict；默认 standard */
  review_level: "quick" | "standard" | "strict";
  /** 严格档的「超严扩展」开关（仅 strict 有意义） */
  review_extended: boolean;
  /** 各模块已分配的最大序号，如 {"HOME":12,"CART */
  element_id_seq: Record<string, unknown>;
  /** 逻辑删除标记；写入后 30 天物理清除（可选） */
  deleted_at?: string;
}

export interface KbDoc {
  /** 主键 */
  kb_doc_id: string;
  /** 检索强制按此过滤（跨库即阻断） */
  project_id: string;
  /** [prd §F1] 列出的四类〔2026-10-22 按实现对齐：原 `doc_type`〕 */
  sector: "prd" | "spec" | "glossary" | "domain";
  /**  */
  title: string;
  /** Markdown（与交付格式一致） */
  content_md: string;
  /** 默认 agent_extracted */
  origin: "agent_extracted" | "user_edited" | "user_uploaded";
  /**  */
  updated_by: string;
}

export interface UploadFile {
  /** 主键 */
  file_id: string;
  /**  */
  project_id: string;
  /** 仅作展示；古怪文件名（空格/引号/非 ASCII/超长）与普（可选） */
  original_name?: string;
  /** 系统生成的存储键，不含用户可控路径（故无「越出根目录」风险） */
  storage_key: string;
  /** ≤ 20MB */
  size_bytes: unknown;
  /** 解析后回填；≤ 100 页（可选） */
  page_count?: number;
  /** 内容 SHA-256 */
  checksum: string;
  /**  */
  status: "uploading" | "uploaded" | "rejected";
  /** 仅 rejected 时非空（可选） */
  reject_reason?: "format_unsupported" | "too_large" | "too_many_pages" | "empty" | "corrupted";
}

export interface DocRevision {
  /** 主键。所有审核结论、评分卡都绑定它（D-A27） */
  revision_id: string;
  /**  */
  document_id: string;
  /** （可选） */
  file_id?: string;
  /** succeeded 与 partial 必须可区分（part */
  parse_status: "pending" | "parsing" | "succeeded" | "partial" | "failed";
  /** 逐块结果：{body:{status,chars}, tab */
  parts: Record<string, unknown>;
  /** 「解析成功但无内容」独立标记，与 failed 区分 */
  empty_document: boolean;
}

export interface Document {
  /**  */
  source_type: "file" | "feishu_link";
}

export interface Page {
  /**  */
  page_id: string;
  /**  */
  project_id: string;
  /** 页面名（可中文） */
  name: string;
  /** 元素 id 的模块段：英文短名，大写，2~12 字符，项目内 */
  module_code: string;
  /** 排序键 */
  order_index: number;
  /** 默认 draft */
  status: "draft" | "defined" | "generating" | "generated";
}

export interface Element {
  /** 主键，格式 EL-<模块>-<三位>；项目内全局唯一、不可复 */
  element_id: string;
  /**  */
  project_id: string;
  /**  */
  page_id: string;
  /** 空 = 根级；同一父下 order_index 唯一（可选） */
  parent_element_id?: string;
  /** 原子控件枚举，见 §4；每一取值对应唯一确定的 Androi */
  widget_type: string;
  /** 同级内顺序 */
  order_index: number;
  /** 仅供展示，不参与任何匹配（D-A32）（可选） */
  alias?: string;
  /** 默认 active；删除后置 void */
  status: "active" | "void";
  /** status=void 时非空（可选） */
  voided_at?: string;
}

export interface StyleProps {
  [k: string]: unknown;
}

export interface ElementEvent {
  /**  */
  event_id: string;
  /** 同一元素 最多 3 条（每 event_type 一条） */
  element_id: string;
  /** 三类可并存、互不排斥 */
  event_type: "click" | "long_click" | "double_click";
  /** 本期只取 none —— 只生成空回调存根（D-Q13 已确 */
  action_type: "none" | "navigate" | "api_call" | "track";
  /** none 时为空（可选） */
  action_payload?: Record<string, unknown>;
}

export interface ApiDef {
  /**  */
  api_id: string;
  /**  */
  project_id: string;
  /** 项目内唯一，形如 API-<模块>-<三位> */
  code: string;
  /** ；另有 path/method */
  name: string;
  /** 字段表：{name,type,required,length；另有 resp_schema（可选） */
  req_schema?: Record<string, unknown>;
  /** 完整枚举：string/int/long/double/bo */
  field_type: string;
  /** 默认 draft */
  status: "draft" | "effective" | "deprecated";
  /** 随项目级版本（可选） */
  version_id?: string;
}

export interface ProjectVersion {
  /**  */
  version_id: string;
  /**  */
  project_id: string;
  /** 项目内单调递增，展示为 v1/v2… */
  seq: number;
  /** 整包快照（Spec + 接口定义 + 能力配置 + 已生成安 */
  snapshot_ref: string;
  /** 与上一版本的 diff（接口按字段级、Spec 按文档级）（可选） */
  diff_ref?: string;
  /** 有且仅有一条 current */
  status: "current" | "superseded" | "rolled_back" | "archived";
  /** 操作人（版本卡片展示昵称）（可选） */
  created_by?: string;
  /** 变更摘要（可选） */
  summary?: string;
  /** 产物清单 enum{spec,apis,capabiliti（可选） */
  artifacts?: Record<string, unknown>;
}

export interface SpecDoc {
  /**  */
  spec_id: string;
  /**  */
  project_id: string;
  /** 五角色，项目内每角色最多一份当前版 */
  role: "ui" | "api" | "app" | "track" | "test";
  /** stale = 上游已变（重拆/回滚/major 变更） */
  status: "queued" | "generating" | "succeeded" | "failed" | "stale";
  /** 失败时为空（可选） */
  content_md?: string;
  /** ；另有 generated_at/error_code（可选） */
  version_id?: string;
}

export interface TrackPlan {
  /**  */
  track_id: string;
  /**  */
  project_id: string;
  /** EVT_<模块>_<动作>，项目内唯一 */
  event_key: string;
  /** 曝光/点击类事件的定位键（可选） */
  element_id?: string;
  /** 触发时机 */
  trigger_desc: string;
  /** 参数名/类型/必填（可选） */
  params?: Record<string, unknown>;
  /** 对应 S4 定方案 → S7 写码 → S8 验证 */
  status: "draft" | "confirmed" | "implemented" | "verified";
}

export interface CapabilityConfig {
  [k: string]: unknown;
}

export interface GenTask {
  /**  */
  task_id: string;
  /** ；另有 page_id */
  project_id: string;
  /** 单调递增；前后端只应用序号最新的结果（D-A13） */
  seq: number;
  /** 保留 canceled —— 生成中的任务允许取消（D-Q2 */
  status: "queued" | "running" | "succeeded" | "failed" | "timeout" | "canceled";
  /** project_id + 元素树哈希（D-A22） */
  idempotency_key: string;
  /** 元素树 + 样式 + 事件 + 元素 id 的规范化哈希 */
  input_hash: string;
  /** 同一输入的尝试次数，上限 3（D-A15） */
  attempt: number;
  /** 生成的代码产物（原子落盘：先写临时再改名）（可选） */
  artifact_ref?: string;
  /** {passed, checks:[{rule,ok,evid（可选） */
  l1_result?: Record<string, unknown>;
  /** {reported:bool, passed:bool, l（可选） */
  l2_result?: Record<string, unknown>;
  /** 见 §5.4（可选） */
  error_code?: string;
  /** 供 SSE 推送 */
  progress: number;
}

export interface VerifyTask {
  [k: string]: unknown;
}

export interface ReviewReport {
  /**  */
  review_id: unknown;
  /**  */
  project_id: unknown;
  /**  */
  revision_id: unknown;
  /**  */
  standard_version: number;
  /**  */
  verdict: "running" | "passed" | "blocked" | "failed";
  /**  */
  counts: Record<string, unknown>;
  /**  */
  superseded: boolean;
  /** 本次审核使用的等级（2026-10-28 分级定稿） */
  review_level: "quick" | "standard" | "strict";
  /** 本次是否开启「超严扩展」 */
  review_extended: boolean;
}

export interface GateQuestion {
  /**  */
  question_code: string;
  /**  */
  review_id: unknown;
  /**  */
  level: "blocking" | "major" | "suggestion";
  /**  */
  title: unknown;
  /**  */
  options: Record<string, unknown>;
  /**  */
  fallback: "not_yet_defined" | "none" | "not_identified" | "not_applicable";
  /** （可选） */
  answer?: string;
  /**  */
  status: "open" | "answered" | "converted";
  /** （可选） */
  impact?: string;
}

export interface Assumption {
  /**  */
  assumption_code: unknown;
  /**  */
  review_id: unknown;
  /**  */
  content: string;
  /**  */
  source_tag: string;
  /**  */
  choice: "unset" | "accept" | "convert" | "unset";
  /** （可选） */
  converted_question_code?: unknown;
}

export interface ChatMessage {
  /**  */
  message_id: unknown;
  /**  */
  project_id: unknown;
  /**  */
  seq: number;
  /**  */
  role: "user" | "agent" | "system";
  /**  */
  content_md: string;
  /**  */
  status: "sent" | "streaming" | "failed";
}

export interface GateStandard {
  /**  */
  standard_id: unknown;
  /**  */
  project_id: string;
  /**  */
  version: number;
  /**  */
  items: Record<string, unknown>;
  /**  */
  is_current: boolean;
}

export interface User {
  /**  */
  user_id: string;
  /**  */
  role: "requester" | "admin";
  /** （可选） */
  nickname?: string;
  /** （可选） */
  avatar_url?: string;
  /** （可选） */
  deleted_at?: string;
}

export interface ReviewItem {
  /**  */
  review_id: string;
  /**  */
  item_code: string;
  /**  */
  level: "blocking" | "major" | "suggestion";
  /**  */
  verdict: "pass" | "fail" | "na";
  /** （可选） */
  evidence_ref?: string;
}
