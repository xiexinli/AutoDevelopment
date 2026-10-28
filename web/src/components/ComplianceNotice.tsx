import { useEffect, useRef } from "react";
import { Button, Modal, Typography } from "antd";
import { fetchAiEgress, updateAiEgress } from "@/store/session";
import { track } from "@/track";

/**
 * `CMP-004` 外发大模型告知弹窗（**P0 合规**，`REQ-AUTH-004`）—— 全局组件。
 * 元素：`EL-GLOBAL-004` 容器 / `005` 标题 / `006` 正文 / `007`「我已知悉，继续」/ `008`「取消」。
 * 规则（`UI-Spec §7.1`，逐字）：
 *  - 首次上传 PRD 前 / 首次生成代码前拦截；**未点击「我已知悉，继续」= 未确认，不能继续**；
 *  - 焦点自动落「取消」（破坏性默认）；按 `Esc` 同效；
 *  - **不得静默降级**：关闭后不发起原动作，且要有明确反馈。
 */
export interface ComplianceNoticeProps {
  open: boolean;
  /** 关闭（取消）—— 原动作不执行 */
  onCancel: () => void;
  /** 已确认 —— 继续原动作 */
  onConfirmed: () => void;
  /** 触发场景（`埋点-Spec` 的 `trigger_scene`） */
  scene?: "upload_first" | "generate_first" | "workbench_generate";
}

export default function ComplianceNotice({ open, onCancel, onConfirmed, scene = "generate_first" }: ComplianceNoticeProps) {
  const [modal, ctx] = Modal.useModal();
  // 回调经 ref 传递：effect 不再依赖其身份，避免每次渲染重跑（否则会叠出多个弹窗 / 重复触发原动作）
  const cb = useRef({ onCancel, onConfirmed });
  cb.current = { onCancel, onConfirmed };
  /** 本次 open 周期内是否已经走过一遍（StrictMode 下 effect 会跑两次，必须幂等） */
  const fired = useRef(false);

  useEffect(() => {
    if (!open) { fired.current = false; return; }
    if (fired.current) return;
    fired.current = true;

    let alive = true;
    fetchAiEgress()
      .then((e) => {
        if (!alive) return;
        // 已确认过则直接放行（`consent_acknowledged_at` 非空）
        if (e.consent_acknowledged_at) { cb.current.onConfirmed(); return; }
        // 外发已被用户关闭 → 拦截，**不静默降级**
        if (!e.egress_enabled) { cb.current.onCancel(); return; }
        // ★合规：首次上传前 / 首次生成前弹窗展示时
        track("EVT_aiegress_notice_shown", { trigger_scene: scene }, { dedupKey: `egress_shown:${scene}`, immediate: true });
        modal.confirm({
          title: "关于代码外发，需要你先知悉",
          content: (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              为了生成 Spec 与安卓代码，平台会把<strong>你上传的 PRD 正文</strong>与<strong>平台生成的业务代码</strong>
              发送至第三方大模型服务。平台的密钥托管在受保护存储中，不下发到浏览器。
              你可以随时在「能力配置」里关闭这项外发。
            </Typography.Paragraph>
          ),
          okText: "我已知悉，继续",
          cancelText: "取消",
          autoFocusButton: "cancel", // 破坏性默认
          keyboard: true, // Esc 同效
          onOk: async () => {
            try {
              await updateAiEgress({ consent_acknowledged: true });
            } catch (err) {
              // 写入失败 → 明确反馈，**不伪造成功**
              modal.error({ title: "确认状态没保存成功。", content: "请检查网络后重试。" });
              // ★合规：确认状态写入失败（错误条渲染之后）
              track("EVT_aiegress_notice_write_failed",
                { error_code: (err as { code?: string })?.code ?? "INTERNAL", trigger_scene: scene },
                { dedupKey: `egress_wf:${scene}`, dedupWindowMs: 3000, immediate: true });
              return Promise.reject();
            }
            // ★合规：点「我已知悉，继续」且写入成功后（不上报 PRD 正文）
            track("EVT_aiegress_notice_confirmed", { consent_acknowledged_at: new Date().toISOString(), trigger_scene: scene },
              { dedupKey: `egress_confirmed:${scene}`, immediate: true });
            cb.current.onConfirmed();
          },
          onCancel: () => {
            // ★合规：用户拒绝 / 关闭告知弹窗（原动作未执行）；同一 trigger_scene 1s 内只报 1 次
            track("EVT_aiegress_notice_canceled", { trigger_scene: scene },
              { dedupKey: `egress_cancel:${scene}`, dedupWindowMs: 1000, immediate: true });
            cb.current.onCancel();
          },
        });
      })
      .catch(() => { if (alive) cb.current.onCancel(); });
    return () => { alive = false; };
  }, [open, modal]);

  return <>{ctx}</>;
}

/** 工具：判断「外发已关闭」时的统一拦截文案（`UI-Spec §7.1`） */
export const EGRESS_DISABLED_TEXT = "你已关闭「PRD 与代码外发第三方大模型」，生成类任务不可用。";

/** 按钮：关闭态下的「去开启」 */
export function EgressDisabledActions({ onGo }: { onGo: () => void }) {
  return <Button type="link" onClick={onGo}>去开启</Button>;
}
