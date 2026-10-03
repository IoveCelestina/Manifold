#!/usr/bin/env pwsh
# Manifold 远程部署脚本（PowerShell 版，从本机一键部署到生产 VPS）
#
# 用法：
#   ./scripts/deploy.ps1                    # 默认更新生产 caddy + blog
#   ./scripts/deploy.ps1 -Services "caddy"  # 仅更新 caddy
#   ./scripts/deploy.ps1 -Services "all"    # 更新全部服务
#   ./scripts/deploy.ps1 -Build             # 带构建本地镜像 (blog/chat-demo)
#   ./scripts/deploy.ps1 -Push              # 部署前先 git push
#
# 环境变量：
#   SSH_HOST   生产机 ssh 别名，默认 manifold
#   DEPLOY_DIR 远程部署目录，默认 /opt/manifold

param(
  [string]$Services = 'caddy blog',
  [switch]$Build,
  [switch]$Push,
  [string]$SshHost = '',
  [string]$RemoteDir = '/opt/manifold'
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot

if (-not $SshHost) {
  $SshHost = if ($env:SSH_HOST) { $env:SSH_HOST } else { 'manifold' }
}

function Log([string]$m) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $m" }

if ($Push) {
  Log '推送最新代码到 origin main...'
  git -C $RootDir push origin main
  if ($LASTEXITCODE -ne 0) { throw 'git push 失败' }
}

Log "连接到生产服务器 $SshHost 开始部署..."

$flags = @()
if ($Services -eq 'all') {
  $flags += '--all'
} else {
  $flags += "--services `"$Services`""
}
if ($Build) {
  $flags += '--build'
}

$flagStr = $flags -join ' '
$cmd = "cd $RemoteDir && bash scripts/deploy.sh $flagStr"

ssh $SshHost $cmd
if ($LASTEXITCODE -ne 0) { throw "远程部署执行失败，退出码: $LASTEXITCODE" }

Log '远程部署完成 ✓'
