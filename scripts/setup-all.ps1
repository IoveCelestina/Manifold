#Requires -Version 7.0
<#
.SYNOPSIS
    Manifold 一键完成 sub2api 后台全部配置：登录 → 加余额 → 建 group → 注册 CPA 账号 → 发 API key。
.DESCRIPTION
    幂等。每次重跑只补齐缺失项，不会重复创建。
    自动从 deploy/cpa-*/auths/*.json 探测每个 CPA 实例已经挂载的 OAuth 平台：
        claude-*.json      → anthropic
        codex-*.json       → openai
        gemini-*.json      → gemini
        antigravity-*.json → antigravity
    没挂某个平台的 CPA，对应的上游账号会被设为 inactive（不删除，方便以后补登录）。
    每发出的明文 key 会保存到 deploy/data/api-keys.json（已被 .gitignore 屏蔽），
    下次跑本脚本会复用。-Force 会用时间戳后缀建新 key（旧 key 留着但不再被本脚本管理）。
.PARAMETER ApiBase
    sub2api HTTP 入口。默认 http://127.0.0.1:8080
.PARAMETER InitialBalance
    admin 余额阈值。当前余额低于此值时补到此值。默认 100。
.PARAMETER Force
    用时间戳后缀新建 API key（旧明文丢了的情况下用这个救场）。
.EXAMPLE
    .\scripts\setup-all.ps1
.EXAMPLE
    .\scripts\setup-all.ps1 -InitialBalance 500 -Force
#>
[CmdletBinding()]
param(
    [string]$ApiBase = "http://127.0.0.1:8080",
    [int]$InitialBalance = 100,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$DeployDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'deploy'
$EnvPath   = Join-Path $DeployDir '.env'
$KeyStore  = Join-Path $DeployDir 'data\api-keys.json'

# OAuth token 文件名前缀 → sub2api 的 platform 枚举
$PrefixToPlatform = [ordered]@{
    'claude-'      = 'anthropic'
    'codex-'       = 'openai'
    'gemini-'      = 'gemini'
    'antigravity-' = 'antigravity'
}

# 每个平台给用户的"怎么用"提示
$PlatformGuide = @{
    'anthropic'   = @{ Endpoint = '/v1/messages'                                ; SampleModel = 'claude-sonnet-4-5-20250929'; ExtraHeader = 'anthropic-version: 2023-06-01' }
    'openai'      = @{ Endpoint = '/v1/chat/completions'                        ; SampleModel = 'gpt-5.4-mini'              ; ExtraHeader = '' }
    'gemini'      = @{ Endpoint = '/v1beta/models/<model>:generateContent'      ; SampleModel = 'gemini-2.5-pro'            ; ExtraHeader = '' }
    'antigravity' = @{ Endpoint = '/antigravity/v1/messages'                    ; SampleModel = '<查 CPA /v1/models>'       ; ExtraHeader = '' }
}

# ─── helpers ───────────────────────────────────────────────────────────

function Read-DotEnv {
    param([string]$Path)
    if (-not (Test-Path $Path)) { throw "找不到 $Path —— 先跑 scripts/init.ps1" }
    $map = @{}
    foreach ($line in Get-Content $Path) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
            $map[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $map
}

function Load-KeyStore {
    if (Test-Path $KeyStore) {
        return Get-Content $KeyStore -Raw | ConvertFrom-Json -AsHashtable
    }
    return @{}
}

function Save-KeyStore {
    param([hashtable]$Store)
    $dir = Split-Path $KeyStore -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $Store | ConvertTo-Json -Depth 5 | Set-Content -Path $KeyStore -Encoding utf8 -NoNewline
}

$script:AuthHeader = $null

function Api {
    param([string]$Method, [string]$Path, $Body = $null, [switch]$Raw)
    $params = @{
        Uri             = "$ApiBase$Path"
        Method          = $Method
        Headers         = $script:AuthHeader
        UseBasicParsing = $true
        TimeoutSec      = 30
    }
    if ($Body -ne $null) {
        $params.Body        = ($Body | ConvertTo-Json -Depth 8)
        $params.ContentType = 'application/json'
    }
    try {
        $r = Invoke-WebRequest @params
        if ($Raw) { return $r }
        $j = $r.Content | ConvertFrom-Json
        if ($null -ne $j.code -and $j.code -ne 0) {
            throw "$Method $Path -> code=$($j.code) msg=$($j.message)"
        }
        return $j
    } catch {
        $msg = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        throw "API $Method $Path failed: $msg"
    }
}

function Detect-Cpas {
    $out = [ordered]@{}
    foreach ($dir in Get-ChildItem -Path $DeployDir -Directory -Filter "cpa-*" | Sort-Object Name) {
        $cfgPath = Join-Path $dir.FullName "config.yaml"
        if (-not (Test-Path $cfgPath)) {
            Write-Host "  [!] $($dir.Name) 缺 config.yaml，跳过；先跑 scripts/init.ps1 -Force" -ForegroundColor Yellow
            continue
        }
        $m = Select-String -Path $cfgPath -Pattern '-\s*"([0-9a-f]{32,})"' -List | Select-Object -First 1
        if (-not $m) {
            Write-Host "  [!] $($dir.Name)/config.yaml 找不到 api-keys，跳过" -ForegroundColor Yellow
            continue
        }
        $apiKey = $m.Matches.Groups[1].Value

        $authsDir = Join-Path $dir.FullName "auths"
        $platforms = [ordered]@{}
        if (Test-Path $authsDir) {
            foreach ($auth in Get-ChildItem -Path $authsDir -File -Filter '*.json' -ErrorAction SilentlyContinue) {
                foreach ($prefix in $PrefixToPlatform.Keys) {
                    if ($auth.Name.StartsWith($prefix)) {
                        $platforms[$PrefixToPlatform[$prefix]] = $true
                        break
                    }
                }
            }
        }
        $out[$dir.Name] = @{
            ApiKey    = $apiKey
            BaseUrl   = "http://$($dir.Name):8317"
            Platforms = @($platforms.Keys)
        }
    }
    return $out
}

function Ensure-Group {
    param([string]$Platform)
    $all = Api GET "/api/v1/admin/groups?page_size=100"
    # 优先按 name 匹配，否则按 platform
    $found = $all.data.items | Where-Object { $_.name -eq $Platform } | Select-Object -First 1
    if (-not $found) {
        $found = $all.data.items | Where-Object { $_.platform -eq $Platform } | Select-Object -First 1
    }
    if ($found) {
        return $found.id
    }
    $r = Api POST "/api/v1/admin/groups" @{
        name              = $Platform
        platform          = $Platform
        rate_multiplier   = 1.0
        subscription_type = "standard"
        description       = "Manifold auto-created group for $Platform"
    }
    Write-Host "  [+] 新 group: name=$Platform id=$($r.data.id)"
    return $r.data.id
}

function Ensure-Account {
    param(
        [string]$Name,
        [string]$Platform,
        [string]$BaseUrl,
        [string]$ApiKey,
        [int]$GroupId,
        [string]$DesiredStatus
    )
    $all = Api GET "/api/v1/admin/accounts?page_size=500"
    $found = $all.data.items | Where-Object { $_.name -eq $Name } | Select-Object -First 1

    if ($found) {
        $needsUpdate = $false
        $patch = @{}
        if ($found.status -ne $DesiredStatus) { $patch.status = $DesiredStatus; $needsUpdate = $true }
        if (-not ($found.group_ids -contains $GroupId)) { $patch.group_ids = @($GroupId); $needsUpdate = $true }
        if ($needsUpdate) {
            Api PUT "/api/v1/admin/accounts/$($found.id)" $patch | Out-Null
            Write-Host "  [~] $Name 更新: $(($patch.Keys | ForEach-Object { "$_=$($patch[$_])" }) -join ', ')"
        } else {
            Write-Host "  [=] $Name 已就位"
        }
        return $found.id
    }

    $r = Api POST "/api/v1/admin/accounts" @{
        name        = $Name
        platform    = $Platform
        type        = "apikey"
        credentials = @{ api_key = $ApiKey; base_url = $BaseUrl }
        group_ids   = @($GroupId)
        concurrency = 5
        priority    = 100
    }
    Write-Host "  [+] $Name 新建 id=$($r.data.id)"
    return $r.data.id
}

function Ensure-Key {
    param([string]$Name, [int]$GroupId, [hashtable]$Store)

    # 1. 拉用户当前持有 keys，验证 Store 里记的 id 是否还在
    $live = Api GET "/api/v1/keys?page_size=500"
    $liveIds = @{}
    foreach ($k in $live.data.items) { $liveIds[$k.id] = $k }

    $stored = $Store[$Name]
    if (-not $Force -and $stored -and $liveIds.ContainsKey($stored.id)) {
        $liveKey = $liveIds[$stored.id]
        if ($liveKey.group_id -ne $GroupId) {
            Api PUT "/api/v1/admin/api-keys/$($stored.id)" @{ group_id = $GroupId } | Out-Null
            Write-Host "  [~] $Name 修正 group_id -> $GroupId"
        }
        Write-Host "  [=] $Name 已存在 id=$($stored.id)，复用 KeyStore 明文"
        return @{ Id = $stored.id; Key = $stored.key }
    }

    # 2. 新发
    $effectiveName = if ($Force -and $stored) { "$Name-$(Get-Date -Format 'yyyyMMddHHmmss')" } else { $Name }
    $r = Api POST "/api/v1/keys" @{ name = $effectiveName }
    $id = $r.data.id
    $plain = $r.data.key
    Api PUT "/api/v1/admin/api-keys/$id" @{ group_id = $GroupId } | Out-Null
    Write-Host "  [+] $effectiveName 新发 id=$id"
    return @{ Id = $id; Key = $plain; Name = $effectiveName }
}

# ─── main ──────────────────────────────────────────────────────────────

Write-Host "Manifold 全量配置脚本" -ForegroundColor Cyan
Write-Host "  ApiBase = $ApiBase"
Write-Host "  Force   = $Force"
Write-Host ""

# [1] login
$envMap = Read-DotEnv $EnvPath
$loginJ = (Invoke-WebRequest -Uri "$ApiBase/api/v1/auth/login" -Method POST `
            -Body (@{ email = $envMap['ADMIN_EMAIL']; password = $envMap['ADMIN_PASSWORD'] } | ConvertTo-Json) `
            -ContentType "application/json" -UseBasicParsing).Content | ConvertFrom-Json
if ($loginJ.code -ne 0) { throw "登录 sub2api 失败: $($loginJ.message)" }
$script:AuthHeader = @{ Authorization = "Bearer $($loginJ.data.access_token)" }
$adminId      = $loginJ.data.user.id
$adminBalance = [double]$loginJ.data.user.balance
Write-Host "[1] 登录 admin (id=$adminId, balance=$adminBalance)"

# [2] balance
if ($adminBalance -lt $InitialBalance) {
    $delta = $InitialBalance - $adminBalance
    Api POST "/api/v1/admin/users/$adminId/balance" @{
        balance = $delta; operation = "add"; notes = "setup-all.ps1 topup"
    } | Out-Null
    Write-Host "[2] 余额 +$delta -> $InitialBalance"
} else {
    Write-Host "[2] 余额 $adminBalance >= $InitialBalance，跳过"
}

# [3] detect CPAs
Write-Host "[3] 探测 CPA 实例 + OAuth 平台..."
$cpas = Detect-Cpas
if ($cpas.Count -eq 0) { Write-Host "  [!] 没探到 CPA 实例" -ForegroundColor Red; exit 1 }
$activePlatforms = [ordered]@{}
foreach ($name in $cpas.Keys) {
    $info = $cpas[$name]
    $platStr = if ($info.Platforms.Count -gt 0) { $info.Platforms -join '+' } else { '(空载)' }
    Write-Host ("    {0,-6} -> {1}" -f $name, $platStr)
    foreach ($p in $info.Platforms) { $activePlatforms[$p] = $true }
}
if ($activePlatforms.Count -eq 0) {
    Write-Host "[!] 所有 CPA 都没挂 OAuth，没法发可用 key。先在 CPA 容器里跑 -claude-login / -codex-login。" -ForegroundColor Red
    exit 2
}

# [4] groups
Write-Host ""
Write-Host "[4] 确保每个平台有 group..."
$platformGroups = @{}
foreach ($p in $activePlatforms.Keys) {
    $platformGroups[$p] = Ensure-Group -Platform $p
}

# [5] accounts
Write-Host ""
Write-Host "[5] 注册/更新上游账号..."
foreach ($cpaName in $cpas.Keys) {
    $info = $cpas[$cpaName]
    foreach ($p in $activePlatforms.Keys) {
        $accName = "$cpaName-$p"
        if ($info.Platforms -contains $p) {
            Ensure-Account -Name $accName -Platform $p `
                -BaseUrl $info.BaseUrl -ApiKey $info.ApiKey `
                -GroupId $platformGroups[$p] -DesiredStatus "active" | Out-Null
        } else {
            # 空载组合：现有同名账号置 inactive
            $all = Api GET "/api/v1/admin/accounts?page_size=500"
            $found = $all.data.items | Where-Object { $_.name -eq $accName } | Select-Object -First 1
            if ($found -and $found.status -ne 'inactive') {
                Api PUT "/api/v1/admin/accounts/$($found.id)" @{ status = "inactive" } | Out-Null
                Write-Host "  [~] $accName 置 inactive (该 CPA 未挂 $p)"
            }
        }
    }
}

# [6] API keys
Write-Host ""
Write-Host "[6] 发/复用 user API key..."
$store = Load-KeyStore
$summary = @()
foreach ($p in $activePlatforms.Keys) {
    $kname = "manifold-$p"
    $k = Ensure-Key -Name $kname -GroupId $platformGroups[$p] -Store $store
    if ($k.Key) {
        $store[$kname] = @{
            id        = $k.Id
            key       = $k.Key
            group_id  = $platformGroups[$p]
            platform  = $p
            actual_name = if ($k.Name) { $k.Name } else { $kname }
        }
    }
    $summary += [pscustomobject]@{
        Platform  = $p
        KeyName   = if ($k.Name) { $k.Name } else { $kname }
        KeyId     = $k.Id
        Plaintext = $k.Key
        GroupId   = $platformGroups[$p]
    }
}
Save-KeyStore $store

# [7] summary
Write-Host ""
Write-Host "================ 配置完成 ================" -ForegroundColor Green
Write-Host ""
foreach ($row in $summary) {
    $guide = $PlatformGuide[$row.Platform]
    Write-Host "[$($row.Platform.ToUpper())]" -ForegroundColor Cyan
    Write-Host "  Manifold key  : $($row.Plaintext)"
    Write-Host "  Endpoint      : $ApiBase$($guide.Endpoint)"
    Write-Host "  样例 model    : $($guide.SampleModel)"
    if ($guide.ExtraHeader) { Write-Host "  额外请求头    : $($guide.ExtraHeader)" }
    Write-Host ""
}

Write-Host "明文 key 存档    : $KeyStore" -ForegroundColor DarkGray
Write-Host "下次重跑会复用，-Force 会用时间戳后缀新发。" -ForegroundColor DarkGray
