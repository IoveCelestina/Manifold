function ConvertTo-LfLineEnding([string]$Text) {
  return $Text.Replace("`r`n", "`n").Replace("`r", "`n")
}

function New-Sub2apiRemoteDeployScript([string]$Version) {
  if (-not $Version) { throw 'Version is required' }

  $remoteScript = @'
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
'@

  return ConvertTo-LfLineEnding $remoteScript.Replace('__VER__', $Version)
}
