#Requires -Version 7.0
<#
.SYNOPSIS
    Manifold 备份恢复脚本（PowerShell 7+ 版，与 restore.sh 等价）。
.DESCRIPTION
    默认全新机器模式：发现已有数据就拒绝继续。-Force 强制覆盖，-Yes 跳过确认。
.PARAMETER BackupPath
    本地 .tar.gz.gpg 文件路径，或当 -RcloneRemote 设置时为远端文件名。
    backup.sh --no-encrypt 产出的 .tar.gz 明文包同样可用（跳过解密）。
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
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*#') { continue }
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Resolve-DataRoot {
    $configured = $env:MANIFOLD_DATA_DIR
    if (-not $configured) {
        $configured = Read-DotEnvValue (Join-Path $DeployDir '.env') 'MANIFOLD_DATA_DIR'
    }
    if (-not $configured) { $configured = './data' }

    if ([System.IO.Path]::IsPathRooted($configured)) {
        return [System.IO.Path]::GetFullPath($configured)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $DeployDir $configured))
}

function Set-DotEnvValue {
    param([string]$Path, [string]$Key, [string]$Value)
    $found = $false
    $output = foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^$([regex]::Escape($Key))=") {
            if (-not $found) {
                $found = $true
                "$Key=$Value"
            }
        } else {
            $line
        }
    }
    if (-not $found) { $output += "$Key=$Value" }
    Set-Content -LiteralPath $Path -Value $output -Encoding utf8NoBOM
}

function Protect-SecretFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($IsWindows) {
        # Persist only the DACL; rewriting audit/owner sections can require
        # SeSecurityPrivilege even when the current user owns this file.
        $acl = [System.Security.AccessControl.FileSecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $accessRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $currentUser,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($accessRule)
        [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.FileInfo]::new($Path), $acl)
        return
    }

    & chmod 600 $Path
    if ($LASTEXITCODE -ne 0) { Die "无法将 $Path 的权限设置为 600" }
}

# stdin 从文件流到 docker exec —— 二进制安全
function Invoke-NativeFromFile {
    param([string]$Exe, [string[]]$Arguments, [string]$InFile)
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    # Use the same executable as the preceding PowerShell Docker checks.
    $psi.FileName = (Get-Command $Exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
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

$dataRoot = Resolve-DataRoot
$normalizedDataRoot = $dataRoot.TrimEnd([char[]]@('/', '\'))
$unsafeDataRoots = @(
    [System.IO.Path]::GetPathRoot($dataRoot),
    [System.IO.Path]::GetFullPath($RootDir),
    [System.IO.Path]::GetFullPath($DeployDir),
    [System.IO.Path]::GetFullPath([Environment]::GetFolderPath('UserProfile'))
)
if ($unsafeDataRoots.Where({
    [string]::Equals(
        $normalizedDataRoot,
        $_.TrimEnd([char[]]@('/', '\')),
        [System.StringComparison]::OrdinalIgnoreCase
    )
})) {
    Die "拒绝使用不安全的 MANIFOLD_DATA_DIR: $dataRoot"
}
# Ensure Compose uses the same destination even when the archive's .env came
# from a machine with a different absolute data path.
$env:MANIFOLD_DATA_DIR = $dataRoot

# ─── 1. 准备备份文件 ──────────────────────────────────────────────────
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("manifold-restore-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    $plain   = $BackupPath.EndsWith('.tar.gz')
    $tarball = Join-Path $workDir 'backup.tar.gz'
    $archive = if ($plain) { $tarball } else { Join-Path $workDir 'backup.tar.gz.gpg' }

    if (Test-Path -LiteralPath $BackupPath -PathType Leaf) {
        Copy-Item -LiteralPath $BackupPath -Destination $archive
        Write-Log "使用本地文件 $BackupPath"
    } elseif ($RcloneRemote) {
        if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) { Die "需要 rclone 才能从远端拉取" }
        Write-Log "从 $RcloneRemote/$BackupPath 拉取..."
        & rclone copyto "$RcloneRemote/$BackupPath" $archive
        if ($LASTEXITCODE -ne 0) { Die "rclone copyto 失败" }
    } else {
        Die "找不到 $BackupPath，且未设置 -RcloneRemote"
    }

    # ─── 2. 前置检查 ─────────────────────────────────────────────────
    $required = if ($plain) { 'docker', 'tar' } else { 'docker', 'gpg', 'tar' }
    foreach ($cmd in $required) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Die "需要 $cmd" }
    }
    if (-not (Test-Path $ComposeFile)) { Die "找不到 $ComposeFile" }

    $dataSubdirs = @('postgres', 'redis', 'sub2api', 'caddy', 'uptime-kuma', 'devin2api')
    $hasData = $false
    if (Test-Path (Join-Path $DeployDir '.env')) { $hasData = $true }
    foreach ($dataSubdir in $dataSubdirs) {
        if (Test-Path -LiteralPath (Join-Path $dataRoot $dataSubdir)) { $hasData = $true }
    }

    if ($hasData -and -not $Force) {
        Write-Host ""
        Write-Host "检测到现有数据：" -ForegroundColor Yellow
        Write-Host "  $DeployDir\.env (或) $dataRoot 下已有 Manifold 服务目录"
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
    $stageDir = Join-Path $workDir 'stage'
    New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

    if (-not $plain) {
        & gpg --batch --yes --decrypt --output $tarball $archive
        if ($LASTEXITCODE -ne 0) { Die "gpg 解密失败" }
    }
    & tar -xzf $tarball -C $stageDir
    if ($LASTEXITCODE -ne 0) { Die "tar 解包失败" }

    if (-not (Test-Path (Join-Path $stageDir 'MANIFEST.txt')))  { Die "备份缺 MANIFEST.txt，可能损坏" }
    if (-not (Test-Path (Join-Path $stageDir 'postgres.dump'))) { Die "备份缺 postgres.dump" }
    if (-not (Test-Path -LiteralPath (Join-Path $stageDir 'configs\.env') -PathType Leaf)) { Die "备份缺 configs/.env" }
    Write-Log "MANIFEST:"
    Get-Content -LiteralPath (Join-Path $stageDir 'MANIFEST.txt') | ForEach-Object { Write-Host "  $_" }

    # ─── 4. 停现有服务 ───────────────────────────────────────────────
    if ($hasData) {
        Write-Log "停现有 compose 栈 (down -v 清旧卷)..."
        Push-Location $DeployDir
        try { & docker compose down -v } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { Die "docker compose down 失败，未清理现有数据" }

        foreach ($dataSubdir in $dataSubdirs) {
            $dataPath = [System.IO.Path]::GetFullPath((Join-Path $dataRoot $dataSubdir))
            if ([System.IO.Path]::GetDirectoryName($dataPath) -ne $normalizedDataRoot) {
                Die "服务目录不在 MANIFOLD_DATA_DIR 内: $dataPath"
            }
            if (Test-Path -LiteralPath $dataPath) { Remove-Item -LiteralPath $dataPath -Recurse -Force }
        }
        Remove-Item -LiteralPath (Join-Path $DeployDir '.env') -Force -ErrorAction SilentlyContinue
    }

    # ─── 5. 还原配置 ─────────────────────────────────────────────────
    Write-Log "还原配置文件..."
    $restoredEnv = Join-Path $DeployDir '.env'
    Copy-Item -LiteralPath (Join-Path $stageDir 'configs\.env') -Destination $restoredEnv
    Protect-SecretFile -Path $restoredEnv
    Set-DotEnvValue -Path $restoredEnv -Key 'MANIFOLD_DATA_DIR' -Value $dataRoot
    Protect-SecretFile -Path $restoredEnv

    $stageSub2api = Join-Path $stageDir 'data\sub2api'
    if (Test-Path $stageSub2api) {
        New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
        Copy-Item -LiteralPath $stageSub2api -Destination (Join-Path $dataRoot 'sub2api') -Recurse
    }

    # devin2api：快照是单个自洽的 db 文件（无 -wal/-shm），直接放回状态目录
    $stageDevinConfig = Join-Path $stageDir 'configs\devin2api-config.yaml'
    if (Test-Path -LiteralPath $stageDevinConfig) {
        New-Item -ItemType Directory -Path (Join-Path $DeployDir 'devin2api') -Force | Out-Null
        Copy-Item -LiteralPath $stageDevinConfig -Destination (Join-Path $DeployDir 'devin2api\config.yaml') -Force
    }
    $stageDevin = Join-Path $stageDir 'data\devin2api'
    if (Test-Path $stageDevin) {
        $devinDataDir = Join-Path $dataRoot 'devin2api'
        New-Item -ItemType Directory -Path $devinDataDir -Force | Out-Null
        Get-ChildItem -LiteralPath $stageDevin -Force | Copy-Item -Destination $devinDataDir -Recurse -Force
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
    try {
        $services = @(& docker compose config --services)
        # 旧备份没有 devin2api 配置：单文件 bind mount 源不存在会被 docker 建成空目录，先跳过它
        if (-not (Test-Path -LiteralPath (Join-Path $DeployDir 'devin2api\config.yaml'))) {
            Write-Log "WARN: 没有 deploy\devin2api\config.yaml，跳过 devin2api；跑 scripts\init.ps1 生成后再 docker compose up -d devin2api"
            $services = $services | Where-Object { $_ -ne 'devin2api' }
        }
        & docker compose up -d @services
    } finally { Pop-Location }

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
