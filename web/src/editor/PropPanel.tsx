import { useState } from "react";
import { Button, Checkbox, Input, InputNumber, Select, Space, Switch, Tooltip, Typography } from "antd";
import { CopyOutlined, LinkOutlined } from "@ant-design/icons";
import {
  EVENT_LABEL, validateColor, validateNumber, type ElementNode, type EventKind, type StyleProps,
} from "@/editor/model";

/**
 * `EL-EDIT-019` 属性面板 —— **11 行**（以 `§F14` 为准；宽/高合并为一行）。
 * 落到 `E7 StyleProps` 为 **13 个字段**（宽高分立、对齐水平/垂直分立）。
 * 改值 → **画布即时生效（本地）、不触发代码生成**；非法输入 → 字段级错误 + **保留已输入**。
 */

export interface PropPanelProps {
  node: ElementNode | null;
  displayId: string;
  onPatchStyle: (patch: Partial<StyleProps>) => void;
  onCopyId: () => void;
  errors: Record<string, string | undefined>;
  onError: (key: string, msg: string | undefined) => void;
}

const ALIGN_H = [
  { value: "left", label: "左" }, { value: "center", label: "中" }, { value: "right", label: "右" },
];
const ALIGN_V = [
  { value: "top", label: "上" }, { value: "center", label: "中" }, { value: "bottom", label: "下" },
];
const VISIBILITY = [
  { value: "visible", label: "可见" },
  { value: "invisible", label: "占位不可见" },
  { value: "gone", label: "隐藏" },
];

function Row({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minHeight: 32 }}>
        <div style={{ width: 88, fontSize: 13, color: "var(--ad-text-secondary)", lineHeight: "28px", flexShrink: 0 }}>{label}</div>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
      {error && <div style={{ color: "#ff4d4f", fontSize: 12, paddingLeft: 88, marginTop: 2 }}>{error}</div>}
    </div>
  );
}

export function PropPanel({ node, displayId, onPatchStyle, onCopyId, errors, onError }: PropPanelProps) {
  // 「四边联动」锁（`EL-EDIT-030`）：开启时改一边同步到四边
  const [linkLock, setLinkLock] = useState(true);
  if (!node) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        选中一个控件后，在这里调整它的属性。
      </Typography.Text>
    );
  }
  const s = node.style;

  const dimInput = (which: "width" | "height") => {
    const d = s[which];
    return (
      <Space.Compact style={{ width: "100%" }}>
        <InputNumber
          size="small" style={{ width: 120 }}
          disabled={d.mode !== "dp"}
          value={d.mode === "dp" ? d.value ?? undefined : undefined}
          onChange={(v) => {
            const nv = v === null ? null : Number(v);
            if (nv !== null && (nv < 0)) { onError(which, "这里不能填负数。"); return; }
            if (nv !== null && (nv < 1 || nv > 2000)) {
              onError(which, which === "width" ? "宽只能是 1~2000dp，或选「自适应 / 撑满」。" : "高只能是 1~2000dp，或选「自适应 / 撑满」。");
              onPatchStyle({ [which]: { mode: "dp", value: nv } } as Partial<StyleProps>);
              return;
            }
            onError(which, undefined);
            onPatchStyle({ [which]: { mode: "dp", value: nv } } as Partial<StyleProps>);
          }}
        />
        <Select
          size="small" style={{ width: 88 }} value={d.mode}
          onChange={(m) => { onError(which, undefined); onPatchStyle({ [which]: { mode: m, value: m === "dp" ? (d.value ?? 100) : null } } as Partial<StyleProps>); }}
          options={[{ value: "dp", label: "dp" }, { value: "wrap", label: "自适应" }, { value: "match", label: "撑满" }]}
        />
      </Space.Compact>
    );
  };

  const colorInput = (which: "background" | "font_color" | "border") => {
    const value = which === "border" ? s.border.color : s[which];
    const key = which === "border" ? "border_color" : which;
    return (
      <Space.Compact style={{ width: "100%" }}>
        <Input
          size="small" style={{ width: 120, fontFamily: "monospace" }} value={value}
          onChange={(e) => {
            const v = e.target.value;
            const msg = validateColor(v);
            onError(key, msg ?? undefined);
            if (which === "border") onPatchStyle({ border: { ...s.border, color: v } });
            else onPatchStyle({ [which]: v } as Partial<StyleProps>);
          }}
        />
        <input
          type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff"}
          onChange={(e) => { onError(key, undefined); if (which === "border") onPatchStyle({ border: { ...s.border, color: e.target.value } }); else onPatchStyle({ [which]: e.target.value } as Partial<StyleProps>); }}
          style={{ width: 24, height: 24, padding: 0, border: "1px solid var(--ad-border)", borderRadius: 2, cursor: "pointer" }}
        />
      </Space.Compact>
    );
  };

  const numInput = (
    value: number, kind: "font_size" | "radius" | "alpha" | "border_width",
    apply: (v: number) => void, width = 120, suffix?: string,
  ) => (
    <Space.Compact style={{ width: "100%" }}>
      <InputNumber
        size="small" style={{ width }} value={value}
        onChange={(v) => {
          const nv = Number(v ?? NaN);
          if (Number.isNaN(nv)) return;
          if (nv < 0) { onError(kind, "这里不能填负数。"); return; }
          const msg = validateNumber(nv, kind);
          onError(kind, msg ?? undefined);
          apply(nv);
        }}
      />
      {suffix && <span style={{ lineHeight: "28px", fontSize: 12, color: "#999" }}>{suffix}</span>}
    </Space.Compact>
  );

  const edgeInput = (which: "padding" | "margin") => (
    <Space direction="vertical" size={2} style={{ width: "100%" }}>
      {(["top", "right", "bottom", "left"] as const).map((k) => (
        <Space.Compact key={k} style={{ width: "100%" }}>
          <span style={{ width: 32, lineHeight: "28px", fontSize: 12, color: "#999" }}>
            {{ top: "上", right: "右", bottom: "下", left: "左" }[k]}
          </span>
          <InputNumber
            size="small" style={{ width: 88 }} value={s[which][k]}
            onChange={(v) => {
              const nv = Number(v ?? 0);
              if (nv < 0) { onError(which, "这里不能填负数。"); return; }
              const msg = validateNumber(nv, "padding");
              onError(which, msg ?? undefined);
              onPatchStyle(
                linkLock
                  ? { [which]: { top: nv, right: nv, bottom: nv, left: nv } }
                  : { [which]: { ...s[which], [k]: nv } },
              );
            }}
          />
        </Space.Compact>
      ))}
      <div style={{ fontSize: 12, color: "#999" }}>
        <Switch size="small" checked={linkLock} onChange={setLinkLock} style={{ marginRight: 6 }} />
        四边联动
      </div>
    </Space>
  );

  return (
    <div>
      {/* EL-EDIT-020 顶部：元素 id 显示 + 复制 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, background: "var(--ad-bg-page)",
        borderRadius: 4, padding: "2px 6px", marginBottom: 8,
      }}>
        <Typography.Text code style={{ fontSize: 12 }}>{displayId}</Typography.Text>
        <Tooltip title="复制元素 id">
          <Button type="text" size="small" icon={<CopyOutlined />} onClick={onCopyId} />
        </Tooltip>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#bbb" }}>
          {node.widget_type}
        </span>
      </div>

      {/* ① 宽 / 高（一行两项，§F14 口径） */}
      <Row label="宽 / 高" error={errors.width || errors.height}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          {dimInput("width")}
          {dimInput("height")}
        </Space>
      </Row>
      <Row label="背景色" error={errors.background}>{colorInput("background")}</Row>
      <Row label="字体颜色" error={errors.font_color}>{colorInput("font_color")}</Row>
      <Row label="字体大小" error={errors.font_size}>
        {numInput(s.font_size, "font_size", (v) => onPatchStyle({ font_size: v }), 120, "sp")}
      </Row>
      <Row label="内边距" error={errors.padding}>{edgeInput("padding")}</Row>
      <Row label="外边距" error={errors.margin}>{edgeInput("margin")}</Row>
      <Row label="圆角" error={errors.radius}>
        {numInput(s.radius, "radius", (v) => onPatchStyle({ radius: v }), 120, "dp")}
      </Row>
      <Row label="边框" error={errors.border_width || errors.border_color}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Space.Compact>
            <InputNumber
              size="small" style={{ width: 72 }} value={s.border.width_dp}
              onChange={(v) => {
                const nv = Number(v ?? 0);
                const msg = validateNumber(nv, "border_width");
                onError("border_width", msg ?? undefined);
                onPatchStyle({ border: { ...s.border, width_dp: nv } });
              }}
            />
            <Select
              size="small" style={{ width: 96 }} value={s.border.style}
              onChange={(v) => onPatchStyle({ border: { ...s.border, style: v } })}
              options={[
                { value: "solid", label: "实线" }, { value: "dashed", label: "虚线" }, { value: "dotted", label: "点线" },
              ]}
            />
          </Space.Compact>
          {colorInput("border")}
        </Space>
      </Row>
      <Row label="透明度" error={errors.alpha}>
        {numInput(s.alpha, "alpha", (v) => onPatchStyle({ alpha: v }), 120, "%")}
      </Row>
      <Row label="对齐方式" error={errors.align}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Select size="small" style={{ width: 168 }} value={s.align_h} onChange={(v) => onPatchStyle({ align_h: v })} options={ALIGN_H} />
          <Select size="small" style={{ width: 168 }} value={s.align_v} onChange={(v) => onPatchStyle({ align_v: v })} options={ALIGN_V} />
        </Space>
      </Row>
      <Row label="可见性" error={errors.visibility}>
        <Select size="small" style={{ width: 120 }} value={s.visibility} onChange={(v) => onPatchStyle({ visibility: v })} options={VISIBILITY} />
      </Row>

      <div style={{ marginTop: 8, fontSize: 11, color: "#bbb", lineHeight: 1.6 }}>
        共 <b>11 行</b>（以 §F14 为准，「宽 / 高」合并为一行）；落到数据模型 <code>E7</code> 为 <b>13</b> 个字段。
        改动<b>本地即时生效</b>，不会触发代码生成。
      </div>
    </div>
  );
}

/**
 * `EL-EDIT-031` 事件面板 —— 3 项（点击 / 长按 / 双击）**可并存**。
 * 本期只生成**空回调存根**，`action_type` 仅 `none`；**动作配置走右侧对话补充**（`D-Q13`）。
 */
export function EventPanel({
  node, onToggle,
}: { node: ElementNode | null; onToggle: (k: EventKind, v: boolean) => void }) {
  if (!node) return <Typography.Text type="secondary" style={{ fontSize: 13 }}>选中控件后可勾选事件。</Typography.Text>;
  const on = (Object.keys(EVENT_LABEL) as EventKind[]).filter((k) => node.events[k]);
  return (
    <div>
      <Space direction="vertical" size={4}>
        {(Object.keys(EVENT_LABEL) as EventKind[]).map((k) => (
          <Checkbox key={k} checked={node.events[k]} onChange={(e) => onToggle(k, e.target.checked)}>
            {EVENT_LABEL[k]}
          </Checkbox>
        ))}
      </Space>
      {on.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, color: "var(--ad-text-secondary)" }}>暂无动作（TODO）</div>
      )}
      <div style={{ marginTop: 8, fontSize: 12, color: "#999", lineHeight: 1.6 }}>
        <LinkOutlined style={{ marginRight: 4 }} />
        后续要配跳转或调接口，走右侧对话补充。
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: "#bbb" }}>
        本期只生成空回调存根（<code>setOnClickListener {"{ /* TODO */ }"}</code>），三类事件可并存。
      </div>
    </div>
  );
}
