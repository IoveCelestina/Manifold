#!/usr/bin/env bash
# Manifold 全量备份脚本
#
# 备份内容：
#   - postgres 全库 dump (custom format, 已压缩)
#   - deploy/.env (含 JWT / TOTP 加密 key，丢了所有用户登录态失效)
#   - MANIFOLD_DATA_DIR/sub2api/ (sub2api 自带数据目录)
#   - devin2api 状态库 devin-2api.db（Devin 账号凭据、下游令牌）+ deploy/devin2api/config.yaml
#
# 不备份：
#   - data/postgres/ (用 pg_dump 代替，跨版本更稳)
#   - data/redis/   (session/限流，可重建)
#
# 用法：
#   GPG_RECIPIENT=you@example.com ./scripts/backup.sh
#   RCLONE_REMOTE=b2:manifold-backups GPG_RECIPIENT=you@example.com ./scripts/backup.sh
#   ./scripts/backup.sh --no-upload     # 只留本地，不推异地
#   ./scripts/backup.sh --no-encrypt    # 不加密，输出 root-only 的 .tar.gz，且不推异地（GPG 未配置时的临时手段）

set -euo pipefail

NO_ENCRYPT=0
NO_UPLOAD=0
for arg in "$@"; do
  case "$arg" in
    --no-encrypt) NO_ENCRYPT=1; NO_UPLOAD=1 ;;
    --no-upload)  NO_UPLOAD=1 ;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

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

resolve_data_root() {
  local configured="${MANIFOLD_DATA_DIR:-}"
  [[ -n "$configured" ]] || configured="$(read_env_value MANIFOLD_DATA_DIR)"
  configured="${configured:-./data}"

  if [[ "$configured" == /* ]]; then
    printf '%s\n' "$configured"
  else
    printf '%s\n' "${DEPLOY_DIR}/${configured#./}"
  fi
}

# ─── 1. 前置检查 ──────────────────────────────────────────────────────
log "前置检查..."
command -v docker >/dev/null || die "需要 docker"
command -v tar    >/dev/null || die "需要 tar"
if [[ "$NO_ENCRYPT" -eq 0 ]]; then
  command -v gpg >/dev/null || die "需要 gpg"
  [[ -n "$GPG_RECIPIENT" ]] || die "未设置 GPG_RECIPIENT，参考 docs/backup-restore.md 创建 GPG key（临时可用 --no-encrypt）"
fi
[[ "$NO_UPLOAD" -eq 1 ]] && RCLONE_REMOTE=""

if [[ -n "$RCLONE_REMOTE" ]]; then
  command -v rclone >/dev/null || die "RCLONE_REMOTE 已设置但找不到 rclone"
fi

DATA_ROOT="$(resolve_data_root)"
DEVIN_DB="${DATA_ROOT}/devin2api/devin-2api.db"
if [[ -f "$DEVIN_DB" ]]; then
  command -v python3 >/dev/null || die "备份 devin2api 需要 python3（用 SQLite 在线备份 API 取一致快照）"
fi

docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null | grep -q true \
  || die "postgres 容器 (${POSTGRES_CONTAINER}) 未运行"

POSTGRES_USER="$(read_env_value POSTGRES_USER)";  POSTGRES_USER="${POSTGRES_USER:-sub2api}"
POSTGRES_DB="$(read_env_value POSTGRES_DB)";      POSTGRES_DB="${POSTGRES_DB:-sub2api}"

mkdir -p "$BACKUP_DIR"

# ─── 2. 收集到临时工作目录 ────────────────────────────────────────────
TIMESTAMP="$(date +%Y-%m-%dT%H-%M-%S)"
ARCHIVE_NAME="manifold-${TIMESTAMP}.tar.gz.gpg"
[[ "$NO_ENCRYPT" -eq 1 ]] && ARCHIVE_NAME="manifold-${TIMESTAMP}.tar.gz"
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

# sub2api 自带数据目录
if [[ -d "${DATA_ROOT}/sub2api" ]]; then
  mkdir -p "${STAGE_DIR}/data"
  cp -r "${DATA_ROOT}/sub2api" "${STAGE_DIR}/data/sub2api"
fi

# devin2api：SQLite WAL 库在运行中直接 cp 可能拿到不一致的 db/-wal 组合，
# 用 SQLite 在线备份 API 取快照（读期间不阻塞 devin2api 写入）
if [[ -f "${DEPLOY_DIR}/devin2api/config.yaml" ]]; then
  cp "${DEPLOY_DIR}/devin2api/config.yaml" "${STAGE_DIR}/configs/devin2api-config.yaml"
fi
if [[ -f "$DEVIN_DB" ]]; then
  mkdir -p "${STAGE_DIR}/data/devin2api"
  python3 - "$DEVIN_DB" "${STAGE_DIR}/data/devin2api/devin-2api.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close()
src.close()
PY
  log "  devin-2api.db 快照 = $(stat -c %s "${STAGE_DIR}/data/devin2api/devin-2api.db") 字节"
fi

# 留个版本指纹方便排错
cat > "${STAGE_DIR}/MANIFEST.txt" <<EOF
created_at: ${TIMESTAMP}
hostname:   $(hostname)
postgres_container: ${POSTGRES_CONTAINER}
postgres_user:      ${POSTGRES_USER}
postgres_db:        ${POSTGRES_DB}
data_root:          ${DATA_ROOT}
git_commit:         $(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
EOF

# ─── 3. 打 tar + gpg ──────────────────────────────────────────────────
FINAL_TMP="${BACKUP_DIR}/.${ARCHIVE_NAME}.tmp"
if [[ "$NO_ENCRYPT" -eq 1 ]]; then
  log "[3/4] tar（--no-encrypt：明文备份，仅 root 可读，不推异地）..."
  ( umask 077 && tar -czf "$FINAL_TMP" -C "$STAGE_DIR" . )
else
  log "[3/4] tar + gpg..."
  TARBALL="${WORK_DIR}/${ARCHIVE_NAME%.gpg}"
  tar -czf "$TARBALL" -C "$STAGE_DIR" .

  # 多收件人：逗号分隔 → 多个 --recipient
  GPG_ARGS=()
  IFS=',' read -ra RECIPIENTS <<< "$GPG_RECIPIENT"
  for r in "${RECIPIENTS[@]}"; do
    GPG_ARGS+=(--recipient "$(echo "$r" | xargs)")
  done

  gpg --batch --yes --trust-model always --encrypt "${GPG_ARGS[@]}" \
      --output "$FINAL_TMP" "$TARBALL"
fi

FINAL_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"
mv "$FINAL_TMP" "$FINAL_PATH"
FINAL_SIZE=$(stat -c %s "$FINAL_PATH" 2>/dev/null || stat -f %z "$FINAL_PATH")
log "  本地: ${FINAL_PATH} (${FINAL_SIZE} 字节)"

# ─── 4. 推异地 + 清旧 ─────────────────────────────────────────────────
if [[ -n "$RCLONE_REMOTE" ]]; then
  log "[4/4] rclone copy → ${RCLONE_REMOTE}/"
  rclone copy "$FINAL_PATH" "$RCLONE_REMOTE/" --progress
else
  log "[4/4] 跳过异地上传 (⚠ 仅本地备份不算异地)"
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
