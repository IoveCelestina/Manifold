#Requires -Version 7.0
<#
.SYNOPSIS
    Manifold CPA 上游账号健康巡检（对应 scripts/cpa-health-check.sh）
.DESCRIPTION
    sub2api 自带"软降级"——账号被上游 429 / 5xx 后写 rate_limited_at / overload_until /
    temp_unschedulable_until，调度器自动跳过；窗口结束后恢复。

    本脚本补 sub2api 没做的两件事：
      1. 持续故障：连续 N 次巡检都"不可调度"的账号 → 永久 status=inactive，人工介入才恢复
      2. Telegram 告警：状态变化即时通知（每次只发一次，不重复刷屏）
.PARAMETER ApiBase
    sub2api HTTP 入口。默认 http://127.0.0.1:8080
.PARAMETER Strikes
    连续 N 次异常后自动 inactive。默认 3。
.PARAMETER TelegramBotToken
    Telegram bot token；留空则不发 Telegram。
.PARAMETER TelegramChatId
    接收告警的 chat id。
.PARAMETER StateFile
    巡检状态文件路径。默认 deploy/data/cpa-health-state.json。
.EXAMPLE
    .\scripts\cpa-health-check.ps1
.EXAMPLE
    .\scripts\cpa-health-check.ps1 -Strikes 5 -TelegramBotToken $env:TG_TOKEN -TelegramChatId $env:TG_CHAT
#>
[CmdletBinding()]
param(
    [string]$ApiBase           = $(if ($env:API_BASE) { $env:API_BASE } else { "http://127.0.0.1:8080" }),
    [int]   $Strikes           = $(if ($env:STRIKES)  { [int]$env:STRIKES } else { 3 }),
    [string]$TelegramBotToken  = $env:TELEGRAM_BOT_TOKEN,
    [string]$TelegramChatId    = $env:TELEGRAM_CHAT_ID,
    [string]$StateFile         = ""
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$RootDir   = Split-Path $ScriptDir -Parent
$DeployDir = Join-Path $RootDir 'deploy'
$EnvPath   = Join-Path $DeployDir '.env'
if (-not $StateFile) {
    $StateFile = Join-Path $DeployDir 'data\cpa-health-state.json'
}

# ─── helpers ───────────────────────────────────────────────────────────

function Write-Log {
    param([string]$Msg)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "[$ts] $Msg"
}

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

function Send-Telegram {
    param([string]$Title, [string]$Body)
    if (-not $TelegramBotToken -or -not $TelegramChatId) {
        Write-Log "  (Telegram 未配，跳过通知: $Title)"
        return
    }
    $fence = [string][char]0x60 * 3   # 三个 backtick，markdown code-block 围栏
    $text  = "*$Title*`n$fence`n$Body`n$fence"
    try {
        Invoke-WebRequest -Uri "https://api.telegram.org/bot$TelegramBotToken/sendMessage" `
            -Method POST `
            -Body @{
                chat_id    = $TelegramChatId
                parse_mode = 'Markdown'
                text       = $text
            } `
            -TimeoutSec 10 -UseBasicParsing | Out-Null
    } catch {
        Write-Log "  (Telegram 发送失败: $($_.Exception.Message))"
    }
}

# 判定账号当前是否"不健康"：schedulable 或几个时间窗口字段
function Get-UnhealthyReason {
    param([pscustomobject]$Acc, [datetime]$Now)
    $reasons = @()
    if (($Acc.PSObject.Properties['schedulable']) -and (-not $Acc.schedulable)) {
        $reasons += 'schedulable=false'
    }
    foreach ($pair in @(
        @{ Field = 'temp_unschedulable_until'; Label = 'temp_unschedulable until' },
        @{ Field = 'overload_until';           Label = 'overload until' },
        @{ Field = 'rate_limit_reset_at';      Label = 'rate_limited until' }
    )) {
        $f = $pair.Field
        if ($Acc.PSObject.Properties[$f] -and $Acc.$f) {
            try {
                $t = [datetime]::Parse($Acc.$f).ToUniversalTime()
                if ($t -gt $Now) { $reasons += "$($pair.Label) $($Acc.$f)" }
            } catch { }
        }
    }
    return ($reasons -join ';')
}

# ─── 1. 登录 ─────────────────────────────────────────────────────────
$envMap = Read-DotEnv $EnvPath
$adminEmail    = $envMap['ADMIN_EMAIL']
$adminPassword = $envMap['ADMIN_PASSWORD']
if (-not $adminEmail -or -not $adminPassword) {
    throw ".env 里没有 ADMIN_EMAIL / ADMIN_PASSWORD"
}
# 允许从 .env 拿 Telegram（参数 / 环境变量都没传时）
if (-not $TelegramBotToken) { $TelegramBotToken = $envMap['TELEGRAM_BOT_TOKEN'] }
if (-not $TelegramChatId)   { $TelegramChatId   = $envMap['TELEGRAM_CHAT_ID']   }

try {
    $login = (Invoke-WebRequest -Uri "$ApiBase/api/v1/auth/login" -Method POST `
                -Body (@{ email = $adminEmail; password = $adminPassword } | ConvertTo-Json) `
                -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30).Content `
            | ConvertFrom-Json
} catch {
    throw "无法连接 ${ApiBase}: $($_.Exception.Message)"
}
if ($login.code -ne 0) { throw "登录 sub2api 失败: $($login.message)" }
$token = $login.data.access_token

# ─── 2. 拉账号清单 ───────────────────────────────────────────────────
$accountsJ = (Invoke-WebRequest -Uri "$ApiBase/api/v1/admin/accounts?page_size=500" `
                -Method GET -Headers @{ Authorization = "Bearer $token" } `
                -UseBasicParsing -TimeoutSec 30).Content `
            | ConvertFrom-Json
if ($accountsJ.code -ne 0) { throw "拉账号失败: $($accountsJ.message)" }
$active = @($accountsJ.data.items | Where-Object { $_.status -eq 'active' })
Write-Log "巡检 $($active.Count) 个 active 账号"

# ─── 3. 读上次状态 ───────────────────────────────────────────────────
$null = New-Item -ItemType Directory -Path (Split-Path $StateFile -Parent) -Force
if (Test-Path $StateFile) {
    $prevState = Get-Content $StateFile -Raw | ConvertFrom-Json -AsHashtable
    if (-not $prevState) { $prevState = @{} }
} else {
    $prevState = @{}
}
$newState = @{}
$now = [datetime]::UtcNow

# ─── 4. 逐账号判定并处置 ─────────────────────────────────────────────
$alertsNew       = @()
$alertsRecovered = @()
$alertsInactive  = @()

foreach ($acc in $active) {
    $id     = $acc.id
    $name   = $acc.name
    $reason = Get-UnhealthyReason -Acc $acc -Now $now

    $prev = if ($prevState.ContainsKey($name)) { $prevState[$name] } else { $null }
    $prevStrikes = if ($prev) { [int]$prev.strikes } else { 0 }
    $prevReason  = if ($prev) { [string]$prev.reason } else { '' }

    if ($reason) {
        # 当前异常
        $newStrikes = $prevStrikes + 1
        Write-Log "  [!] $name 异常 ($newStrikes/$Strikes): $reason"

        if ($prevStrikes -eq 0) {
            $alertsNew += "$name | $reason"
        }

        if ($newStrikes -ge $Strikes) {
            $alreadyInactive = $prev -and $prev.force_inactive
            if (-not $alreadyInactive) {
                Write-Log "  [x] $name 连续 $newStrikes 次异常，置 inactive"
                try {
                    Invoke-WebRequest -Uri "$ApiBase/api/v1/admin/accounts/$id" `
                        -Method PUT `
                        -Headers @{ Authorization = "Bearer $token" } `
                        -Body (@{ status = 'inactive' } | ConvertTo-Json) `
                        -ContentType 'application/json' `
                        -UseBasicParsing -TimeoutSec 30 | Out-Null
                } catch {
                    Write-Log "  (置 inactive 失败 id=${id}: $($_.Exception.Message))"
                }
                $alertsInactive += "$name (连续 $newStrikes 次): $reason"
                $newState[$name] = @{
                    strikes        = $newStrikes
                    reason         = $reason
                    force_inactive = $true
                    last_check     = $now.ToString('o')
                }
                continue
            }
        }
        $newState[$name] = @{
            strikes        = $newStrikes
            reason         = $reason
            force_inactive = $false
            last_check     = $now.ToString('o')
        }
    } else {
        # 当前健康
        if ($prevStrikes -gt 0) {
            Write-Log "  [+] $name 恢复健康 (此前连续 $prevStrikes 次异常: $prevReason)"
            $alertsRecovered += "$name (前次: $prevReason)"
        }
        # 不写入 newState —— 健康账号从状态文件淘汰，保持文件小
    }
}

# ─── 5. 写状态文件 ───────────────────────────────────────────────────
$newState | ConvertTo-Json -Depth 5 | Set-Content -Path $StateFile -Encoding utf8 -NoNewline

# ─── 6. 告警 ─────────────────────────────────────────────────────────
if ($alertsInactive.Count -gt 0) {
    Send-Telegram '🛑 Manifold: 账号已置 inactive' ($alertsInactive -join "`n")
}
if ($alertsNew.Count -gt 0) {
    Send-Telegram '⚠ Manifold: 账号异常' ($alertsNew -join "`n")
}
if ($alertsRecovered.Count -gt 0) {
    Send-Telegram '✅ Manifold: 账号恢复' ($alertsRecovered -join "`n")
}

if (($alertsNew.Count + $alertsRecovered.Count + $alertsInactive.Count) -eq 0) {
    Write-Log "全部健康 ($($active.Count) 账号)"
}
