#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

[[ "${EUID}" -eq 0 ]] ||
  eidetic_die "run the unprivileged-build fixture as root"
runtime_user="${1:-}"
if [[ -z "$runtime_user" ]]; then
  runtime_user="$(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 { print $1; exit }')"
fi
eidetic_validate_user "$runtime_user"
eidetic_load_runtime_identity "$runtime_user"

fixture_root="$(mktemp -d)"
chmod 0755 "$fixture_root"
cleanup_fixture() {
  rm -rf -- "$fixture_root"
}
trap cleanup_fixture EXIT

workspace_parent="$fixture_root/build parent Ü; literal"
install -d -m 0755 "$workspace_parent"
workspace="$(eidetic_prepare_build_workspace "$runtime_user" "$workspace_parent")"
runtime="$(eidetic_prepare_build_runtime "$runtime_user")"
concurrent_runtime="$(eidetic_prepare_build_runtime "$runtime_user")"
[[ "$runtime" != "$concurrent_runtime" ]]
eidetic_validate_mpv_runtime_budget "$runtime"

fixture_command="$workspace/lifecycle-fixture"
cat >"$fixture_command" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
phase="$1"
expected_home="$2"
literal_argument="$3"
expected_runtime="$4"
[[ "$(id -u)" -ne 0 ]]
[[ "$HOME" == "$expected_home" ]]
[[ "$USER" == "$(id -un)" && "$LOGNAME" == "$USER" ]]
[[ "$PWD" == "${TMPDIR%/.tmp}" ]]
[[ "$XDG_RUNTIME_DIR" == "$expected_runtime" ]]
[[ "$XDG_RUNTIME_DIR" != "$TMPDIR" ]]
[[ "$npm_config_cache" == "$PWD/.npm-cache" ]]
[[ "$npm_config_userconfig" == /dev/null ]]
[[ "$GIT_TERMINAL_PROMPT" == 0 ]]
[[ "$GIT_CONFIG_GLOBAL" == /dev/null && "$GIT_CONFIG_NOSYSTEM" == 1 ]]
[[ -z "${SUDO_USER:-}" && -z "${SUDO_UID:-}" && -z "${SUDO_GID:-}" ]]
printf '%s\n' "$(id -u)" "$HOME" "$USER" "$LOGNAME" "$literal_argument" >identity.txt
if [[ "$phase" == fail ]]; then
  exit 42
fi
mkdir locked
chmod 000 locked
if ls -A locked >/dev/null 2>&1; then
  printf 'mode-000 directory was readable by lifecycle UID\n' >&2
  exit 43
fi
printf 'artifact from UID %s\n' "$(id -u)" >artifact.txt
printf 'cache owned by runtime user\n' >"$npm_config_cache/probe"
python3 - <<'PY'
import os
import socket

runtime = os.environ["XDG_RUNTIME_DIR"]
app_runtime = os.path.join(runtime, "eidetic-player")
os.mkdir(app_runtime, 0o700)
paths = [
    os.path.join(app_runtime, f"mpv-{os.getpid()}-{index}.sock")
    for index in (1, 2)
]
sockets = []
try:
    for path in paths:
        endpoint = socket.socket(socket.AF_UNIX)
        endpoint.bind(path)
        sockets.append(endpoint)
    assert paths[0] != paths[1]
finally:
    for endpoint in sockets:
        endpoint.close()
    for path in paths:
        os.unlink(path)
assert not any(name.endswith(".sock") for name in os.listdir(app_runtime))
PY
EOF
chmod 0755 "$fixture_command"
chown "$runtime_user:$EIDETIC_RUNTIME_GID" "$fixture_command"

injected_marker="$fixture_root/injected"
literal_payload="; touch $injected_marker"
eidetic_run_as_runtime_user \
  "$runtime_user" "$workspace" "$runtime" /usr/bin \
  "$fixture_command" success "$EIDETIC_RUNTIME_HOME" "$literal_payload" "$runtime"
mapfile -t identity <"$workspace/identity.txt"
[[ "${identity[0]}" == "$EIDETIC_RUNTIME_UID" && "${identity[0]}" != 0 ]]
[[ "${identity[1]}" == "$EIDETIC_RUNTIME_HOME" ]]
[[ "${identity[2]}" == "$runtime_user" && "${identity[3]}" == "$runtime_user" ]]
[[ "${identity[4]}" == "$literal_payload" && ! -e "$injected_marker" ]]
[[ "$(stat -c %a "$workspace")" == 700 ]]
[[ "$(stat -c %u "$workspace")" == "$EIDETIC_RUNTIME_UID" ]]
[[ "$(stat -c %g "$workspace")" == "$EIDETIC_RUNTIME_GID" ]]
[[ "$(stat -c %a "$runtime")" == 700 ]]
[[ "$(stat -c %u "$runtime")" == "$EIDETIC_RUNTIME_UID" ]]
[[ "$(stat -c %g "$runtime")" == "$EIDETIC_RUNTIME_GID" ]]
[[ "$runtime" == /tmp/ep-r.* ]]
[[ "$(stat -c %u "$workspace/.npm-cache/probe")" == "$EIDETIC_RUNTIME_UID" ]]
grep -q "artifact from UID $EIDETIC_RUNTIME_UID" "$workspace/artifact.txt"

opt="$fixture_root/opt/eidetic-player"
releases="$opt/releases"
install -d -m 0755 "$releases/old-current" "$releases/old-previous"
ln -s releases/old-current "$opt/current"
ln -s releases/old-previous "$opt/previous"
current_before="$(readlink "$opt/current")"
previous_before="$(readlink "$opt/previous")"

failure_workspace="$(eidetic_prepare_build_workspace "$runtime_user" "$workspace_parent")"
failure_runtime="$(eidetic_prepare_build_runtime "$runtime_user")"
cp "$fixture_command" "$failure_workspace/lifecycle-fixture"
chown "$runtime_user:$EIDETIC_RUNTIME_GID" "$failure_workspace/lifecycle-fixture"
if eidetic_run_as_runtime_user \
  "$runtime_user" "$failure_workspace" "$failure_runtime" /usr/bin \
  "$failure_workspace/lifecycle-fixture" fail "$EIDETIC_RUNTIME_HOME" \
    literal "$failure_runtime"; then
  eidetic_die "failing lifecycle fixture unexpectedly succeeded"
fi
rm -rf -- "$failure_workspace" "$failure_runtime"
[[ ! -e "$failure_workspace" && ! -e "$failure_runtime" ]]
[[ "$(readlink "$opt/current")" == "$current_before" ]]
[[ "$(readlink "$opt/previous")" == "$previous_before" ]]
[[ "$(find "$releases" -mindepth 1 -maxdepth 1 | wc -l)" -eq 2 ]]
[[ -z "$(find "$releases" -mindepth 1 -maxdepth 1 -name '.incoming-*' -print -quit)" ]]

success_workspace="$(eidetic_prepare_build_workspace "$runtime_user" "$workspace_parent")"
success_runtime="$(eidetic_prepare_build_runtime "$runtime_user")"
cp "$fixture_command" "$success_workspace/lifecycle-fixture"
chown "$runtime_user:$EIDETIC_RUNTIME_GID" "$success_workspace/lifecycle-fixture"
eidetic_run_as_runtime_user \
  "$runtime_user" "$success_workspace" "$success_runtime" /usr/bin \
  "$success_workspace/lifecycle-fixture" success "$EIDETIC_RUNTIME_HOME" \
    literal "$success_runtime"
release_stage="$(mktemp -d -p "$releases" '.incoming-success.XXXXXX')"
install -m 0644 "$success_workspace/artifact.txt" "$release_stage/artifact.txt"
grep -q "artifact from UID $EIDETIC_RUNTIME_UID" "$release_stage/artifact.txt"
eidetic_activate_release "$release_stage" "$releases" success "$opt"
[[ "$(readlink "$opt/current")" == releases/success ]]
[[ "$(readlink "$opt/previous")" == "$current_before" ]]
[[ -r "$releases/success/artifact.txt" ]]

checkout="$fixture_root/checkout Ü space"
remote="$fixture_root/remote Ü; literal.git"
install -d -m 0755 \
  "$checkout/deploy/linux/lib" \
  "$checkout/deploy/linux/runtime" \
  "$checkout/deploy/linux/network"
printf '24.18.0\n' >"$checkout/.nvmrc"
printf '#!/bin/sh\nexit 0\n' >"$checkout/deploy/linux/install-eidetic-player.sh"
printf '# fixture\n' >"$checkout/deploy/linux/lib/common.sh"
printf '#!/bin/sh\nexit 0\n' >"$checkout/deploy/linux/runtime/eidetic-player-launch"
printf '#!/bin/sh\nexit 0\n' >"$checkout/deploy/linux/network/install-network-integration.sh"
chmod 0755 \
  "$checkout/deploy/linux/install-eidetic-player.sh" \
  "$checkout/deploy/linux/runtime/eidetic-player-launch" \
  "$checkout/deploy/linux/network/install-network-integration.sh"
git -C "$checkout" init --quiet --initial-branch=main
git -C "$checkout" config user.name fixture
git -C "$checkout" config user.email fixture@example.invalid
git -C "$checkout" add .
git -C "$checkout" commit --quiet -m fixture
git -C "$checkout" remote add origin https://github.com/dan88v/eidetic-player.git
printf 'original fetch head\n' >"$checkout/.git/FETCH_HEAD"
git clone --quiet --bare "$checkout" "$remote"
chown -R "root:$EIDETIC_RUNTIME_GID" "$checkout" "$remote"
find "$checkout" -type d -exec chmod 0550 {} +
find "$checkout" -type f -exec chmod 0440 {} +
chmod 0550 \
  "$checkout/deploy/linux/install-eidetic-player.sh" \
  "$checkout/deploy/linux/runtime/eidetic-player-launch" \
  "$checkout/deploy/linux/network/install-network-integration.sh"

checkout_snapshot() {
  {
    GIT_OPTIONAL_LOCKS=0 git -C "$checkout" status --porcelain
    git -C "$checkout" rev-parse HEAD
    git -C "$checkout" show-ref
    find "$checkout" -printf '%P\t%y\t%u\t%g\t%m\t%l\n' | LC_ALL=C sort
    find "$checkout" -type f -exec sha256sum {} + | LC_ALL=C sort
  } | sha256sum
}
snapshot_before="$(checkout_snapshot)"
eidetic_preflight_checkout "$runtime_user" "$checkout" yes
checkout_workspace="$(eidetic_prepare_build_workspace "$runtime_user" "$workspace_parent")"
checkout_runtime="$(eidetic_prepare_build_runtime "$runtime_user")"
eidetic_fetch_isolated_source \
  "$runtime_user" "$checkout_workspace" "$checkout_runtime" /usr/bin \
  main "$remote"
[[ "$(stat -c %u "$checkout_workspace/source")" == "$EIDETIC_RUNTIME_UID" ]]
[[ -d "$checkout_workspace/source/.git" ]]
[[ ! -e "$checkout/node_modules" && ! -e "$checkout/dist" ]]
[[ "$(checkout_snapshot)" == "$snapshot_before" ]]
[[ ! -e "$fixture_root/literal.git" ]]

fetch_failure_workspace="$(eidetic_prepare_build_workspace "$runtime_user" "$workspace_parent")"
fetch_failure_runtime="$(eidetic_prepare_build_runtime "$runtime_user")"
if eidetic_fetch_isolated_source \
  "$runtime_user" "$fetch_failure_workspace" "$fetch_failure_runtime" /usr/bin \
  missing-ref "$remote"; then
  eidetic_die "missing Git ref unexpectedly fetched"
fi
rm -rf -- "$fetch_failure_workspace" "$fetch_failure_runtime"
[[ ! -e "$fetch_failure_workspace" && ! -e "$fetch_failure_runtime" ]]

chmod 0400 "$checkout/deploy/linux/lib/common.sh"
if (eidetic_preflight_checkout "$runtime_user" "$checkout" yes) \
  >"$fixture_root/unreadable.log" 2>&1; then
  eidetic_die "unreadable checkout unexpectedly passed preflight"
fi
grep -q 'source checkout is not readable by the runtime user' \
  "$fixture_root/unreadable.log"
chmod 0440 "$checkout/deploy/linux/lib/common.sh"
chmod 0557 "$checkout"
if (eidetic_preflight_checkout "$runtime_user" "$checkout" yes) \
  >"$fixture_root/world-writable.log" 2>&1; then
  eidetic_die "world-writable checkout unexpectedly passed preflight"
fi
grep -q 'world-writable' "$fixture_root/world-writable.log"
chmod 0550 "$checkout"

rm -rf -- \
  "$checkout_workspace" "$checkout_runtime" \
  "$success_workspace" "$success_runtime" \
  "$workspace" "$runtime" "$concurrent_runtime"
[[ ! -e "$success_workspace" && ! -e "$success_runtime" ]]
[[ ! -e "$workspace" && ! -e "$runtime" && ! -e "$concurrent_runtime" ]]

printf 'Runtime, socket, read-only checkout, isolated Git and transaction fixtures passed.\n'
