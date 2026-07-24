#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR/../.."
runtime_user="${1:-$(id -un)}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

fixture() {
  local name="$1" os="$2" arch="$3" desktop="$4"
  local compatible="${5:-none}" marker="${6:-none}"
  local root="$work/$name"
  install -d "$root/etc/eidetic-player"
  printf '%s\n' "$os" >"$root/etc/os-release"
  printf '%s\n' "$arch" >"$root/etc/eidetic-player/architecture"
  printf '%s\n' "$desktop" >"$root/etc/eidetic-player/desktop-session"
  if [[ "$compatible" != none ]]; then
    install -d "$root/proc/device-tree"
    printf 'brcm,bcm2837\0%s\0' "$compatible" >"$root/proc/device-tree/compatible"
  fi
  if [[ "$marker" == package ]]; then
    install -d "$root/var/lib/dpkg"
    printf 'Package: raspberrypi-ui-mods\nStatus: install ok installed\nArchitecture: arm64\n' \
      >"$root/var/lib/dpkg/status"
  fi
  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart yes --fullscreen yes \
    --disable-blanking yes --hide-pointer yes --splash no --autologin no
  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart yes --fullscreen yes \
    --disable-blanking yes --hide-pointer yes --splash no --autologin no
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --dry-run
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --rollback
  "$SCRIPT_DIR/doctor-installation.sh" --root "$root" --json
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root"
}

"$SCRIPT_DIR/test-platform-detection.sh"

fixture raspios \
  $'PRETTY_NAME="Raspberry Pi OS (64-bit)"\nNAME="Raspberry Pi OS"\nID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie' \
  arm64 RaspberryPi raspberrypi,3-model-b package
fixture ubuntu-amd64 \
  $'PRETTY_NAME="Ubuntu 26.04 LTS"\nNAME=Ubuntu\nID=ubuntu\nVERSION_ID="26.04"\nVERSION_CODENAME=resolute' \
  amd64 GNOME
fixture ubuntu-arm64 \
  $'PRETTY_NAME="Ubuntu 26.04 LTS"\nNAME=Ubuntu\nID=ubuntu\nVERSION_ID="26.04"\nVERSION_CODENAME=resolute' \
  arm64 GNOME

unsupported="$work/unsupported"
install -d "$unsupported/etc/eidetic-player"
printf 'ID=debian\nVERSION_ID=12\nVERSION_CODENAME=bookworm\n' >"$unsupported/etc/os-release"
printf 'amd64\n' >"$unsupported/etc/eidetic-player/architecture"
printf 'GNOME\n' >"$unsupported/etc/eidetic-player/desktop-session"
if "$SCRIPT_DIR/install-eidetic-player.sh" --root "$unsupported" --user "$runtime_user" --dry-run; then
  printf 'unsupported OS was accepted\n' >&2
  exit 1
fi
command -v shellcheck >/dev/null && shellcheck "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/lib/*.sh "$SCRIPT_DIR"/runtime/*
if command -v systemd-analyze >/dev/null; then
  sed 's#ExecStart=/opt/eidetic-player/current/bin/eidetic-player-launch#ExecStart=/bin/true#' \
    "$SCRIPT_DIR/templates/eidetic-player.service" >"$work/eidetic-player.service"
  chmod 0644 "$work/eidetic-player.service"
  systemd-analyze verify "$work/eidetic-player.service"
fi
printf 'Linux staging fixtures passed; temporary root removed on exit.\n'
