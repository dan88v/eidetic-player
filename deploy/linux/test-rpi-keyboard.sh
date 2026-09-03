#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
runtime_user="${1:-$(id -un)}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

make_root() {
  local name="$1" distro="$2" state="$3" support="${4:-yes}"
  local root="$work/$name"
  install -d "$root/etc/eidetic-player" "$root/usr/bin" "$root/var/lib"
  if [[ "$distro" == raspios ]]; then
    printf 'ID=debian\nVERSION_ID=13\nVERSION_CODENAME=trixie\n' \
      >"$root/etc/os-release"
    printf 'arm64\n' >"$root/etc/eidetic-player/architecture"
    printf 'RaspberryPi\n' >"$root/etc/eidetic-player/desktop-session"
    install -d "$root/proc/device-tree" "$root/var/lib/dpkg"
    printf 'brcm,bcm2837\0raspberrypi,3-model-b\0' \
      >"$root/proc/device-tree/compatible"
    printf 'Package: raspberrypi-ui-mods\nStatus: install ok installed\n' \
      >"$root/var/lib/dpkg/status"
  else
    printf 'ID=ubuntu\nVERSION_ID=26.04\nVERSION_CODENAME=resolute\n' \
      >"$root/etc/os-release"
    printf 'amd64\n' >"$root/etc/eidetic-player/architecture"
    printf 'GNOME\n' >"$root/etc/eidetic-player/desktop-session"
  fi
  printf '%s\n' "$state" >"$root/var/lib/fixture-keyboard-state"
  if [[ "$support" == yes ]]; then
    cat >"$root/usr/bin/raspi-config" <<'EOF'
#!/usr/bin/env bash
get_squeekboard() { :; }
do_squeekboard() { :; }
set -euo pipefail
fixture_root="${0%/usr/bin/raspi-config}"
state_file="$fixture_root/var/lib/fixture-keyboard-state"
log_file="$fixture_root/var/lib/fixture-keyboard-log"
[[ "${1:-}" == nonint ]] || exit 2
case "${2:-}" in
  get_squeekboard)
    cat "$state_file"
    ;;
  do_squeekboard)
    case "${3:-}" in
      S1) next=0 ;;
      S2) next=1 ;;
      S3) next=2 ;;
      *) exit 3 ;;
    esac
    printf '%s\n' "${3:-}" >>"$log_file"
    printf '%s\n' "$next" >"$state_file"
    [[ ! -e "$fixture_root/var/lib/fixture-keyboard-fail" ||
      "${3:-}" != S3 ]] || exit 9
    ;;
  *)
    exit 4
    ;;
esac
EOF
  else
    printf '#!/bin/sh\nexit 1\n' >"$root/usr/bin/raspi-config"
  fi
  printf '#!/bin/sh\nexit 99\n' >"$root/usr/bin/pkexec"
  printf '#!/bin/sh\nexit 99\n' >"$root/usr/bin/systemctl"
  chmod 0755 \
    "$root/usr/bin/raspi-config" \
    "$root/usr/bin/pkexec" \
    "$root/usr/bin/systemctl"
  printf '%s\n' "$root"
}

install_keep() {
  "$SCRIPT_DIR/install-eidetic-player-desktop.sh" \
    --root "$1" --user "$runtime_user" --mode standard --unattended
}

install_disable() {
  "$SCRIPT_DIR/install-eidetic-player-desktop.sh" \
    --root "$1" --user "$runtime_user" --mode standard --unattended \
    --rpi-onscreen-keyboard disable
}

keep_root="$(make_root keep raspios 1)"
install_keep "$keep_root"
[[ "$(<"$keep_root/var/lib/fixture-keyboard-state")" == 1 ]]
[[ ! -e "$keep_root/var/lib/fixture-keyboard-log" ]]
[[ ! -e "$keep_root/var/lib/eidetic-player/rpi-onscreen-keyboard-v1" ]]

always_on_root="$(make_root always-on raspios 0)"
install_disable "$always_on_root"
[[ "$(<"$always_on_root/var/lib/fixture-keyboard-state")" == 2 ]]
[[ "$(<"$always_on_root/var/lib/eidetic-player/rpi-onscreen-keyboard-v1")" == always-on ]]
grep -qx S3 "$always_on_root/var/lib/fixture-keyboard-log"
backup_hash="$(sha256sum "$always_on_root/var/lib/eidetic-player/rpi-onscreen-keyboard-v1")"
install_disable "$always_on_root"
[[ "$(sha256sum "$always_on_root/var/lib/eidetic-player/rpi-onscreen-keyboard-v1")" == "$backup_hash" ]]
"$SCRIPT_DIR/restore-system-ui.sh" --root "$always_on_root"
"$SCRIPT_DIR/restore-system-ui.sh" --root "$always_on_root"
[[ "$(<"$always_on_root/var/lib/fixture-keyboard-state")" == 0 ]]

autodetect_root="$(make_root autodetect raspios 1)"
install_disable "$autodetect_root"
"$SCRIPT_DIR/restore-system-ui.sh" --root "$autodetect_root" --dry-run
[[ "$(<"$autodetect_root/var/lib/fixture-keyboard-state")" == 2 ]]
"$SCRIPT_DIR/restore-system-ui.sh" --root "$autodetect_root"
[[ "$(<"$autodetect_root/var/lib/fixture-keyboard-state")" == 1 ]]

always_off_root="$(make_root always-off raspios 2)"
install_disable "$always_off_root"
"$SCRIPT_DIR/restore-system-ui.sh" --root "$always_off_root"
[[ "$(<"$always_off_root/var/lib/fixture-keyboard-state")" == 2 ]]

dry_run_root="$(make_root dry-run raspios 0)"
"$SCRIPT_DIR/install-eidetic-player-desktop.sh" \
  --root "$dry_run_root" --user "$runtime_user" --mode standard --unattended \
  --rpi-onscreen-keyboard disable --dry-run
[[ "$(<"$dry_run_root/var/lib/fixture-keyboard-state")" == 0 ]]
[[ ! -e "$dry_run_root/var/lib/eidetic-player/rpi-onscreen-keyboard-v1" ]]

ubuntu_root="$(make_root ubuntu ubuntu 1)"
install_keep "$ubuntu_root"
if "$SCRIPT_DIR/install-eidetic-player-desktop.sh" \
  --root "$ubuntu_root" --user "$runtime_user" --mode standard --unattended \
  --rpi-onscreen-keyboard disable --dry-run; then
  printf 'Ubuntu accepted Raspberry Pi OS keyboard disable\n' >&2
  exit 1
fi
[[ "$(<"$ubuntu_root/var/lib/fixture-keyboard-state")" == 1 ]]

missing_root="$(make_root missing raspios 1 no)"
if "$SCRIPT_DIR/install-eidetic-player-desktop.sh" \
  --root "$missing_root" --user "$runtime_user" --mode standard --unattended \
  --rpi-onscreen-keyboard disable --dry-run; then
  printf 'unsupported raspi-config accepted keyboard disable\n' >&2
  exit 1
fi
[[ "$(<"$missing_root/var/lib/fixture-keyboard-state")" == 1 ]]

failure_root="$(make_root failure raspios 0)"
touch "$failure_root/var/lib/fixture-keyboard-fail"
if install_disable "$failure_root"; then
  printf 'failed keyboard application activated an installation\n' >&2
  exit 1
fi
[[ "$(<"$failure_root/var/lib/fixture-keyboard-state")" == 0 ]]
[[ ! -e "$failure_root/opt/eidetic-player/current" ]]
[[ ! -e "$failure_root/opt/eidetic-player/previous" ]]
[[ -z "$(find "$failure_root/opt/eidetic-player/releases" -mindepth 1 -maxdepth 1 -print -quit)" ]]

update_root="$(make_root update raspios 1)"
install_disable "$update_root"
saved_hash="$(sha256sum "$update_root/var/lib/eidetic-player/rpi-onscreen-keyboard-v1")"
"$SCRIPT_DIR/update-eidetic-player.sh" --root "$update_root" --no-restart
[[ "$(<"$update_root/var/lib/fixture-keyboard-state")" == 2 ]]
[[ "$(sha256sum "$update_root/var/lib/eidetic-player/rpi-onscreen-keyboard-v1")" == "$saved_hash" ]]
"$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$update_root" --unattended
"$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$update_root" --unattended
[[ "$(<"$update_root/var/lib/fixture-keyboard-state")" == 1 ]]

printf 'Raspberry Pi OS keyboard keep, disable, transaction and restore fixtures passed.\n'
