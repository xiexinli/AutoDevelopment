/**
 * 路径 → `RT-*` 映射（`App-Spec §3` 的 13 条路由）。
 * 编辑态 / 预览态同路径，由 `?mode=` 区分（`App-Spec §3` 注 1）。
 */
export function rtOf(pathname: string, search: string): string | null {
  if (pathname === "/login" || pathname.startsWith("/login")) return "RT-AUTH-001";
  const m = pathname.match(/^\/projects\/([^/]+)\/([^/?]+)/);
  if (!m) return pathname === "/projects" || pathname === "/" ? "RT-PROJ-001" : null;
  const tab = m[2];
  switch (tab) {
    case "kb": return "RT-KB-001";
    case "workbench": return "RT-WORK-001";
    case "upload": return "RT-UPLOAD-001";
    case "review": return "RT-REVIEW-001";
    case "split": return "RT-SPLIT-001";
    case "apis": return "RT-API-001";
    case "capabilities": return "RT-CAP-001";
    case "specs": return "RT-SPEC-001";
    case "versions": return "RT-VER-001";
    case "editor": {
      const mode = new URLSearchParams(search).get("mode");
      return mode === "preview" ? "RT-PREVIEW-001" : "RT-EDIT-001";
    }
    default: return null;
  }
}

/** 从路径取 `project_id`（`/projects/{id}/...`） */
export function projectIdOf(pathname: string): string | null {
  return pathname.match(/^\/projects\/([^/]+)\//)?.[1] ?? null;
}
