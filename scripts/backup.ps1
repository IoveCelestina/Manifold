#Requires -Version 7.0
<#
.SYNOPSIS
    Manifold 全量备份脚本（PowerShell 7+ 版，与 backup.sh 等价）。
.DESCRIPTION
    打包内容：postgres custom dump + .env + data/sub2api
    输出单个 .tar.gz.gpg 加密包，可选 rclone 推异地。
.PARAMETER GpgRecipient
    必填，GPG 收件人。多个用逗号分隔。
.PARAMETER RcloneRemote
    可选，rclone 远端，如 b2:manifold-backups。
.PARAMETER BackupDir
    本地输出目录，默认 ../backups。
.PARAMETER RetentionDaily
    本地+远端每天一份保留 N 天，默认 7。
.PARAMETER RetentionMonthly
    每月首份额外保留 M 个月，默认 12。
.EXAMPLE
    .\scripts\backup.ps1 -GpgRecipient you@example.com
.EXAMPLE
    .\scripts\backup.ps1 -GpgRecipient "you@example.com,backup-key@example.com" -RcloneRemote b2:manifold-backups
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GpgRecipient,
    [string]$RcloneRemote = $env:RCLONE_REMOTE,
    [string]$BackupDir,
    [int]$RetentionDaily = 7,
    [int]$RetentionMonthly = 12,
    [string]$PostgresContainer = "manifold-postgres"
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['*:Encoding'] = 'utf8NoBOM'

$ScriptDir = $PSScriptRoot
$RootDir   = Split-Path $ScriptDir -Parent
$DeployDir = Join-Path $RootDir 'deploy'
if (-not $BackupDir) { $BackupDir = Join-Path $RootDir 'backups' }

function Write-Log { param([string]$Msg) Write-Host ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg) }
function Die       { param([string]$Msg) Write-Host "ERROR: $Msg" -ForegroundColor Red; exit 1 }

function Read-DotEnvValue {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path $Path)) { Die "找不到 $Path" }
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*#') { continue }
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

# 二进制安全：把 native 进程 stdout 流式写到文件
function Invoke-NativeToFile {
    param([string]$Exe, [string[]]$Arguments, [string]$OutFile)
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $Exe
    foreach ($a in $Arguments) { [void]$psi.ArgumentList.Add($a) }
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute = $false
    $proc = [System.Diagnostics.Process]::Start($psi)

    $fs = [System.IO.File]::Create($OutFile)
    try   { $proc.StandardOutput.BaseStream.CopyTo($fs) }
    finally { $fs.Dispose() }
    $err = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { Die "$Exe 退出码 $($proc.ExitCode): $err" }
}

# ─── 1. 前置检查 ──────────────────────────────────────────────────────
Write-Log "前置检查..."
foreach ($cmd in 'docker', 'gpg', 'tar') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Die "需要 $cmd" }
}
if ($RcloneRemote -and -not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    Die "RcloneRemote 已设置但找不到 rclone"
}

$running = (docker inspect -f '{{.State.Running}}' $PostgresContainer 2>$null)
if ($running -ne 'true') { Die "postgres 容器 ($PostgresContainer) 未运行" }

$pgUser = Read-DotEnvValue (Join-Path $DeployDir '.env') 'POSTGRES_USER'; if (-not $pgUser) { $pgUser = 'sub2api' }
$pgDb   = Read-DotEnvValue (Join-Path $DeployDir '.env') 'POSTGRES_DB'  ; if (-not $pgDb)   { $pgDb   = 'sub2api' }

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

# ─── 2. 临时工作目录 ─────────────────────────────────────────────────
$timestamp = (Get-Date).ToString('yyyy-MM-ddTHH-mm-ss')
$archiveName = "manifold-$timestamp.tar.gz.gpg"
$workDir  = Join-Path ([System.IO.Path]::GetTempPath()) ("manifold-backup-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
$stageDir = Join-Path $workDir 'stage'
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

try {
    Write-Log "打包到 $workDir"

    # 2a. pg_dump
    Write-Log "[1/4] pg_dump..."
    $dumpPath = Join-Path $stageDir 'postgres.dump'
    Invoke-NativeToFile -Exe 'docker' -Arguments @(
        'exec', $PostgresContainer,
        'pg_dump', '-U', $pgUser, '-d', $pgDb, '--format=custom', '--compress=9'
    ) -OutFile $dumpPath
    $dumpSize = (Get-Item $dumpPath).Length
    if ($dumpSize -lt 100) { Die "pg_dump 输出异常小 ($dumpSize 字节)，疑似失败" }
    Write-Log "  postgres.dump = $dumpSize 字节"

    # 2b. 配置和 token
    Write-Log "[2/4] 拷贝配置和 OAuth token..."
    $cfgRoot = Join-Path $stageDir 'configs'
    New-Item -ItemType Directory -Path $cfgRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $DeployDir '.env') -Destination (Join-Path $cfgRoot '.env')

    $sub2apiData = Join-Path $DeployDir 'data\sub2api'
    if (Test-Path $sub2apiData) {
        $dataDir = Join-Path $stageDir 'data'
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        Copy-Item -LiteralPath $sub2apiData -Destination (Join-Path $dataDir 'sub2api') -Recurse
    }

    $gitCommit = try { (git -C $RootDir rev-parse HEAD 2>$null).Trim() } catch { 'unknown' }
    $manifest = @"
created_at: $timestamp
hostname:   $([System.Net.Dns]::GetHostName())
postgres_container: $PostgresContainer
postgres_user:      $pgUser
postgres_db:        $pgDb
git_commit:         $gitCommit
"@
    Set-Content -LiteralPath (Join-Path $stageDir 'MANIFEST.txt') -Value $manifest -Encoding utf8NoBOM

    # ─── 3. tar + gpg ────────────────────────────────────────────────
    Write-Log "[3/4] tar + gpg..."
    $tarball = Join-Path $workDir ($archiveName -replace '\.gpg$','')
    & tar -czf $tarball -C $stageDir .
    if ($LASTEXITCODE -ne 0) { Die "tar 失败 ($LASTEXITCODE)" }

    $gpgArgs = @('--batch', '--yes', '--trust-model', 'always', '--encrypt')
    foreach ($r in ($GpgRecipient -split ',')) {
        $rt = $r.Trim()
        if ($rt) { $gpgArgs += @('--recipient', $rt) }
    }
    $finalTmp = Join-Path $BackupDir (".$archiveName.tmp")
    $gpgArgs += @('--output', $finalTmp, $tarball)
    & gpg @gpgArgs
    if ($LASTEXITCODE -ne 0) { Die "gpg 加密失败 ($LASTEXITCODE)" }

    $finalPath = Join-Path $BackupDir $archiveName
    Move-Item -LiteralPath $finalTmp -Destination $finalPath -Force
    $finalSize = (Get-Item $finalPath).Length
    Write-Log "  本地: $finalPath ($finalSize 字节)"

    # ─── 4. 推异地 + 清旧 ────────────────────────────────────────────
    if ($RcloneRemote) {
        Write-Log "[4/4] rclone copy -> $RcloneRemote/"
        & rclone copy $finalPath "$RcloneRemote/" --progress
        if ($LASTEXITCODE -ne 0) { Die "rclone copy 失败 ($LASTEXITCODE)" }
    } else {
        Write-Log "[4/4] RcloneRemote 未设置，跳过异地上传 (⚠ 仅本地备份不算异地)"
    }

    # 清旧本地
    $files = Get-ChildItem -Path $BackupDir -File -Filter 'manifold-*.tar.gz.gpg' |
             Sort-Object Name -Descending |
             Select-Object -ExpandProperty Name
    $keep = @{}
    $i = 0
    foreach ($f in $files) {
        $keep[$f] = $true; $i++
        if ($i -ge $RetentionDaily) { break }
    }
    $months = @{}
    foreach ($f in $files) {
        $ym = $f.Substring('manifold-'.Length, 7)
        if (-not $months.ContainsKey($ym)) {
            $months[$ym] = $true; $keep[$f] = $true
        }
        if ($months.Count -ge $RetentionMonthly) { break }
    }
    foreach ($f in $files) {
        if (-not $keep.ContainsKey($f)) {
            Remove-Item -LiteralPath (Join-Path $BackupDir $f) -Force
            Write-Log "  本地清理 $f"
        }
    }

    # 清旧远端
    if ($RcloneRemote) {
        $remoteFiles = & rclone lsf $RcloneRemote --include 'manifold-*.tar.gz.gpg' | Sort-Object -Descending
        $rkeep = @{}
        $j = 0
        foreach ($f in $remoteFiles) {
            $rkeep[$f] = $true; $j++
            if ($j -ge $RetentionDaily) { break }
        }
        $rmonths = @{}
        foreach ($f in $remoteFiles) {
            $ym = $f.Substring('manifold-'.Length, 7)
            if (-not $rmonths.ContainsKey($ym)) {
                $rmonths[$ym] = $true; $rkeep[$f] = $true
            }
            if ($rmonths.Count -ge $RetentionMonthly) { break }
        }
        foreach ($f in $remoteFiles) {
            if (-not $rkeep.ContainsKey($f)) {
                & rclone deletefile "$RcloneRemote/$f"
                Write-Log "  远端清理 $f"
            }
        }
    }

    Write-Log "完成 ✓"
    Write-Output $finalPath
}
finally {
    if (Test-Path $workDir) { Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue }
}
