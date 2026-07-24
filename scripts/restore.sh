#!/usr/bin/env bash
# Manifold 备份恢复脚本
#
# 用途：
#   - 灾难恢复：在新机器上用最近一份 .tar.gz.gpg 重建整套服务
#   - 本机演练：每月跑一次确认备份可用（DoD 要求）
#
# 默认是"全新机器"模式，发现已有数据会拒绝继续，加 --force 才覆盖。
#
# 用法：
#   ./scripts/restore.sh /path/to/manifold-2026-05-20T03-00-00.tar.gz.gpg
#   RCLONE_REMOTE=b2:manifold-backups ./scripts/restore.sh manifold-2026-05-20T03-00-00.tar.gz.gpg
#   ./scripts/restore.sh --force --yes /path/to/backup.tar.gz.gpg   # 覆盖现有数据

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"

RCLONE_REMOTE="${RCLONE_REMOTE:-}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-manifold-postgres}"

FORCE=0
ASSUME_YES=0
BACKUP_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "未知参数: $1" >&2; exit 2 ;;
    *) BACKUP_ARG="$1"; shift ;;
  esac
done

[[ -n "$BACKUP_ARG" ]] || { echo "用法: $0 [--force] [--yes] <备份文件名或路径>" >&2; exit 2; }

log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die()  { log "ERROR: $*" >&2; exit 1; }

cleanup() {
  if [[ -n "${WORK_DIR:-}" && -d "$WORK_DIR" ]]; then rm -rf "$WORK_DIR"; fi
}
trap cleanup EXIT

# ─── 1. 准备备份文件 ──────────────────────────────────────────────────
WORK_DIR="$(mktemp -d -t manifold-restore-XXXXXX)"
ENCRYPTED="${WORK_DIR}/backup.tar.gz.gpg"

if [[ -f "$BACKUP_ARG" ]]; then
  cp "$BACKUP_ARG" "$ENCRYPTED"
  log "使用本地文件 ${BACKUP_ARG}"
elif [[ -n "$RCLONE_REMOTE" ]]; then
  command -v rclone >/dev/null || die "需要 rclone 才能从远端拉取"
  log "从 ${RCLONE_REMOTE}/${BACKUP_ARG} 拉取..."
  rclone copyto "${RCLONE_REMOTE}/${BACKUP_ARG}" "$ENCRYPTED"
else
  die "找不到 ${BACKUP_ARG}，且未设置 RCLONE_REMOTE"
fi

# ─── 2. 前置检查 ─────────────────────────────────────────────────────
command -v docker >/dev/null || die "需要 docker"
command -v gpg    >/dev/null || die "需要 gpg"
command -v tar    >/dev/null || die "需要 tar"
[[ -f "$COMPOSE_FILE" ]]     || die "找不到 ${COMPOSE_FILE}"

HAS_DATA=0
[[ -f "${DEPLOY_DIR}/.env" ]] && HAS_DATA=1
[[ -d "${DEPLOY_DIR}/data/postgres" ]] && [[ -n "$(ls -A "${DEPLOY_DIR}/data/postgres" 2>/dev/null)" ]] && HAS_DATA=1

if [[ "$HAS_DATA" -eq 1 && "$FORCE" -ne 1 ]]; then
  cat >&2 <<EOF
检测到现有数据：
  ${DEPLOY_DIR}/.env (或) ${DEPLOY_DIR}/data/postgres/ 非空

restore.sh 默认只在全新环境上运行。若确定要覆盖：
  $0 --force --yes "$BACKUP_ARG"

或先手动清理：
  cd deploy && docker compose down -v
  rm -rf data/ .env
EOF
  exit 3
fi

if [[ "$HAS_DATA" -eq 1 && "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "⚠  将覆盖 ${DEPLOY_DIR} 现有数据。输入 RESTORE 确认继续: " ans
  [[ "$ans" == "RESTORE" ]] || die "用户取消"
fi

# ─── 3. 解密 + 解包 ─────────────────────────────────────────────────
log "解密 + 解包..."
STAGE_DIR="${WORK_DIR}/stage"
mkdir -p "$STAGE_DIR"
gpg --batch --yes --decrypt --output "${WORK_DIR}/backup.tar.gz" "$ENCRYPTED"
tar -xzf "${WORK_DIR}/backup.tar.gz" -C "$STAGE_DIR"

[[ -f "${STAGE_DIR}/MANIFEST.txt" ]]  || die "备份缺 MANIFEST.txt，可能损坏"
[[ -f "${STAGE_DIR}/postgres.dump" ]] || die "备份缺 postgres.dump"
log "MANIFEST:"
sed 's/^/  /' "${STAGE_DIR}/MANIFEST.txt"

# ─── 4. 停现有服务 ───────────────────────────────────────────────────
if [[ "$HAS_DATA" -eq 1 ]]; then
  log "停现有 compose 栈 (down -v 清旧卷)..."
  ( cd "$DEPLOY_DIR" && docker compose down -v )
  rm -rf "${DEPLOY_DIR}/data" \
         "${DEPLOY_DIR}/.env"
fi

# ─── 5. 还原配置 ─────────────────────────────────────────────────────
log "还原配置文件..."
cp "${STAGE_DIR}/configs/.env" "${DEPLOY_DIR}/.env"

if [[ -d "${STAGE_DIR}/data/sub2api" ]]; then
  mkdir -p "${DEPLOY_DIR}/data"
  cp -r "${STAGE_DIR}/data/sub2api" "${DEPLOY_DIR}/data/sub2api"
fi

# ─── 6. 起 postgres + pg_restore ─────────────────────────────────────
log "拉起 postgres..."
( cd "$DEPLOY_DIR" && docker compose up -d postgres )

log "等 postgres 健康..."
for _ in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || echo "starting")
  [[ "$state" == "healthy" ]] && break
  sleep 2
done
[[ "$state" == "healthy" ]] || die "postgres 30 次健康检查未通过，最后状态: $state"

read_env_value() {
  awk -F= -v k="$1" '$1==k { sub(/^[^=]*=/,""); gsub(/^["'\'']|["'\'']$/,""); print; exit }' "${DEPLOY_DIR}/.env"
}
PG_USER="$(read_env_value POSTGRES_USER)"; PG_USER="${PG_USER:-sub2api}"
PG_DB="$(read_env_value POSTGRES_DB)";     PG_DB="${PG_DB:-sub2api}"

log "pg_restore..."
docker exec -i "$POSTGRES_CONTAINER" \
  pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --no-owner --no-privileges \
  < "${STAGE_DIR}/postgres.dump" 2>&1 | sed 's/^/  /' || die "pg_restore 失败"

# ─── 7. 拉起其余服务 ────────────────────────────────────────────────
log "拉起完整 compose 栈..."
( cd "$DEPLOY_DIR" && docker compose up -d )

log "等 sub2api 健康..."
SUB2API_CONTAINER="manifold-sub2api"
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$SUB2API_CONTAINER" 2>/dev/null || echo "starting")
  [[ "$state" == "healthy" ]] && break
  sleep 2
done

if [[ "$state" == "healthy" ]]; then
  log "完成 ✓ sub2api 已健康"
else
  log "WARN: sub2api 最后状态 $state，请检查 docker compose logs"
fi
