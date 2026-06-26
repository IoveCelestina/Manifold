#Requires -Version 7.0
<#
.SYNOPSIS
    Manifold 备份恢复脚本（PowerShell 7+ 版，与 restore.sh 等价）。
.DESCRIPTION
    默认全新机器模式：发现已有数据就拒绝继续。-Force 强制覆盖，-Yes 跳过确认。
.PARAMETER BackupPath
    本地 .tar.gz.gpg 文件路径，或当 -RcloneRemote 设置时为远端文件名。
.PARAMETER RcloneRemote
    可选，当 BackupPath 不是本地文件时从这里拉取。
.PARAMETER Force
    存在数据时强制覆盖。
.PARAMETER Yes
    跳过交互确认。
.EXAMPLE
    .\scripts\restore.ps1 -BackupPath C:\backups\manifold-2026-05-20T03-00-00.tar.gz.gpg
.EXAMPLE
    .\scripts\restore.ps1 -BackupPath manifold-2026-05-20T03-00-00.tar.gz.gpg -RcloneRemote b2:manifold-backups -Force -Yes
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,
    [string]$RcloneRemote = $env:RCLONE_REMOTE,
    [switch]$Force,
    [switch]$Yes,
    [string]$PostgresContainer = "manifold-postgres",
    [string]$Sub2apiContainer  = "manifold-sub2api"
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['*:Encoding'] = 'utf8NoBOM'

$ScriptDir   = $PSScriptRoot
$RootDir     = Split-Path $ScriptDir -Parent
$DeployDir   = Join-Path $RootDir 'deploy'
$ComposeFile = Join-Path $DeployDir 'docker-compose.yml'

function Write-Log { param([string]$Msg) Write-Host ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg) }
function Die       { param([string]$Msg) Write-Host "ERROR: $Msg" -ForegroundColor Red; exit 1 }

function Read-DotEnvValue {
    param([string]$Path, [string]$Key)
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*#') { continue }
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

# stdin 从文件流到 docker exec —— 二进制安全
function Invoke-NativeFromFile {
    param([string]$Exe, [string[]]$Arguments, [string]$InFile)
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $Exe
    foreach ($a in $Arguments) { [void]$psi.ArgumentList.Add($a) }
    $psi.RedirectStandardInput  = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute = $false
    $proc = [System.Diagnostics.Process]::Start($psi)

    $fs = [System.IO.File]::OpenRead($InFile)
    try   { $fs.CopyTo($proc.StandardInput.BaseStream) }
    finally {
        $fs.Dispose()
        $proc.StandardInput.Close()
    }
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    if ($stdout) { $stdout -split "`n" | ForEach-Object { if ($_) { Write-Host "  $_" } } }
    if ($stderr) { $stderr -split "`n" | ForEach-Object { if ($_) { Write-Host "  $_" } } }
    if ($proc.ExitCode -ne 0) { Die "$Exe 退出码 $($proc.ExitCode)" }
}

# ─── 1. 准备备份文件 ──────────────────────────────────────────────────
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("manifold-restore-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    $encrypted = Join-Path $workDir 'backup.tar.gz.gpg'

    if (Test-Path -LiteralPath $BackupPath -PathType Leaf) {
        Copy-Item -LiteralPath $BackupPath -Destination $encrypted
        Write-Log "使用本地文件 $BackupPath"
    } elseif ($RcloneRemote) {
        if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) { Die "需要 rclone 才能从远端拉取" }
        Write-Log "从 $RcloneRemote/$BackupPath 拉取..."
        & rclone copyto "$RcloneRemote/$BackupPath" $encrypted
        if ($LASTEXITCODE -ne 0) { Die "rclone copyto 失败" }
    } else {
        Die "找不到 $BackupPath，且未设置 -RcloneRemote"
    }

    # ─── 2. 前置检查 ─────────────────────────────────────────────────
    foreach ($cmd in 'docker', 'gpg', 'tar') {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Die "需要 $cmd" }
    }
    if (-not (Test-Path $ComposeFile)) { Die "找不到 $ComposeFile" }

    $hasData = $false
    if (Test-Path (Join-Path $DeployDir '.env')) { $hasData = $true }
    $pgDataDir = Join-Path $DeployDir 'data\postgres'
    if ((Test-Path $pgDataDir) -and (Get-ChildItem -LiteralPath $pgDataDir -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        $hasData = $true
    }

    if ($hasData -and -not $Force) {
        Write-Host ""
        Write-Host "检测到现有数据：" -ForegroundColor Yellow
        Write-Host "  $DeployDir\.env (或) $DeployDir\data\postgres\ 非空"
        Write-Host ""
        Write-Host "restore.ps1 默认只在全新环境上运行。若确定要覆盖："
        Write-Host "  .\scripts\restore.ps1 -BackupPath '$BackupPath' -Force -Yes"
        exit 3
    }

    if ($hasData -and -not $Yes) {
        $ans = Read-Host "⚠  将覆盖 $DeployDir 现有数据。输入 RESTORE 确认继续"
        if ($ans -ne 'RESTORE') { Die "用户取消" }
    }

    # ─── 3. 解密 + 解包 ──────────────────────────────────────────────
    Write-Log "解密 + 解包..."
    $tarball  = Join-Path $workDir 'backup.tar.gz'
    $stageDir = Join-Path $workDir 'stage'
    New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

    & gpg --batch --yes --decrypt --output $tarball $encrypted
    if ($LASTEXITCODE -ne 0) { Die "gpg 解密失败" }
    & tar -xzf $tarball -C $stageDir
    if ($LASTEXITCODE -ne 0) { Die "tar 解包失败" }

    if (-not (Test-Path (Join-Path $stageDir 'MANIFEST.txt')))  { Die "备份缺 MANIFEST.txt，可能损坏" }
    if (-not (Test-Path (Join-Path $stageDir 'postgres.dump'))) { Die "备份缺 postgres.dump" }
    Write-Log "MANIFEST:"
    Get-Content -LiteralPath (Join-Path $stageDir 'MANIFEST.txt') | ForEach-Object { Write-Host "  $_" }

    # ─── 4. 停现有服务 ───────────────────────────────────────────────
    if ($hasData) {
        Write-Log "停现有 compose 栈 (down -v 清旧卷)..."
        Push-Location $DeployDir
        try { & docker compose down -v } finally { Pop-Location }

        Remove-Item -LiteralPath (Join-Path $DeployDir 'data')       -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath (Join-Path $DeployDir '.env')                 -Force -ErrorAction SilentlyContinue
    }

    # ─── 5. 还原配置 ─────────────────────────────────────────────────
    Write-Log "还原配置文件..."
    Copy-Item -LiteralPath (Join-Path $stageDir 'configs\.env') -Destination (Join-Path $DeployDir '.env')

    $stageSub2api = Join-Path $stageDir 'data\sub2api'
    if (Test-Path $stageSub2api) {
        New-Item -ItemType Directory -Path (Join-Path $DeployDir 'data') -Force | Out-Null
        Copy-Item -LiteralPath $stageSub2api -Destination (Join-Path $DeployDir 'data\sub2api') -Recurse
    }
    # ─── 6. 起 postgres + pg_restore ─────────────────────────────────
    Write-Log "拉起 postgres..."
    Push-Location $DeployDir
    try { & docker compose up -d postgres } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Die "docker compose up postgres 失败" }

    Write-Log "等 postgres 健康..."
    $state = 'starting'
    for ($i = 1; $i -le 30; $i++) {
        $state = (docker inspect -f '{{.State.Health.Status}}' $PostgresContainer 2>$null)
        if ($state -eq 'healthy') { break }
        Start-Sleep -Seconds 2
    }
    if ($state -ne 'healthy') { Die "postgres 30 次健康检查未通过，最后状态: $state" }

    $pgUser = Read-DotEnvValue (Join-Path $DeployDir '.env') 'POSTGRES_USER'; if (-not $pgUser) { $pgUser = 'sub2api' }
    $pgDb   = Read-DotEnvValue (Join-Path $DeployDir '.env') 'POSTGRES_DB'  ; if (-not $pgDb)   { $pgDb   = 'sub2api' }

    Write-Log "pg_restore..."
    Invoke-NativeFromFile -Exe 'docker' -Arguments @(
        'exec', '-i', $PostgresContainer,
        'pg_restore', '-U', $pgUser, '-d', $pgDb,
        '--clean', '--if-exists', '--no-owner', '--no-privileges'
    ) -InFile (Join-Path $stageDir 'postgres.dump')

    # ─── 7. 拉起其余服务 ─────────────────────────────────────────────
    Write-Log "拉起完整 compose 栈..."
    Push-Location $DeployDir
    try { & docker compose up -d } finally { Pop-Location }

    Write-Log "等 sub2api 健康..."
    $state = 'starting'
    for ($i = 1; $i -le 60; $i++) {
        $state = (docker inspect -f '{{.State.Health.Status}}' $Sub2apiContainer 2>$null)
        if ($state -eq 'healthy') { break }
        Start-Sleep -Seconds 2
    }
    if ($state -eq 'healthy') {
        Write-Log "完成 ✓ sub2api 已健康"
    } else {
        Write-Log "WARN: sub2api 最后状态 $state，请检查 docker compose logs"
    }
}
finally {
    if (Test-Path $workDir) { Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue }
}
