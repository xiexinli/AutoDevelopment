#!/usr/bin/env bash
#
# ⚠️ **手动验收脚本**：需要真实大模型（AD_LLM_BASE_URL/AD_LLM_MODEL）与单实例、非 watch 的服务端。
#    `AD_LLM_MODE=development` 会让它退化成确定性桩 —— 那样跑出来的「通过」不算证据（本脚本结尾会校验）。
#    不进自动化回归；自动化回归见 b2/b3/b4-regression.mjs 与 upstream-conformance.mjs。
#
# 真实模型「门禁 → 拆解 → 五份 Spec」全链路（不使用任何开发适配器）
#   上传 PRD → 解析 → 门禁审核 →（作答/采纳/回写/复审，最多 4 轮）→ 拆解 → 生成五份 Spec
# 只打印结构性指标，不回显 PRD 正文；结尾显式校验 Spec 是否为「真实模型产出」。
set -uo pipefail
B=http://127.0.0.1:8787/api/v1
SRC=/Users/alion/StudioProjects/AutoDevelopment/samples/PRD-门店补货申请-门禁样例.md
J() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(eval("d"+sys.argv[1]))' "$1"; }
log() { echo "[$(date +%H:%M:%S)] $*"; }

STATE=$(curl -s $B/auth/feishu/qrcode | J "['data']['state']")
curl -s -X POST $B/auth/feishu/qrcode/$STATE/simulate -H 'content-type: application/json' -d '{"next":"confirmed"}' >/dev/null
TOK=$(curl -s $B/auth/feishu/qrcode/$STATE | J "['data']['token']")
AUTH="Authorization: Bearer $TOK"; CT='content-type: application/json'

PID=$(curl -s -X POST $B/projects -H "$AUTH" -H "$CT" -H "Idempotency-Key: gp-1" \
  -d '{"name":"门店补货申请·真实全链路"}' | J "['data']['project_id']")
log "项目 $PID"

U=$(curl -s -X POST $B/projects/$PID/uploads -H "$AUTH" -H "Idempotency-Key: gp-2" -F "file=@$SRC")
DOC=$(echo "$U" | J "['data']['document_id']")
log "上传并建文档 $DOC"

T=$(curl -s -X POST $B/documents/$DOC/revisions -H "$AUTH" -H "Idempotency-Key: gp-3" | J "['data']['task_id']")
for i in $(seq 1 120); do S=$(curl -s $B/tasks/$T -H "$AUTH" | J "['data']['status']"); case "$S" in succeeded|failed|timeout) break;; esac; sleep 1; done
REV=$(curl -s $B/documents/$DOC/revisions -H "$AUTH" | J "['data']['items'][0]['revision_id']")
log "解析 $S （revision $REV）"

wait_task() { for i in $(seq 1 600); do S=$(curl -s $B/tasks/$1 -H "$AUTH" | J "['data']['status']"); case "$S" in succeeded|failed|timeout) break;; esac; sleep 2; done; echo "$S"; }
latest_review() {
  node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/Users/alion/StudioProjects/AutoDevelopment/server/data/app.db');
const r=d.prepare('SELECT review_id FROM tbl_review_report WHERE project_id=? AND superseded=0 ORDER BY created_at DESC LIMIT 1').get(process.argv[1]);console.log(r?r.review_id:'')" "$1"
}
accept_all() { # 采纳 fail 项（仅勾选，不直接写回）
  local RID="$1" ROUND="$2"
  local CODES
  CODES=$(curl -s $B/reviews/$RID/items -H "$AUTH" | python3 -c '
import sys,json
print(json.dumps([i["item_code"] for i in json.load(sys.stdin)["data"]["items"] if i["verdict"]=="fail"]))')
  curl -s -X POST $B/reviews/$RID/accept-candidates -H "$AUTH" -H "$CT" \
    -H "Idempotency-Key: acc-$ROUND" -d "{\"item_codes\":$CODES}" >/dev/null
  echo "$CODES"
}
finalize_assumptions() { # 未定稿假设一律「按建议采纳」
  curl -s $B/reviews/$1/assumptions -H "$AUTH" | python3 -c '
import sys,json
for a in json.load(sys.stdin)["data"]["items"]:
    if a["choice"]=="unset": print(a["assumption_code"])' > /tmp/gp_a.txt
  while read -r code; do
    [ -z "${code:-}" ] && continue
    curl -s -X POST $B/reviews/$1/assumptions -H "$AUTH" -H "$CT" \
      -d "{\"assumption_code\":\"$code\",\"choice\":\"accept\"}" >/dev/null
  done < /tmp/gp_a.txt
  wc -l < /tmp/gp_a.txt | tr -d ' '
}
answer_questions() { # 逐条作答（取第一个选项）
  curl -s $B/reviews/$1/questions -H "$AUTH" | python3 -c '
import sys,json
for q in json.load(sys.stdin)["data"]["items"]:
    if q.get("status")=="open" and q.get("options"): print(q["question_code"]+"\t"+q["options"][0])' > /tmp/gp_q.tsv
  while IFS=$'\t' read -r code ans; do
    [ -z "${code:-}" ] && continue
    curl -s -X POST $B/questions/$code/answers -H "$AUTH" -H "$CT" \
      -d "$(python3 -c 'import json,sys;print(json.dumps({"answer":sys.argv[1]}))' "$ans")" >/dev/null
  done < /tmp/gp_q.tsv
  wc -l < /tmp/gp_q.tsv | tr -d ' '
}

# ---------- 第 1 轮门禁 ----------
R=$(curl -s -X POST $B/revisions/$REV/reviews -H "$AUTH" -H "$CT" -d '{}')
RID=$(echo "$R" | J "['data']['review_id']"); RT=$(echo "$R" | J "['data']['task_id']")
log "门禁审核 $RID ｜ 终态 $(wait_task "$RT")"

PASSED=no
for round in 1 2 3 4; do
  V=$(curl -s $B/reviews/$RID -H "$AUTH" | J "['data']['verdict']")
  C=$(curl -s $B/reviews/$RID -H "$AUTH" | J "['data']['counts']")
  OPEN=$(curl -s $B/reviews/$RID/questions -H "$AUTH" | python3 -c '
import sys,json
print(sum(1 for q in json.load(sys.stdin)["data"]["items"] if q["level"]=="blocking" and q["status"]!="answered"))')
  NA=$(curl -s $B/reviews/$RID/assumptions -H "$AUTH" | python3 -c '
import sys,json
print(sum(1 for a in json.load(sys.stdin)["data"]["items"] if a["choice"]=="unset"))')
  log "第 $round 轮：verdict=$V counts=$C 阻断未答=$OPEN 假设未定稿=$NA"
  if [ "$V" = "passed" ] && [ "$OPEN" = "0" ] && [ "$NA" = "0" ]; then PASSED=yes; break; fi

  A=$(finalize_assumptions "$RID")
  Q=$(answer_questions "$RID")
  CODES=$(accept_all "$RID" "$round")
  curl -s -X POST $B/reviews/$RID/writeback -H "$AUTH" -H "$CT" -H "Idempotency-Key: wb-$round" \
    -d "{\"confirm\":true,\"accepted_items\":$CODES,\"snapshot\":true}" \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  回写:",d.get("code"),(d.get("data") or {}).get("snapshot_id"))'
  REV=$(curl -s $B/projects/$PID -H "$AUTH" | J "['data']['current_revision_id']")
  log "  作答 $Q 条、定稿 $A 条假设 ｜ 新 revision=$REV"
  R2=$(curl -s -X POST $B/revisions/$REV/reviews -H "$AUTH" -H "$CT" -d '{}')
  RID=$(echo "$R2" | J "['data']['review_id']"); RT2=$(echo "$R2" | J "['data']['task_id']")
  log "  复审终态 $(wait_task "$RT2")"
done

if [ "$PASSED" != "yes" ]; then
  log "门禁未通过 —— 系统拒绝放行，不伪造 gate_passed，停止后续。"
  log "PROJECT=$PID"
  exit 0
fi
log "✅ 门禁通过（真实模型）"

# ---------- 拆解 ----------
T3=$(curl -s -X POST $B/projects/$PID/splits -H "$AUTH" -H "$CT" -H "Idempotency-Key: gp-4" -d '{"depth":"standard"}' | J "['data']['task_id']")
log "拆解中 … 终态 $(wait_task "$T3")"
curl -s $B/projects/$PID/requirements -H "$AUTH" | python3 -c '
import sys,json
d=json.load(sys.stdin)["data"]
print("  需求包:", [(p["role"],len(p["reqs"])) for p in d["items"]], "｜ REQ 总数:", d["requirement_count"])'

# ---------- 五份 Spec ----------
T4=$(curl -s -X POST $B/projects/$PID/specs:generate -H "$AUTH" -H "$CT" -H "Idempotency-Key: gp-5" | J "['data']['task_id']")
log "生成五份 Spec（真实模型，串行）… 终态 $(wait_task "$T4")"
curl -s $B/projects/$PID/specs -H "$AUTH" | python3 -c '
import sys,json
d=json.load(sys.stdin)["data"]
print("  overall:", d["overall"], "| succeeded:", d["succeeded"], "| failed:", d["failed"])'

# ---------- 真实性校验：Spec 必须不是开发适配器产出 ----------
curl -s $B/projects/$PID/specs -H "$AUTH" | python3 -c '
import sys,json
for i in json.load(sys.stdin)["data"]["items"]:
    if i["status"]=="succeeded": print(i["spec_id"])' > /tmp/gp_specids.txt
STUB=0; REAL=0
while read -r sid; do
  [ -z "${sid:-}" ] && continue
  curl -s $B/specs/$sid -H "$AUTH" | python3 -c '
import sys,json
d=json.load(sys.stdin)["data"]; md=d["content_md"]
stub = "开发适配器" in md
print("    %-6s 字符数=%-6d 章节数=%-4d 含REQ=%-5s 真实模型产出=%s" % (d["role"], len(md), md.count("## "), ("REQ-" in md), (not stub)))
print("STUB" if stub else "REAL")' | tee /tmp/gp_chk.txt | head -1
  if grep -q "^STUB$" /tmp/gp_chk.txt; then STUB=$((STUB+1)); else REAL=$((REAL+1)); fi
done < /tmp/gp_specids.txt
log "Spec 真实性：真实模型产出 $REAL 份 ｜ 开发适配器产出 $STUB 份"
curl -s $B/projects/$PID/versions -H "$AUTH" | python3 -c '
import sys,json
v=json.load(sys.stdin)["data"]["items"]
print("  版本数:", len(v), "｜ current:", sum(1 for x in v if x["status"]=="current"), "｜ 最新 artifacts:", v[0]["artifacts"] if v else None)'
log "完成 ｜ PROJECT=$PID"
