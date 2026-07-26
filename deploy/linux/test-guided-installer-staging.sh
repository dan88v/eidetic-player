#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
runtime_user="${1:-$(id -un)}"
runtime_home="$(getent passwd "$runtime_user" | cut -d: -f6)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
if [[ "${EUID}" -eq 0 && "$runtime_user" != root ]]; then
  chown "root:$(id -g "$runtime_user")" "$work"
  chmod 0710 "$work"
fi

fail() {
  printf 'guided staging fixture failed: %s\n' "$*" >&2
  exit 1
}

command -v script >/dev/null ||
  fail "the util-linux script command is required for pseudoterminal fixtures"

if ! command -v node >/dev/null && command -v node.exe >/dev/null; then
  bridge_bin="$work/windows-node-bridge"
  install -d "$bridge_bin"
  windows_node="$(command -v node.exe)"
  windows_temp=
  for candidate in /mnt/c/Users/*/AppData/Local/Temp; do
    windows_probe=
    if [[ -d "$candidate" ]] &&
      windows_probe="$(mktemp -d "$candidate/eidetic-probe.XXXXXX" 2>/dev/null)"; then
      rm -rf -- "$windows_probe"
      windows_temp="$candidate"
      break
    fi
  done
  [[ -n "$windows_temp" ]] ||
    fail "a writable Windows temporary directory is required for the Node bridge"
  cat >"$bridge_bin/node" <<EOF
#!/usr/bin/env bash
set -euo pipefail
arguments=()
mirrors=()
cleanup_bridge() {
  local mirror
  for mirror in "\${mirrors[@]}"; do rm -rf -- "\$mirror"; done
}
trap cleanup_bridge EXIT
for argument in "\$@"; do
  if [[ "\$argument" == /tmp/* && -d "\$argument" ]]; then
    mirror="\$(mktemp -d "$windows_temp/eidetic-node-bridge.XXXXXX")"
    mirrors+=("\$mirror")
    install -d "\$mirror/root"
    cp -a "\$argument/." "\$mirror/root/"
    arguments+=("\$(wslpath -w "\$mirror/root")")
  elif [[ "\$argument" == /* ]]; then
    arguments+=("\$(wslpath -w "\$argument")")
  else
    arguments+=("\$argument")
  fi
done
set +e
/init "$windows_node" "\${arguments[@]}"
status=\$?
set -e
exit "\$status"
EOF
  chmod 0755 "$bridge_bin/node"
  PATH="$bridge_bin:$PATH"
  export PATH
fi

make_root() {
  local name="$1" root
  root="$work/$name"
  install -d \
    "$root/etc/eidetic-player" \
    "$root/usr/bin"
  cat >"$root/etc/os-release" <<'EOF'
PRETTY_NAME="Ubuntu 26.04 LTS"
NAME=Ubuntu
ID=ubuntu
VERSION_ID="26.04"
VERSION_CODENAME=resolute
EOF
  printf 'amd64\n' >"$root/etc/eidetic-player/architecture"
  printf 'GNOME\n' >"$root/etc/eidetic-player/desktop-session"
  printf '#!/bin/sh\nexit 99\n' >"$root/usr/bin/pkexec"
  printf '#!/bin/sh\nexit 99\n' >"$root/usr/bin/systemctl"
  chmod 0755 "$root/usr/bin/pkexec" "$root/usr/bin/systemctl"
  printf '%s\n' "$root"
}

run_guided() {
  local input="$1" output="$2"
  shift 2
  local rendered='' argument separator=''
  for argument in "$@"; do
    printf -v rendered '%s%s%q' "$rendered" "$separator" "$argument"
    separator=' '
  done
  if ! printf '%b' "$input" |
    TERM=xterm-256color script -qefc "$rendered" /dev/null >"$output" 2>&1; then
    sed -n '1,160p' "$output" >&2
    find "$work" -type f -name 'install-*.log' -exec tail -n 40 {} \; >&2 ||
      true
    fail "pseudoterminal command failed"
  fi
}

standard_root="$(make_root standard)"
run_guided '\n\n' "$work/standard.out" \
  "$SCRIPT_DIR/install-eidetic-player.sh" \
  --root "$standard_root" --user "$runtime_user" --no-color
grep -q 'Choose installation mode' "$work/standard.out" ||
  fail "mode selection was not shown"
grep -q 'Installation summary' "$work/standard.out" ||
  fail "pre-install summary was not shown"
grep -q 'Overall \[####################\] 100%' "$work/standard.out" ||
  fail "real phase progress did not reach 100%"
grep -q 'Installation completed successfully' "$work/standard.out" ||
  fail "guided Standard install did not report success"
grep -qx 'EIDETIC_INSTALLATION_MODE=standard' \
  "$standard_root/etc/eidetic-player/install.conf" ||
  fail "guided Standard mode was not installed"
if LC_ALL=C grep -q $'\033\\[' "$work/standard.out"; then
  fail "--no-color emitted ANSI"
fi

run_guided '\n\n' "$work/uninstall-preserve.out" \
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" \
  --root "$standard_root" --no-color
grep -q 'Application data     Preserved' "$work/uninstall-preserve.out" ||
  fail "guided uninstall did not preserve data by default"
grep -q 'Uninstallation completed successfully' \
  "$work/uninstall-preserve.out" ||
  fail "guided uninstall did not report success"

appliance_root="$(make_root appliance)"
run_guided '2\ny\ny\ny\nn\nn\nn\nn\n\n' "$work/appliance.out" \
  "$SCRIPT_DIR/install-eidetic-player.sh" \
  --root "$appliance_root" --user "$runtime_user" --no-color
grep -qx 'EIDETIC_INSTALLATION_MODE=appliance' \
  "$appliance_root/etc/eidetic-player/install.conf" ||
  fail "guided Appliance mode was not installed"
grep -qx 'EIDETIC_AUTOSTART=1' \
  "$appliance_root/etc/eidetic-player/install.conf" ||
  fail "guided Appliance choice was not preserved"
grep -qx 'EIDETIC_DISABLE_BLANKING=0' \
  "$appliance_root/etc/eidetic-player/install.conf" ||
  fail "guided Appliance No choice was not preserved"

delete_root="$(make_root delete)"
"$SCRIPT_DIR/install-eidetic-player.sh" \
  --root "$delete_root" --user "$runtime_user" \
  --mode standard --unattended --rpi-onscreen-keyboard keep >/dev/null
data_root="$delete_root$runtime_home/.config/eidetic-player"
install -d "$data_root"
printf 'fixture\n' >"$data_root/settings.json"
run_guided 'y\nDELETE\n\n' "$work/delete.out" \
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" \
  --root "$delete_root" --no-color
[[ ! -e "$data_root" ]] ||
  fail "exact DELETE confirmation did not remove fixture data"
grep -q 'Application data     Removed' "$work/delete.out" ||
  fail "data-removal summary is missing"
! grep -Eq '^[0-9T:Z-]+ DELETE$' \
  "$delete_root/var/log/eidetic-player"/uninstall-*.log ||
  fail "DELETE response reached the log"

preserve_root="$(make_root preserve)"
"$SCRIPT_DIR/install-eidetic-player.sh" \
  --root "$preserve_root" --user "$runtime_user" \
  --mode standard --unattended --rpi-onscreen-keyboard keep >/dev/null
preserve_data="$preserve_root$runtime_home/.config/eidetic-player"
install -d "$preserve_data"
printf 'fixture\n' >"$preserve_data/settings.json"
run_guided 'y\nKEEP\n\n' "$work/preserve.out" \
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" \
  --root "$preserve_root" --no-color
[[ -f "$preserve_data/settings.json" ]] ||
  fail "failed DELETE confirmation removed fixture data"
grep -q 'DELETE was not confirmed exactly' "$work/preserve.out" ||
  fail "failed DELETE confirmation warning is missing"

external_root="$(make_root external-change)"
"$SCRIPT_DIR/install-eidetic-player.sh" \
  --root "$external_root" --user "$runtime_user" \
  --mode standard --unattended --rpi-onscreen-keyboard keep >/dev/null
printf 'externally managed replacement\n' \
  >"$external_root/usr/local/bin/eidetic-player"
"$SCRIPT_DIR/uninstall-eidetic-player.sh" \
  --root "$external_root" --unattended >"$work/external.out"
grep -qx 'externally managed replacement' \
  "$external_root/usr/local/bin/eidetic-player" ||
  fail "uninstall replaced an externally changed managed file"
grep -q 'preserving externally changed /usr/local/bin/eidetic-player' \
  "$external_root/var/log/eidetic-player"/uninstall-*.log ||
  fail "external managed-file preservation warning is missing"

cancel_root="$(make_root cancel)"
run_guided '9\n1\nn\n' "$work/cancel.out" \
  "$SCRIPT_DIR/install-eidetic-player.sh" \
  --root "$cancel_root" --user "$runtime_user" --no-color
grep -q 'Choose a number from 1 to 2' "$work/cancel.out" ||
  fail "invalid mode choice was not rejected"
grep -q 'cancelled before any change' "$work/cancel.out" ||
  fail "pre-install cancellation was not reported"
[[ ! -e "$cancel_root/opt/eidetic-player" ]] ||
  fail "cancelled guided install changed the fixture"

verbose_root="$(make_root verbose)"
run_guided '\n\n' "$work/verbose.out" \
  "$SCRIPT_DIR/install-eidetic-player.sh" \
  --root "$verbose_root" --user "$runtime_user" --verbose --no-color
grep -q '^\s*\$ apt-get update' "$work/verbose.out" ||
  fail "verbose sanitized command preview is missing"
grep -q 'staging fixture' "$verbose_root/opt/eidetic-player/current/backend/apps/backend/src/index.js" ||
  fail "verbose mode changed installation semantics"

if "$SCRIPT_DIR/install-eidetic-player.sh" >"$work/non-tty-install.out" 2>&1; then
  fail "no-argument non-TTY installer unexpectedly succeeded"
fi
grep -q 'Guided installation requires an interactive terminal' \
  "$work/non-tty-install.out" ||
  fail "non-TTY installer explanation is missing"
if "$SCRIPT_DIR/uninstall-eidetic-player.sh" >"$work/non-tty-uninstall.out" 2>&1; then
  fail "no-argument non-TTY uninstaller unexpectedly succeeded"
fi
grep -q 'Guided uninstall requires an interactive terminal' \
  "$work/non-tty-uninstall.out" ||
  fail "non-TTY uninstaller explanation is missing"

"$SCRIPT_DIR/install-eidetic-player.sh" --help >/dev/null
"$SCRIPT_DIR/install-eidetic-player.sh" --version |
  grep -Eq '^eidetic-player-linux-installer [0-9]+\.[0-9]+\.[0-9]+$' ||
  fail "installer version output is invalid"
"$SCRIPT_DIR/uninstall-eidetic-player.sh" --help >/dev/null
"$SCRIPT_DIR/uninstall-eidetic-player.sh" --version |
  grep -Eq '^eidetic-player-linux-uninstaller [0-9]+\.[0-9]+\.[0-9]+$' ||
  fail "uninstaller version output is invalid"

printf 'Guided installer/uninstaller staging fixtures passed.\n'
