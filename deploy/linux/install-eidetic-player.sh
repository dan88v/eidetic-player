#!/usr/bin/env bash
set -euo pipefail
umask 022
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

runtime_user="${SUDO_USER:-}"
git_ref=main
resolved_commit=
mode=standard
dry_run=0
unattended=0
guided=1
full_verify=0
EIDETIC_ROOT=/
rpi_keyboard=keep
rpi_keyboard_explicit=0
gpio_i2s_dac=0
gpio_i2s_dac_explicit=0
gpio_i2s_dac_state=not-requested
SOURCE_REMOTE="$EIDETIC_SOURCE_REMOTE"
declare -A choice=()

usage() {
  cat <<'EOF'
Usage: sudo ./deploy/linux/install-eidetic-player.sh [options]

Without technical options, the installer starts the guided procedure.

Modes:
  Standard                    Desktop application with manual launch
  Appliance                   Fullscreen-capable player with optional autostart

Common options:
  -v, --verbose               Show sanitized commands and live process output
  --no-color                  Disable terminal colors
  -h, --help                  Show this help
  --version                   Show installer provenance

Automation and technical options:
  --user USER                 Existing non-root runtime user
  --ref REF                   Git ref to install (default: main)
  --resolved-commit SHA       Pin the fetched ref to an already resolved commit
  --mode standard|appliance   Installation mode
  --dry-run                   Validate and print the plan only
  --unattended                Never prompt
  --full-verify               Also run the complete application verification suite
  --root PATH                 Use an isolated staging root
  --autostart yes|no          Appliance choice
  --fullscreen yes|no         Appliance choice
  --borderless yes|no         Appliance choice
  --disable-blanking yes|no   Appliance choice
  --hide-pointer yes|no       Appliance choice
  --splash yes|no             Appliance choice
  --autologin yes|no          Appliance choice
  --rpi-onscreen-keyboard keep|disable
  --gpio-i2s-dac              Configure a generic GPIO/I2S DAC (opt-in)

Examples:
  sudo ./deploy/linux/install-eidetic-player.sh
  sudo ./deploy/linux/install-eidetic-player.sh -v
  sudo ./deploy/linux/install-eidetic-player.sh --no-color
  sudo ./deploy/linux/install-eidetic-player.sh --user player --mode standard --unattended

Uninstall preserves application data by default. Its guided data removal
requires a separate DELETE confirmation.
EOF
}

set_choice() {
  [[ "$2" == "yes" || "$2" == "no" ]] || eidetic_die "$1 expects yes or no"
  choice["$1"]="$2"
}
while (($#)); do
  case "$1" in
    -v | --verbose) EIDETIC_CONSOLE_VERBOSE=1; shift ;;
    --no-color) export EIDETIC_CONSOLE_NO_COLOR=1; shift ;;
    --user) [[ $# -ge 2 ]] || eidetic_die "--user needs a value"; runtime_user="$2"; shift 2;;
    --ref) [[ $# -ge 2 ]] || eidetic_die "--ref needs a value"; git_ref="$2"; shift 2;;
    --resolved-commit)
      [[ $# -ge 2 ]] || eidetic_die "--resolved-commit needs a value"
      resolved_commit="$2"
      shift 2
      ;;
    --mode) guided=0; [[ $# -ge 2 ]] || eidetic_die "--mode needs a value"; mode="$2"; shift 2;;
    --root) [[ $# -ge 2 ]] || eidetic_die "--root needs a value"; EIDETIC_ROOT="$2"; shift 2;;
    --dry-run) guided=0; dry_run=1; shift;;
    --unattended) guided=0; unattended=1; shift;;
    --full-verify) full_verify=1; shift;;
    --autostart) guided=0; set_choice autostart "${2:-}"; shift 2;;
    --fullscreen) guided=0; set_choice fullscreen "${2:-}"; shift 2;;
    --borderless) guided=0; set_choice borderless "${2:-}"; shift 2;;
    --disable-blanking) guided=0; set_choice blanking "${2:-}"; shift 2;;
    --hide-pointer) guided=0; set_choice pointer "${2:-}"; shift 2;;
    --splash) guided=0; set_choice splash "${2:-}"; shift 2;;
    --autologin) guided=0; set_choice autologin "${2:-}"; shift 2;;
    --rpi-onscreen-keyboard)
      guided=0
      [[ $# -ge 2 ]] || eidetic_die "--rpi-onscreen-keyboard needs a value"
      rpi_keyboard="$2"
      rpi_keyboard_explicit=1
      shift 2
      ;;
    --gpio-i2s-dac)
      guided=0
      gpio_i2s_dac=1
      gpio_i2s_dac_explicit=1
      shift
      ;;
    -h | --help) usage; exit 0;;
    --version)
      printf 'eidetic-player-linux-installer %s\n' "$(eidetic_project_version)"
      exit 0
      ;;
    *) eidetic_die "unknown option: $1";;
  esac
done

install_question_prompt() {
  case "$1" in
    borderless)
      printf '%s' 'Run Eidetic Player without window borders?'
      ;;
    *)
      printf '%s?' "$1"
      ;;
  esac
}

if ((unattended)); then export EIDETIC_CONSOLE_FORCE_NON_TTY=1; fi
installer_version="$(eidetic_project_version)"
if [[ -n "${EIDETIC_EMBEDDED_PARENT:-}" ]]; then
  ((unattended)) || {
    printf 'Error: embedded installer mode requires --unattended.\n' >&2
    exit 64
  }
  eidetic_console_init_embedded "$EIDETIC_EMBEDDED_PARENT" || {
    printf 'Error: invalid embedded installer channel.\n' >&2
    exit 64
  }
else
  eidetic_console_init install "Linux Installer" "$EIDETIC_ROOT" "$installer_version" ||
    exit 1
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
      eidetic_console_failure_panel "INSTALLATION FAILED" \
        "${EIDETIC_FAILURE_REASON:-The current operation did not complete.}" \
        "$status" "not required"
    fi
  fi
  eidetic_console_finalize
  return "$status"
}
trap 'early_exit "$?"' EXIT
trap 'installation_cancelled=1; exit 130' INT
trap 'installation_cancelled=1; exit 143' TERM

if ((guided)) && { [[ ! -t 0 || ! -t 1 ]] &&
  [[ "${EIDETIC_CONSOLE_FORCE_TTY:-0}" != 1 ]]; }; then
  EIDETIC_FAILURE_REASON="Guided installation requires an interactive terminal. Use --unattended with explicit technical choices."
  usage >&3
  exit 64
fi

[[ "$mode" == "standard" || "$mode" == "appliance" ]] ||
  eidetic_die "--mode must be standard or appliance"
[[ "$rpi_keyboard" == keep || "$rpi_keyboard" == disable ]] ||
  eidetic_die "--rpi-onscreen-keyboard must be keep or disable"
[[ -n "$runtime_user" ]] || eidetic_die "--user is required when SUDO_USER is unavailable"
eidetic_validate_user "$runtime_user"
eidetic_load_runtime_identity "$runtime_user"
eidetic_validate_ref "$git_ref"
if [[ -n "$resolved_commit" ]] &&
  ! [[ "$resolved_commit" =~ ^[0-9a-f]{40}$ ]]; then
  eidetic_die "--resolved-commit must be an exact lowercase commit SHA"
fi
if [[ "$EIDETIC_ROOT" != "/" ]]; then eidetic_validate_root "$EIDETIC_ROOT"; fi
export EIDETIC_ROOT
eidetic_require_root
checkout="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
preflight_world_write=yes
[[ "$EIDETIC_ROOT" == "/" ]] || preflight_world_write=no
export EIDETIC_CONSOLE_PHASE_TOTAL=$((dry_run ? 2 : 9))
eidetic_console_phase_begin "Preflight"
eidetic_preflight_checkout \
  "$runtime_user" "$checkout" "$preflight_world_write"
eidetic_console_phase_done
eidetic_console_phase_begin "System detection"
eidetic_detect_platform
backend_host="${BACKEND_HOST:-127.0.0.1}"
backend_port="${BACKEND_PORT:-4310}"
if ! [[ "$backend_port" =~ ^[0-9]+$ ]] || ((backend_port < 1 || backend_port > 65535)); then
  eidetic_die "Invalid BACKEND_PORT=${backend_port}; must be an integer 1-65535."
fi
if [[ "$backend_host" != "127.0.0.1" && "$backend_host" != "localhost" ]]; then
  eidetic_die "Invalid BACKEND_HOST=${backend_host}; only loopback is supported."
fi
eidetic_console_phase_done

eidetic_console_section "Detected system"
eidetic_console_info "  OS                   ${PRETTY_NAME:-${ID:-unknown}}"
eidetic_console_info "  Architecture         $EIDETIC_ARCH"
eidetic_console_info "  Desktop              $EIDETIC_DESKTOP"
eidetic_console_info "  Raspberry Pi         ${EIDETIC_RPI_COMPATIBLE:-none}"

if ((guided)); then
  eidetic_console_section "Choose installation mode"
  eidetic_console_info "  1. Standard"
  eidetic_console_info "     Desktop integration with manual launch."
  eidetic_console_info "  2. Appliance"
  eidetic_console_info "     Fullscreen player with optional automatic startup."
  eidetic_prompt_choice "Select mode" 1 2 1 ||
    eidetic_die "installation mode input ended unexpectedly"
  [[ "$EIDETIC_PROMPT_RESULT" == 1 ]] && mode=standard || mode=appliance
fi

questions=(autostart fullscreen borderless blanking pointer splash autologin)
if [[ "$mode" == "standard" ]]; then
  for key in "${questions[@]}"; do
    choice["$key"]=no
  done

else
  for key in "${questions[@]}"; do
    if [[ -z "${choice[$key]:-}" ]]; then
      if ((unattended)); then eidetic_die "--unattended appliance installs require every appliance choice flag"; fi
      [[ -t 0 ]] || eidetic_die "appliance choices require a terminal or explicit flags"
      eidetic_prompt_yes_no "$(install_question_prompt "$key")" no ||
        eidetic_die "appliance choice input ended unexpectedly"
      choice["$key"]="$EIDETIC_PROMPT_RESULT"
    fi
  done
fi
borderless_value=$(
  [[ "${choice[borderless]}" == yes ]] && printf 1 || printf 0
)
if [[ "$EIDETIC_DISTRO" == raspios && "$unattended" == 0 &&
  "$rpi_keyboard_explicit" == 0 ]]; then
  [[ -t 0 ]] ||
    eidetic_die "Raspberry Pi OS keyboard choice requires a terminal or --rpi-onscreen-keyboard"
  eidetic_prompt_yes_no \
    "Disable the Raspberry Pi OS on-screen keyboard and use Eidetic Player's keyboard instead?" no ||
    eidetic_die "Raspberry Pi OS keyboard choice input ended unexpectedly"
  [[ "$EIDETIC_PROMPT_RESULT" == yes ]] &&
    rpi_keyboard=disable || rpi_keyboard=keep
fi
if [[ "$EIDETIC_DISTRO" != raspios && "$rpi_keyboard" == disable ]]; then
  eidetic_die "--rpi-onscreen-keyboard disable is supported only on Raspberry Pi OS"
fi
if [[ "$rpi_keyboard" == disable ]]; then
  eidetic_require_rpi_keyboard_support
fi
if [[ "$EIDETIC_DISTRO" == raspios && "$unattended" == 0 &&
  "$gpio_i2s_dac_explicit" == 0 ]]; then
  [[ -t 0 ]] ||
    eidetic_die "GPIO/I2S DAC choice requires a terminal or --gpio-i2s-dac"
  eidetic_prompt_yes_no \
    "Configure a generic GPIO/I2S DAC (PCM5102A-compatible)?" no ||
    eidetic_die "GPIO/I2S DAC choice input ended unexpectedly"
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

packages=(ca-certificates curl git build-essential python3 pkg-config mpv ffmpeg
  network-manager dbus polkitd pkexec udisks2 cifs-utils xterm)
if [[ "$EIDETIC_DISTRO" == "raspios" ]]; then
  packages+=(libgtk-3-0t64 libwebkit2gtk-4.1-0)
else
  packages+=(libgtk-3-0t64 libwebkit2gtk-4.1-0)
fi
[[ "${choice[splash]}" == yes ]] && packages+=(plymouth)
eidetic_console_plain_log \
  "Target: $EIDETIC_DISTRO $EIDETIC_ARCH; user=$runtime_user; mode=$mode; ref=$git_ref"
eidetic_console_plain_log "APT plan: ${packages[*]}"
if ((full_verify)); then
  eidetic_console_plain_log "Verification profile: full"
  ((dry_run)) && eidetic_console_info "Verification profile: full"
else
  eidetic_console_plain_log "Verification profile: install-safe"
  ((dry_run)) && eidetic_console_info "Verification profile: install-safe"
fi
eidetic_console_plain_log "Raspberry Pi OS on-screen keyboard: $rpi_keyboard"
eidetic_console_plain_log "GPIO/I2S DAC: $gpio_dac_plan"
for key in "${questions[@]}"; do
  eidetic_console_plain_log "  $key=${choice[$key]}"
done

eidetic_console_section "Installation summary"
eidetic_console_info "  System               ${PRETTY_NAME:-${ID:-unknown}}"
eidetic_console_info "  Architecture         $EIDETIC_ARCH"
eidetic_console_info "  Runtime user         $runtime_user"
eidetic_console_info "  Mode                 ${mode^}"
eidetic_console_info "  Install path         /opt/eidetic-player"
eidetic_console_info "  Autostart            ${choice[autostart]^}"
eidetic_console_info "  Fullscreen           ${choice[fullscreen]^}"
eidetic_console_info "  GPIO/I2S DAC         $gpio_dac_plan"
eidetic_console_info "  Existing data        Preserved"
eidetic_console_info "  Reboot               May be required; never automatic"

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
keyboard_changed=0
install_committed=0
keyboard_attempt_state=
gpio_dac_changed=0
gpio_dac_session="install-${PPID}-${BASHPID}"
cleanup() {
  local status="$1" rollback_result="not required"
  eidetic_console_abort_active_phase
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
eidetic_console_phase_begin "System dependencies"
eidetic_console_command_preview apt-get update
eidetic_console_command_preview apt-get install -y "${packages[@]}"
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  if [[ "$unattended" == 1 ]]; then
    export DEBIAN_FRONTEND=noninteractive
  else
    export DEBIAN_FRONTEND=dialog
  fi
  apt-get update
  apt-get install -y "${packages[@]}"

  [[ -x /usr/bin/mpv ]] ||
    eidetic_die "MPV was installed but /usr/bin/mpv is unavailable"

  /usr/bin/mpv --version >/dev/null 2>&1 ||
    eidetic_die "MPV executable verification failed"

  [[ -x /usr/bin/pkexec ]] ||
    eidetic_die "pkexec was installed but /usr/bin/pkexec is unavailable"

else
  install -d -m 0755 "$(eidetic_target /etc/eidetic-player)"
fi

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
    eidetic_run_as_runtime_user \
      "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
      "$node_release/bin/npm" --prefix "$build_source" ci
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
    [[ -d "$build_source/dist/backend" ]] || {
      EIDETIC_FAILURE_REASON="build phase failed: backend artifact was not produced"
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
  runtime_final_index=12
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
    runtime_final_index=17
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

  install -d -m 0755 \
    "$release_stage/node_modules/music-metadata"
  install -d -m 0755 "$release_stage/deploy/linux"
  install -m 0755 "$SCRIPT_DIR/update-eidetic-player.sh" \
    "$release_stage/deploy/linux/update-eidetic-player.sh"
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
  release_verifier_node="$(command -v node)"
  release_verifier_cli="$SCRIPT_DIR/../../node_modules/tsx/dist/cli.mjs"
  release_verifier_script="$SCRIPT_DIR/../../scripts/verify-linux-release.ts"
  release_verifier_args=(--root "$release_stage" --arch "$EIDETIC_ARCH"
    --phase staged)
fi
if ! "$release_verifier_node" "$release_verifier_cli" \
  "$release_verifier_script" "${release_verifier_args[@]}"; then
  eidetic_die "Installation verification failed: Linux release contract. No release was activated."
fi
eidetic_console_phase_done

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
EIDETIC_INSTALLATION_MODE=$mode
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
EIDETIC_TERMINAL=x-terminal-emulator
EIDETIC_MPV_PATH=/usr/bin/mpv
NODE_ENV=production
PATH=/opt/eidetic-player/node/current/bin:/usr/local/bin:/usr/bin:/bin
EOF
eidetic_install_managed "$conf" /etc/eidetic-player/install.conf 0644
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
eidetic_install_managed "$SCRIPT_DIR/templates/eidetic-player.desktop" /usr/share/applications/eidetic-player.desktop 0644
eidetic_install_managed "$SCRIPT_DIR/templates/return-to-eidetic-player.desktop" /usr/share/applications/return-to-eidetic-player.desktop 0644
for command in eidetic-player eidetic-player-maintenance eidetic-player-resume; do
  eidetic_install_managed "$SCRIPT_DIR/runtime/$command" "/usr/local/bin/$command" 0755
done
eidetic_install_managed "$SCRIPT_DIR/runtime/eidetic-player-display-policy" /usr/local/bin/eidetic-player-display-policy 0755
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

eidetic_console_phase_begin "Optional configuration"
if [[ "${choice[autostart]}" == yes ]]; then
  runtime_home="$EIDETIC_RUNTIME_HOME"
  autostart="$tmp/autostart.desktop"
  cp "$SCRIPT_DIR/templates/eidetic-player.desktop" "$autostart"
  install -d -m 0755 -o "$runtime_user" -g "$EIDETIC_RUNTIME_GID" \
    "$(eidetic_target "$runtime_home/.config")" \
    "$(eidetic_target "$runtime_home/.config/autostart")"
  eidetic_install_managed "$autostart" "$runtime_home/.config/autostart/eidetic-player.desktop" 0644
  chown "$runtime_user:$EIDETIC_RUNTIME_GID" \
    "$(eidetic_target "$runtime_home/.config/autostart/eidetic-player.desktop")"
fi
if [[ "${choice[blanking]}" == yes ]]; then
  runtime_home="$EIDETIC_RUNTIME_HOME"
  install -d -m 0755 -o "$runtime_user" -g "$EIDETIC_RUNTIME_GID" \
    "$(eidetic_target "$runtime_home/.config")" \
    "$(eidetic_target "$runtime_home/.config/autostart")"
  eidetic_install_managed "$SCRIPT_DIR/templates/eidetic-player-display-policy.desktop" \
    "$runtime_home/.config/autostart/eidetic-player-display-policy.desktop" 0644
  chown "$runtime_user:$EIDETIC_RUNTIME_GID" \
    "$(eidetic_target "$runtime_home/.config/autostart/eidetic-player-display-policy.desktop")"
fi
if [[ "${choice[autologin]}" == yes ]]; then
  if [[ "$EIDETIC_DISTRO" == "ubuntu" ]]; then
    gdm="$(eidetic_target /etc/gdm3/custom.conf)"
    gdm_new="$tmp/gdm.conf"
    [[ -f "$gdm" ]] && cp "$gdm" "$gdm_new" || printf '[daemon]\n' >"$gdm_new"
    sed -i '/^AutomaticLoginEnable=/d;/^AutomaticLogin=/d' "$gdm_new"
    sed -i "/^\\[daemon\\]/a AutomaticLogin=$runtime_user\\nAutomaticLoginEnable=true" "$gdm_new"
    eidetic_install_managed "$gdm_new" /etc/gdm3/custom.conf 0644
  else
    lightdm="$tmp/lightdm.conf"
    printf '[Seat:*]\nautologin-user=%s\nautologin-user-timeout=0\n' "$runtime_user" >"$lightdm"
    eidetic_install_managed "$lightdm" /etc/lightdm/lightdm.conf.d/90-eidetic-player.conf 0644
  fi
fi
if [[ "${choice[splash]}" == yes ]]; then
  eidetic_install_managed "$SCRIPT_DIR/plymouth/eidetic-player.plymouth" \
    /usr/share/plymouth/themes/eidetic-player/eidetic-player.plymouth 0644
  eidetic_install_managed "$SCRIPT_DIR/plymouth/eidetic-player.script" \
    /usr/share/plymouth/themes/eidetic-player/eidetic-player.script 0644
  # A generated 420x4 PPM avoids shipping opaque artwork.
  line="$tmp/line.ppm"
  { printf 'P3\n420 4\n255\n'; for _ in $(seq 1 1680); do printf '54 205 183\n'; done; } >"$line"
  eidetic_install_managed "$line" /usr/share/plymouth/themes/eidetic-player/line.ppm 0644
  if [[ "$EIDETIC_DISTRO" == "ubuntu" ]]; then
    grub="$tmp/grub.cfg"
    # GRUB expands this variable when it consumes the generated fragment.
    # shellcheck disable=SC2016
    printf 'GRUB_CMDLINE_LINUX_DEFAULT="${GRUB_CMDLINE_LINUX_DEFAULT} quiet splash"\n' >"$grub"
    eidetic_install_managed "$grub" /etc/default/grub.d/90-eidetic-player.cfg 0644
  else
    cmdline="$(eidetic_target /boot/firmware/cmdline.txt)"
    [[ -f "$cmdline" ]] || eidetic_die "Raspberry Pi boot cmdline was not found"
    awk '{ line=$0; if (line !~ /(^| )quiet( |$)/) line=line " quiet"; if (line !~ /(^| )splash( |$)/) line=line " splash"; print line }' "$cmdline" >"$tmp/cmdline.txt"
    eidetic_install_managed "$tmp/cmdline.txt" /boot/firmware/cmdline.txt 0644
  fi
  if [[ "$EIDETIC_ROOT" == "/" ]]; then
    previous_theme="$(plymouth-set-default-theme 2>/dev/null || true)"
    printf '%s\n' "$previous_theme" >"$(eidetic_target /var/lib/eidetic-player/plymouth-previous-theme)"
    plymouth-set-default-theme eidetic-player
    update-initramfs -u
    [[ "$EIDETIC_DISTRO" != "ubuntu" ]] || update-grub
  fi
fi

if [[ "$EIDETIC_ROOT" == "/" ]]; then
  getent group eidetic-player-network >/dev/null || groupadd --system eidetic-player-network
  usermod -a -G eidetic-player-network "$runtime_user"
  "$SCRIPT_DIR/network/install-network-integration.sh" \
    --user "$runtime_user" --group eidetic-player-network \
    --install-dir /opt/eidetic-player/current
  systemctl daemon-reload
  loginctl enable-linger "$runtime_user" >/dev/null
fi
if [[ "$rpi_keyboard" == disable ]]; then
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
eidetic_console_info "  Mode                 ${mode^}"
eidetic_console_info "  Runtime user         $runtime_user"
eidetic_console_info "  Install path         /opt/eidetic-player"
eidetic_console_info "  Service              ${choice[autostart]^}"
eidetic_console_info "  GPIO/I2S DAC         $gpio_dac_plan"
eidetic_console_info "  Application data     Preserved"
if [[ -n "${EIDETIC_RUNTIME_ELAPSED_MS:-}" ]]; then
  eidetic_console_info "  Runtime preparation  $(eidetic_console_duration "$EIDETIC_RUNTIME_ELAPSED_MS")"
fi
eidetic_console_info "  Total duration       $(eidetic_console_duration "$(eidetic_console_total_elapsed_ms)")"
eidetic_console_info "  Log                  $EIDETIC_LOG_PATH"
eidetic_console_info "  Diagnostics          eidetic-player-doctor"
eidetic_console_warning_summary

if [[ "$EIDETIC_ROOT" == "/" ]]; then
  if ((unattended)); then
    eidetic_log "Reboot was not performed because the installation is unattended."
    eidetic_log "Reboot manually with: sudo reboot"
  elif [[ -t 0 ]]; then
    printf '\n' >&3
    eidetic_prompt_yes_no "Restart the device now?" no ||
      eidetic_die "reboot choice input ended unexpectedly"
    if [[ "$EIDETIC_PROMPT_RESULT" == yes ]]; then
      eidetic_log "Rebooting the system."
      systemctl reboot
    else
      eidetic_log "Reboot was not performed."
      eidetic_log "Reboot manually with: sudo reboot"
    fi
  else
    eidetic_log "Reboot was not performed because no interactive terminal is available."
    eidetic_log "Reboot manually with: sudo reboot"
  fi
else
  eidetic_log "Staging installation completed; reboot is not applicable."
fi
