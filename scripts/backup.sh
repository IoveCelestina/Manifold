#!/usr/bin/env bash
# Manifold 全量备份脚本
#
# 备份内容：
#   - postgres 全库 dump (custom format, 已压缩)
#   - deploy/.env (含 JWT / TOTP 加密 key，丢了所有用户登录态失效)
#   - deploy/cpa-*/config.yaml + auths/*.json (OAuth token，丢了要重新登录有封号风险)
#   - deploy/data/sub2api/ (sub2api 自带数据目录)
#   - deploy/data/api-keys.json (setup-all.ps1 发出的明文 key 缓存)
#
# 不备份：
#   - data/postgres/ (用 pg_dump 代替，跨版本更稳)
#   - data/redis/   (session/限流，可重建)
#   - data/cpa-*-logs/ (日志，不要)
#
# 用法：
#   GPG_RECIPIENT=you@example.com ./scripts/backup.sh
#   RCLONE_REMOTE=b2:manifold-backups GPG_RECIPIENT=you@example.com ./scripts/backup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"

# ─── 可配置参数 ────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"          # 必填，可逗号分隔多收件人
RCLONE_REMOTE="${RCLONE_REMOTE:-}"          # 可选，例: b2:manifold-backups
RETENTION_DAILY="${RETENTION_DAILY:-7}"     # 本地与远端最近 N 天每天一份
RETENTION_MONTHLY="${RETENTION_MONTHLY:-12}" # 每月首份额外保留 M 个月
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-manifold-postgres}"

# ─── 工具函数 ─────────────────────────────────────────────────────────
log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die()  { log "ERROR: $*" >&2; exit 1; }

cleanup() {
  if [[ -n "${WORK_DIR:-}" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

read_env_value() {
  local key="$1" file="${DEPLOY_DIR}/.env"
  [[ -f "$file" ]] || die "找不到 ${file}"
  awk -F= -v k="$key" '$1==k { sub(/^[^=]*=/,""); gsub(/^["'\'']|["'\'']$/,""); print; exit }' "$file"
}

# ─── 1. 前置检查 ──────────────────────────────────────────────────────
log "前置检查..."
command -v docker >/dev/null || die "需要 docker"
command -v gpg    >/dev/null || die "需要 gpg"
command -v tar    >/dev/null || die "需要 tar"
[[ -n "$GPG_RECIPIENT" ]]    || die "未设置 GPG_RECIPIENT，参考 docs/backup-restore.md 创建 GPG key"

if [[ -n "$RCLONE_REMOTE" ]]; then
  command -v rclone >/dev/null || die "RCLONE_REMOTE 已设置但找不到 rclone"
fi

docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null | grep -q true \
  || die "postgres 容器 (${POSTGRES_CONTAINER}) 未运行"

POSTGRES_USER="$(read_env_value POSTGRES_USER)";  POSTGRES_USER="${POSTGRES_USER:-sub2api}"
POSTGRES_DB="$(read_env_value POSTGRES_DB)";      POSTGRES_DB="${POSTGRES_DB:-sub2api}"

mkdir -p "$BACKUP_DIR"

# ─── 2. 收集到临时工作目录 ────────────────────────────────────────────
TIMESTAMP="$(date +%Y-%m-%dT%H-%M-%S)"
ARCHIVE_NAME="manifold-${TIMESTAMP}.tar.gz.gpg"
WORK_DIR="$(mktemp -d -t manifold-backup-XXXXXX)"
STAGE_DIR="${WORK_DIR}/stage"
mkdir -p "$STAGE_DIR"

log "开始打包到 ${WORK_DIR}"

# 2a. pg_dump
log "[1/4] pg_dump..."
docker exec -i "$POSTGRES_CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=9 \
  > "${STAGE_DIR}/postgres.dump"

DUMP_SIZE=$(stat -c %s "${STAGE_DIR}/postgres.dump" 2>/dev/null || stat -f %z "${STAGE_DIR}/postgres.dump")
[[ "$DUMP_SIZE" -gt 100 ]] || die "pg_dump 输出异常小 (${DUMP_SIZE} 字节)，疑似失败"
log "  postgres.dump = ${DUMP_SIZE} 字节"

# 2b. 配置 + token + sub2api data
log "[2/4] 拷贝配置和 OAuth token..."
mkdir -p "${STAGE_DIR}/configs"
cp "${DEPLOY_DIR}/.env" "${STAGE_DIR}/configs/.env"

# cpa-*/config.yaml + auths/
for cpa_dir in "${DEPLOY_DIR}"/cpa-*; do
  [[ -d "$cpa_dir" ]] || continue
  name="$(basename "$cpa_dir")"
  mkdir -p "${STAGE_DIR}/configs/${name}"
  [[ -f "${cpa_dir}/config.yaml" ]] && cp "${cpa_dir}/config.yaml" "${STAGE_DIR}/configs/${name}/config.yaml"
  if [[ -d "${cpa_dir}/auths" ]]; then
    cp -r "${cpa_dir}/auths" "${STAGE_DIR}/configs/${name}/auths"
  fi
done

# sub2api 自带数据目录
if [[ -d "${DEPLOY_DIR}/data/sub2api" ]]; then
  mkdir -p "${STAGE_DIR}/data"
  cp -r "${DEPLOY_DIR}/data/sub2api" "${STAGE_DIR}/data/sub2api"
fi

# api-keys.json（setup-all.ps1 的明文 key 缓存）
if [[ -f "${DEPLOY_DIR}/data/api-keys.json" ]]; then
  mkdir -p "${STAGE_DIR}/data"
  cp "${DEPLOY_DIR}/data/api-keys.json" "${STAGE_DIR}/data/api-keys.json"
fi

# 留个版本指纹方便排错
cat > "${STAGE_DIR}/MANIFEST.txt" <<EOF
created_at: ${TIMESTAMP}
hostname:   $(hostname)
postgres_container: ${POSTGRES_CONTAINER}
postgres_user:      ${POSTGRES_USER}
postgres_db:        ${POSTGRES_DB}
git_commit:         $(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
EOF

# ─── 3. 打 tar + gpg ──────────────────────────────────────────────────
log "[3/4] tar + gpg..."
TARBALL="${WORK_DIR}/${ARCHIVE_NAME%.gpg}"
tar -czf "$TARBALL" -C "$STAGE_DIR" .

# 多收件人：逗号分隔 → 多个 --recipient
GPG_ARGS=()
IFS=',' read -ra RECIPIENTS <<< "$GPG_RECIPIENT"
for r in "${RECIPIENTS[@]}"; do
  GPG_ARGS+=(--recipient "$(echo "$r" | xargs)")
done

FINAL_TMP="${BACKUP_DIR}/.${ARCHIVE_NAME}.tmp"
gpg --batch --yes --trust-model always --encrypt "${GPG_ARGS[@]}" \
    --output "$FINAL_TMP" "$TARBALL"

FINAL_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"
mv "$FINAL_TMP" "$FINAL_PATH"
FINAL_SIZE=$(stat -c %s "$FINAL_PATH" 2>/dev/null || stat -f %z "$FINAL_PATH")
log "  本地: ${FINAL_PATH} (${FINAL_SIZE} 字节)"

# ─── 4. 推异地 + 清旧 ─────────────────────────────────────────────────
if [[ -n "$RCLONE_REMOTE" ]]; then
  log "[4/4] rclone copy → ${RCLONE_REMOTE}/"
  rclone copy "$FINAL_PATH" "$RCLONE_REMOTE/" --progress
else
  log "[4/4] RCLONE_REMOTE 未设置，跳过异地上传 (⚠ 仅本地备份不算异地)"
fi

# 清旧本地
prune_local() {
  local files
  mapfile -t files < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'manifold-*.tar.gz.gpg' -printf '%f\n' | sort -r)
  declare -A keep
  local count=0
  for f in "${files[@]}"; do
    keep[$f]=1
    count=$((count+1))
    [[ $count -ge $RETENTION_DAILY ]] && break
  done
  declare -A months
  for f in "${files[@]}"; do
    local ym="${f#manifold-}"; ym="${ym:0:7}"
    if [[ -z "${months[$ym]:-}" ]]; then
      months[$ym]=1; keep[$f]=1
    fi
    [[ ${#months[@]} -ge $RETENTION_MONTHLY ]] && break
  done
  for f in "${files[@]}"; do
    if [[ -z "${keep[$f]:-}" ]]; then
      rm -f "${BACKUP_DIR}/${f}"
      log "  本地清理 ${f}"
    fi
  done
}

prune_remote() {
  local files
  mapfile -t files < <(rclone lsf "$RCLONE_REMOTE" --include 'manifold-*.tar.gz.gpg' | sort -r)
  declare -A keep
  local count=0
  for f in "${files[@]}"; do
    keep[$f]=1
    count=$((count+1))
    [[ $count -ge $RETENTION_DAILY ]] && break
  done
  declare -A months
  for f in "${files[@]}"; do
    local ym="${f#manifold-}"; ym="${ym:0:7}"
    if [[ -z "${months[$ym]:-}" ]]; then
      months[$ym]=1; keep[$f]=1
    fi
    [[ ${#months[@]} -ge $RETENTION_MONTHLY ]] && break
  done
  for f in "${files[@]}"; do
    if [[ -z "${keep[$f]:-}" ]]; then
      rclone deletefile "${RCLONE_REMOTE}/${f}"
      log "  远端清理 ${f}"
    fi
  done
}

prune_local
[[ -n "$RCLONE_REMOTE" ]] && prune_remote || true

log "完成 ✓"
echo "$FINAL_PATH"
