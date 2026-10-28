import { useCallback, useEffect, useMemo, useState  } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  App as AntApp, Button, Card, Checkbox, Drawer, Empty, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckOutlined, CloseOutlined, DeleteOutlined, ExclamationCircleOutlined, MinusOutlined, PlusOutlined,
} from "@ant-design/icons";
import {
  listApis, createApi, patchApi, deleteApi, putApiSchema, createVersion,
  listVersions, fetchVersionDiff,
  FIELD_TYPES, type ApiDef, type ApiField, type FieldType, type ApiMethod, type ApiStatus, type VersionDiffRow, type VersionRow,
} from "@/store/session";
import { ApiError } from "@/api/client";

/**
 * `UI-API-001` 接口管理页。
 *
 * ⚠️ 本页管理的是**被开发项目的接口定义**，与「平台自身接口（`接口契约 #n`）」是两套，**不得混称**。
 *
 * 硬约束（逐条对着 `UI-Spec §4.10`）：
 *  - 保存 **≠** 进版本：保存成功 Toast「接口已保存（未纳入版本）」，**必须点「生成新版本」才进版本**；
 *  - `field_type` **完整 8 项、禁写「等」**；字段名非法 → 字段级错误且**保留输入**；
 *  - 删除 → 二次确认，**在下次生成版本后生效**，引用它的 Spec 与验收标准标「需复核」；
 *  - 409 `VERSION_CONFLICT` → **不静默覆盖**，给 diff + 「以我的为准 / 放弃我的改动」；
 *  - 空态（从未定义）与筛选空态**是两个不同视图**。
 */

const METHOD_COLOR: Record<string, string> = { GET: "blue", POST: "green", PUT: "blue", DELETE: "red", PATCH: "orange" };
const STATUS_META: Record<ApiStatus, { text: string; icon: React.ReactNode; color: string }> = {
  draft: { text: "草稿", icon: <MinusOutlined />, color: "default" },
  effective: { text: "生效", icon: <CheckOutlined />, color: "success" },
  deprecated: { text: "已废弃", icon: <CloseOutlined />, color: "default" },
};

/** `最后更新于 {相对时间}`；缺失 → `时间未知`（**不得显示 1970**） */
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
function localTime(iso: string | null): string {
  if (!iso) return "时间未知";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "时间未知" : t.toLocaleString("zh-CN");
}
const FIELD_NAME_RE = /^[A-Za-z0-9_]+$/;

interface Draft { api_id: string | null; code: string; name: string; method: ApiMethod; path: string; fields: ApiField[] }
const emptyField = (): ApiField => ({ name: "", field_type: "string", required: false, length: null, precision: null, unit: "", description: "" });

export default function ApiManagePage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const { message } = AntApp.useApp();

  const [rows, setRows] = useState<ApiDef[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ApiStatus | "">("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [diffOf, setDiffOf] = useState<VersionRow | null>(null);
  const [diff, setDiff] = useState<VersionDiffRow[]>([]);

  const [draft, setDraft] = useState<Draft | null>(null);

  const [fieldErr, setFieldErr] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const [delTarget, setDelTarget] = useState<ApiDef | null>(null);
  const [conflict, setConflict] = useState<{ body: ApiDef; mine: Draft } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await listApis(projectId, { q, status, page, page_size: pageSize });
      setRows(r.items); setTotal(r.total);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId, q, status, page, pageSize]);

  const loadVersions = useCallback(async () => {
    try { const r = await listVersions(projectId); setVersions(r.items); } catch { /* 版本区失败不阻断清单 */ }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadVersions(); }, [loadVersions]);

  const filtered = q.trim() !== "" || status !== "";

  function openNew() {
    setFieldErr({});
    setDraft({ api_id: null, code: "", name: "", method: "GET", path: "", fields: [emptyField()] });
  }
  function openEdit(row: ApiDef) {
    setFieldErr({});
    setDraft({ api_id: row.api_id, code: row.code, name: row.name, method: row.method, path: row.path,
      fields: row.fields.length ? row.fields.map((f) => ({ ...f })) : [emptyField()] });
  }
  function openCopy(row: ApiDef) {
    setFieldErr({});
    setDraft({ api_id: null, code: `${row.code}-copy`, name: `${row.name}（副本）`, method: row.method,
      path: row.path, fields: row.fields.map((f) => ({ ...f })) });
  }

  /** 字段级校验：非法 → 红框 + 气泡文案，**已输入内容全部保留** */
  function validateFields(): boolean {
    const errs: Record<number, string> = {};
    draft?.fields.forEach((f, i) => {
      if (!f.name.trim() || !FIELD_NAME_RE.test(f.name.trim())) {
        errs[i] = "字段名不能为空，且只能是字母、数字、下划线。";
      }
    });
    setFieldErr(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSaveDraft() {
    if (!draft) return;
    if (!draft.code.trim() || !draft.name.trim()) { message.warning("接口编号与名称不能为空。"); return; }
    if (!validateFields()) return;
    setSaving(true);
    try {
      if (draft.api_id) {
        const cur = rows.find((r) => r.api_id === draft.api_id);
        await patchApi(draft.api_id, {
          code: draft.code.trim(), name: draft.name.trim(), method: draft.method, path: draft.path.trim(),
        }, cur?.version ?? 1);
        await putApiSchema(draft.api_id, draft.fields, (cur?.version ?? 1) + 1);
      } else {
        const created = await createApi(projectId, {
          code: draft.code.trim(), name: draft.name.trim(), method: draft.method, path: draft.path.trim(),
        });
        if (draft.fields.some((f) => f.name.trim())) await putApiSchema(created.api_id, draft.fields, created.version);
      }
      setDraft(null);
      message.success("接口已保存（未纳入版本）");
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "VERSION_CONFLICT" && draft.api_id) {
        // 不静默覆盖：保留我的改动，交给用户二选一
        setConflict({ body: rows.find((r) => r.api_id === draft.api_id)!, mine: draft });
      } else {
        message.error(err.message || "保存没成功。");
      }
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!delTarget) return;
    try {
      await deleteApi(delTarget.api_id);
      setDelTarget(null);
      message.success("已删除。此操作在下次生成版本后生效。");
      await load();
    } catch (e) {
      message.error((e as ApiError).message || "删除没成功。");
    }
  }

  async function onNewVersion() {
    try {
      const r = await createVersion(projectId);
      message.success(`已生成版本 v${r.seq}。`);
      await loadVersions();
    } catch (e) {
      message.error((e as ApiError).message || "生成版本没成功。");
    }
  }

  async function openDiff(v: VersionRow) {
    setDiffOf(v);
    try { const r = await fetchVersionDiff(v.version_id); setDiff(r.diff); } catch { setDiff([]); }
  }

  const columns: ColumnsType<ApiDef> = useMemo(() => [
    { title: "编号", dataIndex: "code", width: 160, render: (v: string) => <code>{v}</code> },
    { title: "名称", dataIndex: "name", ellipsis: true },
    { title: "方法", dataIndex: "method", width: 90, render: (v: string) => <Tag color={METHOD_COLOR[v]}>{v}</Tag> },
    { title: "路径", dataIndex: "path", width: 200, render: (v: string) => <code>{v}</code> },
    { title: "状态", dataIndex: "status", width: 100,
      render: (v: ApiStatus) => <Tag icon={STATUS_META[v].icon} color={STATUS_META[v].color}>{STATUS_META[v].text}</Tag> },
    { title: "最后更新", dataIndex: "updated_at", width: 130, render: (v: string) => `最后更新于 ${relTime(v)}` },
    { title: "操作", key: "op", width: 180, render: (_, row) => (
      <Space size={4}>
        <Button size="small" type="link" onClick={() => openEdit(row)}>编辑</Button>
        <Button size="small" type="link" onClick={() => openCopy(row)}>复制</Button>
        <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => setDelTarget(row)}>删除</Button>
      </Space>
    ) },
  ], [rows]);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Space style={{ marginBottom: 16 }} align="center">
        <Typography.Title className="ad-page-title">接口</Typography.Title>
        <Button onClick={() => nav(`/projects/${projectId}/workbench`)}>返回工作台</Button>
      </Space>

      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear style={{ width: 280 }} placeholder="搜索接口编号 / 名称 / 路径"
          value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <Select
          style={{ width: 120 }} value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: "", label: "全部" }, { value: "draft", label: "草稿" },
            { value: "effective", label: "生效" }, { value: "deprecated", label: "已废弃" },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>新建接口</Button>
      </Space>

      {loading && !rows.length ? (
        <Card><div style={{ display: "grid", placeItems: "center", height: 160 }}><Spin /><div style={{ marginTop: 12, fontSize: 13 }}>正在加载接口…</div></div></Card>
      ) : error ? (
        <Card><Empty description="接口清单没加载出来。"><Button onClick={() => void load()}>重试</Button></Empty></Card>
      ) : rows.length === 0 && !loading ? (
        filtered ? (
          <Card>
            <Empty description="没有符合筛选条件的接口。">
              <Button onClick={() => { setQ(""); setStatus(""); setPage(1); }}>清除筛选</Button>
            </Empty>
          </Card>
        ) : (
          <Card>
            <Empty description="还没有接口定义。"><Button type="primary" onClick={openNew}>新建接口</Button></Empty>
          </Card>
        )
      ) : (
        <Card size="small" styles={{ body: { padding: 0 } }}>
          <Table
            rowKey="api_id" size="small" columns={columns} dataSource={rows} loading={loading}
            pagination={{
              current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [20, 50, 100],
              onChange: (p, s) => { setPage(p); setPageSize(s); },
            }}
          />
        </Card>
      )}

      {/* 版本区 */}
      <Card
        size="small" style={{ marginTop: 16 }}
        title={<span style={{ fontSize: 13 }}>版本</span>}
        extra={<Button size="small" onClick={() => void onNewVersion()}>生成新版本</Button>}
      >
        {versions.length === 0 ? (
          <Empty description="还没有版本记录。" />
        ) : versions.map((v) => (
          <div key={v.version_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--ad-border-light)" }}>
            <span>v{v.seq} · {localTime(v.created_at)}</span>
            {v.status === "current" && <Tag color="blue">当前</Tag>}{v.status !== "current" && <Tag>{v.status === "superseded" ? "已被取代" : v.status === "rolled_back" ? "已回滚" : "已归档"}</Tag>}
            <div style={{ flex: 1 }} />
            <Button size="small" type="link" onClick={() => void openDiff(v)}>查看变更</Button>
          </div>
        ))}
      </Card>

      {/* 字段编辑抽屉 */}
      <Drawer
        width={560} open={!!draft} onClose={() => setDraft(null)}
        title={draft?.api_id ? "编辑接口" : "新建接口"}
        footer={
          <Space style={{ float: "right" }}>
            <Button onClick={() => setDraft(null)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void onSaveDraft()}>保存</Button>
          </Space>
        }
      >
        {draft && (
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <Typography.Text>编号</Typography.Text>
              <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="订单查询" />
            </div>
            <div>
              <Typography.Text>名称</Typography.Text>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="查询订单列表" />
            </div>
            <Space>
              <div>
                <Typography.Text>方法</Typography.Text>
                <Select
                  style={{ width: 120, display: "block" }} value={draft.method}
                  onChange={(v) => setDraft({ ...draft, method: v })}
                  options={["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => ({ value: m, label: m }))}
                />
              </div>
              <div style={{ minWidth: 260 }}>
                <Typography.Text>路径</Typography.Text>
                <Input value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} placeholder="/v1/orders" />
              </div>
            </Space>

            <div style={{ borderTop: "1px solid var(--ad-border)", paddingTop: 12 }}>
              <Space style={{ marginBottom: 8 }}>
                <Typography.Text strong>字段</Typography.Text>
                <Button size="small" icon={<PlusOutlined />}
                  onClick={() => setDraft({ ...draft, fields: [...draft.fields, emptyField()] })}>加一行</Button>
              </Space>
              {draft.fields.map((f, i) => (
                <div key={i} style={{ display: "grid", gap: 6, padding: "8px 0", borderBottom: "1px dashed var(--ad-border)" }}>
                  <Space>
                    <Input
                      style={{ width: 150 }} placeholder="字段名"
                      status={fieldErr[i] ? "error" : undefined}
                      value={f.name}
                      onChange={(e) => {
                        const fields = draft.fields.slice(); fields[i] = { ...f, name: e.target.value };
                        setDraft({ ...draft, fields });
                      }}
                    />
                    <Select
                      style={{ width: 130 }} value={f.field_type}
                      onChange={(v: FieldType) => {
                        const fields = draft.fields.slice(); fields[i] = { ...f, field_type: v };
                        setDraft({ ...draft, fields });
                      }}
                      options={FIELD_TYPES.map((t) => ({ value: t, label: t }))}
                    />
                    <Checkbox checked={f.required}
                      onChange={(e) => {
                        const fields = draft.fields.slice(); fields[i] = { ...f, required: e.target.checked };
                        setDraft({ ...draft, fields });
                      }}>必填</Checkbox>
                    <Button size="small" danger type="link"
                      onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, k) => k !== i) })}>删</Button>
                  </Space>
                  <Space>
                    <InputNumber style={{ width: 90 }} placeholder="长度" value={f.length}
                      onChange={(v) => { const fields = draft.fields.slice(); fields[i] = { ...f, length: v }; setDraft({ ...draft, fields }); }} />
                    <InputNumber style={{ width: 90 }} placeholder="精度" value={f.precision}
                      onChange={(v) => { const fields = draft.fields.slice(); fields[i] = { ...f, precision: v }; setDraft({ ...draft, fields }); }} />
                    <Input style={{ width: 90 }} placeholder="单位" value={f.unit}
                      onChange={(e) => { const fields = draft.fields.slice(); fields[i] = { ...f, unit: e.target.value }; setDraft({ ...draft, fields }); }} />
                    <Input style={{ width: 240, display: "block" }} placeholder="这个字段用来做什么" value={f.description}
                      onChange={(e) => { const fields = draft.fields.slice(); fields[i] = { ...f, description: e.target.value }; setDraft({ ...draft, fields }); }} />
                  </Space>
                  {fieldErr[i] && <Typography.Text type="danger" style={{ fontSize: 12 }}>{fieldErr[i]}</Typography.Text>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      {/* 删除二次确认 */}
      <Modal
        title={delTarget ? <>删除接口 <code>{delTarget.code}</code>？</> : "删除接口？"}
        open={!!delTarget} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
        onOk={() => void onDelete()} onCancel={() => setDelTarget(null)}
      >
        <p>引用它的 Spec 与验收标准会标记为“需复核”。此操作在下次生成版本后生效。</p>
      </Modal>

      {/* 并发冲突：不静默覆盖 */}
      <Modal
        title={<Space><ExclamationCircleOutlined style={{ color: "#faad14" }} />该接口已被他人修改。</Space>}
        open={!!conflict} width={720} footer={null} onCancel={() => setConflict(null)}
      >
        <p>你的改动没有被保存。请选择如何处置：</p>
        {conflict && (
          <div style={{ background: "var(--ad-bg-page)", border: "1px solid var(--ad-border)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div>对方版本：<code>{conflict.body.code}</code> · {conflict.body.name} · {conflict.body.method} {conflict.body.path}</div>
            <div>我的改动：<code>{conflict.mine.code}</code> · {conflict.mine.name} · {conflict.mine.method} {conflict.mine.path}</div>
          </div>
        )}
        <Space>
          <Button type="primary" onClick={() => {
            if (!conflict?.mine.api_id) return;
            void patchApi(conflict.mine.api_id, {
              code: conflict.mine.code, name: conflict.mine.name, method: conflict.mine.method, path: conflict.mine.path,
            }, conflict.body.version)
              .then(async (r) => { await putApiSchema(r.api_id, conflict.mine.fields, r.version); message.success("已以我的为准。"); setConflict(null); await load(); })
              .catch((e) => message.error((e as ApiError).message || "保存没成功。"));
          }}>以我的为准</Button>
          <Button onClick={() => { setConflict(null); message.info("已放弃我的改动。"); }}>放弃我的改动</Button>
        </Space>
      </Modal>

      {/* 版本 diff */}
      <Drawer width={720} open={!!diffOf} onClose={() => setDiffOf(null)} title={diffOf ? `v${diffOf.seq} 的变更` : "变更"}>
        {diff.length === 0 ? <Empty description="这个版本没有变更。" /> : diff.map((d, i) => (
          <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--ad-border-light)" }}>
            <Space>
              <Tag color={d.change === "新增" ? "green" : d.change === "删除" ? "red" : "orange"}>{d.change}</Tag>
              <code>{d.path}</code>
            </Space>
            <div style={{ fontSize: 12, color: "var(--ad-text-secondary)", marginTop: 4 }}>
              <div>变更前：{d.left}</div>
              <div>变更后：{d.right}</div>
            </div>
          </div>
        ))}
      </Drawer>
    </div>
  );
}
