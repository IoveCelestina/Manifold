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

# 1. 生成全部密钥
$secrets = @{
    POSTGRES_PASSWORD     = New-HexSecret 24
    JWT_SECRET            = New-HexSecret 32
    TOTP_ENCRYPTION_KEY   = New-HexSecret 32
    REDIS_PASSWORD        = New-HexSecret 24
    ADMIN_PASSWORD        = New-HexSecret 12
}

# 2. 生成 deploy/.env
$envTarget = Join-Path $DeployDir '.env'
if (Confirm-Overwrite $envTarget) {
    $envTemplate = Join-Path $DeployDir '.env.example'
    Copy-Item -Path $envTemplate -Destination $envTarget -Force
    Set-EnvValue -Path $envTarget -Values @{
        POSTGRES_PASSWORD   = $secrets.POSTGRES_PASSWORD
        JWT_SECRET          = $secrets.JWT_SECRET
        TOTP_ENCRYPTION_KEY = $secrets.TOTP_ENCRYPTION_KEY
        REDIS_PASSWORD      = $secrets.REDIS_PASSWORD
        ADMIN_PASSWORD      = $secrets.ADMIN_PASSWORD
    }
    Write-Host "[OK] $envTarget"
} else {
    Write-Host "[SKIP] $envTarget"
}

# 3. 打印关键凭据 —— 用户必须记下来
Write-Host ""
Write-Host "=== 关键凭据（请妥善保存，下次脚本可能覆盖）===" -ForegroundColor Cyan
Write-Host ("  Admin email           : " + (Select-String -Path $envTarget -Pattern '^ADMIN_EMAIL=').Line.Split('=', 2)[1])
Write-Host ("  Admin password        : " + $secrets.ADMIN_PASSWORD)
Write-Host ""
Write-Host "下一步：" -ForegroundColor Yellow
Write-Host "  cd deploy"
Write-Host "  docker compose up -d"
Write-Host "  # 等 sub2api 健康检查通过后浏览器开 http://127.0.0.1:8080 用上面 admin 账号登录"
Write-Host ""
