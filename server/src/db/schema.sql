-- AutoDevelopment 平台后端 · SQLite schema
-- 表名取自 `baseline/领域模型.md`（服务端建议表名），**只做这 23 个实体，不新增组件**。
-- 约定：时间一律 UTC ISO-8601 文本；`version` 为乐观锁版本；逻辑删除用 `deleted_at`。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- E22 User ----------
CREATE TABLE IF NOT EXISTS tbl_user (
  user_id      TEXT PRIMARY KEY,          -- = 飞书 open_id
  nickname     TEXT NOT NULL DEFAULT '',
  avatar_url   TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'requester',  -- requester | admin
  created_at   TEXT NOT NULL
);

-- 会话 / 令牌（飞书扫码登录后签发；`Authorization: Bearer <token>`）
CREATE TABLE IF NOT EXISTS tbl_session (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  feishu_state TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);

-- 飞书扫码 state 机
CREATE TABLE IF NOT EXISTS tbl_qrcode (
  state        TEXT PRIMARY KEY,
  -- 真实扫码登录：回调换取的用户身份（`{open_id,nickname,avatar_url}`）
  identity_json TEXT,
  scan_status  TEXT NOT NULL,             -- pending_scan | scanned | expired | confirmed
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

-- 用户级：外发大模型告知与开关（`#68`）
CREATE TABLE IF NOT EXISTS tbl_ai_egress (
  user_id                  TEXT PRIMARY KEY,
  egress_enabled           INTEGER NOT NULL DEFAULT 0,
  policy_text              TEXT NOT NULL DEFAULT '',
  disabled_reason          TEXT NOT NULL DEFAULT '',
  consent_acknowledged_at  TEXT
);

-- 幂等（同键 3s 内重放返回首次结果）
CREATE TABLE IF NOT EXISTS tbl_idempotency (
  idem_key     TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  response     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_ms   INTEGER NOT NULL
);

-- ---------- E1 Project ----------
CREATE TABLE IF NOT EXISTS tbl_project (
  project_id          TEXT PRIMARY KEY,
  owner_user_id       TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  stage               TEXT NOT NULL DEFAULT 'created',   -- 数据模型 §3.1 的 17 态
  depth               TEXT NOT NULL DEFAULT 'standard',  -- 【已废弃·保留兼容】拆解深度，现由 review_level 映射
  review_level        TEXT NOT NULL DEFAULT 'standard',  -- PRD 审核分级（2026-10-28 定稿）：quick | standard | strict
  review_extended     INTEGER NOT NULL DEFAULT 0,        -- 严格档的「超严扩展」开关（仅 strict 有意义）
  version             INTEGER NOT NULL DEFAULT 1,
  element_id_seq      TEXT NOT NULL DEFAULT '{}',        -- 每模块已分配的最大序号
  current_revision_id TEXT,
  current_version_id  TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_updated ON tbl_project(deleted_at, updated_at DESC, project_id);

-- ---------- 项目成员（逐对象鉴权的依据；单用户期只有 owner） ----------
CREATE TABLE IF NOT EXISTS tbl_project_member (
  project_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'owner',
  PRIMARY KEY (project_id, user_id)
);

-- ---------- E2 KbDoc ----------
CREATE TABLE IF NOT EXISTS tbl_kb_doc (
  kb_doc_id   TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  -- 归属文档：同一文档重新解析 → **更新同一篇**；不同文档即使标题相同也各成一篇（**不互相覆盖**）
  document_id TEXT,
  title       TEXT NOT NULL,
  sector      TEXT NOT NULL,               -- prd | spec | glossary | domain
  origin      TEXT NOT NULL,               -- agent_extracted | user_edited | user_uploaded
  content_md  TEXT NOT NULL DEFAULT '',
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_kb_project ON tbl_kb_doc(project_id, sector, updated_at DESC);

-- ---------- E16 Document / E3 UploadFile / E4 DocRevision ----------
CREATE TABLE IF NOT EXISTS tbl_document (
  document_id  TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  source_type  TEXT NOT NULL,              -- file | feishu_link
  title        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tbl_upload_file (
  file_id      TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  document_id  TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tbl_doc_revision (
  revision_id   TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  document_id   TEXT NOT NULL,
  parse_status  TEXT NOT NULL,             -- pending | parsing | succeeded | partial | failed
  empty_document INTEGER NOT NULL DEFAULT 0,
  parts_json    TEXT NOT NULL DEFAULT '{}',
  manual_json   TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rev_doc ON tbl_doc_revision(document_id, created_at DESC);

-- ---------- E17 ReviewReport / E23 ReviewItem / E18 GateQuestion / E19 Assumption ----------
CREATE TABLE IF NOT EXISTS tbl_review_report (
  review_id        TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  revision_id      TEXT NOT NULL,
  verdict          TEXT NOT NULL,          -- running | passed | blocked | failed
  standard_version INTEGER NOT NULL,
  superseded       INTEGER NOT NULL DEFAULT 0,
  counts_json      TEXT NOT NULL DEFAULT '{}',
  model            TEXT NOT NULL DEFAULT '',  -- 本次审核实际使用的大模型（门禁结论随模型而变，必须可追溯）
  review_level     TEXT NOT NULL DEFAULT 'standard',  -- 本次审核使用的等级（结论随等级而变，必须可追溯）
  review_extended  INTEGER NOT NULL DEFAULT 0,        -- 本次是否开启「超严扩展」
  created_at       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tbl_review_item (
  item_row_id  TEXT PRIMARY KEY,
  review_id    TEXT NOT NULL,
  item_code    TEXT NOT NULL,
  group_code   TEXT NOT NULL,
  level        TEXT NOT NULL,              -- blocking | major | suggestion
  verdict      TEXT NOT NULL,              -- pass | fail | na
  evidence_ref TEXT NOT NULL DEFAULT '',
  suggestion   TEXT NOT NULL DEFAULT '',
  accepted     INTEGER NOT NULL DEFAULT 0,
  supplement   TEXT NOT NULL DEFAULT ''   -- 未通过项上由用户补充的信息（随 #23 写回 PRD）
);
CREATE TABLE IF NOT EXISTS tbl_gate_question (
  question_code TEXT PRIMARY KEY,
  review_id     TEXT NOT NULL,
  level         TEXT NOT NULL,
  title         TEXT NOT NULL,
  options_json  TEXT NOT NULL DEFAULT '[]',
  fallback      TEXT NOT NULL DEFAULT '',
  impact        TEXT NOT NULL DEFAULT '',
  answer        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS tbl_assumption (
  assumption_code TEXT PRIMARY KEY,
  review_id       TEXT NOT NULL,
  content         TEXT NOT NULL,
  source_tag      TEXT NOT NULL DEFAULT '',
  choice          TEXT NOT NULL DEFAULT 'unset'   -- unset | accept | convert
);

-- ---------- E21 GateStandard（项目级，每次保存版本 +1） ----------
CREATE TABLE IF NOT EXISTS tbl_gate_standard (
  standard_id TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  version     INTEGER NOT NULL,
  is_current  INTEGER NOT NULL DEFAULT 1,
  items_json  TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (standard_id, version)
);

-- ---------- E5 Page ----------
CREATE TABLE IF NOT EXISTS tbl_page (
  page_id     TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  module_code TEXT NOT NULL,               -- EL-<模块>-### 的模块段
  name        TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_page_project ON tbl_page(project_id, order_index);

-- ---------- E6/E7/E8 Element / StyleProps / ElementEvent ----------
CREATE TABLE IF NOT EXISTS tbl_element (
  element_id        TEXT NOT NULL,      -- EL-<模块>-<三位>，归一化存储
  project_id        TEXT NOT NULL,
  page_id           TEXT NOT NULL,
  parent_element_id TEXT,
  widget_type       TEXT NOT NULL,
  alias             TEXT NOT NULL DEFAULT '',
  order_index       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active',   -- active | void（不可复用、不可回收）
  temp_id           TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  voided_at         TEXT,
  PRIMARY KEY (project_id,element_id)
);
CREATE INDEX IF NOT EXISTS idx_element_page ON tbl_element(page_id, order_index);
CREATE INDEX IF NOT EXISTS idx_element_project ON tbl_element(project_id, status);

CREATE TABLE IF NOT EXISTS tbl_style_props (
  project_id TEXT NOT NULL,
  element_id  TEXT NOT NULL,
  props_json  TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(project_id,element_id)
);
CREATE TABLE IF NOT EXISTS tbl_element_event (
  project_id TEXT NOT NULL,
  element_id  TEXT NOT NULL,
  event_kind  TEXT NOT NULL,               -- click | long_press | double_click
  action_type TEXT NOT NULL DEFAULT 'none',
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (project_id,element_id, event_kind)
);

-- 画布草稿（#42；未提交改动绝不静默丢弃）
CREATE TABLE IF NOT EXISTS tbl_page_draft (
  page_id    TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tree_json  TEXT NOT NULL DEFAULT '[]',
  id_base_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- ---------- E9 ApiDef（**被开发 App** 的接口定义，与平台自身接口是两套） ----------
CREATE TABLE IF NOT EXISTS tbl_api_def (
  api_id      TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',   -- draft | effective | deprecated
  fields_json TEXT NOT NULL DEFAULT '[]',
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_project ON tbl_api_def(project_id, deleted_at, updated_at DESC);

-- ---------- E11 SpecDoc（五角色各一份；顺序 UI → 接口 → App → 埋点 → 测试） ----------
CREATE TABLE IF NOT EXISTS tbl_spec_doc (
  spec_id       TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  role          TEXT NOT NULL,
  role_order    INTEGER NOT NULL,
  status        TEXT NOT NULL,               -- generating | succeeded | failed | stale
  stale         INTEGER NOT NULL DEFAULT 0,
  change_point  TEXT,
  error_code    TEXT,
  content_md    TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL,
  UNIQUE (project_id, role)
);

-- ---------- E12 TrackPlan ----------
CREATE TABLE IF NOT EXISTS tbl_track_plan (
  event_key    TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  trigger_desc TEXT NOT NULL DEFAULT '',
  params_json  TEXT NOT NULL DEFAULT '[]',
  element_id   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, event_key)
);
CREATE TABLE IF NOT EXISTS tbl_proofread_item (
  item_code  TEXT NOT NULL,
  spec_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_code, spec_id)
);

-- ---------- E13 CapabilityConfig（每项目固定 7 行） ----------
CREATE TABLE IF NOT EXISTS tbl_capability_config (
  project_id  TEXT NOT NULL,
  cap_key     TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,
  code_status TEXT NOT NULL DEFAULT 'not_generated',  -- not_generated | generated | partial | failed
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, cap_key)
);
CREATE TABLE IF NOT EXISTS tbl_project_meta (
  project_id TEXT NOT NULL,
  meta_key   TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (project_id, meta_key)
);

-- ---------- E14 GenTask / E15 VerifyTask ----------
CREATE TABLE IF NOT EXISTS tbl_gen_task (
  task_id      TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  page_id      TEXT,
  type         TEXT NOT NULL,              -- parse|review|split|spec_gen|code_gen|verify_l1
  status       TEXT NOT NULL,              -- queued | running | succeeded | failed | timeout | canceled
  progress     INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL DEFAULT 1,
  input_hash   TEXT NOT NULL DEFAULT '',
  error_code   TEXT,
  result_ref   TEXT,
  started_at   TEXT,
  finished_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_project ON tbl_gen_task(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tbl_verify_task (
  verify_id  TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  layer      TEXT NOT NULL,                -- L1 | L2
  status     TEXT NOT NULL,
  rules_json TEXT NOT NULL DEFAULT '[]',
  attempt    INTEGER NOT NULL DEFAULT 1,
  log_digest TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tbl_artifact (
  artifact_id TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  path        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT ''
);

-- ---------- E10 ProjectVersion（整包快照 + diff） ----------
CREATE TABLE IF NOT EXISTS tbl_project_version (
  version_id      TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'current',   -- current | archived（「当前版本」只在此字段上）
  created_by      TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  summary         TEXT NOT NULL DEFAULT '',
  artifacts_json  TEXT NOT NULL DEFAULT '[]',
  snapshot_json   TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_version_project ON tbl_project_version(project_id, seq DESC);

-- ---------- E20 ChatMessage ----------
CREATE TABLE IF NOT EXISTS tbl_chat_message (
  message_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  role       TEXT NOT NULL,                -- user | assistant
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'sent', -- sent | failed（失败可重发，**不重复入库**）
  -- 「对话线程」= 项目内的**子步骤**（workbench/kb/upload/review/split/editor/specs/apis/capabilities/versions）
  -- 对话的**对象恒为 Project**（由 `project_id` 决定）；本列只区分「在哪一步聊的」
  thread_key   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_project ON tbl_chat_message(project_id, seq);

-- ---------- 用户偏好（按用户隔离的键值；如所选大模型） ----------
CREATE TABLE IF NOT EXISTS tbl_user_pref (
  user_id    TEXT NOT NULL,
  pref_key   TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, pref_key)
);

-- ---------- 本地账号密码登录（`#72`；开发阶段的登录方式） ----------
-- 只存 scrypt 加盐哈希，**永不存明文**；`username` 大小写不敏感唯一。
CREATE TABLE IF NOT EXISTS tbl_account (
  account_id    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,             -- scrypt$<saltHex>$<hashHex>
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_username ON tbl_account(username COLLATE NOCASE);
