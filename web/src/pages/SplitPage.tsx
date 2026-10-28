import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert, App as AntApp, Button, Card, Collapse, Drawer, Empty, Modal, Space, Spin,
  Table, Tag, Typography,
} from "antd";
import {
  fetchRequirements, fetchTraceability, fetchTrackingPlan, triggerSplit, fetchTask, fetchProject,
  type RolePack,
} from "@/store/session";
import { ApiError } from "@/api/client";
import { track } from "@/track";

/**
 * `UI-SPLIT-001` 需求拆解页 —— 文案逐字取自 `UI-Spec §4.7 ④ 文案字样`。
 * 关键约束：
 *  - **拆解深度由审核等级映射**（2026-10-28 分级定稿，R-18）：本页只展示、不再由前端指定；
 *  - 覆盖状态四态**必须用文字**（已覆盖 / 有缺口 / 不适用 / 延后），不只靠颜色；
 *  - 重新拆解 = 二次确认；同项目同时刻只允许一个拆解任务（重复触发 409「上一次拆解还没结束。」）；
 *  - 埋点方案**只展示与跳转**，不在此处配置。
 */

/** 拆解深度 → 展示名（由审核等级映射而来：简审→minimal / 标准→standard / 严格→comprehensive） */
const DEPTH_LABEL: Record<string, string> = {
  minimal: "Minimal（最小）", standard: "Standard（标准）", comprehensive: "Comprehensive（全面）",
};
/** 审核等级 → 展示名 + 映射说明 */
const LEVEL_INFO: Record<string, { label: string; note: string }> = {
  quick: { label: "简审", note: "简审 → Minimal：只出受影响角色的 Spec。" },
  standard: { label: "标准", note: "标准 → Standard：全表检查。" },
  strict: { label: "严格", note: "严格 → Comprehensive：全表 + 强制角落全景 + 人工复核 + 安全合规小节。" },
};

/** 四态由接口给出（`OK`｜`GAP`｜`N/A`｜`Deferred`），前端只渲染文字 */
const COVERAGE: Record<string, { text: string; color: string }> = {
  OK: { text: "已覆盖", color: "success" },
  GAP: { text: "有缺口", color: "warning" },
  "N/A": { text: "不适用", color: "default" },
  Deferred: { text: "延后", color: "processing" },
};

export default function SplitPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const { message, modal } = AntApp.useApp();

  const [depth, setDepth] = useState<"minimal" | "standard" | "comprehensive">("standard");
  const [level, setLevel] = useState<"quick" | "standard" | "strict">("standard");
  const [packs, setPacks] = useState<RolePack[]>([]);
  const [total, setTotal] = useState(0);
  const [tracking, setTracking] = useState<{ event_key: string; trigger_desc: string; params: string[]; element_id: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [trace, setTrace] = useState<{ req_id: string; summary: string; targets: Record<string, string>; coverage_status: string; orphan: boolean }[]>([]);
  const [trackOpen, setTrackOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // 等级独立取（取不到不影响需求包展示）
      fetchProject(projectId).then((p) => setLevel(p.review_level ?? "standard")).catch(() => undefined);
      const r = await fetchRequirements(projectId);
      setPacks(r.items); setTotal(r.requirement_count); setDepth(r.depth as typeof depth);
    } catch (e) {
      // 还没有需求包 → 空态（不是错误）
      const err = e as ApiError;
      if (err.code === "NOT_FOUND") { setPacks([]); }
      else setError(err);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const note = useMemo(() => LEVEL_INFO[level]?.note ?? "", [level]);

  async function doSplit(confirmed = false) {
    if (splitting) return;
    setSplitting(true);
    const startedAt = Date.now();
    try {
      const submitted = await triggerSplit(projectId);
      if (confirmed) message.success("已提交重新拆解。");
      // `EVT_split_start`：拆解任务已入队（`#28` 202 之后）
      track("EVT_split_start", { trigger: confirmed ? "re_split" : "first_run", depth_ui: depth },
        { dedupKey: submitted.task_id, immediate: true });
      let finished = false;
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const task = await fetchTask(submitted.task_id);
        if (task.status === "succeeded") {
          const r = await fetchRequirements(projectId);
          setPacks(r.items); setTotal(r.requirement_count);
          message.success(`拆解完成，共 ${r.requirement_count} 条需求。`); finished = true;
          // 漏斗节点 4：拆解成功、5 个角色包落库后
          const packs = r.items as { role?: string; req_ids?: unknown[] }[];
          track("EVT_split_done", {
            task_id: submitted.task_id,
            roles: packs.map((p) => p.role).filter(Boolean),
            req_total: r.requirement_count,
            per_role_counts: packs.map((p) => (Array.isArray(p.req_ids) ? p.req_ids.length : 0)),
            empty_role_count: packs.filter((p) => !Array.isArray(p.req_ids) || p.req_ids.length === 0).length,
            duration_ms: i * 1000,
          }, { dedupKey: submitted.task_id, immediate: true });
          break;
        }
        if (["failed", "timeout", "canceled"].includes(task.status)) throw new Error(`拆解未完成（${task.error_code ?? task.status}）。`);
      }
      if (!finished) throw new Error("拆解等待超时，请稍后刷新查看任务状态。");
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) message.warning("上一次拆解还没结束。");
      else if (err.code === "UPSTREAM_UNAVAILABLE") message.error("服务暂时不可用（UPSTREAM_UNAVAILABLE）。");
      else message.error(err.message || "拆解失败了。");
      // `EVT_split_failed`（旁路）：仅失败 / 超时上报（**409 冲突不算失败**，它没产生新任务）
      if (err.status !== 409) {
        track("EVT_split_failed", {
          status: err.code === "UPSTREAM_TIMEOUT" || /超时/.test(err.message ?? "") ? "timeout" : "failed",
          error_code: err.code ?? "INTERNAL", duration_ms: Date.now() - startedAt,
        }, { dedupKey: `split_failed:${startedAt}`, immediate: true });
      }
    } finally { setSplitting(false); }
  }

  async function openTrace() {
    setTraceOpen(true);
    try {
      const r = await fetchTraceability(projectId);
      setTrace(r.items);
    } catch (e) { message.error((e as ApiError).message || "追溯矩阵没加载出来。"); }
  }

  if (loading) {
    return <Card style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ textAlign: "center", padding: 40 }}><Spin /><div style={{ marginTop: 12 }}>正在按角色拆分需求…</div></div>
    </Card>;
  }

  if (error) {
    return <Card style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Empty description="拆解失败了。"><Button onClick={() => void load()}>重试</Button></Empty>
    </Card>;
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <Typography.Title className="ad-page-title">需求拆解</Typography.Title>
        <Button onClick={() => nav(`/projects/${projectId}/workbench`)}>返回工作台</Button>
        <Button onClick={openTrace}>追溯矩阵</Button>
        <div style={{ flex: 1 }} />
        <Button disabled={splitting} onClick={() => modal.confirm({
          title: "重新拆解？",
          content: "已生成的 5 份 Spec 会归档为历史版本（不删除），当前版本会被新结果替换。",
          okText: "重新拆解", cancelText: "取消",
          onOk: () => doSplit(true),
        })}>重新拆解</Button>
      </div>

      {splitting && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="上一次拆解还没结束。" description="同一项目同一时刻只允许一个拆解任务。" />}

      {/* 拆解深度：**由审核等级映射**，本页只读展示（同屏给出映射说明） */}
      <Card style={{ marginBottom: 12 }}>
        <Space wrap align="center" size={12}>
          <Typography.Text strong>拆解深度</Typography.Text>
          <Tag color="blue">{DEPTH_LABEL[depth] ?? depth}</Tag>
          <Typography.Text type="secondary">
            由审核等级「{LEVEL_INFO[level]?.label ?? level}」映射，不在此处单独设置。
          </Typography.Text>
        </Space>
        <div style={{ marginTop: 10, color: "rgba(0,0,0,0.65)" }}>{note}</div>
        {depth === "minimal" && (
          <Tag style={{ marginTop: 8 }}>简审放行：只出受影响角色的 Spec</Tag>
        )}
      </Card>

      {/* 角色需求包 */}
      {packs.length === 0 ? (
        <Card>
          <Empty description="还没有需求包。">
            <Button type="primary" loading={splitting} onClick={() => void doSplit()}>开始拆解</Button>
          </Empty>
        </Card>
      ) : (
        <>
          <Card title={`角色需求包（共 ${total} 条 REQ-ID）`} style={{ marginBottom: 12 }}>
            <Collapse
              defaultActiveKey={packs.map((p) => p.role)}
              items={packs.map((p) => ({
                key: p.role,
                label: `${p.role}（${p.reqs.length}）`,
                children: p.reqs.length === 0 ? (
                  <Empty description="这一角色没有拆出需求。">
                    <Button onClick={() => nav(`/projects/${projectId}/workbench`)}>回到对话补充</Button>
                  </Empty>
                ) : (
                  <Space wrap size={[6, 6]}>
                    {p.reqs.map((r) => <Tag key={r} style={{ fontFamily: "monospace" }}>{r}</Tag>)}
                  </Space>
                ),
              }))}
            />
          </Card>

          {/* 埋点方案摘要（只展示与跳转，不在此配置） */}
          <Card
            title="埋点方案"
            extra={<Button size="small" onClick={async () => {
              setTrackOpen(true);
              try { const r = await fetchTrackingPlan(projectId); setTracking(r.items); }
              catch (e) { message.error((e as ApiError).message || "埋点方案没加载出来。"); }
            }}>查看</Button>}
          >
            <Typography.Text type="secondary">
              埋点方案在需求阶段定义、在安卓开发阶段写入代码；本页只展示与跳转，不在此处配置。
            </Typography.Text>
          </Card>
        </>
      )}

      {/* 追溯矩阵抽屉：四态必须用文字 */}
      <Drawer title="追溯矩阵" width={860} open={traceOpen} onClose={() => setTraceOpen(false)}>
        <Table
          size="small" rowKey="req_id" pagination={false} dataSource={trace}
          columns={[
            { title: "REQ-ID", dataIndex: "req_id", width: 160, render: (v: string) => <code>{v}</code> },
            { title: "需求摘要", dataIndex: "summary" },
            { title: "UI", dataIndex: ["targets", "ui"], width: 120, ellipsis: true },
            { title: "接口 / 路由", dataIndex: ["targets", "api"], width: 170, ellipsis: true },
            { title: "App", dataIndex: ["targets", "app"], width: 120, ellipsis: true },
            { title: "埋点", dataIndex: ["targets", "track"], width: 130, ellipsis: true },
            { title: "测试", dataIndex: ["targets", "test"], width: 130, ellipsis: true },
            {
              title: "覆盖状态", dataIndex: "coverage_status", width: 100,
              render: (v: string) => <Tag color={COVERAGE[v]?.color}>{COVERAGE[v]?.text ?? v}</Tag>,
            },
          ]}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          覆盖状态由接口给出，前端只渲染，不自行估算。孤儿 {trace.filter((t) => t.orphan).length} 条。
        </Typography.Text>
      </Drawer>

      {/* 埋点方案明细 */}
      <Modal title="埋点方案" open={trackOpen} onCancel={() => setTrackOpen(false)} footer={null} width={720}>
        <Table
          size="small" rowKey="event_key" pagination={false} dataSource={tracking}
          columns={[
            { title: "事件名", dataIndex: "event_key", width: 220, render: (v: string) => <code>{v}</code> },
            { title: "触发时机", dataIndex: "trigger_desc" },
            { title: "挂载元素", dataIndex: "element_id", width: 150 },
          ]}
        />
      </Modal>
    </div>
  );
}
