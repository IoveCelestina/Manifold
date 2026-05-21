#!/usr/bin/env bash
# Manifold 一键完成 sub2api 后台全部配置：登录 → 加余额 → 建 group → 注册 CPA 账号 → 发 API key。
#
# 与 scripts/setup-all.ps1 行为等价的 bash 版。幂等。每次重跑只补齐缺失项，不会重复创建。
# 自动从 deploy/cpa-*/auths/*.json 探测每个 CPA 实例已挂的 OAuth 平台：
#     claude-*.json      → anthropic
#     codex-*.json       → openai
#     gemini-*.json      → gemini
#     antigravity-*.json → antigravity
# 没挂某个平台的 CPA，对应的上游账号会被置 inactive（不删，方便以后补登录）。
# 每发出的明文 key 存到 deploy/data/api-keys.json（已被 .gitignore 屏蔽），下次复用。
# --force 时用时间戳后缀建新 key（旧的留着但不再被本脚本管理）。
#
# 依赖：bash 4+、curl、jq、grep、awk、openssl。server-bootstrap.sh 已经把 jq 装好。
#
# 用法：
#   ./scripts/setup-all.sh
#   ./scripts/setup-all.sh --api-base http://127.0.0.1:8080 --initial-balance 500 --force

set -euo pipefail

# ─── 默认参数 ─────────────────────────────────────────────────────────
API_BASE="http://127.0.0.1:8080"
INITIAL_BALANCE=100
FORCE=0

# ─── 参数解析 ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-base)         API_BASE="$2"; shift 2 ;;
    --initial-balance)  INITIAL_BALANCE="$2"; shift 2 ;;
    --force|-f)         FORCE=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"
ENV_PATH="${DEPLOY_DIR}/.env"
KEY_STORE="${DEPLOY_DIR}/data/api-keys.json"

# ─── 工具函数 ────────────────────────────────────────────────────────
log()  { printf '%s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

for bin in curl jq awk grep; do
  command -v "$bin" >/dev/null || die "缺依赖: $bin"
done

[[ -f "$ENV_PATH" ]] || die "找不到 $ENV_PATH —— 先跑 scripts/init.sh"

# 读 .env 里的某个 key
read_env() {
  local k="$1"
  awk -F= -v k="$k" '
    /^[[:space:]]*#/ { next }
    $1==k { sub(/^[^=]*=/,""); gsub(/^[[:space:]]+|[[:space:]]+$/,""); gsub(/^["'\'']|["'\'']$/,""); print; exit }
  ' "$ENV_PATH"
}

ADMIN_EMAIL="$(read_env ADMIN_EMAIL)"
ADMIN_PASSWORD="$(read_env ADMIN_PASSWORD)"
[[ -n "$ADMIN_EMAIL" && -n "$ADMIN_PASSWORD" ]] \
  || die ".env 里没有 ADMIN_EMAIL / ADMIN_PASSWORD"

# 全局 token，登录后设置
AUTH_TOKEN=""

# api METHOD PATH [JSON_BODY]
# 成功打印 JSON 到 stdout，失败 die。透明检查 code != 0。
api() {
  local method="$1" path="$2" body="${3:-}"
  local url="${API_BASE}${path}"
  local args=(-sS -X "$method" -H "Authorization: Bearer ${AUTH_TOKEN}" --max-time 30 "$url")
  if [[ -n "$body" ]]; then
    args+=(-H 'Content-Type: application/json' --data "$body")
  fi
  local resp
  if ! resp="$(curl "${args[@]}")"; then
    die "API $method $path 请求失败"
  fi
  # 校验是 JSON
  echo "$resp" | jq . >/dev/null 2>&1 || die "API $method $path 返回非 JSON: $resp"
  local code
  code="$(echo "$resp" | jq -r '.code // empty')"
  if [[ -n "$code" && "$code" != "0" ]]; then
    local msg
    msg="$(echo "$resp" | jq -r '.message // ""')"
    die "API $method $path -> code=$code msg=$msg"
  fi
  printf '%s' "$resp"
}

# ─── 1. 登录 ─────────────────────────────────────────────────────────
login_body="$(jq -n --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')"
login_resp="$(curl -sS -X POST -H 'Content-Type: application/json' \
              --max-time 30 --data "$login_body" \
              "${API_BASE}/api/v1/auth/login")" || die "无法连接 ${API_BASE}"
login_code="$(echo "$login_resp" | jq -r '.code // 1')"
[[ "$login_code" == "0" ]] || die "登录 sub2api 失败: $(echo "$login_resp" | jq -r '.message // .')"
AUTH_TOKEN="$(echo "$login_resp" | jq -r '.data.access_token')"
ADMIN_ID="$(echo "$login_resp" | jq -r '.data.user.id')"
ADMIN_BALANCE="$(echo "$login_resp" | jq -r '.data.user.balance')"
log "[1] 登录 admin (id=${ADMIN_ID}, balance=${ADMIN_BALANCE})"

# ─── 2. 余额 ─────────────────────────────────────────────────────────
# bash 不擅长浮点，借 awk 比较
need_topup="$(awk -v c="$ADMIN_BALANCE" -v t="$INITIAL_BALANCE" 'BEGIN{print (c<t)?1:0}')"
if [[ "$need_topup" == "1" ]]; then
  delta="$(awk -v c="$ADMIN_BALANCE" -v t="$INITIAL_BALANCE" 'BEGIN{printf "%g", t-c}')"
  body="$(jq -n --argjson b "$delta" '{balance:$b, operation:"add", notes:"setup-all.sh topup"}')"
  api POST "/api/v1/admin/users/${ADMIN_ID}/balance" "$body" >/dev/null
  log "[2] 余额 +${delta} -> ${INITIAL_BALANCE}"
else
  log "[2] 余额 ${ADMIN_BALANCE} >= ${INITIAL_BALANCE}，跳过"
fi

# ─── 3. 探测 CPA 实例 + OAuth 平台 ─────────────────────────────────
log "[3] 探测 CPA 实例 + OAuth 平台..."

# 平台前缀 → sub2api 的 platform 枚举
declare -a PREFIX_ORDER=(claude- codex- gemini- antigravity-)
declare -A PREFIX_PLATFORM=(
  [claude-]=anthropic
  [codex-]=openai
  [gemini-]=gemini
  [antigravity-]=antigravity
)

# 探测结果：用并行数组存（bash 关联数组不能存数组）
declare -a CPA_NAMES=()
declare -A CPA_APIKEY=()
declare -A CPA_BASEURL=()
declare -A CPA_PLATFORMS=()      # space-separated 平台清单
declare -A ALL_ACTIVE_PLATFORMS=() # 集合：跨所有 CPA 出现过的平台

shopt -s nullglob
for dir in "${DEPLOY_DIR}"/cpa-*/; do
  cpa_name="$(basename "$dir")"
  cfg="${dir}config.yaml"
  if [[ ! -f "$cfg" ]]; then
    warn "${cpa_name} 缺 config.yaml，跳过；先跑 scripts/init.sh --force"
    continue
  fi
  # 抓 config.yaml 里第一条 32+ hex 的 api-key
  api_key="$(grep -oE '"[0-9a-f]{32,}"' "$cfg" | head -n1 | tr -d '"' || true)"
  if [[ -z "$api_key" ]]; then
    warn "${cpa_name}/config.yaml 找不到 api-keys，跳过"
    continue
  fi

  auths_dir="${dir}auths"
  platforms=""
  if [[ -d "$auths_dir" ]]; then
    for f in "$auths_dir"/*.json; do
      [[ -f "$f" ]] || continue
      name="$(basename "$f")"
      for prefix in "${PREFIX_ORDER[@]}"; do
        if [[ "$name" == "$prefix"* ]]; then
          p="${PREFIX_PLATFORM[$prefix]}"
          # 去重追加
          case " $platforms " in
            *" $p "*) ;;
            *) platforms="${platforms:+$platforms }$p" ;;
          esac
          ALL_ACTIVE_PLATFORMS[$p]=1
          break
        fi
      done
    done
  fi

  CPA_NAMES+=("$cpa_name")
  CPA_APIKEY[$cpa_name]="$api_key"
  CPA_BASEURL[$cpa_name]="http://${cpa_name}:8317"
  CPA_PLATFORMS[$cpa_name]="$platforms"

  shown="${platforms:-(空载)}"
  printf '    %-6s -> %s\n' "$cpa_name" "$shown"
done
shopt -u nullglob

[[ ${#CPA_NAMES[@]} -gt 0 ]] || die "没探到 CPA 实例"

if [[ ${#ALL_ACTIVE_PLATFORMS[@]} -eq 0 ]]; then
  err "所有 CPA 都没挂 OAuth，没法发可用 key。先在 CPA 容器里跑 -claude-login / -codex-login 之类。"
  exit 2
fi

# ─── 4. 确保每个平台有 group ─────────────────────────────────────────
log ""
log "[4] 确保每个平台有 group..."
declare -A PLATFORM_GROUP_ID=()

groups_resp="$(api GET "/api/v1/admin/groups?page_size=100")"
for p in "${!ALL_ACTIVE_PLATFORMS[@]}"; do
  # 优先按 name 匹配，否则按 platform
  gid="$(echo "$groups_resp" | jq -r --arg n "$p" '.data.items[]? | select(.name==$n) | .id' | head -n1)"
  if [[ -z "$gid" ]]; then
    gid="$(echo "$groups_resp" | jq -r --arg p "$p" '.data.items[]? | select(.platform==$p) | .id' | head -n1)"
  fi
  if [[ -z "$gid" ]]; then
    body="$(jq -n --arg n "$p" --arg p "$p" '{
      name:$n, platform:$p, rate_multiplier:1.0,
      subscription_type:"standard",
      description:("Manifold auto-created group for " + $p)
    }')"
    r="$(api POST "/api/v1/admin/groups" "$body")"
    gid="$(echo "$r" | jq -r '.data.id')"
    log "  [+] 新 group: name=$p id=$gid"
    # 刷新 groups_resp 以便后续平台命中
    groups_resp="$(api GET "/api/v1/admin/groups?page_size=100")"
  fi
  PLATFORM_GROUP_ID[$p]="$gid"
done

# ─── 5. 注册 / 更新上游账号 ──────────────────────────────────────────
log ""
log "[5] 注册/更新上游账号..."

# 拉一次全量账号缓存，函数内更新
accounts_resp="$(api GET "/api/v1/admin/accounts?page_size=500")"

ensure_account() {
  local name="$1" platform="$2" base_url="$3" api_key="$4" group_id="$5" desired_status="$6"

  local found_id found_status found_group_ids
  found_id="$(echo "$accounts_resp" | jq -r --arg n "$name" '.data.items[]? | select(.name==$n) | .id' | head -n1)"

  if [[ -n "$found_id" ]]; then
    found_status="$(echo "$accounts_resp" | jq -r --arg n "$name" '.data.items[]? | select(.name==$n) | .status' | head -n1)"
    found_group_ids="$(echo "$accounts_resp" | jq -c --arg n "$name" '.data.items[]? | select(.name==$n) | .group_ids' | head -n1)"
    local patch="{}"
    local changed=0
    if [[ "$found_status" != "$desired_status" ]]; then
      patch="$(echo "$patch" | jq --arg s "$desired_status" '. + {status:$s}')"
      changed=1
    fi
    local has_group
    has_group="$(echo "$found_group_ids" | jq --argjson g "$group_id" 'index($g)')"
    if [[ "$has_group" == "null" ]]; then
      patch="$(echo "$patch" | jq --argjson g "$group_id" '. + {group_ids:[$g]}')"
      changed=1
    fi
    if [[ "$changed" == "1" ]]; then
      api PUT "/api/v1/admin/accounts/${found_id}" "$patch" >/dev/null
      log "  [~] $name 更新: $(echo "$patch" | jq -c .)"
    else
      log "  [=] $name 已就位"
    fi
    return 0
  fi

  local body
  body="$(jq -n \
    --arg name "$name" \
    --arg platform "$platform" \
    --arg base_url "$base_url" \
    --arg api_key "$api_key" \
    --argjson gid "$group_id" '{
      name:$name, platform:$platform, type:"apikey",
      credentials:{api_key:$api_key, base_url:$base_url},
      group_ids:[$gid], concurrency:5, priority:100
    }')"
  local r new_id
  r="$(api POST "/api/v1/admin/accounts" "$body")"
  new_id="$(echo "$r" | jq -r '.data.id')"
  log "  [+] $name 新建 id=$new_id"
  # 刷新缓存
  accounts_resp="$(api GET "/api/v1/admin/accounts?page_size=500")"
}

for cpa_name in "${CPA_NAMES[@]}"; do
  cpa_platforms=" ${CPA_PLATFORMS[$cpa_name]} "
  for p in "${!ALL_ACTIVE_PLATFORMS[@]}"; do
    acc_name="${cpa_name}-${p}"
    if [[ "$cpa_platforms" == *" $p "* ]]; then
      ensure_account "$acc_name" "$p" \
        "${CPA_BASEURL[$cpa_name]}" "${CPA_APIKEY[$cpa_name]}" \
        "${PLATFORM_GROUP_ID[$p]}" "active"
    else
      # 空载组合：现有同名账号置 inactive
      f_id="$(echo "$accounts_resp" | jq -r --arg n "$acc_name" '.data.items[]? | select(.name==$n) | .id' | head -n1)"
      f_status="$(echo "$accounts_resp" | jq -r --arg n "$acc_name" '.data.items[]? | select(.name==$n) | .status' | head -n1)"
      if [[ -n "$f_id" && "$f_status" != "inactive" ]]; then
        api PUT "/api/v1/admin/accounts/${f_id}" '{"status":"inactive"}' >/dev/null
        log "  [~] $acc_name 置 inactive (该 CPA 未挂 $p)"
        accounts_resp="$(api GET "/api/v1/admin/accounts?page_size=500")"
      fi
    fi
  done
done

# ─── 6. 发 / 复用 user API key ───────────────────────────────────────
log ""
log "[6] 发/复用 user API key..."

mkdir -p "$(dirname "$KEY_STORE")"
if [[ -f "$KEY_STORE" ]]; then
  store="$(cat "$KEY_STORE")"
else
  store='{}'
fi

# 拉用户当前持有 keys
keys_resp="$(api GET "/api/v1/keys?page_size=500")"

declare -a SUMMARY_PLATFORM=()
declare -a SUMMARY_KEYNAME=()
declare -a SUMMARY_KEYID=()
declare -a SUMMARY_PLAINTEXT=()
declare -a SUMMARY_GROUPID=()

ensure_key() {
  local name="$1" group_id="$2"

  local stored_id stored_key
  stored_id="$(echo "$store" | jq -r --arg n "$name" '.[$n].id // empty')"
  stored_key="$(echo "$store" | jq -r --arg n "$name" '.[$n].key // empty')"

  local live_match
  live_match=""
  if [[ -n "$stored_id" ]]; then
    live_match="$(echo "$keys_resp" | jq -r --arg id "$stored_id" '.data.items[]? | select((.id|tostring)==$id) | .id' | head -n1)"
  fi

  if [[ "$FORCE" != "1" && -n "$stored_id" && -n "$live_match" ]]; then
    local live_group
    live_group="$(echo "$keys_resp" | jq -r --arg id "$stored_id" '.data.items[]? | select((.id|tostring)==$id) | .group_id' | head -n1)"
    if [[ "$live_group" != "$group_id" ]]; then
      api PUT "/api/v1/admin/api-keys/${stored_id}" "$(jq -n --argjson g "$group_id" '{group_id:$g}')" >/dev/null
      log "  [~] $name 修正 group_id -> $group_id"
    fi
    log "  [=] $name 已存在 id=${stored_id}，复用 KeyStore 明文"
    # 输出到全局
    LAST_KEY_ID="$stored_id"
    LAST_KEY_PLAINTEXT="$stored_key"
    LAST_KEY_NAME="$name"
    return 0
  fi

  local effective_name
  if [[ "$FORCE" == "1" && -n "$stored_id" ]]; then
    effective_name="${name}-$(date +%Y%m%d%H%M%S)"
  else
    effective_name="$name"
  fi

  local r new_id plaintext
  r="$(api POST "/api/v1/keys" "$(jq -n --arg n "$effective_name" '{name:$n}')")"
  new_id="$(echo "$r" | jq -r '.data.id')"
  plaintext="$(echo "$r" | jq -r '.data.key')"
  api PUT "/api/v1/admin/api-keys/${new_id}" "$(jq -n --argjson g "$group_id" '{group_id:$g}')" >/dev/null
  log "  [+] $effective_name 新发 id=$new_id"

  LAST_KEY_ID="$new_id"
  LAST_KEY_PLAINTEXT="$plaintext"
  LAST_KEY_NAME="$effective_name"
}

for p in "${!ALL_ACTIVE_PLATFORMS[@]}"; do
  kname="manifold-${p}"
  ensure_key "$kname" "${PLATFORM_GROUP_ID[$p]}"

  # 写回 store（用原 kname 作 key，与 ps1 一致）
  store="$(echo "$store" | jq \
    --arg name "$kname" \
    --arg id "$LAST_KEY_ID" \
    --arg key "${LAST_KEY_PLAINTEXT:-}" \
    --argjson gid "${PLATFORM_GROUP_ID[$p]}" \
    --arg plat "$p" \
    --arg actual "$LAST_KEY_NAME" '
      .[$name] = (
        (.[$name] // {})
        | .id = ($id | tonumber? // $id)
        | (if $key != "" then .key = $key else . end)
        | .group_id = $gid
        | .platform = $plat
        | .actual_name = $actual
      )
    ')"

  SUMMARY_PLATFORM+=("$p")
  SUMMARY_KEYNAME+=("$LAST_KEY_NAME")
  SUMMARY_KEYID+=("$LAST_KEY_ID")
  SUMMARY_PLAINTEXT+=("${LAST_KEY_PLAINTEXT:-}")
  SUMMARY_GROUPID+=("${PLATFORM_GROUP_ID[$p]}")
done

printf '%s' "$store" | jq . > "$KEY_STORE"

# ─── 7. summary ─────────────────────────────────────────────────────
log ""
printf '\033[1;32m================ 配置完成 ================\033[0m\n'
log ""

print_platform_guide() {
  local p="$1"
  case "$p" in
    anthropic)
      echo "  Endpoint      : ${API_BASE}/v1/messages"
      echo "  样例 model    : claude-sonnet-4-5-20250929"
      echo "  额外请求头    : anthropic-version: 2023-06-01"
      ;;
    openai)
      echo "  Endpoint      : ${API_BASE}/v1/chat/completions"
      echo "  样例 model    : gpt-5.4-mini"
      ;;
    gemini)
      echo "  Endpoint      : ${API_BASE}/v1beta/models/<model>:generateContent"
      echo "  样例 model    : gemini-2.5-pro"
      ;;
    antigravity)
      echo "  Endpoint      : ${API_BASE}/antigravity/v1/messages"
      echo "  样例 model    : <查 CPA /v1/models>"
      ;;
  esac
}

for i in "${!SUMMARY_PLATFORM[@]}"; do
  p="${SUMMARY_PLATFORM[$i]}"
  plain="${SUMMARY_PLAINTEXT[$i]}"
  printf '\033[1;36m[%s]\033[0m\n' "$(echo "$p" | tr '[:lower:]' '[:upper:]')"
  if [[ -n "$plain" ]]; then
    echo "  Manifold key  : $plain"
  else
    echo "  Manifold key  : (复用，明文见 ${KEY_STORE})"
  fi
  print_platform_guide "$p"
  echo ""
done

printf '\033[2m明文 key 存档    : %s\033[0m\n' "$KEY_STORE"
printf '\033[2m下次重跑会复用，--force 会用时间戳后缀新发。\033[0m\n'
