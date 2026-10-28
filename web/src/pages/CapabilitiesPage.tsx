import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert, App as AntApp, Button, Card, Empty, Modal, Space, Spin, Switch, Tag, Tooltip, Typography,
} from "antd";
import {
  CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, MinusOutlined, ToolOutlined, WarningFilled,
} from "@ant-design/icons";
import {
  fetchCapabilities, saveCapabilities, fetchAiEgress, updateAiEgress,
  type CapConflict, type CapRow, type CapStatus,
} from "@/store/session";
import { ApiError } from "@/api/client";
import { track } from "@/track";

/**
 * `UI-CAP-001` 能力配置页 —— ★ 承载 **P0 合规项**：外发第三方大模型的**用户级开关**。
 *
 * 硬约束（逐条对着 `UI-Spec §4.11`）：
 *  - 7 项能力**固定**、默认全关（`AC-CP-01`）；切换开关**不立即生效**，须点「保存并生成」；
 *  - 关闭已生成过的能力 → 二次确认，**只移除配置、已生成代码保留并加注释标记**；
 *  - 「保存并生成」= **保存即生成**，生成前自动备份旧代码；配置纳入项目级版本快照；
 *  - 部分失败：顶部**标黄**「{n} 项生成失败：{列表}」+ 逐项「重试」，**整体不显示为成功**；
 *  - 外发开关（`EL-CAP-019`）：关闭 → **生成类任务一律不可用**，给原因（`EL-CAP-021`），**不静默降级**；
 *  - `EL-CAP-014`：**界面任何位置不得出现真实 key 的输入框**。
 */

const STATUS_META: Record<CapStatus, { text: string; icon: React.ReactNode; color: string }> = {
  not_generated: { text: "未生成", icon: <MinusOutlined />, color: "default" },
  generated: { text: "已生成", icon: <CheckCircleFilled />, color: "success" },
  partial: { text: "部分生成", icon: <ExclamationCircleFilled />, color: "warning" },
  failed: { text: "生成失败", icon: <CloseCircleFilled />, color: "error" },
};

export default function CapabilitiesPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const { message } = AntApp.useApp();

  const [rows, setRows] = useState<CapRow[]>([]);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [version, setVersion] = useState(1);
  /** 依赖冲突结构来自接口（`conflicts[] = [{library,version_a,version_b}]`），**前端不自行推断** */
  const [conflicts, setConflicts] = useState<CapConflict[]>([]);
  const [alignment, setAlignment] = useState<{ library: string; resolved: string }[]>([]);
  /** 整体状态由接口给出：**部分失败绝不显示为成功**（`REQ-CAP-002`） */
  const [overall, setOverall] = useState<"none" | "succeeded" | "partial" | "failed">("none");
  const [failed, setFailed] = useState<{ capability: string; error_code: string }[]>([]);
  const [confirmedDisable, setConfirmedDisable] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [neverSaved, setNeverSaved] = useState(false);

  const [egress, setEgress] = useState(false);
  const [egressTouched, setEgressTouched] = useState(false);

  const [confirmRow, setConfirmRow] = useState<CapRow | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [failTip, setFailTip] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [cap, eg] = await Promise.all([fetchCapabilities(projectId), fetchAiEgress().catch(() => null)]);
      setRows(cap.items); setVersion(cap.version); setConflicts(cap.conflicts);
      setAlignment(cap.alignment_table ?? []); setOverall(cap.overall); setFailed(cap.failed);
      setDraft(Object.fromEntries(cap.items.map((i) => [i.capability, i.enabled])));
      setFailTip(cap.failed.map((f) => cap.items.find((i) => i.capability === f.capability)?.name ?? f.capability)
        .concat(cap.items.filter((i) => i.enabled && i.code_status === "partial").map((i) => i.name)));
      setNeverSaved(cap.items.every((i) => i.code_status === "not_generated" && !i.enabled) && cap.version <= 1);
      if (eg) setEgress(eg.egress_enabled);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  function toggle(row: CapRow, next: boolean) {
    // 关闭「已生成过代码」的能力 → 二次确认（只移除配置，已生成代码保留）
    if (!next && row.enabled && row.code_status !== "not_generated") { setConfirmRow(row); return; }
    setDraft((d) => ({ ...d, [row.capability]: next }));
  }

  const dirty = rows.some((r) => (draft[r.capability] ?? r.enabled) !== r.enabled);
  /** 关闭「已生成过」的能力 → 服务端要求 `confirm_disable`（取消勾选只移除配置，不删已生成代码） */
  const needsDisableConfirm = rows.some((r) => !(draft[r.capability] ?? r.enabled) && r.enabled && r.code_status !== "not_generated");

  async function onSave() {
    setSaving(true); setError(null);
    try {
      const payload = rows.map((r) => ({ capability: r.capability, enabled: draft[r.capability] ?? r.enabled }));
      const r = await saveCapabilities(projectId, payload, version, confirmedDisable || needsDisableConfirm);
      setRows(r.items); setVersion(r.version); setConflicts(r.conflicts);
      setAlignment(r.alignment_table ?? []); setOverall(r.overall); setFailed(r.failed); setConfirmedDisable(false);
      setDraft(Object.fromEntries(r.items.map((i) => [i.capability, i.enabled])));
      setNeverSaved(false);
      const bad = r.failed.map((f) => r.items.find((i) => i.capability === f.capability)?.name ?? f.capability)
        .concat(r.items.filter((i) => i.enabled && i.code_status === "partial").map((i) => i.name));
      setFailTip(bad);
      if (!bad.length) message.success(`接入代码已生成（${r.items.filter((i) => i.enabled && i.code_status === "generated").length} 项）`);
      // `EVT_cap_save_generated`：保存成功、结果与「生成中」已渲染之后
      const enabledNow = r.items.filter((i) => i.enabled).map((i) => i.capability);
      track("EVT_cap_save_generated", {
        overall: r.overall, enabled_capabilities: enabledNow, enabled_count: enabledNow.length,
        failed_capabilities: (r.failed ?? []).map((f) => f.capability),
      }, { dedupKey: `cap_save:${r.overall}:${enabledNow.join(",")}`, immediate: true });
    } catch (e) {
      const err = e as ApiError;
      setError(err);
      message.error(err.code === "UPSTREAM_UNAVAILABLE"
        ? "你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。"
        : "配置没保存成功。");
    } finally {
      setSaving(false);
    }
  }

  async function retryOne(row: CapRow) {
    try {
      const r = await saveCapabilities(projectId, [{ capability: row.capability, enabled: row.enabled }], version, true);
      setRows(r.items); setVersion(r.version); setConflicts(r.conflicts);
      setAlignment(r.alignment_table ?? []); setOverall(r.overall); setFailed(r.failed);
      setDraft(Object.fromEntries(r.items.map((i) => [i.capability, i.enabled])));
      setFailTip(r.failed.map((f) => r.items.find((i) => i.capability === f.capability)?.name ?? f.capability));
      message.success(`「${row.name}」的接入代码已重新生成。`);
    } catch (e) {
      message.error((e as ApiError).message || "重试没成功。");
    }
  }

  async function onToggleEgress(next: boolean) {
    setEgressTouched(true);
    setEgress(next);
    try {
      const r = await updateAiEgress({ egress_enabled: next });
      setEgress(r.egress_enabled);
      message.success(next ? "已开启「PRD 正文与代码外发第三方大模型」。" : "已关闭「PRD 与代码外发第三方大模型」。");
      // ★合规：用户关闭外发开关时（只报原因长度，不报全文）
      if (!next) track("EVT_aiegress_disabled", { egress_enabled: false, disabled_reason_len: "你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。".length },
        { dedupKey: "egress_disabled", immediate: true });
      else track("EVT_aiegress_enabled", { egress_enabled: true },
        { dedupKey: "egress_enabled", immediate: true });
    } catch (e) {
      setEgress(!next);
      message.error((e as ApiError).message || "设置没保存成功。");
    }
  }

  if (loading) {
    return <Card><div style={{ display: "grid", placeItems: "center", height: 200 }}><Spin /><div style={{ marginTop: 12 }}>正在保存配置…</div></div></Card>;
  }
  if (error && !rows.length) {
    return (
      <Card>
        <Empty description="配置没保存成功。">
          <Button onClick={() => void load()}>重试</Button>
        </Empty>
      </Card>
    );
  }

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <Space style={{ marginBottom: 16 }} align="center">
        <Typography.Title className="ad-page-title">能力配置</Typography.Title>
        <Button onClick={() => nav(`/projects/${projectId}/workbench`)}>返回工作台</Button>
      </Space>

      <div style={{ marginBottom: 12 }}>
        <Tag color="blue">目标端：安卓（本期固定）</Tag>
        {overall !== "none" && (
          <Tag color={overall === "succeeded" ? "success" : overall === "partial" ? "warning" : "error"}>
            {overall === "succeeded" ? "全部已生成" : overall === "partial" ? `部分生成（${failed.length} 项未完成）` : "生成失败"}
          </Tag>
        )}
      </div>

      {/* ★ P0 合规：外发大模型用户级开关 */}
      <Card size="small" style={{ marginBottom: 12, borderColor: egress ? undefined : "#faad14" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Typography.Text strong>PRD 正文与代码外发第三方大模型</Typography.Text>
              <Tag color={egress ? "success" : "default"}>{egress ? "已开启" : "已关闭"}</Tag>
            </div>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0", fontSize: 13 }}>
              打开后，你上传的 PRD 正文与平台生成的业务代码会发送至第三方大模型服务，用于生成 Spec 与安卓代码。
            </Typography.Paragraph>
          </div>
          <Switch checked={egress} onChange={(v) => void onToggleEgress(v)} />
        </div>
        {!egress && (
          <Alert
            style={{ marginTop: 8 }} type="warning" showIcon
            message={
              <span>
                你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。{" "}
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void onToggleEgress(true)}>去开启</Button>
              </span>
            }
          />
        )}
        {egressTouched && !egress && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            关闭后，工作台与编辑页的生成入口会置灰并说明原因，不会静默降级。
          </Typography.Text>
        )}
      </Card>

      {/* 部分失败标黄条 */}
      {failTip.length > 0 && (
        <Alert
          style={{ marginBottom: 12 }} type="warning" showIcon
          message={`${failTip.length} 项生成失败：${failTip.join("、")}`}
          action={<Space size={4}>
            {rows.filter((r) => failTip.includes(r.name)).map((r) => (
              <Button key={r.capability} size="small" type="link" onClick={() => void retryOne(r)}>重试</Button>
            ))}
          </Space>}
        />
      )}

      {neverSaved && rows.every((r) => !r.enabled) && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon
          message="还没有配置任何能力。"
          description="全部关掉也是可以的，想接入哪项再打开。" />
      )}

      <Card
        size="small"
        title={<span style={{ fontSize: 13 }}>能力（{rows.filter((r) => draft[r.capability]).length}/{rows.length} 已开启）</span>}
        extra={<Button size="small" icon={<ToolOutlined />} onClick={() => setAgentOpen(true)}>查看版本对齐表</Button>}
      >
        {rows.map((row) => {
          const on = draft[row.capability] ?? row.enabled;
          const meta = STATUS_META[row.code_status as CapStatus];
          return (
            <div key={row.capability} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--ad-border-light)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text strong>{row.name}</Typography.Text>
                <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.description}</Typography.Text></div>
              </div>
              <Tag icon={meta.icon} color={meta.color}>{meta.text}</Tag>
              <Switch checked={on} onChange={(v) => toggle(row, v)} />
            </div>
          );
        })}

        <div style={{ marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            本期不采集密钥。接入代码里预留了占位，请在工程内自行填写。
          </Typography.Text>
        </div>

        {conflicts.length > 0 && (
          <Alert
            style={{ marginTop: 12 }} type="error" showIcon
            message={`${conflicts[0].library} 被两个能力要求了不同版本（${conflicts[0].version_a} / ${conflicts[0].version_b}）。`}
            action={<Button size="small" onClick={() => setConflictOpen(true)}>查看版本对齐表</Button>}
          />
        )}

        <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12 }}>
          <Tooltip title={egress ? "" : "你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。"}>
            <Button type="primary" loading={saving} disabled={!dirty || !egress} onClick={() => void onSave()}>保存并生成</Button>
          </Tooltip>
          {saving && <Typography.Text type="secondary" style={{ fontSize: 12 }}><Spin size="small" /> 正在生成接入代码…</Typography.Text>}
          {!dirty && !saving && <Typography.Text type="secondary" style={{ fontSize: 12 }}>配置没有变化。</Typography.Text>}
        </div>
      </Card>

      {/* 取消勾选二次确认（只移除配置，已生成代码保留） */}
      <Modal
        title={confirmRow ? `取消「${confirmRow.name}」？` : "取消该项？"}
        open={!!confirmRow} okText="取消勾选" cancelText="保留"
        onOk={() => {
          if (confirmRow) {
            // `EVT_cap_disable_confirmed`：用户确认取消勾选「已生成过」的能力（弹窗确认之后）
            track("EVT_cap_disable_confirmed", {
              capability: confirmRow.capability, code_status_before: confirmRow.code_status,
            }, { dedupKey: `cap_disable:${confirmRow.capability}`, immediate: true });
            setDraft((d) => ({ ...d, [confirmRow.capability]: false }));
            setConfirmedDisable(true);
          }
          setConfirmRow(null);
        }}
        onCancel={() => setConfirmRow(null)}
      >
        <p>只会移除这项配置，已生成的接入代码会保留并加注释标记，不会删除你手写的代码。</p>
      </Modal>

      {/* 版本对齐表（只列冲突项） */}
      <Modal title="版本对齐表" open={conflictOpen} footer={<Button onClick={() => setConflictOpen(false)}>关闭</Button>}
        onCancel={() => setConflictOpen(false)}>
        {conflicts.length === 0
          ? <Empty description="当前没有依赖冲突。" />
          : conflicts.map((c) => (
            <div key={c.library} style={{ display: "flex", gap: 12, padding: "6px 0", alignItems: "center" }}>
              <code>{c.library}</code>
              <Tag color="red">{c.version_a}</Tag>
              <Tag color="red">{c.version_b}</Tag>
              {alignment.find((a) => a.library === c.library) && (
                <Tag color="green">对齐为 {alignment.find((a) => a.library === c.library)!.resolved}</Tag>
              )}
              <WarningFilled style={{ color: "#faad14" }} />
            </div>
          ))}
      </Modal>

      <Modal title="版本对齐表" open={agentOpen} footer={<Button onClick={() => setAgentOpen(false)}>关闭</Button>}
        onCancel={() => setAgentOpen(false)}>
        {alignment.length === 0
          ? <Empty description="只列出冲突项，不列全量依赖。" />
          : alignment.map((a) => (
            <div key={a.library} style={{ display: "flex", gap: 12, padding: "6px 0" }}>
              <code>{a.library}</code><Tag color="green">统一为 {a.resolved}</Tag>
            </div>
          ))}
      </Modal>
    </div>
  );
}
