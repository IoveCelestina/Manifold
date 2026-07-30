#Requires -Version 7.0
<#
.SYNOPSIS
    Manifold 一键初始化：生成密钥并填充 deploy/.env。
.DESCRIPTION
    用密码学安全随机数生成 POSTGRES/JWT/TOTP/REDIS/ADMIN 密码。
    已存在的文件默认询问是否覆盖，加 -Force 跳过询问。
.EXAMPLE
    .\scripts\init.ps1
.EXAMPLE
    .\scripts\init.ps1 -Force
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$DeployDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'deploy'
if (-not (Test-Path $DeployDir)) {
    throw "找不到 deploy 目录：$DeployDir"
}

function New-HexSecret {
    param([int]$Bytes = 32)
    $buf = [byte[]]::new($Bytes)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buf)
    return ([BitConverter]::ToString($buf) -replace '-', '').ToLower()
}

function Confirm-Overwrite {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $true }
    if ($Force) { return $true }
    $resp = Read-Host "[$Path] 已存在，覆盖？(y/N)"
    return ($resp -eq 'y' -or $resp -eq 'Y')
}

function Set-EnvValue {
    param(
        [string]$Path,
        [hashtable]$Values
    )
    $lines = Get-Content -Path $Path
    $output = foreach ($line in $lines) {
        $replaced = $false
        foreach ($key in $Values.Keys) {
            $pattern = "^$([regex]::Escape($key))="
            if ($line -match $pattern) {
                $line = "$key=$($Values[$key])"
                $replaced = $true
                break
            }
        }
        $line
    }
    Set-Content -Path $Path -Value $output -Encoding utf8
}

function Protect-SecretFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($IsWindows) {
        $acl = Get-Acl -LiteralPath $Path
        # Remove inherited readers, then grant only the current account access.
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($accessRule in @($acl.Access)) {
            [void]$acl.RemoveAccessRuleSpecific($accessRule)
        }
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $accessRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $currentUser,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($accessRule)
        Set-Acl -LiteralPath $Path -AclObject $acl
        return
    }

    & chmod 600 $Path
    if ($LASTEXITCODE -ne 0) {
        throw "无法将 $Path 的权限设置为 600"
    }
}

# 生成 deploy/.env
$envTarget = Join-Path $DeployDir '.env'
if (Confirm-Overwrite $envTarget) {
    $envTemplate = Join-Path $DeployDir '.env.example'

    # 仅在确定写文件后生成，避免无用密钥留在进程内存中。
    $secrets = @{
        POSTGRES_PASSWORD     = New-HexSecret 24
        JWT_SECRET            = New-HexSecret 32
        TOTP_ENCRYPTION_KEY   = New-HexSecret 32
        REDIS_PASSWORD        = New-HexSecret 24
        ADMIN_PASSWORD        = New-HexSecret 12
    }

    Copy-Item -Path $envTemplate -Destination $envTarget -Force
    # Secret values are written only after inherited access has been removed.
    Protect-SecretFile -Path $envTarget
    Set-EnvValue -Path $envTarget -Values @{
        POSTGRES_PASSWORD   = $secrets.POSTGRES_PASSWORD
        JWT_SECRET          = $secrets.JWT_SECRET
        TOTP_ENCRYPTION_KEY = $secrets.TOTP_ENCRYPTION_KEY
        REDIS_PASSWORD      = $secrets.REDIS_PASSWORD
        ADMIN_PASSWORD      = $secrets.ADMIN_PASSWORD
    }
    Protect-SecretFile -Path $envTarget
    Write-Host "[OK] $envTarget"
} else {
    Write-Host "[SKIP] $envTarget"
}

if (Test-Path -LiteralPath $envTarget) {
    Protect-SecretFile -Path $envTarget
}

Write-Host ""
Write-Host "管理员凭据已写入 $envTarget（仅当前用户可访问；密码不会输出到终端）。" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步：" -ForegroundColor Yellow
Write-Host "  cd deploy"
Write-Host "  docker compose up -d"
Write-Host "  # 等 sub2api 健康检查通过后浏览器开 http://127.0.0.1:8080"
Write-Host ""
