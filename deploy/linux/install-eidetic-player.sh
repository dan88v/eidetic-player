#!/usr/bin/env bash
set -euo pipefail
umask 022
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/lite-install.sh"

original_args=("$@")
runtime_user="${SUDO_USER:-}"
git_ref=main
resolved_commit=
mode=appliance
dry_run=0
unattended=0
guided=1
full_verify=0
application_update=0
EIDETIC_ROOT=/
gpio_i2s_dac=0
gpio_i2s_dac_explicit=0
gpio_i2s_dac_state=not-requested
legacy_desktop_option=0
SOURCE_REMOTE="$EIDETIC_SOURCE_REMOTE"
declare -A choice=([autostart]=yes [fullscreen]=yes [borderless]=yes [blanking]=yes [pointer]=yes [splash]=no [autologin]=yes)
borderless_value=1
rpi_keyboard=keep

usage() {
  cat <<'EOF'
Usage: sudo ./deploy/linux/install-eidetic-player.sh [options]

Installs the Raspberry Pi OS Lite 64-bit Debian 13/Trixie appliance.
Raspberry Pi OS Desktop and Ubuntu Desktop must use
install-eidetic-player-desktop.sh.

Common options:
  -v, --verbose               Show sanitized commands and live process output
  --no-color                  Disable terminal colors
  -h, --help                  Show this help
  --version                   Show installer provenance

Automation and technical options:
  --user USER                 Existing normal non-root runtime user
  --ref REF                   Git ref to install (default: main)
  --resolved-commit SHA       Pin the fetched ref to an exact commit
  --dry-run                   Validate and print the plan only
  --unattended                Never prompt
  --full-verify               Also run the complete application verification suite
  --root PATH                 Use an isolated staging root
  --gpio-i2s-dac              Configure a generic GPIO/I2S DAC (opt-in)

Examples:
  sudo ./deploy/linux/install-eidetic-player.sh
  sudo ./deploy/linux/install-eidetic-player.sh -v
  sudo ./deploy/linux/install-eidetic-player.sh --user player --unattended

The Lite installer is Appliance-only, never enables or modifies SSH, and never
reboots automatically. Uninstall preserves application data and APT packages.
EOF
}

while (($#)); do
  case "$1" in
    -v | --verbose) EIDETIC_CONSOLE_VERBOSE=1; shift ;;
    --no-color) export EIDETIC_CONSOLE_NO_COLOR=1; shift ;;
    --user) [[ $# -ge 2 ]] || eidetic_die "--user needs a value"; runtime_user="$2"; shift 2 ;;
    --ref) [[ $# -ge 2 ]] || eidetic_die "--ref needs a value"; git_ref="$2"; shift 2 ;;
    --resolved-commit) [[ $# -ge 2 ]] || eidetic_die "--resolved-commit needs a value"; resolved_commit="$2"; shift 2 ;;
    --root) [[ $# -ge 2 ]] || eidetic_die "--root needs a value"; EIDETIC_ROOT="$2"; shift 2 ;;
    --dry-run) guided=0; dry_run=1; shift ;;
    --unattended) guided=0; unattended=1; shift ;;
    --full-verify) full_verify=1; shift ;;
    --application-update) application_update=1; guided=0; shift ;;
    --gpio-i2s-dac) guided=0; gpio_i2s_dac=1; gpio_i2s_dac_explicit=1; shift ;;
    --mode|--autostart|--fullscreen|--borderless|--disable-blanking|--hide-pointer|--splash|--autologin|--rpi-onscreen-keyboard)
      legacy_desktop_option=1
      [[ $# -ge 2 ]] || eidetic_die "$1 needs a value"
      shift 2
      ;;
    -h | --help) usage; exit 0 ;;
    --version) printf 'eidetic-player-linux-lite-installer %s\n' "$(eidetic_project_version)"; exit 0 ;;
    *) eidetic_die "unknown option: $1" ;;
  esac
done

if [[ "$EIDETIC_ROOT" != "/" ]]; then eidetic_validate_root "$EIDETIC_ROOT"; fi
export EIDETIC_ROOT
eidetic_require_root
legacy_conf="$(eidetic_target /etc/eidetic-player/install.conf)"
if [[ -n "${EIDETIC_EMBEDDED_PARENT:-}" && -f "$legacy_conf" && ! -L "$legacy_conf" &&
  $(grep -Ec '^EIDETIC_INSTALL_PROFILE=' "$legacy_conf") -eq 0 &&
  $(grep -Ec '^EIDETIC_INSTALLATION_MODE=(standard|appliance)$' "$legacy_conf") -eq 1 ]]; then
  if [[ "$EIDETIC_ROOT" != "/" || "$(stat -c %u "$legacy_conf")" == 0 ]]; then
    printf 'Legacy Desktop updater compatibility: using install-eidetic-player-desktop.sh.\n' >&2
    exec "$SCRIPT_DIR/install-eidetic-player-desktop.sh" "${original_args[@]}"
  fi
fi

eidetic_classify_raspios_host
case "$EIDETIC_HOST_CLASS" in
  RPIOS_LITE) ;;
  DESKTOP) eidetic_die "Raspberry Pi OS Desktop detected. Use install-eidetic-player-desktop.sh." ;;
  AMBIGUOUS|UNKNOWN) eidetic_die "Raspberry Pi OS host classification is $EIDETIC_HOST_CLASS: $EIDETIC_HOST_CLASS_REASON. No changes were made." ;;
  UNSUPPORTED) eidetic_die "Unsupported host: $EIDETIC_HOST_CLASS_REASON. No changes were made." ;;
  *) eidetic_die "invalid host classification" ;;
esac
((legacy_desktop_option == 0)) || eidetic_die "Desktop installer options are unsupported on Lite; this installer is Appliance-only"
if ((application_update)) && [[ "${EIDETIC_EMBEDDED_PARENT:-}" != update ]]; then
  eidetic_die "--application-update is reserved for the installed profile-aware updater"
fi

if ((unattended)); then export EIDETIC_CONSOLE_FORCE_NON_TTY=1; fi
installer_version="$(eidetic_project_version)"
if [[ -n "${EIDETIC_EMBEDDED_PARENT:-}" ]]; then
  ((unattended)) || { printf 'Error: embedded installer mode requires --unattended.\n' >&2; exit 64; }
  eidetic_console_init_embedded "$EIDETIC_EMBEDDED_PARENT" || { printf 'Error: invalid embedded installer channel.\n' >&2; exit 64; }
else
  eidetic_console_init install "Raspberry Pi OS Lite Installer" "$EIDETIC_ROOT" "$installer_version" || exit 1
fi
installation_cancelled=0
early_exit() {
  local status="$1"
  if ((status != 0)); then
    if [[ "$installation_cancelled" == 1 ]]; then
      eidetic_console_abort_active_phase
      eidetic_console_info "Installation cancelled by user."
      eidetic_console_info "Rollback: not required"
      eidetic_console_info "Log: $EIDETIC_LOG_PATH"
    else
      eidetic_console_failure_panel "INSTALLATION FAILED" "${EIDETIC_FAILURE_REASON:-The current operation did not complete.}" "$status" "not required"
    fi
  fi
  eidetic_console_finalize
  return "$status"
}
trap 'early_exit "$?"' EXIT
trap 'installation_cancelled=1; exit 130' INT
trap 'installation_cancelled=1; exit 143' TERM

if ((guided)) && { [[ ! -t 0 || ! -t 1 ]] && [[ "${EIDETIC_CONSOLE_FORCE_TTY:-0}" != 1 ]]; }; then
  EIDETIC_FAILURE_REASON="Guided installation requires an interactive terminal. Use --unattended with --user."
  usage >&3
  exit 64
fi
if [[ -z "$runtime_user" ]]; then
  mapfile -t normal_users < <(getent passwd | awk -F: -v minimum="$(awk '$1 == "UID_MIN" { print $2; exit }' "$(eidetic_target /etc/login.defs)" 2>/dev/null || printf 1000)" '$3 >= minimum && $3 < 65534 && $7 !~ /(nologin|false)$/ { print $1 }')
  if ((${#normal_users[@]} == 1)); then
    runtime_user="${normal_users[0]}"
  elif ((unattended || ${#normal_users[@]} == 0)); then
    eidetic_die "--user is required when SUDO_USER does not identify one normal user"
  else
    eidetic_console_section "Runtime user"
    for index in "${!normal_users[@]}"; do eidetic_console_info "  $((index + 1)). ${normal_users[$index]}"; done
    eidetic_prompt_choice "Select runtime user" 1 "${#normal_users[@]}" 1 || eidetic_die "runtime user selection ended unexpectedly"
    runtime_user="${normal_users[$((EIDETIC_PROMPT_RESULT - 1))]}"
  fi
fi
eidetic_validate_lite_runtime_user "$runtime_user"
lite_integration_schema=1
machine_bootstrap_required=1
if ((application_update)); then
  [[ -f "$legacy_conf" && ! -L "$legacy_conf" ]] ||
    eidetic_die "Lite application update requires a regular install profile"
  grep -Fxq 'EIDETIC_INSTALL_PROFILE=raspios-lite' "$legacy_conf" ||
    eidetic_die "Lite application update profile could not be proven"
  grep -Fxq "EIDETIC_LITE_INTEGRATION_SCHEMA=$lite_integration_schema" "$legacy_conf" ||
    eidetic_die "Lite machine integration schema requires an explicit installer migration"
  python3 "$SCRIPT_DIR/lib/machine_ownership.py" validate --root "$EIDETIC_ROOT" >/dev/null ||
    eidetic_die "Lite machine ownership manifest is invalid; update refused"
  machine_bootstrap_required=0
fi
eidetic_validate_ref "$git_ref"
if [[ -n "$resolved_commit" && ! "$resolved_commit" =~ ^[0-9a-f]{40}$ ]]; then eidetic_die "--resolved-commit must be an exact lowercase commit SHA"; fi
checkout="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
preflight_world_write=yes
[[ "$EIDETIC_ROOT" == "/" ]] || preflight_world_write=no
export EIDETIC_CONSOLE_PHASE_TOTAL=$((dry_run ? 2 : 10))
eidetic_console_phase_begin "Preflight"
eidetic_preflight_checkout "$runtime_user" "$checkout" "$preflight_world_write"
eidetic_console_phase_done
eidetic_console_phase_begin "Platform"
EIDETIC_DISTRO=raspios
EIDETIC_DESKTOP=none
export EIDETIC_DISTRO EIDETIC_DESKTOP
backend_host="${BACKEND_HOST:-127.0.0.1}"
backend_port="${BACKEND_PORT:-4310}"
if ! [[ "$backend_port" =~ ^[0-9]+$ ]] ||
  ((backend_port < 1 || backend_port > 65535)); then
  eidetic_die "Invalid BACKEND_PORT=$backend_port; must be an integer 1-65535."
fi
[[ "$backend_host" == 127.0.0.1 || "$backend_host" == localhost ]] || eidetic_die "Invalid BACKEND_HOST=$backend_host; only loopback is supported."
eidetic_network_preflight
[[ "$EIDETIC_NETWORK_CLASS" == NM_AUTHORITATIVE ]] || eidetic_die "Network preflight is $EIDETIC_NETWORK_CLASS. NetworkManager must already own the active connection; no network changes were made."
eidetic_console_phase_done
eidetic_console_section "Detected appliance host"
eidetic_console_info "  OS                   ${PRETTY_NAME:-${ID:-unknown}}"
eidetic_console_info "  Architecture         $EIDETIC_ARCH"
eidetic_console_info "  Profile              raspios-lite"
eidetic_console_info "  Runtime user         $runtime_user"
eidetic_console_info "  Network              $EIDETIC_NETWORK_CLASS"
if ((guided && gpio_i2s_dac_explicit == 0)); then
  eidetic_prompt_yes_no "Configure a generic GPIO/I2S DAC (PCM5102A-compatible)?" no || eidetic_die "GPIO/I2S DAC choice input ended unexpectedly"
  [[ "$EIDETIC_PROMPT_RESULT" == yes ]] && gpio_i2s_dac=1 || gpio_i2s_dac=0
fi

gpio_dac_helper="$SCRIPT_DIR/lib/gpio_i2s_dac.py"
gpio_dac_plan="not requested"
if ((gpio_i2s_dac)); then
  command -v python3 >/dev/null ||
    eidetic_die "python3 is required to inspect GPIO/I2S boot configuration"
  gpio_dac_args=(inspect --root "$EIDETIC_ROOT")
  [[ "$EIDETIC_DISTRO" != raspios ]] || gpio_dac_args+=(--raspberry)
  gpio_i2s_dac_state="$(python3 "$gpio_dac_helper" "${gpio_dac_args[@]}")" ||
    eidetic_die "GPIO/I2S DAC boot inspection failed"
  case "$gpio_i2s_dac_state" in
    absent) gpio_dac_plan="will configure i2s-dac" ;;
    preexisting) gpio_dac_plan="pre-existing configuration preserved" ;;
    managed) gpio_dac_plan="already managed" ;;
    managed-unowned) gpio_dac_plan="managed markers preserved without ownership" ;;
    conflict) gpio_dac_plan="skipped due to conflicting audio overlay" ;;
    overlay-unavailable) gpio_dac_plan="overlay unavailable" ;;
    unsupported-platform) gpio_dac_plan="unavailable on this platform" ;;
    failed) gpio_dac_plan="unsafe boot configuration" ;;
    *) eidetic_die "unexpected GPIO/I2S DAC state: $gpio_i2s_dac_state" ;;
  esac
fi

package_manifest="$SCRIPT_DIR/manifests/raspios-lite-trixie-arm64.packages"
eidetic_parse_lite_package_manifest "$package_manifest"
packages=("${EIDETIC_LITE_PACKAGES_RECOMMENDS[@]}" "${EIDETIC_LITE_PACKAGES_NO_RECOMMENDS[@]}")
eidetic_console_plain_log "Target: raspios-lite $EIDETIC_ARCH; user=$runtime_user; mode=appliance; ref=$git_ref"
eidetic_console_plain_log "Package manifest: raspios-lite-trixie-arm64 schema 1"
eidetic_console_plain_log "APT plan: ${packages[*]}"
if ((full_verify)); then eidetic_console_plain_log "Verification profile: full"; ((dry_run)) && eidetic_console_info "Verification profile: full"; else eidetic_console_plain_log "Verification profile: install-safe"; ((dry_run)) && eidetic_console_info "Verification profile: install-safe"; fi
eidetic_console_plain_log "GPIO/I2S DAC: $gpio_dac_plan"

airplay_existing_store="$(eidetic_target "$EIDETIC_RUNTIME_HOME/.config/eidetic-player/airplay.json")"
airplay_plan="On after activation"
if [[ -f "$airplay_existing_store" && ! -L "$airplay_existing_store" &&
  "$(stat -c '%s' "$airplay_existing_store" 2>/dev/null || printf 65537)" -le 65536 ]]; then
  airplay_existing_enabled="$(python3 - "$airplay_existing_store" <<'PY' 2>/dev/null || printf invalid
import json
import sys

value = json.load(open(sys.argv[1], encoding="utf-8")).get("enabled")
print("true" if value is True else "false" if value is False else "invalid")
PY
)"
  case "$airplay_existing_enabled" in
    true) airplay_plan="Preserved (On)" ;;
    false) airplay_plan="Preserved (Off)" ;;
    *) airplay_plan="Preserved (requires repair)" ;;
  esac
elif [[ -e "$airplay_existing_store" ]]; then
  airplay_plan="Preserved (requires repair)"
fi

eidetic_console_section "Installation summary"
eidetic_console_info "  System               ${PRETTY_NAME:-${ID:-unknown}}"
eidetic_console_info "  Architecture         $EIDETIC_ARCH"
eidetic_console_info "  Runtime user         $runtime_user"
eidetic_console_info "  Mode                 Appliance"
eidetic_console_info "  Install path         /opt/eidetic-player"
eidetic_console_info "  Graphical session    tty1 / Wayland / labwc"
eidetic_console_info "  Fullscreen           Yes"
eidetic_console_info "  GPIO/I2S DAC         $gpio_dac_plan"
eidetic_console_info "  AirPlay receiver     $airplay_plan"
eidetic_console_info "  Existing data        Preserved"
eidetic_console_info "  Reboot               Required; never automatic"

if ((guided)); then
  eidetic_prompt_yes_no "Proceed with installation?" yes ||
    eidetic_die "installation confirmation input ended unexpectedly"
  if [[ "$EIDETIC_PROMPT_RESULT" == no ]]; then
    eidetic_console_info "Installation cancelled before any change."
    exit 0
  fi
fi
if ((dry_run)); then
  eidetic_log "Dry-run complete: no files, packages, services, boot settings, mounts, or network profiles changed."
  exit 0
fi

tmp="$(mktemp -d)"
build_workspace=
build_runtime=
release_stage=
update_conf_stage=
airplay_cache_stage=
keyboard_changed=0
install_committed=0
keyboard_attempt_state=
gpio_dac_changed=0
gpio_dac_session="install-${PPID}-${BASHPID}"
machine_helper="$SCRIPT_DIR/lib/machine_ownership.py"
machine_before="$tmp/machine-before.json"
managed_transaction="$tmp/managed-transaction"
graphical_target_link="$(eidetic_target /etc/systemd/user/default.target.wants/eidetic-graphical-session.target)"
graphical_target_link_created=0
graphical_target_link_preexisting=0
packages_pre_existing="$tmp/packages-pre-existing"
packages_installed="$tmp/packages-installed"
package_versions="$tmp/package-versions"
: >"$packages_pre_existing"
: >"$packages_installed"
: >"$package_versions"
python3 "$machine_helper" capture --root "$EIDETIC_ROOT" --output "$machine_before" || eidetic_die "machine before-state capture failed"
if [[ -e "$graphical_target_link" || -L "$graphical_target_link" ]]; then
  [[ -L "$graphical_target_link" &&
    "$(readlink "$graphical_target_link")" == ../eidetic-graphical-session.target ]] ||
    eidetic_die "graphical target enablement path collides with pre-existing state"
  graphical_target_link_preexisting=1
fi
eidetic_managed_transaction_init "$managed_transaction"
for package in "${packages[@]}"; do if eidetic_lite_package_installed "$package"; then printf '%s\n' "$package" >>"$packages_pre_existing"; fi; done
cleanup() {
  local status="$1" rollback_result="not required"
  eidetic_console_abort_active_phase
  if ((status != 0 && install_committed == 0)); then
    if [[ "$graphical_target_link_created" == 1 ]]; then
      if [[ -L "$graphical_target_link" &&
        "$(readlink "$graphical_target_link")" == ../eidetic-graphical-session.target ]]; then
        rm -f -- "$graphical_target_link"
      else
        rollback_result="graphical target rollback requires manual review"
      fi
    fi
    if eidetic_managed_transaction_rollback; then
      [[ "$rollback_result" != "not required" ]] ||
        rollback_result="managed machine integration restored successfully"
    else
      rollback_result="managed machine integration rollback failed; manual review required"
    fi
  fi
  if [[ "$gpio_dac_changed" == 1 && "$install_committed" == 0 ]]; then
    eidetic_log "Restoring boot configuration after failed installation."
    if python3 "$gpio_dac_helper" rollback --root "$EIDETIC_ROOT" \
      --session "$gpio_dac_session" >/dev/null; then
      rollback_result="GPIO/I2S boot configuration restored successfully"
    else
      rollback_result="GPIO/I2S boot rollback failed; manual review required"
      eidetic_log "CRITICAL: GPIO/I2S boot rollback could not be proven; manual review is required."
    fi
  fi
  if [[ "$keyboard_changed" == 1 && "$install_committed" == 0 &&
    -n "$keyboard_attempt_state" ]]; then
    eidetic_log "Restoring Raspberry Pi OS on-screen keyboard after failed installation."
    if eidetic_set_rpi_keyboard_state "$keyboard_attempt_state"; then
      rollback_result="session changes restored successfully"
    else
      rollback_result="on-screen keyboard rollback failed; manual review required"
      eidetic_log "Warning: automatic on-screen keyboard rollback failed; use raspi-config Display Options > D6."
    fi
  fi
  [[ -z "$release_stage" || ! -e "$release_stage" ]] ||
    rm -rf -- "$release_stage"
  [[ -z "$build_runtime" || ! -e "$build_runtime" ]] ||
    rm -rf -- "$build_runtime"
  [[ -z "$build_workspace" || ! -e "$build_workspace" ]] ||
    rm -rf -- "$build_workspace"
  [[ -z "$update_conf_stage" || ! -e "$update_conf_stage" ]] ||
    rm -f -- "$update_conf_stage"
  [[ -z "$airplay_cache_stage" || ! -e "$airplay_cache_stage" ]] ||
    rm -rf -- "$airplay_cache_stage"
  rm -rf -- "$tmp"
  if ((status != 0)); then
    if [[ "$installation_cancelled" == 1 ]]; then
      eidetic_console_info "Installation cancelled by user."
      eidetic_console_info "Rollback: $rollback_result"
      eidetic_console_info "Log: $EIDETIC_LOG_PATH"
    else
      eidetic_console_failure_panel "INSTALLATION FAILED" \
        "${EIDETIC_FAILURE_REASON:-The current operation did not complete.}" \
        "$status" "$rollback_result"
    fi
  fi
  eidetic_console_finalize
  return "$status"
}
trap 'cleanup "$?"' EXIT
eidetic_console_phase_begin "Packages"
missing_recommends=()
missing_no_recommends=()
for package in "${EIDETIC_LITE_PACKAGES_RECOMMENDS[@]}"; do eidetic_lite_package_installed "$package" || missing_recommends+=("$package"); done
for package in "${EIDETIC_LITE_PACKAGES_NO_RECOMMENDS[@]}"; do eidetic_lite_package_installed "$package" || missing_no_recommends+=("$package"); done
if ((machine_bootstrap_required)); then
  eidetic_console_command_preview apt-get update
  ((${#missing_recommends[@]} == 0)) || eidetic_console_command_preview apt-get install -y "${missing_recommends[@]}"
  ((${#missing_no_recommends[@]} == 0)) || eidetic_console_command_preview apt-get install -y --no-install-recommends "${missing_no_recommends[@]}"
fi
if ((machine_bootstrap_required)); then
  if [[ "$EIDETIC_ROOT" == "/" ]]; then
    if [[ "$unattended" == 1 ]]; then
      export DEBIAN_FRONTEND=noninteractive
    else
      export DEBIAN_FRONTEND=dialog
    fi
    apt-get update
    if ((${#missing_recommends[@]})); then apt-get install -y "${missing_recommends[@]}"; fi
    if ((${#missing_no_recommends[@]})); then apt-get install -y --no-install-recommends "${missing_no_recommends[@]}"; fi
    [[ -x /usr/bin/mpv ]] || eidetic_die "MPV was installed but /usr/bin/mpv is unavailable"
    /usr/bin/mpv --version >/dev/null 2>&1 || eidetic_die "MPV executable verification failed"
    [[ -x /usr/bin/pkexec ]] || eidetic_die "pkexec was installed but /usr/bin/pkexec is unavailable"
    [[ -x /usr/bin/labwc && -x /usr/bin/wlr-randr ]] || eidetic_die "Wayland/labwc package verification failed"
  else
    install -d -m 0755 "$(eidetic_target /etc/eidetic-player)"
  fi
  printf '%s\n' "${missing_recommends[@]}" "${missing_no_recommends[@]}" | sed '/^$/d' >"$packages_installed"
else
  eidetic_console_info "Machine packages and graphical integration are already at schema $lite_integration_schema; bootstrap skipped."
fi
for package in "${packages[@]}"; do
  if version="$(eidetic_lite_package_version "$package")" && [[ -n "$version" ]]; then
    printf '%s\t%s\n' "$package" "$version" >>"$package_versions"
  elif eidetic_lite_package_installed "$package"; then
    printf '%s\t%s\n' "$package" fixture >>"$package_versions"
  else
    printf '%s\t%s\n' "$package" planned >>"$package_versions"
  fi
done

node_version="$(tr -d '[:space:]v' <"$SCRIPT_DIR/../../.nvmrc")"
node_platform=$([[ "$EIDETIC_ARCH" == "amd64" ]] && printf linux-x64 || printf linux-arm64)
node_root="$(eidetic_target /opt/eidetic-player/node)"
node_release="$node_root/v$node_version"
install -d -m 0755 "$node_root"
if [[ "$EIDETIC_ROOT" == "/" && ! -x "$node_release/bin/node" ]]; then
  base="https://nodejs.org/dist/v${node_version}"
  curl --fail --location --proto '=https' --tlsv1.2 -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  archive="node-v${node_version}-${node_platform}.tar.xz"
  curl --fail --location --proto '=https' --tlsv1.2 -o "$tmp/$archive" "$base/$archive"
  (cd "$tmp"; grep "  $archive\$" SHASUMS256.txt | sha256sum --check --strict)
  install -d -m 0755 "$node_release"
  tar -xJf "$tmp/$archive" --strip-components=1 -C "$node_release"
elif [[ "$EIDETIC_ROOT" != "/" ]]; then
  install -d -m 0755 "$node_release/bin"
  printf '#!/bin/sh\nexit 0\n' >"$node_release/bin/node"
  chmod 0755 "$node_release/bin/node"
fi
ln -sfn "v$node_version" "$node_root/current.new"
mv -Tf "$node_root/current.new" "$node_root/current"
eidetic_console_phase_done

airplay_integration_version="$(python3 -c \
  'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["integrationVersion"])' \
  "$SCRIPT_DIR/airplay/sources.json")"
[[ "$airplay_integration_version" =~ ^[A-Za-z0-9.+_-]{1,128}$ ]] ||
  eidetic_die "AirPlay integration manifest has an invalid version"
airplay_smi_version="$(python3 -c \
  'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["nqptp"]["expectedSharedMemoryVersion"])' \
  "$SCRIPT_DIR/airplay/sources.json")"
[[ "$airplay_smi_version" =~ ^[1-9][0-9]{0,2}$ ]] ||
  eidetic_die "AirPlay integration manifest has an invalid shared-memory interface version"
airplay_cache_root="$(eidetic_target /var/cache/eidetic-player/airplay)"
airplay_cache="$airplay_cache_root/${airplay_integration_version}-${EIDETIC_ARCH}"
airplay_cache_hit=0

airplay_cache_valid() {
  local root="$1" shairport_version nqptp_version binary_details linkage feature
  [[ -d "$root" && ! -L "$root" &&
    -x "$root/bin/shairport-sync" && ! -L "$root/bin/shairport-sync" &&
    -x "$root/bin/nqptp" && ! -L "$root/bin/nqptp" &&
    -f "$root/artifact.json" && ! -L "$root/artifact.json" &&
    -f "$root/share/eidetic-player-airplay/sources.json" ]] || return 1
  [[ -z "$(find "$root" -type l -print -quit)" ]] || return 1
  python3 - "$root" "$airplay_integration_version" "$EIDETIC_ARCH" <<'PY'
import hashlib
import json
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1])
expected_version = sys.argv[2]
expected_arch = {"amd64": "x86_64", "arm64": "aarch64"}[sys.argv[3]]
artifact = json.loads((root / "artifact.json").read_text(encoding="utf-8"))
for path, directories, files in os.walk(root):
    for candidate in [path, *(os.path.join(path, name) for name in directories + files)]:
        details = os.lstat(candidate)
        if details.st_uid != 0 or stat.S_IMODE(details.st_mode) & 0o022:
            raise SystemExit(1)
if artifact.get("schemaVersion") != 1 or artifact.get("integrationVersion") != expected_version:
    raise SystemExit(1)
if artifact.get("architecture") != expected_arch:
    raise SystemExit(1)
for name in ("shairport-sync", "nqptp"):
    digest = hashlib.sha256((root / "bin" / name).read_bytes()).hexdigest()
    if artifact.get("binaries", {}).get(name) != digest:
        raise SystemExit(1)
PY
  binary_details="$(file "$root/bin/shairport-sync" "$root/bin/nqptp" 2>/dev/null)" || return 1
  case "$EIDETIC_ARCH" in
    arm64) grep -Fq 'ARM aarch64' <<<"$binary_details" || return 1 ;;
    amd64) grep -Eq 'x86-64|x86_64' <<<"$binary_details" || return 1 ;;
  esac
  shairport_version="$("$root/bin/shairport-sync" -V 2>&1)" || return 1
  for feature in 5.2.1 AirPlay2 "smi$airplay_smi_version" OpenSSL Avahi ALSA PipeWire soxr metadata; do
    grep -Fq "$feature" <<<"$shairport_version" || return 1
  done
  nqptp_version="$("$root/bin/nqptp" -V 2>&1)" || return 1
  grep -Fq '1.2.8' <<<"$nqptp_version" || return 1
  grep -Fq "Shared Memory Interface Version: smi$airplay_smi_version." \
    <<<"$nqptp_version" || return 1
  linkage="$(ldd "$root/bin/shairport-sync"; ldd "$root/bin/nqptp")" || return 1
  ! grep -Fq 'not found' <<<"$linkage" || return 1
}

if [[ "$EIDETIC_ROOT" == "/" ]] && airplay_cache_valid "$airplay_cache"; then
  airplay_cache_hit=1
  eidetic_log "AirPlay integration cache hit: $airplay_integration_version ($EIDETIC_ARCH)"
fi

eidetic_console_phase_begin "Application runtime"
releases="$(eidetic_target /opt/eidetic-player/releases)"
opt="$(eidetic_target /opt/eidetic-player)"
install -d -m 0755 "$releases"
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  EIDETIC_INSTALLATION_MODE="$mode"
  EIDETIC_FULLSCREEN=$([[ "${choice[fullscreen]}" == yes ]] && printf 1 || printf 0)
  EIDETIC_BORDERLESS="$borderless_value"
  EIDETIC_BUILD_REF="$git_ref"
  export EIDETIC_INSTALLATION_MODE EIDETIC_FULLSCREEN EIDETIC_BORDERLESS
  export EIDETIC_BUILD_REF
  runtime_prepare_source() {
    build_workspace="$(eidetic_prepare_build_workspace "$runtime_user")" || return
    build_runtime="$(eidetic_prepare_build_runtime "$runtime_user")" || return
    eidetic_validate_mpv_runtime_budget "$build_runtime" || return
    build_source="$build_workspace/source"
    source_ref="${resolved_commit:-$git_ref}"
    eidetic_log "Source phase (runtime user UID $EIDETIC_RUNTIME_UID): isolated fetch $git_ref"
    eidetic_fetch_isolated_source \
      "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
      "$source_ref" "$SOURCE_REMOTE"
  }
  runtime_npm_ci() {
    local attempt status delay
    for attempt in 1 2 3; do
      if eidetic_run_as_runtime_user \
        "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
        "$node_release/bin/npm" --prefix "$build_source" ci; then
        return 0
      else
        status=$?
      fi
      ((attempt < 3)) || return "$status"
      delay=$((attempt * 5))
      eidetic_log \
        "Dependency installation attempt $attempt failed; retrying in $delay seconds."
      sleep "$delay"
    done
    return "$status"
  }
  runtime_npm_run() {
    eidetic_run_as_runtime_user \
      "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
      "$node_release/bin/npm" --prefix "$build_source" run "$1"
  }
  runtime_npm_test() {
    eidetic_run_as_runtime_user \
      "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
      "$node_release/bin/npm" --prefix "$build_source" test
  }
  runtime_build_linux() {
    export EIDETIC_RUNTIME_PROGRESS_OFFSET="$runtime_build_offset"
    export EIDETIC_RUNTIME_PROGRESS_TOTAL="$EIDETIC_RUNTIME_TOTAL"
    runtime_npm_run build:linux
  }
  runtime_verify_artifacts() {
    if ((airplay_cache_hit == 0)); then
      eidetic_log "Building pinned AirPlay integration as runtime user."
      eidetic_run_as_runtime_user \
        "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
        "$build_source/deploy/linux/airplay/build-airplay-integration.sh" \
        --output "$build_source/dist/airplay" || {
        EIDETIC_FAILURE_REASON="AirPlay source build failed. No release was activated."
        return 1
      }
    fi
    [[ -d "$build_source/dist/backend" ]] || {
      EIDETIC_FAILURE_REASON="build phase failed: backend artifact was not produced"
      return 1
    }
    [[ -f "$build_source/dist/remote-ui/index.html" ]] || {
      EIDETIC_FAILURE_REASON="build phase failed: Remote UI artifact was not produced"
      return 1
    }
    case "$EIDETIC_ARCH" in
      amd64) neutralino_arch=x64 ;;
      arm64) neutralino_arch=arm64 ;;
      *)
        EIDETIC_FAILURE_REASON="unsupported Neutralino Linux architecture: $EIDETIC_ARCH"
        return 1
        ;;
    esac
    shell_binary="$build_source/dist/eidetic-player/eidetic-player-linux_${neutralino_arch}"
    if [[ ! -f "$shell_binary" ]]; then
      eidetic_log "Neutralino distribution contents:"
      find "$build_source/dist" -maxdepth 3 -type f -printf '  %m %p\n' >&2 || true
      EIDETIC_FAILURE_REASON="Neutralino Linux ${neutralino_arch} binary was not produced"
      return 1
    fi
    mapfile -d '' neu_files < <(
      find "$build_source/dist" -maxdepth 3 -type f \
        \( -name '*.neu' -o -name 'neutralino.config.json' \) -print0
    )
    ((${#neu_files[@]} > 0)) || {
      EIDETIC_FAILURE_REASON="Neutralino resources were not produced"
      return 1
    }
    eidetic_run_as_runtime_user \
      "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
      "$node_release/bin/node" "$build_source/node_modules/tsx/dist/cli.mjs" \
      "$build_source/scripts/verify-linux-release.ts" \
      --root "$build_source" --arch "$neutralino_arch" --phase build || {
      EIDETIC_FAILURE_REASON="Installation verification failed: Linux build artifact contract. No release was activated."
      return 1
    }
    release_commit="$("$node_release/bin/node" -e \
      'const value=require(process.argv[1]); process.stdout.write(value.shortCommitSha)' \
      "$build_source/dist/build-info.json")"
  }

  EIDETIC_RUNTIME_FULL_VERIFY="$full_verify"
  export EIDETIC_RUNTIME_FULL_VERIFY
  eidetic_runtime_configure "$full_verify"
  eidetic_runtime_begin
  runtime_status=0
  eidetic_runtime_run_step prepare-source 1 runtime_prepare_source ||
    runtime_status=$?
  if ((runtime_status == 0)); then
    eidetic_runtime_run_step install-dependencies 2 runtime_npm_ci ||
      runtime_status=$?
  fi
  if ((runtime_status == 0)); then
    eidetic_runtime_run_step typecheck 3 runtime_npm_run typecheck ||
      runtime_status=$?
  fi
  if ((runtime_status == 0)); then
    eidetic_runtime_run_step verify-installer 4 runtime_npm_run verify:linux:installer ||
      runtime_status=$?
  fi
  runtime_build_offset=4
    runtime_final_index=13
  if ((full_verify && runtime_status == 0)); then
    eidetic_runtime_run_step format-check 5 runtime_npm_run format:check ||
      runtime_status=$?
    if ((runtime_status == 0)); then
      eidetic_runtime_run_step lint 6 runtime_npm_run lint ||
        runtime_status=$?
    fi
    if ((runtime_status == 0)); then
      eidetic_runtime_run_step test-suite 7 runtime_npm_test ||
        runtime_status=$?
    fi
    if ((runtime_status == 0)); then
      eidetic_runtime_run_step test-posix 8 runtime_npm_run test:posix ||
        runtime_status=$?
    fi
    if ((runtime_status == 0)); then
      eidetic_runtime_run_step test-case-sensitive 9 \
        runtime_npm_run test:case-sensitive || runtime_status=$?
    fi
    runtime_build_offset=9
      runtime_final_index=18
  fi
  if ((runtime_status == 0)); then
    eidetic_runtime_run_protocol_child "$full_verify" runtime_build_linux ||
      runtime_status=$?
  fi
  if ((runtime_status == 0)); then
    eidetic_runtime_run_step verify-runtime "$runtime_final_index" \
      runtime_verify_artifacts || runtime_status=$?
  fi
  eidetic_runtime_finish
  if ((runtime_status != 0)); then
    EIDETIC_FAILURE_REASON="${EIDETIC_FAILURE_REASON:-Runtime substep failed. No release was activated.}"
    exit "$runtime_status"
  fi
else
  release_commit=staging
fi
eidetic_console_phase_done

if [[ "$EIDETIC_ROOT" == "/" && "$airplay_cache_hit" == 0 ]]; then
  install -d -m 0755 "$airplay_cache_root"
  airplay_cache_stage="$(mktemp -d -p "$airplay_cache_root" ".incoming-${EIDETIC_ARCH}.XXXXXX")"
  cp -a "$build_source/dist/airplay/." "$airplay_cache_stage/"
  chown -R root:root "$airplay_cache_stage"
  find "$airplay_cache_stage" -type d -exec chmod 0755 {} +
  chmod 0755 "$airplay_cache_stage/bin/shairport-sync" "$airplay_cache_stage/bin/nqptp"
  airplay_cache_valid "$airplay_cache_stage" ||
    eidetic_die "AirPlay integration cache verification failed"
  [[ ! -e "$airplay_cache" ]] ||
    eidetic_die "AirPlay integration cache changed during build"
  mv -T "$airplay_cache_stage" "$airplay_cache"
  airplay_cache_stage=
  airplay_cache_hit=1
fi

eidetic_console_phase_begin "Release staging and verification"
release_base="$(date -u +%Y%m%dT%H%M%SZ)-$release_commit"
release_id="$release_base"
release_counter=0
while [[ -e "$releases/$release_id" ]]; do
  release_counter=$((release_counter + 1))
  release_id="${release_base}-${release_counter}"
done

release_stage="$(mktemp -d -p "$releases" ".incoming-${release_id}.XXXXXX")"
backend_entry_rel="apps/backend/src/index.js"

install -d -m 0755 "$release_stage/bin"

if [[ "$EIDETIC_ROOT" == "/" ]]; then
  cp -a "$build_source/dist/backend" "$release_stage/backend"
  cp -a "$build_source/dist/remote-ui" "$release_stage/remote-ui"
  install -m 0644 "$build_source/dist/build-info.json" \
    "$release_stage/build-info.json"
  install -m 0755 "$shell_binary" "$release_stage/eidetic-player"
  cp -- "${neu_files[@]}" "$release_stage/"
  install -m 0644 "$build_source/neutralino.config.json" \
    "$release_stage/neutralino.config.json"

  # package.json rende i file compilati .js moduli ESM.
  cp "$build_source/package.json" "$release_stage/package.json"
  cp "$build_source/package-lock.json" "$release_stage/package-lock.json"
  install -d -m 0755 "$release_stage/deploy"
  cp -a "$SCRIPT_DIR" "$release_stage/deploy/linux"
  cp -a "$airplay_cache" "$release_stage/airplay"
  find "$release_stage/deploy/linux" -type d -name __pycache__ -prune \
    -exec rm -rf -- {} +
  find "$release_stage/deploy/linux" -type f \( -name '*.pyc' -o -name '*.pyo' \) \
    -delete

  # Installa nella release solamente le dipendenze necessarie in produzione.
  PATH="$node_release/bin:$PATH" "$node_release/bin/npm" ci \
    --prefix "$release_stage" \
    --omit=dev \
    --ignore-scripts \
    --no-audit \
    --no-fund
else
  # Fixture usata dai test dell'installer con una root isolata.
  install -d -m 0755 \
    "$release_stage/backend/$(dirname "$backend_entry_rel")"

  printf 'staging fixture\n' \
    >"$release_stage/backend/$backend_entry_rel"

  printf '#!/bin/sh\nexit 0\n' \
    >"$release_stage/eidetic-player"

  chmod 0755 "$release_stage/eidetic-player"

  printf '{"type":"module"}\n' \
    >"$release_stage/package.json"

  printf '%s\n' \
    '{"schemaVersion":1,"commitSha":"0000000000000000000000000000000000000000","shortCommitSha":"0000000","ref":"staging","packageVersion":"0.1.0","builtAt":"2026-01-01T00:00:00.000Z","source":"explicit"}' \
    >"$release_stage/build-info.json"

  printf '{"lockfileVersion":3}\n' \
    >"$release_stage/package-lock.json"

  printf '{}\n' \
    >"$release_stage/neutralino.config.json"

  printf 'staging fixture\n' \
    >"$release_stage/resources.neu"

  install -d -m 0755 "$release_stage/remote-ui/assets"

  printf '<!doctype html><html><body>Remote UI staging fixture</body></html>\n' \
    >"$release_stage/remote-ui/index.html"

  printf 'body { color: white; }\n' \
    >"$release_stage/remote-ui/assets/remote.css"

  printf 'export {};\n' \
    >"$release_stage/remote-ui/assets/remote.js"

  install -d -m 0755 \
    "$release_stage/node_modules/music-metadata"
  install -d -m 0755 "$release_stage/deploy/linux"
  cp -a "$SCRIPT_DIR/." "$release_stage/deploy/linux/"
  find "$release_stage/deploy/linux" -type d -name __pycache__ -prune -exec rm -rf -- {} +
  find "$release_stage/deploy/linux" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
  install -d -m 0755 \
    "$release_stage/airplay/bin" \
    "$release_stage/airplay/share/eidetic-player-airplay"
  printf '#!/bin/sh\nexit 0\n' >"$release_stage/airplay/bin/shairport-sync"
  printf '#!/bin/sh\nexit 0\n' >"$release_stage/airplay/bin/nqptp"
  chmod 0755 \
    "$release_stage/airplay/bin/shairport-sync" \
    "$release_stage/airplay/bin/nqptp"
  airplay_fixture_shairport_sha="$(sha256sum \
    "$release_stage/airplay/bin/shairport-sync" | cut -d' ' -f1)"
  airplay_fixture_nqptp_sha="$(sha256sum \
    "$release_stage/airplay/bin/nqptp" | cut -d' ' -f1)"
  for fixture_sha in \
    "$airplay_fixture_shairport_sha" "$airplay_fixture_nqptp_sha"; do
    [[ "$fixture_sha" =~ ^[0-9a-f]{64}$ ]] ||
      eidetic_die "test AirPlay fixture hash generation failed"
  done
  install -m 0644 "$SCRIPT_DIR/airplay/sources.json" \
    "$release_stage/airplay/share/eidetic-player-airplay/sources.json"
  printf \
    '{"schemaVersion":1,"integrationVersion":"%s","architecture":"fixture","compiler":"fixture","binaries":{"shairport-sync":"%s","nqptp":"%s"}}\n' \
    "$airplay_integration_version" \
    "$airplay_fixture_shairport_sha" "$airplay_fixture_nqptp_sha" \
    >"$release_stage/airplay/artifact.json"
fi

install -m 0755 "$SCRIPT_DIR/runtime/eidetic-player-launch" \
  "$release_stage/bin/eidetic-player-launch"

if [[ ! -f "$release_stage/backend/$backend_entry_rel" ]]; then
  eidetic_log "Backend release contents:"
  find "$release_stage/backend" -maxdepth 8 -type f \
    -printf '  %m %p\n' >&2 || true

  eidetic_die \
    "release verification failed: backend entrypoint missing: backend/$backend_entry_rel"
fi

[[ -x "$release_stage/eidetic-player" ]] ||
  eidetic_die \
    "release verification failed: Neutralino executable is missing or not executable"

[[ -x "$release_stage/bin/eidetic-player-launch" ]] ||
  eidetic_die \
    "release verification failed: launcher is missing or not executable"

[[ -f "$release_stage/package.json" ]] ||
  eidetic_die \
    "release verification failed: package.json is missing"

[[ -d "$release_stage/node_modules/music-metadata" ]] ||
  eidetic_die \
    "release verification failed: production dependency music-metadata is missing"

[[ -x "$release_stage/airplay/bin/shairport-sync" &&
  -x "$release_stage/airplay/bin/nqptp" &&
  -f "$release_stage/airplay/artifact.json" ]] ||
  eidetic_die \
    "release verification failed: AirPlay integration artifact is incomplete"

if [[ "${EUID}" -eq 0 ]]; then
  chown -R root:root "$release_stage"
fi
chmod 0755 "$release_stage"

if [[ "$EIDETIC_ROOT" == "/" ]]; then
  release_verifier_node="$node_release/bin/node"
  release_verifier_cli="$build_source/node_modules/tsx/dist/cli.mjs"
  release_verifier_script="$build_source/scripts/verify-linux-release.ts"
  release_verifier_args=(--root "$release_stage" --arch "$neutralino_arch"
    --phase staged --source-root "$build_source" --expected-owner 0)
else
  release_verifier_node="$(command -v node || true)"
  release_verifier_cli="$SCRIPT_DIR/../../node_modules/tsx/dist/cli.mjs"
  release_verifier_script="$SCRIPT_DIR/../../scripts/verify-linux-release.ts"
  release_verifier_args=(--root "$release_stage" --arch "$EIDETIC_ARCH"
    --phase staged)
fi
if [[ -n "$release_verifier_node" ]]; then
  if ! "$release_verifier_node" "$release_verifier_cli" \
    "$release_verifier_script" "${release_verifier_args[@]}"; then
    eidetic_die "Installation verification failed: Linux release contract. No release was activated."
  fi
elif [[ "$EIDETIC_ROOT" != "/" ]]; then
  eidetic_log "Staging note: TypeScript release verifier is unavailable in this shell; structural release checks passed and Linux CI remains authoritative."
else
  eidetic_die "Node.js is unavailable for release verification. No release was activated."
fi
eidetic_console_phase_done

if ((machine_bootstrap_required)); then
eidetic_console_phase_begin "System integration"
conf="$tmp/install.conf"
power_policy="$tmp/eidetic-player-power.polkit.rules"
update_policy="$tmp/eidetic-player-update.polkit.rules"
update_unit="$tmp/eidetic-player-update.service"
update_conf="$tmp/update.conf"
power_policy_placeholder=__EIDETIC_RUNTIME_USER__
[[ "$(grep -Foc "$power_policy_placeholder" \
  "$SCRIPT_DIR/templates/eidetic-player-power.polkit.rules")" == 1 ]] ||
  eidetic_die "Power policy template must contain exactly one runtime-user placeholder"
sed "s/$power_policy_placeholder/$runtime_user/" \
  "$SCRIPT_DIR/templates/eidetic-player-power.polkit.rules" >"$power_policy"
sed "s/$power_policy_placeholder/$runtime_user/" \
  "$SCRIPT_DIR/templates/eidetic-player-update.polkit.rules" >"$update_policy"
sed "s/$power_policy_placeholder/$runtime_user/" \
  "$SCRIPT_DIR/templates/eidetic-player-update.service" >"$update_unit"
if grep -Fq "$power_policy_placeholder" \
  "$power_policy" "$update_policy" "$update_unit"; then
  eidetic_die "Power policy runtime-user placeholder was not replaced"
fi
cat >"$conf" <<EOF
EIDETIC_INSTALL_PROFILE=raspios-lite
EIDETIC_LITE_INTEGRATION_SCHEMA=$lite_integration_schema
EIDETIC_INSTALLATION_MODE=appliance
EIDETIC_FULLSCREEN=$([[ "${choice[fullscreen]}" == yes ]] && printf 1 || printf 0)
EIDETIC_BORDERLESS=$borderless_value
EIDETIC_HIDE_POINTER=$([[ "${choice[pointer]}" == yes ]] && printf 1 || printf 0)
EIDETIC_DISABLE_BLANKING=$([[ "${choice[blanking]}" == yes ]] && printf 1 || printf 0)
EIDETIC_AUTOSTART=$([[ "${choice[autostart]}" == yes ]] && printf 1 || printf 0)
EIDETIC_SPLASH=$([[ "${choice[splash]}" == yes ]] && printf 1 || printf 0)
EIDETIC_AUTOLOGIN=$([[ "${choice[autologin]}" == yes ]] && printf 1 || printf 0)
EIDETIC_RUNTIME_USER=$runtime_user
EIDETIC_GIT_REF=$git_ref
EIDETIC_RPI_ONSCREEN_KEYBOARD=$rpi_keyboard
EIDETIC_GPIO_I2S_DAC=$gpio_i2s_dac
BACKEND_HOST=$backend_host
BACKEND_PORT=$backend_port
EIDETIC_TERMINAL=/usr/bin/false
EIDETIC_MPV_PATH=/usr/bin/mpv
NODE_ENV=production
PATH=/opt/eidetic-player/node/current/bin:/usr/local/bin:/usr/bin:/bin
EOF
eidetic_install_managed "$conf" /etc/eidetic-player/install.conf 0644
airplay_store_dir="$(eidetic_target "$EIDETIC_RUNTIME_HOME/.config/eidetic-player")"
airplay_store="$airplay_store_dir/airplay.json"
install -d -m 0700 -o "$runtime_user" -g "$EIDETIC_RUNTIME_GID" "$airplay_store_dir"
[[ ! -L "$airplay_store" ]] ||
  eidetic_die "AirPlay settings path must not be a symbolic link"
if [[ ! -e "$airplay_store" ]]; then
  python3 - "$tmp/airplay.json" "$airplay_integration_version" <<'PY'
import datetime
import json
import secrets
import sys

suffix = secrets.token_hex(2).upper()
document = {
    "schemaVersion": 2,
    "revision": 0,
    "enabled": True,
    "receiverName": f"Eidetic Player - {suffix}",
    "receiverNameOrigin": "generated",
    "audioBufferSeconds": 2,
    "generatedSuffix": suffix,
    "integrationVersion": sys.argv[2],
    "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
}
with open(sys.argv[1], "x", encoding="utf-8") as target:
    json.dump(document, target, indent=2)
    target.write("\n")
PY
  install -m 0600 -o "$runtime_user" -g "$EIDETIC_RUNTIME_GID" \
    "$tmp/airplay.json" "$airplay_store"
fi
installed_update_conf="$(eidetic_target /etc/eidetic-player/update.conf)"
if [[ -f "$installed_update_conf" && ! -L "$installed_update_conf" ]] &&
  grep -Eq '^EIDETIC_UPDATE_BRANCH=[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$' \
    "$installed_update_conf"; then
  cp "$installed_update_conf" "$update_conf"
else
  update_default_branch=main
  if [[ "$EIDETIC_ROOT" == "/" && -z "$resolved_commit" &&
    -r "$build_source/.git/FETCH_HEAD" ]] &&
    grep -Fq "branch '$git_ref' of $SOURCE_REMOTE" \
      "$build_source/.git/FETCH_HEAD"; then
    update_default_branch="$git_ref"
  fi
  printf 'EIDETIC_UPDATE_CONFIG_SCHEMA=1\nEIDETIC_UPDATE_BRANCH=%s\nEIDETIC_UPDATE_REMOTE=%s\n' \
    "$update_default_branch" "$EIDETIC_SOURCE_REMOTE" >"$update_conf"
fi
[[ ! -L "$installed_update_conf" ]] ||
  eidetic_die "Software Update config path must not be a symbolic link"
update_conf_dir="$(dirname "$installed_update_conf")"
install -d -m 0755 "$update_conf_dir"
update_conf_stage="$(mktemp "$update_conf_dir/.update.conf.XXXXXX")"
install -m 0644 "$update_conf" "$update_conf_stage"
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  chown root:root "$update_conf_stage"
fi
mv -Tf "$update_conf_stage" "$installed_update_conf"
update_conf_stage=
eidetic_install_managed "$SCRIPT_DIR/templates/eidetic-player.service" /etc/systemd/user/eidetic-player.service 0644
eidetic_install_managed "$SCRIPT_DIR/airplay/templates/eidetic-player-airplay.service" /etc/systemd/user/eidetic-player-airplay.service 0644
eidetic_install_managed "$SCRIPT_DIR/airplay/templates/eidetic-player-nqptp.service" /etc/systemd/system/eidetic-player-nqptp.service 0644
airplay_user_manager_drop_in="/etc/systemd/system/user@${EIDETIC_RUNTIME_UID}.service.d/50-eidetic-player-airplay-realtime.conf"
eidetic_install_managed "$SCRIPT_DIR/airplay/templates/eidetic-player-airplay-user-manager.conf" "$airplay_user_manager_drop_in" 0644
eidetic_install_managed "$SCRIPT_DIR/airplay/eidetic-player-airplay-hook" /usr/libexec/eidetic-player-airplay-hook 0755
for command in eidetic-player eidetic-player-maintenance eidetic-player-resume; do
  eidetic_install_managed "$SCRIPT_DIR/runtime/$command" "/usr/local/bin/$command" 0755
done
eidetic_install_managed "$SCRIPT_DIR/runtime/eidetic-player-smb-helper" /usr/libexec/eidetic-player-smb-helper 0755
eidetic_install_managed "$SCRIPT_DIR/templates/eidetic-player-smb.polkit.rules" /etc/polkit-1/rules.d/49-eidetic-player-smb.rules 0644
eidetic_install_managed "$SCRIPT_DIR/runtime/eidetic-player-power-helper" /usr/libexec/eidetic-player-power-helper 0755
eidetic_install_managed "$power_policy" /etc/polkit-1/rules.d/49-eidetic-player-power.rules 0644
if [[ "$mode" == appliance ]]; then
  eidetic_install_managed "$update_unit" /etc/systemd/system/eidetic-player-update.service 0644
  eidetic_install_managed "$SCRIPT_DIR/runtime/eidetic-player-update-helper" /usr/libexec/eidetic-player-update-helper 0755
  eidetic_install_managed "$SCRIPT_DIR/runtime/eidetic-player-update-runner" /usr/libexec/eidetic-player-update-runner 0755
  eidetic_install_managed "$SCRIPT_DIR/lib/eidetic-player-update-journal.mjs" /usr/libexec/eidetic-player-update-journal.mjs 0755
  eidetic_install_managed "$update_policy" /etc/polkit-1/rules.d/49-eidetic-player-update.rules 0644
  update_state="$(eidetic_target /var/lib/eidetic-player/update)"
  update_state_parent="$(dirname "$update_state")"
  if [[ "$EIDETIC_ROOT" == "/" ]]; then
    install -d -m 0710 -o root -g "$runtime_user" "$update_state_parent"
    install -d -m 2750 -o root -g "$runtime_user" \
      "$update_state" "$update_state/history"
  else
    install -d -m 0710 "$update_state_parent"
    install -d -m 2750 "$update_state" "$update_state/history"
  fi
fi

pkexec_target="$(eidetic_target /usr/bin/pkexec)"
power_helper_target="$(eidetic_target /usr/libexec/eidetic-player-power-helper)"
power_policy_target="$(eidetic_target /etc/polkit-1/rules.d/49-eidetic-player-power.rules)"
[[ -x "$pkexec_target" ]] ||
  eidetic_die "Power integration verification failed: /usr/bin/pkexec is unavailable. No release was activated."
[[ -x "$power_helper_target" && ! -L "$power_helper_target" ]] ||
  eidetic_die "Power integration verification failed: helper is unavailable. No release was activated."
[[ "$(stat -c '%a' "$power_helper_target")" == 755 ]] ||
  eidetic_die "Power integration verification failed: helper mode is not 0755. No release was activated."
[[ -r "$power_policy_target" && ! -L "$power_policy_target" ]] ||
  eidetic_die "Power integration verification failed: Polkit rule is unavailable. No release was activated."
[[ "$(stat -c '%a' "$power_policy_target")" == 644 ]] ||
  eidetic_die "Power integration verification failed: Polkit rule mode is not 0644. No release was activated."
if grep -Fq "$power_policy_placeholder" "$power_policy_target"; then
  eidetic_die "Power integration verification failed: Polkit placeholder remains. No release was activated."
fi
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  [[ "$(stat -c '%u:%g' "$power_helper_target")" == 0:0 ]] ||
    eidetic_die "Power integration verification failed: helper is not root-owned. No release was activated."
  "$power_helper_target" probe </dev/null ||
    eidetic_die "Power integration verification failed: helper probe failed. No release was activated."
fi
eidetic_console_phase_done

eidetic_console_phase_begin "Graphical session"
getty_dropin="$tmp/90-eidetic-player-autologin.conf"
session_profile="$tmp/eidetic-player-session.sh"
sed "s/__EIDETIC_RUNTIME_USER__/$runtime_user/g" "$SCRIPT_DIR/templates/eidetic-player-getty-autologin.conf" >"$getty_dropin"
sed "s/__EIDETIC_RUNTIME_USER__/$runtime_user/g" "$SCRIPT_DIR/templates/eidetic-player-session-profile.sh" >"$session_profile"
if grep -Fq __EIDETIC_RUNTIME_USER__ "$getty_dropin" "$session_profile"; then eidetic_die "graphical session runtime-user placeholder remains"; fi
eidetic_install_managed "$getty_dropin" /etc/systemd/system/getty@tty1.service.d/90-eidetic-player-autologin.conf 0644
eidetic_install_managed "$session_profile" /etc/profile.d/eidetic-player-session.sh 0644
eidetic_install_managed "$SCRIPT_DIR/templates/eidetic-graphical-session.target" /etc/systemd/user/eidetic-graphical-session.target 0644
eidetic_install_managed "$SCRIPT_DIR/templates/eidetic-labwc.service" /etc/systemd/user/eidetic-labwc.service 0644
eidetic_install_managed "$SCRIPT_DIR/templates/eidetic-player-lite-graphical.conf" /etc/systemd/user/eidetic-player.service.d/50-eidetic-lite-graphical.conf 0644
eidetic_install_managed "$SCRIPT_DIR/templates/labwc-rc.xml" /etc/eidetic-player/labwc/rc.xml 0644
eidetic_install_managed "$SCRIPT_DIR/runtime/eidetic-player-session" /usr/local/bin/eidetic-player-session 0755
eidetic_install_managed "$SCRIPT_DIR/runtime/eidetic-player-graphical-launch" /usr/libexec/eidetic-player-graphical-launch 0755
if [[ "$EIDETIC_ROOT" != "/" &&
  "${EIDETIC_LITE_FIXTURE_FAIL_AFTER_GRAPHICAL_FILES:-0}" == 1 ]]; then
  eidetic_die "fixture interruption after graphical files"
fi
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  systemctl daemon-reload
  systemctl --global enable eidetic-graphical-session.target
  if [[ "$graphical_target_link_preexisting" == 0 &&
    -L "$graphical_target_link" ]]; then
    graphical_target_link_created=1
  fi
else
  install -d -m 0755 "$(eidetic_target /etc/systemd/user/default.target.wants)"
  if [[ ! -e "$graphical_target_link" && ! -L "$graphical_target_link" ]]; then
    ln -s ../eidetic-graphical-session.target "$graphical_target_link"
    graphical_target_link_created=1
  fi
fi
eidetic_console_phase_done

if [[ "$EIDETIC_ROOT" == "/" ]]; then
  eidetic_console_phase_begin "System integration activation"
  if systemctl is-active --quiet shairport-sync.service 2>/dev/null; then
    eidetic_die "AirPlay activation conflict: an unmanaged system Shairport service is active"
  fi
  if /usr/sbin/runuser -u "$runtime_user" -- systemctl --user is-active \
    --quiet shairport-sync.service 2>/dev/null; then
    eidetic_die "AirPlay activation conflict: an unmanaged user Shairport service is active"
  fi
  if command -v ss >/dev/null &&
    ss -H -lun 'sport = :319 or sport = :320' 2>/dev/null | grep -q . &&
    ! systemctl is-active --quiet eidetic-player-nqptp.service 2>/dev/null; then
    eidetic_die "AirPlay activation conflict: UDP timing ports 319/320 are already in use"
  fi
  getent group eidetic-player-network >/dev/null || groupadd --system eidetic-player-network
  usermod -a -G eidetic-player-network "$runtime_user"
  "$SCRIPT_DIR/network/install-network-integration.sh" \
    --user "$runtime_user" --group eidetic-player-network \
    --install-dir /opt/eidetic-player/current
  systemctl daemon-reload
  loginctl enable-linger "$runtime_user" >/dev/null
  airplay_user_manager_pid="$(systemctl show "user@${EIDETIC_RUNTIME_UID}.service" \
    --property MainPID --value 2>/dev/null || true)"
  if [[ "$airplay_user_manager_pid" =~ ^[1-9][0-9]*$ ]] &&
    command -v prlimit >/dev/null 2>&1; then
    if ! prlimit --pid "$airplay_user_manager_pid" --rtprio=5:5; then
      eidetic_console_warning \
        "AirPlay realtime scheduling will become available after the next reboot."
    fi
  else
    eidetic_console_warning \
      "AirPlay realtime scheduling will become available after the next reboot."
  fi
else
  eidetic_console_phase_begin "System integration activation"
fi
if false; then
  keyboard_attempt_state="$(eidetic_get_rpi_keyboard_state)"
  keyboard_state_file="$(eidetic_target /var/lib/eidetic-player/rpi-onscreen-keyboard-v1)"
  if [[ ! -e "$keyboard_state_file" ]]; then
    install -d -m 0750 "$(dirname "$keyboard_state_file")"
    printf '%s\n' "$keyboard_attempt_state" >"$tmp/rpi-onscreen-keyboard-v1"
    install -m 0600 "$tmp/rpi-onscreen-keyboard-v1" "$keyboard_state_file"
  fi
  if [[ "$keyboard_attempt_state" != always-off ]]; then
    keyboard_changed=1
  fi
  eidetic_set_rpi_keyboard_state always-off ||
    eidetic_die "failed to disable the Raspberry Pi OS on-screen keyboard; use raspi-config Display Options > D6 manually"
  [[ "$(eidetic_get_rpi_keyboard_state)" == always-off ]] ||
    eidetic_die "Raspberry Pi OS on-screen keyboard verification failed"
fi
if ((gpio_i2s_dac)); then
  gpio_dac_args=(apply --root "$EIDETIC_ROOT" --session "$gpio_dac_session")
  [[ "$EIDETIC_DISTRO" != raspios ]] || gpio_dac_args+=(--raspberry)
  gpio_i2s_dac_state="$(python3 "$gpio_dac_helper" "${gpio_dac_args[@]}")" ||
    eidetic_die "GPIO/I2S DAC configuration failed safely"
  if [[ "$gpio_i2s_dac_state" == added ]]; then
    gpio_dac_changed=1
    eidetic_log "GPIO/I2S DAC: managed i2s-dac block added; reboot required."
  else
    eidetic_log "GPIO/I2S DAC: $gpio_i2s_dac_state; boot configuration unchanged."
  fi
fi
eidetic_console_phase_done
python3 "$machine_helper" commit --root "$EIDETIC_ROOT" --before "$machine_before" --runtime-user "$runtime_user" --installer-version "$installer_version" --os-id "${ID:-raspbian}" --os-version "${VERSION_ID:-13}" --os-codename "${VERSION_CODENAME:-trixie}" --architecture "$EIDETIC_ARCH" --compatible "${EIDETIC_RPI_COMPATIBLE:-unknown}" --network-class "$EIDETIC_NETWORK_CLASS" --airplay-version "$airplay_integration_version" --packages-pre-existing "$packages_pre_existing" --packages-installed "$packages_installed" --package-versions "$package_versions" || eidetic_die "machine ownership manifest commit failed"
python3 "$machine_helper" validate --root "$EIDETIC_ROOT" || eidetic_die "machine ownership manifest verification failed"
else
  eidetic_console_phase_begin "System integration"
  eidetic_console_info "Existing Lite machine integration schema $lite_integration_schema preserved."
  eidetic_console_phase_done
fi
eidetic_console_phase_begin "Release activation"
if [[ "${EIDETIC_UPDATE_JOB_FD:-}" =~ ^[3-9][0-9]*$ ]]; then
  printf 'EIDETIC_PROGRESS_V1\tupdate\tactivation-imminent\t5\t7\tApplying update\n' \
    >&"$EIDETIC_UPDATE_JOB_FD"
  renice -n 0 -p "$$" "$PPID" >/dev/null 2>&1 || true
  if command -v ionice >/dev/null 2>&1; then
    ionice -c 2 -n 4 -p "$$" "$PPID" >/dev/null 2>&1 || true
  fi
fi
eidetic_activate_release "$release_stage" "$releases" "$release_id" "$opt"
release_stage=
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  if ! systemctl enable --now eidetic-player-nqptp.service; then
    eidetic_console_warning \
      "AirPlay timing did not start after activation; Eidetic Player remains installed and AirPlay will report Error."
  fi
fi
if [[ "$gpio_dac_changed" == 1 ]]; then
  python3 "$gpio_dac_helper" commit --root "$EIDETIC_ROOT" \
    --session "$gpio_dac_session" >/dev/null ||
    eidetic_die "GPIO/I2S DAC transaction commit failed"
fi
install_committed=1
eidetic_console_phase_done

eidetic_console_phase_begin "Finalization"
eidetic_log "Installed release $release_id atomically."
eidetic_log "Application data under the runtime user's XDG directories was not modified."
eidetic_console_phase_done

eidetic_console_section "Installation completed successfully."
eidetic_console_info "  Profile              raspios-lite"
eidetic_console_info "  Mode                 Appliance"
eidetic_console_info "  Runtime user         $runtime_user"
eidetic_console_info "  Install path         /opt/eidetic-player"
eidetic_console_info "  Graphical session    tty1 / Wayland / labwc"
eidetic_console_info "  GPIO/I2S DAC         $gpio_dac_plan"
eidetic_console_info "  AirPlay receiver     $airplay_plan"
eidetic_console_info "  Application data     Preserved"
if [[ -n "${EIDETIC_RUNTIME_ELAPSED_MS:-}" ]]; then eidetic_console_info "  Runtime preparation  $(eidetic_console_duration "$EIDETIC_RUNTIME_ELAPSED_MS")"; fi
eidetic_console_info "  Total duration       $(eidetic_console_duration "$(eidetic_console_total_elapsed_ms)")"
eidetic_console_info "  Log                  $EIDETIC_LOG_PATH"
eidetic_console_info "  Diagnostics          eidetic-player-doctor"
eidetic_console_warning_summary
if [[ "$EIDETIC_ROOT" == "/" ]]; then eidetic_log "Installation completed. A reboot is required to start Eidetic Player."; else eidetic_log "Staging installation completed; reboot is not applicable."; fi
