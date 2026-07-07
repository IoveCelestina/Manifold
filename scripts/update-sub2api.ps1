#!/usr/bin/env pwsh
# Manifold sub2api 升级脚本（PowerShell 版，与 update-sub2api.sh 等价）
#
# 用法：
#   ./scripts/update-sub2api.ps1                    # 查最新版并更新 deploy/docker-compose.yml（只改文件）
#   ./scripts/update-sub2api.ps1 -Check             # 只检查有没有新版，不改任何东西
#   ./scripts/update-sub2api.ps1 -Commit            # 改文件 + git commit + push
#   ./scripts/update-sub2api.ps1 -Deploy            # commit + push 后 ssh 到生产完成部署（pg_dump 兜底 + 健康检查）
#   ./scripts/update-sub2api.ps1 -Version 0.1.144 [-Deploy]   # 指定版本（升级或回退）
#
# 环境变量：
#   SSH_HOST   生产机 ssh 别名，默认 manifold
#
# ⚠ 升级前扫一眼 release notes（脚本会打印链接）——schema migration 不可逆，
#   往回退版本前先确认新版没做破坏性 schema 变更（见 docs/upgrade.md）。

param(
  [switch]$Check,
  [switch]$Commit,
  [switch]$Deploy,
  [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
$Compose = Join-Path $RootDir 'deploy/docker-compose.yml'
$Repo    = 'weishaw/sub2api'
$SshHost = if ($env:SSH_HOST) { $env:SSH_HOST } else { 'manifold' }
if ($Deploy) { $Commit = $true }

function Log([string]$m) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $m" }

if (-not (Test-Path $Compose)) { throw "找不到 $Compose" }
$content = Get-Content $Compose -Raw

# ─── 当前版本（从 compose 解析） ──────────────────────────────────────
$curMatch = [regex]::Match($content, '# sub2api (\d+\.\d+\.\d+)')
$digMatch = [regex]::Match($content, 'weishaw/sub2api@(sha256:[0-9a-f]+)')
if (-not $curMatch.Success -or -not $digMatch.Success) { throw 'compose 里没找到 sub2api 版本注释或 digest 行，格式变了？' }
$current       = $curMatch.Groups[1].Value
$currentDigest = $digMatch.Groups[1].Value

# ─── Docker Registry API：拿匿名 pull token → 列 tag → 查 digest ─────
Log '查询 Docker Hub（registry API）...'
$token = (Invoke-RestMethod "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${Repo}:pull").token
if (-not $token) { throw '获取 registry token 失败' }
$hdr = @{ Authorization = "Bearer $token" }

$target = $Version
if (-not $target) {
  $tags = (Invoke-RestMethod -Headers $hdr "https://registry-1.docker.io/v2/$Repo/tags/list").tags
  $target = $tags | Where-Object { $_ -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_ } | Select-Object -Last 1
  if (-not $target) { throw '没解析出任何 X.Y.Z 形式的 tag' }
}

# 多架构 manifest list 的 digest（与 compose 里 image@sha256 钉的是同一个）
$accept = 'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json'
$resp = Invoke-WebRequest -Method Head -Headers ($hdr + @{ Accept = $accept }) `
  "https://registry-1.docker.io/v2/$Repo/manifests/$target"
$digest = "$($resp.Headers['Docker-Content-Digest'])"
if ($digest -notlike 'sha256:*') { throw "没拿到 $target 的 manifest digest" }

Log "当前: $current ($($currentDigest.Substring(0,19))…)"
Log "目标: $target ($($digest.Substring(0,19))…)"
Log "release notes: https://github.com/Wei-Shaw/sub2api/releases/tag/v$target"

if ($digest -eq $currentDigest -and -not $Deploy) {
  Log 'compose 已是该版本，无事可做 ✓'
  exit 0
}
if ($Check) {
  Log '有新版可升（-Check 模式，未改文件）。重跑去掉 -Check 即可更新 compose。'
  exit 0
}

# ─── 改 compose ───────────────────────────────────────────────────────
if ($digest -ne $currentDigest) {
  $today = Get-Date -Format yyyy-MM-dd
  $content = $content -replace '# sub2api [\d.]+ \((?:built|pulled) [\d-]+\)', "# sub2api $target (pulled $today)"
  $content = $content -replace 'weishaw/sub2api@sha256:[0-9a-f]+', "weishaw/sub2api@$digest"
  if ($content -notmatch [regex]::Escape("weishaw/sub2api@$digest")) { throw 'digest 替换失败，检查 compose 格式' }
  [IO.File]::WriteAllText($Compose, $content, [Text.UTF8Encoding]::new($false))
  Log "已更新 deploy/docker-compose.yml → $target"
} else {
  Log 'compose 已是目标版本，跳过改文件'
}

# ─── commit + push ────────────────────────────────────────────────────
if ($Commit) {
  git -C $RootDir diff --quiet -- deploy/docker-compose.yml
  if ($LASTEXITCODE -ne 0) {
    git -C $RootDir add deploy/docker-compose.yml
    git -C $RootDir commit -m "deploy: sub2api 升级 $current → $target"
    if ($LASTEXITCODE -ne 0) { throw 'git commit 失败' }
    Log '已 commit'
  } else {
    Log 'compose 无未提交改动，跳过 commit'
  }
  git -C $RootDir push origin main
  if ($LASTEXITCODE -ne 0) { throw 'git push 失败' }
  Log '已 push origin main'
} else {
  Log '下一步：重跑加 -Commit 提交，或 -Deploy 一步到生产'
  exit 0
}

# ─── 生产部署 ─────────────────────────────────────────────────────────
if (-not $Deploy) { exit 0 }
Log "开始部署到生产（ssh $SshHost）..."

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

ssh $SshHost $remoteScript.Replace('__VER__', $target)
if ($LASTEXITCODE -ne 0) { throw '远端部署失败，看上面 [remote] 输出定位' }

Log '全部完成 ✓ 建议再从公网确认一次: curl https://<域名>/health'
Log "回滚：./scripts/update-sub2api.ps1 -Version $current -Deploy（若新版做了 schema migration 则需走备份恢复，见 docs/upgrade.md）"
