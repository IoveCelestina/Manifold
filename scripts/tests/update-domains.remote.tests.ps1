$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '../update-domains.ps1'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

# Intercept SSH: these checks never contact a server.
function ssh {
    $global:DomainTestCapturedArguments = @($args)
    $global:LASTEXITCODE = 0
}

& $script -Domains 'NEW.example', 'old.example' -Deploy -SshHost 'deploy@example.test' -RemoteDir "/opt/manifold's folder"
$remoteCommand = $global:DomainTestCapturedArguments[-1]
$quote = [string][char]39
$escaped = $quote + '"' + $quote + '"' + $quote
Assert-True ($remoteCommand.StartsWith("cd -- '/opt/manifold" + $escaped + "s folder' && ")) 'Remote paths must be shell-quoted.'
Assert-True ($remoteCommand.Contains("'--domains' 'new.example,old.example' '--deploy'")) 'Domain list and deployment flag must reach Bash.'
Assert-True ($global:DomainTestCapturedArguments[-2] -eq 'deploy@example.test') 'SSH target must be a separate argument.'

& $script -Domains 'new.example' -DryRun
Assert-True ($global:DomainTestCapturedArguments[-1].Contains("'--dry-run'")) 'DryRun must propagate to the server.'
& $script -Domains 'new.example' -Pull
Assert-True ($global:DomainTestCapturedArguments[-1].Contains('git pull --ff-only && bash')) 'Pull must use fast-forward only.'
& $script -Add 'NEW.example', 'second.example' -Remove 'old.example' -Deploy
Assert-True ($global:DomainTestCapturedArguments[-1].Contains("'--add' 'new.example,second.example' '--remove' 'old.example' '--deploy'")) 'Incremental actions must reach the server without replacing its domain list.'
& $script -Remove 'old.example' -DryRun
Assert-True ($global:DomainTestCapturedArguments[-1].Contains("'--remove' 'old.example' '--dry-run'")) 'Removal must work without a replacement list.'
& $script -List
Assert-True ($global:DomainTestCapturedArguments[-1].EndsWith("'--list'")) 'List must not imply deployment.'

foreach ($case in @(
    @{ Domains = @('https://bad.example') },
    @{ Domains = @('good.example'); SshHost = '-oProxyCommand=bad' },
    @{ Domains = @('good.example'); RemoteDir = "/opt/repo`nmalicious" },
    @{ Domains = @('good.example'); DryRun = $true; Pull = $true },
    @{ Domains = @('good.example'); Add = @('new.example') },
    @{ List = $true; Remove = @('old.example') },
    @{ Add = @('https://bad.example') },
    @{}
)) {
    $rejected = $false
    try { & $script @case } catch { $rejected = $true }
    Assert-True $rejected 'Unsafe or conflicting arguments must be rejected before SSH.'
}
Remove-Item -LiteralPath Function:\ssh -ErrorAction SilentlyContinue
Remove-Variable DomainTestCapturedArguments -Scope Global
Write-Host 'update-domains remote tests passed'
