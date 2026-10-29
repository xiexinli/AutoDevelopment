# -*- coding: utf-8 -*-
import io, sys

def patch(path, edits):
    s = io.open(path, encoding="utf-8").read()
    for old, new in edits:
        n = s.count(old)
        if n != 1:
            sys.stderr.write("NOT UNIQUE in %s (%d): %r\n" % (path, n, old[:80])); sys.exit(1)
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8").write(s)
    print("patched %s (%d)" % (path, len(edits)))

# ============ session.ts ============
patch("web/src/store/session.ts", [
  ('export type KbSector = "prd" | "spec" | "glossary" | "domain";',
   'export type KbSector = "prd" | "spec" | "glossary" | "domain" | "constraints";'),
  ('''export const KB_SECTORS: { key: KbSector; label: string }[] = [
  { key: "prd", label: "PRD" }, { key: "spec", label: "Spec" },
  { key: "glossary", label: "术语表" }, { key: "domain", label: "领域模型" },
];''',
   '''export const KB_SECTORS: { key: KbSector; label: string }[] = [
  { key: "prd", label: "PRD" }, { key: "spec", label: "Spec" },
  { key: "glossary", label: "术语表" }, { key: "domain", label: "领域模型" },
  // F17 工程接入（2026-10-29）：第五分区，存「工程约束包」
  { key: "constraints", label: "工程约束" },
];'''),
  ('''export interface ProjectListItem {
  project_id: string;
  name: string;
  stage: string;
  updated_at: string;
  created_at: string;
  version: number;
}''',
   '''export interface ProjectListItem {
  project_id: string;
  name: string;
  stage: string;
  updated_at: string;
  created_at: string;
  version: number;
  /** `new` | `imported`（F17 工程接入，2026-10-29） */
  source_kind?: string;
}'''),
  ('''/** #3 项目详情（含 current_revision_id） */
export function fetchProject(projectId: string) {
  return request<{ project_id: string; name: string; stage: string; version: number;
    current_revision_id?: string; depth: "minimal" | "standard" | "comprehensive";''',
   '''/** #N1 接入已有工程（F17）：登记本机工程根目录 → 只读扫描 → 约束包落库 */
export function engineeringIntake(projectId: string, root: string) {
  return request<{
    source_kind: string; engineering_root: string; kb_doc_id: string;
    project_name: string | null;
    android: { agp: string | null; kotlin: string | null; gradle: string | null;
      compile_sdk: number | null; min_sdk: number | null; target_sdk: number | null; java: string | null };
    counts: { modules: number; dependencies: number; agent_config_files: number; items: number; naming_samples: number };
    warnings: string[];
  }>(`/projects/${projectId}/engineering-intake`, {
    method: "POST", body: { root, confirm: true }, idempotencyKey: newIdempotencyKey(),
  });
}

export interface ConstraintPackView {
  source_kind: string; engineering_root: string | null;
  pack: Record<string, unknown> | null;
  kb_doc_id: string | null; content_md: string; origin: string | null;
  version: number; updated_at: string | null; summary: string;
}
/** #N2 读工程约束 */
export function fetchConstraints(projectId: string) {
  return request<ConstraintPackView>(`/projects/${projectId}/constraints`);
}
/** #N3 编辑工程约束（乐观锁 → 须带 If-Match） */
export function saveConstraints(projectId: string, contentMd: string, version: number) {
  return request<{ kb_doc_id: string; origin: string; version: number; updated_at: string }>(
    `/projects/${projectId}/constraints`,
    { method: "PUT", body: { content_md: contentMd }, ifMatch: version, idempotencyKey: newIdempotencyKey() },
  );
}

/** #3 项目详情（含 current_revision_id） */
export function fetchProject(projectId: string) {
  return request<{ project_id: string; name: string; stage: string; version: number;
    current_revision_id?: string; depth: "minimal" | "standard" | "comprehensive";
    /** `new` | `imported`（F17 工程接入，2026-10-29） */
    source_kind?: string; engineering_root?: string | null;'''),
])

# ============ ProjectListPage.tsx ============
patch("web/src/pages/ProjectListPage.tsx", [
  ('''import {
  App as AntApp, Button, Card, Empty, Form, Input, Modal, Pagination, Popconfirm,
  Select, Skeleton, Space, Tag, Typography,
} from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { createProject, deleteProject, listProjects, patchProject, type ProjectListItem } from "@/store/session";''',
   '''import {
  App as AntApp, Button, Card, Checkbox, Empty, Form, Input, Modal, Pagination, Popconfirm,
  Select, Skeleton, Space, Tag, Typography,
} from "antd";
import { ImportOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { createProject, deleteProject, engineeringIntake, listProjects, patchProject, type ProjectListItem } from "@/store/session";'''),
  ('''  const [form] = Form.useForm<{ name: string; description?: string }>();
  const timerRef = useRef<number | null>(null);''',
   '''  const [form] = Form.useForm<{ name: string; description?: string }>();
  const timerRef = useRef<number | null>(null);

  // ---- 接入已有工程（F17）----
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeRoot, setIntakeRoot] = useState("");
  const [intakeName, setIntakeName] = useState("");
  const [intakeConsent, setIntakeConsent] = useState(false);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [intakePid, setIntakePid] = useState<string | null>(null);


  /** 接入已有工程：先建项目，再登记路径并只读扫描（失败可重试，不重复建项目） */
  async function doIntake() {
    const root = intakeRoot.trim();
    const name = (intakeName.trim() || root.split("/").filter(Boolean).pop() || "").slice(0, 50);
    if (!root) { message.error("请填写本机 Android 工程的根目录（绝对路径）。"); return; }
    if (!intakeConsent) { message.error("请先勾选授权，平台只读扫描这个目录。"); return; }
    setIntakeBusy(true);
    try {
      let pid = intakePid;
      if (!pid) { const c = await createProject(name || "接入的工程", `接入自 ${root}`); pid = c.project_id; setIntakePid(pid); }
      const r = await engineeringIntake(pid, root);
      message.success(`已接入工程${r.project_name ? `：${r.project_name}` : ""}，提取约束 ${r.counts.items} 项。`);
      setIntakeOpen(false); setIntakeRoot(""); setIntakeName(""); setIntakeConsent(false); setIntakePid(null);
      setPage(1); void load();
    } catch (e) {
      message.error((e as ApiError).message || "接入没成功。");
    } finally {
      setIntakeBusy(false);
    }
  }'''),
  ('''        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { track("EVT_proj_create_click", { entry: "header" }, { dedupWindowMs: 300 }); setCreateOpen(true); }}>新建项目</Button>''',
   '''        <div style={{ flex: 1 }} />
        <Button icon={<ImportOutlined />} onClick={() => { setIntakePid(null); setIntakeOpen(true); }}>接入已有工程</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { track("EVT_proj_create_click", { entry: "header" }, { dedupWindowMs: 300 }); setCreateOpen(true); }}>新建项目</Button>'''),
  ('''                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {relTime(p.updated_at)}
                  </Typography.Text>''',
   '''                  <Space size={8} align="center">
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {relTime(p.updated_at)}
                    </Typography.Text>
                    {p.source_kind === "imported" && <Tag color="blue">已接入工程</Tag>}
                  </Space>'''),
  ('''      {/* EL-PROJ-036 新建项目弹窗 */}''',
   '''      {/* EL-PROJ-037 接入已有工程弹窗（F17） */}
      <Modal
        title="接入已有工程" open={intakeOpen} confirmLoading={intakeBusy}
        okText="扫描并接入" cancelText="取消"
        onOk={() => void doIntake()}
        onCancel={() => { setIntakeOpen(false); setIntakeRoot(""); setIntakeName(""); setIntakeConsent(false); setIntakePid(null); }}
        destroyOnHidden
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="工程根目录（绝对路径）" required>
            <Input
              value={intakeRoot}
              onChange={(e) => {
                const v = e.target.value;
                setIntakeRoot(v);
                if (!intakeName) setIntakeName(v.split("/").filter(Boolean).pop() ?? "");
              }}
              placeholder="/Users/you/StudioProjects/MyApp"
              allowClear
            />
          </Form.Item>
          <Form.Item label="项目名">
            <Input maxLength={50} value={intakeName} onChange={(e) => setIntakeName(e.target.value)} showCount placeholder="默认取目录名" />
          </Form.Item>
          <Form.Item>
            <Checkbox checked={intakeConsent} onChange={(e) => setIntakeConsent(e.target.checked)}>
              我确认授权平台**只读**扫描这个目录，提取 agent 配置与框架约束（一期不写任何工程文件）
            </Checkbox>
          </Form.Item>
        </Form>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          平台会提取：AGP / Kotlin / Gradle 版本、compileSdk / minSdk / targetSdk、模块与包名、依赖与版本锁定、
          AGENTS.md 等 agent 配置、代码风格工具、既有控件命名。每项都带来源，可在「知识库 · 工程约束」查看与编辑。
        </Typography.Text>
      </Modal>

      {/* EL-PROJ-036 新建项目弹窗 */}'''),
])

# ============ KbPage.tsx：约束分区空态 + 注释 ============
patch("web/src/pages/KbPage.tsx", [
  (' *  - 四分区 Tab（PRD / Spec / 术语表 / 领域模型），**切换无动效**且**各自保留关键词**；',
   ' *  - 五分区 Tab（PRD / Spec / 术语表 / 领域模型 / **工程约束**），**切换无动效**且**各自保留关键词**；'),
  ('''            ) : (
              <Empty description="知识库还是空的。上传 PRD 后，平台会自动把内容抽进来。">
                <Button type="primary" size="small" icon={<UploadOutlined />}
                  onClick={() => nav(`/projects/${projectId}/upload`)}>上传 PRD</Button>
              </Empty>
            )''',
   '''            ) : sector === "constraints" ? (
              <Empty description="这个项目还没有接入工程约束。回到项目列表点「接入已有工程」即可。" />
            ) : (
              <Empty description="知识库还是空的。上传 PRD 后，平台会自动把内容抽进来。">
                <Button type="primary" size="small" icon={<UploadOutlined />}
                  onClick={() => nav(`/projects/${projectId}/upload`)}>上传 PRD</Button>
              </Empty>
            )'''),
])
