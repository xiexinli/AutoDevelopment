/**
 * `#68` 外发大模型：告知确认状态 + **用户级开关**（P0 合规，`REQ-AUTH-004` ②）。
 *
 * 约束：
 *  - 开关是**用户级**（不是项目级）；关闭后**生成类任务一律不可用**，**不做静默降级**；
 *  - `consent_acknowledged_at` 非空即视为已确认；`policy_text` 由服务端给出（前端逐字展示）；
 *  - **密钥不下发到浏览器**（平台侧托管，见 `.env.example` 说明）。
 */
import type { FastifyInstance } from "fastify";
import { currentUser } from "../core/auth.ts";
import { get, nowIso, run } from "../db/index.ts";
import { ApiError } from "../core/envelope.ts";

const DEFAULT_POLICY =
  "为了生成 Spec 与安卓代码，平台会把**你上传的 PRD 正文**与**平台生成的业务代码**发送至第三方大模型服务。" +
  "平台的密钥托管在受保护存储中，不下发到浏览器。你可以随时在「能力配置」里关闭这项外发。";

const DISABLED_REASON = "你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。";

interface EgressRow {
  user_id: string; egress_enabled: number; policy_text: string;
  disabled_reason: string; consent_acknowledged_at: string | null;
}

function load(userId: string): EgressRow {
  const row = get<EgressRow>(`SELECT * FROM tbl_ai_egress WHERE user_id = ?`, userId);
  if (row) return row;
  run(`INSERT INTO tbl_ai_egress (user_id, egress_enabled, policy_text, disabled_reason) VALUES (?,?,?,?)`,
    userId, 1, DEFAULT_POLICY, "");
  return { user_id: userId, egress_enabled: 1, policy_text: DEFAULT_POLICY, disabled_reason: "", consent_acknowledged_at: null };
}

/** 生成类任务的统一门禁：外发关闭 → `UPSTREAM_UNAVAILABLE`（**不静默降级**） */
export function assertEgressEnabled(userId: string): void {
  const row = load(userId);
  if (!row.egress_enabled) throw new ApiError("UPSTREAM_UNAVAILABLE", DISABLED_REASON);
  if (!row.consent_acknowledged_at) throw new ApiError("INVALID_ARGUMENT", "请先确认外发大模型告知，再继续操作。");
}

export function registerAiEgressRoutes(app: FastifyInstance) {
  app.get("/api/v1/users/me/ai-egress", async (req, reply) => {
    const user = currentUser(req);
    const row = load(user.user_id);
    void reply.send({
      code: "OK", message: "", request_id: String(req.id),
      data: {
        egress_enabled: !!row.egress_enabled,
        policy_text: row.policy_text,
        disabled_reason: row.egress_enabled ? "" : DISABLED_REASON,
        consent_acknowledged_at: row.consent_acknowledged_at,
      },
    });
  });

  app.put<{ Body: { egress_enabled?: boolean; consent_acknowledged?: boolean } }>(
    "/api/v1/users/me/ai-egress", async (req, reply) => {
      const user = currentUser(req);
      const row = load(user.user_id);
      const body = req.body ?? {};
      const enabled = body.egress_enabled === undefined ? row.egress_enabled : (body.egress_enabled ? 1 : 0);
      const consent = body.consent_acknowledged === true ? nowIso() : row.consent_acknowledged_at;
      run(`UPDATE tbl_ai_egress SET egress_enabled = ?, consent_acknowledged_at = ?, disabled_reason = ? WHERE user_id = ?`,
        enabled, consent, enabled ? "" : DISABLED_REASON, user.user_id);
      void reply.send({
        code: "OK", message: "", request_id: String(req.id),
        data: {
          egress_enabled: !!enabled, policy_text: row.policy_text,
          disabled_reason: enabled ? "" : DISABLED_REASON, consent_acknowledged_at: consent,
        },
      });
    });
}
