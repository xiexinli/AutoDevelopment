import { useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent } from "react";
import { ELEMENT_MIME } from "@/editor/dnd";
import { WIDGET_BY_TYPE } from "@/domain/widgets";
import type { ElementNode } from "@/editor/model";

/**
 * `EL-EDIT-005` 画布容器 —— 手机外框 **360dp × 640dp**（1dp = 1px CSS；1080×1920 为设备像素）。
 * 三重选中表达（`EL-EDIT-008` 蓝框 + `EL-EDIT-009` 手柄 + `EL-EDIT-016` 树高亮）**缺一不可**。
 * 落点：合法 → **最近容器吸附 + 插入线**（`EL-EDIT-011`）；非法 → **拒收**（`EL-EDIT-012`）。
 */

export interface CanvasProps {
  tree: ElementNode[];
  selectedTempId: string | null;
  dragging: boolean;
  onSelect: (tempId: string | null) => void;
  onDropWidget: (parentTempId: string | null, widgetType: string) => void;
  onDropReject: (reason: string) => void;
  /** 元素序号 → 用于 id 预览（服务端分配前展示占位） */
  idPreview: (node: ElementNode) => string;
  /** 移动已有节点（拖拽调整层级/顺序） */
  onMoveNode: (tempId: string, parentTempId: string | null) => void;
}

function styleOf(n: ElementNode): CSSProperties {
  const s = n.style;
  const dim = (d: typeof s.width) =>
    d.mode === "match" ? "100%" : d.mode === "wrap" ? "auto" : `${d.value ?? 0}px`;
  return {
    width: dim(s.width),
    height: dim(s.height),
    background: s.background,
    color: s.font_color,
    fontSize: `${s.font_size}px`,
    padding: `${s.padding.top}px ${s.padding.right}px ${s.padding.bottom}px ${s.padding.left}px`,
    margin: `${s.margin.top}px ${s.margin.right}px ${s.margin.bottom}px ${s.margin.left}px`,
    borderRadius: s.radius,
    border: s.border.width_dp > 0 ? `${s.border.width_dp}px ${s.border.style} ${s.border.color}` : undefined,
    opacity: s.alpha / 100,
    textAlign: s.align_h,
    display: s.visibility === "gone" ? "none" : "block",
    visibility: s.visibility === "invisible" ? "hidden" : "visible",
    boxSizing: "border-box",
    position: "relative",
  };
}

/** 控件在画布上的占位渲染（近似，不是真机效果 —— `REQ-PREVIEW-003`） */
function renderContent(n: ElementNode) {
  const def = WIDGET_BY_TYPE.get(n.widget_type as never);
  const t = n.widget_type;
  if (["TEXT", "MULTILINE_TEXT", "RICH_TEXT", "LABEL"].includes(t)) return n.alias || def?.label || "文本";
  if (t === "BUTTON") return <span style={{ display: "block", textAlign: "center" }}>{n.alias || "按钮"}</span>;
  if (["INPUT", "MULTILINE_INPUT", "PASSWORD_INPUT", "SEARCH_BOX"].includes(t)) {
    return <span style={{ color: "#999" }}>{n.alias || (t === "PASSWORD_INPUT" ? "••••••" : "请输入")}</span>;
  }
  if (["IMAGE", "AVATAR", "VIDEO"].includes(t)) {
    return <span style={{ display: "grid", placeItems: "center", height: "100%", background: "#E5E7EB", color: "#999", borderRadius: t === "AVATAR" ? "50%" : undefined }}>
      {def?.label}
    </span>;
  }
  if (["DIVIDER", "SPACE"].includes(t)) return null;
  if (["LOADING", "PROGRESS_BAR"].includes(t)) {
    return <span style={{ display: "block", height: 4, background: "#8A9099", borderRadius: 2, marginTop: 4 }} />;
  }
  if (["TOOLBAR", "BOTTOM_NAV", "TAB_LAYOUT"].includes(t)) {
    return <span style={{ display: "grid", placeItems: "center", height: "100%", color: "#666" }}>{def?.label}</span>;
  }
  if (n.children.length === 0) {
    return <span style={{ display: "block", color: "#bbb", fontSize: 12, textAlign: "center", paddingTop: 8 }}>{def?.label}</span>;
  }
  return null;
}

export default function Canvas(props: CanvasProps) {
  const { tree, selectedTempId, dragging, onSelect, onDropWidget, onDropReject, idPreview, onMoveNode } = props;
  const [hoverParent, setHoverParent] = useState<string | null | undefined>(undefined);

  function handleDrop(e: DragEvent, parentTempId: string | null) {
    e.preventDefault(); e.stopPropagation();
    setHoverParent(undefined);
    const widgetType = e.dataTransfer.getData(ELEMENT_MIME.widget);
    const movingTempId = e.dataTransfer.getData(ELEMENT_MIME.node);
    if (movingTempId) { onMoveNode(movingTempId, parentTempId); return; }
    if (!widgetType) {
      onDropReject("这个位置放不了：画布外。");
      return;
    }
    onDropWidget(parentTempId, widgetType);
  }

  function allowDrop(e: DragEvent, parentTempId: string | null, isContainer: boolean) {
    if (!isContainer && parentTempId !== null) { e.preventDefault(); return; } // 非容器 → 落到其父级
    e.preventDefault();
    setHoverParent(parentTempId);
  }

  function renderNode(n: ElementNode, depth: number) {
    const def = WIDGET_BY_TYPE.get(n.widget_type as never);
    const isContainer = !!def?.container;
    const selected = n.temp_id === selectedTempId;
    const isHover = hoverParent === n.temp_id;
    return (
      <div
        key={n.temp_id}
        style={{
          ...styleOf(n),
          outline: isHover && dragging ? "2px solid #2563EB" : undefined,
          outlineOffset: isHover && dragging ? 1 : undefined,
        }}
        onClick={(e: MouseEvent) => { e.stopPropagation(); onSelect(n.temp_id); }}
        onDragOver={(e) => allowDrop(e, isContainer ? n.temp_id : null, true)}
        onDrop={(e) => handleDrop(e, isContainer ? n.temp_id : null)}
      >
        {renderContent(n)}

        {/* 选中框（三重表达之一） */}
        {selected && (
          <>
            <div style={{ position: "absolute", inset: -2, border: "2px solid #2563EB", borderRadius: 2, pointerEvents: "none" }} />
            {HANDLES.map((h) => (
              <div key={h.k} style={{
                position: "absolute", width: 8, height: 8, background: "#2563EB",
                border: "1px solid #fff", borderRadius: 2, ...h.pos,
              }} />
            ))}
            {/* 元素 id 角标本（`EL-EDIT-010`） */}
            <div style={{
              position: "absolute", top: -20, left: -2, height: 20, padding: "0 4px",
              background: "#1F2329", color: "#fff", fontSize: 11, fontFamily: "monospace",
              lineHeight: "20px", borderRadius: 2, whiteSpace: "nowrap", pointerEvents: "none",
            }}>
              {idPreview(n)}
            </div>
          </>
        )}

        {n.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  const empty = tree.length === 0;

  return (
    <div
      style={{
        width: 360, minHeight: 640, background: "#FFFFFF", border: "2px solid #E5E7EB",
        borderRadius: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", padding: 8,
        position: "relative", flexShrink: 0,
      }}
      onDragOver={(e) => { allowDrop(e, null, true); }}
      onDrop={(e) => handleDrop(e, null)}
      onClick={() => onSelect(null)}
    >
      {empty && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#999", fontSize: 13, textAlign: "center", padding: 24, pointerEvents: "none" }}>
          <div>
            <div>这个页面还是空的。</div>
            <div style={{ marginTop: 4 }}>从左边拖一个控件进来试试。</div>
          </div>
        </div>
      )}
      {tree.map((n) => renderNode(n, 0))}
    </div>
  );
}

const HANDLES: { k: string; pos: CSSProperties }[] = [
  { k: "nw", pos: { left: -5, top: -5, cursor: "nwse-resize" } },
  { k: "n", pos: { left: "50%", marginLeft: -4, top: -5, cursor: "ns-resize" } },
  { k: "ne", pos: { right: -5, top: -5, cursor: "nesw-resize" } },
  { k: "e", pos: { right: -5, top: "50%", marginTop: -4, cursor: "ew-resize" } },
  { k: "se", pos: { right: -5, bottom: -5, cursor: "nwse-resize" } },
  { k: "s", pos: { left: "50%", marginLeft: -4, bottom: -5, cursor: "ns-resize" } },
  { k: "sw", pos: { left: -5, bottom: -5, cursor: "nesw-resize" } },
  { k: "w", pos: { left: -5, top: "50%", marginTop: -4, cursor: "ew-resize" } },
];
