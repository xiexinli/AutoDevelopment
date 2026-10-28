import { useState } from "react";
import type { CSSProperties } from "react";
import { Alert, Button, Card, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { CheckOutlined, DownOutlined, MinusOutlined, RightOutlined, WarningOutlined } from "@ant-design/icons";
import { WIDGET_BY_TYPE } from "@/domain/widgets";
import { buildResultDisplay, type TaskState } from "@/store/session";
import type { ElementNode } from "@/editor/model";

/**
 * `UI-PREVIEW-001` 预览态 —— 与编辑态**同一路由的两个状态**（`/editor?mode=edit|preview`）。
 *
 * 本态 = **网页近似渲染，不是真机效果**（`D-R3`）。与真机的差异清单（`UI-Spec §6`，10 项）
 * 通过 `EL-PREVIEW-004` 常驻标记 → `EL-PREVIEW-005` 面板**对用户可见**；**不作任何「接近真机」的承诺**。
 *
 * 硬约束（逐条对着 `UI-Spec §4.9`）：
 *  - 渲染区**只读**：无编辑手柄、无可拖拽提示；
 *  - 「生成失败」与「验证失败」是**两条独立路径、两套文案**；
 *  - 「停止生成」后**预览保持上一次成功结果不变**，任务条「已停止」**非错误态**（不用红、不用感叹号）；
 *  - 刷新**无动效**（明确不使用淡入）；切换编辑/预览**无动效**。
 */

export type PreviewPhase = "empty" | "generating" | "verifying" | "gen_failed" | "verify_failed" | "load_failed" | "stopped" | "ready";

export interface PreviewPaneProps {
  tree: ElementNode[];
  /** 最近一次生成的序号与本地时间；缺失 → `时间未知`（**不得显示 1970**） */
  seq: number | null;
  genAt: string | null;
  phase: PreviewPhase;
  progress: number;
  verifyRules: { rule: string; ok: boolean; detail?: string }[];
  verifyAttempt: number;
  reason: string;
  stopped: boolean;
  /** 外发开关关闭 → 生成类入口置灰（**不静默降级**） */
  canGenerate: boolean;
  onRegenerate: () => void;
  onRetryVerify: () => void;
  onStop: () => void;
  canceling?: boolean;
  canRetryVerify?: boolean;
  hasSnapshot?: boolean;
  l2Result?: TaskState["l2_result"];
  onViewLogs?: () => void;
  onViewArtifacts?: () => void;
  hasArtifacts?: boolean;
}

/** §6 的 10 个差异项（名称**默认可见**，详情逐项展开） */
const DIFFS: { name: string; detail: string; impact: string }[] = [
  { name: "字体度量", detail: "字体的字面高度、行距、字重、字距与 Android TextView 实际度量不同；同一 sp 值在网页里的占位宽度与真机不同。", impact: "文本换行位置、单行能否放下" },
  { name: "系统字体回退", detail: "真机可能回退到厂商字体（尤其中文），网页用固定字体栈。", impact: "中文显示宽度与断行" },
  { name: "阴影", detail: "网页用 CSS 近似（如 box-shadow），Android 用 elevation + 系统阴影；CardView / 悬浮组件阴影最明显。", impact: "卡片层次与视觉重量" },
  { name: "部分控件原生外观", detail: "DatePicker / TimePicker / Spinner / SeekBar / RatingBar / Switch / CheckBox / RadioButton 由系统主题决定实际外观，网页只能画近似形。", impact: "控件尺寸、选中态、系统主题差异" },
  { name: "本地化与区域格式", detail: "日期 / 时间选择器的月份名、星期顺序、12/24 小时制随系统区域变化。", impact: "文案与列宽" },
  { name: "状态栏 / 导航栏 / 安全区", detail: "真机有状态栏、导航栏、刘海 / 挖孔安全区；网页以固定手机外框 + 参考线近似。", impact: "顶部与底部可用高度" },
  { name: "圆角裁剪与图片缩放", detail: "CardView 圆角裁剪、ImageView scaleType 的实际裁剪方式。", impact: "图片变形与裁切位置" },
  { name: "RecyclerView / GridView 的 item 复用", detail: "网页渲染为静态列表，真机是复用视图（滚动性能、item 奇数行差异可能显现）。", impact: "列表滚动后的表现" },
  { name: "动画与转场", detail: "本期无动效，真机的系统级默认动画（如 Toast、Dialog 弹出）仍存在。", impact: "感知上的「动」" },
  { name: "Toast / Dialog", detail: "二者不是画布控件，网页无法预览其真实样式。", impact: "需要用户自行在真机确认" },
];

function styleOf(n: ElementNode): CSSProperties {
  const s = n.style;
  const dim = (d: typeof s.width) =>
    d.mode === "match" ? "100%" : d.mode === "wrap" ? "auto" : `${d.value ?? 0}px`;
  return {
    width: dim(s.width), height: dim(s.height),
    background: s.background, color: s.font_color, fontSize: `${s.font_size}px`,
    padding: `${s.padding.top}px ${s.padding.right}px ${s.padding.bottom}px ${s.padding.left}px`,
    margin: `${s.margin.top}px ${s.margin.right}px ${s.margin.bottom}px ${s.margin.left}px`,
    borderRadius: s.radius,
    border: s.border.width_dp > 0 ? `${s.border.width_dp}px ${s.border.style} ${s.border.color}` : undefined,
    opacity: s.alpha / 100, textAlign: s.align_h,
    display: s.visibility === "gone" ? "none" : "block",
    visibility: s.visibility === "invisible" ? "hidden" : "visible",
    boxSizing: "border-box", position: "relative",
  };
}

/** 只读渲染：与画布同一套近似规则，但**无手柄、无选中框、无拖拽提示** */
function renderNode(n: ElementNode) {
  const def = WIDGET_BY_TYPE.get(n.widget_type as never);
  const t = n.widget_type;
  let inner: React.ReactNode = null;
  if (["TEXT", "MULTILINE_TEXT", "RICH_TEXT", "LABEL"].includes(t)) inner = n.alias || def?.label || "文本";
  else if (t === "BUTTON") inner = <span style={{ display: "block", textAlign: "center" }}>{n.alias || "按钮"}</span>;
  else if (n.children.length === 0) inner = <span style={{ display: "block", color: "#bbb", fontSize: 12, textAlign: "center", paddingTop: 8 }}>{def?.label}</span>;
  return (
    <div key={n.temp_id} style={styleOf(n)}>
      {inner}
      {n.children.map(renderNode)}
    </div>
  );
}

export function PreviewPane(props: PreviewPaneProps) {
  const { tree, seq, genAt, phase, progress, verifyRules, verifyAttempt, reason, stopped, canGenerate, onRegenerate, onRetryVerify, onStop } = props;
  const [diffsOpen, setDiffsOpen] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const l2Display = buildResultDisplay(props.l2Result);
  const inFlight = phase === "generating" || phase === "verifying";
  const showRender = props.hasSnapshot ?? (phase === "ready" || phase === "stopped");

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", minWidth: 0, maxWidth: "100%" }}>
      <div style={{ position: "relative", minWidth: 0, maxWidth: "100%", overflowX: "auto" }}>
        {showRender && phase !== "ready" && <Alert style={{ marginBottom: 8, maxWidth: 360 }} showIcon
          type={phase === "gen_failed" || phase === "verify_failed" || phase === "load_failed" ? "warning" : "info"}
          message={phase === "generating" ? `正在生成代码（${progress}%）；保留上次成功预览。` : phase === "verifying" ? "正在验证；保留上次成功预览。" : phase === "stopped" ? "已停止；保留上次成功预览。" : reason || "新任务未成功，保留上次成功预览。"}
          action={phase === "verify_failed" ? <Button size="small" disabled={!props.canRetryVerify} onClick={onRetryVerify}>同输入重试</Button>
            : phase === "gen_failed" || phase === "load_failed" ? <Button size="small" disabled={!canGenerate} onClick={onRegenerate}>重新生成</Button> : undefined} />}
        {/* 顶部信息条 */}
        <div style={{
          height: 28, width: 360, background: "var(--ad-bg-page)", border: "1px solid var(--ad-border)",
          borderRadius: 4, display: "flex", alignItems: "center", padding: "0 8px", fontFamily: "monospace", fontSize: 12, color: "var(--ad-text-secondary)",
        }}>
          生成 #{seq ?? "—"} · {genAt ? new Date(genAt).toLocaleString("zh-CN") : "时间未知"}
        </div>

        {/* 渲染结果区（只读） */}
        <div style={{
          width: 360, minHeight: 640, marginTop: 4, background: "#FFFFFF", border: "2px solid var(--ad-border)",
          borderRadius: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", padding: 8, position: "relative",
        }}>
          {phase === "empty" && (
            <div style={centerBox}>
              <div>还没生成过页面。</div>
              <div style={{ marginTop: 4 }}>在左边拖几个控件，然后提交变更。</div>
            </div>
          )}
          {!showRender && phase === "generating" && (
            <div style={centerBox}>
              <Spin />
              <div style={{ marginTop: 12 }}>正在生成代码…</div>
              <div style={{ marginTop: 4, fontWeight: 600 }}>{progress}%</div>
            </div>
          )}
          {!showRender && phase === "verifying" && (
            <div style={{ ...centerBox, textAlign: "left", padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Spin size="small" />正在验证生成的代码…</div>
              <div style={{ marginTop: 12, width: "100%" }}>
                {verifyRules.length === 0 && <Typography.Text type="secondary">等待服务端验证证据…</Typography.Text>}
                {verifyRules.map((hit) => (
                  <div key={hit.rule} title={hit.detail} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                    {hit.ok ? <CheckOutlined style={{ color: "#389e0d" }} /> : <MinusOutlined style={{ color: "var(--ad-text-secondary)" }} />}
                    <span>{hit.rule}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!showRender && phase === "gen_failed" && (
            <div style={centerBox}>
              <div>代码没生成出来。</div>
              <div style={{ marginTop: 4, color: "var(--ad-text-secondary)", fontSize: 12 }}>原因：{reason || "上游服务不可用"}。</div>
              <Button style={{ marginTop: 12 }} disabled={!canGenerate} onClick={onRegenerate}>重新生成</Button>
            </div>
          )}
          {!showRender && phase === "verify_failed" && (
            <div style={centerBox}>
              <div>生成的代码没通过验证。</div>
              <div style={{ marginTop: 4, color: "var(--ad-text-secondary)", fontSize: 12 }}>原因：{reason || "请查看服务端验证证据"}。</div>
              {verifyAttempt >= 3
                ? <Space style={{ marginTop: 12 }}>
                  <Tag>需要人工介入</Tag>
                  <Button size="small" type="link" onClick={props.onViewLogs}>查看验证日志</Button>
                </Space>
                : <Button style={{ marginTop: 12 }} disabled={!canGenerate || !props.canRetryVerify} onClick={onRetryVerify}>重试（还剩 {3 - verifyAttempt} 次）</Button>}
            </div>
          )}
          {!showRender && phase === "load_failed" && (
            <div style={centerBox}>
              <div>预览没加载出来。</div>
              <Button style={{ marginTop: 12 }} disabled={!canGenerate} onClick={onRegenerate}>重试</Button>
            </div>
          )}
          {!showRender && phase === "stopped" && (
            <div style={centerBox}>
              <div>还没生成过页面。</div>
              <div style={{ marginTop: 4 }}>在左边拖几个控件，然后提交变更。</div>
            </div>
          )}
          {showRender && tree.map(renderNode)}

          {/* 常驻「近似预览」标记（空态 / 失败态同样显示） */}
          <Tooltip title="点开可看与真机的差异清单">
            <div
              role="button" tabIndex={0} aria-expanded={diffsOpen} aria-label="查看近似预览与真机差异"
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDiffsOpen((v) => !v); } }}
              onClick={() => setDiffsOpen((v) => !v)}
              style={{
                position: "absolute", top: 8, right: 8, height: 24, padding: "0 8px",
                background: "var(--ad-warn-bg)", color: "#d48806", border: "1px solid var(--ad-warn-border)", borderRadius: 999,
                display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer",
              }}
            >
              <WarningOutlined /> 近似预览
            </div>
          </Tooltip>
        </div>

        {/* 未验证构建 灰标（不阻断） */}
        <Tooltip title={props.l2Result?.reported ? `${l2Display.label}：${props.l2Result.log_digest}` : "本地构建结果尚未回传；不影响你继续使用。"}>
          <Tag style={{ marginTop: 8 }} color={l2Display.color}>
            {l2Display.label}
          </Tag>
        </Tooltip>
        {(verifyRules.length > 0 || props.hasArtifacts) && <Space wrap style={{ marginTop: 8 }}>
          {verifyRules.length > 0 && <Button size="small" onClick={props.onViewLogs}>查看服务端验证证据</Button>}
          {props.hasArtifacts && <Button size="small" onClick={props.onViewArtifacts}>查看生成产物</Button>}
        </Space>}

        {/* 停止生成 / 已停止 */}
        {inFlight && (
          <div style={{ marginTop: 8 }}>
            <Button size="small" loading={props.canceling} onClick={onStop}>停止生成</Button>
          </div>
        )}
        {stopped && (
          <div style={{ marginTop: 8, height: 32, display: "flex", alignItems: "center", gap: 6, background: "var(--ad-bg-page)", borderRadius: 4, padding: "0 8px", fontSize: 13, color: "var(--ad-text-secondary)" }}>
            <MinusOutlined /> 已停止
          </div>
        )}
      </div>

      {/* 差异清单面板（EL-PREVIEW-005） */}
      {diffsOpen && (
        <Card size="small" style={{ width: 360, maxWidth: "100%", maxHeight: 480, overflow: "auto" }} title={<span style={{ fontSize: 13 }}>与真机的差异（{DIFFS.length} 项）</span>}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            预览是按安卓布局规则绘制的网页近似渲染，不是真机效果。真机效果以你本地构建运行的结果为准。
          </Typography.Paragraph>
          {DIFFS.map((d, i) => (
            <div key={d.name} style={{ borderTop: i === 0 ? undefined : "1px solid var(--ad-border-light)", padding: "6px 0" }}>
              <div
                role="button" tabIndex={0} aria-expanded={openIdx === i}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenIdx(openIdx === i ? null : i); } }}
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}
              >
                {openIdx === i ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
                <span>{i + 1}. {d.name}</span>
              </div>
              {openIdx === i && (
                <div style={{ paddingLeft: 16, fontSize: 12, color: "var(--ad-text-secondary)", marginTop: 4 }}>
                  <div>具体差异：{d.detail}</div>
                  <div>对用户判断的影响：{d.impact}</div>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

const centerBox: CSSProperties = {
  position: "absolute", inset: 0, display: "grid", placeItems: "center", alignContent: "center",
  color: "var(--ad-text-secondary)", fontSize: 13, textAlign: "center", padding: 24,
};

export default PreviewPane;
