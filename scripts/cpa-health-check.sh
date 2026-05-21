#!/usr/bin/env bash
# Manifold CPA 上游账号健康巡检（bash 版，对应 cpa-health-check.ps1）
#
# 设计：
#   sub2api 自带"软降级"—— 账号被上游 429 / 5xx 后写 rate_limited_at / overload_until /
#   temp_unschedulable_until，调度器自动跳过；窗口结束后恢复。
#
#   这个脚本补 sub2api 没做的两件事：
#     1. 持续故障：连续 N 次巡检都"不可调度"的账号 → 永久 status=inactive，人工介入才恢复
#     2. Telegram 告警：状态变化即时通知（每次只发一次，不重复刷屏）
#
# 用法：
#   ./scripts/cpa-health-check.sh
#   STRIKES=3 INTERVAL_MIN=5 ./scripts/cpa-health-check.sh
#
# 推荐通过 cron 调用：
#   */5 * * * * cd /opt/manifold && ./scripts/cpa-health-check.sh >> /var/log/manifold-health.log 2>&1
#
# 环境变量（也可以放 .env 由 cron 行 export）：
#   API_BASE                 默认 http://127.0.0.1:8080
#   ADMIN_EMAIL/PASSWORD     从 deploy/.env 自动读
#   TELEGRAM_BOT_TOKEN       告警 bot；留空则不发 Telegram
#   TELEGRAM_CHAT_ID         接收的 chat
#   STRIKES                  连续 N 次异常后自动 inactive（默认 3）
#   STATE_FILE               巡检状态文件（默认 deploy/data/cpa-health-state.json）
#
# 依赖：bash 4+、curl、jq、awk。

set -euo pipefail

# ─── 默认参数 ─────────────────────────────────────────────────────────
API_BASE="${API_BASE:-http://127.0.0.1:8080}"
STRIKES="${STRIKES:-3}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"
ENV_PATH="${DEPLOY_DIR}/.env"
STATE_FILE="${STATE_FILE:-${DEPLOY_DIR}/data/cpa-health-state.json}"

# ─── 工具函数 ────────────────────────────────────────────────────────
log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die()  { log "ERROR: $*" >&2; exit 1; }

for bin in curl jq awk; do
  command -v "$bin" >/dev/null || die "缺依赖: $bin"
done

[[ -f "$ENV_PATH" ]] || die "找不到 $ENV_PATH —— 先跑 scripts/init.sh"

# 读 .env 一行的值，剥引号 + trim 空白（包含 Windows CRLF 的 \r）
read_env() {
  local k="$1"
  awk -F= -v k="$k" '
    /^[[:space:]]*#/ { next }
    $1==k { sub(/^[^=]*=/,""); gsub(/^[[:space:]]+|[[:space:]]+$/,""); gsub(/^["'\'']|["'\'']$/,""); print; exit }
  ' "$ENV_PATH"
}

ADMIN_EMAIL="$(read_env ADMIN_EMAIL)"
ADMIN_PASSWORD="$(read_env ADMIN_PASSWORD)"
[[ -n "$ADMIN_EMAIL" && -n "$ADMIN_PASSWORD" ]] || die ".env 里没有 ADMIN_EMAIL / ADMIN_PASSWORD"

# 不在脚本里硬依赖 .env 的 TELEGRAM_*，让运维有选择留空 / 用环境变量
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(read_env TELEGRAM_BOT_TOKEN || true)}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-$(read_env TELEGRAM_CHAT_ID || true)}"

# Telegram 发送（Markdown）。任何错误都吞掉，不能因为 TG 挂了让巡检失败
notify() {
  local title="$1" body="$2"
  if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]]; then
    log "  (Telegram 未配，跳过通知: $title)"
    return 0
  fi
  local text
  text="$(printf '*%s*\n```\n%s\n```' "$title" "$body")"
  curl -sS --max-time 10 -o /dev/null \
    -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "parse_mode=Markdown" \
    --data-urlencode "text=${text}" \
    || log "  (Telegram 发送失败)"
}

# ─── 1. 登录 ─────────────────────────────────────────────────────────
login_body="$(jq -n --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')"
login_resp="$(curl -sS -X POST -H 'Content-Type: application/json' \
              --max-time 30 --data "$login_body" \
              "${API_BASE}/api/v1/auth/login")" || die "无法连接 ${API_BASE}"
login_code="$(echo "$login_resp" | jq -r '.code // 1')"
[[ "$login_code" == "0" ]] || die "登录 sub2api 失败: $(echo "$login_resp" | jq -r '.message // .')"
TOKEN="$(echo "$login_resp" | jq -r '.data.access_token')"

# ─── 2. 拉账号清单 ───────────────────────────────────────────────────
accounts_resp="$(curl -sS -H "Authorization: Bearer $TOKEN" --max-time 30 \
                  "${API_BASE}/api/v1/admin/accounts?page_size=500")"
acc_code="$(echo "$accounts_resp" | jq -r '.code // 1')"
[[ "$acc_code" == "0" ]] || die "拉账号失败: $(echo "$accounts_resp" | jq -r '.message // .')"

# 只看 active 的（已经 inactive 的不重复告警）
active_count="$(echo "$accounts_resp" | jq '[.data.items[] | select(.status=="active")] | length')"
log "巡检 ${active_count} 个 active 账号"

# ─── 3. 读上次状态 ───────────────────────────────────────────────────
mkdir -p "$(dirname "$STATE_FILE")"
if [[ -f "$STATE_FILE" ]]; then
  prev_state="$(cat "$STATE_FILE")"
else
  prev_state='{}'
fi
new_state='{}'

now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 判定账号当前是否"不健康"。规则：
#   - schedulable == false
#   - 或 temp_unschedulable_until / overload_until / rate_limit_reset_at 在未来
# 返回当前异常原因字符串，健康时返回空字符串。
account_unhealthy_reason() {
  local acc="$1"
  echo "$acc" | jq -r --arg now "$now_iso" '
    . as $a |
    [
      (if ($a.schedulable // true) == false then "schedulable=false" else empty end),
      (if ($a.temp_unschedulable_until // null) != null and ($a.temp_unschedulable_until > $now) then "temp_unschedulable until " + $a.temp_unschedulable_until else empty end),
      (if ($a.overload_until // null) != null and ($a.overload_until > $now) then "overload until " + $a.overload_until else empty end),
      (if ($a.rate_limit_reset_at // null) != null and ($a.rate_limit_reset_at > $now) then "rate_limited until " + $a.rate_limit_reset_at else empty end)
    ] | join(";")
  '
}

# ─── 4. 逐账号判定并处置 ─────────────────────────────────────────────
alerts_new=()       # 状态从健康 → 异常
alerts_recovered=() # 状态从异常 → 健康
alerts_inactive=()  # 连续 STRIKES 次异常 → 永久 inactive

# 遍历每个 active 账号
while IFS= read -r acc; do
  id="$(echo "$acc" | jq -r '.id')"
  name="$(echo "$acc" | jq -r '.name')"
  reason="$(account_unhealthy_reason "$acc")"

  # 上次的连续异常计数
  prev_strikes="$(echo "$prev_state" | jq -r --arg n "$name" '.[$n].strikes // 0')"
  prev_reason="$(echo "$prev_state" | jq -r --arg n "$name" '.[$n].reason // ""')"

  if [[ -n "$reason" ]]; then
    # 当前异常
    new_strikes=$((prev_strikes + 1))
    log "  [!] $name 异常 ($new_strikes/$STRIKES): $reason"

    # 刚从健康变异常 → 告警一次
    if [[ "$prev_strikes" == "0" ]]; then
      alerts_new+=("$name | $reason")
    fi

    # 累计达阈值 → 永久 inactive（仅做一次）
    if (( new_strikes >= STRIKES )); then
      already_inactive="$(echo "$prev_state" | jq -r --arg n "$name" '.[$n].force_inactive // false')"
      if [[ "$already_inactive" != "true" ]]; then
        log "  [x] $name 连续 $new_strikes 次异常，置 inactive"
        body="$(jq -n '{status:"inactive"}')"
        curl -sS --max-time 30 \
          -X PUT -H "Authorization: Bearer $TOKEN" \
          -H 'Content-Type: application/json' \
          --data "$body" \
          "${API_BASE}/api/v1/admin/accounts/${id}" >/dev/null \
          || log "  (置 inactive 失败 id=$id)"
        alerts_inactive+=("$name (连续 $new_strikes 次): $reason")
        new_state="$(echo "$new_state" | jq --arg n "$name" --arg r "$reason" --argjson s "$new_strikes" \
          '.[$n] = {strikes:$s, reason:$r, force_inactive:true, last_check:"'"$now_iso"'"}')"
        continue
      fi
    fi

    new_state="$(echo "$new_state" | jq --arg n "$name" --arg r "$reason" --argjson s "$new_strikes" \
      '.[$n] = {strikes:$s, reason:$r, force_inactive:false, last_check:"'"$now_iso"'"}')"
  else
    # 当前健康
    if [[ "$prev_strikes" != "0" && "$prev_strikes" != "null" ]]; then
      log "  [+] $name 恢复健康 (此前连续 $prev_strikes 次异常: $prev_reason)"
      alerts_recovered+=("$name (前次: $prev_reason)")
    fi
    # 不写入 new_state —— 健康账号从状态文件中淘汰，保持文件小
  fi
done < <(echo "$accounts_resp" | jq -c '.data.items[] | select(.status=="active")')

# ─── 5. 写状态文件 ───────────────────────────────────────────────────
printf '%s' "$new_state" | jq . > "$STATE_FILE"

# ─── 6. 告警 ─────────────────────────────────────────────────────────
if (( ${#alerts_inactive[@]} > 0 )); then
  body="$(printf '%s\n' "${alerts_inactive[@]}")"
  notify "🛑 Manifold: 账号已置 inactive" "$body"
fi
if (( ${#alerts_new[@]} > 0 )); then
  body="$(printf '%s\n' "${alerts_new[@]}")"
  notify "⚠ Manifold: 账号异常" "$body"
fi
if (( ${#alerts_recovered[@]} > 0 )); then
  body="$(printf '%s\n' "${alerts_recovered[@]}")"
  notify "✅ Manifold: 账号恢复" "$body"
fi

# 即使无事也打一行收尾日志，方便从 log 推断 cron 还在跑
if (( ${#alerts_new[@]} + ${#alerts_recovered[@]} + ${#alerts_inactive[@]} == 0 )); then
  log "全部健康 (${active_count} 账号)"
fi
