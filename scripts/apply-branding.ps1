#Requires -Version 7.0
<#
.SYNOPSIS
    Manifold 品牌化：把 deploy/branding.json 应用到 sub2api（对应 apply-branding.sh）。
.DESCRIPTION
    sub2api 自带完整品牌化钩子（site_name / site_logo / site_subtitle / home_content /
    doc_url / contact_info / login_agreement_*），通过 PUT /api/v1/admin/settings 一次性更新。
    不改 sub2api 源码 = LGPL 零风险。

    工作流程：
      1. 读 deploy/branding.json（首次先 cp branding.example.json）
      2. 把每条 agreement.source_file（如 docs/legal/terms-of-service.md）读入 content_md
      3. 登录 sub2api → PUT /api/v1/admin/settings 整体更新
.PARAMETER ApiBase
    sub2api HTTP 入口。默认 http://127.0.0.1:8080
.PARAMETER DryRun
    只算 payload 不实际 PUT
.EXAMPLE
    .\scripts\apply-branding.ps1
.EXAMPLE
    .\scripts\apply-branding.ps1 -ApiBase https://yesterhaze.codes
#>
[CmdletBinding()]
param(
    [string]$ApiBase = $(if ($env:API_BASE) { $env:API_BASE } else { "http://127.0.0.1:8080" }),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$RootDir   = Split-Path $ScriptDir -Parent
$DeployDir = Join-Path $RootDir 'deploy'
$EnvPath   = Join-Path $DeployDir '.env'
$Branding        = Join-Path $DeployDir 'branding.json'
$BrandingExample = Join-Path $DeployDir 'branding.example.json'

if (-not (Test-Path $EnvPath))   { throw "找不到 $EnvPath" }
if (-not (Test-Path $Branding))  {
    if (Test-Path $BrandingExample) {
        throw "找不到 $Branding；先：Copy-Item '$BrandingExample' '$Branding' 再按需编辑"
    } else {
        throw "找不到 $Branding 与 $BrandingExample"
    }
}

function Read-DotEnv {
    param([string]$Path)
    $map = @{}
    foreach ($line in Get-Content $Path) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
            $map[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $map
}

$envMap = Read-DotEnv $EnvPath
$adminEmail    = $envMap['ADMIN_EMAIL']
$adminPassword = $envMap['ADMIN_PASSWORD']
if (-not $adminEmail -or -not $adminPassword) {
    throw ".env 缺 ADMIN_EMAIL / ADMIN_PASSWORD"
}

# ─── 1. 加载 branding.json，剥 _README ────────────────────────────────
$brand = Get-Content $Branding -Raw | ConvertFrom-Json -AsHashtable
$brand.Remove('_README') | Out-Null

# ─── 2. agreements[].source_file → login_agreement_documents[] ────────
$agreements = @($brand['agreements'])
$agreeCount = $agreements.Count
$loginDocs  = @()
for ($i = 0; $i -lt $agreeCount; $i++) {
    $entry = $agreements[$i]
    $srcAbs = Join-Path $RootDir $entry.source_file
    if (-not (Test-Path $srcAbs)) {
        throw "agreements[$i].source_file 指向的 $srcAbs 不存在"
    }
    $content = Get-Content $srcAbs -Raw
    $loginDocs += [ordered]@{
        id         = $entry.id
        title      = $entry.title
        content_md = $content
    }
}

$brand.Remove('agreements') | Out-Null
$brand['login_agreement_documents'] = $loginDocs

# ─── 3. 报告将要 PUT 的字段 ──────────────────────────────────────────
Write-Host "将要 PUT 的字段："
foreach ($k in ($brand.Keys | Sort-Object)) {
    Write-Host "  - $k"
}

if ($DryRun) {
    Write-Host ""
    Write-Host "(--DryRun 模式：不实际 PUT)"
    return
}

# ─── 4. 登录 ─────────────────────────────────────────────────────────
try {
    $login = (Invoke-WebRequest -Uri "$ApiBase/api/v1/auth/login" -Method POST `
                -Body (@{ email = $adminEmail; password = $adminPassword } | ConvertTo-Json) `
                -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30).Content `
            | ConvertFrom-Json
} catch {
    throw "无法连接 ${ApiBase}: $($_.Exception.Message)"
}
if ($login.code -ne 0) { throw "登录失败: $($login.message)" }
$token = $login.data.access_token

# ─── 5. PUT settings ────────────────────────────────────────────────
$payload = $brand | ConvertTo-Json -Depth 10
$resp = (Invoke-WebRequest -Uri "$ApiBase/api/v1/admin/settings" -Method PUT `
            -Headers @{ Authorization = "Bearer $token" } `
            -Body $payload -ContentType 'application/json' `
            -UseBasicParsing -TimeoutSec 30).Content `
        | ConvertFrom-Json
if ($resp.code -ne 0) { throw "PUT /admin/settings 失败: $($resp.message)" }

Write-Host ""
Write-Host "[+] 已应用品牌化设置到 $ApiBase"
Write-Host "    site_name      = $($brand['site_name'])"
Write-Host "    site_subtitle  = $($brand['site_subtitle'])"
Write-Host "    agreements     = $agreeCount 篇"
Write-Host ""
Write-Host "如改了 site_logo URL，强制刷新一次浏览器（Ctrl+Shift+R）才能看到新 logo。"
