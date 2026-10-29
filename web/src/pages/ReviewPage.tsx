import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert, App as AntApp, Button, Card, Checkbox, Collapse, Drawer, Empty, Form, Input, Modal,
  Radio, Segmented, Space, Spin, Switch, Table, Tag, Typography,
} from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import {
  acceptCandidates, decideAssumption, exportReviewReport, fetchAssumptions, fetchProject,
  fetchGateStandard, fetchQuestions, fetchReview, fetchReviewItems, triggerReview, writeback, fetchTask,
  fetchStats, abortProject, fetchKbDoc,
  type Assumption, type GateQuestion, type Level, type ReviewItem, type ReviewLevel,
} from "@/store/session";
import { ApiError } from "@/api/client";
import { track } from "@/track";
import Markdown from "@/components/Markdown";
import { normalizeAnswer, reviewSubmitReasons } from "./reviewState";


/**
 * `UI-REVIEW-001` 审核结果页 —— 文案逐字取自 `UI-Spec §4.6 ④ 文案字样`。
 * 关键约束：
 *  - 门禁结论**不只靠颜色**（图标 + 文字）；
 *  - 「一键采纳」= **仅批量勾选，不写 PRD**；回写是**显式一步**（勾选 → 确认弹窗 → 写入）；
 *  - 假设 `unset` → **生成入口禁用 + 说明原因**；
 *  - 阻断未答 → 「还有 {n} 项阻断没有作答，无法进入拆解。」+ 可点击高亮跳转。
 */

const LEVEL_TAG: Record<Level, { text: string; color: string }> = {
  blocking: { text: "阻断", color: "error" },
  major: { text: "重要", color: "warning" },
  suggestion: { text: "建议", color: "default" },
};
const FALLBACK_TEXT: Record<string, string> = {
  not_yet_defined: "未定义", none: "无", not_identified: "未识别", not_applicable: "不适用",
};

/**
 * PRD 审核分级（2026-10-28 定稿）：简审 / 标准 / 严格。
 * **档位强度说明必须与控件同屏可见**（沿用 `REQ-SPLIT-002` 的口径）。
 */
const REVIEW_LEVELS: { key: ReviewLevel; label: string; tag: string; note: string }[] = [
  { key: "quick", label: "简审", tag: "快速",
    note: "简审：只判「能不能实现、有没有冲突」两项，其余检查项不评（不跑角落扫描）。放行的项目会标为「非可开发级」。" },
  { key: "standard", label: "标准", tag: "默认",
    note: "标准：精简表 14 项全评 + 角落扫描（核心 6 面）+ 来源标注强制。" },
  { key: "strict", label: "严格", tag: "完整",
    note: "严格：完整表 40+ 项细则全评 + 全部 14 个条件面 + 角落扫描表；「重要」项不过也阻断。可另开「超严扩展」。" },
];
const levelOf = (k: ReviewLevel) => REVIEW_LEVELS.find((x) => x.key === k) ?? REVIEW_LEVELS[1];

/**
 * `EL-REVIEW-054` 自动审核（**设备级界面偏好**，落 `localStorage['ad.v1.device.reviewAuto']`（`App-Spec §7`），**默认开**）：
 *  - 进页**没有报告**时自动开审（免去一次「开始审核」点击）；
 *  - 回写成功后**自动重审**（免去「已过期 → 点重新审核」这一跳）。
 */
const AUTO_KEY = "ad.v1.device.reviewAuto";
const AUTO_KEY_LEGACY = "ad.review.auto";   // 首版键（无 scope），读取时向后兼容
function readAuto(): boolean {
  try { return (localStorage.getItem(AUTO_KEY) ?? localStorage.getItem(AUTO_KEY_LEGACY)) !== "0"; } catch { return true; }
}

export default function ReviewPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const { message, modal } = AntApp.useApp();

  const [reviewId, setReviewId] = useState<string>("");
  const [reviewRevision, setReviewRevision] = useState("");
  const [writing, setWriting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const actionLock = useRef(false);
  const [docOpen, setDocOpen] = useState(false);
  const [savedPrd, setSavedPrd] = useState<{kb_doc_id:string;title:string;version:number;content_md:string;revision_id:string} | null>(null);
  const [writeNotice, setWriteNotice] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [verdict, setVerdict] = useState<string>("");
  const [revisionId, setRevisionId] = useState("");
  const [stdVersion, setStdVersion] = useState(0);
  const [usedModel, setUsedModel] = useState("");
  const [superseded, setSuperseded] = useState(false);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [questions, setQuestions] = useState<GateQuestion[]>([]);
  const [assumptions, setAssumptions] = useState<Assumption[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState<Record<string, string>>({});
  /** 未通过项 · 补充信息（`EL-REVIEW-053`）：按 `item_code` 存；回写前为本地态，随 `#23` 一并写入 PRD */
  const [supplements, setSupplements] = useState<Record<string, string>>({});
  /** `EL-REVIEW-054` 自动审核（进页自动开审 + 回写后自动重审） */
  const [auto, setAuto] = useState<boolean>(() => readAuto());
  function toggleAuto(v: boolean) {
    setAuto(v);
    try {
      localStorage.setItem(AUTO_KEY, v ? "1" : "0");
      localStorage.removeItem(AUTO_KEY_LEGACY);
    } catch { /* 隐私模式等写入失败：忽略 */ }
  }

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [blockedTip, setBlockedTip] = useState("");
  const [writeOpen, setWriteOpen] = useState(false);
  /** 提交复审二次确认（`EL-REVIEW-050`；破坏性 = 旧评分卡作废） */
  const [submitOpen, setSubmitOpen] = useState(false);
  /** 前置拦截定位态：被高亮的那条未定稿假设（`EL-REVIEW-014` 边界） */
  const [flashAssumption, setFlashAssumption] = useState<string | null>(null);
  const [stdOpen, setStdOpen] = useState(false);
  /** `EL-REVIEW-039` 未审核空态：`#6` 的 `gate.verdict === "unreviewed"` → 显示「开始审核」而不是自动开审 */
  const [phase, setPhase] = useState<"probing" | "idle" | "running" | "stale">("probing");
  /**
   * `EL-REVIEW-033` 评分卡过期：`#6` 的 `gate.review_revision_id !== current_revision_id`
   * → 显示「已过期」+「重新审核」，**不进页自动开审**（D-1 残余收口，2026-10-22）。
   */
  const [staleRevision, setStaleRevision] = useState<string>("");
  /** `EL-REVIEW-037` 超限二选一：`#6` 的 `loopback_round > 3` 时出现 */
  const [loopback, setLoopback] = useState<number | null>(null);
  const [loopbackChoice, setLoopbackChoice] = useState<"accept_and_record" | "abort" | null>(null);
  const [aborting, setAborting] = useState(false);
  const [stdItems, setStdItems] = useState<{ code: string; level: Level; title: string }[]>([]);
  const [stdSaving, setStdSaving] = useState(false);
  /** PRD 审核分级（2026-10-28 定稿）：本次审核等级 + 超严扩展开关 */
  const [level, setLevel] = useState<ReviewLevel>("standard");
  const [extended, setExtended] = useState(false);
  /** 用户是否**显式改过**档位：没改过就不覆盖项目默认（R-01 优先级） */
  const levelTouched = useRef(false);
  const levelRef = useRef<ReviewLevel>("standard");
  const extRef = useRef(false);
  useEffect(() => { levelRef.current = level; }, [level]);
  useEffect(() => { extRef.current = level === "strict" ? extended : false; }, [level, extended]);

  const loadAll = useCallback(async (rid: string) => {
    const [rv, its, qs, as] = await Promise.all([
      fetchReview(rid), fetchReviewItems(rid), fetchQuestions(rid), fetchAssumptions(rid),
    ]);
    setVerdict(rv.verdict); setReviewRevision(rv.revision_id);
    setRevisionId(rv.prd?.revision_id ?? rv.revision_id); setStdVersion(rv.standard_version);
    if (rv.prd) {
      try {
        const doc = await fetchKbDoc(rv.prd.kb_doc_id);
        if (doc.version !== rv.prd.version || doc.content_hash !== rv.prd.content_hash) throw new Error("正文版本不一致");
        setSavedPrd({...doc,revision_id:rv.prd.revision_id}); setDocumentError("");
      } catch { setSavedPrd(null); setDocumentError("当前 PRD 正文未读取成功，请重试。"); }
    }
    setUsedModel(rv.model || "");
    setSuperseded(rv.superseded);
    // 审核分级：把本次报告实际用的档位回显到控件（不视为「用户改动」）
    setLevel(rv.review_level ?? "standard");
    setExtended(!!rv.review_extended);
    levelTouched.current = false;
    setItems(its.items); setQuestions(qs.items); setAssumptions(as.items);
    setAccepted(new Set(its.items.filter((i) => i.accepted).map((i) => i.item_code)));
    setAnswered(Object.fromEntries(qs.items.map((q) => [q.question_code, normalizeAnswer(q.answer)])));
    setSupplements(Object.fromEntries(its.items.map((i) => [i.item_code, i.supplement ?? ""])));
    // 漏斗节点 3：评分卡 `verdict` 产生时（passed/blocked/superseded/malformed）
    track("EVT_review_verdict", {
      verdict: rv.verdict, blocking_count: its.items.filter((i) => i.level === "blocking").length,
      revision_id: rv.revision_id, standard_version: rv.standard_version,
    }, { dedupKey: `verdict:${rid}:${rv.verdict}`, immediate: true });
  }, []);

  const loadingReview = useRef(false);
  /**
   * 开审。`fromUser` = 是否**用户提交**（决定要不要报 `EVT_review_submit`）；
   * `opts.silent` = **自动开审 / 回写后自动重审**（非用户动作）→ 不报该事件（`埋点-Spec §3.12`）。
   */
  const start = useCallback(async (fromUser = false, opts: { silent?: boolean } = {}) => {
    if (loadingReview.current) return;
    loadingReview.current = true;
    setLoading(true); setElapsed(0); setError(null);
    try {
      // 取项目的当前 revision（解析产出的那一条），再对它触发审核
      const proj = await fetchProject(projectId);
      const revId = proj.current_revision_id;
      if (!revId) {
        setError(new ApiError("NOT_FOUND", 404, "这个项目还没有解析好的 PRD，请先上传并解析。"));
        setLoading(false);
        loadingReview.current=false;
        return;
      }
      setRevisionId(revId);
      // `force`：只有用户主动「重新审核 / 提交复审 / 重试」才强制重跑；
      // 进页自动加载**不强制** —— 服务端会复用已有报告（不新建、不作废、不调模型）。
      // 档位：用户显式改过才带上（带上即覆盖项目默认，见 R-01）；否则用项目默认。
      const reviewOpts: { force: boolean; level?: ReviewLevel; extended?: boolean } = { force: fromUser };
      if (levelTouched.current) {
        reviewOpts.level = levelRef.current;
        if (levelRef.current === "strict") reviewOpts.extended = extRef.current;
      }
      const r = await triggerReview(revId, reviewOpts);
      setReviewId(r.review_id);
      // 只有用户点「提交复审」触发时才上报（与「审核完成」是两个事件）
      if (fromUser && !opts.silent) {
        track("EVT_review_submit", {
          review_id: r.review_id, task_id: r.task_id,
          standard_version: (r as { standard_version?: number }).standard_version ?? null,
        }, { dedupKey: r.task_id, immediate: true });
      }
      // 复用已有终态报告：`task_id` 为 `null`，没有任务可等，直接拉评分卡。
      let settled = false;
      if (r.task_id) {
        // 等待当前 task 的终态，不把旧报告或运行中报告当成功。
        for (let i=0;i<300;i++) {
          await new Promise(res=>setTimeout(res,1000)); setElapsed(i+1);
          const task=await fetchTask(r.task_id);
          if(task.status === "succeeded") {await loadAll(r.review_id);settled=true;break;}
          if(["failed","timeout","canceled"].includes(task.status)) throw new ApiError("UPSTREAM_UNAVAILABLE",503,`审核未完成（${task.error_code ?? task.status}）。`);
        }
        if(!settled) throw new ApiError("UPSTREAM_TIMEOUT",504,"审核等待超时，请稍后重试。");
      } else {
        await loadAll(r.review_id);
        settled = true;
      }
    } catch (e) {
      setError(e as ApiError);
    } finally { loadingReview.current=false; setLoading(false); }
  }, [projectId, loadAll]);

  // 先探三态（`#6`）与回流轮次：
  //   ① 从未审核（`gate.verdict === "unreviewed"`）→ 空态 +「开始审核」；
  //   ② 已审核但 PRD 换版（报告绑的 revision ≠ 当前 revision）→ `EL-REVIEW-033`「已过期」+「重新审核」，
  //      **不进页自动开审**（D-1 残余收口，2026-10-22）；
  //   ③ 其余 → 直接进入：`#16` 不带 `force` 会复用已有报告，不新建、不作废、不调模型。
  useEffect(() => {
    let alive = true;
    fetchStats(projectId)
      .then((s) => {
        if (!alive) return;
        setLoopback(s.loopback_round);
        // 档位回显（项目当前等级）；不视为「用户改动」
        if (s.gate?.review_level) setLevel(s.gate.review_level);
        setExtended(!!s.gate?.review_extended);
        if (s.gate?.verdict === "unreviewed") {
          // 首次进页**不抢跑**：先把「审核等级」交给用户选，再点「开始审核」。
          // （`自动审核` 开关只作用于「回写后自动重审」，见 `doWriteback` 末尾。）
          setPhase("idle");
          return;
        }
        const cur = s.current_revision_id ?? null;
        const rep = s.gate?.review_revision_id ?? null;
        if (cur && rep && cur !== rep) { setStaleRevision(cur); setPhase("stale"); return; }
        setPhase("running");
      })
      .catch(() => { if (alive) setPhase("running"); });   // 探测失败 → 走原自动流程兜底
    return () => { alive = false; };
  }, [projectId]);

  // 「开始审核」是**用户主动开审**，必须 `force:true`；进页自动加载与探测兜底都**不强制**（走复用）。
  // `silent`：**自动行为**（进页自动开审 / 回写后自动重审）不报 `EVT_review_submit`。
  const nextIntent = useRef<{ force: boolean; silent: boolean }>({ force: false, silent: false });
  const askStart = (silent: boolean) => { nextIntent.current = { force: true, silent }; setPhase("running"); };
  useEffect(() => {
    if (phase !== "running") return;
    const intent = nextIntent.current;
    nextIntent.current = { force: false, silent: false };
    void start(intent.force, { silent: intent.silent });
  }, [phase, start]);

  const blockingUnanswered = useMemo(
    () => questions.filter((q) => q.level === "blocking" && !normalizeAnswer(answered[q.question_code])).length,
    [questions, answered],
  );
  const unsetAssumptions = useMemo(() => assumptions.filter((a) => a.choice === "unset").length, [assumptions]);
  const dirtyContent = questions.some(q => normalizeAnswer(answered[q.question_code]) !== normalizeAnswer(q.answer))
    || items.some(i => (supplements[i.item_code] ?? "").trim() !== (i.supplement ?? "").trim());
  const submitReasons = reviewSubmitReasons({busy:writing || deciding || loading,blockingOpen:blockingUnanswered,
    unset:unsetAssumptions,dirty:dirtyContent,revisionChanged:revisionId !== reviewRevision});
  const canSubmit = !!reviewId && !documentError && submitReasons.length === 0;
  const canWrite = !writing && !deciding && !loading && !superseded && !unsetAssumptions && !blockingUnanswered && !documentError;

  async function changeAssumption(code: string, choice: "accept" | "convert") {
    if (actionLock.current) return;
    actionLock.current = true; setDeciding(true);
    try {
      await decideAssumption(reviewId,code,choice);
      const [qs,as] = await Promise.all([fetchQuestions(reviewId),fetchAssumptions(reviewId)]);
      setQuestions(qs.items); setAssumptions(as.items);
      setAnswered(old=>Object.fromEntries(qs.items.map(q=>[q.question_code,old[q.question_code] ?? normalizeAnswer(q.answer)])));
    } catch (err) { message.error((err as ApiError).message || "操作没成功。"); }
    finally { actionLock.current=false; setDeciding(false); }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, ReviewItem[]>();
    for (const it of items) {
      // **审核通过（pass）的项不展示**：评分卡只列「未通过 / 未评」，
      // 完整清单仍可在「导出审核报告」里看到（导出取的是 `#18` 全量）。
      if (it.verdict === "pass") continue;
      const k = `${it.group}${it.group_title ? " " + it.group_title : ""}`;
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()];
  }, [items]);

  /** `EL-REVIEW-037` 接受并记录：记录后放行拆解（不改数据，只记录选择） */
  function acceptLoopback() {
    setLoopbackChoice("accept_and_record");
    track("EVT_review_loopback_exceeded", { choice: "accept_and_record", loopback_round: loopback ?? 0 },
      { dedupKey: `loopback:accept:${projectId}`, immediate: true });
    message.success("已接受并记录，可继续进入拆解。");
  }

  /** `EL-REVIEW-037` 中止：`#70` 归档并终止本流程（破坏性 → 服务端亦校验 `confirm`） */
  async function abortLoopback() {
    if (aborting) return;
    setAborting(true);
    try {
      await abortProject(projectId);
      setLoopbackChoice("abort");
      track("EVT_review_loopback_exceeded", { choice: "abort", loopback_round: loopback ?? 0 },
        { dedupKey: `loopback:abort:${projectId}`, immediate: true });
      message.success("已中止并归档本流程。");
      nav(`/projects/${projectId}/workbench`);
    } catch (e) {
      message.error((e as ApiError).message || "中止没成功。");
    } finally { setAborting(false); }
  }

  // ---------- 动作 ----------
  async function submitReview() {
    if (!canSubmit || actionLock.current) { setSubmitOpen(false); return; }
    setSubmitOpen(false); setBlockedTip("");
    await start(true);
  }

  /**
   * **前置拦截（`EL-REVIEW-014` 边界 / 强度 = 只跳转）**：假设未定稿时，写回入口
   * **不弹窗、不发起 `#22`**，只提示 + **滚动定位并高亮**第一条未选假设
   * （复用 `EL-REVIEW-035` 的「点击高亮跳转」模式）。返回 `true` 表示已拦截。
   */
  function blockForUnsetAssumptions(): boolean {
    if (unsetAssumptions === 0) return false;
    message.warning(`还有 ${unsetAssumptions} 条假设没有选择，先逐条选完再继续。`);
    const first = assumptions.find((a) => a.choice === "unset");
    if (first) {
      document.getElementById(`a-${first.assumption_code}`)?.scrollIntoView({ block: "center" });
      setFlashAssumption(first.assumption_code);
      window.setTimeout(() => {
        setFlashAssumption((c) => (c === first.assumption_code ? null : c));
      }, 2000);
    }
    return true;
  }

  /** `EL-REVIEW-014` 写回入口（在**底部操作条**）：仅批量勾选 → 弹 `EL-REVIEW-028` */
  async function doAcceptAll() {
    if (blockForUnsetAssumptions()) return;
    const codes = items.filter((i) => i.suggestion || supplements[i.item_code]?.trim()).map((i) => i.item_code);
    try {
      await acceptCandidates(reviewId, codes);
      setAccepted(new Set(codes));
      // 「仅批量勾选」完成后**立即**弹出写回确认（`EL-REVIEW-014` → `EL-REVIEW-028`）
      setWriteOpen(true);
    } catch (e) { message.error((e as ApiError).message || "操作没成功。"); }
  }

  async function doWriteback() {
    if (!canWrite || actionLock.current) return;
    actionLock.current=true; setWriting(true); setDocumentError("");
    let verified = false;
    try {
      const supps = [...accepted].map(c=>({item_code:c,text:(supplements[c] ?? "").trim()})).filter(s=>s.text);
      const answers = questions.map(q=>({question_code:q.question_code,answer:normalizeAnswer(answered[q.question_code])}));
      // 答复与补充同一次 #23 原子写入；不再先保存一半再生成新版本。
      const r = await writeback(reviewId,[...accepted],supps,answers);
      if (!r.kb_doc_id || !r.new_revision_id || !r.content_hash) throw new Error("后端未返回写回版本信息，不能确认内容已生效。");
      setRevisionId(r.new_revision_id);
      if (r.changed) setSuperseded(true);
      setWriteOpen(false);
      const doc = await fetchKbDoc(r.kb_doc_id);
      setSavedPrd({...doc,revision_id:r.new_revision_id});
      // GET #8 返回同份正文的服务端 SHA-256，兼容局域网 HTTP（无 Web Crypto secure context）。
      const hash = doc.content_hash;
      if (doc.version !== r.kb_version || hash !== r.content_hash) throw new Error("写回成功，但正文回读核验不一致，请查看当前 PRD，不要继续复审。");
      if (supps.some(s=>!doc.content_md.includes(s.text))) throw new Error("部分补充说明未在正文中找到，已停止自动复审。");
      setItems(old=>old.map(i=>({...i,supplement:supps.find(s=>s.item_code===i.item_code)?.text ?? i.supplement})));
      setQuestions(old=>old.map(q=>({...q,answer:normalizeAnswer(answered[q.question_code]),status:normalizeAnswer(answered[q.question_code]) ? "answered" : "open"})));
      setWriteNotice(r.changed ? `已写回并核验 PRD v${doc.version}，本次写入小节：${r.sections_added.join("、") || "评审采纳建议"}。` : "正文没有新增内容，无需重复复审。");
      message.success(r.changed ? "补充内容已写回并通过正文核验。" : "正文没有变化。");
      track("EVT_review_writeback",{deleted_lines:r.deleted_lines,modified_lines:r.modified_lines,
        added_lines:r.added_lines,accepted_items_count:accepted.size,new_revision_id:r.new_revision_id},
        {dedupKey:reviewId,immediate:true});
      verified = r.changed;
    } catch (e) {
      setDocumentError((e as Error).message || "回写没成功。"); message.error((e as Error).message || "回写没成功。");
    } finally { actionLock.current=false; setWriting(false); }
    if (verified && readAuto()) void start(true,{silent:true});
  }

  function enterSplit() {
    if (unsetAssumptions > 0) {
      message.warning(`还有 ${unsetAssumptions} 条假设没有选择，先逐条选完再继续。`);
      return;
    }
    if (blockingUnanswered>0 || verdict !== "passed" || superseded) {
      message.warning(blockingUnanswered>0?`还有 ${blockingUnanswered} 项阻断没有作答，无法进入拆解。`:"请先完成当前 PRD 的门禁审核。"); return;
    }
    // R-10：**简审放行 = 非可开发级** → 进拆解前显式确认（不阻止，但必须让用户知情）
    if (level === "quick") {
      modal.confirm({
        title: "当前是「简审」放行（非可开发级）",
        content: "本次只判了「可实现性 / 内部一致性」，未检查数据字段、接口契约与角落组合，拆解与后续生成可能失败。建议把等级升到「标准」重审。仍要继续？",
        okText: "仍要继续", cancelText: "先升档重审",
        onOk: () => {
          track("EVT_review_override_continue", { level, review_id: reviewId },
            { dedupKey: `override:${reviewId}`, immediate: true });
          nav(`/projects/${projectId}/split`);
        },
      });
      return;
    }
    nav(`/projects/${projectId}/split`);
  }

  /** 自动重审开关（回写成功后自动重跑一次审核）；**首次审核不再自动开审**（要先选等级） */
  const autoSwitch = (
    <Space size={6} align="center">
      <Switch size="small" checked={auto} onChange={toggleAuto} aria-label="回写后自动重审" />
      <Typography.Text style={{ fontSize: 12 }}>回写后自动重审</Typography.Text>
    </Space>
  );

  /** 审核分级：切档（**只影响下一次触发**；已出报告不重算，需重新审核才生效） */
  function changeLevel(next: ReviewLevel) {
    if (next === level) return;
    setLevel(next);
    levelTouched.current = true;
    if (next !== "strict") setExtended(false);
    track("EVT_review_level_change", { from: level, to: next },
      { dedupKey: `level:${projectId}:${next}:${Date.now()}`, immediate: true });
    if (reviewId && !superseded) {
      message.info(`等级已改为「${levelOf(next).label}」。已出的报告不会重算，需点「提交复审 / 重新审核」才生效。`);
    }
  }

  /** 档位控件 + **强度说明同屏可见**（`UI-Spec` 口径：说明必须与控件同屏） */
  const levelControl = (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space wrap align="center" size={12}>
        <Segmented
          value={level}
          onChange={(v) => changeLevel(v as ReviewLevel)}
          options={REVIEW_LEVELS.map((l) => ({ value: l.key, label: `${l.label} ${l.tag}` }))}
        />
        {level === "strict" && (
          <Space size={6} align="center">
            <Switch size="small" checked={extended} aria-label="超严扩展"
              onChange={(v) => {
                setExtended(v); levelTouched.current = true;
                track("EVT_review_extended_toggle", { enabled: v }, { dedupKey: `ext:${projectId}:${Date.now()}`, immediate: true });
              }} />
            <Typography.Text style={{ fontSize: 12 }}>超严扩展</Typography.Text>
          </Space>
        )}
      </Space>
      <div style={{ marginTop: 10, fontSize: 13, color: "var(--ad-text-secondary)" }}>{levelOf(level).note}</div>
    </Card>
  );

  // ---------- 渲染 ----------
  // ⚠️ 顺序要求：`probing` / `idle` 必须先于 `loading` 判断。
  // 未审核项目走 `idle` 空态时 `start()` 从未执行，`loading` 仍是初始 `true`，
  // 若先判 `loading` 会永远停在「正在审查这份 PRD…」，永远看不到「开始审核」。
  if (phase === "probing") {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {/* 档位控件必须在**任何状态下都可见**，用户才能「审核之前先选等级」 */}
        {levelControl}
        <Card>
          <div style={{ display: "grid", placeItems: "center", height: 160 }}>
            <Spin /><div style={{ marginTop: 12 }}>正在检查审核状态…</div>
          </div>
        </Card>
      </div>
    );
  }
  if (phase === "idle") {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {levelControl}
        <Card>
          <Empty description={<span style={{ fontSize: 13 }}>还没开始审核。</span>}>
            <Space direction="vertical" align="center" size={8}>
              <Button type="primary" onClick={() => askStart(false)}>开始审核</Button>
              {autoSwitch}
            </Space>
          </Empty>
        </Card>
      </div>
    );
  }
  // `EL-REVIEW-033` 评分卡过期：提示条（灰）+ `EL-REVIEW-034`「重新审核」。
  // **不进页自动开审** —— 等用户点；点后走 `force:true` 对当前 revision 重跑。
  if (phase === "stale") {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {levelControl}
        <Card>
          <div style={{
            display: "flex", alignItems: "center", width: "100%", height: 36, paddingLeft: 12,
            background: "var(--ad-bg-disabled)", borderRadius: 4, fontSize: 13, color: "var(--ad-text-tertiary)",
          }}>
            <ClockCircleOutlined style={{ fontSize: 16, marginRight: 8 }} />
            <span>这份评分卡已过期（PRD 已更新到 {staleRevision}）。</span>
            <Button type="link" style={{ marginLeft: 12, fontSize: 13, padding: 0, height: "auto" }}
              disabled={writing || deciding || !!documentError} onClick={() => askStart(false)}>重新审核</Button>
            <div style={{ marginLeft: "auto", paddingRight: 12 }}>{autoSwitch}</div>
          </div>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {levelControl}
        <Card>
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin />
            <div style={{ marginTop: 12 }}>
              正在审查这份 PRD…（审核等级：{levelOf(level).label}{level === "strict" && extended ? " · 超严扩展" : ""}）
            </div>
            {elapsed >= 300 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已超过 5 分钟，可以继续等待或稍后回来查看。
              </Typography.Text>
            )}
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {levelControl}
        <Card>
          <Empty description={
            <div>
              <div>审核没跑完。</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>原因：{error.message}</Typography.Text>
            </div>
          }>
            <Button onClick={() => void start(true)}>重试</Button>
          </Empty>
        </Card>
      </div>
    );
  }

  const blocked = questions.filter((q) => q.level === "blocking").length;
  const passed = verdict === "passed";
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <Typography.Title className="ad-page-title">审核结果</Typography.Title>
        <Button onClick={() => nav(`/projects/${projectId}/workbench`)}>返回工作台</Button>
        <div style={{ flex: 1 }} />
        <Button onClick={() => { void exportReviewReport(projectId, reviewId).then(r => {
          if(!r.content_md) throw new Error("报告内容为空，未下载。");
          const u=URL.createObjectURL(new Blob([r.content_md],{type:"text/markdown;charset=utf-8"}));
          const a=document.createElement("a");a.href=u;a.download="审核报告.md";a.click();URL.revokeObjectURL(u);
          message.success("审核报告已导出。");
        }).catch((e) => message.error((e as ApiError).message)); }}>
          导出审核报告
        </Button>
        <Button onClick={() => setStdOpen(true)}>门禁标准</Button>
      </div>

      {/* 审核分级控件（同屏可见的强度说明） */}
      {levelControl}

      {/* 简审放行提示：不是可开发级，必须显著区别于标准 / 严格 */}
      {level === "quick" && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="简审放行 · 非可开发级"
          description="本次只判了「可实现性 / 内部一致性」两项，未检查数据字段、接口契约与角落组合。进入拆解前需要确认。" />
      )}

      {/* 结论徽标（图标 + 文字，不只靠颜色） */}
      <Card style={{ marginBottom: 12 }}>
        <Space size={16} wrap>
          <Tag color={passed ? "success" : "error"} style={{ fontSize: 14, padding: "4px 10px" }}>
            {passed ? "✓ 已通过" : `✕ 未通过（${blocked} 项阻断）`}
          </Tag>
          <Tag color="blue">审核等级：{levelOf(level).label}{level === "strict" && extended ? "（超严扩展）" : ""}</Tag>
          <Typography.Text type="secondary">基于文档版本 {revisionId.slice(-6)}</Typography.Text>
          <Typography.Text type="secondary">门禁标准 v{stdVersion}</Typography.Text>
          <Typography.Text type="secondary">第 1/3 轮</Typography.Text>
        </Space>
      </Card>

      {superseded && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message={`这份评分卡已过期（PRD 已更新到 ${revisionId.slice(-6)}）。`}
          action={<Button size="small" disabled={!canSubmit} onClick={() => void start(true)}>重新审核</Button>} />
      )}

      {/* 评分卡 */}
      <Card
        style={{ marginBottom: 12 }}
        title={
          <Space size={8}>
            <span>评分卡</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: "normal" }}>
              仅显示未通过项（{items.length - items.filter((i) => i.verdict === "pass").length}/{items.length}）
            </Typography.Text>
            {usedModel && <Tag color="geekblue">模型：{usedModel}</Tag>}
          </Space>
        }
      >
        {grouped.length === 0 ? (
          <Empty description={<span style={{ fontSize: 13 }}>所有检查项均已通过。完整清单见「导出审核报告」。</span>} />
        ) : (
        <Collapse
          defaultActiveKey={grouped.map(([k]) => k)}
          items={grouped.map(([group, list]) => ({
            key: group,
            label: `${group}（${list.length}）`,
            children: (
              <Table
                size="small" rowKey="item_code" pagination={false}
                dataSource={list}
                expandable={{
                  // `EL-REVIEW-053` 未通过项 · 补充信息：仅「结论 = 未通过」的行可展开，默认展开
                  rowExpandable: (row: ReviewItem) => row.verdict === "fail",
                  defaultExpandedRowKeys: list.filter((r) => r.verdict === "fail").map((r) => r.item_code),
                  expandedRowRender: (row: ReviewItem) => (
                    <Space direction="vertical" style={{ width: "100%" }} size={4}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        补充信息：勾选「采纳」并写回后，会以该检查项标题落成 PRD 正文小节；只勾选、没填的进文末「评审采纳建议」。
                      </Typography.Text>
                      <Input.TextArea
                        rows={2} placeholder="在这里补充这条未通过项的说明 / 澄清"
                        value={supplements[row.item_code] ?? ""}
                        aria-label={`${row.item_code} 补充信息`}
                        disabled={writing || deciding || superseded}
                        onChange={(e) => {
                          const text=e.target.value;
                          setSupplements(s=>({...s,[row.item_code]:text}));
                          if (text.trim()) setAccepted(old=>new Set([...old,row.item_code]));
                        }}
                      />
                    </Space>
                  ),
                }}
                columns={[
                  { title: "编号", dataIndex: "item_code", width: 70 },
                  {
                    title: "等级", dataIndex: "level", width: 80,
                    render: (v: Level) => <Tag color={LEVEL_TAG[v].color}>{LEVEL_TAG[v].text}</Tag>,
                  },
                  {
                    title: "结论", dataIndex: "verdict", width: 90,
                    render: (v: string) => v === "pass" ? <span style={{ color: "#52c41a" }}>✓ 通过</span>
                      : v === "fail" ? <span style={{ color: "#ff4d4f" }}>✕ 未通过</span>
                      : <Tag style={{ color: "#8c8c8c" }}>未评</Tag>,
                  },
                  {
                    title: "证据", dataIndex: "evidence_ref", width: 180,
                    render: (v: string) => <a>{v}</a>,
                  },
                  { title: "完善建议", dataIndex: "suggestion", render: (v: string) => v || "—" },
                  {
                    title: "采纳", dataIndex: "item_code", width: 70,
                    render: (code: string, row: ReviewItem) => (
                      <Checkbox
                        checked={accepted.has(code)}
                        disabled={!row.suggestion && !supplements[code]?.trim()}
                        onChange={(e) => {
                          setAccepted((s) => { const n = new Set(s); e.target.checked ? n.add(code) : n.delete(code); return n; });
                        }}
                      />
                    ),
                  },
                ]}
              />
            ),
          }))}
        />
        )}
      </Card>

      {/* 待澄清清单 */}
      <Card title="待澄清清单" style={{ marginBottom: 12 }}>
        {/* `EL-REVIEW-037`：回流 >3 轮时的二选一（只在超限时出现，二选一后关闭） */}
      {loopback !== null && loopback > 3 && !loopbackChoice && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message={`回流已 ${loopback} 轮，超过 3 轮上限`}
          description="请选择：接受并记录（继续进入拆解），或中止本流程（归档）。"
          action={<Space>
            <Button size="small" type="primary" loading={aborting} onClick={acceptLoopback}>接受并记录</Button>
            <Button size="small" danger loading={aborting} onClick={() => void abortLoopback()}>中止</Button>
          </Space>} />
      )}

      {/* `EL-REVIEW-042`：agent 输出畸形降级提示（自动重试 1 次仍失败 → 需人工确认） */}
      {verdict === "malformed" && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="平台的输出格式不对，已自动重试一次仍失败。"
          description="需人工确认。" />
      )}

      {blockedTip && (
          <Alert type="error" showIcon style={{ marginBottom: 12 }} message={blockedTip} />
        )}
        {questions.length === 0 ? (
          <Empty description={
            <div>
              <div>没有待澄清项，可以直接进入拆解。</div>
            </div>
          }>
            <Button type="primary" onClick={enterSplit}>进入需求拆解</Button>
          </Empty>
        ) : (
          <Collapse
            defaultActiveKey={["blocking", "major", "suggestion"]}
            items={(["blocking", "major", "suggestion"] as Level[]).map((lv) => {
              const list = questions.filter((q) => q.level === lv);
              if (!list.length) return null;
              return {
                key: lv,
                label: `${LEVEL_TAG[lv].text}（${list.length}）`,
                children: list.map((q) => (
                  <Card key={q.question_code} id={`q-${q.question_code}`} size="small" style={{ marginBottom: 8 }}>
                    <Space direction="vertical" style={{ width: "100%" }} size={6}>
                      <Space>
                        <Tag color={LEVEL_TAG[q.level].color}>{LEVEL_TAG[q.level].text}</Tag>
                        <Typography.Text strong>{q.question_code}</Typography.Text>
                        <span>{q.title}</span>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        影响范围：{q.impact}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        兜底处置：{FALLBACK_TEXT[q.fallback] ?? q.fallback}
                      </Typography.Text>
                      <Radio.Group
                        value={answered[q.question_code]}
                        disabled={writing || deciding || superseded}
                        onChange={(e) => {
                          if (e.target.value!=="__other") setAnswered(old=>({...old,[q.question_code]:e.target.value}));
                        }}
                      >
                        <Space direction="vertical">
                          {q.options.map((o, i) => (
                            <Radio key={o} value={o}>{`${"ABCDE"[i]}. ${o}`}</Radio>
                          ))}
                          <Radio value="__other">{"X. Other"}</Radio>
                        </Space>
                      </Radio.Group>
                      <Input.TextArea
                        rows={3} placeholder="在这里写下你的答复"
                        aria-label={`${q.title} 答复`}
                        disabled={writing || deciding || superseded}
                        value={normalizeAnswer(answered[q.question_code])}
                        onChange={e=>setAnswered(old=>({...old,[q.question_code]:e.target.value}))}
                      />
                    </Space>
                  </Card>
                )),
              };
            }).filter(Boolean) as never}
          />
        )}
      </Card>

      {/* 假设清单 */}
      <Card title="假设确认清单" style={{ marginBottom: 12 }}>
        {assumptions.map((a) => (
          <div key={a.assumption_code} id={`a-${a.assumption_code}`}
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "8px 0",
              borderBottom: "1px solid var(--ad-border-light)",
              // 前置拦截的定位落点：短暂高亮（复用 `EL-REVIEW-035` 的高亮跳转模式）
              // 色值取色板 `C-08`（底）+ `C-07`（描边），2s 后自动消退
              ...(flashAssumption === a.assumption_code
                ? { background: "var(--ad-warn-bg-2)", outline: "2px solid #B45309", borderRadius: 4 }
                : {}),
            }}>
            <div style={{ flex: 1 }}>
              <div>{a.content}</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{a.source_tag}</Typography.Text>
            </div>
            <Radio.Group value={a.choice} disabled={writing || deciding || superseded}
              onChange={e=>void changeAssumption(a.assumption_code,e.target.value)}>
              <Radio value="accept">接受（accept）</Radio>
              <Radio value="convert">转成待澄清（convert）</Radio>
            </Radio.Group>
          </div>
        ))}
        {assumptions.filter(a=>a.choice==="convert").map(a=>{
          const q=questions.find(q=>q.question_code===`${a.assumption_code}_converted`);
          return <div key={`answer-${a.assumption_code}`} style={{padding:12,marginTop:8,background:"var(--ad-bg-page)"}}>
            <Typography.Text strong>补充内容：{a.content}</Typography.Text>
            {q ? <Input.TextArea rows={3} style={{marginTop:8}}
              aria-label={`${a.content} 补充内容`} placeholder="请说明这条假设应如何处理；确认写入后会保存到 PRD。"
              disabled={writing || deciding || superseded}
              value={normalizeAnswer(answered[q.question_code])}
              onChange={e=>setAnswered(old=>({...old,[q.question_code]:e.target.value}))} />
              : <Alert type="warning" message="待澄清问题尚未加载，请重新选择或刷新问题列表。" />}
          </div>;
        })}
        {unsetAssumptions > 0 && (
          <Alert style={{ marginTop: 12 }} type="warning" showIcon
            message={`还有 ${unsetAssumptions} 条假设没有选择，先逐条选完再继续。`} />
        )}
      </Card>

      {/* 底部操作条（`页面规格 §4.1`）：提交复审（主）+ 一键采纳全部建议（次）；写回是其后的一步弹窗确认。
          `ad-action-bar`：对话框停靠右下时自动让出安全区（见 `styles.css`），不被浮层压住。 */}
      <div className="ad-action-bar">
        {autoSwitch}
        <Button disabled={!canWrite} onClick={() => void doAcceptAll()}>一键采纳全部建议</Button>
        {/* `EL-REVIEW-052`「写回已勾选（{n} 项）」：写回**当前已勾选**的子集。
            **不调 `#22`**（勾选是本地态）→ 直接弹 `EL-REVIEW-028`；与 `EL-REVIEW-014` 共用同一前置拦截。
            `accepted = ∅` 时禁用（没有可写回的内容）〔2026-10-23〕 */}
        <Button
          disabled={!canWrite || (accepted.size === 0 && !questions.some(q=>normalizeAnswer(answered[q.question_code])))}
          onClick={() => { if (blockForUnsetAssumptions()) return; setWriteOpen(true); }}
        >
          写回已勾选（{accepted.size} 项）
        </Button>
        <Button type="primary" disabled={!canSubmit} onClick={() => setSubmitOpen(true)}>
          提交复审
        </Button>
        <Button disabled={writing || deciding || unsetAssumptions > 0 || blockingUnanswered > 0 || verdict!=="passed" || superseded || dirtyContent} onClick={enterSplit}>进入需求拆解</Button>
        <Button disabled={!savedPrd} onClick={()=>setDocOpen(true)}>查看当前 PRD</Button>
      </div>

      {submitReasons.length>0 && <Alert type="info" showIcon style={{marginTop:12}} message="提交复审暂不可用" description={submitReasons.join(" ")} />}
      {writeNotice && <Alert type="success" showIcon style={{marginTop:12}} message={writeNotice}
        action={<Button size="small" onClick={()=>setDocOpen(true)}>查看已写入正文</Button>} />}
      {documentError && <Alert type="error" showIcon style={{marginTop:12}} message={documentError} />}
      <Drawer title="当前 PRD 正文" width={780} open={docOpen} onClose={()=>setDocOpen(false)}>
        {savedPrd && <><p>{savedPrd.title} · v{savedPrd.version} · 当前版本 {savedPrd.revision_id}</p>
          <Button onClick={()=>nav(`/projects/${projectId}/kb?sector=prd&doc=${savedPrd.kb_doc_id}`)}>在知识库中打开</Button>
          <Markdown text={savedPrd.content_md} /></>}
      </Drawer>
      {/* `EL-REVIEW-050` 提交复审二次确认（旧评分卡会作废） */}
      <Modal
        title="提交复审？"
        open={submitOpen} okText="提交" cancelText="取消"
        okButtonProps={{disabled:!canSubmit}} onOk={()=>void submitReview()} onCancel={() => setSubmitOpen(false)}
      >
        <p>旧评分卡会标记为「已过期」，不参与放行判定。</p>
      </Modal>

      {/* 回写确认弹窗（显式一步） */}
      <Modal
        title="确认把这些内容写回 PRD？"
        open={writeOpen} okText="确认写入" cancelText="取消"
        confirmLoading={writing} okButtonProps={{disabled:!canWrite}} closable={!writing} maskClosable={!writing}
        onOk={() => void doWriteback()} onCancel={() => { if (!writing) setWriteOpen(false); }}
      >
        <p>只会写入你已勾选「采纳」的内容，回写前会保留原文快照。</p>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          已勾选 {accepted.size} 项（含 {[...accepted].filter((c) => (supplements[c] ?? "").trim()).length} 条补充信息）。写回时：填了补充信息的项会以检查项标题落成正文小节，未填的进文末「评审采纳建议」；待澄清作答与假设选择另成「澄清答复」。
        </Typography.Text>
      </Modal>

      {/* 门禁标准抽屉（项目级；维护人 = 管理员） */}
      <Drawer title="门禁标准" width={520} open={stdOpen} onClose={() => setStdOpen(false)}
        extra={<Button type="primary" loading={stdSaving} onClick={async () => {
          setStdSaving(true);
          try {
            const { saveGateStandard } = await import("@/store/session");
            const saved = await saveGateStandard(projectId, stdItems, stdVersion);
            message.success(`门禁标准已保存（v${saved.version}）。历史评分不重算。`);
            // `EVT_review_standard_saved`：`#24` 成功、版本号回显之后（同一版本号只 1 条）
            track("EVT_review_standard_saved", { standard_version: saved.version, items_count: stdItems.length },
              { dedupKey: `std_saved:${saved.version}`, immediate: true });
          } catch (e) { message.error((e as ApiError).message || "保存没成功。"); }
          finally { setStdSaving(false); }
        }}>保存</Button>}
      >
        <Button size="small" style={{ marginBottom: 12 }} onClick={async () => {
          const r = await fetchGateStandard(projectId);
          setStdItems([...r.items, { code: `N${stdItems.length + 1}`, level: "suggestion", title: "新增检查项" }]);
        }}>新增检查项</Button>
        <Form layout="vertical">
          {stdItems.map((it, i) => (
            <Form.Item key={it.code} label={`${it.code} · 当前版本 v${stdVersion}`} style={{ marginBottom: 8 }}>
              <Space>
                <Input value={it.title} style={{ width: 300 }}
                  onChange={(e) => setStdItems((s) => s.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                <Radio.Group value={it.level} onChange={(e) => setStdItems((s) => s.map((x, j) => j === i ? { ...x, level: e.target.value } : x))}>
                  <Radio.Button value="blocking">阻断</Radio.Button>
                  <Radio.Button value="major">重要</Radio.Button>
                  <Radio.Button value="suggestion">建议</Radio.Button>
                </Radio.Group>
              </Space>
            </Form.Item>
          ))}
        </Form>
      </Drawer>
    </div>
  );
}
