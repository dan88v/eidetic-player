[CmdletBinding()]
param(
  [string]$HostAddress = "10.0.0.112",
  [string]$RemoteUser = "daniele",
  [string]$RepositoryUrl = "https://github.com/dan88v/eidetic-player.git"
)

$ErrorActionPreference = "Stop"

if ($HostAddress -notmatch "^[A-Za-z0-9.-]+$") {
  throw "HostAddress contains unsupported characters."
}
if ($RemoteUser -notmatch "^[a-z_][a-z0-9_-]*$") {
  throw "RemoteUser is not a safe Linux account name."
}
if (
  $RepositoryUrl -notmatch
  "^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$"
) {
  throw "RepositoryUrl must be a GitHub HTTPS repository URL."
}

$target = "/home/$RemoteUser/eidetic-player"
$remoteTemplate = @'
set -eu
target=__TARGET__
repo=__REPOSITORY__

printf '\n=== 1/5 Stop Eidetic Player ===\n'
if systemctl --user stop eidetic-player.service; then
  printf 'Eidetic Player service stopped.\n'
else
  printf 'The user service was not active or reachable; the uninstaller will still perform its managed shutdown.\n'
fi

printf '\n=== 2/5 Guided uninstall ===\n'
if [ ! -x "$target/deploy/linux/uninstall-eidetic-player.sh" ]; then
  printf 'ERROR: uninstaller not found under %s\n' "$target" >&2
  exit 66
fi
cd "$target"
sudo ./deploy/linux/uninstall-eidetic-player.sh
if sudo test -e /opt/eidetic-player; then
  printf 'ERROR: /opt/eidetic-player still exists. Stopping before checkout removal.\n' >&2
  exit 65
fi

printf '\n=== 3/5 Remove previous checkout ===\n'
if [ -L "$target" ]; then
  printf 'ERROR: %s is a symbolic link; refusing removal.\n' "$target" >&2
  exit 64
fi
resolved=$(realpath -m -- "$target")
if [ "$resolved" != "__TARGET__" ]; then
  printf 'ERROR: unexpected resolved path %s; refusing removal.\n' "$resolved" >&2
  exit 64
fi
cd "__HOME__"
sudo rm -rf -- "__TARGET__"
if [ -e "__TARGET__" ]; then
  printf 'ERROR: the previous checkout was not removed.\n' >&2
  exit 65
fi
printf 'Previous checkout removed.\n'

printf '\n=== 4/5 Clone GitHub main ===\n'
git clone --branch main --single-branch "$repo" "__TARGET__"
cd "__TARGET__"
printf 'Cloned commit: '
git rev-parse --short HEAD

printf '\n=== 5/5 Guided install ===\n'
sudo ./deploy/linux/install-eidetic-player-desktop.sh
printf '\n=== Remote reinstall completed ===\n'
'@

$remoteCommand = $remoteTemplate.
  Replace("__TARGET__", $target).
  Replace("__HOME__", "/home/$RemoteUser").
  Replace("__REPOSITORY__", $RepositoryUrl)

Write-Host "Opening interactive SSH session to $RemoteUser@$HostAddress."
Write-Host "SSH uses the configured key; sudo and installer prompts remain visible." -ForegroundColor Cyan

& ssh.exe `
  -tt `
  -o "BatchMode=yes" `
  -o "PreferredAuthentications=publickey" `
  -o "PubkeyAuthentication=yes" `
  "$RemoteUser@$HostAddress" `
  $remoteCommand
$remoteExit = $LASTEXITCODE

if ($remoteExit -eq 255) {
  Write-Warning (
    "SSH disconnected with code 255. If you selected reboot in the final " +
    "installer prompt, this is expected; run remote-rpi-verify.ps1 after " +
    "the Raspberry Pi is reachable again."
  )
} elseif ($remoteExit -ne 0) {
  Write-Error "Remote reinstall stopped with SSH exit code $remoteExit."
} else {
  Write-Host "Remote reinstall completed without an SSH disconnect." -ForegroundColor Green
}

exit $remoteExit
