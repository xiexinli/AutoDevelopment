/**
 * 跨页埋点待办态：`EVT_proj_open_workbench` 要求「进入项目 **且 `#3` 成功之后**」才上报，
 * 而 `from_entry` 只有在项目列表页点击时才可知 —— 故点击时记下，工作台加载成功后再消费。
 */
export interface PendingWorkbenchEntry {
  project_id: string;
  from_entry: "card" | "enter_button";
}

let pending: PendingWorkbenchEntry | null = null;

export function setPendingWorkbenchEntry(v: PendingWorkbenchEntry): void {
  pending = v;
}

/** 工作台加载成功后取用（仅当 `project_id` 匹配时返回，取用后清空） */
export function takePendingWorkbenchEntry(projectId: string): PendingWorkbenchEntry | null {
  if (pending && pending.project_id === projectId) {
    const p = pending;
    pending = null;
    return p;
  }
  return null;
}
