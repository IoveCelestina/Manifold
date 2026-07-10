$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\update-sub2api.remote.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$remoteScript = New-Sub2apiRemoteDeployScript -Version '0.1.151'
$normalized = ConvertTo-LfLineEnding "alpha`r`nbravo`rcharlie"

Assert-True ($normalized -eq "alpha`nbravo`ncharlie") 'Line ending normalization should convert CRLF and CR to LF.'
Assert-True ($remoteScript -notmatch "`r") 'Remote deploy script must use LF line endings before SSH.'
Assert-True ($remoteScript.StartsWith("set -euo pipefail`n")) 'Remote deploy script should start with a bash-safe LF after pipefail.'
Assert-True ($remoteScript.Contains('backups/pre-0.1.151-')) 'Remote deploy script should substitute the target version.'
Assert-True (-not $remoteScript.Contains('__VER__')) 'Remote deploy script should not leave the version placeholder.'

Write-Host 'update-sub2api remote script tests passed'
