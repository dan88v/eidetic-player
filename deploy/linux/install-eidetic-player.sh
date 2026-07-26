#!/usr/bin/env bash
set -euo pipefail
umask 022
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

runtime_user="${SUDO_USER:-}"
git_ref=main
mode=standard
dry_run=0
unattended=0
full_verify=0
EIDETIC_ROOT=/
rpi_keyboard=keep
rpi_keyboard_explicit=0
gpio_i2s_dac=0
gpio_i2s_dac_explicit=0
gpio_i2s_dac_state=not-requested
SOURCE_REMOTE=https://github.com/dan88v/eidetic-player.git
declare -A choice=()

usage() {
  cat <<'EOF'
Usage: sudo ./deploy/linux/install-eidetic-player.sh [options]
  --user USER                 Existing non-root runtime user
  --ref REF                   Git ref to install (default: main)
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
  --help
EOF
}

set_choice() {
  [[ "$2" == "yes" || "$2" == "no" ]] || eidetic_die "$1 expects yes or no"
  choice["$1"]="$2"
}
while (($#)); do
  case "$1" in
    --user) [[ $# -ge 2 ]] || eidetic_die "--user needs a value"; runtime_user="$2"; shift 2;;
    --ref) [[ $# -ge 2 ]] || eidetic_die "--ref needs a value"; git_ref="$2"; shift 2;;
    --mode) [[ $# -ge 2 ]] || eidetic_die "--mode needs a value"; mode="$2"; shift 2;;
    --root) [[ $# -ge 2 ]] || eidetic_die "--root needs a value"; EIDETIC_ROOT="$2"; shift 2;;
    --dry-run) dry_run=1; shift;;
    --unattended) unattended=1; shift;;
    --full-verify) full_verify=1; shift;;
    --autostart) set_choice autostart "${2:-}"; shift 2;;
    --fullscreen) set_choice fullscreen "${2:-}"; shift 2;;
    --borderless) set_choice borderless "${2:-}"; shift 2;;
    --disable-blanking) set_choice blanking "${2:-}"; shift 2;;
    --hide-pointer) set_choice pointer "${2:-}"; shift 2;;
    --splash) set_choice splash "${2:-}"; shift 2;;
    --autologin) set_choice autologin "${2:-}"; shift 2;;
    --rpi-onscreen-keyboard)
      [[ $# -ge 2 ]] || eidetic_die "--rpi-onscreen-keyboard needs a value"
      rpi_keyboard="$2"
      rpi_keyboard_explicit=1
      shift 2
      ;;
    --gpio-i2s-dac)
      gpio_i2s_dac=1
      gpio_i2s_dac_explicit=1
      shift
      ;;
    --help) usage; exit 0;;
    *) eidetic_die "unknown option: $1";;
  esac
done

install_question_prompt() {
  case "$1" in
    borderless)
      printf '%s' 'Run Eidetic Player without window borders? [y/N] '
      ;;
    *)
      printf '%s? [y/N] ' "$1"
      ;;
  esac
}

[[ "$mode" == "standard" || "$mode" == "appliance" ]] || eidetic_die "--mode must be standard or appliance"
[[ "$rpi_keyboard" == keep || "$rpi_keyboard" == disable ]] ||
  eidetic_die "--rpi-onscreen-keyboard must be keep or disable"
[[ -n "$runtime_user" ]] || eidetic_die "--user is required when SUDO_USER is unavailable"
eidetic_validate_user "$runtime_user"
eidetic_load_runtime_identity "$runtime_user"
eidetic_validate_ref "$git_ref"
if [[ "$EIDETIC_ROOT" != "/" ]]; then eidetic_validate_root "$EIDETIC_ROOT"; fi
export EIDETIC_ROOT
eidetic_require_root
checkout="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
preflight_world_write=yes
[[ "$EIDETIC_ROOT" == "/" ]] || preflight_world_write=no
eidetic_preflight_checkout \
  "$runtime_user" "$checkout" "$preflight_world_write"
eidetic_detect_platform
backend_host="${BACKEND_HOST:-127.0.0.1}"
backend_port="${BACKEND_PORT:-4310}"
if ! [[ "$backend_port" =~ ^[0-9]+$ ]] || ((backend_port < 1 || backend_port > 65535)); then
  eidetic_die "Invalid BACKEND_PORT=${backend_port}; must be an integer 1-65535."
fi
if [[ "$backend_host" != "127.0.0.1" && "$backend_host" != "localhost" ]]; then
  eidetic_die "Invalid BACKEND_HOST=${backend_host}; only loopback is supported."
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
      read -r -p "$(install_question_prompt "$key")" answer
      [[ "$answer" =~ ^[Yy]$ ]] && choice["$key"]=yes || choice["$key"]=no
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
  read -r -p "Disable the Raspberry Pi OS on-screen keyboard and use Eidetic Player's keyboard instead? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] && rpi_keyboard=disable || rpi_keyboard=keep
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
  read -r -p "Configure a generic GPIO/I2S DAC (PCM5102A-compatible)? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] && gpio_i2s_dac=1 || gpio_i2s_dac=0
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
eidetic_log "Target: $EIDETIC_DISTRO $EIDETIC_ARCH; user=$runtime_user; mode=$mode; ref=$git_ref"
eidetic_log "APT plan: ${packages[*]}"
if ((full_verify)); then
  eidetic_log "Verification profile: full"
else
  eidetic_log "Verification profile: install-safe"
fi
eidetic_log "Raspberry Pi OS on-screen keyboard: $rpi_keyboard"
eidetic_log "GPIO/I2S DAC: $gpio_dac_plan"
for key in "${questions[@]}"; do eidetic_log "  $key=${choice[$key]}"; done
if ((dry_run)); then
  eidetic_log "Dry-run complete: no files, packages, services, boot settings, mounts, or network profiles changed."
  exit 0
fi

tmp="$(mktemp -d)"
build_workspace=
build_runtime=
release_stage=
keyboard_changed=0
install_committed=0
keyboard_attempt_state=
gpio_dac_changed=0
gpio_dac_session="install-${PPID}-${BASHPID}"
cleanup() {
  if [[ "$gpio_dac_changed" == 1 && "$install_committed" == 0 ]]; then
    eidetic_log "Restoring boot configuration after failed installation."
    python3 "$gpio_dac_helper" rollback --root "$EIDETIC_ROOT" \
      --session "$gpio_dac_session" >/dev/null ||
      eidetic_log "CRITICAL: GPIO/I2S boot rollback could not be proven; manual review is required."
  fi
  if [[ "$keyboard_changed" == 1 && "$install_committed" == 0 &&
    -n "$keyboard_attempt_state" ]]; then
    eidetic_log "Restoring Raspberry Pi OS on-screen keyboard after failed installation."
    eidetic_set_rpi_keyboard_state "$keyboard_attempt_state" ||
      eidetic_log "Warning: automatic on-screen keyboard rollback failed; use raspi-config Display Options > D6."
  fi
  [[ -z "$release_stage" || ! -e "$release_stage" ]] ||
    rm -rf -- "$release_stage"
  [[ -z "$build_runtime" || ! -e "$build_runtime" ]] ||
    rm -rf -- "$build_runtime"
  [[ -z "$build_workspace" || ! -e "$build_workspace" ]] ||
    rm -rf -- "$build_workspace"
  rm -rf -- "$tmp"
}
trap cleanup EXIT
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

releases="$(eidetic_target /opt/eidetic-player/releases)"
opt="$(eidetic_target /opt/eidetic-player)"
install -d -m 0755 "$releases"
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  build_workspace="$(eidetic_prepare_build_workspace "$runtime_user")"
  build_runtime="$(eidetic_prepare_build_runtime "$runtime_user")"
  eidetic_validate_mpv_runtime_budget "$build_runtime"
  build_source="$build_workspace/source"
  EIDETIC_INSTALLATION_MODE="$mode"
  EIDETIC_FULLSCREEN=$([[ "${choice[fullscreen]}" == yes ]] && printf 1 || printf 0)
  EIDETIC_BORDERLESS="$borderless_value"
  export EIDETIC_INSTALLATION_MODE EIDETIC_FULLSCREEN EIDETIC_BORDERLESS
  eidetic_log "Source phase (runtime user UID $EIDETIC_RUNTIME_UID): isolated fetch $git_ref"
  if ! eidetic_fetch_isolated_source \
    "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
    "$git_ref" "$SOURCE_REMOTE"; then
    eidetic_die "source phase failed: isolated Git fetch"
  fi

  # Raspberry Pi kiosk presentation:
  # fullscreen, borderless and window title bar behavior are controlled by installer choices.

  verification_phases=(ci typecheck verify:linux:installer)
  if ((full_verify)); then
    verification_phases+=(format:check lint test test:posix test:case-sensitive)
  fi
  verification_phases+=(build:linux)
  for phase in "${verification_phases[@]}"; do
    eidetic_log "Build phase (runtime user UID $EIDETIC_RUNTIME_UID): npm $phase"
    if ! case "$phase" in
        ci)
          eidetic_run_as_runtime_user \
            "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
            "$node_release/bin/npm" --prefix "$build_source" ci
          ;;
        test)
          eidetic_run_as_runtime_user \
            "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
            "$node_release/bin/npm" --prefix "$build_source" test
          ;;
        *)
          eidetic_run_as_runtime_user \
            "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
            "$node_release/bin/npm" --prefix "$build_source" run "$phase"
          ;;
      esac; then
      if [[ "$phase" == build:linux ]]; then
        eidetic_die "build phase failed: npm $phase. No release was activated."
      fi
      eidetic_die "Installation verification failed: npm $phase. No release was activated."
    fi
  done
  [[ -d "$build_source/dist/backend" ]] ||
    eidetic_die "build phase failed: backend artifact was not produced"

  case "$EIDETIC_ARCH" in
    amd64)
      neutralino_arch=x64
      ;;
    arm64)
      neutralino_arch=arm64
      ;;
    *)
      eidetic_die "unsupported Neutralino Linux architecture: $EIDETIC_ARCH"
      ;;
  esac

  shell_binary="$build_source/dist/eidetic-player/eidetic-player-linux_${neutralino_arch}"

  if [[ ! -f "$shell_binary" ]]; then
    eidetic_log "Neutralino distribution contents:"
    find "$build_source/dist" -maxdepth 3 -type f -printf '  %m %p\n' >&2 || true
    eidetic_die "Neutralino Linux ${neutralino_arch} binary was not produced"
  fi


  mapfile -d '' neu_files < <(
    find "$build_source/dist" -maxdepth 3 -type f \
      \( -name '*.neu' -o -name 'neutralino.config.json' \) -print0
  )
  ((${#neu_files[@]} > 0)) ||
    eidetic_die "Neutralino resources were not produced"
  if ! eidetic_run_as_runtime_user \
    "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
    "$node_release/bin/node" "$build_source/node_modules/tsx/dist/cli.mjs" \
    "$build_source/scripts/verify-linux-release.ts" \
    --root "$build_source" --arch "$neutralino_arch" --phase build; then
    eidetic_die "Installation verification failed: Linux build artifact contract. No release was activated."
  fi
  release_commit="$(eidetic_run_as_runtime_user \
    "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
    git -C "$build_source" rev-parse --short=12 HEAD)"
else
  release_commit=staging
fi

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
  install -m 0755 "$shell_binary" "$release_stage/eidetic-player"
  cp -- "${neu_files[@]}" "$release_stage/"
  install -m 0644 "$build_source/neutralino.config.json" \
    "$release_stage/neutralino.config.json"

  # package.json rende i file compilati .js moduli ESM.
  cp "$build_source/package.json" "$release_stage/package.json"
  cp "$build_source/package-lock.json" "$release_stage/package-lock.json"

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

  printf '{"lockfileVersion":3}\n' \
    >"$release_stage/package-lock.json"

  printf '{}\n' \
    >"$release_stage/neutralino.config.json"

  printf 'staging fixture\n' \
    >"$release_stage/resources.neu"

  install -d -m 0755 \
    "$release_stage/node_modules/music-metadata"
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

conf="$tmp/install.conf"
power_policy="$tmp/eidetic-player-power.polkit.rules"
power_policy_placeholder=__EIDETIC_RUNTIME_USER__
[[ "$(grep -Foc "$power_policy_placeholder" \
  "$SCRIPT_DIR/templates/eidetic-player-power.polkit.rules")" == 1 ]] ||
  eidetic_die "Power policy template must contain exactly one runtime-user placeholder"
sed "s/$power_policy_placeholder/$runtime_user/" \
  "$SCRIPT_DIR/templates/eidetic-player-power.polkit.rules" >"$power_policy"
if grep -Fq "$power_policy_placeholder" "$power_policy"; then
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
PATH=/opt/eidetic-player/node/current/bin:/usr/local/bin:/usr/bin:/bin
EOF
eidetic_install_managed "$conf" /etc/eidetic-player/install.conf 0644
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
eidetic_activate_release "$release_stage" "$releases" "$release_id" "$opt"
release_stage=
if [[ "$gpio_dac_changed" == 1 ]]; then
  python3 "$gpio_dac_helper" commit --root "$EIDETIC_ROOT" \
    --session "$gpio_dac_session" >/dev/null ||
    eidetic_die "GPIO/I2S DAC transaction commit failed"
fi
install_committed=1

eidetic_log "Installed release $release_id atomically."
eidetic_log "Application data under the runtime user's XDG directories was not modified."

if [[ "$EIDETIC_ROOT" == "/" ]]; then
  if ((unattended)); then
    eidetic_log "Reboot was not performed because the installation is unattended."
    eidetic_log "Reboot manually with: sudo reboot"
  elif [[ -t 0 ]]; then
    printf '\n'
    read -r -p "Installation completed successfully. Reboot now? [y/N] " reboot_answer

    if [[ "$reboot_answer" =~ ^[Yy]$ ]]; then
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
