#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
runtime_user="$(id -un)"
runtime_home="$(getent passwd "$runtime_user" | cut -d: -f6)"
work="$(mktemp -d)"
if [[ "${EIDETIC_KEEP_LITE_FIXTURE:-0}" == 1 ]]; then
  trap 'printf "Lite fixture retained at %s\n" "$work" >&2' EXIT
else
  trap 'rm -rf -- "$work"' EXIT
fi

fail() {
  printf 'Lite staging fixture failed: %s\n' "$*" >&2
  exit 1
}

write_package() {
  printf 'Package: %s\nStatus: install ok installed\n\n' "$2" >>"$1/var/lib/dpkg/status"
}

make_root() {
  local root="$1" session="$2" target="$3"
  install -d -m 0755 \
    "$root/etc/eidetic-player" "$root/etc/systemd/system" \
    "$root/proc/device-tree" "$root/var/lib/dpkg" "$root/usr/bin" \
    "$root$runtime_home"
  cat >"$root/etc/os-release" <<'EOF'
ID=raspbian
PRETTY_NAME="Raspberry Pi OS Lite"
VERSION_ID="13"
VERSION_CODENAME=trixie
EOF
  printf 'arm64\n' >"$root/etc/eidetic-player/architecture"
  printf '%s\n' "$session" >"$root/etc/eidetic-player/desktop-session"
  printf '%s\n' "$target" >"$root/etc/eidetic-player/default-target"
  printf 'NM_AUTHORITATIVE\n' >"$root/etc/eidetic-player/network-state"
  printf 'Raspberry Pi reference fixture\n' >"$root/etc/rpi-issue"
  printf 'raspberrypi,3-model-b\0brcm,bcm2837\0' >"$root/proc/device-tree/compatible"
  printf 'UID_MIN 1000\n' >"$root/etc/login.defs"
  : >"$root/var/lib/dpkg/status"
  printf '#!/bin/sh\nexit 0\n' >"$root/usr/bin/pkexec"
  chmod 0755 "$root/usr/bin/pkexec"
}

run_lite_stage() {
  local root="$1"
  "$SCRIPT_DIR/install-eidetic-player.sh" \
    --root "$root" --user "$runtime_user" --unattended
}

fresh="$work/fresh-lite"
make_root "$fresh" headless multi-user.target
run_lite_stage "$fresh"
grep -Fxq 'EIDETIC_INSTALL_PROFILE=raspios-lite' \
  "$fresh/etc/eidetic-player/install.conf" || fail "Lite profile was not persisted"
[[ -r "$fresh/etc/systemd/user/eidetic-graphical-session.target" ]] ||
  fail "graphical target missing"
[[ -r "$fresh/etc/systemd/user/eidetic-labwc.service" ]] ||
  fail "labwc service missing"
[[ -r "$fresh/etc/systemd/system/getty@tty1.service.d/90-eidetic-player-autologin.conf" ]] ||
  fail "tty1 autologin missing"
[[ -r "$fresh/etc/eidetic-player/labwc/rc.xml" ]] || fail "labwc config missing"
[[ -r "$fresh/var/lib/eidetic-player/machine-ownership-v1.json" ]] ||
  fail "machine ownership manifest missing"
[[ "$(stat -c %a "$fresh/var/lib/eidetic-player/machine-ownership-v1.json")" == 600 ]] ||
  fail "machine ownership manifest mode changed"
python3 "$SCRIPT_DIR/lib/machine_ownership.py" validate --root "$fresh"
python3 - "$fresh/var/lib/eidetic-player/machine-ownership-v1.json" <<'PY'
import json
import sys

document = json.load(open(sys.argv[1], encoding="utf-8"))
assert document["packages"]["manifestVersion"] == 1
assert document["packages"]["versions"]
assert document["packages"]["versions"]["labwc"] in {"fixture", "planned"}
PY
! grep -Eqi 'password|wifi.psk|private.?key|smb.?credential|"token"' \
  "$fresh/var/lib/eidetic-player/machine-ownership-v1.json" ||
  fail "credential-shaped state leaked into machine manifest"

airplay_before="$(sha256sum "$fresh$runtime_home/.config/eidetic-player/airplay.json")"
run_lite_stage "$fresh"
airplay_after="$(sha256sum "$fresh$runtime_home/.config/eidetic-player/airplay.json")"
[[ "$airplay_before" == "$airplay_after" ]] || fail "reinstall regenerated AirPlay state"
[[ "$(find "$fresh/etc/systemd/system/getty@tty1.service.d" -type f | wc -l)" == 1 ]] ||
  fail "reinstall duplicated getty integration"
integration_before="$(sha256sum \
  "$fresh/etc/systemd/system/getty@tty1.service.d/90-eidetic-player-autologin.conf" \
  "$fresh/etc/systemd/user/eidetic-graphical-session.target" \
  "$fresh/etc/eidetic-player/labwc/rc.xml")"
packages_before="$(sha256sum "$fresh/var/lib/dpkg/status")"
EIDETIC_EMBEDDED_PARENT=update EIDETIC_PROGRESS_FD=1 EIDETIC_PARENT_LOG_FD=1 \
  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$fresh" --user "$runtime_user" \
  --unattended --application-update >"$work/application-update.log" 2>&1
grep -Fq 'bootstrap skipped' "$work/application-update.log" ||
  fail "normal update did not skip the Lite machine bootstrap"
[[ "$integration_before" == "$(sha256sum \
  "$fresh/etc/systemd/system/getty@tty1.service.d/90-eidetic-player-autologin.conf" \
  "$fresh/etc/systemd/user/eidetic-graphical-session.target" \
  "$fresh/etc/eidetic-player/labwc/rc.xml")" ]] ||
  fail "normal update rewrote Lite machine integration"
[[ "$packages_before" == "$(sha256sum "$fresh/var/lib/dpkg/status")" ]] ||
  fail "normal update changed staged package state"

desktop="$work/desktop"
make_root "$desktop" RaspberryPi graphical.target
write_package "$desktop" raspberrypi-ui-mods
write_package "$desktop" rpd-theme
install -d -m 0755 "$desktop/usr/share/wayland-sessions"
printf '[Desktop Entry]\nName=Raspberry Pi Desktop\n' \
  >"$desktop/usr/share/wayland-sessions/rpd.desktop"
before_desktop="$(find "$desktop" -printf '%P %y %s\n' | sort | sha256sum)"
if "$SCRIPT_DIR/install-eidetic-player.sh" --root "$desktop" \
  --user "$runtime_user" --unattended >"$work/desktop-reject.log" 2>&1; then
  fail "Lite installer accepted Desktop"
fi
grep -Fq 'Raspberry Pi OS Desktop detected' "$work/desktop-reject.log" ||
  fail "Desktop rejection guidance missing"
after_desktop="$(find "$desktop" -printf '%P %y %s\n' | sort | sha256sum)"
[[ "$before_desktop" == "$after_desktop" ]] || fail "Desktop rejection mutated fixture"
"$SCRIPT_DIR/install-eidetic-player-desktop.sh" --root "$desktop" \
  --user "$runtime_user" --mode standard --unattended --dry-run >/dev/null

if "$SCRIPT_DIR/install-eidetic-player-desktop.sh" --root "$fresh" \
  --user "$runtime_user" --mode standard --unattended --dry-run \
  >"$work/lite-reject.log" 2>&1; then
  fail "Desktop installer accepted Lite"
fi
grep -Fq 'Raspberry Pi OS Lite detected' "$work/lite-reject.log" ||
  fail "Lite rejection guidance missing"

ambiguous="$work/ambiguous"
make_root "$ambiguous" headless multi-user.target
write_package "$ambiguous" raspberrypi-ui-mods
install -d -m 0755 "$ambiguous/usr/share/wayland-sessions"
printf '[Desktop Entry]\nName=Conflict\n' >"$ambiguous/usr/share/wayland-sessions/conflict.desktop"
if "$SCRIPT_DIR/install-eidetic-player.sh" --root "$ambiguous" \
  --user "$runtime_user" --unattended >"$work/ambiguous.log" 2>&1; then
  fail "ambiguous host was accepted"
fi
grep -Fq 'classification is AMBIGUOUS' "$work/ambiguous.log" ||
  fail "ambiguous host was not classified"

unknown="$work/unknown"
make_root "$unknown" none unknown
if "$SCRIPT_DIR/install-eidetic-player.sh" --root "$unknown" \
  --user "$runtime_user" --unattended >"$work/unknown.log" 2>&1; then
  fail "unknown host was accepted"
fi
grep -Fq 'classification is UNKNOWN' "$work/unknown.log" || fail "unknown host was not classified"

unsupported="$work/unsupported"
make_root "$unsupported" headless multi-user.target
sed -i 's/VERSION_ID="13"/VERSION_ID="12"/' "$unsupported/etc/os-release"
before_unsupported="$(find "$unsupported" -printf '%P %y %s\n' | sort | sha256sum)"
if "$SCRIPT_DIR/install-eidetic-player.sh" --root "$unsupported" \
  --user "$runtime_user" --unattended >"$work/unsupported.log" 2>&1; then
  fail "unsupported host was accepted"
fi
grep -Fq 'Unsupported host' "$work/unsupported.log" ||
  fail "unsupported host was not classified"
[[ "$before_unsupported" == "$(find "$unsupported" -printf '%P %y %s\n' | sort | sha256sum)" ]] ||
  fail "unsupported rejection mutated fixture"

network_conflict="$work/network-conflict"
make_root "$network_conflict" headless multi-user.target
printf 'CONFLICT\n' >"$network_conflict/etc/eidetic-player/network-state"
if "$SCRIPT_DIR/install-eidetic-player.sh" --root "$network_conflict" \
  --user "$runtime_user" --unattended >"$work/network-conflict.log" 2>&1; then
  fail "network conflict was accepted"
fi
grep -Fq 'Network preflight is CONFLICT' "$work/network-conflict.log" ||
  fail "network conflict did not fail closed"

interrupted="$work/interrupted"
make_root "$interrupted" headless multi-user.target
install -d -m 0755 \
  "$interrupted/etc/systemd/system/getty@tty1.service.d" \
  "$interrupted/etc/eidetic-player/labwc"
printf 'pre-existing getty\n' \
  >"$interrupted/etc/systemd/system/getty@tty1.service.d/90-eidetic-player-autologin.conf"
printf 'pre-existing labwc\n' >"$interrupted/etc/eidetic-player/labwc/rc.xml"
getty_before="$(sha256sum "$interrupted/etc/systemd/system/getty@tty1.service.d/90-eidetic-player-autologin.conf")"
labwc_before="$(sha256sum "$interrupted/etc/eidetic-player/labwc/rc.xml")"
if EIDETIC_LITE_FIXTURE_FAIL_AFTER_GRAPHICAL_FILES=1 \
  run_lite_stage "$interrupted" >"$work/interrupted.log" 2>&1; then
  fail "interrupted installation fixture unexpectedly completed"
fi
grep -Fq 'fixture interruption after graphical files' "$work/interrupted.log" ||
  fail "interrupted installation did not reach the transaction boundary"
[[ "$getty_before" == "$(sha256sum "$interrupted/etc/systemd/system/getty@tty1.service.d/90-eidetic-player-autologin.conf")" ]] ||
  fail "interrupted installation did not restore pre-existing getty"
[[ "$labwc_before" == "$(sha256sum "$interrupted/etc/eidetic-player/labwc/rc.xml")" ]] ||
  fail "interrupted installation did not restore pre-existing labwc config"
[[ ! -e "$interrupted/etc/profile.d/eidetic-player-session.sh" ]] ||
  fail "interrupted installation left a partial session handoff"
[[ ! -e "$interrupted/etc/systemd/user/eidetic-graphical-session.target" ]] ||
  fail "interrupted installation left a partial graphical target"

attack="$work/manifest-attack"
make_root "$attack" headless multi-user.target
install -d -m 0755 "$attack/var/lib/eidetic-player"
ln -s "$work/outside" "$attack/var/lib/eidetic-player/machine-ownership-v1.json"
if python3 "$SCRIPT_DIR/lib/machine_ownership.py" validate --root "$attack" \
  >/dev/null 2>&1; then
  fail "machine manifest symlink was accepted"
fi

"$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$fresh" --unattended
[[ ! -e "$fresh/etc/systemd/system/getty@tty1.service.d/90-eidetic-player-autologin.conf" ]] ||
  fail "uninstall did not restore getty"
[[ ! -e "$fresh/etc/profile.d/eidetic-player-session.sh" ]] ||
  fail "uninstall did not restore session handoff"
[[ ! -e "$fresh/etc/systemd/user/eidetic-graphical-session.target" ]] ||
  fail "uninstall did not remove graphical target"
[[ ! -e "$fresh/etc/systemd/user/default.target.wants/eidetic-graphical-session.target" ]] ||
  fail "uninstall did not remove graphical target enablement"
[[ -d "$fresh$runtime_home/.config/eidetic-player" ]] ||
  fail "normal uninstall removed application data"

printf 'Raspberry Pi OS Lite staging, rejection, idempotence and restore fixtures passed.\n'
