#Requires -Version 7.0
<#
.SYNOPSIS
    从 Windows 通过 SSH 调用服务器上的 update-domains.sh。
.EXAMPLE
    ./scripts/update-domains.ps1 -List
.EXAMPLE
    ./scripts/update-domains.ps1 -Add new.example.com -Deploy
.EXAMPLE
    ./scripts/update-domains.ps1 -Remove old.example.com -Deploy
.EXAMPLE
    ./scripts/update-domains.ps1 -Add new.example.com -Remove old.example.com -DryRun
.NOTES
    服务器需先获取包含这两个脚本和域名配置模板的仓库版本。
    默认只预览；-Deploy 才写配置并部署。
    -Pull 在运行前 git pull --ff-only；-DryRun 只预览，不能搭配 -Pull。
#>
[CmdletBinding()]
param(
    [Alias('Domain')]
    [string[]]$Domains,
    [Alias('AddDomain')]
    [string[]]$Add,
    [Alias('RemoveDomain')]
    [string[]]$Remove,
    [switch]$List,
    [switch]$Deploy,
    [switch]$DryRun,
    [switch]$Pull,
    [string]$SshHost = '',
    [string]$RemoteDir = ''
)

$ErrorActionPreference = 'Stop'
if (-not $SshHost) { $SshHost = if ($env:SSH_HOST) { $env:SSH_HOST } else { 'manifold' } }
if (-not $RemoteDir) { $RemoteDir = if ($env:DEPLOY_DIR) { $env:DEPLOY_DIR } else { '/opt/manifold' } }
if ($SshHost -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]*$') { throw 'SshHost 必须是 SSH 别名或 user@hostname' }
if (-not $RemoteDir.StartsWith('/') -or $RemoteDir -match "[`r`n`0]") { throw 'RemoteDir 必须是单行 Linux 绝对路径' }
if ($Pull -and $DryRun) { throw '-DryRun 不允许搭配会修改仓库的 -Pull' }
if ($Domains -and ($Add -or $Remove)) { throw '-Domains 不能与 -Add/-Remove 同用' }
if ($List -and ($Domains -or $Add -or $Remove -or $Deploy)) { throw '-List 不能与修改或部署参数同用' }
if (-not ($Domains -or $Add -or $Remove -or $List)) { throw '请指定 -Add、-Remove、-List 或 -Domains' }

# Validate locally, then let the server enforce label lengths and route collisions.
function ConvertTo-DomainList([string[]]$Values) {
    $normalized = foreach ($item in $Values) {
        foreach ($domain in $item.Split(',')) {
            $value = $domain.Trim().ToLowerInvariant()
            if ($value -notmatch '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]*[a-z][a-z0-9-]*$') {
                throw "无效域名：$domain。不要填写协议、端口、路径或通配符。"
            }
            $value
        }
    }
    return $normalized -join ','
}

function ConvertTo-BashArgument([string]$Value) {
    $singleQuote = [string][char]39
    $escapedQuote = $singleQuote + '"' + $singleQuote + '"' + $singleQuote
    return $singleQuote + $Value.Replace($singleQuote, $escapedQuote) + $singleQuote
}

$remoteArgs = @()
if ($Domains) { $remoteArgs += @('--domains', (ConvertTo-DomainList $Domains)) }
if ($Add) { $remoteArgs += @('--add', (ConvertTo-DomainList $Add)) }
if ($Remove) { $remoteArgs += @('--remove', (ConvertTo-DomainList $Remove)) }
if ($List) { $remoteArgs += '--list' }
if ($Deploy) { $remoteArgs += '--deploy' }
if ($DryRun) { $remoteArgs += '--dry-run' }
$quotedArgs = ($remoteArgs | ForEach-Object { ConvertTo-BashArgument $_ }) -join ' '
$command = 'cd -- ' + (ConvertTo-BashArgument $RemoteDir) + ' && '
if ($Pull) { $command += 'git pull --ff-only && ' }
$command += 'bash scripts/update-domains.sh ' + $quotedArgs

Write-Host "[domains] 连接 $SshHost；操作：$($remoteArgs -join ' ')"
& ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost $command
if ($LASTEXITCODE -ne 0) { throw "服务器域名更新失败（退出码 $LASTEXITCODE），请查看上方输出与备份路径" }
