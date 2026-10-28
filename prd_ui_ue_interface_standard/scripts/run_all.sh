#!/usr/bin/env bash
# L1 一键机检：文档级 + 跨文档一致性
#
# 用法：
#   bash scripts/run_all.sh                 # 检查 docs/
#   bash scripts/run_all.sh examples/docs   # 检查示例（演示用）
#
# 退出码：0 通过（无阻断项）；1 存在阻断项

set -uo pipefail

ROOT="${1:-docs}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ="$(dirname "$HERE")"

cd "$PROJ" || exit 2

PY="python3"
command -v "$PY" >/dev/null 2>&1 || { echo "需要 python3"; exit 2; }

echo
"$PY" scripts/check_docs.py --root "$ROOT"
DOC_RC=$?

echo
"$PY" scripts/check_consistency.py --root "$ROOT"
CON_RC=$?

echo
echo "================================================================"
if [ "$DOC_RC" -ne 0 ] || [ "$CON_RC" -ne 0 ]; then
  echo "❌ L1 机检未通过 —— 请先修复阻断项，再进入 L2 AI 校验"
  echo "   下一步：ai-validation/校验提示词.md"
  exit 1
fi

echo "✅ L1 机检通过 —— 可以进入 L2 AI 语义校验"
echo "   下一步：ai-validation/校验提示词.md"
exit 0
