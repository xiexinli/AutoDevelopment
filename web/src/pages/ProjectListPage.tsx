import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  App as AntApp, Button, Card, Empty, Form, Input, Modal, Pagination, Popconfirm,
  Select, Skeleton, Space, Tag, Typography,
} from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { createProject, deleteProject, listProjects, patchProject, type ProjectListItem } from "@/store/session";
import { ApiError } from "@/api/client";
import { stageMeta } from "@/domain/stage";
import { track } from "@/track";
import { setPendingWorkbenchEntry } from "@/track/pending";

/**
 * `UI-PROJ-001` 项目列表 / 新建 —— 登录后默认落地页。
 * 文案逐字取自 `UI-Spec §4.2` ⑦ 文案字样（**不得改写**）。
 * 三态齐备：加载中（骨架 ×4，无 shimmer）/ 空（零项目 vs 搜索无结果 **两个不同视图**）/ 错误。
 */

/** 相对时间：`最后更新于 X`；**缺失时显示 `时间未知`**（不得显示 1970） */
function relTime(iso?: string): string {
  if (!iso) return "时间未知";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return "时间未知";
  const d = Date.now() - t;
  const min = Math.floor(d / 60_000);
  if (min < 1) return "最后更新于 刚刚";
  if (min < 60) return `最后更新于 ${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `最后更新于 ${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 30) return `最后更新于 ${day} 天前`;
  return `最后更新于 ${new Date(iso).toLocaleDateString("zh-CN")}`;
}

export default function ProjectListPage() {
  const nav = useNavigate();
  const { message } = AntApp.useApp();

  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState("updated_at:desc");
  const [q, setQ] = useState("");
  const [kw, setKw] = useState(""); // 已提交的关键词

  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [form] = Form.useForm<{ name: string; description?: string }>();
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setElapsed(0);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    try {
      const r = await listProjects({ q: kw || undefined, page, page_size: pageSize, sort });
      setItems(r.items); setTotal(r.total);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, [kw, page, pageSize, sort]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const isNoMatch = !!kw && !loading && !error && items.length === 0;
  const isZero = !kw && !loading && !error && items.length === 0;

  // ---------- 动作 ----------
  async function onCreate() {
    const v = await form.validateFields();
    setCreating(true);
    const startedAt = Date.now();
    try {
      const created = await createProject(v.name.trim(), (v.description ?? "").trim());
      message.success("项目已创建。");
      setCreateOpen(false); form.resetFields();
      setPage(1); void load();
      // 漏斗节点 1：**创建接口成功且项目已出现在列表中之后**；只报项目名长度、不报文本
      track("EVT_proj_create_success", {
        project_id: created.project_id, stage: created.stage,
        name_visible_chars: [...v.name.trim()].length,
        duration_ms: Date.now() - startedAt,
      }, { dedupKey: created.project_id, immediate: true });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "INVALID_ARGUMENT") {
        form.setFields([{ name: "name", errors: [err.message || "项目名不能为空，长度 1~50。"] }]);
        // 被校验拦截（错误文案渲染之后）；不含用户输入内容
        track("EVT_proj_create_blocked", { code: err.code, field: "name" }, { dedupKey: `create_blocked:${Date.now()}`, immediate: true });
      } else {
        message.error(err.message || "项目没创建成功。");
      }
    } finally {
      setCreating(false);
    }
  }

  async function doRename(row: ProjectListItem) {
    const nm = renameVal.trim();
    if (!nm) { message.error("项目名不能为空，长度 1~50。"); return; }
    try {
      await patchProject(row.project_id, { name: nm }, row.version);
      setRenaming(null); message.success("名称已更新。"); void load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "VERSION_CONFLICT") message.warning("该内容已被他人修改。");
      else message.error(err.message || "重命名没成功。");
    }
  }

  async function doDelete(row: ProjectListItem) {
    try {
      await deleteProject(row.project_id);
      message.success("项目已删除，30 天后彻底清除。");
      void load();
      // 确认后 #5 成功、卡片移除、Toast 渲染之后；同一 project_id 只 1 条
      track("EVT_proj_deleted", { project_id: row.project_id }, { dedupKey: row.project_id, immediate: true });
    } catch (e) {
      message.error((e as ApiError).message || "删除没成功。");
    }
  }

  // ---------- 渲染 ----------
  return (
    <div className="ad-page">
      {/* EL-PROJ-001 顶部栏 */}
      <div className="ad-page-head">
        <Typography.Title className="ad-page-title">项目</Typography.Title>

        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索项目名"
          value={q}
          style={{ width: 260 }}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={() => { setKw(q.trim()); setPage(1); }}
        />

        <Select
          value={sort} style={{ width: 130 }}
          onChange={(v) => { setSort(v); setPage(1); }}
          options={[
            { value: "updated_at:desc", label: "最近更新" },
            { value: "created_at:desc", label: "创建时间" },
            { value: "name:asc", label: "名称" },
          ]}
        />

        <Select
          value={pageSize} style={{ width: 96 }}
          onChange={(v) => { setPageSize(v); setPage(1); }}
          options={[{ value: 20, label: "20" }, { value: 50, label: "50" }, { value: 100, label: "100" }]}
        />

        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { track("EVT_proj_create_click", { entry: "header" }, { dedupWindowMs: 300 }); setCreateOpen(true); }}>新建项目</Button>
      </div>

      {/* 空白 / 加载中 / 错误 */}
      {loading && (
        <div>
          <div className="ad-card-grid">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} size="small"><Skeleton active paragraph={{ rows: 2 }} title={false} /></Card>
            ))}
          </div>
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            正在加载项目…{elapsed > 3 ? `还在加载，已用 ${elapsed} 秒…` : ""}
          </Typography.Text>
        </div>
      )}

      {!loading && error && (
        <Card>
          <Empty
            description={
              <div>
                <div style={{ marginBottom: 4 }}>
                  {error.code === "FORBIDDEN" ? "你没有权限查看这些项目。" : "项目列表没加载出来。"}
                </div>
                {error.code !== "FORBIDDEN" && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    原因：服务暂时不可用（{error.code}）。
                  </Typography.Text>
                )}
              </div>
            }
          >
            <Space>
              <Button onClick={() => void load()}>重试</Button>
              {error.code === "FORBIDDEN" && <Button type="link" onClick={() => nav(-1)}>返回</Button>}
            </Space>
          </Empty>
        </Card>
      )}

      {!loading && !error && isZero && (
        <Card>
          <Empty
            description={
              <div>
                <div style={{ marginBottom: 4 }}>还没有项目</div>
                <Typography.Text type="secondary">
                  新建一个项目，把 PRD 丢进来，平台会把它补到可开发。
                </Typography.Text>
              </div>
            }
          >
            <Button type="primary" href="#" onClick={(e) => { e.preventDefault(); track("EVT_proj_create_click", { entry: "empty_state" }, { dedupWindowMs: 300 }); setCreateOpen(true); }}>
              新建项目
            </Button>
          </Empty>
        </Card>
      )}

      {!loading && !error && isNoMatch && (
        <Card>
          <Empty description={`没有匹配「${kw}」的项目。`}>
            <Button onClick={() => { setKw(""); setQ(""); setPage(1); }}>清除搜索</Button>
          </Empty>
        </Card>
      )}

      {!loading && !error && !isZero && !isNoMatch && (
        <>
          <div className="ad-card-grid">
            {items.map((p) => {
              const st = stageMeta(p.stage);
              const renamingThis = renaming === p.project_id;
              return (
                <Card
                  key={p.project_id}
                  size="small"
                  title={
                    renamingThis ? (
                      <Input
                        size="small" autoFocus value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onPressEnter={() => void doRename(p)}
                        onBlur={() => setRenaming(null)}
                      />
                    ) : (
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                    )
                  }
                  extra={<Tag color={st.color}>{st.text}</Tag>}
                  actions={[
                    <Button key="enter" type="primary" size="small" onClick={() => { setPendingWorkbenchEntry({ project_id: p.project_id, from_entry: "enter_button" }); nav(`/projects/${p.project_id}/workbench`); }}>进入</Button>,
                    <Button key="kb" size="small" onClick={() => nav(`/projects/${p.project_id}/kb`)}>知识库</Button>,
                    <Button key="rn" size="small" onClick={() => { setRenaming(p.project_id); setRenameVal(p.name); }}>重命名</Button>,
                    <Popconfirm
                      key="del" title="删除项目？" description="删除后 30 天内可恢复，之后彻底清除。"
                      okText="确定" cancelText="取消" onConfirm={() => void doDelete(p)}
                    >
                      <Button size="small" danger>删除</Button>
                    </Popconfirm>,
                  ]}
                >
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {relTime(p.updated_at)}
                  </Typography.Text>
                </Card>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 20 }}>
            <Pagination
              current={page} pageSize={pageSize} total={total}
              showSizeChanger={false}
              onChange={(p) => setPage(p)}
            />
            <Typography.Text type="secondary">
              第 {page} / {totalPages} 页，共 {total} 个项目
            </Typography.Text>
          </div>
        </>
      )}

      {/* EL-PROJ-036 新建项目弹窗 */}
      <Modal
        title="新建项目" open={createOpen} confirmLoading={creating}
        okText="确定" cancelText="取消"
        onOk={() => void onCreate()} onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="name" label="项目名"
            rules={[{ required: true, message: "项目名不能为空，长度 1~50。" }]}
          >
            <Input maxLength={50} placeholder="给项目起个名字，1~50 个字" showCount />
          </Form.Item>
          <Form.Item name="description" label="说明（选填）">
            <Input.TextArea rows={3} maxLength={200} placeholder="一句话说明这个项目要做什么" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
