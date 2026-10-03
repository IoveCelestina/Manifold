#!/usr/bin/env bash
# Manifold 通用部署脚本（用于 VPS 本地或 SSH 远程调用）
#
# 用法：
#   ./scripts/deploy.sh                    # 默认重建 caddy 和 blog
#   ./scripts/deploy.sh --services "caddy blog chat-demo"
#   ./scripts/deploy.sh --all              # 重建全部服务
#   ./scripts/deploy.sh --build            # 重新构建本地镜像并启动
#   ./scripts/deploy.sh --skip-pull        # 跳过 git pull
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[err]\033[0m %s\n' "$*" >&2; exit 1; }

SERVICES="caddy blog"
DO_PULL=1
DO_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --services) SERVICES="$2"; shift 2 ;;
    --all)      SERVICES="postgres redis sub2api caddy blog chat-demo kuma"; shift ;;
    --caddy)    SERVICES="caddy"; shift ;;
    --blog)     SERVICES="blog"; DO_BUILD=1; shift ;;
    --chat)     SERVICES="chat-demo"; DO_BUILD=1; shift ;;
    --build)    DO_BUILD=1; shift ;;
    --skip-pull) DO_PULL=0; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

cd "$ROOT_DIR"

if [[ "$DO_PULL" -eq 1 ]]; then
  log "拉取最新代码 (git pull --ff-only)..."
  git pull --ff-only
fi

[[ -f "${DEPLOY_DIR}/.env" ]] || die "缺少 ${DEPLOY_DIR}/.env 文件"

cd "$DEPLOY_DIR"

if [[ "$DO_BUILD" -eq 1 ]]; then
  log "构建服务镜像: $SERVICES..."
  # shellcheck disable=SC2086
  docker compose build $SERVICES
fi

log "重建并启动服务: $SERVICES..."
# shellcheck disable=SC2086
docker compose up -d --force-recreate $SERVICES

log "等待容器运行稳定..."
sleep 3

log "检查容器状态:"
# shellcheck disable=SC2086
docker compose ps $SERVICES

if [[ " $SERVICES " =~ " caddy " ]]; then
  log "检查 Caddy 证书与反代日志 (最近 15 行):"
  docker logs manifold-caddy --tail 15 2>&1 || true
fi

log "部署完成 ✓"
