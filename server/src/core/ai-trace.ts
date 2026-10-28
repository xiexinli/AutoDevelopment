/**
 * `AI 处理过程`事件通道 —— 把平台侧的 AI 处理步骤（任务生命周期 + 大模型调用）
 * 以 SSE 事件 `ai.step` 推给前端，供**对话面板**实时展示「AI 正在做什么」。
 *
 * 设计约束：
 *  - **只推事件、不落库**（过程是运行时观察面，不是业务数据；不引入新实体、不动既有接口契约）；
 *  - 与既有 `task` / `chat.delta` 共用同一条 `#45` SSE 连接（`publish` → 同一 hub）；
 *  - 失败**绝不影响业务**：`publish` 内部已逐订阅者 try/catch，这里再兜一层。
 */
import { publish } from "./tasks.ts";
import { nowIso } from "../db/index.ts";

/** `running` = 进行中；`done` / `failed` / `canceled` = 终态 */
export type AiStepStatus = "running" | "done" | "failed" | "canceled";

export interface AiStep {
  /** 同一步骤重复推送时用同一个 `step_id`（前端做**原地更新**而不是追加新行） */
  step_id: string;
  task_id?: string | null;
  /** 步骤类别：`task:review` / `llm:review` / … */
  kind: string;
  title: string;
  /** 补充说明（可直接展示；**不得包含 PRD 正文、生成代码、对话正文**） */
  detail?: string | null;
  model?: string | null;
  status: AiStepStatus;
  progress?: number | null;
  duration_ms?: number | null;
  /** 服务端任务态（`queued`/`running`/`succeeded`/…）；**大模型类步骤为 `null`**（11 键同形状） */
  phase?: string | null;
  at: string;
}

/**
 * **近期步骤环形缓存**（内存，不落库）—— 解决两个真实问题：
 *  ① 对话框是**悬浮窗**，收起再打开时组件重建，过程本会丢空；
 *  ② 审核/拆解/Spec 在别的页面触发，用户切回时过程已经推过去了。
 * 订阅（或重新订阅）时**按序补发**，因此新订阅者立刻能看到最近发生的事。
 * 上限 60 条 / 30 分钟；同 `step_id` 覆盖式更新（保持原位置，不产生重复行）。
 */
const RECENT_MAX = 60;
const RECENT_TTL_MS = 30 * 60_000;
const recent = new Map<string, AiStep[]>();

/** 记录并返回（内部） */
function remember(projectId: string, step: AiStep): void {
  const list = recent.get(projectId) ?? [];
  const i = list.findIndex((s) => s.step_id === step.step_id);
  if (i >= 0) list[i] = step; else list.push(step);
  const cutoff = Date.now() - RECENT_TTL_MS;
  const kept = list.filter((s) => {
    const ts = Date.parse(s.at);
    return !Number.isFinite(ts) || ts >= cutoff;
  }).slice(-RECENT_MAX);
  recent.set(projectId, kept);
}

/** 新订阅者补发用：按发生顺序返回近期步骤（副本） */
export function recentSteps(projectId: string): AiStep[] {
  return [...(recent.get(projectId) ?? [])];
}

/** 推进一步（同 `step_id` 覆盖式更新） */
export function aiStep(projectId: string, step: Omit<AiStep, "at"> & { at?: string }): void {
  // `at` 表示**这步何时开始**，不是「何时被更新」：同 `step_id` 的后续推送**沿用首次的时刻**。
  // 否则对话面板把过程条目与消息按时间混排时，已完成的步骤会落到它产生的回复**之后**，读起来是倒的。
  const prev = step.at ? undefined : (recent.get(projectId) ?? []).find((s) => s.step_id === step.step_id);
  const full: AiStep = { ...step, at: step.at ?? prev?.at ?? nowIso() };
  try { remember(projectId, full); } catch { /* 缓存失败不影响推送 */ }
  try { publish(projectId, "ai.step", full); } catch { /* 过程展示失败绝不阻断业务 */ }
}

/**
 * 包住一次大模型调用：进入时推「调用模型…」，返回/异常时推终态（含耗时与产出规模）。
 * `describe` 只返回**规模性**描述（如「输出 1234 字」），不得返回正文。
 */
export async function traceLlm<T>(
  projectId: string, taskId: string, title: string, model: string | null,
  fn: () => Promise<T>, describe?: (result: T) => string,
): Promise<T> {
  const stepId = `${taskId}:llm`;
  const startedAt = Date.now();
  aiStep(projectId, { step_id: stepId, task_id: taskId, kind: "llm", title, model,
    // 11 键同一形状：本类不适用的键显式给 `null`
    phase: null, progress: null,
    status: "running", detail: model ? `模型：${model}` : null, duration_ms: null });
  try {
    const result = await fn();
    aiStep(projectId, { step_id: stepId, task_id: taskId, kind: "llm", title: `${title} · 完成`, model,
      phase: null, progress: null,
      status: "done", detail: describe?.(result) ?? null, duration_ms: Date.now() - startedAt });
    return result;
  } catch (e) {
    aiStep(projectId, { step_id: stepId, task_id: taskId, kind: "llm", title: `${title} · 失败`, model,
      phase: null, progress: null,
      status: "failed", detail: e instanceof Error ? e.message.slice(0, 200) : null,
      duration_ms: Date.now() - startedAt });
    throw e;
  }
}
