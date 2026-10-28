/**
 * 顶栏「选择模型」：列出上游提供的**全部模型**（含中文名与描述），默认选中第一个可用项。
 *
 * 不可用的项（如 DHwork 的 `Auto` 路由）**仍然展示**，但置灰不可选，并在描述里说明原因 ——
 * 不做「看起来能选、选了就报错」。
 */
import { useEffect, useState } from "react";
import { Dropdown, Space, Tag, Tooltip, Typography, message } from "antd";
import { fetchLlmModels, saveLlmModel, type LlmModel } from "@/store/llm";
import { track } from "@/track";

export default function ModelPicker() {
  const [models, setModels] = useState<LlmModel[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [toast, ctx] = message.useMessage();

  useEffect(() => {
    fetchLlmModels()
      .then((r) => {
        setModels(r.items);
        setCurrent(r.effective_model || r.default_model);
      })
      .catch(() => undefined);
  }, []);

  if (!models.length) return null;
  const picked = models.find((m) => m.id === current);

  return (
    <Space size={6}>
      {ctx}
      <Dropdown
        trigger={["click"]}
        menu={{
          items: models.map((m) => ({
            key: m.id,
            disabled: !m.available,
            label: (
              <div style={{ maxWidth: 320, whiteSpace: "normal" }}>
                <div>
                  <Typography.Text strong>{m.name}</Typography.Text>
                  {m.id === current && <Tag style={{ marginLeft: 6 }} color="blue">当前</Tag>}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {m.available ? m.description : m.reason || "当前不可用"}
                </Typography.Text>
              </div>
            ),
          })),
          onClick: async ({ key }) => {
            if (key === current || busy) return;
            setBusy(true);
            const fromModel = current || null;
            try {
              const r = await saveLlmModel(key);
              setCurrent(r.effective_model || key);
              toast.success(`已切换到「${models.find((m) => m.id === key)?.name ?? key}」，下次审核即生效。`);
              track("EVT_llm_model_switch", {
                result: "succeeded", from_model: fromModel, to_model: key,
                available_model_count: models.filter((m) => m.available).length,
                last_verdict: "none", reason: null,
              }, { dedupKey: `model:${fromModel}->${key}`, immediate: true });
            } catch (e) {
              toast.error((e as Error).message || "切换模型失败。");
              track("EVT_llm_model_switch", {
                result: "failed", from_model: fromModel, to_model: key,
                available_model_count: models.filter((m) => m.available).length,
                last_verdict: "none", reason: (e as { code?: string }).code ?? "NETWORK_ERROR",
              }, { dedupKey: `modelfail:${fromModel}->${key}`, immediate: true });
            } finally {
              setBusy(false);
            }
          },
        }}
      >
        <Tooltip title="门禁结论会随模型而变，可在各模型间切换">
          <Space style={{ cursor: "pointer" }} size={4}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>模型</Typography.Text>
            <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>{picked?.name ?? current}</Tag>
          </Space>
        </Tooltip>
      </Dropdown>
    </Space>
  );
}
