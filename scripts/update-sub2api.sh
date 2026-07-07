#!/usr/bin/env bash
# Manifold sub2api 升级脚本 —— 自动查最新版、改 compose digest、可选提交与生产部署
#
# 用法：
#   ./scripts/update-sub2api.sh                # 查最新版并更新 deploy/docker-compose.yml（只改文件）
#   ./scripts/update-sub2api.sh --check        # 只检查有没有新版，不改任何东西
#   ./scripts/update-sub2api.sh --commit       # 改文件 + git commit + push
#   ./scripts/update-sub2api.sh --deploy       # commit + push 后 ssh 到生产完成部署（pg_dump 兜底 + 健康检查）
#   ./scripts/update-sub2api.sh --version 0.1.144 [--deploy]   # 指定版本（升级或回退）
#
# 环境变量：
#   SSH_HOST   生产机 ssh 别名，默认 manifold
#
# ⚠ 升级前扫一眼 release notes（脚本会打印链接）——schema migration 不可逆，
#   往回退版本前先确认新版没做破坏性 schema 变更（见 docs/upgrade.md）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE="${ROOT_DIR}/deploy/docker-compose.yml"
REPO="weishaw/sub2api"
SSH_HOST="${SSH_HOST:-manifold}"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# ─── 参数 ─────────────────────────────────────────────────────────────
CHECK_ONLY=0; DO_COMMIT=0; DO_DEPLOY=0; TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)   CHECK_ONLY=1 ;;
    --commit)  DO_COMMIT=1 ;;
    --deploy)  DO_COMMIT=1; DO_DEPLOY=1 ;;
    --version) TARGET="${2:-}"; [[ -n "$TARGET" ]] || die "--version 需要一个版本号参数"; shift ;;
    *) die "未知参数: $1（支持 --check / --commit / --deploy / --version X.Y.Z）" ;;
  esac
  shift
done

[[ -f "$COMPOSE" ]] || die "找不到 $COMPOSE"

# ─── 当前版本（从 compose 解析） ──────────────────────────────────────
CURRENT="$(grep -oE '# sub2api [0-9]+\.[0-9]+\.[0-9]+' "$COMPOSE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
CURRENT_DIGEST="$(grep -oE 'weishaw/sub2api@sha256:[0-9a-f]+' "$COMPOSE" | head -1 | cut -d@ -f2)"
[[ -n "$CURRENT" && -n "$CURRENT_DIGEST" ]] || die "compose 里没找到 sub2api 版本注释或 digest 行，格式变了？"

# ─── Docker Registry API：拿匿名 pull token → 列 tag → 查 digest ─────
# 不依赖 jq / docker CLI，纯 curl + 文本处理。
log "查询 Docker Hub（registry API）..."
TOKEN="$(curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${REPO}:pull" \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')"
[[ -n "$TOKEN" ]] || die "获取 registry token 失败"

if [[ -z "$TARGET" ]]; then
  TARGET="$(curl -fsS -H "Authorization: Bearer $TOKEN" \
      "https://registry-1.docker.io/v2/${REPO}/tags/list" \
    | grep -oE '"[0-9]+\.[0-9]+\.[0-9]+"' | tr -d '"' | sort -uV | tail -1)"
  [[ -n "$TARGET" ]] || die "没解析出任何 X.Y.Z 形式的 tag"
fi

# 多架构 manifest list 的 digest（与 compose 里 image@sha256 钉的是同一个）
DIGEST="$(curl -fsSI -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json" \
    "https://registry-1.docker.io/v2/${REPO}/manifests/${TARGET}" \
  | tr -d '\r' | grep -i '^docker-content-digest:' | awk '{print $2}')"
[[ "$DIGEST" == sha256:* ]] || die "没拿到 ${TARGET} 的 manifest digest"

log "当前: ${CURRENT} (${CURRENT_DIGEST:0:19}…)"
log "目标: ${TARGET} (${DIGEST:0:19}…)"
log "release notes: https://github.com/Wei-Shaw/sub2api/releases/tag/v${TARGET}"

if [[ "$DIGEST" == "$CURRENT_DIGEST" && $DO_DEPLOY -eq 0 ]]; then
  log "compose 已是该版本，无事可做 ✓"
  exit 0
fi
if [[ $CHECK_ONLY -eq 1 ]]; then
  log "有新版可升（--check 模式，未改文件）。重跑去掉 --check 即可更新 compose。"
  exit 0
fi

# ─── 改 compose ───────────────────────────────────────────────────────
if [[ "$DIGEST" != "$CURRENT_DIGEST" ]]; then
  TODAY="$(date +%Y-%m-%d)"
  sed -i -E "s,# sub2api [0-9.]+ \((built|pulled) [0-9-]+\),# sub2api ${TARGET} (pulled ${TODAY})," "$COMPOSE"
  sed -i -E "s|weishaw/sub2api@sha256:[0-9a-f]+|weishaw/sub2api@${DIGEST}|" "$COMPOSE"
  grep -q "weishaw/sub2api@${DIGEST}" "$COMPOSE" || die "digest 替换失败，检查 compose 格式"
  log "已更新 deploy/docker-compose.yml → ${TARGET}"
else
  log "compose 已是目标版本，跳过改文件"
fi

# ─── commit + push ────────────────────────────────────────────────────
if [[ $DO_COMMIT -eq 1 ]]; then
  if ! git -C "$ROOT_DIR" diff --quiet -- deploy/docker-compose.yml; then
    git -C "$ROOT_DIR" add deploy/docker-compose.yml
    git -C "$ROOT_DIR" commit -m "deploy: sub2api 升级 ${CURRENT} → ${TARGET}"
    log "已 commit"
  else
    log "compose 无未提交改动，跳过 commit"
  fi
  git -C "$ROOT_DIR" push origin main
  log "已 push origin main"
else
  log "下一步：重跑加 --commit 提交，或 --deploy 一步到生产"
  exit 0
fi

# ─── 生产部署 ─────────────────────────────────────────────────────────
[[ $DO_DEPLOY -eq 1 ]] || exit 0
log "开始部署到生产（ssh ${SSH_HOST}）..."

REMOTE_SCRIPT='
set -euo pipefail
cd /opt/manifold
git pull --ff-only
mkdir -p backups
echo "[remote] pg_dump 兜底备份..."
docker exec manifold-postgres pg_dump -U sub2api -d sub2api --format=custom --compress=9 \
  > "backups/pre-__VER__-$(date +%Y%m%dT%H%M%S).dump"
cd deploy
docker compose pull sub2api
docker compose up -d --force-recreate sub2api
echo "[remote] 等待容器 healthy..."
s=starting
for i in $(seq 1 30); do
  s="$(docker inspect -f "{{.State.Health.Status}}" manifold-sub2api)"
  [ "$s" = "healthy" ] && break
  sleep 3
done
if [ "$s" != "healthy" ]; then
  echo "[remote] 容器未达 healthy（当前: $s），最近日志：" >&2
  docker logs manifold-sub2api --tail 50 >&2
  exit 1
fi
docker exec manifold-sub2api wget -qO- http://localhost:8080/health && echo
echo "[remote] 部署完成 ✓ 运行镜像: $(docker inspect manifold-sub2api --format "{{.Config.Image}}")"
'
ssh "$SSH_HOST" "${REMOTE_SCRIPT//__VER__/$TARGET}"

log "全部完成 ✓ 建议再从公网确认一次: curl https://<域名>/health"
log "回滚：./scripts/update-sub2api.sh --version ${CURRENT} --deploy（若新版做了 schema migration 则需走备份恢复，见 docs/upgrade.md）"
