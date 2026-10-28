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
#   ./scripts/restore.sh /path/to/manifold-...tar.gz                # backup.sh --no-encrypt 产出的明文包

set -euo pipefail
umask 077

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

read_env_value() {
  local key="$1" file="${DEPLOY_DIR}/.env"
  [[ -f "$file" ]] || return 0
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

lexical_absolute_path() {
  local input="$1" part
  local -a parts stack=()
  [[ "$input" == /* ]] || input="$PWD/$input"
  IFS='/' read -r -a parts <<<"$input"

  for part in "${parts[@]}"; do
    case "$part" in
      ""|.) ;;
      ..)
        if [[ "${#stack[@]}" -gt 0 ]]; then
          unset "stack[${#stack[@]}-1]"
        fi
        ;;
      *) stack+=("$part") ;;
    esac
  done

  if [[ "${#stack[@]}" -eq 0 ]]; then
    printf '/\n'
  else
    local joined
    joined="$(IFS=/; printf '%s' "${stack[*]}")"
    printf '/%s\n' "$joined"
  fi
}

canonicalize_path() {
  local normalized probe suffix="" segment physical
  normalized="$(lexical_absolute_path "$1")"
  probe="$normalized"

  # Resolve symlinks in the longest existing prefix, then append any missing
  # path components. This provides realpath -m behavior on Linux and macOS.
  while [[ ! -e "$probe" && "$probe" != / ]]; do
    segment="${probe##*/}"
    suffix="/${segment}${suffix}"
    probe="${probe%/*}"
    [[ -n "$probe" ]] || probe=/
  done
  [[ -d "$probe" ]] || die "MANIFOLD_DATA_DIR 的父路径不是目录: $probe"
  physical="$(cd -P -- "$probe" && pwd)"
  lexical_absolute_path "${physical}${suffix}"
}

set_env_value() {
  local file="$1" key="$2" value="$3" line tmp found=0
  tmp="$(mktemp "${file}.tmp.XXXXXX")"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "${key}="* ]]; then
      if [[ "$found" -eq 0 ]]; then
        printf '%s=%s\n' "$key" "$value" >>"$tmp"
        found=1
      fi
    else
      printf '%s\n' "$line" >>"$tmp"
    fi
  done <"$file"
  [[ "$found" -eq 1 ]] || printf '%s=%s\n' "$key" "$value" >>"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$file"
}

DATA_ROOT="$(canonicalize_path "$(resolve_data_root)")"
case "$DATA_ROOT" in
  ""|/|"$HOME"|"$ROOT_DIR"|"$DEPLOY_DIR")
    die "拒绝使用不安全的 MANIFOLD_DATA_DIR: ${DATA_ROOT:-<empty>}"
    ;;
esac
# Keep restore operations and Compose on the same path even if the archive came
# from a host whose .env contains a different absolute directory.
export MANIFOLD_DATA_DIR="$DATA_ROOT"

cleanup() {
  if [[ -n "${WORK_DIR:-}" && -d "$WORK_DIR" ]]; then rm -rf "$WORK_DIR"; fi
}
trap cleanup EXIT

# ─── 1. 准备备份文件 ──────────────────────────────────────────────────
WORK_DIR="$(mktemp -d -t manifold-restore-XXXXXX)"
ARCHIVE="${WORK_DIR}/backup.tar.gz.gpg"
# backup.sh --no-encrypt 产出 .tar.gz，跳过解密
PLAIN=0
[[ "$BACKUP_ARG" == *.tar.gz ]] && { PLAIN=1; ARCHIVE="${WORK_DIR}/backup.tar.gz"; }

if [[ -f "$BACKUP_ARG" ]]; then
  cp "$BACKUP_ARG" "$ARCHIVE"
  log "使用本地文件 ${BACKUP_ARG}"
elif [[ -n "$RCLONE_REMOTE" ]]; then
  command -v rclone >/dev/null || die "需要 rclone 才能从远端拉取"
  log "从 ${RCLONE_REMOTE}/${BACKUP_ARG} 拉取..."
  rclone copyto "${RCLONE_REMOTE}/${BACKUP_ARG}" "$ARCHIVE"
else
  die "找不到 ${BACKUP_ARG}，且未设置 RCLONE_REMOTE"
fi

# ─── 2. 前置检查 ─────────────────────────────────────────────────────
command -v docker >/dev/null || die "需要 docker"
[[ "$PLAIN" -eq 1 ]] || command -v gpg >/dev/null || die "需要 gpg"
command -v tar    >/dev/null || die "需要 tar"
[[ -f "$COMPOSE_FILE" ]]     || die "找不到 ${COMPOSE_FILE}"

DATA_SUBDIRS=(postgres redis sub2api caddy uptime-kuma devin2api)
HAS_DATA=0
[[ -f "${DEPLOY_DIR}/.env" ]] && HAS_DATA=1
for data_subdir in "${DATA_SUBDIRS[@]}"; do
  [[ -e "${DATA_ROOT}/${data_subdir}" || -L "${DATA_ROOT}/${data_subdir}" ]] && HAS_DATA=1
done

if [[ "$HAS_DATA" -eq 1 && "$FORCE" -ne 1 ]]; then
  cat >&2 <<EOF
检测到现有数据：
  ${DEPLOY_DIR}/.env (或) ${DATA_ROOT}/ 下已有 Manifold 服务目录

restore.sh 默认只在全新环境上运行。若确定要覆盖：
  $0 --force --yes "$BACKUP_ARG"

或先手动清理：
  cd deploy && docker compose down -v
  # 仅在确认 MANIFOLD_DATA_DIR 后清理其中的 Manifold 服务目录和 .env
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
[[ "$PLAIN" -eq 1 ]] || gpg --batch --yes --decrypt --output "${WORK_DIR}/backup.tar.gz" "$ARCHIVE"
tar -xzf "${WORK_DIR}/backup.tar.gz" -C "$STAGE_DIR"

[[ -f "${STAGE_DIR}/MANIFEST.txt" ]]  || die "备份缺 MANIFEST.txt，可能损坏"
[[ -f "${STAGE_DIR}/postgres.dump" ]] || die "备份缺 postgres.dump"
[[ -f "${STAGE_DIR}/configs/.env" ]] || die "备份缺 configs/.env"
log "MANIFEST:"
sed 's/^/  /' "${STAGE_DIR}/MANIFEST.txt"

# ─── 4. 停现有服务 ───────────────────────────────────────────────────
if [[ "$HAS_DATA" -eq 1 ]]; then
  log "停现有 compose 栈 (down -v 清旧卷)..."
  ( cd "$DEPLOY_DIR" && docker compose down -v )
  for data_subdir in "${DATA_SUBDIRS[@]}"; do
    rm -rf "${DATA_ROOT:?}/${data_subdir}"
  done
  rm -f "${DEPLOY_DIR}/.env"
fi

# ─── 5. 还原配置 ─────────────────────────────────────────────────────
log "还原配置文件..."
cp "${STAGE_DIR}/configs/.env" "${DEPLOY_DIR}/.env"
chmod 600 "${DEPLOY_DIR}/.env"
set_env_value "${DEPLOY_DIR}/.env" MANIFOLD_DATA_DIR "$DATA_ROOT"

if [[ -d "${STAGE_DIR}/data/sub2api" ]]; then
  mkdir -p "$DATA_ROOT"
  cp -r "${STAGE_DIR}/data/sub2api" "${DATA_ROOT}/sub2api"
fi

# devin2api：快照是单个自洽的 db 文件（无 -wal/-shm），直接放回状态目录
if [[ -f "${STAGE_DIR}/configs/devin2api-config.yaml" ]]; then
  mkdir -p "${DEPLOY_DIR}/devin2api"
  ( umask 077 && cp "${STAGE_DIR}/configs/devin2api-config.yaml" "${DEPLOY_DIR}/devin2api/config.yaml" )
fi
if [[ -d "${STAGE_DIR}/data/devin2api" ]]; then
  mkdir -p "${DATA_ROOT}/devin2api"
  cp -R "${STAGE_DIR}/data/devin2api/." "${DATA_ROOT}/devin2api/"
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

PG_USER="$(read_env_value POSTGRES_USER)"; PG_USER="${PG_USER:-sub2api}"
PG_DB="$(read_env_value POSTGRES_DB)";     PG_DB="${PG_DB:-sub2api}"

log "pg_restore..."
docker exec -i "$POSTGRES_CONTAINER" \
  pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --no-owner --no-privileges \
  < "${STAGE_DIR}/postgres.dump" 2>&1 | sed 's/^/  /' || die "pg_restore 失败"

# ─── 7. 拉起其余服务 ────────────────────────────────────────────────
log "拉起完整 compose 栈..."
SERVICES="$(cd "$DEPLOY_DIR" && docker compose config --services)"
# 旧备份没有 devin2api 配置：单文件 bind mount 源不存在会被 docker 建成空目录，先跳过它
if [[ ! -f "${DEPLOY_DIR}/devin2api/config.yaml" ]]; then
  log "WARN: 没有 deploy/devin2api/config.yaml，跳过 devin2api；跑 scripts/init.sh 生成后再 docker compose up -d devin2api"
  SERVICES="$(grep -vx devin2api <<<"$SERVICES")"
fi
# shellcheck disable=SC2086
( cd "$DEPLOY_DIR" && docker compose up -d $SERVICES )

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
