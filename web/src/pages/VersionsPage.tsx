import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert, App as AntApp, Button, Card, Empty, Modal, Space, Spin, Tag, Tooltip, Typography,
} from "antd";
import { DownloadOutlined, RollbackOutlined, WarningOutlined } from "@ant-design/icons";
import {
  listVersions, fetchVersionDiff, rollbackVersion, exportDeliverables,
  VERSION_ARTIFACTS, VERSION_ARTIFACT_LABEL, createVersion,
  type VersionDiffRow, type VersionRow,
} from "@/store/session";
import { ApiError, IS_MOCK } from "@/api/client";
import { track } from "@/track";

/**
 * `UI-VER-001` 版本归档页（终点页）。
 *
 * ⚠️ **界面不得出现任何「平台编译 / 打包 / 构建中」的按钮或文案**（`REQ-GEN-009`）：本页只到「下载工程源码」。
 *
 * 硬约束（逐条对着 `UI-Spec §4.13`）：
 *  - 「当前」是**文字标记**，不只靠颜色（`REQ-DELIVER-002`）；
 *  - 回滚 = **最高风险破坏性操作**：二次确认弹窗**必须**说明「正在编辑的内容会丢失」；
 *  - 回滚**整包**恢复（Spec / 接口定义 / 能力配置 / 安卓代码 / 埋点方案），**要么全成要么全不成**；
 *  - 失败时**当前版本未变更**，文案不得含糊。
 */

/** 版本状态用**文字**（不只靠颜色） */
const STATUS_TEXT: Record<string, string> = {
  current: "当前", superseded: "已被取代", rolled_back: "已回滚", archived: "已归档",
};
const STATUS_COLOR: Record<string, string> = {
  current: "blue", superseded: "default", rolled_back: "orange", archived: "default",
};
const CHANGE_COLOR: Record<string, string> = { 新增: "green", 删除: "red", 修改: "orange" };

/** 把 base64 的 ZIP 落成本地文件（**平台不做服务端构建**，这里只是下载归档包） */
function downloadBase64(filename: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function localTime(iso: string | null): string {
  if (!iso) return "时间未知";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "时间未知" : t.toLocaleString("zh-CN");
}

export default function VersionsPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const { message } = AntApp.useApp();

  const [rows, setRows] = useState<VersionRow[]>([]);
  const [sel, setSel] = useState<VersionRow | null>(null);
  const [diff, setDiff] = useState<VersionDiffRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const [rollbackTarget, setRollbackTarget] = useState<VersionRow | null>(null);
  const [rolling, setRolling] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<{ ok: boolean; seq?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await listVersions(projectId);
      setRows(r.items);
      setSel((s) => (s ? r.items.find((x) => x.version_id === s.version_id) ?? r.items[0] ?? null : r.items[0] ?? null));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!sel) { setDiff([]); return; }
    void fetchVersionDiff(sel.version_id).then((r) => setDiff(r.diff)).catch(() => setDiff([]));
  }, [sel]);

  async function doRollback() {
    if (!rollbackTarget) return;
    setRolling(true); setRollbackResult(null);
    try {
      const fromSeq = rows.find((v) => v.status === "current")?.seq ?? null;
      await rollbackVersion(rollbackTarget.version_id);
      setRollbackResult({ ok: true, seq: rollbackTarget.seq });
      setRollbackTarget(null);
      await load();
      // `EVT_version_rolled_back`：整包回滚结束（成功分支）；以「目标版本」去重
      track("EVT_version_rolled_back", {
        result: "succeeded", target_version_seq: rollbackTarget.seq, from_version_seq: fromSeq,
      }, { dedupKey: `rollback:${rollbackTarget.version_id}`, immediate: true });
    } catch {
      setRollbackResult({ ok: false, seq: rollbackTarget.seq });
      track("EVT_version_rolled_back", {
        result: "failed", target_version_seq: rollbackTarget.seq,
      }, { dedupKey: `rollback:${rollbackTarget.version_id}:failed`, immediate: true });
      setRollbackTarget(null);
    } finally {
      setRolling(false);
    }
  }

  /** `#61` 打包导出（**需鉴权**）：真实 ZIP，含 5 份 Spec + 安卓源码 + 埋点 + 接口定义 + README */
  async function onExport(kind: "spec" | "android") {
    // Mock 演示模式没有真实产物：**明确说明**，不产出空包冒充交付物
    if (IS_MOCK) { message.info("Mock 演示模式：导出需要连真实后端。"); return; }
    try {
      const r = await exportDeliverables(projectId);
      downloadBase64(r.filename, r.base64);
      message.success(kind === "spec"
        ? "Spec 包已导出。"
        : `已导出 ${r.filename}（${r.entry_count} 个文件）。包内为源码，需在你本机用 Gradle 构建。`);
      // 漏斗节点 9：交付归档完成 / 导出成功后
      track("EVT_deliver_done", {
        kind, project_id: projectId,
        version_seq: sel?.seq ?? rows.find((v) => v.status === "current")?.seq ?? null,
        entry_count: r.entry_count,
      }, { dedupKey: `deliver:${kind}:${sel?.version_id ?? ""}`, immediate: true });
    } catch (e) {
      message.error((e as ApiError).message || "导出失败了。");
    }
  }

  async function onNewVersion() {
    try {
      const r = await createVersion(projectId);
      message.success(`已生成版本 v${r.seq}。`);
      await load();
    } catch (e) {
      message.error((e as ApiError).message || "生成版本没成功。");
    }
  }

  if (loading) {
    return <Card><div style={{ display: "grid", placeItems: "center", height: 200 }}><Spin /><div style={{ marginTop: 12 }}>正在加载版本历史…</div></div></Card>;
  }
  if (error) {
    return <Card><Empty description="版本历史没加载出来。"><Button onClick={() => void load()}>重试</Button></Empty></Card>;
  }
  if (rows.length === 0) {
    return (
      <Card>
        <Empty description="还没有版本记录。">
          <Button type="primary" onClick={() => nav(`/projects/${projectId}/apis`)}>生成第一个版本</Button>
        </Empty>
      </Card>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Space style={{ marginBottom: 16 }} align="center">
        <Typography.Title className="ad-page-title">版本与交付</Typography.Title>
        <Button onClick={() => nav(`/projects/${projectId}/workbench`)}>返回工作台</Button>
        {rows.length > 0 && <Button onClick={() => void onNewVersion()}>打新版本</Button>}
      </Space>

      {rollbackResult?.ok && (
        <Alert
          style={{ marginBottom: 12 }} type="success" showIcon
          message={`已回滚到 v${rollbackResult.seq}。`}
          action={<Button size="small" onClick={() => setSel(rows.find((r) => r.status === "current") ?? rows[0])}>查看当前版本</Button>}
        />
      )}
      {rollbackResult && !rollbackResult.ok && (
        <Alert
          style={{ marginBottom: 12 }} type="error" showIcon
          message="回滚没完成，当前版本未变更。"
          action={<Button size="small" onClick={() => { const t = rows.find((r) => r.seq === rollbackResult.seq); if (t) setRollbackTarget(t); else void load(); }}>重试</Button>}
        />
      )}
      {rolling && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="正在回滚…" />
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* 时间线 */}
        <Card size="small" style={{ width: 240, flexShrink: 0 }} styles={{ body: { padding: 8 } }}>
          {rows.map((v) => (
            <div
              key={v.version_id}
              onClick={() => setSel(v)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 4, cursor: "pointer",
                borderLeft: sel?.version_id === v.version_id ? "4px solid var(--ad-primary)" : "4px solid transparent",
                background: sel?.version_id === v.version_id ? "var(--ad-primary-bg)" : undefined,
                fontWeight: sel?.version_id === v.version_id ? 600 : 400,
                marginBottom: 4,
              }}
            >
              <span>v{v.seq}</span>
              <Tag color={STATUS_COLOR[v.status]}>{STATUS_TEXT[v.status] ?? v.status}</Tag>
            </div>
          ))}
        </Card>

        {/* 版本卡片 + diff */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {sel && (
            <Card
              size="small"
              title={<span>v{sel.seq}</span>}
              extra={<Space>
                <Tooltip title="本地构建结果尚未回传；不影响你继续使用。">
                  <Tag icon={<WarningOutlined />}>未验证构建</Tag>
                </Tooltip>
              </Space>}
            >
              <Space size={12} wrap>
                <Typography.Text type="secondary">时间：{localTime(sel.created_at)}</Typography.Text>
                <Typography.Text type="secondary">操作人：{sel.created_by_name || "未命名用户"}</Typography.Text>
              </Space>
              <Typography.Paragraph style={{ margin: "8px 0" }}>{sel.summary}</Typography.Paragraph>

              <div style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>产物：</Typography.Text>
                <Space size={4} wrap style={{ marginLeft: 4 }}>
                  {VERSION_ARTIFACTS.map((k) => (
                    <Tag key={k}>{sel.artifacts.includes(k) ? VERSION_ARTIFACT_LABEL[k] : `${VERSION_ARTIFACT_LABEL[k]}（未包含）`}</Tag>
                  ))}
                </Space>
              </div>

              <Space wrap>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => void onExport("android")}>下载工程源码</Button>
                <Button size="small" onClick={() => message.info("依赖版本锁定清单：gradle wrapper + dependencies.lock.json，随导出包一并提供。")}>依赖版本锁定清单</Button>
                <Button size="small" onClick={() => void onExport("spec")}>导出 Spec 包</Button>
                <Button
                  size="small" danger icon={<RollbackOutlined />}
                  disabled={sel.status === "current" || rolling}
                  onClick={() => setRollbackTarget(sel)}
                >回滚到此版本</Button>
              </Space>

              <div style={{ marginTop: 16, borderTop: "1px solid var(--ad-border)", paddingTop: 12 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>变更对照</Typography.Text>
                {diff.length === 0 ? <Empty style={{ marginTop: 8 }} description="这个版本没有变更。" /> : (
                  <div style={{ marginTop: 8, border: "1px solid var(--ad-border)", borderRadius: 8, overflow: "hidden" }}>
                    {diff.map((d, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", borderBottom: i === diff.length - 1 ? undefined : "1px solid var(--ad-border-light)" }}>
                        <Tag color={CHANGE_COLOR[d.change] ?? "orange"}>{d.change}</Tag>
                        <code style={{ flex: "0 0 240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.path}</code>
                        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                          <div style={{ background: "var(--ad-danger-bg)", padding: "2px 6px", borderRadius: 4 }}>{d.left}</div>
                          <div style={{ background: "var(--ad-success-bg)", padding: "2px 6px", borderRadius: 4 }}>{d.right}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* 回滚二次确认（最高风险破坏性操作） */}
      <Modal
        title={rollbackTarget ? `回滚到 v${rollbackTarget.seq}？` : "确认回滚？"}
        open={!!rollbackTarget} okText="确认回滚" cancelText="取消"
        okButtonProps={{ danger: true, loading: rolling }}
        onOk={() => void doRollback()} onCancel={() => setRollbackTarget(null)}
      >
        <p>
          会把这些产物整体恢复到该版本：Spec、接口定义、能力配置、已生成的安卓代码、埋点方案。
          <b>当前版本会归档保留，但正在编辑的内容会丢失。</b>
        </p>
      </Modal>
    </div>
  );
}
