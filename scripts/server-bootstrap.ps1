#Requires -Version 7.0
<#
.SYNOPSIS
    server-bootstrap.sh 的 Windows 端伴侣 —— 把 .sh 推到远端 VPS 并执行。
.DESCRIPTION
    server-bootstrap.sh 是 Debian/Ubuntu 专用（ufw / fail2ban / apt 都没 Windows 对应），
    所以这边脚本不实际加固本机，而是负责"从本地 Windows 开发机一键推到服务器跑"。

    工作流：
      1. scp scripts/server-bootstrap.sh 到 RemoteHost:/tmp/
      2. 通过 ssh 远端用 sudo 执行，参数原样转发
      3. 把远端 stdout/stderr 转回本地

    不传 -RemoteHost 时只打印等价 Linux 命令清单供人工 review，不做任何动作。
.PARAMETER RemoteHost
    user@server 形式的目标。例如 root@vps.example.com 或 ubuntu@1.2.3.4
.PARAMETER SshPort
    远端 SSH 端口（同 .sh 的 --ssh-port）。默认 22。
.PARAMETER DryRun
    .sh 那边的 --dry-run，远端只打印不执行。
.PARAMETER SkipDocker
    远端跳过 docker 安装。
.PARAMETER AllowRootSsh
    放行 root 用 key 登录 SSH。
.PARAMETER User
    远端要保留 key 登录权限的非 root 用户（默认 SUDO_USER）。
.PARAMETER ClientSshPort
    本地 ssh/scp 连去远端用的端口（机器初次连接还是 22 时用得着，跟远端最终端口分开）。
.EXAMPLE
    .\scripts\server-bootstrap.ps1                          # 只打印 review
    .\scripts\server-bootstrap.ps1 -RemoteHost root@vps -DryRun
    .\scripts\server-bootstrap.ps1 -RemoteHost ubuntu@1.2.3.4 -SshPort 2200
#>
[CmdletBinding()]
param(
    [string]$RemoteHost      = "",
    [int]   $SshPort         = 22,
    [int]   $ClientSshPort   = 0,
    [switch]$DryRun,
    [switch]$SkipDocker,
    [switch]$AllowRootSsh,
    [string]$User            = ""
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $PSCommandPath
$ShPath    = Join-Path $ScriptDir 'server-bootstrap.sh'

if (-not (Test-Path $ShPath)) {
    throw "找不到 $ShPath —— 这份 ps1 是它的客户端，必须配对"
}

# ─── 拼远端要跑的 .sh 参数 ────────────────────────────────────
$shArgs = [System.Collections.Generic.List[string]]::new()
$shArgs.Add("--ssh-port"); $shArgs.Add("$SshPort")
if ($DryRun)         { $shArgs.Add("--dry-run") }
if ($SkipDocker)     { $shArgs.Add("--skip-docker") }
if ($AllowRootSsh)   { $shArgs.Add("--allow-root-ssh") }
if ($User)           { $shArgs.Add("--user"); $shArgs.Add($User) }

# ─── 没指定远端：进 review 模式 ─────────────────────────────
if (-not $RemoteHost) {
    Write-Host "server-bootstrap.ps1 — review 模式" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "本脚本不会在 Windows 本机加固任何东西（apt/ufw/fail2ban 都不存在）。" -ForegroundColor Yellow
    Write-Host "用法二选一：" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  A) 远端跑（推荐，从本机一键推到 VPS）：" -ForegroundColor Green
    Write-Host "       .\scripts\server-bootstrap.ps1 -RemoteHost root@<vps-ip> -DryRun"
    Write-Host "       .\scripts\server-bootstrap.ps1 -RemoteHost root@<vps-ip>"
    Write-Host ""
    Write-Host "  B) 直接登录到 VPS 上手工跑：" -ForegroundColor Green
    Write-Host "       scp scripts/server-bootstrap.sh user@vps:/tmp/"
    Write-Host "       ssh user@vps 'sudo bash /tmp/server-bootstrap.sh $(($shArgs -join ' '))'"
    Write-Host ""
    Write-Host "下面是 server-bootstrap.sh 会在 VPS 上执行的动作（高级概览）：" -ForegroundColor Cyan
    Write-Host "  1. apt update + 装 ufw / fail2ban / unattended-upgrades / docker"
    Write-Host "  2. ufw deny incoming，仅放行 $SshPort/tcp、80/tcp、443/tcp"
    Write-Host "  3. fail2ban sshd jail（5 次失败 ban 1h）"
    Write-Host "  4. unattended-upgrades 自动打安全补丁，不自动重启"
    Write-Host "  5. SSH 加固 → /etc/ssh/sshd_config.d/99-manifold.conf："
    Write-Host "       Port $SshPort"
    Write-Host "       PasswordAuthentication no"
    Write-Host "       PermitRootLogin $($AllowRootSsh ? 'prohibit-password' : 'no')"
    Write-Host "  6. 装 docker engine + compose plugin，把目标用户加 docker 组"
    Write-Host ""
    Write-Host "完整内容看 scripts/server-bootstrap.sh" -ForegroundColor DarkGray
    exit 0
}

# ─── 远端模式：检查 ssh/scp 是否在 PATH ─────────────────────
foreach ($cmd in 'ssh','scp') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "本机找不到 $cmd，Win10/11 自带 OpenSSH 客户端：设置 → 应用 → 可选功能 → OpenSSH 客户端"
    }
}

if ($ClientSshPort -eq 0) { $ClientSshPort = $SshPort }

$sshOpts = @('-p', "$ClientSshPort", '-o', 'StrictHostKeyChecking=accept-new')
$scpOpts = @('-P', "$ClientSshPort", '-o', 'StrictHostKeyChecking=accept-new')

# 远端落地路径用 PID 避免和别人撞
$remoteTmp = "/tmp/server-bootstrap.$([guid]::NewGuid().ToString('N').Substring(0,8)).sh"

Write-Host "[1/3] scp 推到 ${RemoteHost}:$remoteTmp ..." -ForegroundColor Cyan
& scp @scpOpts $ShPath "${RemoteHost}:$remoteTmp"
if ($LASTEXITCODE -ne 0) { throw "scp 失败（exit $LASTEXITCODE）" }

Write-Host "[2/3] 远端 sudo 执行 ..." -ForegroundColor Cyan
$remoteCmd = "sudo bash $remoteTmp $($shArgs -join ' '); rc=`$?; rm -f $remoteTmp; exit `$rc"
& ssh @sshOpts $RemoteHost $remoteCmd
$rc = $LASTEXITCODE

Write-Host ""
if ($rc -eq 0) {
    Write-Host "[3/3] 完成。立即用新配置另开一个 ssh 验证：" -ForegroundColor Green
    Write-Host "    ssh -p $SshPort $RemoteHost"
} else {
    Write-Host "[3/3] 远端脚本退出码 $rc —— 临时文件已清理，到 VPS 上 journalctl -u ssh / ufw status 排查" -ForegroundColor Red
    exit $rc
}
