import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert, App as AntApp, Button, Card, Drawer, Empty, Modal, Space, Spin, Table, Tabs, Tag, Typography,
} from "antd";
import { ExclamationCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  listSpecs, fetchSpec, generateSpecs, exportSpec, fetchSpecProofread, fetchTraceability,
  SPEC_ROLES, SPEC_ROLE_LABEL, type SpecDoc, type SpecRole, type TraceRow,
} from "@/store/session";
import { ApiError } from "@/api/client";
import { track } from "@/track";
import Markdown from "@/components/Markdown";

/**
 * `UI-SPEC-001` Spec 产出页。
 *
 * 硬约束（逐条对着 `UI-Spec §4.12`）：
 *  - 五个 tab，**顺序即生成顺序**：UI → 接口 → App → 埋点 → 测试（`AC-SC-01`）；
 *  - **单份失败不阻断其余**，失败 tab 内独立错误态，**整体不得置为成功**（`overall ≠ succeeded`）；
 *  - 四态（已覆盖 / 有缺口 / 不适用 / 延后）**必须由接口给出，用文字表达**，前端不得估算；
 *  - 导出**需鉴权**、内容**不含密钥**；重新生成 → 二次确认，当前版本**归档为历史版本（不删除）**。
 */

const ROLE_ORDER: SpecRole[] = SPEC_ROLES;

export default function SpecsPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const { message } = AntApp.useApp();

  const [docs, setDocs] = useState<SpecDoc[]>([]);
  const [overall, setOverall] = useState<string>("none");
  const [active, setActive] = useState<SpecRole>("ui");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrix, setMatrix] = useState<{ orphan_count: number; items: TraceRow[] }>({ orphan_count: 0, items: [] });
  const [proof, setProof] = useState<{ item_code: string; content: string; can_loopback: boolean }[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await listSpecs(projectId);
      setDocs(r.items); setOverall(r.overall);
      if (r.items.length && !r.items.some((d) => d.role === active)) setActive(r.items[0].role);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId, active]);

  useEffect(() => { void load(); }, [load]);

  const activeDoc = docs.find((d) => d.role === active);


  const loadContent = useCallback(async (docId: string) => {
    try { const r = await fetchSpec(docId); setContent(r.content_md); } catch { setContent(""); }
  }, []);

  useEffect(() => {
    if (activeDoc && activeDoc.status === "succeeded") void loadContent(activeDoc.spec_id);
    else setContent("");
  }, [activeDoc, loadContent]);

  // 校对只对**成功生成**的那一份做（校验 #34 的前置条件）
  useEffect(() => {
    if (!activeDoc) { setProof([]); return; }
    void fetchSpecProofread(projectId, activeDoc.spec_id).then((r) => setProof(r.items)).catch(() => setProof([]));
  }, [projectId, activeDoc]);

  useEffect(() => {
    void fetchTraceability(projectId).then((r) => setMatrix({ orphan_count: r.orphan_count, items: r.items })).catch(() => undefined);
  }, [projectId]);

  async function onGenerate() {
    setBusy(true);
    const startedAt = Date.now();
    try {
      await generateSpecs(projectId);
      message.success(`已开始生成 ${SPEC_ROLE_LABEL[active]} Spec。`);
      await new Promise((r) => setTimeout(r, 2600));
      await load();
      // 漏斗节点 5：`#30` 返回（含 `overall`）之后；`partial` 不得上报为成功
      const rr = await listSpecs(projectId);
      track("EVT_spec_gen_done", {
        succeeded: rr.items.filter((d) => d.status === "succeeded").map((d) => d.role),
        failed_roles: rr.items.filter((d) => d.status === "failed").map((d) => d.role),
        overall: rr.overall,
        duration_ms: Date.now() - startedAt,
      }, { dedupKey: `specgen:${startedAt}`, immediate: true });
    } catch (e) {
      const err = e as ApiError;
      message.error(err.code === "UPSTREAM_UNAVAILABLE"
        ? "你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。"
        : err.message || "生成没成功。");
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    if (!activeDoc) return;
    try {
      await exportSpec(activeDoc.spec_id);
      message.success(`已导出 ${SPEC_ROLE_LABEL[activeDoc.role]}-Spec.md`);
      track("EVT_spec_export", {
        role: activeDoc.role,
        doc_size_kb: Number((new Blob([content ?? ""]).size / 1024).toFixed(2)),
      }, { dedupKey: `specexport:${activeDoc.role}`, immediate: true });
    } catch (e) {
      message.error((e as ApiError).message || "导出失败了。");
    }
  }

  const succeeded = docs.filter((d) => d.status === "succeeded" || d.status === "stale").length;
  const failed = docs.filter((d) => d.status === "failed").length;

  if (loading) {
    return <Card><div style={{ display: "grid", placeItems: "center", height: 200 }}><Spin /><div style={{ marginTop: 12 }}>正在生成 {SPEC_ROLE_LABEL[active]} Spec…</div></div></Card>;
  }
  if (error) {
    return <Card><Empty description="这份 Spec 没生成出来。"><Button onClick={() => void load()}>重试这一份</Button></Empty></Card>;
  }
  if (docs.length === 0) {
    return (
      <Card>
        <Empty description="还没有生成 Spec。">
          <Button type="primary" loading={busy} onClick={() => void onGenerate()}>开始生成</Button>
        </Empty>
      </Card>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <Space style={{ marginBottom: 16 }} align="center">
        <Typography.Title className="ad-page-title">Spec</Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>顺序即生成顺序：UI → 接口 → App → 埋点 → 测试</Typography.Text>
      </Space>

      {overall === "partial" && (
        <Alert
          style={{ marginBottom: 12 }} type="warning" showIcon
          message={`${succeeded} 份已生成，${failed} 份失败。`}
        />
      )}

      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => void onExport()}>导出 .md</Button>
        <Button icon={<ReloadOutlined />} onClick={() => setRegenerateOpen(true)}>重新生成</Button>
        <Button onClick={() => nav(`/projects/${projectId}/versions`)}>版本</Button>
        <Button onClick={() => setMatrixOpen(true)}>追溯矩阵</Button>
      </Space>

      <Tabs
        activeKey={active}
        onChange={(k) => setActive(k as SpecRole)}
        items={ROLE_ORDER.map((role) => {
          const doc = docs.find((d) => d.role === role);
          const failedTab = doc?.status === "failed";
          return {
            key: role,
            label: <span>{SPEC_ROLE_LABEL[role]}{failedTab && <ExclamationCircleOutlined style={{ color: "#ff4d4f", marginLeft: 4 }} />}</span>,
            children: <SpecBody role={role} doc={doc} content={content} onRetry={() => void onGenerate()} busy={busy} />,
          };
        })}
      />

      {/* 补充要求清单（校对产出，REQ-PROOF-001） */}
      <Card size="small" style={{ marginTop: 16 }} title={<span style={{ fontSize: 13 }}>补充要求清单</span>}>
        {proof.length === 0 ? <Empty description="校对完成，没有补充要求。" /> : proof.map((p) => (
          <div key={p.item_code} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--ad-border-light)" }}>
            <Tag>{p.item_code}</Tag>
            <span style={{ flex: 1, fontSize: 13 }}>{p.content}</span>
            {/* **补不上的条目才带「回流对话」**（`#34` 的 can_loopback） */}
            {p.can_loopback && <Button size="small" type="link" onClick={() => nav(`/projects/${projectId}/workbench`)}>回流对话补充</Button>}
          </div>
        ))}
      </Card>

      <Modal
        title="重新生成？" open={regenerateOpen} okText="重新生成" cancelText="取消"
        onOk={() => { setRegenerateOpen(false); void onGenerate(); }}
        onCancel={() => setRegenerateOpen(false)}
      >
        <p>当前版本会归档为历史版本（不删除）。</p>
      </Modal>

      <Drawer width={720} open={matrixOpen} onClose={() => setMatrixOpen(false)} title="追溯矩阵">
        <Space style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary">孤儿 {matrix.orphan_count} 条</Typography.Text>
        </Space>
        <Table
          rowKey="req_id" size="small" pagination={false} dataSource={matrix.items}
          columns={[
            { title: "REQ", dataIndex: "req_id", width: 140, render: (v: string) => <code>{v}</code> },
            { title: "UI", dataIndex: ["targets", "ui"], width: 120, ellipsis: true },
            { title: "接口", dataIndex: ["targets", "api"], width: 120, ellipsis: true },
            { title: "App", dataIndex: ["targets", "app"], width: 120, ellipsis: true },
            { title: "埋点", dataIndex: ["targets", "track"], width: 120, ellipsis: true },
            { title: "测试", dataIndex: ["targets", "test"], width: 120, ellipsis: true },
            { title: "覆盖状态", dataIndex: "coverage_status", width: 100, render: (v: string) => {
              // 四态：**由接口给出**，前端只映射为中文文字，不自行估算
              const map: Record<string, [string, string]> = {
                OK: ["已覆盖", "success"], GAP: ["有缺口", "warning"], "N/A": ["不适用", "default"], Deferred: ["延后", "default"],
              };
              const [text, color] = map[v] ?? [v, "default"];
              return <Tag color={color}>{text}</Tag>;
            } },
          ]}
        />
      </Drawer>
    </div>
  );
}

function SpecBody({ role, doc, content, onRetry, busy }: {
  role: SpecRole; doc?: SpecDoc; content: string; onRetry: () => void; busy: boolean;
}) {
  if (!doc) return <Card><Empty description="这份 Spec 还没生成。" /></Card>;
  if (doc.status === "generating") {
    return <Card><div style={{ display: "grid", placeItems: "center", height: 160 }}><Spin /><div style={{ marginTop: 12 }}>正在生成 {role} Spec…</div></div></Card>;
  }
  if (doc.status === "failed") {
    return (
      <Card>
        <Empty
          image={<ExclamationCircleOutlined style={{ fontSize: 40, color: "#ff4d4f" }} />}
          description={
            <div>
              <div>这份 Spec 没生成出来。</div>
              <div style={{ color: "var(--ad-text-secondary)", fontSize: 12 }}>原因：{doc.error_code === "UPSTREAM_TIMEOUT" ? "上游服务超时（5min）" : "未知原因"}。</div>
            </div>
          }
        >
          <Button loading={busy} onClick={onRetry}>重试这一份</Button>
        </Empty>
      </Card>
    );
  }
  return (
    <Card style={{ background: "var(--ad-bg-container)" }}>
      {doc.stale && (
        <Alert
          style={{ marginBottom: 12 }} type="info" showIcon
          message={`这份 Spec 已过期（需求变更为 ${doc.change_point ?? "上游变更"}）。`}
          action={<Button size="small" loading={busy} onClick={onRetry}>重新生成</Button>}
        />
      )}
      <Markdown text={content || "# " + role + " Spec\n\n（内容为空）"} />
    </Card>
  );
}
