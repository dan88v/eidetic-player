#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
runtime_user="${1:-$(id -un)}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
helper="$SCRIPT_DIR/lib/gpio_i2s_dac.py"

fail() {
  printf 'GPIO/I2S staging fixture failed: %s\n' "$*" >&2
  exit 1
}

make_root() {
  local name="$1" layout="${2:-firmware}" content="${3:-dtparam=audio=on}"
  local overlay="${4:-yes}" root="$work/$name" boot
  install -d "$root/etc/eidetic-player" "$root/proc/device-tree" \
    "$root/var/lib/dpkg" "$root/usr/bin"
  cat >"$root/etc/os-release" <<'EOF'
ID=debian
VERSION_ID=13
VERSION_CODENAME=trixie
EOF
  printf 'arm64\n' >"$root/etc/eidetic-player/architecture"
  printf 'RaspberryPi\n' >"$root/etc/eidetic-player/desktop-session"
  printf 'brcm,bcm2837\0raspberrypi,3-model-b\0' \
    >"$root/proc/device-tree/compatible"
  printf 'Package: raspberrypi-ui-mods\nStatus: install ok installed\n' \
    >"$root/var/lib/dpkg/status"
  printf '#!/bin/sh\nexit 0\n' >"$root/usr/bin/pkexec"
  chmod 0755 "$root/usr/bin/pkexec"
  if [[ "$layout" == firmware ]]; then
    boot="$root/boot/firmware"
  else
    boot="$root/boot"
  fi
  install -d "$boot"
  printf '%s\n' "$content" >"$boot/config.txt"
  chmod 0640 "$boot/config.txt"
  if [[ "$overlay" == yes ]]; then
    install -d "$boot/overlays"
    printf 'fixture\n' >"$boot/overlays/i2s-dac.dtbo"
  fi
  printf '%s\n' "$root"
}

dry_run() {
  local root="$1" mode="$2"
  local -a args=(--root "$root" --user "$runtime_user" --mode "$mode"
    --unattended --rpi-onscreen-keyboard keep --gpio-i2s-dac --dry-run)
  if [[ "$mode" == appliance ]]; then
    args+=(--autostart no --fullscreen no --borderless no
      --disable-blanking no --hide-pointer no --splash no --autologin no)
  fi
  "$SCRIPT_DIR/install-eidetic-player-desktop.sh" "${args[@]}"
}

assert_managed() {
  local root="$1" config="$2"
  [[ "$(grep -Fxc '# BEGIN EIDETIC MANAGED GPIO I2S DAC' "$config")" == 1 ]] ||
    fail "managed BEGIN marker count"
  [[ "$(grep -Fxc 'dtoverlay=i2s-dac' "$config")" == 1 ]] ||
    fail "managed overlay count"
  [[ "$(grep -Fxc '# END EIDETIC MANAGED GPIO I2S DAC' "$config")" == 1 ]] ||
    fail "managed END marker count"
  grep -q $'^feature\tgpio-i2s-dac\t1\tmanaged\t' \
    "$root/var/lib/eidetic-player/system-ui-manifest-v1.tsv" ||
    fail "managed ownership record"
}

command -v python3 >/dev/null || fail "python3 is required"
full_installer=0
if command -v node >/dev/null &&
  [[ -f "$SCRIPT_DIR/../../node_modules/tsx/dist/cli.mjs" ]]; then
  full_installer=1
else
  printf 'GPIO/I2S staging note: Linux Node unavailable; core lifecycle runs directly.\n'
fi

root="$(make_root standard firmware $'# fixture\n[all]\ndtparam=audio=on')"
config="$root/boot/firmware/config.txt"
original="$(sha256sum "$config" | awk '{print $1}')"
mode="$(stat -c %a "$config")"
ownership="$(stat -c %u:%g "$config")"
dry_run "$root" standard
if ((full_installer)); then
  "$SCRIPT_DIR/install-eidetic-player-desktop.sh" --root "$root" --user "$runtime_user" \
    --mode standard --unattended --rpi-onscreen-keyboard keep --gpio-i2s-dac
  grep -qx 'EIDETIC_GPIO_I2S_DAC=1' "$root/etc/eidetic-player/install.conf" ||
    fail "Standard install.conf choice"
else
  [[ "$(python3 "$helper" apply --root "$root" --raspberry --session standard)" == added ]] ||
    fail "Standard apply"
  python3 "$helper" commit --root "$root" --session standard >/dev/null
fi
assert_managed "$root" "$config"
[[ "$(stat -c %a "$config")" == "$mode" ]] || fail "mode preservation"
[[ "$(stat -c %u:%g "$config")" == "$ownership" ]] || fail "ownership preservation"
backup="$root/var/lib/eidetic-player/backups/gpio-i2s-dac-config-v1"
[[ "$(sha256sum "$backup" | awk '{print $1}')" == "$original" ]] ||
  fail "verified original backup"
backup_count="$(find "$root/var/lib/eidetic-player/backups" -maxdepth 1 -type f | wc -l)"
if ((full_installer)); then
  "$SCRIPT_DIR/update-eidetic-player.sh" --root "$root" --no-restart
else
  [[ "$(python3 "$helper" apply --root "$root" --raspberry --session reinstall)" == managed ]] ||
    fail "reinstall idempotence"
fi
[[ "$(find "$root/var/lib/eidetic-player/backups" -maxdepth 1 -type f | wc -l)" == "$backup_count" ]] ||
  fail "reinstall accumulated a backup"
"$SCRIPT_DIR/restore-system-ui.sh" --root "$root"
assert_managed "$root" "$config"
"$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root" --unattended
assert_managed "$root" "$config"
"$SCRIPT_DIR/uninstall-eidetic-player.sh" --root "$root" --unattended --remove-gpio-i2s-dac
! grep -Fq '# BEGIN EIDETIC MANAGED GPIO I2S DAC' "$config" ||
  fail "explicit managed removal"
grep -Fqx 'dtparam=audio=on' "$config" || fail "onboard audio preservation"

root="$(make_root appliance legacy $'# fixture\n[all]\ndtparam=audio=on')"
config="$root/boot/config.txt"
dry_run "$root" appliance
if ((full_installer)); then
  "$SCRIPT_DIR/install-eidetic-player-desktop.sh" --root "$root" --user "$runtime_user" \
    --mode appliance --unattended --autostart no --fullscreen no --borderless no \
    --disable-blanking no --hide-pointer no --splash no --autologin no \
    --rpi-onscreen-keyboard keep --gpio-i2s-dac
  grep -qx 'EIDETIC_INSTALLATION_MODE=appliance' \
    "$root/etc/eidetic-player/install.conf" ||
    fail "Appliance install.conf mode"
else
  [[ "$(python3 "$helper" apply --root "$root" --raspberry --session appliance)" == added ]] ||
    fail "Appliance legacy apply"
  python3 "$helper" commit --root "$root" --session appliance >/dev/null
fi
assert_managed "$root" "$config"

root="$(make_root rollback firmware 'dtparam=audio=on')"
config="$root/boot/firmware/config.txt"
original="$(sha256sum "$config" | awk '{print $1}')"
[[ "$(python3 "$helper" apply --root "$root" --raspberry --session rollback)" == added ]] ||
  fail "rollback setup"
[[ "$(python3 "$helper" rollback --root "$root" --session rollback)" == rolled-back ]] ||
  fail "session rollback"
[[ "$(sha256sum "$config" | awk '{print $1}')" == "$original" ]] ||
  fail "byte-for-byte rollback"

root="$(make_root preexisting firmware $'dtparam=audio=on\ndtoverlay=i2s-dac')"
config="$root/boot/firmware/config.txt"
original="$(sha256sum "$config" | awk '{print $1}')"
dry_run "$root" standard
[[ "$(python3 "$helper" apply --root "$root" --raspberry --session preexisting)" == preexisting ]] ||
  fail "preexisting classification"
[[ "$(python3 "$helper" remove --root "$root" --raspberry)" == preserved-preexisting ]] ||
  fail "preexisting uninstall preservation"
[[ "$(sha256sum "$config" | awk '{print $1}')" == "$original" ]] ||
  fail "preexisting changed"

root="$(make_root conflict firmware $'dtparam=audio=on\ndtoverlay=hifiberry-dacplus')"
dry_run "$root" appliance
[[ "$(python3 "$helper" apply --root "$root" --raspberry --session conflict)" == conflict ]] ||
  fail "conflict classification"

root="$(make_root unavailable firmware 'dtparam=audio=on' no)"
[[ "$(python3 "$helper" apply --root "$root" --raspberry --session unavailable)" == overlay-unavailable ]] ||
  fail "overlay-unavailable classification"

root="$(make_root unowned firmware $'# BEGIN EIDETIC MANAGED GPIO I2S DAC\ndtoverlay=i2s-dac\n# END EIDETIC MANAGED GPIO I2S DAC')"
config="$root/boot/firmware/config.txt"
original="$(sha256sum "$config" | awk '{print $1}')"
[[ "$(python3 "$helper" remove --root "$root" --raspberry)" == preserved-managed-unowned ]] ||
  fail "managed-unowned preservation"
[[ "$(sha256sum "$config" | awk '{print $1}')" == "$original" ]] ||
  fail "managed-unowned changed"

python3 "$SCRIPT_DIR/test_gpio_i2s_dac.py"
printf 'GPIO/I2S DAC isolated root staging passed.\n'
