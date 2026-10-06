#!/usr/bin/env bash
# Manifold 域名更新：默认预览，--deploy 备份并更新 .env、Caddy 与博客。
#   bash scripts/update-domains.sh --list
#   bash scripts/update-domains.sh --add new.example.com --deploy
#   bash scripts/update-domains.sh --remove old.example.com --deploy
#   bash scripts/update-domains.sh --add new.example.com --remove old.example.com --dry-run
# --domains 仍可整体替换；增删自动读取当前配置。新增域名请提前配置 DNS。
# 依赖：Linux、Bash 4+、flock；--deploy 另需 Docker Compose v2、curl。
set -euo pipefail
umask 077

log() { printf '[domains] %s\n' "$*"; }
die() { printf '[domains] ERROR: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOMAIN_LIST=''
ADD_LIST=''
REMOVE_LIST=''
LIST_ONLY=0
DO_DEPLOY=0
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domains|--add|--remove|--root)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 需要参数"
      case "$1" in
        --domains) DOMAIN_LIST="$2" ;;
        --add) ADD_LIST+="${ADD_LIST:+,}$2" ;;
        --remove) REMOVE_LIST+="${REMOVE_LIST:+,}$2" ;;
        --root) ROOT_DIR="$2" ;;
      esac
      shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    --deploy) DO_DEPLOY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done
[[ -n "$DOMAIN_LIST$ADD_LIST$REMOVE_LIST" || "$LIST_ONLY" -eq 1 ]] || die '请使用 --add、--remove、--list 或 --domains'
[[ -z "$DOMAIN_LIST" || -z "$ADD_LIST$REMOVE_LIST" ]] || die '--domains 不能与 --add/--remove 同用'
[[ "$LIST_ONLY" -eq 0 || ( -z "$DOMAIN_LIST$ADD_LIST$REMOVE_LIST" && "$DO_DEPLOY" -eq 0 ) ]] || die '--list 不能与修改或部署参数同用'

validate_domain() {
  local domain="$1" label
  local -a labels=()
  [[ ${#domain} -le 248 && "$domain" == *.* && "$domain" != *..* ]] || die "无效域名: $domain"
  [[ "$domain" =~ ^[a-z0-9.-]+$ && "${domain##*.}" =~ [a-z] ]] || die "请只填写域名（不要协议、端口、路径或通配符）: $domain"
  IFS='.' read -r -a labels <<< "$domain"
  [[ "$domain" != .* && "$domain" != *. ]] || die "无效域名: $domain"
  for label in "${labels[@]}"; do
    [[ ${#label} -le 63 && "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || die "无效域名标签: $domain"
  done
}

normalize_list() {
  local value="${1,,}" domain result=''
  local -a items=()
  local -A seen=()
  [[ "$value" =~ ^[a-z0-9.,-]+$ ]] || die '域名列表只能包含 ASCII 域名与逗号；国际化域名请使用 Punycode'
  [[ "$value" != ,* && "$value" != *, && "$value" != *,,* ]] || die '域名列表含空项'
  IFS=',' read -r -a items <<< "$value"
  for domain in "${items[@]}"; do
    validate_domain "$domain"
    [[ -z "${seen[$domain]:-}" ]] || continue
    seen[$domain]=1
    result+="${result:+,}$domain"
  done
  printf '%s' "$result"
}
if [[ -n "$DOMAIN_LIST" ]]; then DOMAIN_LIST="$(normalize_list "$DOMAIN_LIST")"; fi
if [[ -n "$ADD_LIST" ]]; then ADD_LIST="$(normalize_list "$ADD_LIST")"; fi
if [[ -n "$REMOVE_LIST" ]]; then REMOVE_LIST="$(normalize_list "$REMOVE_LIST")"; fi

ROOT_DIR="$(cd "$ROOT_DIR" && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
ENV_FILE="$DEPLOY_DIR/.env"
COMPOSE_FILE_PATH="$DEPLOY_DIR/docker-compose.yml"
# Lock before reading the current list, so concurrent additions cannot lose updates.
if [[ "$DO_DEPLOY" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
  [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || die '需要已有的 deploy/.env 普通文件；请先初始化部署'
  command -v flock >/dev/null || die '需要 flock（util-linux）'
  mkdir -p "$ROOT_DIR/backups"
  exec 9>"$ROOT_DIR/backups/.update-domains.lock"
  flock -n 9 || die '另一个域名更新任务正在运行'
  ENV_FINGERPRINT="$(sha256sum < "$ENV_FILE")"
fi

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  printf '%s' "${value%"${value##*[![:space:]]}"}"
}
# Read only literal domain settings; never execute or interpolate .env contents.
read_setting() {
  local key="$1" line value='' quote tail
  local pattern="^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=(.*)$"
  if [[ -f "$ENV_FILE" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ $pattern ]]; then value="${BASH_REMATCH[2]}"; fi
    done < "$ENV_FILE"
  fi
  value="$(trim "$value")"
  quote="${value:0:1}"
  if [[ "$quote" == \" || "$quote" == "'" ]]; then
    value="${value:1}"
    [[ "$value" == *"$quote"* ]] || die "$key 缺少闭合引号"
    tail="$(trim "${value#*"$quote"}")"
    [[ -z "$tail" || "$tail" == \#* ]] || die "$key 包含不支持的表达式"
    value="${value%%"$quote"*}"
  else
    value="${value%%[[:space:]]#*}"
  fi
  trim "$value"
}

current_domains() {
  local value line root_domain primary result='' i
  local -a entries=() roots=()
  value="$(read_setting SITE_DOMAINS)" || return 1
  if [[ -z "$value" ]]; then
    # Resolve the repository's default without maintaining a third domain list.
    # shellcheck disable=SC2016
    local pattern='^\{\$SITE_DOMAINS:([^}]+)\}'
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ $pattern ]]; then value="${BASH_REMATCH[1]}"; break; fi
    done < "$DEPLOY_DIR/Caddyfile"
  fi
  [[ -n "$value" && "$value" != *, ]] || die '无法读取当前域名；可用 --domains 明确设置完整列表'
  IFS=',' read -r -a entries <<< "$value"
  [[ $((${#entries[@]} % 2)) -eq 0 ]] || die 'SITE_DOMAINS 不是主域名/www 配对列表；请用 --domains 整体设置'
  for ((i=0; i<${#entries[@]}; i+=2)); do
    root_domain="$(trim "${entries[i]}")"
    root_domain="${root_domain,,}"
    validate_domain "$root_domain"
    line="$(trim "${entries[i+1]}")"
    [[ "${line,,}" == "www.$root_domain" ]] || die 'SITE_DOMAINS 含自定义映射；请用 --domains 明确设置完整列表'
    roots+=("$root_domain")
  done
  primary="$(read_setting BLOG_SITE_URL)" || return 1
  if [[ -n "$primary" ]]; then
    [[ "$primary" == https://blog.* ]] || die 'BLOG_SITE_URL 不是有效的博客主域名'
    primary="${primary#https://blog.}"
    primary="${primary%/}"
    primary="${primary,,}"
    [[ ",$(join_with ',' "${roots[@]}")," == *",$primary,"* ]] || die '博客主域名不在当前列表中；请用 --domains 整体设置'
    result="$primary"
  fi
  for root_domain in "${roots[@]}"; do
    [[ "$root_domain" == "$primary" ]] || result+="${result:+,}$root_domain"
  done
  normalize_list "$result"
}

join_with() {
  local separator="$1" result='' item
  shift
  for item in "$@"; do result+="${result:+$separator}$item"; done
  printf '%s' "$result"
}
CURRENT_LIST=''
if [[ -z "$DOMAIN_LIST" ]]; then
  CURRENT_LIST="$(current_domains)"
  log "当前域名: $CURRENT_LIST"
  if [[ "$LIST_ONLY" -eq 1 ]]; then
    log "当前主域名: ${CURRENT_LIST%%,*}"
    exit 0
  fi
  declare -a current=() additions=() removals=() target=()
  declare -A add_set=() remove_set=() current_set=()
  IFS=',' read -r -a current <<< "$CURRENT_LIST"
  if [[ -n "$ADD_LIST" ]]; then IFS=',' read -r -a additions <<< "$ADD_LIST"; fi
  if [[ -n "$REMOVE_LIST" ]]; then IFS=',' read -r -a removals <<< "$REMOVE_LIST"; fi
  for domain in "${additions[@]}"; do add_set[$domain]=1; done
  for domain in "${removals[@]}"; do
    [[ -z "${add_set[$domain]:-}" ]] || die "同一个域名不能同时添加和删除: $domain"
    remove_set[$domain]=1
  done
  for domain in "${current[@]}"; do
    current_set[$domain]=1
    [[ -n "${remove_set[$domain]:-}" ]] || target+=("$domain")
  done
  for domain in "${removals[@]}"; do
    [[ -n "${current_set[$domain]:-}" ]] || log "域名不存在，跳过删除: $domain"
  done
  for domain in "${additions[@]}"; do
    if [[ -n "${current_set[$domain]:-}" ]]; then
      log "域名已存在，跳过添加: $domain"
    else
      target+=("$domain")
    fi
  done
  [[ ${#target[@]} -gt 0 ]] || die '至少保留一个域名；可在删除旧域名时同时 --add 新域名'
  DOMAIN_LIST="$(join_with ',' "${target[@]}")"
  if [[ "$DOMAIN_LIST" == "$CURRENT_LIST" ]]; then
    log '域名集合没有变化，未写配置或部署。'
    exit 0
  fi
fi
log "目标域名: $DOMAIN_LIST；主域名: ${DOMAIN_LIST%%,*}"
declare -a sites=() chats=() blogs=() input_domains=()
declare -A addresses=()
IFS=',' read -r -a input_domains <<< "$DOMAIN_LIST"
for domain in "${input_domains[@]}"; do
  sites+=("$domain" "www.$domain")
  chats+=("chat.$domain")
  blogs+=("blog.$domain")
done
for address in "${sites[@]}" "${chats[@]}" "${blogs[@]}"; do
  [[ -z "${addresses[$address]:-}" ]] || die "主站与子站域名冲突: $address"
  addresses[$address]=1
done
SITE_DOMAINS="$(join_with ', ' "${sites[@]}")"
CHAT_DOMAINS="$(join_with ', ' "${chats[@]}")"
BLOG_DOMAINS="$(join_with ', ' "${blogs[@]}")"
BLOG_TRUSTED_HOSTS="$(join_with ',' "${blogs[@]}")"
BLOG_SITE_URL="https://${blogs[0]}"
print_values() {
  printf 'SITE_DOMAINS=%s\nCHAT_DOMAINS=%s\nBLOG_DOMAINS=%s\nBLOG_TRUSTED_HOSTS=%s\nBLOG_SITE_URL=%s\n' \
    "$SITE_DOMAINS" "$CHAT_DOMAINS" "$BLOG_DOMAINS" "$BLOG_TRUSTED_HOSTS" "$BLOG_SITE_URL"
}
print_values
if [[ "$DRY_RUN" -eq 1 || "$DO_DEPLOY" -eq 0 ]]; then
  log '预览完成，未写文件或执行部署。请为每个主域及 www/chat/blog 配好 DNS。'
  exit 0
fi

# Match the literal template placeholders, not the current shell values.
# shellcheck disable=SC2016
grep -Fq '{$SITE_DOMAINS:' "$DEPLOY_DIR/Caddyfile" || die 'Caddyfile 仍是旧版；请先更新仓库中的域名配置模板'
# shellcheck disable=SC2016
grep -Fq '${BLOG_TRUSTED_HOSTS:' "$COMPOSE_FILE_PATH" || die 'docker-compose.yml 仍是旧版；请先更新仓库'
# Keep the effective service definitions unambiguous; do not silently ignore overrides.
for override in docker-compose.override.yml docker-compose.override.yaml compose.override.yml compose.override.yaml; do
  [[ ! -f "$DEPLOY_DIR/$override" ]] || die "发现 $override；请先将必要配置合并进主 Compose 文件"
done
BACKUP_DIR="$(mktemp -d "$ROOT_DIR/backups/domains-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
CANDIDATE="$BACKUP_DIR/candidate.env"
[[ "$(sha256sum < "$ENV_FILE")" == "$ENV_FINGERPRINT" ]] || die '.env 在读取域名后被其他任务修改，已停止'
cp "$ENV_FILE" "$BACKUP_DIR/previous.env"
chmod 600 "$BACKUP_DIR/previous.env"

# Do not source .env: it is Compose data, not a shell script. Preserve other keys.
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?(SITE_DOMAINS|CHAT_DOMAINS|BLOG_DOMAINS|BLOG_TRUSTED_HOSTS|BLOG_SITE_URL)[[:space:]]*= ]]; then
    continue
  fi
  printf '%s\n' "$line"
done < "$ENV_FILE" > "$CANDIDATE"
print_values >> "$CANDIDATE"
chmod 600 "$CANDIDATE"
log "配置备份: $BACKUP_DIR/previous.env"

compose() {
  local env_file="$1"
  shift
  # Shell exports must not override the domain values in the selected env file.
  env -u SITE_DOMAINS -u CHAT_DOMAINS -u BLOG_DOMAINS -u BLOG_TRUSTED_HOSTS -u BLOG_SITE_URL \
    docker compose --project-directory "$DEPLOY_DIR" --env-file "$env_file" -f "$COMPOSE_FILE_PATH" "$@"
}

APPLIED=0
OLD_BLOG_IMAGE=''
finish() {
  local result=$?
  trap - EXIT
  if [[ "$result" -ne 0 && "$APPLIED" -eq 1 ]]; then
    log '更新失败，恢复原 .env 与服务配置...'
    if ! cp "$BACKUP_DIR/previous.env" "$ENV_FILE"; then
      log "自动恢复 .env 失败，请从 $BACKUP_DIR/previous.env 手动恢复" >&2
    elif [[ "$DO_DEPLOY" -eq 1 ]]; then
      # The build may have moved the local blog tag; restore the running image ID.
      printf 'services:\n  blog:\n    image: "%s"\n' "$OLD_BLOG_IMAGE" > "$BACKUP_DIR/rollback.yml"
      if ! compose "$ENV_FILE" -f "$BACKUP_DIR/rollback.yml" up -d --no-deps --force-recreate --no-build --pull never --wait --wait-timeout 120 blog caddy; then
        log "自动回滚服务失败，请检查容器；备份位于 $BACKUP_DIR" >&2
      else
        log '已恢复原配置与博客镜像。'
      fi
    fi
  fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$DO_DEPLOY" -eq 1 ]]; then
  command -v docker >/dev/null || die '需要 Docker Compose v2'
  command -v curl >/dev/null || die '需要 curl'
  OLD_BLOG_IMAGE="$(docker inspect --format '{{.Image}}' manifold-blog)"
  [[ "$OLD_BLOG_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || die '未找到运行中的博客镜像，无法准备回滚'
  docker inspect manifold-caddy >/dev/null
  log '校验候选 Compose 与 Caddy 配置...'
  compose "$CANDIDATE" config --quiet
  compose "$CANDIDATE" run --rm --no-deps -T --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  log '构建博客（确保博客分享链接支持新的运行配置）...'
  compose "$CANDIDATE" build blog
fi

# Refuse to overwrite edits made while validation/build was running.
cmp -s "$ENV_FILE" "$BACKUP_DIR/previous.env" || die '.env 在执行期间被其他任务修改，已停止'
APPLIED=1
cp "$CANDIDATE" "$ENV_FILE"
chmod 600 "$ENV_FILE"
log '重建 blog 与 caddy，并等待健康状态...'
compose "$ENV_FILE" up -d --no-deps --force-recreate --no-build --pull never --wait --wait-timeout 120 blog caddy
check_url() {
  local host="$1" path="$2" status
  # Validate this origin, including its certificate, before checking the public route.
  status="$(curl --silent --show-error --fail --connect-timeout 5 --max-time 20 --retry 5 --retry-all-errors --retry-delay 3 --retry-max-time 90 \
    --resolve "$host:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$host$path")"
  [[ "$status" == 200 ]] || die "源站检查失败: $host$path (HTTP $status)"
  status="$(curl --silent --show-error --fail --connect-timeout 5 --max-time 20 --retry 5 --retry-all-errors --retry-delay 3 --retry-max-time 90 \
    -o /dev/null -w '%{http_code}' "https://$host$path")"
  [[ "$status" == 200 ]] || die "公网检查失败: $host$path (HTTP $status)"
  log "源站/公网 HTTP 200: https://$host$path"
}
for address in "${sites[@]}"; do check_url "$address" /health; done
for address in "${chats[@]}"; do check_url "$address" /api/session/me; done
for address in "${blogs[@]}"; do check_url "$address" /; done
log "域名更新完成；回滚配置保存在 $BACKUP_DIR/previous.env"
