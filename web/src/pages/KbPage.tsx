import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert, App as AntApp, Button, Card, Empty, Input, Modal, Space, Spin, Tabs, Tag, Typography,
} from "antd";
import { ExclamationCircleFilled, InfoCircleOutlined, UploadOutlined } from "@ant-design/icons";
import {
  listKbDocs, fetchKbDoc, saveKbDoc, fetchProject,
  KB_ORIGIN_LABEL, KB_SECTORS, type KbDoc, type KbSector,
} from "@/store/session";
import { ApiError } from "@/api/client";
import Markdown from "@/components/Markdown";

/**
 * `UI-KB-001` 知识库页。
 *
 * 硬约束（逐条对着 `UI-Spec §4.3`）：
 *  - 页首**常驻**提示条「只含本项目内容」（`REQ-KB-001`）；
 *  - 五分区 Tab（PRD / Spec / 术语表 / 领域模型 / **工程约束**），**切换无动效**且**各自保留关键词**；
 *  - 来源标签用**中文文字**（平台抽取 / 你编辑过 / 你上传的），**不用英文枚举值**；
 *  - 编辑态替换预览区；「取消」**需二次确认**（防误丢）；`If-Match` 不匹配 → 409 不静默覆盖；
 *  - 空态、搜索无结果、403 是**三个不同视图**。
 */

function relTime(iso: string | null): string {
  if (!iso) return "时间未知";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "时间未知";
  const d = Date.now() - t;
  if (d < 60_000) return "刚刚";
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  return `${Math.floor(d / 86400_000)} 天前`;
}

export default function KbPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { message } = AntApp.useApp();

  const sectorParam = (sp.get("sector") as KbSector | null) ?? "prd";
  const sector: KbSector = KB_SECTORS.some((s) => s.key === sectorParam) ? sectorParam : "prd";

  /** 每个分区**各自保留**关键词（切回来还在） */
  const [keywords, setKeywords] = useState<Record<string, string>>({});
  const q = keywords[sector] ?? "";

  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [openDoc, setOpenDoc] = useState<{ kb_doc_id: string; title: string; origin: string; sector: KbSector;
    content_md: string; version: number; document_id: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");

  const [saving, setSaving] = useState(false);
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [revisions, setRevisions] = useState<{ id: string; at: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setForbidden(false);
    try {
      const [r, p] = await Promise.all([
        listKbDocs(projectId, { sector, q }),
        fetchProject(projectId).catch(() => null),
      ]);
      setDocs(r.items);
      if (p) setProjectName(p.name);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "FORBIDDEN") setForbidden(true);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, sector, q]);

  useEffect(() => { void load(); }, [load]);

  // PRD 区的 revision 历史（只读，**不覆盖**当前内容）
  useEffect(() => {
    if (sector !== "prd") { setRevisions([]); return; }
    let alive = true;
    void import("@/store/session").then(async ({ listRevisions }) => {
      try {
        if (!openDoc?.document_id) { if (alive) setRevisions([]); return; }
        const r = await listRevisions(openDoc.document_id);
        if (alive) setRevisions(r.items.map((x) => ({ id: x.revision_id, at: x.created_at })));
      } catch { if (alive) setRevisions([]); }
    });
    return () => { alive = false; };
  }, [sector, openDoc?.document_id]);

  async function openDetail(d: KbDoc) {
    try {
      const full = await fetchKbDoc(d.kb_doc_id);
      setOpenDoc({ kb_doc_id: full.kb_doc_id, title: full.title, origin: full.origin,
        sector: full.sector, content_md: full.content_md, version: full.version, document_id: full.document_id });
      setDraftText(full.content_md);
      setEditing(false); setConflict(false);
    } catch (e) {
      message.error((e as ApiError).message || "内容没加载出来。");
    }
  }

  useEffect(() => {
    const id=sp.get("doc");
    if (!id || !docs.some(d=>d.kb_doc_id===id) || openDoc?.kb_doc_id===id) return;
    void openDetail(docs.find(d=>d.kb_doc_id===id)!);
  },[sp,docs,openDoc?.kb_doc_id]);

  /** 放弃编辑**需二次确认**（防误丢） */
  function cancelEdit() {
    if (draftText !== openDoc?.content_md) { setGiveUpOpen(true); return; }
    setEditing(false);
  }

  async function onSave() {
    if (!openDoc) return;
    setSaving(true);
    try {
      const r = await saveKbDoc(openDoc.kb_doc_id, draftText, openDoc.version);
      setOpenDoc({ ...openDoc, content_md: draftText, version: r.version, origin: r.origin });
      setEditing(false);
      message.success("知识库内容已保存");
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "VERSION_CONFLICT") setConflict(true);
      else message.error(err.message || "保存没成功。");
    } finally {
      setSaving(false);
    }
  }

  const sectorLabel = useMemo(() => KB_SECTORS.find((s) => s.key === sector)?.label ?? "", [sector]);
  const filtered = q.trim() !== "";

  if (forbidden) {
    return (
      <Card>
        <Empty description="你没有权限访问这个项目。">
          <Button onClick={() => nav("/projects")}>返回上一级</Button>
        </Empty>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <Empty description="知识库没加载出来。"><Button onClick={() => void load()}>重试</Button></Empty>
      </Card>
    );
  }

  return (
    <div className="ad-page">
      {/* 页首常驻提示条 */}
      <Alert
        banner type="info" showIcon icon={<InfoCircleOutlined />}
        message="只含本项目内容"
        style={{ marginBottom: 12 }}
      />

      <Space style={{ marginBottom: 8 }} align="center">
        <Typography.Title className="ad-page-title">
          知识库{projectName ? ` · ${projectName}` : ""}
        </Typography.Title>
        <Button onClick={() => nav(-1)}>返回</Button>
      </Space>

      <Tabs
        activeKey={sector}
        onChange={(k) => { const next = new URLSearchParams(sp); next.set("sector", k); setSp(next, { replace: true }); }}
        items={KB_SECTORS.map((s) => ({ key: s.key, label: s.label }))}
      />

      <Input
        allowClear style={{ width: 280, marginBottom: 12 }} placeholder="搜索本区内容"
        value={q}
        onChange={(e) => setKeywords((k) => ({ ...k, [sector]: e.target.value.slice(0, 100) }))}
      />

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* 左：文档列表 */}
        <Card size="small" style={{ width: 340, flexShrink: 0 }} styles={{ body: { padding: 8 } }}>
          {loading ? (
            <div style={{ display: "grid", placeItems: "center", height: 160 }}>
              <Spin /><div style={{ marginTop: 12 }}>正在加载知识库…</div>
            </div>
          ) : docs.length === 0 ? (
            filtered ? (
              <Empty description={`没有匹配「${q}」的内容。`}>
                <Button size="small" onClick={() => setKeywords((k) => ({ ...k, [sector]: "" }))}>清除搜索</Button>
              </Empty>
            ) : sector === "constraints" ? (
              <Empty description="这个项目还没有接入工程约束。回到项目列表点「接入已有工程」即可。" />
            ) : (
              <Empty description="知识库还是空的。上传 PRD 后，平台会自动把内容抽进来。">
                <Button type="primary" size="small" icon={<UploadOutlined />}
                  onClick={() => nav(`/projects/${projectId}/upload`)}>上传 PRD</Button>
              </Empty>
            )
          ) : (
            docs.map((d) => (
              <div
                key={d.kb_doc_id}
                onClick={() => void openDetail(d)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 4, cursor: "pointer",
                  background: openDoc?.kb_doc_id === d.kb_doc_id ? "var(--ad-primary-bg)" : undefined,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
                  <Space size={6} style={{ marginTop: 2 }}>
                    <Tag style={{ marginInlineEnd: 0 }}>{KB_ORIGIN_LABEL[d.origin]}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>更新于 {relTime(d.updated_at)}</Typography.Text>
                  </Space>
                </div>
                <Button size="small" onClick={(e) => { e.stopPropagation(); void openDetail(d); }}>编辑</Button>
              </div>
            ))
          )}

          {/* PRD 区 revision 历史（只读） */}
          {sector === "prd" && revisions.length > 0 && (
            <div style={{ borderTop: "1px solid var(--ad-border)", marginTop: 8, paddingTop: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>解析历史</Typography.Text>
              {revisions.map((rv, i) => (
                <div key={rv.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                  <code style={{ fontSize: 12 }}>r{i + 1}</code>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{relTime(rv.at)}</Typography.Text>
                  <div style={{ flex: 1 }} />
                  <Button size="small" type="link"
                    onClick={() => message.info("只读查看该 revision 的解析结果，不会覆盖当前内容。")}>查看</Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 右：内容区（预览 / 编辑态替换） */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!openDoc ? (
            <Card><Empty description={`选择左边的 ${sectorLabel} 内容查看。`} /></Card>
          ) : editing ? (
            <Card
              size="small"
              title={<span style={{ fontSize: 13 }}>{openDoc.title}（编辑中）</span>}
              extra={<Space>
                <Button size="small" onClick={cancelEdit}>取消</Button>
                <Button size="small" type="primary" loading={saving} onClick={() => void onSave()}>保存</Button>
              </Space>}
            >
              <Input.TextArea
                autoFocus value={draftText} onChange={(e) => setDraftText(e.target.value)}
                autoSize={{ minRows: 16, maxRows: 30 }}
                style={{ minHeight: 320, fontFamily: "ui-monospace, Menlo, monospace" }}
              />
            </Card>
          ) : (
            <Card
              size="small"
              title={<span style={{ fontSize: 13 }}>{openDoc.title}</span>}
              extra={<Space>
                <Tag>{KB_ORIGIN_LABEL[openDoc.origin as keyof typeof KB_ORIGIN_LABEL]}</Tag>
                <Button size="small" onClick={() => { setDraftText(openDoc.content_md); setEditing(true); }}>编辑</Button>
              </Space>}
            >
              <div style={{ minHeight: 320, background: "var(--ad-bg-page)", padding: 16, borderRadius: 8 }}>
                <Markdown text={openDoc.content_md} />
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* 放弃编辑二次确认（破坏性） */}
      <Modal
        title="放弃这次编辑？" open={giveUpOpen} okText="放弃" cancelText="继续编辑" okButtonProps={{ danger: true }}
        onOk={() => { setGiveUpOpen(false); setEditing(false); setDraftText(openDoc?.content_md ?? ""); }}
        onCancel={() => setGiveUpOpen(false)}
      >
        <p>你改过的内容不会保存。</p>
      </Modal>

      {/* 并发冲突：不静默覆盖 */}
      <Modal
        title={<Space><ExclamationCircleFilled style={{ color: "#faad14" }} />该内容已被他人修改。</Space>}
        open={conflict} okText="以我的为准" cancelText="放弃我的改动"
        onOk={async () => {
          if (!openDoc) return;
          try {
            const fresh = await fetchKbDoc(openDoc.kb_doc_id);
            const r = await saveKbDoc(openDoc.kb_doc_id, draftText, fresh.version);
            setOpenDoc({ ...openDoc, content_md: draftText, version: r.version, origin: r.origin });
            setEditing(false); setConflict(false);
            message.success("知识库内容已保存");
          } catch (e) {
            message.error((e as ApiError).message || "保存没成功。");
          }
        }}
        onCancel={() => { setConflict(false); message.info("已放弃我的改动。"); }}
      >
        <p>你打开这篇之后，服务端已经更新过它。请选择如何处理你的改动。</p>
      </Modal>
    </div>
  );
}
