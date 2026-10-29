import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Button, Card, Empty, Popconfirm, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { ImportOutlined, RollbackOutlined } from "@ant-design/icons";
import { ApiError } from "@/api/client";
import { fetchProject, listPatchApplications, listProjectTasks, writebackGeneration, rollbackPatchApplication } from "@/store/session";
import { track } from "@/track";

/**
 * 二期 · 「写回既有工程」（brownfield）面板 —— `F18` / `REQ-PATCH-001`。
 *
 * 位置：工作台左栏编辑器下方（**不新增路由**，13 路由不变）。
 * 仅当项目 `source_kind='imported'`（已通过 `#73` 接入）时渲染。
 * 行为：取**最近一次成功的代码生成任务**的产物 → 服务端按既有工程结构合并 → 写回登记工程根；
 *       并列出**补丁记录**（可一键回滚）。
 */

interface PatchItem {
  patch_id: string; status: string; message: string; created_at: string; rolled_back_at: string | null;
  totals: { create: number; replace: number; unchanged: number; bytes: number };
  files: string[];
}

function relTime(iso: string): string {
  if (!iso) return "时间未知";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return "时间未知";
  const min = Math.floor((Date.now() - t) / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export default function PatchWriteback({ projectId }: { projectId: string }) {
  const { message } = AntApp.useApp();
  const [imported, setImported] = useState(false);
  const [root, setRoot] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [patches, setPatches] = useState<PatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await fetchProject(projectId);
      const isImported = (p.source_kind ?? "new") === "imported";
      setImported(isImported);
      setRoot(p.engineering_root ?? null);
      if (!isImported) return;
      const [tasks, ps] = await Promise.all([
        listProjectTasks(projectId).catch(() => ({ items: [] })),
        listPatchApplications(projectId).catch(() => ({ items: [], total: 0 })),
      ]);
      const latest = [...tasks.items].filter((t) => t.type === "code_gen" && t.status === "succeeded")
        .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0];
      setTaskId(latest?.task_id ?? null);
      setPatches(ps.items as PatchItem[]);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function doWriteback() {
    if (!taskId) return;
    setBusy(true);
    try {
      const r = await writebackGeneration(projectId, taskId);
      const skippedN = r.skipped?.length ?? 0;
      message.success(`已写回工程：新增 ${r.totals.create} 个、替换 ${r.totals.replace} 个文件。`);
      track("EVT_patch_writeback_done", {
        project_id: projectId, patch_id: r.patch_id,
        create_count: r.totals.create, replace_count: r.totals.replace, skipped_count: skippedN,
      }, { dedupKey: r.patch_id, immediate: true });
      void load();
    } catch (e) {
      const err = e as ApiError;
      message.error(err.message || "写回没成功。");
      track("EVT_patch_writeback_failed", { project_id: projectId, error_code: err.code || "INTERNAL" },
        { dedupWindowMs: 1000, immediate: true });
    } finally { setBusy(false); }
  }

  async function doRollback(patchId: string) {
    try {
      const r = await rollbackPatchApplication(projectId, patchId);
      message.success(`已回滚：还原 ${r.restored} 个、删除 ${r.removed} 个文件。`);
      void load();
    } catch (e) {
      message.error((e as ApiError).message || "回滚没成功。");
    }
  }

  if (!imported) return null;

  return (
    <Card
      size="small"
      style={{ marginTop: 12 }}
      title={<Space size={8}><ImportOutlined /><span style={{ fontSize: 13 }}>写回既有工程（brownfield）</span></Space>}
      extra={root ? <Tooltip title={root}><Typography.Text type="secondary" style={{ fontSize: 12 }}>工程目录已接入</Typography.Text></Tooltip> : null}
    >
      {loading ? (
        <div style={{ display: "grid", placeItems: "center", height: 60 }}><Spin /></div>
      ) : (
        <>
          <Space size={8} wrap>
            <Button
              type="primary" size="small" icon={<ImportOutlined />}
              disabled={!taskId} loading={busy} onClick={() => void doWriteback()}
            >
              写回工程
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {taskId
                ? "把最近一次生成的结果按你工程的结构合并后写回（新增 / 定点插入，既有内容不动；冲突会整批拒绝）。"
                : "还没有生成过代码。先在左侧编辑区生成并验证通过，再写回。"}
            </Typography.Text>
          </Space>

          <div style={{ marginTop: 10 }}>
            {patches.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: 12 }}>还没有写回记录。</span>} />
            ) : (
              patches.slice(0, 5).map((p) => (
                <div key={p.patch_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid var(--ad-border)" }}>
                  <Tag color={p.status === "applied" ? "blue" : "default"} style={{ marginInlineEnd: 0 }}>
                    {p.status === "applied" ? "已写回" : "已回滚"}
                  </Tag>
                  <Typography.Text style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
                    新增 {p.totals.create} ｜ 替换 {p.totals.replace} ｜ {relTime(p.created_at)}
                  </Typography.Text>
                  {p.status === "applied" && (
                    <Popconfirm
                      title="回滚这次写回？"
                      description="替换过的文件会还原、新建的文件会删除。"
                      okText="回滚" cancelText="取消"
                      onConfirm={() => void doRollback(p.patch_id)}
                    >
                      <Button size="small" danger icon={<RollbackOutlined />}>回滚</Button>
                    </Popconfirm>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Card>
  );
}
