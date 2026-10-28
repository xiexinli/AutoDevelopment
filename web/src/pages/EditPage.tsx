import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert, App as AntApp, Button, Card, Drawer, Empty, Modal, Segmented, Space, Spin, Table, Tag, Tooltip, Typography,
} from "antd";
import { DeleteOutlined, RedoOutlined, UndoOutlined } from "@ant-design/icons";
import Canvas from "@/editor/Canvas";
import PreviewPane, { type PreviewPhase } from "@/pages/PreviewPage";
import { WidgetPanel, TreePanel } from "@/editor/panels";
import { PropPanel, EventPanel } from "@/editor/PropPanel";
import { countNodes, findNode, insertInto, newNode, newTempId, removeNode, walk, EVENT_LABEL,
  type ElementNode, type EventKind, type StyleProps } from "@/editor/model";
import { DEFAULT_SIZE, WIDGET_BY_TYPE } from "@/domain/widgets";
import {
  fetchPages, fetchMe, submitGeneration, fetchTask, submitDraft, fetchDraft, cancelTask, fetchAiEgress,
  fetchVerifications, fetchArtifacts, fetchElementLedger, retryVerification, hashTree, listProjectTasks, buildResultDisplay,
  type GenerationReceipt, type PageDraft, type TaskState, type VerificationEvidence, type Artifact, type SuccessfulPreview,
} from "@/store/session";
import { ApiError, IS_MOCK } from "@/api/client";
import { track } from "@/track";

/** `EVT_gen_task_terminal`：生成任务终态（succeeded / failed / timeout）；以 `task_id` 去重 */
function trackTerminal(next: TaskState, l1: L1Evidence | null): void {
  const started = (next as { started_at?: string }).started_at;
  const finished = (next as { finished_at?: string }).finished_at;
  const duration = started && finished
    ? Math.max(0, new Date(finished).getTime() - new Date(started).getTime()) : null;
  track("EVT_gen_task_terminal", {
    task_id: next.task_id, status: next.status, progress: next.progress ?? 0,
    error_code: next.error_code ?? null, seq: next.seq, duration_ms: duration,
    l1_status: l1?.status ?? null, l1_duration_ms: l1?.duration_ms ?? null,
  }, { dedupKey: `term:${next.task_id}`, dedupWindowMs: 86_400_000, immediate: true });
}

/** `EVT_verify_failed`：验证失败（与生成失败分开）；只报失败规则名，不报代码内容 */
function trackVerifyFailed(next: TaskState, l1: L1Evidence | null): void {
  track("EVT_verify_failed", {
    task_id: next.task_id, attempt: l1?.attempt ?? next.attempt ?? 0,
    error_code: next.error_code ?? null,
    failed_rules: (l1?.rules ?? []).filter((r) => !r.ok).map((r) => r.rule),
  }, { dedupKey: `verifyfail:${next.task_id}`, dedupWindowMs: 86_400_000, immediate: true });
}

type L1Evidence = { attempt?: number; status?: string; rules?: { ok: boolean; rule: string }[]; duration_ms?: number };

/** `EVT_edit_drop_rejected`：拖拽落点被拒收（独立事件：区分「拖了但没放成」） */
function trackDropRejected(rejectReason: string, widgetType = ""): void {
  track("EVT_edit_drop_rejected", { reject_reason: rejectReason, widget_type: widgetType },
    { dedupKey: `drop:${rejectReason}:${widgetType}`, dedupWindowMs: 1000 });
}
import { openTaskStream, type StreamStatus } from "@/sse/stream";
import ComplianceNotice, { EGRESS_DISABLED_TEXT } from "@/components/ComplianceNotice";

type LedgerRow = { id: string; alias: string; status: string; at: string };
interface DraftContext {
  pageId: string; projectId: string; key: string; abort: AbortController;
  tree: ElementNode[]; saved: ElementNode[]; past: ElementNode[][]; future: ElementNode[][];
  version: number; idBase: Record<string, number>; dirty: boolean; revision: number;
  blocked: boolean; saving: Promise<PageDraft> | null; latestTask: GenerationReceipt | null; latestSeq: number;
  voidIds: Set<string>; assigned: Map<string, string>; freshTemps: Map<string, string>;
}
interface CachedDraft {
  tree: ElementNode[]; saved: ElementNode[]; past: ElementNode[][]; future: ElementNode[][];
  version: number; dirty: boolean; voidIds: string[]; latestTask?: GenerationReceipt | null;
}
const json = (tree: ElementNode[]) => JSON.stringify(tree);
const terminal = (status: string) => ["succeeded", "failed", "timeout", "canceled"].includes(status);
const passed = (v: VerificationEvidence) => v.status === "passed" || v.status === "succeeded";
const validSeq = (seq: unknown): seq is number => typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0;
const reasonOf = (e: unknown) => e instanceof Error ? e.message : "服务请求失败";

/** 元数据合并不触碰期间用户新编辑的样式/事件/结构；void ID 的历史节点成为新节点。 */
function reconcileTree(nodes: ElementNode[], ctx: DraftContext): ElementNode[] {
  return nodes.map((node) => {
    let temp = node.temp_id;
    // 同一控件多次“保存删除→撤销”可能产生替换链，必须走到最新临时 ID。
    const seen = new Set<string>();
    while (ctx.freshTemps.has(temp) && !seen.has(temp)) {
      seen.add(temp); temp = ctx.freshTemps.get(temp)!;
    }
    let id = temp !== node.temp_id ? ctx.assigned.get(temp) ?? null : node.element_id ?? ctx.assigned.get(temp) ?? null;
    if (id && ctx.voidIds.has(id)) {
      const replacement = newTempId();
      ctx.freshTemps.set(temp, replacement);
      temp = replacement; id = null;
    }
    return { ...node, temp_id: temp, element_id: id, status: "active", children: reconcileTree(node.children, ctx) };
  });
}

export default function EditPage({ basePath }: { basePath?: string } = {}) {
  const { projectId = "" } = useParams();
  const editorPath = basePath ?? `/projects/${projectId}/editor`;
  const [sp] = useSearchParams();
  const mode = sp.get("mode") === "preview" ? "preview" : "edit";
  const requestedPage = sp.get("page");
  const nav = useNavigate();
  const { message } = AntApp.useApp();
  const ctxRef = useRef<DraftContext | null>(null);
  const [tree, setTree] = useState<ElementNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [past, setPast] = useState<ElementNode[][]>([]);
  const [future, setFuture] = useState<ElementNode[][]>([]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [reject, setReject] = useState("");
  const [limitTip, setLimitTip] = useState("");
  const [dragging, setDragging] = useState(false);
  const [delTarget, setDelTarget] = useState<ElementNode | null>(null);
  /** 待上报的「控件作废」：删除后需等**草稿保存成功**（id 在服务端才真正作废），再上报一次 */
  const pendingVoid = useRef<{ element_id: string; widget_type: string; child_count: number } | null>(null);
  /**
   * 待上报的「事件配置变更」（`EVT_edit_event_config`）：按 `temp_id` 记录**最终态**，
   * 等 `#42` 草稿保存成功、服务端把 `element_id` 回写之后再上报一条（新控件保存前没有 `element_id`）。
   */
  const pendingEventCfg = useRef<Map<string, Set<EventKind>>>(new Map());
  /** L2 回传已上报的 task（同一 task_id 只 1 条；未回传不报） */
  const l2Reported = useRef<Set<string>>(new Set());
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [draftTip, setDraftTip] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [pageId, setPageId] = useState("");
  const [notice, setNotice] = useState(false);
  const [egressOn, setEgressOn] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [localWarning, setLocalWarning] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editRevision, setEditRevision] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [canceling, setCanceling] = useState(false);
  const [task, setTask] = useState<TaskState | null>(null);
  const taskRef = useRef<TaskState | null>(null);
  const taskEpochRef = useRef(0);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("polling");
  const [taskError, setTaskError] = useState("");
  const [phase, setPhase] = useState<PreviewPhase>("empty");
  const [progress, setProgress] = useState(0);
  const [verifyRules, setVerifyRules] = useState<VerificationEvidence["rules"]>([]);
  const [evidence, setEvidence] = useState<VerificationEvidence | null>(null);
  const [verifyAttempt, setVerifyAttempt] = useState(0);
  const [genReason, setGenReason] = useState("");
  const [lastSuccess, setLastSuccess] = useState<SuccessfulPreview | null>(null);
  const successRef = useRef<SuccessfulPreview | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const valid = useCallback((ctx: DraftContext) => ctxRef.current === ctx && !ctx.abort.signal.aborted, []);

  const cache = useCallback((ctx: DraftContext) => {
    try {
      const value: CachedDraft = { tree: ctx.tree, saved: ctx.saved, past: ctx.past, future: ctx.future,
        version: ctx.version, dirty: ctx.dirty, voidIds: [...ctx.voidIds], latestTask: ctx.latestTask };
      localStorage.setItem(ctx.key, JSON.stringify(value));
      if (valid(ctx)) setLocalWarning("");
    } catch {
      if (valid(ctx)) setLocalWarning("本地缓存写入失败（存储空间不足或被禁用）。请不要关闭页面，并重试服务端保存。");
    }
  }, [valid]);
  const renderDraft = useCallback((ctx: DraftContext) => {
    setTree(ctx.tree); setPast(ctx.past); setFuture(ctx.future); setDirty(ctx.dirty);
    setSelected((id) => {
      const seen = new Set<string>();
      while (id && ctx.freshTemps.has(id) && !seen.has(id)) {
        seen.add(id); id = ctx.freshTemps.get(id)!;
      }
      return id;
    });
    cache(ctx);
  }, [cache]);
  const restoreSuccess = useCallback((snapshot: SuccessfulPreview | null) => {
    if (snapshot && validSeq(snapshot.seq) && snapshot.seq >= (taskRef.current?.seq ?? 0)
      && (!successRef.current || snapshot.seq >= successRef.current.seq)) {
      successRef.current = snapshot; setLastSuccess(snapshot);
      // 漏斗节点 8：L1 passed 且预览内容已替换之后
      track("EVT_preview_refreshed", { seq: snapshot.seq, task_id: snapshot.task_id, l1_duration_ms: null },
        { dedupKey: snapshot.task_id, dedupWindowMs: 86_400_000, immediate: true });
    }
  }, []);
  const observeSeq = useCallback((ctx: DraftContext, seq: unknown) => {
    if (validSeq(seq)) ctx.latestSeq = Math.max(ctx.latestSeq, seq);
  }, []);
  const observeDraftSeq = useCallback((ctx: DraftContext, draft: PageDraft) => {
    observeSeq(ctx, draft.latest_seq);
    observeSeq(ctx, draft.last_success?.seq);
    draft.running_tasks.forEach((t) => observeSeq(ctx, t.seq));
  }, [observeSeq]);
  const adoptTask = useCallback((ctx: DraftContext, receipt: GenerationReceipt & Partial<Omit<TaskState, "status">>, restart = false) => {
    if (!valid(ctx) || !validSeq(receipt.seq)
      || (receipt.project_id && receipt.project_id !== ctx.projectId)
      || (receipt.page_id && receipt.page_id !== ctx.pageId)) return false;
    observeSeq(ctx, receipt.seq);
    const current = taskRef.current;
    // POST / 重试 / SSE / 列表均共用单调门禁，迟到的旧回执不可回退预览或证据。
    if (receipt.seq < (successRef.current?.seq ?? 0) || (current && (receipt.seq < current.seq
      || (receipt.seq === current.seq && (receipt.task_id !== current.task_id || !restart))))) return false;
    const next: TaskState = { ...receipt, page_id: ctx.pageId, project_id: ctx.projectId,
      status: (receipt.status ?? "queued") as TaskState["status"], progress: receipt.progress ?? 0, type: "code_gen" };
    ctx.latestTask = next; cache(ctx);
    // 只采纳任务元数据；绝不以其他标签的生成输入覆盖 tree / dirty / 撤销栈。
    taskEpochRef.current += 1; taskRef.current = next; setTask(next);
    setPhase(next.status === "canceled" ? "stopped" : terminal(next.status) ? "load_failed" : "generating");
    setProgress(next.progress); setEvidence(null); setVerifyRules([]); setVerifyAttempt(0);
    setArtifacts([]); setGenReason(""); setTaskError("");
    // `EVT_gen_task_enqueued`：首次收到该 `task_id`（本地去重，SSE 重连不重复计数）
    track("EVT_gen_task_enqueued", { task_id: next.task_id, seq: next.seq, source: "edit_submit" },
      { dedupKey: `enq:${next.task_id}`, dedupWindowMs: 86_400_000, immediate: true });
    return true;
  }, [valid, observeSeq, cache]);
  const observeTasks = useCallback((ctx: DraftContext, data: unknown) => {
    if (!valid(ctx) || !data || typeof data !== "object") return false;
    const event = data as Partial<TaskState> & { items?: TaskState[] };
    const items = Array.isArray(event.items) ? event.items : [event];
    let newest: TaskState | null = null;
    let currentSeen = false;
    for (const item of items) {
      // 连接/列表本身按项目隔离；显式携带其他 project_id 时仍拒绝。
      if (item.type !== "code_gen" || !item.task_id || !validSeq(item.seq)
        || (item.project_id && item.project_id !== ctx.projectId)) continue;
      observeSeq(ctx, item.seq); // 包括不同 page、失败/取消/已完成的全部项目 code_gen。
      if (item.task_id === taskRef.current?.task_id) currentSeen = true;
      if (item.page_id === ctx.pageId && (!newest || item.seq > newest.seq)) newest = item as TaskState;
    }
    return (newest ? adoptTask(ctx, newest) : false) || currentSeen;
  }, [valid, observeSeq, adoptTask]);
  const rememberAssignments = useCallback((ctx: DraftContext, nodes: ElementNode[]) => {
    walk(nodes, (n) => { if (n.element_id) ctx.assigned.set(n.temp_id, n.element_id); });
  }, []);
  const refreshLedger = useCallback(async (ctx: DraftContext) => {
    if (valid(ctx)) { setLedgerLoading(true); setLedgerError(""); }
    try {
      const r = await fetchElementLedger(ctx.projectId, ctx.abort.signal);
      if (!valid(ctx)) return;
      r.items.forEach((r) => { if (r.status === "void") ctx.voidIds.add(r.element_id); });
      setLedgerRows(r.items.map((r) => ({ id: r.element_id, alias: r.alias,
        status: r.status === "void" ? "作废" : "在用", at: r.voided_at ?? "" })));
      // 台账可能包含另一客户端已删除的节点；历史恢复同样不能复活它们。
      const before = json(ctx.tree);
      ctx.tree = reconcileTree(ctx.tree, ctx);
      ctx.past = ctx.past.map((v) => reconcileTree(v, ctx));
      ctx.future = ctx.future.map((v) => reconcileTree(v, ctx));
      if (before !== json(ctx.tree)) { ctx.dirty = true; ctx.revision += 1; setEditRevision(ctx.revision); }
      renderDraft(ctx);
    } catch (e) { if (valid(ctx)) setLedgerError(reasonOf(e)); }
    finally { if (valid(ctx)) setLedgerLoading(false); }
  }, [valid, renderDraft]);

  // user+project+page 隔离；刷新恢复当前任务以及服务端保存的 last_success，绝不把 draft 当成功结果。
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(null); setTask(null); taskRef.current = null; taskEpochRef.current += 1;
    setLastSuccess(null); successRef.current = null; setPhase("empty"); setPageId("");
    setSaveError(""); setConflict(false); setTaskError(""); setEvidence(null); setArtifacts([]);
    setSelected(null); setErrors({}); setDirty(false); setPast([]); setFuture([]); setTree([]);
    setSaving(false); setLocalWarning(""); setLedgerLoading(false);
    setGenReason(""); setVerifyRules([]); setVerifyAttempt(0); setLedgerRows([]); setLedgerError("");
    setDraftTip(false); setCanceling(false); setSubmitting(false); submittingRef.current = false;
    let context: DraftContext | null = null;
    void (async () => {
      try {
        const [pages, user] = await Promise.all([fetchPages(projectId), fetchMe()]);
        if (abort.signal.aborted) return;
        const page = requestedPage ? pages.items.find((p) => p.page_id === requestedPage)
          : [...pages.items].sort((a, b) => a.order_index - b.order_index)[0];
        if (!page) throw new Error("项目中没有可编辑页面。");
        const draft = await fetchDraft(page.page_id, abort.signal);
        if (abort.signal.aborted) return;
        context = { pageId: page.page_id, projectId, key: `ad.editor.v3:${encodeURIComponent(user.user_id)}:${encodeURIComponent(projectId)}:${encodeURIComponent(page.page_id)}`,
          abort, tree: draft.tree, saved: draft.tree, past: [], future: [], version: draft.version,
          idBase: draft.id_base, dirty: false, revision: 0, blocked: false, saving: null, latestTask: null, latestSeq: 0,
          voidIds: new Set(), assigned: new Map(), freshTemps: new Map() };
        const ctx = context;
        ctxRef.current = ctx;
        observeDraftSeq(ctx, draft);
        rememberAssignments(ctx, draft.tree);
        try {
          const raw = localStorage.getItem(ctx.key);
          const local = raw ? JSON.parse(raw) as CachedDraft : null;
          ctx.latestTask = local?.latestTask ?? null;
          observeSeq(ctx, ctx.latestTask?.seq);
          if (local && Array.isArray(local.tree) && local.dirty) {
            ctx.tree = local.tree; ctx.past = local.past ?? []; ctx.future = local.future ?? [];
            ctx.voidIds = new Set(local.voidIds ?? []);
            const remoteIds = new Set<string>();
            walk(draft.tree, (n) => { if (n.element_id) remoteIds.add(n.element_id); });
            walk(local.saved ?? [], (n) => { if (n.element_id && !remoteIds.has(n.element_id)) ctx.voidIds.add(n.element_id); });
            ctx.dirty = true; ctx.revision = 1;
            // 刷新时本地内容不自动覆盖他人的版本，必须用户显式合并。
            ctx.blocked = local.version !== draft.version && json(local.saved ?? []) !== json(draft.tree);
            setConflict(ctx.blocked); setDraftTip(true);
          }
        } catch { setLocalWarning("本地缓存不可读；已载入服务端草稿。"); }
        ctx.tree = reconcileTree(ctx.tree, ctx);
        renderDraft(ctx); setEditRevision(ctx.revision); setPageId(page.page_id);
        restoreSuccess(draft.last_success);
        if (draft.last_success) setPhase("ready");
        const active = [...draft.running_tasks, ...(ctx.latestTask ? [ctx.latestTask] : [])]
          .filter((t) => validSeq(t.seq) && t.seq >= (draft.last_success?.seq ?? 0))
          .sort((a, b) => b.seq - a.seq)[0];
        if (active) {
          const restored: TaskState = { ...active, type: "code_gen", status: active.status as TaskState["status"], progress: 0 };
          ctx.latestTask = active; taskRef.current = restored; setTask(restored);
          setPhase(active.status === "canceled" ? "stopped" : terminal(active.status) ? "load_failed" : "generating");
        } else if (draft.last_success) {
          const restored: TaskState = { task_id: draft.last_success.task_id, seq: draft.last_success.seq, type: "code_gen", status: "succeeded", progress: 100 };
          ctx.latestTask = restored; taskRef.current = restored; setTask(restored);
        }
        cache(ctx);
        await refreshLedger(ctx);
      } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e : new Error(reasonOf(e))); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    return () => {
      if (context) cache(context);
      abort.abort();
      if (ctxRef.current === context) ctxRef.current = null;
    };
  }, [projectId, requestedPage, cache, renderDraft, refreshLedger, rememberAssignments, restoreSuccess, observeDraftSeq, observeSeq]);

  useEffect(() => {
    let alive = true;
    void fetchAiEgress().then((e) => { if (alive) setEgressOn(e.egress_enabled); })
      .catch(() => { if (alive) setEgressOn(false); });
    return () => { alive = false; };
  }, [projectId, notice]);

  // `EVT_l2_reported`：本地构建结果回传到达（前端经 `#44` 的 `l2_result` 首次看到 `reported=true`）
  useEffect(() => {
    const l2 = task?.l2_result;
    if (!l2?.reported || !task?.task_id) return;
    if (l2Reported.current.has(task.task_id)) return;
    l2Reported.current.add(task.task_id);
    track("EVT_l2_reported", {
      task_id: task.task_id, l2_passed: !!l2.passed,
      l2_duration_ms: (l2 as { duration_ms?: number }).duration_ms ?? 0,
      log_digest_len: (l2.log_digest ?? "").length,
    }, { dedupKey: `l2:${task.task_id}`, immediate: true });
  }, [task?.task_id, task?.l2_result]);

  const saveDraft = useCallback(async (ctx: DraftContext): Promise<PageDraft> => {
    if (ctx.saving) { await ctx.saving; return saveDraft(ctx); }
    if (!valid(ctx)) throw new Error("页面已关闭");
    if (ctx.blocked) throw new Error("草稿存在版本冲突，请先确认合并。本地内容已保留。");
    if (!ctx.dirty) return { tree: ctx.saved, id_base: ctx.idBase, version: ctx.version, updated_at: "",
      last_success: successRef.current, running_tasks: [], latest_seq: ctx.latestSeq };
    const sent = ctx.tree;
    const previous = ctx.saved;
    const revision = ctx.revision;
    setSaving(true); setSaveError("");
    const work = (async () => {
      try {
        const result = await submitDraft(ctx.pageId, sent, ctx.idBase, ctx.version, ctx.abort.signal);
        if (!valid(ctx)) throw new Error("页面已关闭");
        observeDraftSeq(ctx, result);
        const liveIds = new Set<string>();
        walk(result.tree, (n) => { if (n.element_id) liveIds.add(n.element_id); });
        walk(previous, (n) => { if (n.element_id && !liveIds.has(n.element_id)) ctx.voidIds.add(n.element_id); });
        rememberAssignments(ctx, result.tree);
        ctx.saved = result.tree; ctx.version = result.version; ctx.idBase = result.id_base;
        ctx.tree = ctx.revision === revision ? result.tree : reconcileTree(ctx.tree, ctx);
        ctx.past = ctx.past.map((t) => reconcileTree(t, ctx));
        ctx.future = ctx.future.map((t) => reconcileTree(t, ctx));
        ctx.dirty = json(ctx.tree) !== json(result.tree);
        renderDraft(ctx); restoreSuccess(result.last_success);
        void refreshLedger(ctx);
        // `EVT_edit_event_config`：**改挂草稿保存**（2026-10-22 口径）——
        // 事件配置随草稿树经 `#42` 落库，没有 `#40` 成功回调可挂；故在「保存成功 + `element_id` 已回写」之后上报。
        // 只报**配了哪类事件**（不报动作语义）；`long_press` 按 Spec 枚举归一为 `long_click`。
        // ⚠️ 报的是**该元素保存后的完整事件集**（不是本次勾选的增量）—— Spec 要求「只报最终态」。
        // ⚠️ `element_id` 由服务端分配且**已是归一化形式**（`EL-HOME-001`），**不得再归一化一次**（会变成 `EL-EL-HOME-001`）。
        // 同一 `element_id` 1s 内只报 1 次；全部取消 → 空集不可表达（`count` 下限 1），不上报。
        if (pendingEventCfg.current.size) {
          const pending = pendingEventCfg.current;
          pendingEventCfg.current = new Map();
          walk(result.tree, (n) => {
            if (!pending.has(n.temp_id) || !n.element_id) return;
            const event_types = (Object.keys(EVENT_LABEL) as EventKind[])
              .filter((k) => n.events[k])
              .map((k) => (k === "long_press" ? "long_click" : k));
            if (!event_types.length) return;
            track("EVT_edit_event_config", {
              element_id: n.element_id, event_types, action_type: "none", count: event_types.length,
            }, { dedupKey: `evtcfg:${n.element_id}`, dedupWindowMs: 1000, immediate: true });
          });
        }
        // `EVT_edit_element_voided`：节点已移出渲染树、且**服务端已确认作废**（本实现经 `#42` 草稿保存生效；同一 element_id 只 1 条）
        if (pendingVoid.current) {
          const v = pendingVoid.current;
          pendingVoid.current = null;
          track("EVT_edit_element_voided", v, { dedupKey: `void:${v.element_id}`, immediate: true });
        }
        return result;
      } catch (e) {
        if (valid(ctx)) {
          if (e instanceof ApiError && e.code === "VERSION_CONFLICT") { ctx.blocked = true; setConflict(true); }
          setSaveError(`${reasonOf(e)}；本地编辑内容已保留。`); cache(ctx);
        }
        throw e;
      } finally { ctx.saving = null; if (valid(ctx)) setSaving(false); }
    })();
    ctx.saving = work;
    return work;
  }, [valid, rememberAssignments, renderDraft, restoreSuccess, refreshLedger, cache, observeDraftSeq]);

  // 编辑立即写 localStorage，服务端 700ms debounce；失败不会空循环重试/清掉非法样式。
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !pageId || !dirty || conflict || loading || submitting) return;
    const timer = setTimeout(() => { if (!submittingRef.current) void saveDraft(ctx).catch(() => undefined); }, 700);
    return () => clearTimeout(timer);
  }, [pageId, dirty, conflict, loading, editRevision, saveDraft, submitting]);

  const change = useCallback((next: ElementNode[], history = true) => {
    const ctx = ctxRef.current;
    if (!ctx || !valid(ctx)) return;
    if (history) { ctx.past = [...ctx.past.slice(-49), ctx.tree]; ctx.future = []; }
    ctx.tree = reconcileTree(next, ctx); ctx.dirty = true; ctx.revision += 1;
    setSaveError(""); renderDraft(ctx); setEditRevision(ctx.revision);
  }, [valid, renderDraft]);
  const undo = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx?.past.length) return;
    const prev = ctx.past[ctx.past.length - 1];
    ctx.past = ctx.past.slice(0, -1); ctx.future = [ctx.tree, ...ctx.future].slice(0, 50);
    change(prev, false); setErrors({});
  }, [change]);
  const redo = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx?.future.length) return;
    const next = ctx.future[0]; ctx.future = ctx.future.slice(1); ctx.past = [...ctx.past, ctx.tree].slice(-50);
    change(next, false); setErrors({});
  }, [change]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || mode !== "edit") return;
      if (e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [undo, redo, mode]);
  useEffect(() => {
    const persist = () => { const ctx = ctxRef.current; if (ctx) cache(ctx); };
    const beforeUnload = (e: BeforeUnloadEvent) => { persist(); if (ctxRef.current?.dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("pagehide", persist); window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("pagehide", persist); window.removeEventListener("beforeunload", beforeUnload); };
  }, [cache]);

  const selectedNode = selected ? findNode(tree, selected) : null;
  const total = countNodes(tree);
  const idPreview = useCallback((n: ElementNode) => n.element_id ?? `待分配 · ${n.temp_id}`, []);
  function addWidget(parent: string | null, widgetType: string) {
    const current = ctxRef.current?.tree ?? tree;
    if (countNodes(current) >= 200) { setLimitTip("单页最多 200 个控件。"); return; }
    const def = WIDGET_BY_TYPE.get(widgetType as never);
    if (!def) return;
    if (parent) {
      const parentNode = findNode(current, parent);
      if (!parentNode || !WIDGET_BY_TYPE.get(parentNode.widget_type as never)?.container) { trackDropRejected("invalid_hierarchy"); setReject("这个位置放不了：不是容器。"); return; }
    }
    const d = DEFAULT_SIZE[def.type]; const node = newNode(widgetType, d?.w, d?.h);
    change(insertInto(current, parent, node)); setSelected(node.temp_id); setReject(""); setLimitTip("");
  }
  function moveNode(tempId: string, parent: string | null) {
    const current = ctxRef.current?.tree ?? tree;
    const node = findNode(current, tempId);
    if (!node) return;
    let illegal = parent === tempId;
    walk(node.children, (c) => { if (c.temp_id === parent) illegal = true; });
    if (illegal || (parent && !WIDGET_BY_TYPE.get(findNode(current, parent)?.widget_type as never)?.container)) {
      trackDropRejected("invalid_hierarchy");
      setReject("这个位置放不了：不合法的父子关系。"); return;
    }
    change(insertInto(removeNode(current, tempId), parent, node));
  }
  function patchStyle(patch: Partial<StyleProps>) {
    if (!selected) return;
    const rec = (nodes: ElementNode[]): ElementNode[] => nodes.map((n) => n.temp_id === selected
      ? { ...n, style: { ...n.style, ...patch } } : { ...n, children: rec(n.children) });
    change(rec(ctxRef.current?.tree ?? tree)); // 样式与事件均进入 CtrlZ 栈。
  }
  function toggleEvent(k: EventKind, value: boolean) {
    if (!selected) return;
    const rec = (nodes: ElementNode[]): ElementNode[] => nodes.map((n) => n.temp_id === selected
      ? { ...n, events: { ...n.events, [k]: value } } : { ...n, children: rec(n.children) });
    // `EVT_edit_event_config`：先记最终态，等 `#42` 草稿保存成功再上报（见 saveDraft）
    const set = pendingEventCfg.current.get(selected) ?? new Set<EventKind>();
    if (value) set.add(k); else set.delete(k);
    pendingEventCfg.current.set(selected, set);
    change(rec(ctxRef.current?.tree ?? tree));
  }
  function doDelete() {
    if (!delTarget) return;
    const id = delTarget.element_id ?? "";
    if (id) pendingVoid.current = { element_id: id, widget_type: delTarget.widget_type, child_count: countNodes(delTarget.children ?? []) };
    change(removeNode(ctxRef.current?.tree ?? tree, delTarget.temp_id));
    setSelected(null); setDelTarget(null);
    message.info("已从本地草稿删除；服务端保存后该元素及子节点 ID 永久作废。");
  }

  // 串行 #44/#49 观察；不设人为 20s 超时，终态由后端裁决，SSE 用于立即唤醒。
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !pageId || loading) return;
    let closed = false;
    let polling = false;
    let requestTimeout: ReturnType<typeof setTimeout> | null = null;
    let requestAbort: AbortController | null = null;
    let wakePending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const active = () => !closed && valid(ctx);
    const poll = async () => {
      if (!active()) return;
      if (polling) { wakePending = true; return; }
      polling = true;
      if (timer) { clearTimeout(timer); timer = null; }
      const request = new AbortController();
      requestAbort = request;
      requestTimeout = setTimeout(() => request.abort(), 10000);
      let current = taskRef.current;
      let epoch = taskEpochRef.current;
      const sameTask = () => active() && taskEpochRef.current === epoch && taskRef.current?.task_id === current?.task_id;
      try {
        try {
          const tasks = await listProjectTasks(ctx.projectId, request.signal);
          if (!active()) return;
          observeTasks(ctx, tasks);
        } catch (e) {
          // 列表暂不可读时仍保留 #44 观察能力；401 不能继续后台请求。
          if (e instanceof ApiError && e.status === 401) { closed = true; stream.close(); throw e; }
          if (!taskRef.current) throw e;
        }
        current = taskRef.current; epoch = taskEpochRef.current;
        if (!current) return;
        const next = await fetchTask(current.task_id, request.signal);
        if (!active()) return;
        if (next.type === "code_gen" && (!next.project_id || next.project_id === ctx.projectId)) observeSeq(ctx, next.seq);
        if (!sameTask() || next.task_id !== current.task_id || next.seq !== current.seq
          || next.type !== "code_gen" || (next.project_id && next.project_id !== ctx.projectId)
          || (next.page_id && next.page_id !== ctx.pageId)) return;
        // 取消确认后不可让较早的 GET 或 Mock 延迟完成回调复活任务。
        if (current.status === "canceled" && next.status !== "canceled") return;
        ctx.latestTask = next; cache(ctx);
        taskRef.current = next; setTask(next); setTaskError("");
        setProgress(Math.max(0, Math.min(100, next.progress ?? 0)));
        let result: Awaited<ReturnType<typeof fetchVerifications>> | null = null;
        try { result = await fetchVerifications(next.task_id, request.signal); }
        catch (e) {
          if (sameTask()) setTaskError(`验证证据未能读取：${reasonOf(e)}`);
        }
        if (!sameTask()) return;
        const l1 = result?.items.filter((v) => v.layer === "L1").sort((a, b) => b.attempt - a.attempt)[0] ?? null;
        setEvidence(l1); setVerifyRules(l1?.rules ?? []); setVerifyAttempt(l1?.attempt ?? next.attempt ?? 0);
        if (!terminal(next.status)) {
          setPhase(next.phase === "verifying" ? "verifying" : "generating");
          return;
        }
        if (next.status === "canceled") { setPhase("stopped"); setGenReason("任务已取消，不计入重试次数。");
          // 取消只报取消，不同时报成功/失败
          track("EVT_gen_task_canceled", { task_id: next.task_id, status: "canceled", progress: next.progress ?? 0 },
            { dedupKey: `term:${next.task_id}`, dedupWindowMs: 86_400_000, immediate: true });
          return; }
        if (next.status === "timeout" || next.status === "failed") {
          setPhase(l1?.status === "failed" || l1?.status === "timeout" ? "verify_failed" : "gen_failed");
          setGenReason(next.error_message || (next.status === "timeout" || next.error_code === "UPSTREAM_TIMEOUT" ? "服务端任务超时" : "生成任务失败")
            + (l1?.rules.find((r) => !r.ok)?.detail ? `：${l1.rules.find((r) => !r.ok)?.detail}` : ""));
          trackTerminal(next, l1);
          if (l1?.status === "failed" || l1?.status === "timeout") trackVerifyFailed(next, l1);
          return;
        }
        if (!l1 || !passed(l1) || !l1.rules.length || l1.rules.some((r) => !r.ok)) {
          setPhase(l1?.status === "failed" || l1?.status === "timeout" ? "verify_failed" : "load_failed");
          setGenReason("任务结束，但缺少成功的 L1 证据；保留上次成功预览。");
          trackTerminal(next, l1);
          if (l1 && (l1.status === "failed" || l1.status === "timeout" || l1.rules.some((r) => !r.ok))) trackVerifyFailed(next, l1);
          return;
        }
        if (Array.isArray(result?.preview_tree)) {
          restoreSuccess({ task_id: next.task_id, seq: next.seq,
            at: result.generated_at ?? next.finished_at ?? "", tree: result.preview_tree });
        } else {
          const draft = await fetchDraft(ctx.pageId, request.signal);
          if (!sameTask()) return;
          observeDraftSeq(ctx, draft);
          if (draft.last_success?.task_id === next.task_id) restoreSuccess(draft.last_success); // 只取 last_success，不动正在编辑的 draft。
        }
        if (successRef.current?.task_id !== next.task_id) {
          setPhase("load_failed"); setGenReason(IS_MOCK ? "Mock 未提供成功提交快照，不以草稿冒充预览。" : "该任务尚未提供成功预览快照；保留上次成功预览。");
        } else { setPhase("ready"); setGenReason(""); }
        // 漏斗节点 7：生成任务终态（成功）
        trackTerminal(next, l1);
        try {
          const r = await fetchArtifacts(next.task_id, request.signal);
          if (sameTask()) setArtifacts(r.items);
        } catch (e) { if (sameTask()) setTaskError(`生成已成功，产物读取失败：${reasonOf(e)}`); }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { closed = true; stream.close(); }
        if (sameTask()) setTaskError(`任务状态暂不可读：${reasonOf(e)}；将继续重连。`);
      }
      finally {
        if (requestTimeout) { clearTimeout(requestTimeout); requestTimeout = null; }
        requestAbort = null;
        polling = false;
        if (active()) {
          const delay = wakePending ? 0 : taskRef.current && !terminal(taskRef.current.status) ? 2000 : 10000;
          wakePending = false; timer = setTimeout(() => { timer = null; void poll(); }, delay);
        }
      }
    };
    const stream = openTaskStream(projectId, {
      onStatus: (status) => { if (active()) setStreamStatus(status); },
      onEvent: (_type, data) => {
        if (!active()) return;
        // 命名事件可扩展；只根据 payload 中的 code_gen 元数据推进项目序号。
        if (observeTasks(ctx, data)) void poll();
      },
    });
    void poll();
    return () => { closed = true; requestAbort?.abort(); if (requestTimeout) clearTimeout(requestTimeout); stream.close(); if (timer) clearTimeout(timer); };
  }, [projectId, pageId, loading, task?.task_id, task?.seq, valid, restoreSuccess, cache, observeTasks, observeSeq, observeDraftSeq]);
  async function doSubmit() {
    const ctx = ctxRef.current;
    if (!ctx || submittingRef.current) return;
    if (!countNodes(ctx.tree)) { message.warning("画布上还没有控件。"); return; }
    if (!egressOn) { message.warning(EGRESS_DISABLED_TEXT);
      // ★合规：外发开关关闭导致生成不可用（证明没有静默降级）
      track("EVT_gen_blocked_by_egress", { code: "UPSTREAM_UNAVAILABLE", entry: "edit_submit" },
        { dedupKey: "genblocked:edit_submit", immediate: true });
      // `EVT_edit_submit_blocked`：提交被拦截（与外发合规事件**并存**：一个记「为什么不能跑」，一个记「用户点了提交」）
      track("EVT_edit_submit_blocked", { block_reason: "egress_disabled", page_id: ctx.pageId ?? "" },
        { dedupKey: "edit_blocked:egress", immediate: true });
      return; }
    submittingRef.current = true; setSubmitting(true);
    try {
      // 先保存，使用返回的正式 tree 计算 SHA256。提交期间的新编辑单独保留/稍后保存。
      const saved = await saveDraft(ctx);
      const input_hash = await hashTree(saved.tree);
      if (!valid(ctx)) return;
      const receipt = await submitGeneration(ctx.pageId, { input_hash, base_seq: ctx.latestSeq }, ctx.abort.signal);
      if (!valid(ctx)) return;
      adoptTask(ctx, receipt); message.success(`生成任务 #${receipt.seq} 已入队。`);
      // 漏斗节点 6：生成任务创建成功、返回 task_id + seq 之后
      track("EVT_edit_submit_success", {
        task_id: receipt.task_id, seq: receipt.seq, page_id: ctx.pageId,
        element_count: countNodes(saved.tree),
      }, { dedupKey: receipt.task_id, immediate: true });
    } catch (e) {
      if (valid(ctx)) {
        setGenReason(reasonOf(e)); message.error(reasonOf(e));
        if (e instanceof ApiError && e.status === 409) {
          // 不自动重交/覆盖草稿；对齐项目序号与同页最新任务，供用户再次确认提交。
          try {
            const tasks = await listProjectTasks(ctx.projectId, ctx.abort.signal);
            if (valid(ctx)) observeTasks(ctx, tasks);
          } catch { /* 继续由 SSE/轮询对齐，保留原冲突提示。 */ }
        }
      }
    }
    finally { if (valid(ctx)) { submittingRef.current = false; setSubmitting(false); } }
  }
  async function retryVerify() {
    const ctx = ctxRef.current;
    if (!ctx || !task || !terminal(task.status) || !evidence || (evidence.status !== "failed" && evidence.status !== "timeout") || verifyAttempt >= 3 || submittingRef.current) return;
    if (!egressOn) { message.warning(EGRESS_DISABLED_TEXT); return; }
    submittingRef.current = true; setSubmitting(true);
    try {
      const r = await retryVerification(task.task_id, evidence.verify_id, ctx.abort.signal);
      if (valid(ctx)) { adoptTask(ctx, r, true); message.success("已按同一提交输入重试验证。"); }
    } catch (e) { if (valid(ctx)) message.error(reasonOf(e)); }
    finally { if (valid(ctx)) { submittingRef.current = false; setSubmitting(false); } }
  }
  async function stopGen() {
    const ctx = ctxRef.current; const current = taskRef.current;
    if (!ctx || !current || terminal(current.status) || canceling) return;
    setCanceling(true);
    try {
      const r = await cancelTask(current.task_id, ctx.abort.signal);
      if (!valid(ctx) || taskRef.current?.task_id !== current.task_id) return;
      if (r.status !== "canceled") throw new Error("服务端未确认取消，任务状态将继续同步。");
      const next: TaskState = { ...current, status: "canceled" };
      ctx.latestTask = next; cache(ctx);
      taskEpochRef.current += 1; taskRef.current = next; setTask(next); setPhase("stopped"); message.info("已停止生成，保留上次成功预览。");
      // 取消只报取消（与失败分开）
      track("EVT_gen_task_canceled", { task_id: next.task_id, status: "canceled", progress: next.progress ?? 0 },
        { dedupKey: `term:${next.task_id}`, dedupWindowMs: 86_400_000, immediate: true });
    } catch (e) { if (valid(ctx)) message.error(`取消失败：${reasonOf(e)}`); }
    finally { if (valid(ctx)) setCanceling(false); }
  }
  async function resolveConflict() {
    const ctx = ctxRef.current;
    if (!ctx || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true);
    try {
      // 用户显式选择“保留本地合并”：只刷新版本/ID真值，不拿远端 tree 覆盖本地内容。
      const remote = await fetchDraft(ctx.pageId, ctx.abort.signal);
      if (!valid(ctx)) return;
      observeDraftSeq(ctx, remote);
      await refreshLedger(ctx);
      if (!valid(ctx)) return;
      const remoteIds = new Set<string>();
      walk(remote.tree, (n) => { if (n.element_id) remoteIds.add(n.element_id); });
      walk(ctx.saved, (n) => { if (n.element_id && !remoteIds.has(n.element_id)) ctx.voidIds.add(n.element_id); });
      rememberAssignments(ctx, remote.tree);
      ctx.version = remote.version; ctx.idBase = remote.id_base; ctx.saved = remote.tree;
      ctx.tree = reconcileTree(ctx.tree, ctx); ctx.blocked = false; ctx.dirty = true;
      setConflict(false); renderDraft(ctx); await saveDraft(ctx);
      if (valid(ctx)) message.success("本地草稿已按最新版本保存。");
    } catch (e) { if (valid(ctx)) message.error(reasonOf(e)); }
    finally { if (valid(ctx)) { submittingRef.current = false; setSubmitting(false); } }
  }

  const l2Display = buildResultDisplay(task?.l2_result);

  // ---------- 渲染 ----------
  if (loading) {
    return <div style={{ display: "grid", placeItems: "center", height: "60vh" }}><Spin /><div style={{ marginTop: 12 }}>正在载入页面…</div></div>;
  }
  if (error) {
    return (
      <Card>
        <Empty description="页面没载入出来。"><Button onClick={() => nav(0)}>重试</Button></Empty>
      </Card>
    );
  }

  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }} onDragStart={() => setDragging(true)} onDragEnd={() => setDragging(false)}>
      {draftTip && (
        <Alert type="info" showIcon style={{ marginBottom: 8 }} closable onClose={() => setDraftTip(false)}
          message="已恢复上次未提交的改动。" />
      )}
      {reject && <Alert type="warning" showIcon style={{ marginBottom: 8 }} closable onClose={() => setReject("")} message={reject} />}
      {limitTip && <Alert type="warning" showIcon style={{ marginBottom: 8 }} closable onClose={() => setLimitTip("")} message={limitTip} />}
      {IS_MOCK && <Alert type="info" showIcon message="Mock 演示模式：不作为真实生成/验证验收证据。" style={{ marginBottom: 8 }} />}
      {localWarning && <Alert type="warning" showIcon message={localWarning} style={{ marginBottom: 8 }} />}
      {(saveError || conflict) && <Alert type="warning" showIcon style={{ marginBottom: 8 }}
        message={conflict ? "版本冲突：本地内容已保留，自动保存已暂停。" : saveError}
        description={conflict ? "保留本地合并将以当前内容覆盖最新远端草稿；删除的正式 ID 不会复活。" : undefined}
        action={conflict ? <Button disabled={submitting} onClick={() => void resolveConflict()}>保留本地并合并保存</Button>
          : <Button disabled={saving} onClick={() => { const ctx = ctxRef.current; if (ctx) void saveDraft(ctx).catch(() => undefined); }}>重试保存</Button>} />}
      <div role="status" style={{ marginBottom: 8, fontSize: 12, overflowWrap: "anywhere" }}>
        {saving ? "正在保存草稿…" : dirty ? "有未同步的本地改动" : "草稿已同步"}
        <Tag style={{ marginLeft: 8 }} color={l2Display.color}>
          {l2Display.label}
        </Tag>
      </div>
      {(taskError || streamStatus === "offline") && <Alert type="warning" showIcon style={{ marginBottom: 8 }}
        message={taskError || "连接已断开，正在重连；轮询同步任务。"} />}
      {genReason && mode === "edit" && <Alert type={phase === "stopped" ? "info" : "warning"} showIcon message={genReason} style={{ marginBottom: 8 }} />}


      <div style={{ marginBottom: 12 }}>
        <Space wrap>
          <Segmented
            value={mode}
            onChange={(v) => nav(`${editorPath}?mode=${v}${requestedPage ? `&page=${encodeURIComponent(requestedPage)}` : ""}`)}
            options={[{ label: "编辑", value: "edit" }, { label: "预览", value: "preview" }]}
          />
          {task && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              任务 {task.status} · seq {task.seq}
            </Typography.Text>
          )}
          {mode === "preview" && verifyAttempt >= 3 && <Tag color="red">需要人工介入</Tag>}
        </Space>
      </div>

      {!egressOn && (
        <Alert
          style={{ marginBottom: 12 }} type="warning" showIcon
          message={EGRESS_DISABLED_TEXT}
          action={<Button size="small" type="link" onClick={() => nav(`/projects/${projectId}/capabilities`)}>去开启</Button>}
        />
      )}

      {mode === "preview" ? (
        <PreviewPane
          tree={lastSuccess?.tree ?? []}
          seq={lastSuccess?.seq ?? null}
          genAt={lastSuccess?.at ?? null}
          phase={phase}
          progress={progress}
          verifyRules={verifyRules}
          verifyAttempt={verifyAttempt}
          reason={genReason}
          stopped={phase === "stopped"}
          canGenerate={egressOn && !submitting && !conflict}
          onRegenerate={() => setNotice(true)}
          onRetryVerify={() => void retryVerify()}
          canRetryVerify={!!task && terminal(task.status) && !!evidence && (evidence.status === "failed" || evidence.status === "timeout") && verifyAttempt < 3 && !submitting && egressOn}
          canceling={canceling}
          hasSnapshot={!!lastSuccess}
          l2Result={task?.l2_result ?? null}
          onViewLogs={() => setLogsOpen(true)}
          onViewArtifacts={() => setArtifactsOpen(true)}
          hasArtifacts={artifacts.length > 0}
          onStop={() => void stopGen()}
        />
      ) : (
      <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
        {/* 左：控件面板 */}
        <div style={{ height: 620, overflow: "hidden", border: "1px solid var(--ad-border)", borderRadius: 8 }}>
          <WidgetPanel onAdd={(t) => addWidget(selectedNode && WIDGET_BY_TYPE.get(selectedNode.widget_type as never)?.container ? selected : null, t)} />
        </div>

        {/* 中：画布 */}
        <div style={{ flex: "0 1 auto", maxWidth: "100%", overflowX: "auto" }}>
          <Canvas
            tree={tree} selectedTempId={selected} dragging={dragging}
            onSelect={setSelected}
            onDropWidget={(parent, t) => addWidget(parent, t)}
            onDropReject={(reason) => { trackDropRejected(reason.includes("画布外") ? "outside_canvas" : "invalid_hierarchy"); setReject(reason); }}
            onMoveNode={moveNode}
            idPreview={idPreview}
          />
          <div style={{ fontSize: 11, color: "#bbb", marginTop: 8, textAlign: "center" }}>
            360dp × 640dp（近似渲染，非真机效果 —— 真机以本地构建为准）
          </div>
        </div>

        {/* 右：控件树 + 属性 + 事件 */}
        <Card
          size="small" style={{ flex: "1 1 300px", minWidth: 0, maxWidth: "100%", height: 620, overflow: "auto" }}
          title={<span style={{ fontSize: 13 }}>控件树（{total}/200）</span>}
          extra={
            <Space size={4}>
              <Button size="small" onClick={() => { setLedgerOpen(true); const ctx = ctxRef.current; if (ctx) void refreshLedger(ctx); }}>元素 id 台账</Button>
            </Space>
          }
        >
          <div style={{ maxHeight: 150, overflow: "auto", marginBottom: 12 }}>
            <TreePanel
              tree={tree} selectedTempId={selected}
              onSelect={setSelected}
              onDelete={(n) => setDelTarget(n)}
              idPreview={idPreview}
              onMoveNode={moveNode}
            />
          </div>

          <div style={{ borderTop: "1px solid var(--ad-border)", paddingTop: 12 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>属性</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <PropPanel
                node={selectedNode}
                displayId={selectedNode ? idPreview(selectedNode) : "—"}
                onPatchStyle={patchStyle}
                onCopyId={() => {
                  if (!selectedNode) return;
                  if (!selectedNode.element_id) { message.info("正式 ID 尚未由服务端分配。"); return; }
                  const id = selectedNode.element_id;
                  void navigator.clipboard?.writeText(id);
                  message.success(`已复制 ${id}`);
                }}
                errors={errors}
                onError={(k, m) => setErrors((s) => ({ ...s, [k]: m }))}
              />
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--ad-border)", paddingTop: 12, marginTop: 12 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>事件</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <EventPanel node={selectedNode} onToggle={toggleEvent} />
            </div>
          </div>
        </Card>
      </div>

      {/* 底部操作条 */}
      <div style={{
        marginTop: 12, minHeight: 48, background: "var(--ad-bg-container)", borderTop: "1px solid var(--ad-border)",
        borderRadius: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 16px",
      }}>
        <Tooltip title={egressOn ? "" : EGRESS_DISABLED_TEXT}>
          <Button type="primary" loading={submitting} disabled={!egressOn || conflict} onClick={() => setNotice(true)}>提交变更</Button>
        </Tooltip>
        {task && !terminal(task.status) && <Button loading={canceling} onClick={() => void stopGen()}>停止生成</Button>}
        <Button icon={<UndoOutlined />} disabled={!past.length} onClick={undo}>撤销</Button>
        <Button icon={<RedoOutlined />} disabled={!future.length} onClick={redo}>重做</Button>
        <Button danger icon={<DeleteOutlined />} disabled={!selectedNode} onClick={() => selectedNode && setDelTarget(selectedNode)}>删除控件</Button>
        <div style={{ flex: 1 }} />
        <Button type="link" onClick={() => nav(`${editorPath}?mode=preview${requestedPage ? `&page=${encodeURIComponent(requestedPage)}` : ""}`)}>预览</Button>
        {task && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            任务 {task.status} · seq {task.seq}
          </Typography.Text>
        )}
      </div>
      </>
      )}

      {mode === "edit" && evidence && <Alert style={{ marginTop: 12 }} showIcon
        type={passed(evidence) ? "success" : evidence.status === "running" || evidence.status === "queued" ? "info" : "warning"}
        message={`L1 ${evidence.status} · 第 ${evidence.attempt} 次尝试${phase === "ready" ? " · 成功预览已同步" : ""}`}
        description={evidence.rules.map((r) => `${r.ok ? "通过" : "未通过"}：${r.rule}${r.detail ? `（${r.detail}）` : ""}`).join("；")}
        action={<Space wrap><Button size="small" onClick={() => setLogsOpen(true)}>验证证据</Button>
          {(evidence.status === "failed" || evidence.status === "timeout") && <Button size="small" disabled={verifyAttempt >= 3 || !egressOn || submitting || !!task && !terminal(task.status)}
            onClick={() => void retryVerify()}>同输入重试（剩余 {Math.max(0, 3 - verifyAttempt)} 次）</Button>}</Space>} />}
      {artifacts.length > 0 && <Button style={{ marginTop: 8 }} onClick={() => setArtifactsOpen(true)}>查看生成产物（{artifacts.length}）</Button>}

      {/* 删除确认（id 作废不可复用） */}
      <Modal
        title={delTarget ? `删除 ${idPreview(delTarget)}？` : "删除控件？"}
        open={!!delTarget} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
        onOk={() => void doDelete()} onCancel={() => setDelTarget(null)}
      >
        <p>它的元素 id 会作废且不可复用（埋点与测试用例可能引用它）。</p>
      </Modal>

      {/* 元素 id 台账 */}
      <Drawer title="元素 id 台账" width={520} open={ledgerOpen} onClose={() => setLedgerOpen(false)}>
        {ledgerError && <Alert type="warning" showIcon message={`台账读取失败：${ledgerError}`} style={{ marginBottom: 8 }} />}
        <Table
          loading={ledgerLoading} scroll={{ x: 440 }} size="small" rowKey="id" pagination={false}
          dataSource={ledgerRows}
          columns={[
            { title: "元素 id", dataIndex: "id", render: (v: string) => <code>{v}</code> },
            { title: "别名", dataIndex: "alias" },
            { title: "状态", dataIndex: "status", width: 90, render: (v: string) => <Tag color={v === "在用" ? "success" : "default"}>{v}</Tag> },
            { title: "作废时间", dataIndex: "at", width: 160 },
          ]}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          已作废的元素 id <b>可查不可用</b>，永不复用。
        </Typography.Text>
      </Drawer>

      <Drawer title="服务端验证证据" width={560} open={logsOpen} onClose={() => setLogsOpen(false)}>
        {evidence ? <><Typography.Paragraph>验证 {evidence.verify_id} · L1 · {evidence.status} · 尝试 {evidence.attempt}</Typography.Paragraph>
          {evidence.rules.map((r) => <Typography.Paragraph key={r.rule}><Tag color={r.ok ? "success" : "error"}>{r.ok ? "通过" : "未通过"}</Tag>{r.rule}<br />{r.detail}</Typography.Paragraph>)}
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{evidence.log_digest || "服务端未返回日志摘要"}</pre></>
          : <Empty description="尚无服务端验证证据" />}
        {task?.l2_result?.reported && <><Typography.Title level={5}>{l2Display.label}</Typography.Title>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{task.l2_result.log_digest}</pre></>}
      </Drawer>
      <Drawer title="成功生成产物" width={680} open={artifactsOpen} onClose={() => setArtifactsOpen(false)}>
        {artifacts.map((a) => <Card key={a.path} size="small" title={<span style={{ overflowWrap: "anywhere" }}>{a.path}</span>} style={{ marginBottom: 12 }}>
          <Tag>{a.kind}</Tag>{a.encoding && <Tag>{a.encoding}</Tag>}
          <Button size="small" onClick={() => {
            const body=a.encoding === "base64" ? Uint8Array.from(atob(a.content),c=>c.charCodeAt(0)) : a.content;
            const url=URL.createObjectURL(new Blob([body as BlobPart],{type:"application/octet-stream"}));
            const link=document.createElement("a");link.href=url;link.download=a.path.split("/").pop()??"artifact";link.click();URL.revokeObjectURL(url);
          }}>下载此文件</Button>
          <pre style={{ overflow: "auto", maxHeight: 360, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.content ?? "Mock 仅提供文件路径，无源码内容"}</pre>
        </Card>)}
      </Drawer>

      <ComplianceNotice
        open={notice}
        scene="generate_first"
        onCancel={() => { setNotice(false); message.info("已取消，不会发起生成。"); }}
        onConfirmed={() => { setNotice(false); void doSubmit(); }}
      />
    </div>
  );
}
