[CmdletBinding()]
param(
  [string]$HostAddress = "10.0.0.112",
  [string]$RemoteUser = "daniele",
  [ValidateRange(30, 600)]
  [int]$ReadinessTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

if ($HostAddress -notmatch "^[A-Za-z0-9.-]+$") {
  throw "HostAddress contains unsupported characters."
}
if ($RemoteUser -notmatch "^[a-z_][a-z0-9_-]*$") {
  throw "RemoteUser is not a safe Linux account name."
}

$target = "/home/$RemoteUser/eidetic-player"
$attempts = [Math]::Ceiling($ReadinessTimeoutSeconds / 5)
$remoteTemplate = @'
printf '\n=== Eidetic Player post-reboot verification ===\n'

printf '\nInstalled checkout commit:\n'
git -C "__TARGET__" log -1 --oneline

printf '\nUser service:\n'
systemctl --user --no-pager --full status eidetic-player.service || true

printf '\nWaiting for stable backend readiness:\n'
ready=0
attempt=1
while [ "$attempt" -le __ATTEMPTS__ ]; do
  payload=$(curl --silent --show-error --max-time 2 \
    http://127.0.0.1:4310/api/readiness 2>&1 || true)
  printf '[%s/__ATTEMPTS__] %s\n' "$attempt" "$payload"
  if printf '%s' "$payload" | grep -q '"status":"ready"'; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 5
done

printf '\nEidetic/MPV processes:\n'
pgrep -a -u "$(id -u)" -f 'eidetic-player|neutralino|mpv' || true

printf '\nInstallation doctor:\n'
sudo "__TARGET__/deploy/linux/doctor-installation.sh"

if [ "$ready" != 1 ]; then
  printf '\nERROR: backend readiness did not become stable within __TIMEOUT__ seconds.\n' >&2
  exit 69
fi

printf '\n=== Remote verification completed successfully ===\n'
'@

$remoteCommand = $remoteTemplate.
  Replace("__TARGET__", $target).
  Replace("__ATTEMPTS__", [string]$attempts).
  Replace("__TIMEOUT__", [string]$ReadinessTimeoutSeconds)

Write-Host "Opening interactive verification on $RemoteUser@$HostAddress."
Write-Host (
  "The readiness probe will wait up to $ReadinessTimeoutSeconds seconds " +
  "instead of treating an early degraded state as final."
) -ForegroundColor Cyan

& ssh.exe `
  -tt `
  -o "BatchMode=yes" `
  -o "PreferredAuthentications=publickey" `
  -o "PubkeyAuthentication=yes" `
  "$RemoteUser@$HostAddress" `
  $remoteCommand
$remoteExit = $LASTEXITCODE

if ($remoteExit -ne 0) {
  Write-Error "Remote verification stopped with SSH exit code $remoteExit."
}

Write-Host "Remote verification passed." -ForegroundColor Green
