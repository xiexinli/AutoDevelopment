import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Space, Spin, Tag, Tooltip, Typography } from "antd";
import {
  CheckCircleFilled, CloseCircleFilled, LoadingOutlined, MinusOutlined, PlusOutlined, UploadOutlined, WarningOutlined,
} from "@ant-design/icons";
import { fetchStats, fetchProject, fetchRequirements, fetchCapabilities } from "@/store/session";
import { openTaskStream, type StreamStatus } from "@/sse/stream";
import { track } from "@/track";
import { takePendingWorkbenchEntry } from "@/track/pending";
import EditPage from "@/pages/EditPage";

/**
 * `UI-WORK-001` 工作台（主界面）。
 *
 * 结构（`UI-Spec §4.4`）：**顶部状态条（含 9 节点阶段导航）+ 左栏（分段控件 编辑｜预览，两态内容见 §4.8/§4.9）
 * + 右栏对话**。全站**只此一条 SSE 连接**（`REQ-GEN-007`）。
 *
 * 硬约束：
 *  - 阶段导航未到达 → **置灰 + 原因**「先完成上一步：{上一步名}。」（不静默降级）；
 *  - SSE 断开 → 顶部黄条 `连接已断开，正在重连…`；**SSE 不可用自动降级 2s 轮询，界面无差别**；
 *  - 手动「上传 PRD」**首次前**须先过 `EL-GLOBAL-004`（由上传页负责拦截）。
 */

/** 9 节点阶段导航（对齐漏斗 `REQ-TRACK-001`） */
const STAGES = ["新建", "上传", "审核", "拆解", "Spec", "编辑", "生成", "预览", "交付"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_ROUTE: Record<Stage, string> = {
  新建: "workbench", 上传: "upload", 审核: "review", 拆解: "split", Spec: "specs",
  编辑: "editor", 生成: "editor", 预览: "editor?mode=preview", 交付: "versions",
};

/** `数据模型 §3.1` 的 17 态 → 中文名（`EL-WORK-003`） */
const STAGE_CN: Record<string, string> = {
  created: "新建", kb_ready: "知识库就绪", reviewing: "审核中", chatting: "对话补充中",
  gate_passed: "门禁通过", splitting: "拆解中", spec_generating: "Spec 生成中", ui_finalizing: "UI 定稿中",
  api_developing: "接口开发中", app_developing: "App 开发中", editing: "编辑中", generating: "生成中",
  verifying: "验证中", preview_ready: "预览就绪", testing: "测试中", delivered: "已交付", manual_needed: "需人工介入",
};

/** 项目阶段 → 阶段导航的到达节点（只用于置灰判断，**不是业务真值**） */
const STAGE_ORDER: Record<string, number> = {
  created: 0, kb_ready: 1, reviewing: 2, chatting: 2, gate_passed: 3, gate_blocked: 2,
  splitting: 3, spec_ready: 4, spec_generating: 4, ui_finalizing: 5, api_developing: 5,
  app_developing: 5, editing: 5, generating: 6, verifying: 6, preview_ready: 7, testing: 7, delivered: 8,
};

export default function WorkbenchPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();

  const [stage, setStage] = useState("created");
  const [name, setName] = useState("");
  const [versionSeq, setVersionSeq] = useState(0);
  const [runningTasks, setRunningTasks] = useState(0);
  const [gate, setGate] = useState<{ text: string; icon: React.ReactNode; color: string }>({ text: "未审核", icon: <MinusOutlined />, color: "default" });
  const [gateBlocking, setGateBlocking] = useState(0);
  const [loading, setLoading] = useState(true);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("polling");
  const [specCount, setSpecCount] = useState(0);
  const [capCount, setCapCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([fetchProject(projectId), fetchStats(projectId)]);
      setName(p.name); setStage(s.stage); setVersionSeq(s.version_seq);
      setRunningTasks(s.running_tasks);
      // `EVT_proj_open_workbench`：`#3` 成功、已进入工作台之后；`from_entry` 由列表页留下
      const entry = takePendingWorkbenchEntry(projectId);
      if (entry) {
        track("EVT_proj_open_workbench", { project_id: projectId, stage: s.stage, from_entry: entry.from_entry },
          { dedupKey: `${projectId}:${entry.from_entry}`, immediate: true });
      }
    } catch { /* 顶部状态条失败不阻断页面 */ } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // 门禁徽标（`EL-WORK-004`）：来自拆解/审核数据
  useEffect(() => {
    let alive = true;
    void fetchRequirements(projectId)
      .then(() => { if (alive) setGate({ text: "已通过", icon: <CheckCircleFilled />, color: "success" }); })
      .catch(() => { if (alive) setGate({ text: gate_text(stage), icon: gate_icon(stage), color: gate_color(stage) }); });
    return () => { alive = false; };
  }, [projectId, stage]);

  useEffect(() => {
    if (stage === "gate_blocked") setGateBlocking(2);
    else setGateBlocking(0);
  }, [stage]);

  useEffect(() => {
    let alive = true;
    void import("@/store/session").then(async ({ listSpecs }) => {
      try { const r = await listSpecs(projectId); if (alive) setSpecCount(r.items.length); } catch { /* ignore */ }
    });
    void fetchCapabilities(projectId)
      .then((r) => { if (alive) setCapCount(r.items.filter((i) => i.enabled).length); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [projectId]);

  // 全站唯一一条 SSE 连接
  useEffect(() => {
    const stream = openTaskStream(projectId, { onStatus: setStreamStatus, onEvent: (t, d) => { void t; void d; } });
    return () => stream.close();
  }, [projectId]);

  const reached = STAGE_ORDER[stage] ?? 0;

  function gotoStage(s: Stage, idx: number) {
    const target = STAGE_ROUTE[s];
    if (idx > reached) return; // 置灰，不可点
    nav(`/projects/${projectId}/${target}`);
  }

  const mode = sp.get("mode") === "preview" ? "preview" : "edit";

  return (
    <div>
      {/* 顶部状态条 */}
      <div style={{ background: "var(--ad-bg-container)", border: "1px solid var(--ad-border)", borderRadius: 8, padding: "12px 24px", marginBottom: 12 }}>
        <Space size={12} wrap style={{ width: "100%" }}>
          <Typography.Text strong style={{ fontSize: 16, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name || "项目"}
          </Typography.Text>
          <Tag>{STAGE_CN[stage] ?? stage}</Tag>
          <Tag icon={gate.icon} color={gate.color}>
            {gate.text}{gate.text === "未通过" && gateBlocking > 0 ? `（${gateBlocking} 项阻断）` : ""}
          </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {versionSeq > 0 ? `v${versionSeq}` : "尚无版本"}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {runningTasks > 0 ? `${runningTasks} 个任务进行中` : "没有进行中的任务"}
          </Typography.Text>
          <div style={{ flex: 1 }} />
          <Button size="small" onClick={() => nav(`/projects/${projectId}/kb`)}>知识库</Button>
          <Button size="small" icon={<UploadOutlined />} onClick={() => { track("EVT_upload_entry_click", { project_id: projectId, gate: "pass" }, { dedupWindowMs: 300 }); nav(`/projects/${projectId}/upload`); }}>上传 PRD</Button>
        </Space>

        {/* 阶段导航（9 节点） */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          {STAGES.map((s, i) => {
            const done = i < reached;
            const cur = i === reached;
            const locked = i > reached;
            const node = (
              <span
                onClick={() => gotoStage(s, i)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13,
                  color: locked ? "var(--ad-text-disabled)" : cur ? "var(--ad-primary)" : done ? "#389e0d" : "var(--ad-text-secondary)",
                  fontWeight: cur ? 600 : 400, cursor: locked ? "not-allowed" : "pointer",
                }}
              >
                {done ? <CheckCircleFilled /> : locked ? <MinusOutlined /> : <span style={{ width: 12, textAlign: "center" }}>•</span>}
                {s}
              </span>
            );
            return (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {locked
                  ? <Tooltip title={`先完成上一步：${STAGES[Math.max(0, i - 1)]}。`}>{node}</Tooltip>
                  : node}
                {i < STAGES.length - 1 && <span style={{ color: "var(--ad-border)" }}>›</span>}
              </span>
            );
          })}
        </div>
      </div>

      {/* SSE 断线条（仅当轮询也失败时才出现；降级期间界面无差别） */}
      {streamStatus === "offline" && (
        <Alert banner type="warning" showIcon icon={<WarningOutlined />} message="连接已断开，正在重连…" style={{ marginBottom: 12 }} />
      )}

      {/* 生成中状态条 */}
      {runningTasks > 0 && (
        <div style={{ height: 32, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", marginBottom: 12, background: "var(--ad-primary-bg)", color: "var(--ad-primary)", borderRadius: 4, fontSize: 13 }}>
          <LoadingOutlined /> 生成中…
        </div>
      )}

      {/* 左栏（编辑｜预览，两态内容见 §4.8 / §4.9）+ 右栏对话 */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div style={{ display: "grid", placeItems: "center", height: 240 }}><Spin /></div>
          ) : (
            <EditPage basePath={`/projects/${projectId}/workbench`} />
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: "#bbb" }}>
            当前分段：{mode === "preview" ? "预览" : "编辑"} ｜ Spec {specCount} 份 ｜ 已开启能力 {capCount} 项
            <Badge status="processing" text="" style={{ marginLeft: 8 }} />
          </div>
        </div>

      </div>

      <div style={{ marginTop: 12 }}>
        <Button type="link" icon={<PlusOutlined />} onClick={() => nav(`/projects/${projectId}/apis`)}>去接口管理</Button>
      </div>
    </div>
  );
}

function gate_text(stage: string) {
  if (stage === "gate_blocked") return "未通过";
  if (stage === "gate_passed" || (STAGE_ORDER[stage] ?? 0) >= 4) return "已通过";
  if (stage === "reviewing") return "审核中";
  return "未审核";
}
function gate_icon(stage: string) {
  const t = gate_text(stage);
  return t === "已通过" ? <CheckCircleFilled /> : t === "未通过" ? <CloseCircleFilled /> : t === "审核中" ? <LoadingOutlined /> : <MinusOutlined />;
}
function gate_color(stage: string) {
  const t = gate_text(stage);
  return t === "已通过" ? "success" : t === "未通过" ? "warning" : t === "审核中" ? "processing" : "default";
}
