#!/usr/bin/env bash
#
# 本机一键启动（**仅本地开发**）
#
# 做了什么：
#   - 大模型端点换成 DHwork 的 OpenAI 兼容端点（比本机 35B 快一个数量级）
#   - 令牌**每次启动时**从 DHwork 客户端配置里现取：不写进 .env、不落盘、不进版本库
#   - 代码生成仍用确定性生成器（AD_CODEGEN_MODE=development）
#
# 注意：
#   - 令牌是 DHwork 客户端登录态，有效期约 30 天（客户端会自动刷新）；过期就重跑本脚本
#   - 消耗的是你账号的额度；**这是个人登录态的便利通道，不要用于对外产品**
#   - 想改模型：AD_LLM_MODEL=gpt-5.4-dhwork bash server/run-local.sh
#   - 想回退本机 LM Studio：AD_LLM_BASE_URL=http://127.0.0.1:1234/v1 AD_LLM_MODEL=qwen/qwen3.6-35b-a3b bash server/run-local.sh  （并清空 AD_LLM_API_KEY）
set -euo pipefail
cd "$(dirname "$0")"

DH_CFG="$HOME/Library/Application Support/DHwork/config/aionui-config.txt"
DH_MODELS="$HOME/Library/Application Support/DHwork/config/dhwork-openai.json"
LARK_ENV="$HOME/Library/Application Support/DHwork/config/lark-cli-env.json"

read -r TOK DEF_MODEL <<EOF
$(python3 - "$DH_CFG" "$DH_MODELS" <<'PY'
import base64, json, sys, urllib.parse
tok, model = "", ""
try:
    raw = open(sys.argv[1], encoding="utf-8").read().strip()
    j = json.loads(urllib.parse.unquote(base64.b64decode(raw).decode("utf-8", "replace")))
    tok = j.get("desktop.bootstrapAuth", {}).get("feishu", {}).get("accessToken", "") or ""
except Exception:
    pass
try:
    model = json.load(open(sys.argv[2], encoding="utf-8")).get("defaultModel", "") or ""
except Exception:
    pass
print(tok, model or "gpt-5.4-dhwork")
PY
)
EOF

# 飞书云文档读取用的个人令牌（优先 shell 里已有的 lark-cli 环境变量）
if [ -z "${AD_FEISHU_USER_TOKEN:-}" ]; then
  if [ -n "${LARKSUITE_CLI_USER_ACCESS_TOKEN:-}" ]; then
    export AD_FEISHU_USER_TOKEN="$LARKSUITE_CLI_USER_ACCESS_TOKEN"
  elif [ -f "$LARK_ENV" ]; then
    export AD_FEISHU_USER_TOKEN="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8")).get("LARKSUITE_CLI_USER_ACCESS_TOKEN",""))' "$LARK_ENV")"
  fi
fi

if [ -n "$TOK" ]; then
  export AD_LLM_BASE_URL="${AD_LLM_BASE_URL:-https://www.dhcoder.net/llm-api/v1}"
  export AD_LLM_MODEL="${AD_LLM_MODEL:-$DEF_MODEL}"
  export AD_LLM_API_KEY="${AD_LLM_API_KEY:-$TOK}"
  export AD_LLM_TIMEOUT_MS="${AD_LLM_TIMEOUT_MS:-120000}"
  export AD_TASK_TIMEOUT_MS="${AD_TASK_TIMEOUT_MS:-900000}"
  echo "[run-local] 模型端点 = $AD_LLM_BASE_URL ｜ 模型 = $AD_LLM_MODEL ｜ 令牌已注入（不回显）"
else
  echo "[run-local] ⚠️ 没取到 DHwork 令牌，回退用 server/.env 里的模型配置"
fi
export AD_CODEGEN_MODE="${AD_CODEGEN_MODE:-development}"

# 大模型目录（前端「选择模型」用）。缺失时按 DHwork 配置生成；
# 想核实每个模型当前是否真能调用：node tools/gen-llm-catalog.mjs --probe
if [ ! -f "data/llm-catalog.json" ]; then
  node tools/gen-llm-catalog.mjs >/dev/null 2>&1 || echo "[run-local] ⚠️ 模型目录生成失败，前端将只显示 AD_LLM_MODEL"
fi

echo "[run-local] 代码生成 = $AD_CODEGEN_MODE ｜ 飞书登录 = 开发适配器 ｜ 云文档 = $([ -n "${AD_FEISHU_USER_TOKEN:-}" ] && echo 真实 || echo 未配置)"
exec node src/server.ts
