import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert, App as AntApp, Button, Card, Divider, Input, List, Progress, Space, Tag, Typography,
} from "antd";
import { CloseOutlined, InboxOutlined } from "@ant-design/icons";
import {
  createDocFromLink, fetchParseResult, listRevisions, supplementPart, triggerParse, uploadFile,
  type ParseParts,
} from "@/store/session";
import { ApiError } from "@/api/client";
import { track } from "@/track";
import ComplianceNotice from "@/components/ComplianceNotice";

/**
 * `UI-UPLOAD-001` 上传 PRD —— 文案逐字取自 `UI-Spec §4.5 ④ 文案字样`。
 * 关键约束：`partial` 是**独立终态**（标黄，不得显示为完全成功）；空文档**不是错误**（无危险色）；
 * **首次上传前**先过外发合规弹窗（`CMP-004`，P0）；上传按钮 3s 内连点只上传一次。
 */

type FileKind = "docx" | "md" | "link";
interface Picked {
  key: string;
  kind: FileKind;
  name: string;
  size: number;
  file?: File;
  link?: string;
  documentId?: string;
  revisionId?: string;
  uploading?: boolean;
  error?: string;
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

export default function UploadPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const { message } = AntApp.useApp();

  const [picked, setPicked] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const [link, setLink] = useState("");
  const [linkErr, setLinkErr] = useState<{ text: string; auth?: boolean } | null>(null);
  const [banner, setBanner] = useState<{ type: "error" | "warning"; text: string } | null>(null);

  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parts, setParts] = useState<ParseParts | null>(null);
  const [parseStatus, setParseStatus] = useState<string>("");
  /** 上传阶段（`EL-UPLOAD-016`）：上传进行中显示「正在上传…{n}%」（走 `#10` 的上传进度回调） */
  const [uploading, setUploading] = useState(false);
  const [emptyDoc, setEmptyDoc] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [revisions, setRevisions] = useState<{ revision_id: string; created_at: string }[]>([]);
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualText, setManualText] = useState("");
  const [notice, setNotice] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastSubmit = useRef(0);
  const timerRef = useRef<number | null>(null);

  // ---------- 选择文件 ----------
  const addFiles = useCallback((files: FileList | File[]) => {
    const next: Picked[] = [];
    for (const f of Array.from(files)) {
      if (!/\.(docx|md)$/i.test(f.name)) {
        setBanner({ type: "error", text: "暂不支持该格式。请上传 .docx / .md 或飞书云文档链接。" });
        continue;
      }
      if (f.size > 20 * 1024 * 1024) {
        setBanner({ type: "error", text: `文件超过 20MB（当前 ${(f.size / 1048576).toFixed(1)}MB）。请压缩后重试。` });
        continue;
      }
      next.push({ key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 6)}`, kind: /\.md$/i.test(f.name) ? "md" : "docx", name: f.name, size: f.size, file: f });
    }
    if (next.length) { setBanner(null); setPicked((p) => [...p, ...next]); }
  }, []);

  // ---------- 飞书链接校验（两条不同文案）----------
  function validateLink(v: string) {
    const s = v.trim();
    if (!s) { setLinkErr(null); return; }
    if (!/^https?:\/\/\S*(feishu|larksuite)\S*\/\S+/i.test(s)) {
      setLinkErr({ text: "链接无效或已失效。" });
      return;
    }
    // 演示：含 "noauth" 的链接走「无权限」分支
    if (/noauth/i.test(s)) {
      setLinkErr({ text: "平台没有这篇文档的访问权限。", auth: true });
      return;
    }
    setLinkErr(null);
    setPicked((p) => [...p, { key: `link-${Date.now()}`, kind: "link", name: s, size: 0, link: s }]);
    setLink("");
  }

  // ---------- 开始解析（串行、幂等）----------
  async function doParse() {
    const now = Date.now();
    if (now - lastSubmit.current < 3000) return; // 3s 内连点只上传一次
    lastSubmit.current = now;

    if (!picked.length) { setBanner({ type: "error", text: "请先添加要解析的文件或飞书链接。" }); return; }
    setParsing(true); setBanner(null); setParts(null); setProgress(0); setElapsed(0); setUploading(true);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => setElapsed((v) => v + 1), 1000);

    try {
      let documentId = "";
      let revisionId = "";

      // `EVT_upload_start`：三个前置（告知已确认 / 外发开启 / 规格预校验）通过后、`#10` 请求发出之前
      track("EVT_upload_start", {
        source_type: picked.some((x) => x.kind === "link") ? "feishu_link" : "file",
        file_count: picked.length,
        total_size_mb: Number((picked.reduce((s, x) => s + (x.size || 0), 0) / 1024 / 1024).toFixed(2)),
      }, { dedupWindowMs: 3000 });

      for (const item of picked) {
        if (item.documentId) { documentId = item.documentId; continue; }
        if (item.kind === "link") {
          const r = await createDocFromLink(projectId, item.link!);
          documentId = r.document_id;
        } else {
          // `EL-UPLOAD-016`：上传阶段显示「正在上传…{n}%」，逐次赋值、非动画
          setProgress(0);
          const up = await uploadFile(projectId, item.file!, (pct) => setProgress(pct));
          documentId = up.document_id;
        }
        setPicked((p) => p.map((x) => (x.key === item.key ? { ...x, documentId } : x)));
      }

      // 上传完成 → 进入解析阶段（进度条**只前进不回落**，避免 100% 后跳回 60%）
      setUploading(false);
      setProgress((p) => Math.max(p, 60));
      const t = await triggerParse(documentId);
      revisionId = t.revision_id;
      setPicked((p) => p.map((x) => ({ ...x, revisionId })));
      message.success("文件已上传，开始解析。");

      // 轮询解析结果直到终态
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const pr = await fetchParseResult(revisionId);
        setParseStatus(pr.parse_status);
        setParts(pr.parts);
        setEmptyDoc(pr.empty_document);
        setProgress((p) => (pr.parse_status === "parsing" || pr.parse_status === "pending" ? Math.max(p, 80) : 100));
        if (["succeeded", "partial", "failed"].includes(pr.parse_status)) {
          // `EVT_upload_parse_terminal`：解析任务进入终态时；`succeeded`/`partial`/`failed` 分别上报
          const failedCount =
            (pr.parts.body.status === "failed" ? 1 : 0) +
            pr.parts.tables.filter((x) => x.status === "failed").length +
            pr.parts.whiteboards.filter((x) => x.status === "failed").length +
            pr.parts.attachments.filter((x) => x.status === "failed").length;
          const totalParts = 1 + pr.parts.tables.length + pr.parts.whiteboards.length + pr.parts.attachments.length;
          track("EVT_upload_parse_terminal", {
            parse_status: pr.parse_status, empty_document: !!pr.empty_document,
            failed_parts_count: failedCount, parts_ok_count: Math.max(0, totalParts - failedCount),
            revision_id: revisionId, duration_ms: Date.now() - now,
          }, { dedupKey: `parse:${revisionId}`, immediate: true });
          if (pr.parse_status === "partial") {
            const failed = [
              ...pr.parts.tables.filter((x) => x.status === "failed").map((x) => `内嵌表格 @${x.token}`),
              ...pr.parts.whiteboards.filter((x) => x.status === "failed").map((x) => `白板图 @${x.token}`),
              ...pr.parts.attachments.filter((x) => x.status === "failed").map((x) => `附件 @${x.name}`),
              ...(pr.parts.body.status === "failed" ? ["正文"] : []),
            ];
            setBanner({ type: "warning", text: `解析完成，但有 ${failed.length} 处没取到：` });
          } else if (pr.parse_status === "failed") {
            setBanner({ type: "error", text: "解析没成功。" });
          }
          break;
        }
      }
      const revs = await listRevisions(documentId);
      setRevisions(revs.items.map((r) => ({ revision_id: r.revision_id, created_at: r.created_at })));
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "PAYLOAD_TOO_LARGE" || err.code === "FORMAT_UNSUPPORTED") {
        setBanner({ type: "error", text: err.message });
        // `EVT_upload_rejected`：前端预校验 / `#10` 413、422 之后；不上报文件名、不用 0 代未知页数
        track("EVT_upload_rejected", {
          reject_reason: err.code === "PAYLOAD_TOO_LARGE" ? "too_large" : "format_unsupported",
          size_mb: Number(((picked[0]?.size || 0) / 1024 / 1024).toFixed(2)),
          page_count: null,
        }, { dedupKey: `reject:${(picked[0]?.key) ?? ""}`, immediate: true });
      } else if (err.code === "UPSTREAM_UNAVAILABLE") {
        setBanner({ type: "error", text: "服务暂时不可用（UPSTREAM_UNAVAILABLE）。" });
      } else {
        setBanner({ type: "error", text: err.message || "上传中断了。" });
      }
    } finally {
      setParsing(false);
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    }
  }

  const failedParts = parts
    ? [
        ...parts.tables.filter((x) => x.status === "failed").map((x) => `内嵌表格 @${x.token}`),
        ...parts.whiteboards.filter((x) => x.status === "failed").map((x) => `白板图 @${x.token}`),
        ...parts.attachments.filter((x) => x.status === "failed").map((x) => `附件 @${x.name}`),
        ...(parts.body.status === "failed" ? ["正文"] : []),
      ]
    : [];

  const partRow = (label: string, status?: "ok" | "failed" | "skipped") => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32 }}>
      <span style={{ width: 20, textAlign: "center", color: status === "ok" ? "#52c41a" : status === "failed" ? "#faad14" : "#999" }}>
        {status === "ok" ? "✓" : status === "failed" ? "⚠" : "–"}
      </span>
      <span>{label}</span>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {status === "ok" ? "已取到" : status === "failed" ? "没取到" : "跳过"}
      </Typography.Text>
    </div>
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <Typography.Title className="ad-page-title">上传 PRD</Typography.Title>
        <div style={{ flex: 1 }} />
        <Button onClick={() => nav(`/projects/${projectId}/workbench`)}>返回工作台</Button>
      </div>

      {banner?.type === "error" && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message={banner.text}
          action={<Button size="small" onClick={() => void doParse()}>重试</Button>} />
      )}
      {banner?.type === "warning" && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={banner.text}
          description={
            <div>
              {failedParts.map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, height: 32 }}>
                  <span>{f}</span>
                  <Button size="small" type="link" onClick={() => { setManualFor(f); setManualText(""); }}>手动补充</Button>
                </div>
              ))}
            </div>
          } />
      )}

      {/* 拖拽区 */}
      <Card style={{ marginBottom: 16 }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          style={{
            height: 200, display: "grid", placeItems: "center", textAlign: "center", cursor: "pointer",
            border: `2px dashed ${dragging ? "var(--ad-primary)" : "var(--ad-border)"}`,
            borderRadius: 12, background: dragging ? "var(--ad-primary-bg)" : "var(--ad-bg-page)",
          }}
        >
          <div>
            <InboxOutlined style={{ fontSize: 32, color: "var(--ad-primary)" }} />
            <div style={{ fontSize: 16, marginTop: 8 }}>
              {dragging ? "松开即可添加" : "把 PRD 拖到这里，或点击选择文件"}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              支持 .docx / .md / 飞书云文档链接，单文件 ≤ 20MB、≤ 100 页
            </Typography.Text>
          </div>
        </div>
        <input
          ref={inputRef} type="file" accept=".docx,.md" multiple style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />

        {/* 飞书链接 */}
        <Input
          style={{ marginTop: 24 }}
          placeholder="粘贴飞书云文档链接"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onBlur={() => validateLink(link)}
          onPressEnter={() => validateLink(link)}
        />
        {linkErr && (
          <div style={{ marginTop: 4, color: "#ff4d4f", fontSize: 13 }}>
            {linkErr.text}
            {linkErr.auth && <Button type="link" size="small">去飞书授权</Button>}
          </div>
        )}

        {/* 已选条目 */}
        {picked.length > 0 && (
          <List
            style={{ marginTop: 16, border: "1px solid var(--ad-border)", borderRadius: 8 }}
            dataSource={picked}
            renderItem={(it) => (
              <List.Item
                actions={[<Button key="rm" type="text" size="small" icon={<CloseOutlined />} onClick={() => setPicked((p) => p.filter((x) => x.key !== it.key))} />]}
              >
                <Space>
                  <span style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }}>
                    {it.name}
                  </span>
                  {it.size > 0 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fmtSize(it.size)}</Typography.Text>}
                  {it.kind === "link" && <Tag>飞书链接</Tag>}
                </Space>
              </List.Item>
            )}
          />
        )}

        <Button type="primary" style={{ marginTop: 24 }} disabled={parsing || !picked.length}
          onClick={() => setNotice(true)}>
          {parsing ? "解析中…" : "开始解析"}
        </Button>
      </Card>

      {/* 进度 + 分块 */}
      {(parsing || parts) && (
        <Card>
          <Progress percent={progress} status={parseStatus === "failed" ? "exception" : undefined} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {uploading ? `正在上传…${progress}%` : parsing ? `正在解析…已用 ${elapsed} 秒` : `解析状态：${parseStatus}`}
          </Typography.Text>

          {parts && (
            <div style={{ marginTop: 16, background: "var(--ad-bg-page)", padding: 16, borderRadius: 8 }}>
              {partRow("正文", parts.body.status)}
              {partRow("内嵌表格", parts.tables.some(t=>t.status === "failed") ? "failed" : parts.tables[0]?.status)}
              {partRow("白板图", parts.whiteboards[0]?.status)}
              {partRow("附件", parts.attachments[0]?.status)}
            </div>
          )}

          {emptyDoc && (
            <Alert style={{ marginTop: 16 }} type="info" showIcon
              message="这份文档里没有可解析的内容。" description="你可以重新上传，或把内容补充进 PRD 后再试。" />
          )}
        </Card>
      )}

      {/* revision 历史 */}
      {revisions.length > 0 && (
        <Card style={{ marginTop: 16 }} title={`历史版本（${revisions.length}）`}>
          {revisions.map((r) => (
            <div key={r.revision_id} style={{ height: 40, display: "flex", alignItems: "center", borderBottom: "1px solid var(--ad-border-light)" }}>
              revision {r.revision_id.slice(-6)} · {new Date(r.created_at).toLocaleString("zh-CN")}
            </div>
          ))}
        </Card>
      )}

      {/* 手动补充 */}
      {manualFor && (
        <Card style={{ marginTop: 16 }} title={`手动补充 · ${manualFor}`}>
          <Input.TextArea rows={4} value={manualText} onChange={(e) => setManualText(e.target.value)}
            placeholder="把这一块的内容贴进来" />
          <Divider />
          <Space>
            <Button type="primary" onClick={async () => {
              const revId = picked.find((p) => p.revisionId)?.revisionId;
              if (!revId) { message.error("还没有可补充的 revision。"); return; }
              try {
                await supplementPart(revId, manualFor, manualText);
                message.success("已补充。");
                // `EVT_upload_part_manual_supplement`：`#15` 成功、该块状态更新之后
                track("EVT_upload_part_manual_supplement", { part_key: manualFor },
                  { dedupKey: `supp:${revId}:${manualFor}`, immediate: true });
                setManualFor(null);
              } catch (e) { message.error((e as ApiError).message || "补充没成功。"); }
            }}>保存补充</Button>
            <Button onClick={() => setManualFor(null)}>取消</Button>
          </Space>
        </Card>
      )}

      <ComplianceNotice
        open={notice}
        scene="upload_first"
        onCancel={() => { setNotice(false); message.info("已取消，不会发起上传。"); }}
        onConfirmed={() => { setNotice(false); void doParse(); }}
      />
    </div>
  );
}
