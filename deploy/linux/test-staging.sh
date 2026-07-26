#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR/../.."
runtime_user="${1:-$(id -un)}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
fixture_rpi_cmdline="console=serial0,115200 console=tty1 root=PARTUUID=fixture rootfstype=ext4 fsck.repair=yes rootwait"
runtime_home="$(getent passwd "$runtime_user" | cut -d: -f6)"
[[ "$runtime_home" == /* ]] || {
  printf 'runtime user home is not absolute\n' >&2
  exit 1
}

fixture_fail() {
  printf 'staging fixture failed: %s\n' "$*" >&2
  exit 1
}

assert_token_count() {
  local file="$1" token="$2" expected="$3" count
  count="$(awk -v token="$token" '
    { for (field_number = 1; field_number <= NF; field_number += 1) if ($field_number == token) count += 1 }
    END { print count + 0 }
  ' "$file")"
  [[ "$count" == "$expected" ]] ||
    fixture_fail "$token count in ${file#"$work"/}: expected $expected, found $count"
}

assert_rpi_cmdline_augmented() {
  local root="$1" file line_count token
  local -a original_tokens=()
  file="$root/boot/firmware/cmdline.txt"
  [[ -f "$file" ]] || fixture_fail "Raspberry Pi cmdline is missing"
  line_count="$(awk 'END { print NR }' "$file")"
  [[ "$line_count" == 1 ]] ||
    fixture_fail "Raspberry Pi cmdline must contain exactly one line"
  read -r -a original_tokens <<<"$fixture_rpi_cmdline"
  for token in "${original_tokens[@]}"; do
    assert_token_count "$file" "$token" 1
  done
  assert_token_count "$file" quiet 1
  assert_token_count "$file" splash 1
}

assert_rpi_cmdline_original() {
  local root="$1" file
  file="$root/boot/firmware/cmdline.txt"
  [[ -f "$file" ]] || fixture_fail "restored Raspberry Pi cmdline is missing"
  cmp -s "$file" <(printf '%s\n' "$fixture_rpi_cmdline") ||
    fixture_fail "Raspberry Pi cmdline was not restored byte-for-byte"
}

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
    install -d "$root/boot/firmware"
    printf '%s\n' "$fixture_rpi_cmdline" >"$root/boot/firmware/cmdline.txt"
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

  if [[ "$name" == raspios ]]; then
    EIDETIC_BORDERLESS=1 \
      "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
      --mode standard --unattended --rpi-onscreen-keyboard keep
    assert_standard_conf "$root"
  fi

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode standard --unattended --rpi-onscreen-keyboard keep \
    --full-verify --dry-run

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart yes --fullscreen yes --borderless yes \
    --disable-blanking no --hide-pointer no --splash no --autologin no --rpi-onscreen-keyboard keep
  assert_appliance_conf "$root" 1 1 0 0 0 0 1

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart no --fullscreen no --borderless no \
    --disable-blanking no --hide-pointer no --splash no --autologin no --rpi-onscreen-keyboard keep
  assert_appliance_conf "$root" 0 0 0 0 0 0 0

  # validate legacy migration paths
  write_legacy_conf "$root" standard 1 0 1 1 0 0
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_standard_conf "$root"

  write_legacy_conf "$root" appliance 1 1 1 1 1 0 0
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_install_conf_value "$root" EIDETIC_BORDERLESS 0
  if [[ "$name" == raspios ]]; then
    assert_rpi_cmdline_augmented "$root"
  else
    [[ ! -e "$root/boot/firmware/cmdline.txt" ]] ||
      fixture_fail "Ubuntu staging unexpectedly created a Raspberry Pi cmdline"
  fi

  write_legacy_conf "$root" appliance 1 1 1 1 1 0
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_install_conf_value "$root" EIDETIC_BORDERLESS 1
  [[ "$name" != raspios ]] || assert_rpi_cmdline_augmented "$root"

  # installation lifecycle
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --dry-run
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --full-verify --dry-run
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --full-verify --no-restart
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --rollback
  "$SCRIPT_DIR/doctor-installation.sh" --root "$root" --json
  [[ "$name" != raspios ]] || assert_rpi_cmdline_augmented "$root"
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  [[ "$name" != raspios ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  [[ "$name" != raspios ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root"
  [[ "$name" != raspios ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root"
  [[ "$name" != raspios ]] || assert_rpi_cmdline_original "$root"
}

assert_all_yes_common() {
  local root="$1" current
  assert_appliance_conf "$root" 1 1 1 1 1 1 1
  [[ -f "$root$runtime_home/.config/autostart/eidetic-player.desktop" ]] ||
    fixture_fail "all-yes autostart desktop is missing"
  [[ -f "$root$runtime_home/.config/autostart/eidetic-player-display-policy.desktop" ]] ||
    fixture_fail "all-yes display-policy autostart is missing"
  [[ -f "$root/usr/share/plymouth/themes/eidetic-player/eidetic-player.plymouth" ]] ||
    fixture_fail "all-yes Plymouth theme is missing"
  [[ -f "$root/usr/share/plymouth/themes/eidetic-player/eidetic-player.script" ]] ||
    fixture_fail "all-yes Plymouth script is missing"
  [[ -f "$root/usr/share/plymouth/themes/eidetic-player/line.ppm" ]] ||
    fixture_fail "all-yes Plymouth line image is missing"
  [[ -L "$root/opt/eidetic-player/current" ]] ||
    fixture_fail "all-yes release was not activated"
  current="$(readlink "$root/opt/eidetic-player/current")"
  [[ -d "$root/opt/eidetic-player/$current" ]] ||
    fixture_fail "all-yes current release target is missing"
}

all_yes_fixture() {
  local name="$1" root
  root="$(install_root "$@")"

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart yes --fullscreen yes --borderless yes \
    --disable-blanking yes --hide-pointer yes --splash yes --autologin yes \
    --rpi-onscreen-keyboard keep
  assert_all_yes_common "$root"

  if [[ "$name" == raspios-all-yes ]]; then
    [[ -f "$root/etc/lightdm/lightdm.conf.d/90-eidetic-player.conf" ]] ||
      fixture_fail "Raspberry Pi all-yes LightDM configuration is missing"
    grep -qx "autologin-user=$runtime_user" \
      "$root/etc/lightdm/lightdm.conf.d/90-eidetic-player.conf" ||
      fixture_fail "Raspberry Pi all-yes LightDM user is incorrect"
    assert_rpi_cmdline_augmented "$root"
  else
    [[ -f "$root/etc/gdm3/custom.conf" ]] ||
      fixture_fail "Ubuntu all-yes GDM configuration is missing"
    grep -qx 'AutomaticLoginEnable=true' "$root/etc/gdm3/custom.conf" ||
      fixture_fail "Ubuntu all-yes GDM enable flag is missing"
    grep -qx "AutomaticLogin=$runtime_user" "$root/etc/gdm3/custom.conf" ||
      fixture_fail "Ubuntu all-yes GDM user is incorrect"
    [[ -f "$root/etc/default/grub.d/90-eidetic-player.cfg" ]] ||
      fixture_fail "Ubuntu all-yes GRUB fragment is missing"
    [[ ! -e "$root/boot/firmware/cmdline.txt" ]] ||
      fixture_fail "Ubuntu all-yes staging requested a Raspberry Pi cmdline"
  fi

  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_all_yes_common "$root"
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_augmented "$root"

  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root"
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root"
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_original "$root"
}

test_official_source_remotes
[[ "${EIDETIC_SOURCE_REMOTE_FIXTURE_ONLY:-0}" != 1 ]] || exit 0
unset EIDETIC_BORDERLESS
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
all_yes_fixture raspios-all-yes \
  $'PRETTY_NAME="Raspberry Pi OS (64-bit)"\nNAME="Raspberry Pi OS"\nID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie' \
  arm64 RaspberryPi raspberrypi,3-model-b package
all_yes_fixture ubuntu-all-yes \
  $'PRETTY_NAME="Ubuntu 26.04 LTS"\nNAME=Ubuntu\nID=ubuntu\nVERSION_ID="26.04"\nVERSION_CODENAME=resolute' \
  amd64 GNOME

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
