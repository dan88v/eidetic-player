#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR/../.."
runtime_user="${1:-$(id -un)}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

test_official_source_remotes() {
  local remote
  local -a official=(
    "https://github.com/dan88v/eidetic-player"
    "https://github.com/dan88v/eidetic-player.git"
    "git@github.com:dan88v/eidetic-player"
    "git@github.com:dan88v/eidetic-player.git"
  )
  local -a rejected=(
    ""
    "/tmp/eidetic-player"
    "file:///tmp/eidetic-player"
    "https://github.com/other/eidetic-player"
    "https://github.com/dan88v/eidetic-player-fork"
    "https://github.com/dan88v/eidetic-player.git.evil"
    "https://github.com.evil/dan88v/eidetic-player.git"
    "https://evil.example/dan88v/eidetic-player.git"
    "https://github.com/dan88v/eidetic-player/../other"
    "https://token@github.com/dan88v/eidetic-player.git"
    "git@evil.example:dan88v/eidetic-player.git"
    "https://github.com/dan88v/eidetic-player.git?ref=main"
    "https://github.com/dan88v/eidetic-player.git#main"
    "https://github.com/dan88v/eidetic-player.git/extra"
  )

  for remote in "${official[@]}"; do
    eidetic_is_official_source_remote "$remote" || {
      printf 'official source remote was rejected: %s\n' "$remote" >&2
      exit 1
    }
  done
  for remote in "${rejected[@]}"; do
    if eidetic_is_official_source_remote "$remote"; then
      printf 'unofficial source remote was accepted\n' >&2
      exit 1
    fi
  done
  printf 'Official source remote fixtures passed.\n'
}

assert_install_conf_value() {
  local root="$1" key="$2" expected="$3"
  grep -qx "$key=$expected" "$root/etc/eidetic-player/install.conf" || {
    printf 'missing expected install.conf value: %s=%s\n' "$key" "$expected" >&2
    exit 1
  }
}

install_root() {
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
  printf '%s\n' "$root"
}

write_legacy_conf() {
  local root="$1" mode="$2" fullscreen="$3" hide_pointer="$4" disable_blanking="$5" autostart="$6" splash="$7" autologin="$8"
  local borderless="${9:-x-missing}"
  cat >"$root/etc/eidetic-player/install.conf" <<EOF
EIDETIC_INSTALLATION_MODE=$mode
EIDETIC_FULLSCREEN=$fullscreen
EIDETIC_HIDE_POINTER=$hide_pointer
EIDETIC_DISABLE_BLANKING=$disable_blanking
EIDETIC_AUTOSTART=$autostart
EIDETIC_SPLASH=$splash
EIDETIC_AUTOLOGIN=$autologin
EIDETIC_RUNTIME_USER=$runtime_user
EIDETIC_GIT_REF=main
EIDETIC_RPI_ONSCREEN_KEYBOARD=keep
PATH=/opt/eidetic-player/node/current/bin:/usr/local/bin:/usr/bin:/bin
EOF
  if [[ "$borderless" != x-missing ]]; then
    printf 'EIDETIC_BORDERLESS=%s\n' "$borderless" >>"$root/etc/eidetic-player/install.conf"
  fi
}

assert_standard_conf() {
  local root="$1"
  assert_install_conf_value "$root" EIDETIC_INSTALLATION_MODE standard
  assert_install_conf_value "$root" EIDETIC_FULLSCREEN 0
  assert_install_conf_value "$root" EIDETIC_BORDERLESS 0
  assert_install_conf_value "$root" EIDETIC_HIDE_POINTER 0
  assert_install_conf_value "$root" EIDETIC_DISABLE_BLANKING 0
  assert_install_conf_value "$root" EIDETIC_AUTOSTART 0
  assert_install_conf_value "$root" EIDETIC_SPLASH 0
  assert_install_conf_value "$root" EIDETIC_AUTOLOGIN 0
}

assert_appliance_conf() {
  local root="$1" fullscreen="$2" borderless="$3" blanking="$4" pointer="$5" splash="$6" autologin="$7" autostart="$8"
  assert_install_conf_value "$root" EIDETIC_INSTALLATION_MODE appliance
  assert_install_conf_value "$root" EIDETIC_FULLSCREEN "$fullscreen"
  assert_install_conf_value "$root" EIDETIC_BORDERLESS "$borderless"
  assert_install_conf_value "$root" EIDETIC_DISABLE_BLANKING "$blanking"
  assert_install_conf_value "$root" EIDETIC_HIDE_POINTER "$pointer"
  assert_install_conf_value "$root" EIDETIC_SPLASH "$splash"
  assert_install_conf_value "$root" EIDETIC_AUTOLOGIN "$autologin"
  assert_install_conf_value "$root" EIDETIC_AUTOSTART "$autostart"
}

fixture() {
  local name="$1" root
  root="$(install_root "$@")"

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode standard --unattended --rpi-onscreen-keyboard keep
  assert_standard_conf "$root"
  ! grep -q '^EIDETIC_FULL_VERIFY=' "$root/etc/eidetic-player/install.conf"

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode standard --unattended --rpi-onscreen-keyboard keep \
    --full-verify --dry-run

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart yes --fullscreen yes --borderless yes \
    --disable-blanking no --hide-pointer no --splash no --autologin no --rpi-onscreen-keyboard keep
  assert_appliance_conf "$root" 1 1 0 0 0 0 1

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart no --fullscreen no --borderless yes \
    --disable-blanking no --hide-pointer no --splash no --autologin no --rpi-onscreen-keyboard keep
  assert_appliance_conf "$root" 0 1 0 0 0 0 0

  # validate legacy migration paths
  write_legacy_conf "$root" standard 1 0 1 1 0 0
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_standard_conf "$root"

  write_legacy_conf "$root" appliance 1 1 1 1 1 0 0
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_install_conf_value "$root" EIDETIC_BORDERLESS 0

  write_legacy_conf "$root" appliance 1 1 1 1 1 0
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_install_conf_value "$root" EIDETIC_BORDERLESS 1

  # installation lifecycle
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --dry-run
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --full-verify --dry-run
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --full-verify --no-restart
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --rollback
  "$SCRIPT_DIR/doctor-installation.sh" --root "$root" --json
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root"
}

test_official_source_remotes
[[ "${EIDETIC_SOURCE_REMOTE_FIXTURE_ONLY:-0}" != 1 ]] || exit 0
"$SCRIPT_DIR/test-platform-detection.sh"
if [[ "${EUID}" -eq 0 ]]; then
  "$SCRIPT_DIR/test-unprivileged-build.sh" "$runtime_user"
  "$SCRIPT_DIR/test-rpi-keyboard.sh" "$runtime_user"
else
  printf 'Unprivileged-build and keyboard fixtures require root; run this staging suite with sudo for those gates.\n'
fi

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
