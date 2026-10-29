/**
 * `§1.4 门禁审核` —— #16 ⚡触发 / #17 评分卡 / #18 逐项 / #19 待澄清 / #20 作答 /
 * #21 假设（GET/POST）/ #22 一键采纳（**仅批量勾选，不写 PRD**）/ #23 回写原 PRD（**显式确认**）/
 * #24 项目级门禁标准（`PUT` 每次保存版本 +1，**历史评分不重算**）。
 *
 * 要点：
 *  - `#21` 关键约束：`choice` 为 `unset` 的假设**不允许**进入生成阶段；`#23` 前服务端校验，否则 400；
 *  - `#22` 与 `#23` 是**两件事**：勾选不写 PRD，回写必须显式 `confirm: true` + 快照；
 *  - 评分卡**绑定 `revision_id`**；重跑审核会把旧报告置 `superseded`（**不删**）；
 *  - 门禁标准**项目级**、维护人为管理员；需求方只读。
 */
import type { FastifyInstance } from "fastify";
import { ApiError } from "../core/envelope.ts";
import { assertProjectAccess, currentUser, type User } from "../core/auth.ts";
import { loadRevision, revisionText, digest, writeMeta, assertReviewCurrent, materializeEditedRevision } from "../core/revisions.ts";
import { assertIfMatch } from "../core/idempotency.ts";
import { all, get, json, nowIso, run, tx, uid } from "../db/index.ts";
import { createTask, startTask } from "../core/tasks.ts";
import { createLlmAdapter, type Level, type LlmAdapter, type ReviewLevel, type ReviewDraft } from "../adapters/llm.ts";
import { assertEgressEnabled } from "./ai-egress.ts";
import { modelFor } from "../core/llm-models.ts";
import { traceLlm } from "../core/ai-trace.ts";
import { constraintsNoteFor } from "./constraints.ts";

const GROUP_TITLES: Record<string, string> = {
  A: "需求完整性", B: "状态穷举与迁移", C: "数据与字段", D: "页面级元素与文案",
  E: "平台接口契约", F: "角色与权限", G: "生成与验证", H: "角落收敛", I: "假设集中确认",
  J: "工程一致性（仅严格档）",
  Q: "可实现性与一致性（简审）",
};

/**
 * 每个检查项的**小节标题**（默认门禁标准用）。
 * 回写时以它作为「补充信息落地小节」的标题（`#23`），所以默认取值**与该检查项要的章节一致**，
 * 而不是笼统的组名（组名仍由 `GROUP_TITLES` 提供，用于评分卡分组展示）。
 */
const DEFAULT_ITEM_TITLES: Record<string, string> = {
  A1: "背景与一句话说明", A2: "主流程与分期规划", A3: "范围与目标",
  B1: "状态机与迁移条件", B2: "异常与失败路径",
  C1: "数据与字段定义", C2: "属性与样式",
  D1: "页面级元素构成", D2: "逐字文案字样",
  E1: "接口契约", F1: "角色与权限矩阵", G1: "生成与验证",
  H1: "角落组合收敛", I1: "假设集中确认",
  J1: "与既有工程约束一致", J2: "冲突项已显式列为待澄清",
  Q1: "可实现性", Q2: "内部一致性 / 冲突",
};

/** 默认门禁标准（项目首次访问时落库；`PUT` 保存即版本 +1） */
const DEFAULT_STANDARD = Object.entries(GROUP_TITLES).flatMap(([group, title]) => {
  const codes: Record<string, string[]> = {
    A: ["A1", "A2", "A3"], B: ["B1", "B2"], C: ["C1", "C2"], D: ["D1", "D2"],
    E: ["E1"], F: ["F1"], G: ["G1"], H: ["H1"], I: ["I1"],
  };
  return (codes[group] ?? []).map((code) => ({
    code, group, title: DEFAULT_ITEM_TITLES[code] ?? title, level: (({A1:"blocking",A2:"blocking",A3:"major",B1:"blocking",B2:"blocking",C1:"blocking",C2:"major",D1:"major",D2:"major",E1:"blocking",F1:"blocking",G1:"major",H1:"suggestion",I1:"suggestion"} as Record<string,Level>)[code]),
  }));
});

// ==================== PRD 审核分级（2026-10-28 定稿 · 简审 / 标准 / 严格）====================
// 口径见 `PRD审核分级-定稿-v1.0.md`：等级决定「跑哪些项 + 多严算过」；`na ≠ pass`。

/** 合法等级（内部 code） */
export const REVIEW_LEVELS: ReviewLevel[] = ["quick", "standard", "strict"];

/** 等级 → 拆解深度映射（R-18：`tbl_project.depth` 由等级映射，不再由前端指定） */
export function depthOfLevel(level: ReviewLevel): "minimal" | "standard" | "comprehensive" {
  return level === "quick" ? "minimal" : level === "standard" ? "standard" : "comprehensive";
}

/**
 * 简审档的两项**专项检查**（不套 14 项精简表）：只回答「能不能实现」「有没有冲突」。
 * `group=Q`、`level=blocking`（简审档任何 fail 皆阻断）。
 */
const QUICK_ITEMS: { code: string; group: string; title: string; level: Level }[] = [
  { code: "Q1", group: "Q", title: "可实现性", level: "blocking" },
  { code: "Q2", group: "Q", title: "内部一致性 / 冲突", level: "blocking" },
];

/**
 * 严格档在精简表之上追加的**完整表细则项**（由 `baseline/可开发性门禁清单.md` 落地为常量）。
 * 与精简表**同码**的项（A1~I1 那 14 个）不重复追加，避免编号冲突。
 */
const FULL_STANDARD_EXTRA: { code: string; group: string; title: string; level: Level }[] = [
  { code: "A4", group: "A", title: "业务规则写清例外分支（超时/并发/重复提交/取消）", level: "blocking" },
  { code: "A5", group: "A", title: "无「等等 / 若干 / 视情况而定」这类模糊表述", level: "blocking" },
  { code: "B3", group: "B", title: "无孤立状态、无未定义迁移", level: "blocking" },
  { code: "B4", group: "B", title: "失败的流程有回退 / 补偿路径", level: "blocking" },
  { code: "C3", group: "C", title: "字段长度 / 范围 / 精度约束明确", level: "major" },
  { code: "C4", group: "C", title: "数据来源与归属明确（谁产生、谁可改）", level: "major" },
  { code: "C5", group: "C", title: "敏感数据与可见范围明确", level: "major" },
  { code: "C6", group: "C", title: "「未知」与「零」在全链路中可区分", level: "major" },
  { code: "C7", group: "C", title: "金额不用浮点；单位恒随数量出现", level: "major" },
  { code: "D3", group: "D", title: "文案字样给出具体内容，不写「提示错误信息」", level: "blocking" },
  { code: "D4", group: "D", title: "空态 / 加载态 / 错误态是三个不同的视图", level: "major" },
  { code: "D5", group: "D", title: "动效 / 过渡有说明或明确「无动效」", level: "suggestion" },
  { code: "D6", group: "D", title: "破坏性操作有确认（指明影响范围）或撤销", level: "major" },
  { code: "D7", group: "D", title: "状态不只靠颜色表达；功能可用键盘完成", level: "suggestion" },
  { code: "E2", group: "E", title: "列表分页、排序、筛选规则明确", level: "blocking" },
  { code: "E3", group: "E", title: "需要实时 / 推送的场景已说明", level: "major" },
  { code: "E4", group: "E", title: "第三方依赖与失败降级已说明", level: "major" },
  { code: "E5", group: "E", title: "部分来源失败时的响应形态明确", level: "major" },
  { code: "E6", group: "E", title: "每次外部调用有超时；重试不产生重复副作用", level: "major" },
  { code: "F2", group: "F", title: "埋点上报时机与去重规则明确", level: "suggestion" },
  { code: "F3", group: "F", title: "未登录等边界态下的用户标识取值明确", level: "suggestion" },
  { code: "G2", group: "G", title: "P0 主流程的验收路径完整", level: "blocking" },
  { code: "G3", group: "G", title: "QA 能仅凭验收标准写出测试用例", level: "blocking" },
  { code: "H2", group: "H", title: "每个适用条件已收敛为 需求 / 假设+理由 / 明确排除", level: "blocking" },
  { code: "H3", group: "H", title: "《角落扫描表》非空且覆盖全部组件", level: "blocking" },
  { code: "H4", group: "H", title: "扫描前已确定部署形态（单/多用户、单/多租户、是否涉合规）", level: "major" },
  { code: "I2", group: "I", title: "完善后 PRD 中无「无来源标签」的实质段落", level: "blocking" },
  { code: "I3", group: "I", title: "所有 [平台补充] 与 [assumption] 都进了假设确认清单", level: "blocking" },
  { code: "I4", group: "I", title: "假设清单无空白未选项", level: "blocking" },
  // 工程一致性（F18 / D4=A / D6=C）：**仅严格档**运行；仅当项目接入了既有工程时才判定。
  { code: "J1", group: "J", title: "产出与既有工程约束一致（依赖 / 包名 / minSdk / 命名）", level: "major" },
  { code: "J2", group: "J", title: "与既有工程冲突处已显式列为待澄清（未擅自改写工程）", level: "major" },
];

/** 本次等级下**应评**的检查项（简审=专项 2 项；标准=门禁标准；严格=门禁标准 + 完整表细则） */
export function itemsForLevel(
  level: ReviewLevel,
  standardItems: { code: string; group: string; title: string; level: Level }[],
): { code: string; group: string; title: string; level: Level }[] {
  if (level === "quick") return QUICK_ITEMS;
  if (level === "strict") {
    const have = new Set(standardItems.map((i) => i.code));
    return [...standardItems, ...FULL_STANDARD_EXTRA.filter((e) => !have.has(e.code))];
  }
  return standardItems;
}

/** 本次等级下，哪些「检查项等级」的 fail 计入**阻断**（决定 `verdict`） */
export function isBlocking(level: ReviewLevel, itemLevel: Level): boolean {
  if (level === "quick") return true;                                // 简审只有两项，任何 fail 皆阻断
  if (level === "standard") return itemLevel === "blocking";         // 标准：表内 blocking
  return itemLevel === "blocking" || itemLevel === "major";          // 严格：blocking + major
}

/**
 * 审核任务的最大尝试次数（2026-10-28 真机实测：6 次真实审核中 1 次返回结构不合法）。
 * 只在**上游结构问题**（`UPSTREAM_UNAVAILABLE`）时重跑，且**至多 1 次额外调用**；
 * 超时（`UPSTREAM_TIMEOUT`，单次调用内已有退避重试）与取消**不在此处重跑**。
 */
export const REVIEW_MAX_ATTEMPTS = 2;

/** 重跑时给模型的格式强化提示 */
const REVIEW_RETRY_HINT =
  "上一次返回的 JSON 不合法或结构不完整。请严格只输出符合给定结构的 JSON，"
  + "`items` 必须逐条覆盖给定的检查项清单（条数一致、item_code 逐字相同），不要输出任何解释文字。";

/**
 * 把 `text` 作为 `## {title}` 小节写进 `md`：
 *  - 正文里**已有同名小节** → 并入该小节末尾（不新建重复标题）；
 *  - 否则 → 追加到正文末尾成新小节。
 * 用于 `#23` 的「补充信息就地落章」与「澄清答复」。
 */
function upsertSection(md: string, title: string, text: string): string {
  const lines = md.split("\n");
  let fenced = false;
  const headings = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return null; }
    return fenced ? null : /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  });
  const at = headings.findIndex((m) => m?.[2] === title);
  if (at === -1) return md + "\n\n## " + title + "\n\n" + text + "\n";
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (headings[i] && headings[i]![1].length <= headings[at]![1].length) { end = i; break; }
  }
  if (lines.slice(at + 1, end).join("\n").includes(text)) return md;
  lines.splice(end, 0, "", text, "");
  return lines.join("\n");
}

function cleanAnswer(value: string): string {
  return value.replace(/^__other/, "").trim();
}

function loadReview(user: User, reviewId: string) {
  const r = get<{ review_id: string; project_id: string; revision_id: string; verdict: string;
    standard_version: number; superseded: number; counts_json: string; model: string;
    review_level: string; review_extended: number }>(
    `SELECT * FROM tbl_review_report WHERE review_id = ?`, reviewId);
  if (!r) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
  assertProjectAccess(user, r.project_id);
  return r;
}

/** 取项目当前门禁标准（不存在则按默认落库） */
export function currentStandard(projectId: string): { standard_id: string; version: number; items: { code: string; group: string; title: string; level: Level }[] } {
  const row = get<{ standard_id: string; version: number; items_json: string }>(
    `SELECT standard_id, version, items_json FROM tbl_gate_standard
      WHERE project_id = ? AND is_current = 1 ORDER BY version DESC LIMIT 1`, projectId);
  if (row) return { standard_id: row.standard_id, version: row.version, items: json.parse(row.items_json, DEFAULT_STANDARD) };
  const standardId = uid("gs");
  run(`INSERT INTO tbl_gate_standard (standard_id, project_id, version, is_current, items_json, created_at) VALUES (?,?,?,?,?,?)`,
    standardId, projectId, 1, 1, json.stringify(DEFAULT_STANDARD), nowIso());
  return { standard_id: standardId, version: 1, items: DEFAULT_STANDARD };
}

export function registerReviewRoutes(app: FastifyInstance, adapter?: LlmAdapter) {
  const llm = adapter ?? createLlmAdapter();

  /** #16 ⚡ 触发门禁审核（可选 `level`/`extended` 覆盖项目级；可选 `force` 强制重跑） */
  app.post<{ Params: { revision_id: string }; Body: { level?: string; extended?: boolean; depth?: string; force?: boolean } }>(
    "/api/v1/revisions/:revision_id/reviews", async (req, reply) => {
      const user = currentUser(req);
      const rev = loadRevision(user, req.params.revision_id);
      if (!["succeeded","partial"].includes(rev.parse_status) || rev.empty_document) throw new ApiError("INVALID_ARGUMENT", "请先解析非空 PRD。");
      const project = get<{current_revision_id:string}>(`SELECT current_revision_id FROM tbl_project WHERE project_id=?`,rev.project_id);
      if (project?.current_revision_id !== rev.revision_id) throw new ApiError("TASK_STALE", "请审核当前版本的 PRD。");
      const markdown = revisionText(rev);

      // ---- 审核分级（2026-10-28 定稿）：单次请求 level 覆盖项目默认，再退系统默认 standard ----
      const projRow = get<{ depth: string; review_level: string; review_extended: number }>(
        `SELECT depth, review_level, review_extended FROM tbl_project WHERE project_id = ?`, rev.project_id);
      // 兼容旧参数 `depth`（minimal/standard/comprehensive）→ 映射为等级
      const legacyDepth = req.body?.depth;
      let wantedLevel: string | undefined = req.body?.level;
      if (wantedLevel === undefined && legacyDepth !== undefined) {
        wantedLevel = legacyDepth === "minimal" ? "quick" : legacyDepth === "comprehensive" ? "strict" : "standard";
      }
      if (wantedLevel !== undefined && !REVIEW_LEVELS.includes(String(wantedLevel) as ReviewLevel))
        throw new ApiError("INVALID_ARGUMENT", "审核等级只能是 quick / standard / strict。");
      const level = (wantedLevel !== undefined ? String(wantedLevel) : (projRow?.review_level ?? "standard")) as ReviewLevel;
      if (!REVIEW_LEVELS.includes(level)) throw new ApiError("INVALID_ARGUMENT", "审核等级只能是 quick / standard / strict。");
      // 超严扩展只在严格档有意义
      const rawExtended = req.body?.extended !== undefined ? req.body.extended === true : projRow?.review_extended === 1;
      const extended = level === "strict" && rawExtended === true;
      const depth = depthOfLevel(level);
      const std = currentStandard(rev.project_id);

      // ---- 复用分支（2026-10-22 决策 D-1）------------------------------------------
      // 只有「重新审核 / 提交复审 / 重试」才带 `force:true` 强制重跑；进页自动加载**不带**，
      // 于是「同 revision + 同 standard_version + 同 depth + 未 superseded」的已有报告直接复用：
      // 不新建报告、不作废旧报告、**不调用大模型**（否则每刷一次审核页就烧一次额度）。
      // `depth` 不入 `tbl_review_report`，故比对 `review:{id}` 里落盘的 `depth`（老记录无该键 → 不复用）。
      const reused = !req.body?.force
        ? get<{ review_id: string; verdict: string; standard_version: number }>(
            `SELECT review_id, verdict, standard_version FROM tbl_review_report
             WHERE project_id=? AND revision_id=? AND superseded=0 AND standard_version=?
               AND review_level=? AND review_extended=?
             ORDER BY created_at DESC LIMIT 1`,
            rev.project_id, rev.revision_id, std.version, level, extended ? 1 : 0,
          )
        : undefined;
      if (reused) {
        if (reused.verdict === "running") {
          // 上一次审核还在跑：把它的 task_id 交回前端继续等，**不再起第二个任务**。
          const inflight = get<{ task_id: string }>(
            `SELECT task_id FROM tbl_gen_task WHERE project_id=? AND type='review' AND status IN ('queued','running')
             ORDER BY created_at DESC LIMIT 1`, rev.project_id,
          );
          if (inflight) {
            return reply.status(202).send({
              code: "OK", message: "", request_id: String(req.id),
              data: { review_id: reused.review_id, task_id: inflight.task_id, standard_version: std.version, depth, level, extended, reused: true },
            });
          }
          // 报告卡在 running 但任务已不在（进程重启等）→ 落到下面重跑，避免永远等不到终态。
        } else {
          // 已有终态报告 → 前端不会再轮询（`task_id: null`），直接拉既有评分卡。
          return reply.status(200).send({
            code: "OK", message: "", request_id: String(req.id),
            data: { review_id: reused.review_id, task_id: null, standard_version: std.version, depth, level, extended, reused: true },
          });
        }
      }
      // -----------------------------------------------------------------------------

      // ---- 服务端兜底（`接口-Spec :1409` / `R-07` / `TC-REVIEW-002`）--------------------------
      // 「未作答的阻断项 → 不允许 gate_passed」：前端已在 `EL-REVIEW-026` 的 onClick 预检拦截
      // （**不发 `#16`**，见 `埋点-Spec:158`），这里防**绕过**（直连 API / 多端）。
      // 只在**主动提交**（`force:true`）时校验，且只看**同一 revision 的既有报告** ——
      // 进页自动加载（不带 `force`）走复用分支、不得被拦；「重新审核」的旧报告属于**另一个 revision**，也不受影响。
      // **R-25（2026-10-28）**：简审档豁免该前置校验（简审不强制假设、只判「可实现性/冲突」两项）。
      if (req.body?.force === true && level !== "quick") {
        const prev = get<{ review_id: string }>(
          `SELECT review_id FROM tbl_review_report
           WHERE project_id=? AND revision_id=? AND superseded=0
           ORDER BY created_at DESC LIMIT 1`, rev.project_id, rev.revision_id);
        if (prev) {
          const open = get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM tbl_gate_question
             WHERE review_id=? AND level='blocking' AND (status IS NULL OR status NOT IN ('answered','converted'))`, prev.review_id)?.n ?? 0;
          if (open > 0) throw new ApiError("INVALID_ARGUMENT", `还有 ${open} 项阻断没有作答，无法进入拆解。`);
          const unset = get<{n: number}>(`SELECT COUNT(*) n FROM tbl_assumption WHERE review_id=? AND choice='unset'`, prev.review_id)?.n ?? 0;
          if (unset) throw new ApiError("INVALID_ARGUMENT", `还有 ${unset} 条假设没有选择，先逐条选完再继续。`);
        }
      }
      // -----------------------------------------------------------------------------

      assertEgressEnabled(user.user_id);

      const standardItems = itemsForLevel(level, std.items);
      const reviewId = uid("rv");
      const ts = nowIso();
      // 门禁结论随模型而变，所以**先记下这次用的模型**（下文的 usedModel 与之一致）
      const usedModel = modelFor(user.user_id);
      // 「已采纳」跨复审继承（2026-10-26 口径③）：按 `item_code` 从**上一份报告**继承勾选态，
      // 免得用户每次复审都要把同样的建议再勾一遍；**只继承本轮仍判 `fail`** 的条目（判 pass 的不该带勾选态）。
      // 仅继承同一文档链的已写入内容；重新上传另一个文档不得串台。
      const previous = get<{review_id: string}>(`SELECT r.review_id FROM tbl_review_report r
        JOIN tbl_doc_revision d ON d.revision_id=r.revision_id
        WHERE r.project_id=? AND d.document_id=? AND r.verdict IN ('passed','blocked')
        ORDER BY r.created_at DESC,r.review_id DESC LIMIT 1`, rev.project_id, rev.document_id);
      const previousItems = new Map((previous ? all<{item_code:string;accepted:number;supplement:string;suggestion:string}>(
        `SELECT item_code,accepted,supplement,suggestion FROM tbl_review_item WHERE review_id=?`, previous.review_id) : []).map(i => [i.item_code,i]));
      run(`INSERT INTO tbl_review_report (review_id, project_id, revision_id, verdict, standard_version, superseded, counts_json, model, review_level, review_extended, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`, reviewId, rev.project_id, rev.revision_id, "running", std.version, 0, "{}", usedModel, level, extended ? 1 : 0, ts);
      // `depth` 保留写入（兼容旧读）；同时落 `review_level`/`review_extended`（结论随等级而变）
      run(`UPDATE tbl_project SET stage = 'reviewing', depth = ?, review_level = ?, review_extended = ?, updated_at = ? WHERE project_id = ?`,
        depth, level, extended ? 1 : 0, ts, rev.project_id);

      const kb = get<{version:number}>(`SELECT version FROM tbl_kb_doc WHERE project_id=? AND document_id=?`,rev.project_id,rev.document_id);
      run(`UPDATE tbl_review_report SET superseded=1 WHERE project_id=? AND review_id<>?`,rev.project_id,reviewId);
      writeMeta(rev.project_id,`review:${reviewId}`,{hash:digest(markdown),document_id:rev.document_id,kb_version:kb?.version,level,extended,depth});
      const task = createTask({ projectId: rev.project_id, type: "review" });
      startTask(task.task_id, async ({ progress, commit }) => {
        progress(20);
        // 结构校验（抽成函数，供「结构非法 → 自动重跑一次」复用）
        const validateDraft = (draft: ReviewDraft | null): ReviewDraft => {
          if (!draft || !Array.isArray(draft.items) || !Array.isArray(draft.questions) || !Array.isArray(draft.assumptions) || draft.items.length !== standardItems.length)
            throw new ApiError("UPSTREAM_UNAVAILABLE", "审核返回结构不完整，未应用结果。");
          const expected = new Map(standardItems.map(i=>[i.code,i])); const seen = new Set<string>();
          for (const it of draft.items) {
            const standard = expected.get(it.item_code);
            if (!standard || seen.has(it.item_code) || !["pass","fail","na"].includes(it.verdict) || typeof it.evidence_ref !== "string" || !it.evidence_ref.trim() || typeof it.suggestion !== "string")
              throw new ApiError("UPSTREAM_UNAVAILABLE", "审核条目校验失败，未应用结果。");
            seen.add(it.item_code); it.level=standard.level; it.group=standard.group;
          }
          for (const q of draft.questions) if (!q.question_code || !["blocking","major","suggestion"].includes(q.level) || typeof q.title!=="string" || !Array.isArray(q.options) || typeof q.impact!=="string" || typeof q.fallback!=="string") throw new ApiError("UPSTREAM_UNAVAILABLE", "待澄清结构无效。");
          for (const a of draft.assumptions) if (!a.assumption_code || typeof a.content!=="string" || typeof a.source_tag!=="string") throw new ApiError("UPSTREAM_UNAVAILABLE", "假设结构无效。");
          return draft;
        };
        const callOnce = (retryHint?: string) => traceLlm(rev.project_id, task.task_id,
          retryHint ? "调用大模型审核 PRD · 自动重试" : "调用大模型审核 PRD", usedModel,
          // `retryHint` 只在重跑时带上（首次调用的入参形状保持不变）
          () => llm.review({markdown, level, extended, ...(retryHint ? { retryHint } : {}), standardItems:standardItems.map(i=>({code:i.code,level:i.level,title:i.title})),model:usedModel,constraints:constraintsNoteFor(rev.project_id) ?? undefined}),
          (d) => `条目 ${Array.isArray(d?.items) ? d.items.length : 0} 条 · 待澄清 ${Array.isArray(d?.questions) ? d.questions.length : 0} 条`);

        // ---- 自动重跑（2026-10-28 真机实测：真实模型偶发吐回不合法结构）----
        // 只在**上游结构问题**时重跑；`check()` 在 progress/callOnce 内会拦截已取消的任务。
        let draft: ReviewDraft | null = null;
        for (let attempt = 1; ; attempt++) {
          try {
            draft = validateDraft(await callOnce(attempt > 1 ? REVIEW_RETRY_HINT : undefined));
            break;
          } catch (e) {
            const retryable = e instanceof ApiError && e.code === "UPSTREAM_UNAVAILABLE";
            if (!retryable || attempt >= REVIEW_MAX_ATTEMPTS) throw e;
            // 可观测：真实模型的结构性失败不常见但确实会发生，日志要留痕（不含 PRD 正文）
            console.warn(`[review] 上游结构不合法，自动重跑一次（project=${rev.project_id} task=${task.task_id} 第 ${attempt} 次）：${e.message}`);
            progress(40);   // 也顺带 `check()` 一次：任务被取消/超时就不再重跑
          }
        }
        if (!draft) throw new ApiError("UPSTREAM_UNAVAILABLE", "审核未产出可用结论，未应用结果。");
        progress(70);
        return commit(() => {
          assertReviewCurrent(loadReview(user,reviewId));
          // 计数：按**条目自身等级**统计（与旧口径一致）+ `na` 数；阻断判定另用本次等级的**门槛**
          const counts: Record<string, number> = {blocking:0,major:0,suggestion:0,na:0};
          let blockingFails = 0;
          for(const it of draft.items) {
            const prev = previousItems.get(it.item_code);
            const supplement = prev?.supplement && markdown.includes(prev.supplement) ? prev.supplement : "";
            run(`INSERT INTO tbl_review_item(item_row_id,review_id,item_code,group_code,level,verdict,evidence_ref,suggestion,accepted,supplement) VALUES(?,?,?,?,?,?,?,?,?,?)`,uid("ri"),reviewId,it.item_code,it.group,it.level,it.verdict,it.evidence_ref,it.suggestion,
              it.verdict==="fail" && prev?.accepted && (supplement || (prev.suggestion===it.suggestion && !!prev.suggestion && markdown.includes(prev.suggestion))) ? 1 : 0, supplement);
            if (it.verdict === "na") counts.na++;
            else if (it.verdict === "fail") { counts[it.level]++; if (isBlocking(level, it.level)) blockingFails++; }
          }
          for(const q of draft.questions) run(`INSERT INTO tbl_gate_question(question_code,review_id,level,title,options_json,fallback,impact,answer,status) VALUES(?,?,?,?,?,?,?,'','open')`,`${reviewId}_${q.question_code}`,reviewId,q.level,q.title,json.stringify(q.options),q.fallback,q.impact);
          for(const a of draft.assumptions) run(`INSERT INTO tbl_assumption(assumption_code,review_id,content,source_tag,choice) VALUES(?,?,?,?,'unset')`,`${reviewId}_${a.assumption_code}`,reviewId,a.content,a.source_tag);
          const verdict=blockingFails>0?"blocked":"passed";
          run(`UPDATE tbl_review_report SET verdict=?,counts_json=? WHERE review_id=?`,verdict,json.stringify(counts),reviewId);
          run(`UPDATE tbl_project SET stage=?,updated_at=? WHERE project_id=?`,verdict==="passed"?"gate_passed":"gate_blocked",nowIso(),rev.project_id);
          return reviewId;
        });
      }, {onFailure:()=>{
        run(`UPDATE tbl_review_report SET verdict='failed' WHERE review_id=? AND verdict='running'`,reviewId);
        const cur=get<{superseded:number}>(`SELECT superseded FROM tbl_review_report WHERE review_id=?`,reviewId);
        if(!cur?.superseded) run(`UPDATE tbl_project SET stage='kb_ready' WHERE project_id=? AND stage='reviewing'`,rev.project_id);
      }});

      void reply.status(202).send({
        code: "OK", message: "", request_id: String(req.id),
        data: { review_id: reviewId, task_id: task.task_id, standard_version: std.version, depth, level, extended, reused: false },
      });
    });

  /** #69 鉴权后的 Markdown 报告内容：不返回服务端路径/密钥。 */
  app.get<{Params:{project_id:string;review_id:string}}>("/api/v1/projects/:project_id/reviews/:review_id/export",async(req,reply)=>{
    const user=currentUser(req); const r=loadReview(user,req.params.review_id);
    if(r.project_id!==req.params.project_id) throw new ApiError("FORBIDDEN");
    const items=all<{item_code:string;verdict:string;evidence_ref:string;suggestion:string}>(`SELECT item_code,verdict,evidence_ref,suggestion FROM tbl_review_item WHERE review_id=? ORDER BY item_code`,r.review_id);
    const content=`# 审核报告\n\n审核：${r.review_id}\n版本：${r.revision_id}\n结论：${r.verdict}\n审核等级：${r.review_level || "（未记录）"}${r.review_extended ? "（超严扩展）" : ""}\n使用模型：${r.model || "（未记录）"}\n\n`+items.map(i=>`## ${i.item_code} · ${i.verdict}\n\n证据：${i.evidence_ref}\n\n建议：${i.suggestion}`).join("\n\n");
    reply.send({code:"OK",message:"",request_id:String(req.id),data:{export_id:r.review_id,format:"md",content_md:content}});
  });

  /** #17 评分卡 */
  app.get<{ Params: { review_id: string } }>("/api/v1/reviews/:review_id", async (req, reply) => {
    const user = currentUser(req);
    const r = loadReview(user, req.params.review_id);
    const current = get<{revision_id:string;document_id:string}>(`SELECT d.revision_id,d.document_id FROM tbl_project p
      JOIN tbl_doc_revision d ON d.revision_id=p.current_revision_id WHERE p.project_id=?`, r.project_id);
    const kb = current && get<{kb_doc_id:string;version:number;content_md:string}>(`SELECT kb_doc_id,version,content_md FROM tbl_kb_doc
      WHERE project_id=? AND document_id=? AND sector='prd'`, r.project_id, current.document_id);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: {
        prd: current && kb ? {revision_id:current.revision_id,document_id:current.document_id,kb_doc_id:kb.kb_doc_id,version:kb.version,content_hash:digest(kb.content_md)} : null,
        review_id: r.review_id, verdict: r.verdict,
        counts: json.parse<Record<string, number>>(r.counts_json, { blocking: 0, major: 0, suggestion: 0, na: 0 }),
        standard_version: r.standard_version, superseded: !!r.superseded, revision_id: r.revision_id,
        // 门禁结论随模型而变，界面必须能显示「这次是谁判的」
        model: r.model || "",
        // 审核分级（2026-10-28）：结论随等级而变，界面必须能显示「这次用的哪一档」
        review_level: r.review_level || "standard",
        review_extended: !!r.review_extended,
      },
    });
  });

  /** #18 评分卡逐项 */
  app.get<{ Params: { review_id: string } }>("/api/v1/reviews/:review_id/items", async (req, reply) => {
    const user = currentUser(req);
    loadReview(user, req.params.review_id);
    const rows = all<{ item_code: string; group_code: string; level: Level; verdict: string;
      evidence_ref: string; suggestion: string; accepted: number; supplement: string }>(
      `SELECT item_code, group_code, level, verdict, evidence_ref, suggestion, accepted, supplement
        FROM tbl_review_item WHERE review_id = ? ORDER BY item_code`, req.params.review_id);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: { items: rows.map((r) => ({
        item_code: r.item_code, group: r.group_code, group_title: GROUP_TITLES[r.group_code] ?? r.group_code,
        level: r.level, verdict: r.verdict, evidence_ref: r.evidence_ref, suggestion: r.suggestion,
        accepted: !!r.accepted, supplement: r.supplement ?? "",
      })) },
    });
  });

  /** #19 待澄清清单 */
  app.get<{ Params: { review_id: string } }>("/api/v1/reviews/:review_id/questions", async (req, reply) => {
    const user = currentUser(req);
    loadReview(user, req.params.review_id);
    const rows = all<{ question_code: string; level: Level; title: string; options_json: string;
      fallback: string; impact: string; answer: string; status: string }>(
      `SELECT * FROM tbl_gate_question WHERE review_id = ? AND status<>'converted' ORDER BY question_code`, req.params.review_id);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: { items: rows.map((r) => ({
        question_code: r.question_code, level: r.level, title: r.title,
        options: json.parse<string[]>(r.options_json, []), fallback: r.fallback, impact: r.impact,
        answer: r.answer, status: r.status,
      })) },
    });
  });

  /** #20 逐条作答 */
  app.post<{ Params: { question_code: string }; Body: { answer?: string } }>(
    "/api/v1/questions/:question_code/answers", async (req, reply) => {
      const user = currentUser(req);
      const q = get<{ question_code: string; review_id: string }>(
        `SELECT question_code, review_id FROM tbl_gate_question WHERE question_code = ?`, req.params.question_code);
      if (!q) throw new ApiError(user.role === "admin" ? "NOT_FOUND" : "FORBIDDEN");
      assertReviewCurrent(loadReview(user,q.review_id));
      const answer = cleanAnswer(String(req.body?.answer ?? ""));
      if (!answer) throw new ApiError("INVALID_ARGUMENT", "请先填写答复。");
      run(`UPDATE tbl_gate_question SET answer = ?, status = 'answered' WHERE question_code = ?`, answer, q.question_code);
      void reply.send({
        code: "OK", message: "", request_id: String(req.id),
        data: { question_code: q.question_code, status: "answered" },
      });
    });

  /** #21 假设清单 */
  app.get<{ Params: { review_id: string } }>("/api/v1/reviews/:review_id/assumptions", async (req, reply) => {
    const user = currentUser(req);
    loadReview(user, req.params.review_id);
    const rows = all<{ assumption_code: string; content: string; source_tag: string; choice: string }>(
      `SELECT * FROM tbl_assumption WHERE review_id = ? ORDER BY assumption_code`, req.params.review_id);
    void reply.send({ code: "OK", message: "", request_id: String(req.id), data: { items: rows } });
  });

  /** #21 提交假设选择（`unset` 不允许） */
  app.post<{ Params: { review_id: string }; Body: { assumption_code?: string; choice?: string } }>(
    "/api/v1/reviews/:review_id/assumptions", async (req, reply) => {
      const user = currentUser(req);
      assertReviewCurrent(loadReview(user,req.params.review_id));
      const code = String(req.body?.assumption_code ?? "");
      const choice = String(req.body?.choice ?? "");
      if (choice !== "accept" && choice !== "convert") {
        throw new ApiError("INVALID_ARGUMENT", "假设必须选择 accept 或 convert。");
      }
      const a = get<{ assumption_code: string }>(
        `SELECT assumption_code FROM tbl_assumption WHERE review_id = ? AND assumption_code = ?`, req.params.review_id, code);
      if (!a) throw new ApiError("NOT_FOUND");
      const questionCode = `${code}_converted`;
      tx(() => {
        run(`UPDATE tbl_assumption SET choice = ? WHERE assumption_code = ?`, choice, code);
        if (choice === "convert") {
          const assumption = get<{content:string}>(`SELECT content FROM tbl_assumption WHERE assumption_code=?`,code)!;
          run(`INSERT OR IGNORE INTO tbl_gate_question(question_code,review_id,level,title,options_json,fallback,impact,answer,status)
            VALUES(?,?,'blocking',?,'[]','','假设转成待澄清','','open')`,questionCode,req.params.review_id,assumption.content);
          run(`UPDATE tbl_gate_question SET status=CASE WHEN trim(answer)<>'' THEN 'answered' ELSE 'open' END WHERE question_code=?`,questionCode);
        } else {
          // 保留填写内容以便切回，但已接受的假设不再留下阻断问题。
          run(`UPDATE tbl_gate_question SET status='converted' WHERE question_code=?`, questionCode);
        }
      });
      void reply.send({ code: "OK", message: "", request_id: String(req.id), data: {
        assumption_code: code, choice, converted_question_code: choice === "convert" ? questionCode : null,
      } });
    });

  /** #22 一键采纳 = **仅批量勾选**（**不写 PRD**） */
  app.post<{ Params: { review_id: string }; Body: { item_codes?: string[] } }>(
    "/api/v1/reviews/:review_id/accept-candidates", async (req, reply) => {
      const user = currentUser(req);
      assertReviewCurrent(loadReview(user,req.params.review_id));
      const codes = Array.isArray(req.body?.item_codes) ? req.body!.item_codes!.map(String) : [];
      let n = 0;
      tx(() => {
        for (const c of codes) {
          const r = run(`UPDATE tbl_review_item SET accepted = 1 WHERE review_id = ? AND item_code = ?`, req.params.review_id, c);
          n += Number(r.changes ?? 0);
        }
      });
      void reply.send({
        code: "OK", message: "", request_id: String(req.id),
        data: { accepted_items_count: n, wrote_prd: false },
      });
    });

  /** #23 回写原 PRD（`⬛` 显式确认 + 快照；**假设必须全部定稿**；**未通过项补充信息随本接口一并写入**） */
  app.post<{ Params: { review_id: string }; Body: { confirm?: boolean; accepted_items?: string[]; snapshot?: boolean; supplements?: { item_code?: string; text?: string }[]; answers?: {question_code:string;answer:string}[] } }>(
    "/api/v1/reviews/:review_id/writeback", async (req, reply) => {
      const user = currentUser(req);
      const r = loadReview(user, req.params.review_id);
      if (req.body?.confirm !== true) throw new ApiError("INVALID_ARGUMENT", "回写需要显式确认。");

      const unset = all<{ assumption_code: string }>(
        `SELECT assumption_code FROM tbl_assumption WHERE review_id = ? AND choice = 'unset'`, r.review_id);
      if (unset.length) {
        throw new ApiError("INVALID_ARGUMENT",
          `还有 ${unset.length} 条假设没有选择，先逐条选完再继续。`);
      }

      assertReviewCurrent(r);
      if (req.body?.snapshot !== true) throw new ApiError("INVALID_ARGUMENT", "回写必须保存原文快照。");
      const accepted=Array.isArray(req.body?.accepted_items)?req.body!.accepted_items!.map(String):[];
      const rev=loadRevision(user,r.revision_id);
      const kb=get<{kb_doc_id:string;content_md:string;version:number}>(`SELECT kb_doc_id,content_md,version FROM tbl_kb_doc WHERE project_id=? AND document_id=?`,r.project_id,rev.document_id);
      if (!kb) throw new ApiError("TASK_STALE", "审核对应正文已不可用。");
      const rows=all<{item_code:string;suggestion:string;verdict:string;supplement:string}>(`SELECT item_code,suggestion,verdict,supplement FROM tbl_review_item WHERE review_id=?`,r.review_id);
      const questionRows = all<{question_code:string;title:string;answer:string;status:string;level:string}>(
        `SELECT question_code,title,answer,status,level FROM tbl_gate_question WHERE review_id=? AND status<>'converted'`, r.review_id);
      const answerInputs = req.body?.answers ?? [];
      if (!Array.isArray(answerInputs)) throw new ApiError("INVALID_ARGUMENT", "答复必须为数组。");
      const answerMap = new Map<string,string>();
      for (const a of answerInputs) {
        if (!a || typeof a.question_code!=="string" || typeof a.answer!=="string" || !questionRows.some(q=>q.question_code===a.question_code))
          throw new ApiError("INVALID_ARGUMENT", "答复包含不属于该评分卡的问题。");
        answerMap.set(a.question_code,cleanAnswer(a.answer));
      }
      const open = questionRows.filter(q=>q.level==='blocking' && !cleanAnswer(answerMap.get(q.question_code) ?? q.answer)).length;
      if (open) throw new ApiError("INVALID_ARGUMENT", `还有 ${open} 项阻断没有作答，请先补充答复再写入。`);
      if(accepted.some(c=>!rows.some(r=>r.item_code===c))) throw new ApiError("INVALID_ARGUMENT", "包含不属于该评分卡的条目。");
      // 未通过项补充信息：只写「已 Accept」条目上的补充（与 `accepted` 同门槛，符合 R-10「只写已 Accept 内容」）
      const suppInput = Array.isArray(req.body?.supplements) ? req.body!.supplements! : [];
      const supps = [...new Map(suppInput
        .map(s => ({ item_code: String(s?.item_code ?? ""), text: String(s?.text ?? "").trim() }))
        .filter(s => s.item_code && s.text && accepted.includes(s.item_code))
        .map(s => [s.item_code,s])).values()];
      if (supps.some(s=>rows.find(i=>i.item_code===s.item_code)?.verdict!=='fail'))
        throw new ApiError("INVALID_ARGUMENT", "只有未通过项可以补充说明。");
      if (supps.some(s => !rows.some(r => r.item_code === s.item_code))) throw new ApiError("INVALID_ARGUMENT", "补充信息包含不属于该评分卡的条目。");
      // 检查项标题（按**本报告所用门禁标准版本**取）—— 补充信息以它作为落地小节的标题
      const stdRow = get<{ items_json: string }>(
        `SELECT items_json FROM tbl_gate_standard WHERE project_id = ? AND version = ?`, r.project_id, r.standard_version);
      const titleOf = new Map(json.parse<{ code: string; title: string }[]>(stdRow?.items_json ?? "[]", []).map((i) => [i.code, i.title]));
      const landed: { title: string; text: string }[] = [];
      // ① 补充信息「就地落章」（口径①）：以**检查项标题**为小节标题、把**用户自己填的**补充信息写进正文，
      //    复审时该检查项即可凭正文判 pass；只勾选**没填**的条目**不落章**（避免"写一句补齐××"就自我盖章）。
      for (const s of supps) {
        let title = titleOf.get(s.item_code);
        // 历史标准的 title 是组名。只在写回时映射，不改历史标准版本、不动自定义标题。
        if (!title || title === GROUP_TITLES[s.item_code.charAt(0)]) title = DEFAULT_ITEM_TITLES[s.item_code] || `补充说明（${s.item_code}）`;
        landed.push({title:title.replace(/[\r\n]/g," "),text:s.text});
      }
      // ② 澄清答复（口径②）：待澄清作答 + 假设选择 一并写进正文，让"答过的题"进入审核输入。
      const ansQ = questionRows.map(q=>({...q,answer:cleanAnswer(answerMap.get(q.question_code) ?? q.answer)})).filter(q=>q.answer);
      const ansA = all<{ content: string; choice: string }>(
        `SELECT content, choice FROM tbl_assumption WHERE review_id = ? AND choice <> 'unset' ORDER BY assumption_code`, r.review_id);
      const clar = [
        ...ansQ.map((q) => `- 问：${q.title}\n  答：${q.answer}`),
        ...ansA.map((a) => `- 假设：${a.content} → ${a.choice === "accept" ? "接受" : "转成待澄清"}`),
      ];
      if (clar.length) landed.push({ title: "澄清答复", text: clar.join("\n") });
      // ③ 只勾选、**没填补充信息**的条目 → 仍进文末「评审采纳建议」清单（沿用原语义）
      const leftover = rows
        .filter((r) => accepted.includes(r.item_code) && r.suggestion && !supps.some((s) => s.item_code === r.item_code))
        .map((r) => `- [${r.item_code}] ${r.suggestion}`);
      let next = revisionText(rev);
      if (next !== kb.content_md) throw new ApiError("TASK_STALE", "PRD 正文与审核快照不一致，请重新审核。" );
      for (const s of landed) next = upsertSection(next, s.title, s.text);
      if (leftover.length) next = upsertSection(next, "评审采纳建议", leftover.join("\n"));
      const changed = next !== kb.content_md;
      const snapshotId=uid("snapshot");
      let newRevisionId = rev.revision_id;
      tx(()=>{
        for (const q of ansQ) run(`UPDATE tbl_gate_question SET answer=?,status='answered' WHERE question_code=?`,q.answer,q.question_code);
        run(`UPDATE tbl_review_item SET accepted=0 WHERE review_id=?`,r.review_id);
        for (const code of accepted) run(`UPDATE tbl_review_item SET accepted=1 WHERE review_id=? AND item_code=?`,r.review_id,code);
        writeMeta(r.project_id,`snapshot:${snapshotId}`,{review_id:r.review_id,revision_id:r.revision_id,kb_doc_id:kb.kb_doc_id,version:kb.version,content_md:kb.content_md,created_at:nowIso()});
        // 补充信息落库，便于回写后重新进页仍可见（与 PRD 已写入内容一致）
        for (const s of supps) run(`UPDATE tbl_review_item SET supplement = ? WHERE review_id = ? AND item_code = ?`, s.text, r.review_id, s.item_code);
        if(changed) {
          run(`UPDATE tbl_kb_doc SET content_md=?,origin='user_edited',version=version+1,updated_at=? WHERE kb_doc_id=?`,next,nowIso(),kb.kb_doc_id);
          newRevisionId = materializeEditedRevision(r.project_id,rev.document_id,next);
          if (revisionText(loadRevision(user,newRevisionId)) !== next) throw new ApiError("INTERNAL", "写回版本核验失败。");
        }
      });
      const diff = {deleted_lines:0,modified_lines:0,added_lines:changed?next.split("\n").length-kb.content_md.split("\n").length:0};
      void reply.send({code:"OK",message:"",request_id:String(req.id),data:{...diff,diff_summary:diff,
        changed,new_revision_id:newRevisionId,kb_doc_id:kb.kb_doc_id,kb_version:kb.version+(changed?1:0),
        content_hash:digest(next),sections_added:[...new Set(landed.map(s=>s.title))],snapshot:true,snapshot_id:snapshotId}});

    });

  /** #24 门禁标准（项目级） */
  app.get<{ Params: { project_id: string } }>("/api/v1/projects/:project_id/gate-standards", async (req, reply) => {
    const user = currentUser(req);
    assertProjectAccess(user, req.params.project_id);
    const std = currentStandard(req.params.project_id);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: { standard_id: std.standard_id, version: std.version, is_current: true,
        items: std.items.map((i) => ({ code: i.code, level: i.level, title: i.title })) },
    });
  });

  app.put<{ Params: { project_id: string }; Body: { items?: { code: string; level: Level; title: string }[] } }>(
    "/api/v1/projects/:project_id/gate-standards", async (req, reply) => {
      const user = currentUser(req);
      assertProjectAccess(user, req.params.project_id);
      if (user.role !== "admin") {
        throw new ApiError("FORBIDDEN", "门禁标准由管理员维护，需求方只读。");
      }
      const cur = currentStandard(req.params.project_id);
      const nextItems = (req.body?.items ?? []).map((i) => ({
        code: String(i.code), group: String(i.code).slice(0, 1).toUpperCase(),
        title: String(i.title ?? ""), level: i.level,
      }));
      if (!nextItems.length) throw new ApiError("INVALID_ARGUMENT", "门禁标准不能为空。");
      assertIfMatch(req,cur.version);
      if(nextItems.some(i=>!["blocking","major","suggestion"].includes(i.level)) || new Set(nextItems.map(i=>i.code)).size!==nextItems.length) throw new ApiError("INVALID_ARGUMENT", "门禁标准编号或等级无效。");
      const nextVersion = cur.version + 1;
      tx(() => {
        run(`UPDATE tbl_gate_standard SET is_current = 0 WHERE project_id = ?`, req.params.project_id);
        run(`INSERT INTO tbl_gate_standard (standard_id, project_id, version, is_current, items_json, created_at) VALUES (?,?,?,1,?,?)`,
          cur.standard_id, req.params.project_id, nextVersion, json.stringify(nextItems), nowIso());
      });
      // **历史评分不重算**：已出的评分卡保留其 standard_version
      void reply.send({
        code: "OK", message: "", request_id: String(req.id),
        data: { standard_id: cur.standard_id, version: nextVersion, is_current: true },
      });
    });
}
