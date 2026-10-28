/**
 * 对话的「**对象**」与「**线程**」（2026-10-22 按 PM 口径修正）。
 *
 * - **对象恒为 Project**：每个项目一组对话（由 `project_id` 决定，见后端 `#25`/`#26`）。
 * - **线程 = 项目内的子步骤**：`workbench`/`kb`/`upload`/`review`/`split`/`editor`/`specs`/`apis`/`capabilities`/`versions`
 *   —— 与 `App-Spec §3` 的页面 tab 一一对应。切到不同子步骤 = 换一个对话框。
 * - **可切回**：用户可在面板里手动切到别的线程（`picked`），面板提供「回到当前步骤」撤回；
 *   任何**路由变化**都会清掉手选，重新跟随当前步骤。
 */
import { useSyncExternalStore } from "react";

/** 线程（子步骤）→ 展示名 */
export const THREAD_LABEL: Record<string, string> = {
  workbench: "工作台", kb: "知识库", upload: "上传", review: "审核", split: "拆解",
  editor: "编辑", specs: "Spec", apis: "接口", capabilities: "能力", versions: "版本",
};

/** 默认线程（未给 / 非法时）：工作台 —— 对话原就长在工作台右栏 */
export const DEFAULT_THREAD = "workbench";

export function threadLabel(key: string): string {
  return THREAD_LABEL[key] ?? key;
}

interface Snapshot {
  /** 当前所在项目；`null` = 未进入项目（此时**不显示对话框**） */
  projectId: string | null;
  /** 当前路由对应的子步骤 */
  stepKey: string;
  /** 用户手选的线程；`null` = 跟随当前步骤 */
  picked: string | null;
  /** 面板实际展示的线程 */
  activeKey: string;
}

let projectId: string | null = null;
let stepKey: string = DEFAULT_THREAD;
let picked: string | null = null;
let snapshot: Snapshot = { projectId: null, stepKey: DEFAULT_THREAD, picked: null, activeKey: DEFAULT_THREAD };
const listeners = new Set<() => void>();

function rebuild(): void {
  snapshot = { projectId, stepKey, picked, activeKey: picked ?? stepKey };
  for (const l of listeners) { try { l(); } catch { /* ignore */ } }
}

/** `AppShell` 调用：路由变化时写入「当前项目 + 当前子步骤」，并**清掉手选**（重新跟随步骤） */
export function setChatRoute(next: { projectId: string | null; stepKey: string }): void {
  const key = next.projectId ? (next.stepKey || DEFAULT_THREAD) : DEFAULT_THREAD;
  if (projectId === next.projectId && stepKey === key && picked === null) return;
  projectId = next.projectId;
  stepKey = key;
  picked = null;
  rebuild();
}

/** 用户从切换器选了别的线程；传 `null` = 回到跟随当前步骤 */
export function setChatPicked(key: string | null): void {
  const next = key ?? null;
  if (picked === next) return;
  picked = next;
  rebuild();
}

export function getChatThread(): Snapshot { return snapshot; }

export function resetChatThread(): void { projectId = null; stepKey = DEFAULT_THREAD; picked = null; rebuild(); }

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useChatThread(): Snapshot {
  return useSyncExternalStore(subscribe, getChatThread, getChatThread);
}

/** 线程 key（接口层只需这个字符串） */
export type ChatThreadRef = string;
