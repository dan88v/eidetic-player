$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$transcript = Join-Path $workspace "rpi-official-update-$stamp.log"
$updater = Join-Path $workspace "scripts\remote-rpi-update.ps1"

Start-Transcript -LiteralPath $transcript -Force | Out-Null
try {
  & $updater
} finally {
  Stop-Transcript | Out-Null
}
