/**
 * 会话状态（登录 token / 当前用户）—— 单例，非响应式框架依赖。
 * 草稿栈与全局会话后续切片接入（REQ-UIEDIT-007）。
 */
import { request, newIdempotencyKey, IS_MOCK, ApiError } from "@/api/client";
import type { Project, User } from "@/domain/types";
import type { ElementNode } from "@/editor/model";
import type { ChatThreadRef } from "@/chat/thread";

const TOKEN_KEY = "ad.token";

export const session = {
  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  set token(v: string | null) {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

// ---------- 接口封装（编号与 `接口契约` 的 `#n` 对应） ----------

/** #63 取飞书登录二维码 */
export function fetchQrcode() {
  return request<{ qrcode_url: string; expires_in_seconds: number; state: string }>(
    "/auth/feishu/qrcode",
  );
}

/** #72 可用的登录方式（据此决定默认展示哪种，不猜） */
export function fetchAuthMethods() {
  return request<{ password_login: boolean; password_login_hint: string; feishu_login: "real" | "development" }>(
    "/auth/methods",
  );
}

/** #72 账号 + 密码登录 */
export function passwordLogin(username: string, password: string) {
  return request<{ token: string; created: boolean; user: User }>("/auth/password/login", {
    method: "POST",
    body: { username, password },
  });
}

/** #64 扫码状态（1.5s 轮询） */
export function fetchScanStatus(state: string) {
  return request<{ scan_status: "pending_scan" | "scanned" | "expired" | "confirmed"; token?: string }>(
    `/auth/feishu/qrcode/${encodeURIComponent(state)}`,
  );
}

/** #65 登出 */
export function logout() {
  return request<null>("/auth/logout", { method: "POST" });
}

/** #66 当前用户信息 */
export function fetchMe() {
  return request<User>("/users/me");
}

export interface ProjectListItem {
  project_id: string;
  name: string;
  stage: string;
  updated_at: string;
  created_at: string;
  version: number;
  /** `new` | `imported`（F17 工程接入，2026-10-29） */
  source_kind?: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
  sort: string;
  failed_parts: string[];
}

/** #1 项目列表（分页 20/50/100；稳定次序键 = updated_at + id 升序） */
export function listProjects(query: {
  q?: string;
  page?: number;
  page_size?: number;
  sort?: string;
}) {
  return request<Paged<ProjectListItem>>("/projects", { query });
}

/** #2 新建项目（提交类 → 带幂等键） */
export function createProject(name: string, description: string) {
  return request<{ project_id: string; name: string; stage: string; created_at: string; version: number }>(
    "/projects",
    { method: "POST", body: { name, description }, idempotencyKey: newIdempotencyKey() },
  );
}

/** #4 重命名 / 改说明（乐观锁 → 须带 If-Match） */
export function patchProject(projectId: string, body: { name?: string; description?: string }, version: number) {
  return request<Project>(`/projects/${projectId}`, {
    method: "PATCH",
    body,
    ifMatch: version,
    idempotencyKey: newIdempotencyKey(),
  });
}

/** #5 逻辑删除（30 天后物理清除；`⬛` 破坏性操作 → 服务端亦校验，须显式 `confirm:true`） */
export function deleteProject(projectId: string) {
  return request<{ deleted_at: string }>(`/projects/${projectId}`, { method: "DELETE", body: { confirm: true } });
}

/** #N1 接入已有工程（F17）：登记本机工程根目录 → 只读扫描 → 约束包落库 */
export function engineeringIntake(projectId: string, root: string) {
  return request<{
    source_kind: string; engineering_root: string; kb_doc_id: string;
    project_name: string | null;
    android: { agp: string | null; kotlin: string | null; gradle: string | null;
      compile_sdk: number | null; min_sdk: number | null; target_sdk: number | null; java: string | null };
    counts: { modules: number; dependencies: number; agent_config_files: number; items: number; naming_samples: number };
    warnings: string[];
  }>(`/projects/${projectId}/engineering-intake`, {
    method: "POST", body: { root, confirm: true }, idempotencyKey: newIdempotencyKey(),
  });
}

export interface ConstraintPackView {
  source_kind: string; engineering_root: string | null;
  pack: Record<string, unknown> | null;
  kb_doc_id: string | null; content_md: string; origin: string | null;
  version: number; updated_at: string | null; summary: string;
}
/** #N2 读工程约束 */
export function fetchConstraints(projectId: string) {
  return request<ConstraintPackView>(`/projects/${projectId}/constraints`);
}
/** #N3 编辑工程约束（乐观锁 → 须带 If-Match） */
export function saveConstraints(projectId: string, contentMd: string, version: number) {
  return request<{ kb_doc_id: string; origin: string; version: number; updated_at: string }>(
    `/projects/${projectId}/constraints`,
    { method: "PUT", body: { content_md: contentMd }, ifMatch: version, idempotencyKey: newIdempotencyKey() },
  );
}

/** #N7 把某次生成任务的产物按既有工程结构合并后写回（二期 brownfield） */
export function writebackGeneration(projectId: string, taskId: string) {
  return request<{
    patch_id: string; status: string;
    totals: { create: number; replace: number; unchanged: number; bytes: number };
    entries: { path: string; action: string; removed_ids: string[] }[];
    notes: string[]; skipped: { path: string; reason: string }[];
  }>(`/projects/${projectId}/generation/${taskId}/writeback`, {
    method: "POST", body: { confirm: true }, idempotencyKey: newIdempotencyKey(),
  });
}

export interface PatchApplicationItem {
  patch_id: string; status: string; message: string; created_at: string; rolled_back_at: string | null;
  totals: { create: number; replace: number; unchanged: number; bytes: number };
  files: string[];
}
/** #N5 补丁记录（倒序） */
export function listPatchApplications(projectId: string) {
  return request<{ items: PatchApplicationItem[]; total: number }>(`/projects/${projectId}/patch-applications`);
}
/** #N6 回滚某次补丁（`⬛` 破坏性 → 二次确认） */
export function rollbackPatchApplication(projectId: string, patchId: string) {
  return request<{ patch_id: string; status: string; rolled_back_at: string; restored: number; removed: number }>(
    `/projects/${projectId}/patch-applications/${patchId}/rollback`,
    { method: "POST", body: { confirm: true }, idempotencyKey: newIdempotencyKey() });
}

/** #3 项目详情（含 current_revision_id） */
export function fetchProject(projectId: string) {
  return request<{ project_id: string; name: string; stage: string; version: number;
    current_revision_id?: string; depth: "minimal" | "standard" | "comprehensive";
    /** `new` | `imported`（F17 工程接入，2026-10-29） */
    source_kind?: string; engineering_root?: string | null;
    /** 项目级默认审核等级（2026-10-28 分级定稿） */
    review_level: "quick" | "standard" | "strict"; review_extended: boolean }>(
    `/projects/${projectId}`);
}

/** #6 顶部状态条 */
export function fetchStats(projectId: string, signal?: AbortSignal) {
  return request<{
    stage: string; version_seq: number; running_tasks: number; loopback_round: number;
    /** 项目当前 revision；没有解析产出时为 `null` */
    current_revision_id: string | null;
    /**
     * `#6` 也返回门禁徽标（`UI-Spec` 的字段名按实况对齐）；审核页用它区分三态：
     * `unreviewed` → 空态；`review_revision_id !== current_revision_id` → 「已过期」；其余 → 复用已有报告。
     */
    gate?: {
      verdict: "unreviewed" | "running" | "blocked" | "passed"; blocking_count: number; major_count: number;
      /** 最新一条审核报告绑定的 revision；无报告为 `null` */
      review_revision_id: string | null;
      /** 项目当前审核等级 + 超严扩展开关（2026-10-28 分级定稿） */
      review_level: "quick" | "standard" | "strict"; review_extended: boolean;
    };
  }>(`/projects/${projectId}/stats`, { signal });
}

// ==================== S2：上传 / 审核 / 拆解 ====================

// ---------- 上传与解析 ----------
export interface ParseParts {
  body: { status: "ok" | "failed" | "skipped"; chars?: number };
  tables: { token: string; status: "ok" | "failed" | "skipped" }[];
  whiteboards: { token: string; status: "ok" | "failed" | "skipped" }[];
  attachments: { name: string; status: "ok" | "failed" | "skipped" }[];
}

/** #10 上传文件（multipart；≤20MB / ≤100 页；幂等） */
export function uploadFile(projectId: string, file: File, onProgress?: (percent: number) => void) {
  const fd = new FormData();
  fd.append("file", file);
  return request<{ file_id: string; document_id: string; size_bytes: number; status: string }>(
    `/projects/${projectId}/uploads`,
    { method: "POST", formData: fd, idempotencyKey: newIdempotencyKey(), onUploadProgress: onProgress },
  );
}

/** #11 从飞书链接建文档 */
export function createDocFromLink(projectId: string, link: string) {
  return request<{ document_id: string; source_type: string }>(`/projects/${projectId}/documents`, {
    method: "POST", body: { source_type: "feishu_link", feishu_token: link },
  });
}

/** #12 触发解析（⚡ 长任务） */
export function triggerParse(documentId: string) {
  return request<{ task_id: string; revision_id: string }>(
    `/documents/${documentId}/revisions`,
    { method: "POST", idempotencyKey: newIdempotencyKey() },
  );
}

/** #13 revision 列表（倒序） */
export function listRevisions(documentId: string) {
  return request<{ items: { revision_id: string; document_id: string; parse_status: string; created_at: string }[] }>(
    `/documents/${documentId}/revisions`,
  );
}

/** #14 分块解析结果 */
export function fetchParseResult(revisionId: string) {
  return request<{ parse_status: string; empty_document: boolean; parts: ParseParts }>(
    `/revisions/${revisionId}/parse-result`,
  );
}

/** #15 部分解析失败的手动补充 */
export function supplementPart(revisionId: string, partKey: string, content: string) {
  return request<{ part_key: string; supplemented: boolean }>(
    `/revisions/${revisionId}/parts/${encodeURIComponent(partKey.replace(/^内嵌表格 · /,"table:").replace(/^白板图 · /,"whiteboard:").replace(/^附件 · /,"attachment:").replace(/^正文$/,"body"))}/manual-supplement`,
    { method: "POST", body: { content } },
  );
}

// ---------- 门禁审核 ----------
export type Level = "blocking" | "major" | "suggestion";

/** PRD 审核分级（2026-10-28 定稿）：简审 / 标准 / 严格 */
export type ReviewLevel = "quick" | "standard" | "strict";

export interface ReviewItem {
  item_code: string; group: string; group_title?: string; level: Level;
  verdict: "pass" | "fail" | "na"; evidence_ref: string; suggestion: string; accepted: boolean;
  /** 未通过项 · 用户补充信息（随 `#23` 写回 PRD；回写前为本地态） */
  supplement?: string;
}
export interface GateQuestion {
  question_code: string; level: Level; title: string; options: string[];
  fallback: string; impact: string; answer: string; status: "open" | "answered";
}
export interface Assumption {
  assumption_code: string; content: string; source_tag: string; choice: "unset" | "accept" | "convert";
}

/**
 * `#16` 触发门禁审核。
 * `force=false`（默认）：服务端**复用**同 revision + 同门禁标准 + 同深度且未作废的已有报告
 *   （进页自动加载走这条 —— 不新建报告、不作废旧报告、不调用模型）；
 * `force=true`：强制重跑（「重新审核 / 提交复审 / 重试」走这条）。
 * `task_id` 为 `null` 表示「复用了已有终态报告」，调用方**不要**再轮询任务。
 */
export function triggerReview(revisionId: string, opts: { force?: boolean; level?: ReviewLevel; extended?: boolean } = {}) {
  const body: { force?: boolean; level?: ReviewLevel; extended?: boolean } = {};
  if (opts.force) body.force = true;
  if (opts.level) body.level = opts.level;
  if (opts.extended !== undefined) body.extended = opts.extended;
  return request<{ review_id: string; task_id: string | null; standard_version: number; depth?: string;
    level?: ReviewLevel; extended?: boolean; reused?: boolean }>(
    `/revisions/${revisionId}/reviews`,
    { method: "POST", body, idempotencyKey: newIdempotencyKey() },
  );
}

/** #17 评分卡 */
export function fetchReview(reviewId: string) {
  return request<{ review_id: string; verdict: "running" | "passed" | "blocked" | "failed";
    counts: { blocking: number; major: number; suggestion: number; na?: number };
    standard_version: number; superseded: boolean; revision_id: string; model: string;
    /** 本次审核使用的等级 + 是否超严扩展（结论随等级而变，界面必须显示） */
    review_level: ReviewLevel; review_extended: boolean;
    prd?: {revision_id:string;document_id:string;kb_doc_id:string;version:number;content_hash:string} | null }>(`/reviews/${reviewId}`);
}

/** #18 评分卡逐项 */
export function fetchReviewItems(reviewId: string) {
  return request<{ items: ReviewItem[] }>(`/reviews/${reviewId}/items`);
}

/** #19 待澄清清单 */
export function fetchQuestions(reviewId: string) {
  return request<{ items: GateQuestion[] }>(`/reviews/${reviewId}/questions`);
}

/** #20 逐条作答 */
export function answerQuestion(questionCode: string, answer: string) {
  return request<{ question_code: string; status: string }>(`/questions/${encodeURIComponent(questionCode)}/answers`, {
    method: "POST", body: { answer },
  });
}

/** #21 假设清单 */
export function fetchAssumptions(reviewId: string) {
  return request<{ items: Assumption[] }>(`/reviews/${reviewId}/assumptions`);
}
export function decideAssumption(reviewId: string, code: string, choice: "accept" | "convert") {
  return request<{ assumption_code: string; choice: string }>(`/reviews/${reviewId}/assumptions`, {
    method: "POST", body: { assumption_code: code, choice },
  });
}

/** #22 一键采纳 = 仅批量勾选（**不写 PRD**） */
export function acceptCandidates(reviewId: string, itemCodes: string[]) {
  return request<{ accepted_items_count: number }>(`/reviews/${reviewId}/accept-candidates`, {
    method: "POST", body: { item_codes: itemCodes }, idempotencyKey: newIdempotencyKey(),
  });
}

/** #23 回写原 PRD（显式确认）。`supplements` = 未通过项的补充信息，只随「已勾选」条目写入。 */
export function writeback(reviewId: string, acceptedItems: string[], supplements: { item_code: string; text: string }[] = [], answers: {question_code:string;answer:string}[] = []) {
  return request<{ deleted_lines: number; modified_lines: number; added_lines: number; snapshot: boolean;
    diff_summary:{deleted_lines:number;modified_lines:number;added_lines:number};changed:boolean;
    new_revision_id:string;kb_doc_id:string;kb_version:number;content_hash:string;sections_added:string[] }>(
    `/reviews/${reviewId}/writeback`,
    { method: "POST", body: { confirm: true, accepted_items: acceptedItems, supplements, answers, snapshot: true }, idempotencyKey: newIdempotencyKey() },
  );
}

/** #24 门禁标准（项目级） */
export function fetchGateStandard(projectId: string) {
  return request<{ standard_id: string; version: number; is_current: boolean;
    items: { code: string; level: Level; title: string }[] }>(`/projects/${projectId}/gate-standards`);
}
export function saveGateStandard(projectId: string, items: { code: string; level: Level; title: string }[], version: number) {
  return request<{ standard_id: string; version: number; is_current: boolean }>(
    `/projects/${projectId}/gate-standards`, { method: "PUT", body: { items }, ifMatch:version, idempotencyKey: newIdempotencyKey() },
  );
}

/** #69 导出审核报告（需鉴权、不含密钥） */
export function exportReviewReport(projectId: string, reviewId: string) {
  return request<{ export_id: string; format: string; content_md?: string }>(
    `/projects/${projectId}/reviews/${reviewId}/export`,
  );
}

// ---------- 拆解 ----------
export interface RolePack { role: string; reqs: string[] }

/** #28 重新拆解（同项目同时刻只允许一个；可带可选 depth 覆盖） */
export function triggerSplit(projectId: string, depth?: "minimal" | "standard" | "comprehensive") {
  return request<{ task_id: string }>(`/projects/${projectId}/splits`, {
    method: "POST", body: depth ? { depth } : {}, idempotencyKey: newIdempotencyKey(),
  });
}

/** #29 角色需求包 + REQ-ID 列表 */
export function fetchRequirements(projectId: string) {
  return request<Paged<RolePack> & { depth: string; requirement_count: number }>(`/projects/${projectId}/requirements`);
}

/** #59 埋点方案（被开发项目的） */
export function fetchTrackingPlan(projectId: string) {
  return request<{ items: { event_key: string; trigger_desc: string; params: string[]; element_id: string }[] }>(
    `/projects/${projectId}/tracking-plan`,
  );
}

/** #67 需求追溯矩阵（四态 + 孤儿检测；**四态必须由接口给出，不得前端估算**） */
/** 覆盖状态四态：**由接口给出**，前端只渲染、不自行估算（`UI-Spec §4.7`） */
export type CoverageStatus = "OK" | "GAP" | "N/A" | "Deferred";
export interface TraceRow {
  req_id: string; summary: string;
  /** 五列**每列必有值**：`ui` / `api` / `app` / `track` / `test` */
  targets: Record<string, string>;
  coverage_status: CoverageStatus;
  /** 孤儿检测：**有 target 但无 REQ** 或 **有 REQ 但无 target** */
  orphan: boolean;
}
export function fetchTraceability(projectId: string, query?: { page?: number; page_size?: number; q?: string; coverage_status?: string }) {
  return request<Paged<TraceRow> & { orphan_count: number; total_orphan_count: number }>(
    `/projects/${projectId}/traceability-matrix`, { query });
}

// ---------- 外发大模型（P0 合规） ----------
export interface AiEgress {
  egress_enabled: boolean; policy_text: string; disabled_reason: string;
  consent_acknowledged_at: string | null;
}
/** #68 告知确认状态 + 用户级开关 */
export function fetchAiEgress() {
  return request<AiEgress>("/users/me/ai-egress");
}
export function updateAiEgress(body: { egress_enabled?: boolean; consent_acknowledged?: boolean }) {
  return request<AiEgress>("/users/me/ai-egress", { method: "PUT", body, idempotencyKey: newIdempotencyKey() });
}

// ==================== S3：可视化编辑（画布） ====================

/** #35 页面列表 */
export function fetchPages(projectId: string) {
  return request<{ items: { page_id: string; module_code: string; name: string; order_index: number; status: string }[] }>(
    `/projects/${projectId}/pages`);
}

export interface GenerationReceipt { task_id: string; seq: number; status: string; page_id?: string; project_id?: string }
export interface SuccessfulPreview { task_id: string; seq: number; at: string; tree: ElementNode[] }
export interface PageDraft {
  tree: ElementNode[]; id_base: Record<string, number>; version: number; updated_at: string;
  last_success: SuccessfulPreview | null; running_tasks: GenerationReceipt[]; latest_seq: number;
}
export interface TaskState {
  task_id: string; type: string; page_id?: string; project_id?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "timeout" | "canceled";
  phase?: "generating" | "verifying" | string; progress: number; seq: number; attempt?: number;
  error_code?: string | null; error_message?: string | null; result_ref?: unknown;
  finished_at?: string | null;
  l2_result?: { reported: boolean; passed: boolean; log_digest: string; source?: string } | null;
}
/** 来源是服务端验证后的标识；普通 Bearer 回传不能据 reported/passed 冒充可信 L2。 */
export function buildResultDisplay(result: TaskState["l2_result"]): { label: string; color: "success" | "error" | "default" } {
  if (!result?.reported) return { label: "未验证构建", color: "default" };
  if (result.source !== "local-build-agent") return { label: "回传来源未验证", color: "default" };
  return { label: result.passed ? "L2 构建通过" : "L2 构建失败", color: result.passed ? "success" : "error" };
}
export interface VerificationEvidence {
  verify_id: string; layer: "L1" | "L2"; status: string; attempt: number;
  rules: { rule: string; ok: boolean; detail?: string }[]; log_digest: string;
}
export interface VerificationResult {
  items: VerificationEvidence[]; preview_tree?: ElementNode[]; generated_at?: string;
}
export interface Artifact { path: string; kind: string; content: string; encoding?: string }

/** #42 服务端分配正式 ID；只有 mock 兼容旧的轻量响应。 */
export async function fetchDraft(pageId: string, signal?: AbortSignal): Promise<PageDraft> {
  try {
    const r = await request<PageDraft>(`/pages/${encodeURIComponent(pageId)}/draft`, { signal });
    return IS_MOCK ? { ...r, version: r.version ?? 0, last_success: r.last_success ?? null, running_tasks: r.running_tasks ?? [], latest_seq: r.latest_seq ?? 0 } : r;
  } catch (e) {
    if (IS_MOCK && e instanceof ApiError && e.code === "NOT_FOUND") {
      return { tree: [], id_base: {}, version: 0, updated_at: "", last_success: null, running_tasks: [], latest_seq: 0 };
    }
    throw e;
  }
}
export async function submitDraft(pageId: string, tree: ElementNode[], idBase: Record<string, number>, version: number, signal?: AbortSignal): Promise<PageDraft> {
  const r = await request<PageDraft>(`/pages/${encodeURIComponent(pageId)}/draft`, {
    method: "PUT", body: { tree, id_base: idBase }, ifMatch: version, signal,
    idempotencyKey: newIdempotencyKey(),
  });
  // Mock 没有 ID 分配与成功快照，不能据此冒充真实生成预览。
  return IS_MOCK ? { ...r, tree: r.tree ?? tree, id_base: r.id_base ?? idBase, version: r.version ?? version + 1,
    last_success: r.last_success ?? null, running_tasks: r.running_tasks ?? [], latest_seq: r.latest_seq ?? 0 } : r;
}

/** #41 元素 id 台账（包含 void，不从本地草稿拼接“真值”）。 */
export function fetchElementLedger(projectId: string, signal?: AbortSignal) {
  return request<{ items: { element_id: string; alias: string; status: "active" | "void"; voided_at: string | null }[] }>(
    `/projects/${encodeURIComponent(projectId)}/element-id-ledger`, { signal });
}

/** SHA256 必须对 #42 返回的 tree 原样 JSON.stringify，不做排序/弱 hash。 */
export async function hashTree(tree: ElementNode[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(tree));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** #43 服务端读取已保存的树；base_seq 是项目最新 code_gen 序号，缺失 400 / 过旧 409。 */
export function submitGeneration(pageId: string, payload: { input_hash: string; base_seq: number }, signal?: AbortSignal) {
  if (!Number.isSafeInteger(payload.base_seq) || payload.base_seq < 0) {
    throw new ApiError("INVALID_ARGUMENT", 400, "提交生成必须提供项目最新 base_seq（非负整数）。");
  }
  return request<GenerationReceipt>(`/pages/${encodeURIComponent(pageId)}/generations`, {
    method: "POST", body: { input_hash: payload.input_hash, base_seq: payload.base_seq }, signal, idempotencyKey: newIdempotencyKey(),
  });
}

/** #44 / #45 重连轮询 */
export function fetchTask(taskId: string, signal?: AbortSignal) {
  return request<TaskState>(`/tasks/${encodeURIComponent(taskId)}`, { signal });
}
export function listProjectTasks(projectId: string, signal?: AbortSignal) {
  return request<{ items: TaskState[] }>(`/projects/${encodeURIComponent(projectId)}/tasks`, { signal });
}

/** #47 成功才可读（content / encoding 直接来自服务端）。 */
export function fetchArtifacts(taskId: string, signal?: AbortSignal) {
  return request<{ items: Artifact[] }>(`/tasks/${encodeURIComponent(taskId)}/artifacts`, { signal });
}
export async function fetchVerifications(taskId: string, signal?: AbortSignal): Promise<VerificationResult> {
  const r = await request<VerificationResult>(`/tasks/${encodeURIComponent(taskId)}/verifications`, { signal });
  return IS_MOCK ? { ...r, items: r.items.map((v) => ({ ...v, attempt: v.attempt ?? 1, log_digest: v.log_digest ?? "Mock 演示证据，非真实校验" })) } : r;
}

/** #48 同一输入重试：不调用 #43，不改草稿。次数由服务端裁决，取消不计。 */
export function retryVerification(taskId: string, verifyId: string, signal?: AbortSignal) {
  return request<GenerationReceipt>(`/tasks/${encodeURIComponent(taskId)}/verifications/${encodeURIComponent(verifyId)}/retry`, {
    method: "POST", signal, idempotencyKey: newIdempotencyKey(),
  });
}
export function cancelTask(taskId: string, signal?: AbortSignal) {
  return request<{ task_id?: string; status: string }>(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST", signal, idempotencyKey: newIdempotencyKey(),
  });
}

// ==================== S4：预览 / 接口 / 能力 / Spec / 版本 ====================

/** #49 L1 五条规则的固定名称（`UI-Spec §4.9 ④`：逐条打勾） */
export const L1_RULES = [
  "语法可解析", "结构合法", "元素 id 一一对应", "属性取值在域内", "引用完整",
] as const;

/** #44a 取消生成 —— 见 S3 段落（非失败态，不计重试） */

// ---------- #50~#53 被开发项目的接口定义（与「平台自身接口」是两套，不得混称） ----------
export type ApiStatus = "draft" | "effective" | "deprecated";
export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
/** `field_type` 完整 8 项，**禁写「等」**（`UI-Spec §4.10 ④`） */
export const FIELD_TYPES = ["string", "int", "long", "double", "bool", "object", "array", "date"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface ApiField {
  name: string; field_type: FieldType; required: boolean;
  length: number | null; precision: number | null; unit: string; description: string;
}
export interface ApiDef {
  api_id: string; code: string; name: string; method: ApiMethod; path: string;
  status: ApiStatus; updated_at: string; version: number; fields: ApiField[];
}

/** #50 清单（q 命中 code/name/path + 状态筛选；`updated_at` 倒序） */
export function listApis(projectId: string, query: { q?: string; status?: ApiStatus | ""; page?: number; page_size?: number }) {
  return request<Paged<ApiDef>>(`/projects/${projectId}/apis`, { query });
}
/** #50 新建 */
export function createApi(projectId: string, body: { code: string; name: string; method: ApiMethod; path: string }) {
  return request<ApiDef>(`/projects/${projectId}/apis`, { method: "POST", body, idempotencyKey: newIdempotencyKey() });
}
/** #51 详情 */
export function fetchApi(apiId: string) {
  return request<ApiDef>(`/apis/${apiId}`);
}
/** #51 编辑（乐观锁 → `If-Match`；不匹配 409 `VERSION_CONFLICT`） */
export function patchApi(apiId: string, body: Partial<Pick<ApiDef, "code" | "name" | "method" | "path" | "status">>, version: number) {
  return request<ApiDef>(`/apis/${apiId}`, { method: "PATCH", body, ifMatch: version, idempotencyKey: newIdempotencyKey() });
}
/** #52 删除（**下次生成版本后生效**；引用它的 Spec 标「需复核」）—— `⬛` 破坏性操作，服务端亦须校验 */
export function deleteApi(apiId: string) {
  return request<{ api_id: string; status: string; effective: string }>(`/apis/${apiId}`, {
    method: "DELETE", body: { confirm: true }, idempotencyKey: newIdempotencyKey(),
  });
}
/** #53 字段表（全量替换；`If-Match`） */
export function putApiSchema(apiId: string, fields: ApiField[], version: number) {
  return request<{ api_id: string; fields: ApiField[]; version: number }>(`/apis/${apiId}/schema`, {
    method: "PUT", body: { fields }, ifMatch: version, idempotencyKey: newIdempotencyKey(),
  });
}
// ---------- #54~#57 版本归档 ----------
/** 版本状态：`current` 唯一；被回滚掉的置 `rolled_back`；回环归档 `archived`（**不物理删除**） */
export type VersionStatus = "current" | "superseded" | "rolled_back" | "archived";
/** 整包快照的**5 项范围**（`#55`） */
export const VERSION_ARTIFACTS = ["spec", "apis", "capabilities", "android_code", "tracking_plan"] as const;
export const VERSION_ARTIFACT_LABEL: Record<string, string> = {
  spec: "Spec", apis: "接口定义", capabilities: "能力配置", android_code: "安卓代码", tracking_plan: "埋点方案",
};
export interface VersionRow {
  version_id: string; seq: number; status: VersionStatus;
  created_by: string | null; created_by_name: string | null;
  summary: string; artifacts: string[]; created_at: string | null;
}
/** #54 版本列表（seq 倒序；**有且仅有一条 current**） */
export function listVersions(projectId: string) {
  return request<{ items: VersionRow[] }>(`/projects/${projectId}/versions`);
}
/** #55 打版本（整包快照） */
export function createVersion(projectId: string, summary?: string) {
  return request<{ version_id: string; seq: number }>(`/projects/${projectId}/versions`, {
    method: "POST", body: summary ? { summary } : {}, idempotencyKey: newIdempotencyKey(),
  });
}
export interface VersionDiffRow { path: string; left: string; right: string; change: "新增" | "删除" | "修改" }
/** #56 diff（接口**字段级**、Spec **文档级**；`change` 用**文字**，不只靠颜色） */
export function fetchVersionDiff(versionId: string) {
  return request<{ version_id: string; seq: number; diff: VersionDiffRow[] }>(`/versions/${versionId}/diff`);
}
/** #57 整包回滚（多步写入要么全成要么全不成；快照只读保留）—— `⬛` 需显式确认 */
export function rollbackVersion(versionId: string) {
  return request<{ status: string; version_id: string; seq: number }>(`/versions/${versionId}/rollback`, {
    method: "POST", body: { confirm: true }, idempotencyKey: newIdempotencyKey(),
  });
}

// ---------- #60/#61 交付归档 ----------
export interface DeliverableItem { key: string; name: string; available: boolean; detail: string }
export interface Deliverables {
  items: DeliverableItem[];
  spec_bundle: { overall: string; roles: { role: string; label: string; status: string; available: boolean }[] };
  android_project: { task_id: string | null; artifact_count: number; unverified_build: boolean };
  versions: { version_id: string; seq: number; status: string }[];
}
/** #60 交付归档（Spec 包 + 安卓工程） */
export function fetchDeliverables(projectId: string) {
  return request<Deliverables>(`/projects/${projectId}/deliverables`);
}
/** #61 打包导出（**需鉴权**；返回真实 ZIP 的 base64） */
export function exportDeliverables(projectId: string) {
  return request<{ export_id: string; format: string; filename: string; size_bytes: number;
    entry_count: number; base64: string; note: string }>(
    `/projects/${projectId}/deliverables/export`, { method: "POST", body: {}, idempotencyKey: newIdempotencyKey() },
  );
}
/** #70 `⬛` 中止并归档本流程（服务端亦须校验） */
export function abortProject(projectId: string) {
  return request<{ status: string; project_id: string; canceled_tasks: number; archived: string }>(
    `/projects/${projectId}/abort`, { method: "POST", body: { confirm: true }, idempotencyKey: newIdempotencyKey() },
  );
}

// ---------- #58 能力配置（7 项默认全关；保存即生成） ----------
export type CapStatus = "not_generated" | "generated" | "partial" | "failed";
/** `#58` 能力的**固定 7 项**（拉丁枚举，`接口-Spec §4.5 capability`）——**只能这 7 个** */
export const CAPABILITY_KEYS = ["push", "apm", "crash_report", "log_report", "stats_sdk", "hardening", "privacy_dialog"] as const;
export interface CapRow {
  capability: string; name: string; description: string;
  enabled: boolean; code_status: CapStatus;
  /** **仅占位说明；不含任何真实密钥**（`REQ-CAP-004`） */
  note?: string;
}
export interface CapConflict { library: string; version_a: string; version_b: string }
export interface Capabilities {
  items: CapRow[];
  overall: "none" | "succeeded" | "partial" | "failed";
  failed: { capability: string; error_code: string }[];
  conflicts: CapConflict[];
  alignment_table: { library: string; resolved: string }[];
  version: number;
}
export function fetchCapabilities(projectId: string) {
  return request<Capabilities>(`/projects/${projectId}/capabilities`);
}
/**
 * `#58` PUT —— **保存即生成**；`If-Match` 乐观锁；
 * 关闭**已生成过**的能力须 `confirm_disable`（取消勾选只移除配置，不删已生成代码）。
 */
export function saveCapabilities(
  projectId: string,
  items: { capability: string; enabled: boolean }[],
  version: number,
  confirmDisable = false,
) {
  return request<Capabilities>(`/projects/${projectId}/capabilities`, {
    method: "PUT", body: { items, confirm_disable: confirmDisable }, ifMatch: version, idempotencyKey: newIdempotencyKey(),
  });
}

// ---------- #30~#34 五份 Spec = ----------
/**
 * `spec_role` 是**固定 5 个**的拉丁枚举（`接口-Spec §4.5`）；
 * **顺序即生成顺序：ui → api → app → track → test（串行）**（`AC-SC-01`）。
 */
export type SpecRole = "ui" | "api" | "app" | "track" | "test";
export const SPEC_ROLES: SpecRole[] = ["ui", "api", "app", "track", "test"];
export const SPEC_ROLE_LABEL: Record<SpecRole, string> = {
  ui: "UI", api: "接口", app: "App", track: "埋点", test: "测试",
};
export interface SpecDoc {
  spec_id: string; role: SpecRole; role_order: number; status: "generating" | "succeeded" | "failed" | "stale";
  stale: boolean; change_point: string | null; error_code: string | null;
  version: number; updated_at: string;
}
/** #30 生成 5 份（单份失败不阻断其余） */
export function generateSpecs(projectId: string) {
  return request<{ task_id: string }>(`/projects/${projectId}/specs:generate`, {
    method: "POST", idempotencyKey: newIdempotencyKey(),
  });
}
/** #31 五份列表（`overall` / `succeeded` / `failed` 由服务端给出，**部分成功绝不报成功**） */
export function listSpecs(projectId: string) {
  return request<{ overall: "succeeded" | "partial" | "failed" | "generating" | "none";
    succeeded: string[]; failed: { role: string; error_code: string }[]; items: SpecDoc[] }>(
    `/projects/${projectId}/specs`);
}
/** #32 单份 Markdown 内容 */
export function fetchSpec(specId: string) {
  return request<{ spec_id: string; role: SpecRole; content_md: string; status: string }>(`/specs/${specId}`);
}
/** #33 导出 .md（需鉴权；不含密钥） */
export function exportSpec(specId: string) {
  return request<{ export_id: string; format: string; content_md?: string }>(`/specs/${specId}/export`);
}
/** #34 角色校对 → 补充要求清单（`REQ-PROOF-001`）；**补不上的条目必须带「回流对话」标记** */
export function fetchSpecProofread(projectId: string, specId: string) {
  return request<{ spec_id: string; role: SpecRole; items: { item_code: string; content: string; can_loopback: boolean }[] }>(
    `/projects/${projectId}/specs/${specId}/proofread`,
    { method: "POST", idempotencyKey: newIdempotencyKey() },
  );
}

// ---------- #25/#26 对话（Spec 页「回流对话补充」与工作台共用） ----------
export interface ChatMessage { message_id: string; seq: number; role: "user" | "assistant"; content: string; created_at: string; status: "sent" | "failed"; /** 对话线程 = 项目内的子步骤 */ thread_key?: string | null }
/** #25 历史：**不给 `thread` → 一次取回该项目全部线程的消息**（面板自行分组、渲染当前线程） */
export function listChatMessages(projectId: string, thread?: ChatThreadRef | null, signal?: AbortSignal) {
  const query = thread ? { thread } : undefined;
  return request<{ items: ChatMessage[] }>(`/projects/${projectId}/chat/messages`, { query, signal });
}
export function sendChatMessage(projectId: string, content: string, thread?: ChatThreadRef | null) {
  return request<{ message_id: string; seq: number }>(`/projects/${projectId}/chat/messages`, {
    method: "POST", body: thread ? { content, thread } : { content }, idempotencyKey: newIdempotencyKey(),
  });
}

// ==================== S5：知识库 / 工作台 ====================

// ---------- #7~#9 知识库（**只含本项目内容**，跨项目检索不可能发生） ----------
export type KbSector = "prd" | "spec" | "glossary" | "domain" | "constraints";
export type KbOrigin = "agent_extracted" | "user_edited" | "user_uploaded";
export interface KbDoc {
  kb_doc_id: string; title: string; sector: KbSector; origin: KbOrigin;
  updated_at: string | null; version: number;
}
/** `EL-KB-012` 来源标签（**不用英文枚举值**） */
export const KB_ORIGIN_LABEL: Record<KbOrigin, string> = {
  agent_extracted: "平台抽取", user_edited: "你编辑过", user_uploaded: "你上传的",
};
/** `EL-KB-004` 四分区（PRD / Spec / 术语表 / 领域模型） */
export const KB_SECTORS: { key: KbSector; label: string }[] = [
  { key: "prd", label: "PRD" }, { key: "spec", label: "Spec" },
  { key: "glossary", label: "术语表" }, { key: "domain", label: "领域模型" },
  // F17 工程接入（2026-10-29）：第五分区，存「工程约束包」
  { key: "constraints", label: "工程约束" },
];

/** #7 列表（**强制按 project_id 过滤**；q ≤100 字符） */
export function listKbDocs(projectId: string, query: { sector?: KbSector; q?: string }) {
  return request<{ items: KbDoc[]; total: number }>(`/projects/${projectId}/kb-docs`, { query });
}
/** #8 详情（Markdown 原文） */
export function fetchKbDoc(kbDocId: string) {
  return request<{ kb_doc_id: string; title: string; sector: KbSector; origin: KbOrigin;
    document_id: string | null; content_hash: string; content_md: string; version: number; updated_at: string | null }>(`/kb-docs/${kbDocId}`);
}
/** #9 用户编辑（origin 置 user_edited；须 `If-Match`） */
export function saveKbDoc(kbDocId: string, contentMd: string, version: number) {
  return request<{ kb_doc_id: string; origin: KbOrigin; version: number; updated_at: string }>(
    `/kb-docs/${kbDocId}`,
    { method: "PUT", body: { content_md: contentMd }, ifMatch: version, idempotencyKey: newIdempotencyKey() },
  );
}

// ---------- #27 对话失败重发（**不重复入库**） ----------
export function retryChatMessage(messageId: string) {
  return request<{ message_id: string; status: string }>(`/chat/messages/${encodeURIComponent(messageId)}/retry`, {
    method: "POST", idempotencyKey: newIdempotencyKey(),
  });
}

