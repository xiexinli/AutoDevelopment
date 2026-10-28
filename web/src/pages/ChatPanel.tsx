import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Button, Empty, Input, Space, Spin, Typography } from "antd";
import {
  CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled,
  LoadingOutlined, MinusCircleFilled, SendOutlined, StopOutlined,
} from "@ant-design/icons";
import { track } from "@/track";
import { listChatMessages, sendChatMessage, retryChatMessage, fetchStats, type ChatMessage } from "@/store/session";
import { watchChat, watchAiSteps, type AiStep, type StreamStatus } from "@/sse/stream";
import { ApiError } from "@/api/client";
import Markdown from "@/components/Markdown";
import { DEFAULT_THREAD } from "@/chat/thread";

/**
 * `EL-WORK-013` 右栏对话容器（`REQ-CHAT-001`）。
 *
 * 硬约束（逐条对着 `UI-Spec §4.4`）：
 *  - 发送**串行**、不并发改写同一 PRD；**3s 内连点只入库一条**；单条 ≤ 20000 字符；
 *  - `Enter` 发送、`Shift+Enter` 换行；空内容禁止 → `先说点什么再发送。` + **输入框水平抖动 240ms**；
 *  - 平台气泡 **Markdown 渲染且转义 HTML、不执行标签**；流式回复**逐段追加**（无淡入、无打字机动画）；
 *  - 失败态 `这条没发出去。` + `重发`（**不重复入库**）。
 */

const MAX_LEN = 20000;

/** 一个线程（项目内的子步骤）的概览 —— 供面板顶部的「切换对话」用 */
export interface ThreadSummary { key: string; count: number; lastSeq: number }

export default function ChatPanel({ projectId, threadKey, status, onThreads }: {
  projectId: string;
  /** 当前要展示的线程（= 当前子步骤，或用户手选的线程） */
  threadKey: string;
  status: StreamStatus;
  /** 把「该项目有哪些对话线程、各有多少条」回报给父层（用于切换器与未读提示） */
  onThreads?: (list: ThreadSummary[]) => void;
}) {
  const { message } = AntApp.useApp();
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState(false);
  const [shake, setShake] = useState(false);
  const [tooLong, setTooLong] = useState(false);
  const [emptyTip, setEmptyTip] = useState(false);

  const lastSentAt = useRef(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // 埋点用：当前项目阶段（`EVT_chat_send_success.phase`，取自 `#6`）、重发次数、等待回复的计时
  const stageRef = useRef("");
  const retryCount = useRef<Record<string, number>>({});
  const awaiting = useRef<{ startedAt: number } | null>(null);
  const replyTimer = useRef<number | null>(null);

  // 「AI 处理过程」：订阅 `ai.step`（同一 `step_id` **原地更新**，不追加新行）
  // 口径（2026-10-22 PM）：**agent 的处理过程与用户消息共用一个列表** ——
  // 步骤作为**列表条目**按时间混排进消息时间线，不再单独占一个折叠区块。
  const [steps, setSteps] = useState<AiStep[]>([]);

  useEffect(() => {
    const w = watchAiSteps(projectId, (s) => {
      setSteps((prev) => {
        const i = prev.findIndex((x) => x.step_id === s.step_id);
        if (i >= 0) { const next = [...prev]; next[i] = s; return next; }
        return [...prev, s].slice(-60);
      });
    });
    return () => w.close();
    // 主体对象变化 → 重新订阅（线程已由 `listChatMessages` 按主体拉取）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 项目阶段（`#6`）：只用于埋点的 `phase` 参数，失败不影响业务
  useEffect(() => {
    void fetchStats(projectId).then((s) => { stageRef.current = s.stage; }).catch(() => undefined);
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // **一次取回该项目全部线程**的消息：面板自行分组 → 渲染当前线程 + 列出可切回的线程
      const r = await listChatMessages(projectId);
      setItems(r.items);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // 对话流：SSE `chat.delta` / 降级轮询 —— 消息按 `seq` 补齐
  useEffect(() => {
    const w = watchChat(projectId, (list) => {
      // 回复终态（`EVT_chat_reply_terminal`）：等到「等待中的回复有了 assistant 内容」即视为完成
      const last = list[list.length - 1];
      if (awaiting.current && last && last.role === "assistant") {
        track("EVT_chat_reply_terminal", {
          status: "completed", duration_ms: Date.now() - awaiting.current.startedAt, message_id: last.message_id,
        }, { dedupKey: `chat_term:${last.message_id}`, immediate: true });
        awaiting.current = null;
        if (replyTimer.current) { window.clearTimeout(replyTimer.current); replyTimer.current = null; }
      }
      setItems((prev) => {
        const merged = [...list].sort((a, b) => a.seq - b.seq);
        // 逐字段比对（**含 `created_at` / `status` / `thread_key`**）：流式那条先以「到达时刻」占位，
        // 落库后由 `#25` 校正；若只比 `content`，校正结果会被丢弃 → 气泡一直停在错误位置。
        const same = merged.length === prev.length && merged.every((m, i) => {
          const p = prev[i];
          return !!p && m.message_id === p.message_id && m.content === p.content
            && m.created_at === p.created_at && m.status === p.status
            && (m.thread_key ?? null) === (p.thread_key ?? null);
        });
        return same ? prev : merged;
      });
      setPending(false);
    });
    return () => w.close();
  }, [projectId]);

  /** 所有线程（按 `thread_key` 分组；老数据无 key → 归入默认线程） */
  const threads = useMemo<ThreadSummary[]>(() => {
    const m = new Map<string, ThreadSummary>();
    for (const it of items) {
      const k = it.thread_key || DEFAULT_THREAD;
      const cur = m.get(k) ?? { key: k, count: 0, lastSeq: 0 };
      cur.count += 1; cur.lastSeq = Math.max(cur.lastSeq, it.seq);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.lastSeq - a.lastSeq);
  }, [items]);

  /** 当前线程可见的消息 */
  const visible = useMemo(
    () => items.filter((it) => (it.thread_key || DEFAULT_THREAD) === threadKey).sort((a, b) => a.seq - b.seq),
    [items, threadKey],
  );

  /**
   * **共用一个列表**（2026-10-22 PM 口径）：当前线程的消息 + AI 处理过程的步骤，
   * 按时间**混排成同一条时间线**；同一时刻消息在前（步骤通常发生在消息之后）。
   */
  const feed = useMemo<FeedItem[]>(() => {
    const ms: FeedItem[] = visible.map((m) => ({ kind: "msg", key: `m:${m.message_id}`, at: atMs(m.created_at), msg: m }));
    const ss: FeedItem[] = steps.map((s) => ({ kind: "step", key: `s:${s.step_id}`, at: atMs(s.at), step: s }));
    return [...ms, ...ss].sort((a, b) => (a.at - b.at) || (a.kind === "msg" ? -1 : 1));
  }, [visible, steps]);

  // 线程概览回报父层（切换器用）；只在真正变化时回调，避免无谓重渲染
  const lastReported = useRef("");
  useEffect(() => {
    const sig = threads.map((x) => `${x.key}:${x.count}`).join(",");
    if (sig === lastReported.current) return;
    lastReported.current = sig;
    onThreads?.(threads);
  }, [threads, onThreads]);

  // 新消息 / 新步骤 / 等待回复 → 滚到底（两类内容共用一个列表，只有一条时间线）
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, steps, pending]);

  /** 空内容 → 输入框水平抖动（`translateX` 0 → −4 → +4 → 0，共 2 个来回，240ms，linear） */
  function triggerShake() {
    setShake(true);
    setEmptyTip(true);
    window.setTimeout(() => setShake(false), 260);
  }

  async function onSend() {
    const value = text;
    if (!value.trim()) {
      triggerShake();
      // `EVT_chat_send_blocked`：抖动提示渲染之后（**不发请求**）
      track("EVT_chat_send_blocked", { reason: "empty", char_count: 0, limit: MAX_LEN },
        { dedupKey: "chat_blocked:empty", dedupWindowMs: 1000, immediate: true });
      return;
    }
    if ([...value].length > MAX_LEN) {
      setTooLong(true);
      track("EVT_chat_send_blocked", { reason: "over_length", char_count: [...value].length, limit: MAX_LEN },
        { dedupKey: "chat_blocked:over", dedupWindowMs: 1000, immediate: true });
      return;
    }
    const now = Date.now();
    if (now - lastSentAt.current < 3000 && sending) return; // 3s 内连点只入库一条
    if (sending) return;
    lastSentAt.current = now;
    setSending(true); setPending(true); setEmptyTip(false); setTooLong(false);
    try {
      const sent = await sendChatMessage(projectId, value, threadKey);
      // `EVT_chat_send_success`：`#26` 成功后（本地消息置 sent）
      track("EVT_chat_send_success", {
        message_id: sent.message_id, char_count: [...value].length,
        message_seq: sent.seq, phase: stageRef.current || "created",
      }, { dedupKey: `chat_sent:${sent.message_id}`, immediate: true });
      // 等待回复（用于 `EVT_chat_reply_terminal` 的时长与 60s 超时判定）
      awaiting.current = { startedAt: Date.now() };
      if (replyTimer.current) window.clearTimeout(replyTimer.current);
      replyTimer.current = window.setTimeout(() => {
        if (awaiting.current) {
          track("EVT_chat_reply_terminal", {
            status: "timeout", duration_ms: Date.now() - awaiting.current.startedAt, message_id: sent.message_id,
          }, { dedupKey: `chat_term:${sent.message_id}`, immediate: true });
          awaiting.current = null;
        }
      }, 60_000);
      setText("");
      const r = await listChatMessages(projectId);
      setItems(r.items);
    } catch (e) {
      const err = e as ApiError;
      message.error(err.message || "这条没发出去。");
      setPending(false);
      // 回复终态（failed）：发送失败、失败气泡渲染之后
      if (awaiting.current) {
        track("EVT_chat_reply_terminal", {
          status: "failed", duration_ms: Date.now() - awaiting.current.startedAt, message_id: err.requestId || "",
        }, { dedupKey: `chat_term_failed:${Date.now()}`, immediate: true });
        awaiting.current = null;
        if (replyTimer.current) { window.clearTimeout(replyTimer.current); replyTimer.current = null; }
      }
      // 失败消息由服务端以 status=failed 落库，这里补齐列表
      await load();
    } finally {
      setSending(false);
    }
  }

  async function onRetry(m: ChatMessage) {
    try {
      await retryChatMessage(m.message_id);
      message.success("已重发。");
      retryCount.current[m.message_id] = (retryCount.current[m.message_id] ?? 0) + 1;
      // `EVT_chat_resend`：`#27` 成功后（该消息就地转 streaming）
      track("EVT_chat_resend", { message_id: m.message_id, retry_index: retryCount.current[m.message_id] },
        { dedupKey: `chat_resend:${m.message_id}:${retryCount.current[m.message_id]}`, immediate: true });
      awaiting.current = { startedAt: Date.now() };
      await load();
    } catch (e) {
      message.error((e as ApiError).message || "重发没成功。");
    }
  }

  const len = [...text].length;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--ad-bg-container)" }}>
      <style>{`@keyframes ad-shake{0%{transform:translateX(0)}25%{transform:translateX(-4px)}50%{transform:translateX(4px)}75%{transform:translateX(-4px)}100%{transform:translateX(0)}}`}</style>

      {/* 消息区：**agent 处理过程与消息共用一个列表**（两类条目按时间混排，2026-10-22 PM 口径） */}
      <div ref={boxRef} style={{ flex: 1, overflowY: "auto", padding: 12, background: "var(--ad-bg-page)" }}>
        {loading ? (
          <div style={{ display: "grid", placeItems: "center", height: 160 }}>
            <Spin /><div style={{ marginTop: 12, fontSize: 13 }}>正在加载对话…</div>
          </div>
        ) : error ? (
          <Empty description="对话没加载出来。"><Button size="small" onClick={() => void load()}>重试</Button></Empty>
        ) : feed.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ fontSize: 13 }}>这个步骤还没有对话。说说要改什么，或回答平台的问题。</span>}
          />
        ) : (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {feed.map((f) => f.kind === "step" ? (
              // agent 的处理过程 —— 作为**列表条目**参与同一条时间线（不是独立区块）
              <div key={f.key} style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{
                  maxWidth: 320, width: "100%", padding: "8px 10px",
                  borderRadius: 8, background: "var(--ad-bg-container)", border: "1px solid var(--ad-border-light)",
                }}>
                  <StepRow step={f.step} />
                </div>
              </div>
            ) : (
              <MessageRow key={f.key} m={f.msg} onRetry={(m) => void onRetry(m)} />
            ))}
            {pending && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ maxWidth: 320, padding: 12, borderRadius: 8, background: "var(--ad-bubble-agent)", color: "var(--ad-text-secondary)", fontSize: 13 }}>
                  <Spin size="small" /> 正在生成…
                </div>
              </div>
            )}
          </Space>
        )}
      </div>

      {/* 输入区 */}
      <div style={{ padding: 12, borderTop: "1px solid var(--ad-border)" }}>
        {emptyTip && (
          <div style={{ height: 32, lineHeight: "32px", marginBottom: 8, padding: "0 8px", borderRadius: 4, background: "var(--ad-danger-bg)", color: "#ff4d4f", fontSize: 12 }}>
            先说点什么再发送。
          </div>
        )}
        {tooLong && (
          <div style={{ height: 32, lineHeight: "32px", marginBottom: 8, padding: "0 8px", borderRadius: 4, background: "var(--ad-warn-bg)", color: "#d48806", fontSize: 12 }}>
            消息最多 20000 字符，当前 {len} 字符。
          </div>
        )}
        <div style={{ animation: shake ? "ad-shake 240ms linear" : undefined }}>
          <Input.TextArea
            value={text}
            onChange={(e) => { setText(e.target.value); if (emptyTip) setEmptyTip(false); if (tooLong) setTooLong(false); }}
            onPressEnter={(e) => {
              if (e.shiftKey) return; // Shift+Enter 换行
              e.preventDefault();
              void onSend();
            }}
            placeholder="说说要改什么，或回答平台的问题"
            autoSize={{ minRows: 2, maxRows: 6 }}
            style={{ background: "var(--ad-bg-page)" }}
          />
        </div>
        <Space style={{ marginTop: 8 }}>
          <Button type="primary" size="small" icon={<SendOutlined />} loading={sending} onClick={() => void onSend()}>发送</Button>
          {pending && (
            <Button size="small" icon={<StopOutlined />} onClick={() => { setPending(false); message.info("已停止生成。"); }}>停止生成</Button>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {status === "offline" ? "" : "Enter 发送，Shift+Enter 换行"}
          </Typography.Text>
        </Space>
      </div>
    </div>
  );
}

/** 一条时间线里的条目：用户/平台消息，或 agent 的处理步骤 */
type FeedItem =
  | { kind: "msg"; key: string; at: number; msg: ChatMessage }
  | { kind: "step"; key: string; at: number; step: AiStep };

/** ISO → 毫秒；缺失或非法按 `0`（排最前），保证排序稳定不抛错 */
function atMs(iso: string | null | undefined): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** 单条消息气泡（用户右、平台左；失败态带「重发」） */
function MessageRow({ m, onRetry }: { m: ChatMessage; onRetry: (m: ChatMessage) => void }) {
  const mine = m.role === "user";
  const failed = m.status === "failed";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
      {failed ? (
        <div style={{ maxWidth: 320, padding: 12, borderRadius: 8, background: "var(--ad-danger-bg)", border: "1px solid var(--ad-danger-border)", fontSize: 13 }}>
          <Space size={6}><ExclamationCircleFilled style={{ color: "#ff4d4f" }} />这条没发出去。</Space>
          <div style={{ marginTop: 4, color: "var(--ad-text-secondary)" }}>{m.content}</div>
          <Button size="small" type="link" onClick={() => onRetry(m)}>重发</Button>
        </div>
      ) : (
        <div style={{
          maxWidth: 320, padding: 12, borderRadius: 8, fontSize: 13,
          background: mine ? "var(--ad-primary)" : "var(--ad-bubble-agent)", color: mine ? "#fff" : "var(--ad-text)",
        }}>
          {mine ? m.content : <Markdown text={m.content} compact />}
        </div>
      )}
    </div>
  );
}

const STEP_ICON: Record<AiStep["status"], React.ReactNode> = {
  running: <LoadingOutlined style={{ color: "var(--ad-primary)" }} />,
  done: <CheckCircleFilled style={{ color: "#16A34A" }} />,
  failed: <CloseCircleFilled style={{ color: "#DC2626" }} />,
  canceled: <MinusCircleFilled style={{ color: "var(--ad-text-tertiary)" }} />,
};

/** 单条过程：图标 + 标题 + 规模/耗时；进行中附进度条（不用动画，仅按百分比增长） */
function StepRow({ step }: { step: AiStep }) {
  const meta: string[] = [];
  if (step.model) meta.push(step.model);
  if (typeof step.duration_ms === "number") meta.push(`${(step.duration_ms / 1000).toFixed(1)}s`);
  if (step.progress != null && step.status === "running") meta.push(`${step.progress}%`);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
      <span style={{ lineHeight: "18px", flex: "none" }}>{STEP_ICON[step.status]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: step.status === "failed" ? "#DC2626" : "var(--ad-text)", lineHeight: "18px" }}>{step.title}</div>
        {step.detail && (
          <div style={{ color: "var(--ad-text-tertiary)", lineHeight: "16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {step.detail}
          </div>
        )}
        {meta.length > 0 && <div style={{ color: "var(--ad-text-disabled)", lineHeight: "16px" }}>{meta.join(" · ")}</div>}
        {step.status === "running" && (
          <div style={{ height: 3, marginTop: 4, background: "var(--ad-border-light)", borderRadius: 2 }}>
            <div style={{ height: 3, width: `${Math.max(3, Math.min(100, step.progress ?? 0))}%`, background: "var(--ad-primary)", borderRadius: 2 }} />
          </div>
        )}
      </div>
    </div>
  );
}
