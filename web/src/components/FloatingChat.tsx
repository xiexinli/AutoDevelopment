/**
 * 全局**悬浮对话框** —— 由 `AppShell` 挂载，**进入项目后（新建项目及以后的各子步骤）**才显示。
 *
 * 口径（2026-10-22 按 PM 修正）：
 *  - **对象 = Project**：面板头部展示**项目名**（对话始终是「对这个项目」说的）；
 *  - **线程 = 子步骤**：切到不同子步骤（工作台/上传/审核/…）就是**另一个对话框**；
 *  - **默认打开**：进入项目即展开（不是先给一个圆钮）；
 *  - **可切回**：顶部「切换对话」列出本项目**有消息的线程**（带条数），点一下切回；
 *    手选后偏离当前步骤时给「回到当前步骤」。
 *
 * 约束（沿用既有口径）：无位移动画（仅拖动跟随指针）；`Esc` 收起；键盘可达。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Dropdown, Space, Tooltip, Typography } from "antd";
import { CloseOutlined, DownOutlined, MinusOutlined, SwapOutlined } from "@ant-design/icons";
import ChatPanel, { type ThreadSummary } from "@/pages/ChatPanel";
import { openTaskStream, type StreamStatus } from "@/sse/stream";
import { setChatPicked, threadLabel, useChatThread } from "@/chat/thread";
import { fetchProject } from "@/store/session";

const PANEL_W = 400;
const PANEL_H = 560;
const MARGIN = 20;

export default function FloatingChat({ projectId }: { projectId: string | null }) {
  const { stepKey, picked, activeKey } = useChatThread();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StreamStatus>("polling");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [projectName, setProjectName] = useState("");
  const dragging = useRef<{ dx: number; dy: number } | null>(null);

  // 与页面共用同一条 SSE 连接（状态指示）
  useEffect(() => {
    if (!projectId) return;
    const s = openTaskStream(projectId, { onStatus: setStatus });
    return () => s.close();
  }, [projectId]);

  // **默认打开**：进入 / 切换项目时展开（子步骤之间切换保持用户当前的开合状态）
  useEffect(() => { setOpen(!!projectId); }, [projectId]);

  // 项目名（对话对象 = 项目）；失败不阻塞，退回「本项目」
  useEffect(() => {
    let alive = true;
    setProjectName("");
    if (!projectId) return;
    fetchProject(projectId)
      .then((p) => { if (alive) setProjectName(p.name); })
      .catch(() => { /* 顶部状态条失败不阻断面板 */ });
    return () => { alive = false; };
  }, [projectId]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const box = (e.currentTarget as HTMLElement).closest("[data-ad-chat-panel]") as HTMLElement | null;
    if (!box) return;
    const r = box.getBoundingClientRect();
    dragging.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    const x = Math.min(Math.max(8, e.clientX - d.dx), window.innerWidth - PANEL_W - 8);
    const y = Math.min(Math.max(8, e.clientY - d.dy), window.innerHeight - PANEL_H - 8);
    setPos({ x, y });
  }, []);

  const onPointerUp = useCallback(() => { dragging.current = null; }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // **停靠态**同步到 `html[data-ad-chat]`：停靠右下时主内容区让出安全区（`styles.css`），
  // 避免右下角操作条被浮层压住；拖动过（`pos !== null`）则不挤压内容。
  useEffect(() => {
    const el = document.documentElement;
    if (projectId && open && !pos) el.dataset.adChat = "docked";
    else if (projectId && open) el.dataset.adChat = "dragged";
    else delete el.dataset.adChat;
    return () => { delete el.dataset.adChat; };
  }, [projectId, open, pos]);

  // **未进入项目不显示**（口径：「只在新建项目及以后的步骤中显示」）
  if (!projectId) return null;

  const style: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y, width: PANEL_W, height: PANEL_H }
    : { position: "fixed", right: MARGIN, bottom: MARGIN, width: PANEL_W, height: PANEL_H };

  if (!open) {
    return (
      <Tooltip title={`和平台对话（对象：${projectName || "本项目"} · ${threadLabel(activeKey)}）`} placement="left">
        <Button
          type="primary"
          shape="circle"
          size="large"
          aria-label="打开对话框"
          onClick={() => setOpen(true)}
          style={{ position: "fixed", right: MARGIN, bottom: MARGIN, width: 52, height: 52, zIndex: 1000, boxShadow: "var(--ad-shadow-2)" }}
        >
          <SwapOutlined style={{ fontSize: 20 }} />
        </Button>
      </Tooltip>
    );
  }

  return (
    <div
      data-ad-chat-panel
      style={{
        ...style, zIndex: 1000, display: "flex", flexDirection: "column",
        background: "var(--ad-bg-container)", border: "1px solid var(--ad-border)", borderRadius: 8,
        boxShadow: "var(--ad-shadow-2)", overflow: "hidden",
      }}
    >
      {/* 头部（拖动把手）：对话对象 = 项目；对话线程 = 子步骤 */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--ad-border-light)", cursor: "move", userSelect: "none" }}
      >
        <Typography.Text strong style={{ fontSize: 13 }}>对话</Typography.Text>
        <Tooltip title="对话对象是当前项目；下面的标签是「在哪一步聊的」，不同子步骤是不同对话">
          <span style={{ maxWidth: 132, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "var(--ad-text-secondary)" }}>
            {projectName || "本项目"}
          </span>
        </Tooltip>

        <Dropdown
          trigger={["click"]}
          disabled={threads.length === 0}
          menu={{
            selectedKeys: [activeKey],
            items: threads.map((t) => ({
              key: t.key,
              label: (
                <Space size={6}>
                  <span>{threadLabel(t.key)}</span>
                  <Badge count={t.count} overflowCount={99} style={{ backgroundColor: "var(--ad-border-light)", color: "var(--ad-text-secondary)", boxShadow: "none", fontSize: 11 }} />
                  {t.key === stepKey && <span style={{ fontSize: 11, color: "var(--ad-text-disabled)" }}>当前步骤</span>}
                </Space>
              ),
            })),
            onClick: ({ key }) => setChatPicked(key === stepKey ? null : key),
          }}
        >
          <Button size="small" type="text" style={{ paddingInline: 6 }} aria-label="切换对话">
            <SwapOutlined style={{ fontSize: 12 }} />
            <span style={{ fontSize: 12, marginInline: 4 }}>{threadLabel(activeKey)}</span>
            <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>

        {picked !== null && picked !== stepKey && (
          <Button size="small" type="link" style={{ paddingInline: 4, fontSize: 12 }} onClick={() => setChatPicked(null)}>
            回到当前步骤
          </Button>
        )}

        <div style={{ flex: 1 }} />
        <Button type="text" size="small" aria-label="收起对话框" onClick={() => setOpen(false)}>
          <MinusOutlined />
        </Button>
        <Button type="text" size="small" aria-label="关闭对话框" onClick={() => setOpen(false)}>
          <CloseOutlined />
        </Button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatPanel projectId={projectId} threadKey={activeKey} status={status} onThreads={setThreads} />
      </div>
    </div>
  );
}
