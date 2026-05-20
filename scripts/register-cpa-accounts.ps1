#Requires -Version 7.0
<#
.SYNOPSIS
    把所有 deploy/cpa-* 实例自动注册为 sub2api 后台的上游账号。
.DESCRIPTION
    1. 从 deploy/.env 读 admin 凭据
    2. 从 deploy/cpa-*/config.yaml 发现实例和它们的内网共享秘钥
    3. 登录 sub2api 拿 JWT
    4. 为每个 CPA 实例创建 type=apikey 上游账号，base_url 指向容器内网名
    5. 同名账号已存在则跳过，除非 -Force
.PARAMETER ApiBase
    sub2api 的 HTTP 入口，默认 http://127.0.0.1:8080
.PARAMETER Platform
    给 CPA 实例注册哪种平台账号：anthropic（默认）、openai、both
.PARAMETER Force
    跳过"已存在则不动"的检查，强制重建
.EXAMPLE
    .\scripts\register-cpa-accounts.ps1
.EXAMPLE
    .\scripts\register-cpa-accounts.ps1 -Platform both -Force
#>
[CmdletBinding()]
param(
    [string]$ApiBase = "http://127.0.0.1:8080",
    [ValidateSet("anthropic", "openai", "both")]
    [string]$Platform = "anthropic",
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$DeployDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'deploy'

function Read-DotEnv {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) { throw ".env 不存在，先跑 scripts/init.ps1：$Path" }
    foreach ($line in Get-Content $Path) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
            $map[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $map
}

function Get-CpaInstances {
    param([string]$Root)
    $instances = @()
    foreach ($dir in Get-ChildItem -Path $Root -Directory -Filter "cpa-*") {
        $cfg = Join-Path $dir.FullName "config.yaml"
        if (-not (Test-Path $cfg)) { continue }
        # 抓取 api-keys 列表里的第一个值
        $content = Get-Content -Path $cfg -Raw
        if ($content -match '(?ms)^api-keys:\s*\r?\n((?:\s*-\s*.*\r?\n?)+)') {
            $list = $matches[1]
            if ($list -match '-\s*["'']?([^"''\r\n]+)["'']?') {
                $instances += [pscustomobject]@{
                    Name       = $dir.Name            # cpa-1 / cpa-2
                    BaseUrl    = "http://$($dir.Name):8317"
                    SharedKey  = $matches[1].Trim()
                }
            }
        }
    }
    return $instances
}

function Invoke-Sub2Api {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Headers = @{},
        $Body = $null
    )
    $params = @{
        Uri             = "$ApiBase$Path"
        Method          = $Method
        Headers         = $Headers
        UseBasicParsing = $true
        TimeoutSec      = 15
    }
    if ($Body -ne $null) {
        $params.Body        = ($Body | ConvertTo-Json -Depth 8)
        $params.ContentType = 'application/json'
    }
    $resp = Invoke-WebRequest @params
    return ($resp.Content | ConvertFrom-Json)
}

# --- 1. 读凭据
$envMap = Read-DotEnv -Path (Join-Path $DeployDir '.env')
$adminEmail    = $envMap['ADMIN_EMAIL']
$adminPassword = $envMap['ADMIN_PASSWORD']
if (-not $adminEmail -or -not $adminPassword) {
    throw ".env 里 ADMIN_EMAIL / ADMIN_PASSWORD 没设；先跑 scripts/init.ps1 -Force"
}

# --- 2. 发现 CPA 实例
$cpas = Get-CpaInstances -Root $DeployDir
if ($cpas.Count -eq 0) { throw "在 $DeployDir 下没找到 cpa-*/config.yaml" }
Write-Host "发现 $($cpas.Count) 个 CPA 实例："
foreach ($c in $cpas) {
    Write-Host ("  - {0,-6} {1}   key={2}..." -f $c.Name, $c.BaseUrl, $c.SharedKey.Substring(0, 8))
}

# --- 3. 登录
Write-Host ""
Write-Host "登录 sub2api ($ApiBase) as $adminEmail..."
$login = Invoke-Sub2Api -Method POST -Path "/api/v1/auth/login" -Body @{
    email    = $adminEmail
    password = $adminPassword
}
if ($login.code -ne 0) { throw "登录失败: $($login.message)" }
$token = $login.data.access_token
$authHeader = @{ Authorization = "Bearer $token" }
Write-Host "[OK] role=$($login.data.user.role) user_id=$($login.data.user.id)"

# --- 4. 拉现有账号列表（用于幂等检查）
$existing = Invoke-Sub2Api -Method GET -Path "/api/v1/admin/accounts?page_size=200" -Headers $authHeader
$existingNames = @{}
foreach ($acc in $existing.data.items) { $existingNames[$acc.name] = $acc.id }

# --- 5. 决定要注册哪些平台
$platforms = switch ($Platform) {
    "anthropic" { @("anthropic") }
    "openai"    { @("openai") }
    "both"      { @("anthropic", "openai") }
}

# --- 6. 逐个创建
Write-Host ""
$created = 0; $skipped = 0; $failed = 0
foreach ($cpa in $cpas) {
    foreach ($plat in $platforms) {
        $accName = "$($cpa.Name)-$plat"   # 如 cpa-1-anthropic
        if ($existingNames.ContainsKey($accName) -and -not $Force) {
            Write-Host "[SKIP] $accName 已存在 (id=$($existingNames[$accName]))"
            $skipped++
            continue
        }

        $payload = @{
            name        = $accName
            platform    = $plat
            type        = "apikey"
            credentials = @{
                api_key  = $cpa.SharedKey
                base_url = $cpa.BaseUrl
            }
            concurrency = 5
            priority    = 100
        }
        try {
            $r = Invoke-Sub2Api -Method POST -Path "/api/v1/admin/accounts" -Headers $authHeader -Body $payload
            if ($r.code -eq 0) {
                Write-Host "[OK ] $accName 创建成功 id=$($r.data.id)"
                $created++
            } else {
                Write-Host "[FAIL] $accName 业务失败: $($r.message)" -ForegroundColor Red
                $failed++
            }
        } catch {
            $msg = $_.Exception.Message
            if ($_.Exception.Response) {
                try {
                    $stream = $_.Exception.Response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($stream)
                    $msg += " | body=$($reader.ReadToEnd())"
                } catch {}
            }
            Write-Host "[FAIL] $accName HTTP 失败: $msg" -ForegroundColor Red
            $failed++
        }
    }
}

Write-Host ""
Write-Host "完成: created=$created skipped=$skipped failed=$failed" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步：" -ForegroundColor Yellow
Write-Host "  # 在 CPA 容器里跑 OAuth 登录把订阅挂上去"
Write-Host "  docker compose exec cpa-1 ./CLIProxyAPI login --provider claude"
Write-Host "  docker compose exec cpa-2 ./CLIProxyAPI login --provider claude"
Write-Host "  # 然后在 sub2api 后台给账号开 API Key 给用户用"

if ($failed -gt 0) { exit 1 }
