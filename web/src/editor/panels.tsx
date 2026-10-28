import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Tag, Tree, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { GROUPS, WIDGETS, WIDGET_BY_TYPE } from "@/domain/widgets";
import { ELEMENT_MIME } from "@/editor/dnd";
import { findNode, type ElementNode } from "@/editor/model";

/**
 * `EL-EDIT-001` 控件面板 —— 37 项原子控件，**本地筛选，不走接口**。
 * 文案逐字取自 `UI-Spec §4.8 ④`：占位 `搜索控件`；无匹配 `没有这个控件。` + `清除搜索`。
 */
export function WidgetPanel({ onAdd }: { onAdd: (widgetType: string) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(
    () => (q.trim() ? WIDGETS.filter((w) => w.label.includes(q.trim()) || w.type.toLowerCase().includes(q.trim().toLowerCase())) : WIDGETS),
    [q],
  );

  return (
    <div style={{ width: 200, maxHeight: "100%", flexShrink: 0, background: "var(--ad-bg-container)", borderRight: "1px solid var(--ad-border)", padding: 8, overflow: "auto" }}>
      <Input
        allowClear size="small" prefix={<SearchOutlined />} placeholder="搜索控件"
        value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }}
      />

      {list.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ fontSize: 13 }}>没有这个控件。</span>}
        >
          <Button size="small" onClick={() => setQ("")}>清除搜索</Button>
        </Empty>
      ) : (
        GROUPS.map((g) => {
          const items = list.filter((w) => w.group === g);
          if (!items.length) return null;
          return (
            <div key={g} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#667085", lineHeight: "28px" }}>{g}</div>
              {items.map((w) => (
                <div
                  key={w.type}
                  role="button" tabIndex={0} aria-label={`添加${w.label}`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAdd(w.type); } }}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(ELEMENT_MIME.widget, w.type)}
                  onDoubleClick={() => onAdd(w.type)}
                  title={`${w.android}${w.container ? " · 可作容器" : ""}（拖入画布，或双击添加）`}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 8px",
                    borderRadius: 4, cursor: "grab", fontSize: 13, background: "var(--ad-bg-container)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ad-bg-page)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.label}</span>
                  {w.container && <Tag style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: "16px" }}>容器</Tag>}
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * `EL-EDIT-014` 控件树 —— 双向选中；**永不出现孤儿节点**（与画布同一份数据）。
 * 无匹配文案：`没有匹配「{关键词}」的控件。`
 */
export function TreePanel({
  tree, selectedTempId, onSelect, onDelete, idPreview, onMoveNode,
}: {
  tree: ElementNode[];
  selectedTempId: string | null;
  onSelect: (tempId: string | null) => void;
  onDelete: (node: ElementNode) => void;
  idPreview: (n: ElementNode) => string;
  onMoveNode: (tempId: string, parentTempId: string | null) => void;
}) {
  const [q, setQ] = useState("");
  // 展开态受控：tree 变化（新增子控件等）后**自动展开全部**，避免新增的子节点被折叠看不见
  const [expanded, setExpanded] = useState<string[]>([]);
  const allKeys = useMemo(() => {
    const keys: string[] = [];
    const rec = (nodes: ElementNode[]) => nodes.forEach((n) => { keys.push(n.temp_id); rec(n.children); });
    rec(tree);
    return keys;
  }, [tree]);
  useEffect(() => { setExpanded(allKeys); }, [allKeys]);

  const treeData = useMemo(() => {
    const build = (nodes: ElementNode[]): { title: React.ReactNode; key: string; children?: unknown[] }[] =>
      nodes.map((n) => {
        const def = WIDGET_BY_TYPE.get(n.widget_type as never);
        const id = idPreview(n);
        const alias = n.alias ? ` ${n.alias}` : "";
        return {
          key: n.temp_id,
          title: (
            <span
              draggable
              onDragStart={(e) => e.dataTransfer.setData(ELEMENT_MIME.node, n.temp_id)}
              onClick={(e) => { e.stopPropagation(); onSelect(n.temp_id); }}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            >
              {id}
              <span style={{ color: "#888" }}>{alias || ` · ${def?.label ?? n.widget_type}`}</span>
              <Button
                type="text" size="small" danger aria-label={`删除 ${id}`} style={{ marginLeft: 4, padding: "0 4px", height: 18, fontSize: 11 }}
                onClick={(e) => { e.stopPropagation(); onDelete(n); }}
              >×</Button>
            </span>
          ),
          children: build(n.children),
        };
      });
    if (!q.trim()) return build(tree);
    // 本地过滤：命中自身或任一祖先/后代即保留该节点
    const hit = (n: ElementNode): boolean => {
      const def = WIDGET_BY_TYPE.get(n.widget_type as never);
      const s = `${idPreview(n)} ${n.alias} ${def?.label ?? ""}`;
      return s.includes(q.trim()) || n.children.some(hit);
    };
    const prune = (nodes: ElementNode[]): ElementNode[] =>
      nodes.filter(hit).map((n) => ({ ...n, children: prune(n.children) }));
    return build(prune(tree));
  }, [tree, q, onSelect, onDelete, idPreview]);

  const hasMatch = treeData.length > 0;
  const filtering = q.trim() !== "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Input
        allowClear size="small" prefix={<SearchOutlined />} placeholder="过滤控件"
        value={q} onChange={(e) => setQ(e.target.value)}
      />
      {tree.length === 0 ? (
        // `EL-EDIT-018` 控件树空态（原文案）
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          画布上还没有控件。从左边控件面板拖一个进来。
        </Typography.Text>
      ) : !hasMatch && filtering ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          没有匹配「{q}」的控件。
        </Typography.Text>
      ) : (
        <Tree
          treeData={treeData as never}
          selectedKeys={selectedTempId ? [selectedTempId] : []}
          expandedKeys={expanded}
          onExpand={(keys) => setExpanded(keys.map(String))}
          draggable={{
            icon: false,
            nodeDraggable: () => true,
          }}
          onDrop={(info) => {
            const dragKey = String(info.dragNode.key);
            const dropKey = info.node.key ? String(info.node.key) : null;
            const dragNode = findNode(tree, dragKey);
            if (!dragNode || !dropKey) return;
            // gap 表示同级移动：保留目标的真实父节点，不再错误地移动到根级。
            let parent: string | null = null;
            const locateParent = (nodes: ElementNode[], parentId: string | null) => {
              nodes.forEach((n) => { if (n.temp_id === dropKey) parent = parentId; locateParent(n.children, n.temp_id); });
            };
            locateParent(tree, null);
            onMoveNode(dragKey, info.dropToGap ? parent : dropKey);
          }}
        />
      )}
    </div>
  );
}
