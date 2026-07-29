[CmdletBinding()]
param(
  [string]$HostAddress = "10.0.0.112",
  [string]$RemoteUser = "daniele",
  [string]$RepositoryUrl = "https://github.com/dan88v/eidetic-player.git",
  [string]$Branch = "main"
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
if ($Branch -notmatch "^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$") {
  throw "Branch is not a safe Git ref."
}

$target = "/home/$RemoteUser/eidetic-player"
$remoteTemplate = @'
set -eu
case "$0" in
  /tmp/tmp.*) rm -f -- "$0" ;;
esac
target=__TARGET__
repo=__REPOSITORY__
branch=__BRANCH__
manifest=/opt/eidetic-player/current/build-info.json

read_build_id() {
  if [ -r "$manifest" ]; then
    sed -n 's/.*"shortCommitSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      "$manifest" | head -n 1
  else
    printf 'legacy/unknown'
  fi
}

printf '\n=== 1/6 Validate remote checkout ===\n'
if [ ! -d "$target/.git" ] || [ -L "$target" ]; then
  printf 'ERROR: expected a non-symbolic Git checkout at %s\n' "$target" >&2
  exit 66
fi
resolved=$(realpath -m -- "$target")
if [ "$resolved" != "__TARGET__" ]; then
  printf 'ERROR: unexpected resolved checkout path %s\n' "$resolved" >&2
  exit 64
fi
cd "$target"
origin=$(git remote get-url origin)
case "$origin" in
  "$repo" | "${repo%.git}") ;;
  *)
    printf 'ERROR: unexpected origin %s\n' "$origin" >&2
    exit 65
    ;;
esac
current_branch=$(git symbolic-ref --quiet --short HEAD || true)
if [ "$current_branch" != "$branch" ]; then
  printf 'ERROR: checkout is on %s, expected %s\n' \
    "${current_branch:-detached HEAD}" "$branch" >&2
  exit 65
fi
if ! git diff --quiet || ! git diff --cached --quiet ||
  git ls-files --others --exclude-standard | grep -q .; then
  printf 'ERROR: remote checkout has local changes; refusing to update it.\n' >&2
  printf '\nModified worktree files:\n'
  git diff --name-status
  printf '\nStaged files:\n'
  git diff --cached --name-status
  printf '\nUntracked files:\n'
  git ls-files --others --exclude-standard
  exit 65
fi
checkout_before=$(git rev-parse HEAD)
installed_before=$(read_build_id)
printf 'Checkout before:  %s\n' "$checkout_before"
printf 'Installed before: %s\n' "$installed_before"

printf '\n=== 2/6 Fast-forward checkout from GitHub ===\n'
git fetch --prune origin \
  "refs/heads/$branch:refs/remotes/origin/$branch"
git merge --ff-only "refs/remotes/origin/$branch"
checkout_target=$(git rev-parse HEAD)
printf 'Checkout target:  %s\n' "$checkout_target"
printf 'Target Build ID:  %.7s\n' "$checkout_target"

printf '\n=== 3/6 Guided Eidetic Player update ===\n'
printf 'All updater and sudo prompts remain attached to this terminal.\n'
sudo ./deploy/linux/update-eidetic-player.sh

printf '\n=== 4/6 Post-update state ===\n'
installed_after=$(read_build_id)
printf 'Installed before: %s\n' "$installed_before"
printf 'Installed after:  %s\n' "$installed_after"
printf 'Target Build ID:  %.7s\n' "$checkout_target"
printf 'User service:     '
systemctl --user is-active eidetic-player.service
printf 'Backend readiness:\n'
curl --silent --show-error --max-time 5 \
  http://127.0.0.1:4310/api/readiness
printf '\n'
if [ "$installed_after" != "$(printf '%.7s' "$checkout_target")" ]; then
  printf 'ERROR: installed Build ID does not match the target checkout.\n' >&2
  exit 69
fi

printf '\n=== 5/6 Read-only installation doctor ===\n'
sudo ./deploy/linux/doctor-installation.sh

printf '\n=== 6/6 Same-commit no-op proof ===\n'
sudo ./deploy/linux/update-eidetic-player.sh \
  --ref "$branch" --unattended

printf '\n=== Remote guided update completed successfully ===\n'
printf 'Build ID: %s\n' "$installed_after"
printf 'No reboot was requested or performed.\n'
'@

$remoteScript = $remoteTemplate.
  Replace("__TARGET__", $target).
  Replace("__REPOSITORY__", $RepositoryUrl).
  Replace("__BRANCH__", $Branch)
$encodedScript = [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes($remoteScript)
)
$remoteCommand = (
  'remote_script=$(mktemp) || exit 70; ' +
  'printf %s ' +
  $encodedScript +
  ' | base64 -d > $remote_script || exit 70; ' +
  'bash $remote_script; remote_status=$?; ' +
  'rm -f -- $remote_script; exit $remote_status'
)

Write-Host "Opening interactive update on $RemoteUser@$HostAddress."
Write-Host "SSH uses the configured key; sudo and updater prompts remain visible." -ForegroundColor Cyan
Write-Host "The script never stores or pipes a password and never reboots the device." -ForegroundColor Cyan

& ssh.exe `
  -tt `
  -o "BatchMode=yes" `
  -o "PreferredAuthentications=publickey" `
  -o "PubkeyAuthentication=yes" `
  "$RemoteUser@$HostAddress" `
  $remoteCommand
$remoteExit = $LASTEXITCODE

if ($remoteExit -ne 0) {
  Write-Error "Remote update stopped with SSH exit code $remoteExit."
}

Write-Host "Remote update and same-commit verification passed." -ForegroundColor Green
