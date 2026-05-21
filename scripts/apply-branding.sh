#!/usr/bin/env bash
# Manifold 品牌化：把 deploy/branding.json 应用到 sub2api（对应 apply-branding.ps1）。
#
# sub2api 自带完整品牌化钩子（site_name / site_logo / site_subtitle / home_content /
# doc_url / contact_info / login_agreement_*），通过 PUT /api/v1/admin/settings 一次性更新。
# 不改 sub2api 源码 = LGPL 零风险。
#
# 工作流程：
#   1. 读 deploy/branding.json（首次先 cp branding.example.json）
#   2. 把每条 agreement.source_file（如 docs/legal/terms-of-service.md）读入 content_md
#   3. 登录 sub2api → PUT /api/v1/admin/settings 整体更新
#   4. 打印差异摘要
#
# 用法：
#   ./scripts/apply-branding.sh                # 用 deploy/branding.json
#   ./scripts/apply-branding.sh --dry-run      # 只算差异不 PUT
#   API_BASE=https://yesterhaze.codes ./scripts/apply-branding.sh   # 生产
#
# 依赖：bash 4+、curl、jq、awk。

set -euo pipefail

# ─── 参数 ────────────────────────────────────────────────────────────
API_BASE="${API_BASE:-http://127.0.0.1:8080}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-base) API_BASE="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"
ENV_PATH="${DEPLOY_DIR}/.env"
BRANDING="${DEPLOY_DIR}/branding.json"
BRANDING_EXAMPLE="${DEPLOY_DIR}/branding.example.json"

log()  { printf '%s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

for bin in curl jq awk; do
  command -v "$bin" >/dev/null || die "缺依赖: $bin"
done

[[ -f "$ENV_PATH" ]] || die "找不到 $ENV_PATH"

# 没有 branding.json 就提示用户复制
if [[ ! -f "$BRANDING" ]]; then
  if [[ -f "$BRANDING_EXAMPLE" ]]; then
    die "找不到 $BRANDING；先：cp $BRANDING_EXAMPLE $BRANDING 再按需编辑"
  else
    die "找不到 $BRANDING 与 $BRANDING_EXAMPLE"
  fi
fi

# 读 .env 一行（含 Windows CRLF trim）
read_env() {
  local k="$1"
  awk -F= -v k="$k" '
    /^[[:space:]]*#/ { next }
    $1==k { sub(/^[^=]*=/,""); gsub(/^[[:space:]]+|[[:space:]]+$/,""); gsub(/^["'\'']|["'\'']$/,""); print; exit }
  ' "$ENV_PATH"
}

ADMIN_EMAIL="$(read_env ADMIN_EMAIL)"
ADMIN_PASSWORD="$(read_env ADMIN_PASSWORD)"
[[ -n "$ADMIN_EMAIL" && -n "$ADMIN_PASSWORD" ]] || die ".env 缺 ADMIN_EMAIL / ADMIN_PASSWORD"

# ─── 1. 加载 branding.json，剥除 _README ───────────────────────────────
brand="$(jq 'del(._README)' "$BRANDING")"

# ─── 2. 把 agreements[].source_file 转成 login_agreement_documents[] ─
agreements="$(echo "$brand" | jq -c '.agreements // []')"
agree_count="$(echo "$agreements" | jq 'length')"

login_docs='[]'
for i in $(seq 0 $((agree_count - 1))); do
  entry="$(echo "$agreements" | jq -c ".[$i]")"
  id="$(echo "$entry" | jq -r '.id')"
  title="$(echo "$entry" | jq -r '.title')"
  src="$(echo "$entry" | jq -r '.source_file')"
  src_abs="${ROOT_DIR}/${src}"
  if [[ ! -f "$src_abs" ]]; then
    die "agreements[$i].source_file 指向的 $src_abs 不存在"
  fi
  content="$(cat "$src_abs")"
  login_docs="$(echo "$login_docs" | jq \
    --arg id "$id" --arg title "$title" --arg content "$content" \
    '. + [{id:$id, title:$title, content_md:$content}]')"
done

# ─── 3. 组装最终 settings payload ────────────────────────────────────
# 保留 brand 里的 site_*, doc_url, contact_info, home_content, login_agreement_*，
# 把 agreements 替换为 login_agreement_documents。
payload="$(echo "$brand" | jq --argjson docs "$login_docs" '
  del(.agreements)
  | .login_agreement_documents = $docs
')"

log "将要 PUT 的字段："
echo "$payload" | jq -r 'keys[]' | sed 's/^/  - /'

if [[ "$DRY_RUN" == "1" ]]; then
  log ""
  log "(--dry-run 模式：不实际 PUT)"
  exit 0
fi

# ─── 4. 登录 ─────────────────────────────────────────────────────────
login_body="$(jq -n --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')"
login_resp="$(curl -sS -X POST -H 'Content-Type: application/json' \
              --max-time 30 --data "$login_body" \
              "${API_BASE}/api/v1/auth/login")" || die "无法连接 ${API_BASE}"
login_code="$(echo "$login_resp" | jq -r '.code // 1')"
[[ "$login_code" == "0" ]] || die "登录失败: $(echo "$login_resp" | jq -r '.message // .')"
TOKEN="$(echo "$login_resp" | jq -r '.data.access_token')"

# ─── 5. PUT settings ─────────────────────────────────────────────────
resp="$(curl -sS --max-time 30 -X PUT \
        -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' \
        --data "$payload" \
        "${API_BASE}/api/v1/admin/settings")"

resp_code="$(echo "$resp" | jq -r '.code // 1')"
if [[ "$resp_code" != "0" ]]; then
  die "PUT /admin/settings 失败: $(echo "$resp" | jq -r '.message // .')"
fi

log ""
log "[+] 已应用品牌化设置到 $API_BASE"
log "    site_name      = $(echo "$payload" | jq -r '.site_name // "(未改)"')"
log "    site_subtitle  = $(echo "$payload" | jq -r '.site_subtitle // "(未改)"')"
log "    agreements     = $agree_count 篇"
log ""
log "如改了 site_logo URL，强制刷新一次浏览器（Ctrl+Shift+R）才能看到新 logo。"
