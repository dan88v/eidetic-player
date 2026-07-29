#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR/../.."
runtime_user="${1:-$(id -un)}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
if [[ "${EUID}" -eq 0 && "$runtime_user" != root ]]; then
  chown "root:$(id -g "$runtime_user")" "$work"
  chmod 0710 "$work"
fi
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
  [[ -n "$windows_temp" ]] || {
    printf 'a writable Windows temporary directory is required for the Node bridge\n' >&2
    exit 1
  }
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

assert_smb_helper_exit() {
  local share="$1" expected="$2" caller_uid target status
  caller_uid="$(id -u "$runtime_user")"
  target="/run/user/$caller_uid/eidetic-player/smb/smb-0123456789abcdef0123456789abcdef"
  if PKEXEC_UID="$caller_uid" "$SCRIPT_DIR/runtime/eidetic-player-smb-helper" \
    mount "$target" "$share" invalid-option; then
    status=0
  else
    status=$?
  fi
  [[ "$status" == "$expected" ]] ||
    fixture_fail "SMB helper exit for '$share': expected $expected, found $status"
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

assert_power_installed() {
  local root="$1" helper policy
  helper="$root/usr/libexec/eidetic-player-power-helper"
  policy="$root/etc/polkit-1/rules.d/49-eidetic-player-power.rules"
  [[ -x "$helper" && "$(stat -c '%a' "$helper")" == 755 ]] ||
    fixture_fail "power helper is missing or has the wrong mode"
  [[ -r "$policy" && "$(stat -c '%a' "$policy")" == 644 ]] ||
    fixture_fail "power Polkit rule is missing or has the wrong mode"
  grep -Fq "subject.user !== \"$runtime_user\"" "$policy" ||
    fixture_fail "power Polkit rule does not contain the exact runtime user"
  ! grep -Fq '__EIDETIC_RUNTIME_USER__' "$policy" ||
    fixture_fail "power Polkit placeholder was not replaced"
  if grep -q '^EIDETIC_.*POWER' "$root/etc/eidetic-player/install.conf"; then
    fixture_fail "power integration persisted a new install.conf flag"
  fi
  [[ ! -e "$root/destructive-power-action-attempted" ]] ||
    fixture_fail "a staging test attempted a destructive power action"
}

assert_update_installed() {
  local root="$1"
  for path in \
    usr/libexec/eidetic-player-update-helper \
    usr/libexec/eidetic-player-update-runner \
    usr/libexec/eidetic-player-update-journal.mjs; do
    [[ -x "$root/$path" && ! -L "$root/$path" ]] ||
      fixture_fail "software-update runtime is missing: $path"
  done
  [[ -r "$root/etc/systemd/system/eidetic-player-update.service" ]] ||
    fixture_fail "software-update systemd unit is missing"
  [[ -r "$root/etc/polkit-1/rules.d/49-eidetic-player-update.rules" ]] ||
    fixture_fail "software-update Polkit rule is missing"
  grep -Fq "subject.user !== \"$runtime_user\"" \
    "$root/etc/polkit-1/rules.d/49-eidetic-player-update.rules" ||
    fixture_fail "software-update Polkit rule does not contain the runtime user"
  grep -Fxq "Group=$runtime_user" \
    "$root/etc/systemd/system/eidetic-player-update.service" ||
    fixture_fail "software-update unit does not use the runtime group"
  grep -Fxq 'UMask=0027' \
    "$root/etc/systemd/system/eidetic-player-update.service" ||
    fixture_fail "software-update unit does not preserve group-readable journals"
  grep -Fxq 'NoNewPrivileges=no' \
    "$root/etc/systemd/system/eidetic-player-update.service" ||
    fixture_fail "software-update unit cannot enter the runtime build identity"
  grep -Eq '^EIDETIC_UPDATE_BRANCH=[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$' \
    "$root/etc/eidetic-player/update.conf" ||
    fixture_fail "software-update branch config is invalid"
  [[ "$(stat -c '%a' "$root/etc/eidetic-player/update.conf")" == 644 &&
    "$(stat -c '%a' "$root/etc/systemd/system/eidetic-player-update.service")" == 644 &&
    "$(stat -c '%a' "$root/etc/polkit-1/rules.d/49-eidetic-player-update.rules")" == 644 ]] ||
    fixture_fail "software-update config, unit, or policy mode is invalid"
  [[ "$(stat -c '%a' "$root/var/lib/eidetic-player")" == 710 &&
    "$(stat -c '%a' "$root/var/lib/eidetic-player/update")" == 2750 ]] ||
    fixture_fail "software-update state traversal or directory mode is invalid"
}

assert_update_branch() {
  local root="$1" branch="$2"
  grep -Fxq "EIDETIC_UPDATE_BRANCH=$branch" \
    "$root/etc/eidetic-player/update.conf" ||
    fixture_fail "software-update branch config was not preserved"
}

assert_update_not_installed() {
  local root="$1"
  [[ ! -e "$root/usr/libexec/eidetic-player-update-helper" &&
    ! -e "$root/etc/systemd/system/eidetic-player-update.service" &&
    ! -e "$root/var/lib/eidetic-player/update" ]] ||
    fixture_fail "Software Update integration was installed outside Appliance mode"
}

install_root() {
  local name="$1" os="$2" arch="$3" desktop="$4"
  local compatible="${5:-none}" marker="${6:-none}"
  local root="$work/$name"
  install -d "$root/etc/eidetic-player"
  printf '%s\n' "$os" >"$root/etc/os-release"
  printf '%s\n' "$arch" >"$root/etc/eidetic-player/architecture"
  printf '%s\n' "$desktop" >"$root/etc/eidetic-player/desktop-session"
  install -d "$root/usr/bin"
  printf '#!/bin/sh\n: >%q\nexit 99\n' \
    "$root/destructive-power-action-attempted" >"$root/usr/bin/pkexec"
  printf '#!/bin/sh\n: >%q\nexit 99\n' \
    "$root/destructive-power-action-attempted" >"$root/usr/bin/systemctl"
  chmod 0755 "$root/usr/bin/pkexec" "$root/usr/bin/systemctl"
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
  install -d "$root/usr/libexec" "$root/etc/polkit-1/rules.d"
  printf 'original power helper\n' >"$root/usr/libexec/eidetic-player-power-helper"
  printf 'original power policy\n' >"$root/etc/polkit-1/rules.d/49-eidetic-player-power.rules"
  chmod 0700 "$root/usr/libexec/eidetic-player-power-helper"
  chmod 0600 "$root/etc/polkit-1/rules.d/49-eidetic-player-power.rules"

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode standard --unattended --rpi-onscreen-keyboard keep
  assert_standard_conf "$root"
  assert_power_installed "$root"
  assert_update_not_installed "$root"
  assert_update_branch "$root" main
  if grep -q '^EIDETIC_FULL_VERIFY=' "$root/etc/eidetic-player/install.conf"; then
    fixture_fail "ordinary install persisted the per-operation full verification flag"
  fi

  if [[ "$name" == raspios ]]; then
    EIDETIC_BORDERLESS=1 \
      "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
      --mode standard --unattended --rpi-onscreen-keyboard keep
    assert_standard_conf "$root"
    assert_power_installed "$root"
    assert_update_not_installed "$root"
  fi

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode standard --unattended --rpi-onscreen-keyboard keep \
    --full-verify --dry-run

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart yes --fullscreen yes --borderless yes \
    --disable-blanking no --hide-pointer no --splash no --autologin no --rpi-onscreen-keyboard keep
  assert_appliance_conf "$root" 1 1 0 0 0 0 1
  assert_power_installed "$root"
  assert_update_installed "$root"
  printf 'EIDETIC_UPDATE_CONFIG_SCHEMA=1\nEIDETIC_UPDATE_BRANCH=development/staging\nEIDETIC_UPDATE_REMOTE=%s\n' \
    "$EIDETIC_SOURCE_REMOTE" >"$root/etc/eidetic-player/update.conf"

  "$SCRIPT_DIR/install-eidetic-player.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart no --fullscreen no --borderless no \
    --disable-blanking no --hide-pointer no --splash no --autologin no --rpi-onscreen-keyboard keep
  assert_appliance_conf "$root" 0 0 0 0 0 0 0
  assert_power_installed "$root"
  assert_update_installed "$root"
  assert_update_branch "$root" development/staging

  current_before_noop="$(readlink "$root/opt/eidetic-player/current")"
  releases_before_noop="$(find "$root/opt/eidetic-player/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)"
  noop_output="$(
    EIDETIC_UPDATE_TARGET_SHA=0000000000000000000000000000000000000000 \
      "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  )"
  [[ "$noop_output" == *"Already up to date."* ]] ||
    fixture_fail "same-commit update did not report the exact no-op"
  [[ "$noop_output" != *"RUNTIME STEP"* ]] ||
    fixture_fail "same-commit update rendered runtime progress"
  [[ "$(readlink "$root/opt/eidetic-player/current")" == "$current_before_noop" ]] ||
    fixture_fail "same-commit update changed current"
  [[ "$(find "$root/opt/eidetic-player/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)" == "$releases_before_noop" ]] ||
    fixture_fail "same-commit update created a release"

  rm -f -- "$root/opt/eidetic-player/current/build-info.json"
  install_logs_before_update="$(
    find "$root/var/log/eidetic-player" -maxdepth 1 -type f \
      -name 'install-*.log' | wc -l
  )"
  legacy_output="$(
    "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  )"
  [[ "$legacy_output" == *"legacy/unknown provenance"* ]] ||
    fixture_fail "legacy current release did not report unknown provenance"
  [[ -r "$root/opt/eidetic-player/current/build-info.json" ]] ||
    fixture_fail "legacy update did not install a new provenance manifest"
  [[ "$(grep -c '^EIDETIC PLAYER - Linux Updater$' <<<"$legacy_output")" == 1 ]] ||
    fixture_fail "embedded update did not render exactly one updater header"
  [[ "$legacy_output" != *"EIDETIC PLAYER - Linux Installer"* ]] ||
    fixture_fail "embedded installer rendered a second header"
  [[ "$(grep -c '^Update summary$' <<<"$legacy_output")" == 1 ]] ||
    fixture_fail "embedded update did not render exactly one summary"
  [[ "$(find "$root/var/log/eidetic-player" -maxdepth 1 -type f \
    -name 'install-*.log' | wc -l)" == "$install_logs_before_update" ]] ||
    fixture_fail "embedded installer created a second install log"

  # validate legacy migration paths
  write_legacy_conf "$root" standard 1 0 1 1 0 0
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_standard_conf "$root"
  assert_power_installed "$root"

  write_legacy_conf "$root" appliance 1 1 1 1 1 0 0
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_install_conf_value "$root" EIDETIC_BORDERLESS 0
  assert_power_installed "$root"
  if [[ "$name" == raspios ]]; then
    assert_rpi_cmdline_augmented "$root"
  else
    [[ ! -e "$root/boot/firmware/cmdline.txt" ]] ||
      fixture_fail "Ubuntu staging unexpectedly created a Raspberry Pi cmdline"
  fi

  write_legacy_conf "$root" appliance 1 1 1 1 1 0
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  assert_install_conf_value "$root" EIDETIC_BORDERLESS 1
  assert_power_installed "$root"
  [[ "$name" != raspios ]] || assert_rpi_cmdline_augmented "$root"

  # installation lifecycle
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --dry-run
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --full-verify --dry-run
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --full-verify --no-restart
  assert_power_installed "$root"
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --rollback
  "$SCRIPT_DIR/doctor-installation.sh" --root "$root" --json
  [[ "$name" != raspios ]] || assert_rpi_cmdline_augmented "$root"
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  assert_power_installed "$root"
  [[ "$name" != raspios ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  assert_power_installed "$root"
  [[ "$name" != raspios ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root" --unattended --dry-run
  assert_update_installed "$root"
  [[ -r "$root/etc/eidetic-player/update.conf" &&
    -d "$root/var/lib/eidetic-player/update" ]] ||
    fixture_fail "dry-run uninstall changed Software Update state"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root" --unattended
  [[ -r "$root/etc/eidetic-player/update.conf" ]] ||
    fixture_fail "normal uninstall did not preserve update branch config"
  [[ ! -e "$root/var/lib/eidetic-player/update" ]] ||
    fixture_fail "normal uninstall left software-update runtime state"
  grep -qx 'original power helper' "$root/usr/libexec/eidetic-player-power-helper" ||
    fixture_fail "uninstall did not restore the original power helper"
  grep -qx 'original power policy' "$root/etc/polkit-1/rules.d/49-eidetic-player-power.rules" ||
    fixture_fail "uninstall did not restore the original power policy"
  [[ "$(stat -c '%a' "$root/usr/libexec/eidetic-player-power-helper")" == 700 ]] ||
    fixture_fail "uninstall did not restore the original helper mode"
  [[ "$(stat -c '%a' "$root/etc/polkit-1/rules.d/49-eidetic-player-power.rules")" == 600 ]] ||
    fixture_fail "uninstall did not restore the original policy mode"
  [[ "$name" != raspios ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root" --unattended \
    --purge-data --yes-really-purge-data
  [[ ! -e "$root/etc/eidetic-player/update.conf" ]] ||
    fixture_fail "purge did not remove update branch config"
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
  assert_power_installed "$root"
  assert_update_installed "$root"

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
  assert_power_installed "$root"
  assert_update_installed "$root"
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_augmented "$root"

  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  assert_power_installed "$root"
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
  assert_power_installed "$root"
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root" --unattended
  [[ ! -e "$root/usr/libexec/eidetic-player-update-helper" ]] ||
    fixture_fail "uninstall left an orphaned software-update helper"
  [[ ! -e "$root/usr/libexec/eidetic-player-power-helper" ]] ||
    fixture_fail "uninstall left an orphaned power helper"
  [[ ! -e "$root/etc/polkit-1/rules.d/49-eidetic-player-power.rules" ]] ||
    fixture_fail "uninstall left an orphaned power policy"
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_original "$root"
  "$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root" --unattended
  [[ "$name" != raspios-all-yes ]] || assert_rpi_cmdline_original "$root"
}

test_official_source_remotes
[[ "${EIDETIC_SOURCE_REMOTE_FIXTURE_ONLY:-0}" != 1 ]] || exit 0
unset EIDETIC_BORDERLESS
"$SCRIPT_DIR/test-platform-detection.sh"
"$SCRIPT_DIR/test-console-ui.sh"
"$SCRIPT_DIR/test-guided-installer-staging.sh" "$runtime_user"
assert_smb_helper_exit '//server/share$ name' 65
assert_smb_helper_exit '//server/bad/name' 64
if [[ "${EUID}" -eq 0 ]]; then
  "$SCRIPT_DIR/test-unprivileged-build.sh" "$runtime_user"
  "$SCRIPT_DIR/test-rpi-keyboard.sh" "$runtime_user"
else
  printf 'Unprivileged-build and keyboard fixtures require root; run this staging suite with sudo for those gates.\n'
fi
"$SCRIPT_DIR/test-gpio-i2s-dac-staging.sh" "$runtime_user"

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
command -v shellcheck >/dev/null &&
  shellcheck -x -P "$SCRIPT_DIR" "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/lib/*.sh "$SCRIPT_DIR"/runtime/*
if command -v systemd-analyze >/dev/null; then
  sed 's#ExecStart=/opt/eidetic-player/current/bin/eidetic-player-launch#ExecStart=/bin/true#' \
    "$SCRIPT_DIR/templates/eidetic-player.service" >"$work/eidetic-player.service"
  chmod 0644 "$work/eidetic-player.service"
  systemd-analyze verify "$work/eidetic-player.service"
fi
printf 'Linux staging fixtures passed; temporary root will be removed on exit.\n'
