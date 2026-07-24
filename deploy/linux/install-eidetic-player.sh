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
EIDETIC_ROOT=/
rpi_keyboard=keep
rpi_keyboard_explicit=0
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
  --root PATH                 Use an isolated staging root
  --autostart yes|no          Appliance choice
  --fullscreen yes|no         Appliance choice
  --disable-blanking yes|no   Appliance choice
  --hide-pointer yes|no       Appliance choice
  --splash yes|no             Appliance choice
  --autologin yes|no          Appliance choice
  --rpi-onscreen-keyboard keep|disable
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
    --autostart) set_choice autostart "${2:-}"; shift 2;;
    --fullscreen) set_choice fullscreen "${2:-}"; shift 2;;
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
    --help) usage; exit 0;;
    *) eidetic_die "unknown option: $1";;
  esac
done
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

questions=(autostart fullscreen blanking pointer splash autologin)
if [[ "$mode" == "standard" ]]; then
  for key in "${questions[@]}"; do choice["$key"]=no; done
else
  for key in "${questions[@]}"; do
    if [[ -z "${choice[$key]:-}" ]]; then
      if ((unattended)); then eidetic_die "--unattended appliance installs require every appliance choice flag"; fi
      [[ -t 0 ]] || eidetic_die "appliance choices require a terminal or explicit flags"
      read -r -p "$key? [y/N] " answer
      [[ "$answer" =~ ^[Yy]$ ]] && choice["$key"]=yes || choice["$key"]=no
    fi
  done
fi
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

packages=(ca-certificates curl git build-essential python3 pkg-config mpv ffmpeg
  network-manager dbus polkitd udisks2 cifs-utils xterm)
if [[ "$EIDETIC_DISTRO" == "raspios" ]]; then
  packages+=(libgtk-3-0t64 libwebkit2gtk-4.1-0)
else
  packages+=(libgtk-3-0t64 libwebkit2gtk-4.1-0)
fi
[[ "${choice[splash]}" == yes ]] && packages+=(plymouth)
eidetic_log "Target: $EIDETIC_DISTRO $EIDETIC_ARCH; user=$runtime_user; mode=$mode; ref=$git_ref"
eidetic_log "APT plan: ${packages[*]}"
eidetic_log "Raspberry Pi OS on-screen keyboard: $rpi_keyboard"
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
cleanup() {
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
  export DEBIAN_FRONTEND=$([[ "$unattended" == 1 ]] && printf noninteractive || printf dialog)
  apt-get update
  apt-get install -y "${packages[@]}"
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
  export EIDETIC_INSTALLATION_MODE EIDETIC_FULLSCREEN
  eidetic_log "Source phase (runtime user UID $EIDETIC_RUNTIME_UID): isolated fetch $git_ref"
  if ! eidetic_fetch_isolated_source \
    "$runtime_user" "$build_workspace" "$build_runtime" "$node_release/bin" \
    "$git_ref" "$SOURCE_REMOTE"; then
    eidetic_die "source phase failed: isolated Git fetch"
  fi
  for phase in ci typecheck test build:linux; do
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
      eidetic_die "build phase failed: npm $phase"
    fi
  done
  [[ -d "$build_source/dist/backend" ]] ||
    eidetic_die "build phase failed: backend artifact was not produced"
  shell_binary="$(find "$build_source/dist" -type f -name '*linux*' -perm /111 -print -quit)"
  [[ -n "$shell_binary" ]] || eidetic_die "Neutralino Linux binary was not produced"
  mapfile -d '' neu_files < <(
    find "$build_source/dist" -maxdepth 3 -type f \
      \( -name '*.neu' -o -name 'neutralino.config.json' \) -print0
  )
  ((${#neu_files[@]} > 0)) ||
    eidetic_die "Neutralino resources were not produced"
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
install -d -m 0755 "$release_stage/bin"
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  cp -a "$build_source/dist/backend" "$release_stage/backend"
  install -m 0755 "$shell_binary" "$release_stage/eidetic-player"
  cp -- "${neu_files[@]}" "$release_stage/"
else
  install -d -m 0755 "$release_stage/backend"
  printf 'staging fixture\n' >"$release_stage/backend/index.js"
  printf '#!/bin/sh\nexit 0\n' >"$release_stage/eidetic-player"
  chmod 0755 "$release_stage/eidetic-player"
fi
install -m 0755 "$SCRIPT_DIR/runtime/eidetic-player-launch" \
  "$release_stage/bin/eidetic-player-launch"
[[ -f "$release_stage/backend/index.js" && -x "$release_stage/eidetic-player" &&
  -x "$release_stage/bin/eidetic-player-launch" ]] ||
  eidetic_die "release verification failed"
if [[ "${EUID}" -eq 0 ]]; then
  chown -R root:root "$release_stage"
fi
chmod 0755 "$release_stage"

conf="$tmp/install.conf"
cat >"$conf" <<EOF
EIDETIC_INSTALLATION_MODE=$mode
EIDETIC_FULLSCREEN=$([[ "${choice[fullscreen]}" == yes ]] && printf 1 || printf 0)
EIDETIC_HIDE_POINTER=$([[ "${choice[pointer]}" == yes ]] && printf 1 || printf 0)
EIDETIC_DISABLE_BLANKING=$([[ "${choice[blanking]}" == yes ]] && printf 1 || printf 0)
EIDETIC_AUTOSTART=$([[ "${choice[autostart]}" == yes ]] && printf 1 || printf 0)
EIDETIC_SPLASH=$([[ "${choice[splash]}" == yes ]] && printf 1 || printf 0)
EIDETIC_AUTOLOGIN=$([[ "${choice[autologin]}" == yes ]] && printf 1 || printf 0)
EIDETIC_RUNTIME_USER=$runtime_user
EIDETIC_GIT_REF=$git_ref
EIDETIC_RPI_ONSCREEN_KEYBOARD=$rpi_keyboard
EIDETIC_TERMINAL=x-terminal-emulator
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
eidetic_activate_release "$release_stage" "$releases" "$release_id" "$opt"
release_stage=
install_committed=1
eidetic_log "Installed release $release_id atomically. No reboot was performed."
eidetic_log "Application data under the runtime user's XDG directories was not modified."
