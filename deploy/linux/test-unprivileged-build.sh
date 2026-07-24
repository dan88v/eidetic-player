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
fixture_command="$workspace/lifecycle-fixture"
cat >"$fixture_command" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
phase="$1"
expected_home="$2"
literal_argument="$3"
[[ "$(id -u)" -ne 0 ]]
[[ "$HOME" == "$expected_home" ]]
[[ "$USER" == "$(id -un)" && "$LOGNAME" == "$USER" ]]
[[ "$PWD" == "${TMPDIR%/.tmp}" ]]
[[ "$npm_config_cache" == "$PWD/.npm-cache" ]]
[[ "$npm_config_userconfig" == /dev/null ]]
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
EOF
chmod 0755 "$fixture_command"
chown "$runtime_user:$EIDETIC_RUNTIME_GID" "$fixture_command"

injected_marker="$fixture_root/injected"
literal_payload="; touch $injected_marker"
eidetic_run_as_runtime_user "$runtime_user" "$workspace" /usr/bin \
  "$fixture_command" success "$EIDETIC_RUNTIME_HOME" "$literal_payload"
mapfile -t identity <"$workspace/identity.txt"
[[ "${identity[0]}" == "$EIDETIC_RUNTIME_UID" && "${identity[0]}" != 0 ]]
[[ "${identity[1]}" == "$EIDETIC_RUNTIME_HOME" ]]
[[ "${identity[2]}" == "$runtime_user" && "${identity[3]}" == "$runtime_user" ]]
[[ "${identity[4]}" == "$literal_payload" && ! -e "$injected_marker" ]]
[[ "$(stat -c %a "$workspace")" == 700 ]]
[[ "$(stat -c %u "$workspace")" == "$EIDETIC_RUNTIME_UID" ]]
[[ "$(stat -c %g "$workspace")" == "$EIDETIC_RUNTIME_GID" ]]
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
cp "$fixture_command" "$failure_workspace/lifecycle-fixture"
chown "$runtime_user:$EIDETIC_RUNTIME_GID" "$failure_workspace/lifecycle-fixture"
if eidetic_run_as_runtime_user "$runtime_user" "$failure_workspace" /usr/bin \
  "$failure_workspace/lifecycle-fixture" fail "$EIDETIC_RUNTIME_HOME" literal; then
  eidetic_die "failing lifecycle fixture unexpectedly succeeded"
fi
rm -rf -- "$failure_workspace"
[[ ! -e "$failure_workspace" ]]
[[ "$(readlink "$opt/current")" == "$current_before" ]]
[[ "$(readlink "$opt/previous")" == "$previous_before" ]]
[[ "$(find "$releases" -mindepth 1 -maxdepth 1 | wc -l)" -eq 2 ]]
[[ -z "$(find "$releases" -mindepth 1 -maxdepth 1 -name '.incoming-*' -print -quit)" ]]

success_workspace="$(eidetic_prepare_build_workspace "$runtime_user" "$workspace_parent")"
cp "$fixture_command" "$success_workspace/lifecycle-fixture"
chown "$runtime_user:$EIDETIC_RUNTIME_GID" "$success_workspace/lifecycle-fixture"
eidetic_run_as_runtime_user "$runtime_user" "$success_workspace" /usr/bin \
  "$success_workspace/lifecycle-fixture" success "$EIDETIC_RUNTIME_HOME" literal
release_stage="$(mktemp -d -p "$releases" '.incoming-success.XXXXXX')"
install -m 0644 "$success_workspace/artifact.txt" "$release_stage/artifact.txt"
grep -q "artifact from UID $EIDETIC_RUNTIME_UID" "$release_stage/artifact.txt"
eidetic_activate_release "$release_stage" "$releases" success "$opt"
[[ "$(readlink "$opt/current")" == releases/success ]]
[[ "$(readlink "$opt/previous")" == "$current_before" ]]
[[ -r "$releases/success/artifact.txt" ]]
rm -rf -- "$success_workspace" "$workspace"
[[ ! -e "$success_workspace" && ! -e "$workspace" ]]

printf 'Root-to-runtime build, permission, injection and transaction fixtures passed.\n'
