#!/usr/bin/env bash

eidetic_die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
eidetic_log() { printf '%s\n' "$*"; }

eidetic_validate_root() {
  case "$1" in /*) ;; *) eidetic_die "--root must be an absolute path";; esac
  [[ "$1" != "/" ]] || eidetic_die "--root / is not a staging root"
  [[ "$1" != *"/../"* && "$1" != */.. ]] || eidetic_die "invalid staging root"
}

eidetic_target() {
  local path="$1"
  if [[ "${EIDETIC_ROOT:-/}" == "/" ]]; then printf '%s' "$path"
  else printf '%s%s' "${EIDETIC_ROOT%/}" "$path"; fi
}

eidetic_require_root() {
  if [[ "${EIDETIC_ROOT:-/}" == "/" && "${EUID}" -ne 0 ]]; then
    eidetic_die "run this script as root (do not pipe it to a shell)"
  fi
}

eidetic_validate_user() {
  [[ "$1" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || eidetic_die "invalid runtime user"
  id "$1" >/dev/null 2>&1 || eidetic_die "runtime user does not exist: $1"
  [[ "$(id -u "$1")" -ne 0 ]] || eidetic_die "runtime user must not be root"
}

eidetic_validate_ref() {
  [[ -n "$1" && "$1" =~ ^[A-Za-z0-9._/-]+$ ]] || eidetic_die "invalid Git ref"
  [[ "$1" != *".."* && "$1" != /* && "$1" != */ ]] || eidetic_die "unsafe Git ref"
}

eidetic_load_runtime_identity() {
  local user="$1" passwd_record
  passwd_record="$(getent passwd "$user")" ||
    eidetic_die "cannot resolve runtime user: $user"
  EIDETIC_RUNTIME_UID="$(printf '%s\n' "$passwd_record" | cut -d: -f3)"
  EIDETIC_RUNTIME_GID="$(printf '%s\n' "$passwd_record" | cut -d: -f4)"
  EIDETIC_RUNTIME_HOME="$(printf '%s\n' "$passwd_record" | cut -d: -f6)"
  [[ "$EIDETIC_RUNTIME_UID" =~ ^[0-9]+$ && "$EIDETIC_RUNTIME_UID" -ne 0 ]] ||
    eidetic_die "runtime user must have a non-root UID"
  [[ "$EIDETIC_RUNTIME_GID" =~ ^[0-9]+$ ]] ||
    eidetic_die "runtime user has an invalid primary group"
  [[ "$EIDETIC_RUNTIME_HOME" == /* ]] ||
    eidetic_die "runtime user has an invalid home directory"
  export EIDETIC_RUNTIME_UID EIDETIC_RUNTIME_GID EIDETIC_RUNTIME_HOME
}

eidetic_prepare_build_workspace() {
  local user="$1" parent="${2:-${TMPDIR:-/tmp}}" workspace
  workspace="$(mktemp -d -p "$parent" 'eidetic-player-build-Ü-space.XXXXXX')"
  chmod 0700 "$workspace"
  chown "$user:$EIDETIC_RUNTIME_GID" "$workspace"
  install -d -m 0700 -o "$user" -g "$EIDETIC_RUNTIME_GID" \
    "$workspace/.npm-cache" "$workspace/.tmp"
  printf '%s\n' "$workspace"
}

eidetic_run_as_runtime_user() {
  local user="$1" workspace="$2" node_bin="$3"
  shift 3
  [[ "${EUID}" -eq 0 ]] || eidetic_die "runtime-user execution requires an administrative installer"
  [[ -d "$workspace" ]] || eidetic_die "runtime workspace is missing"
  runuser --user "$user" -- \
    env -i --chdir="$workspace" \
      HOME="$EIDETIC_RUNTIME_HOME" \
      USER="$user" \
      LOGNAME="$user" \
      PATH="$node_bin:/usr/local/bin:/usr/bin:/bin" \
      LANG=C.UTF-8 \
      LC_ALL=C.UTF-8 \
      TMPDIR="$workspace/.tmp" \
      npm_config_cache="$workspace/.npm-cache" \
      npm_config_userconfig=/dev/null \
      npm_config_update_notifier=false \
      npm_config_fund=false \
      EIDETIC_INSTALLATION_MODE="${EIDETIC_INSTALLATION_MODE:-standard}" \
      EIDETIC_FULLSCREEN="${EIDETIC_FULLSCREEN:-0}" \
      "$@"
}

eidetic_activate_release() {
  local staged="$1" releases="$2" release_id="$3" opt="$4"
  local final="$releases/$release_id"
  [[ -d "$staged" ]] || eidetic_die "validated staged release is missing"
  [[ ! -e "$final" ]] || eidetic_die "release already exists: $release_id"
  mv -T -- "$staged" "$final"
  if [[ -L "$opt/current" ]]; then
    ln -sfn "$(readlink "$opt/current")" "$opt/previous.new"
    mv -Tf "$opt/previous.new" "$opt/previous"
  fi
  ln -sfn "releases/$release_id" "$opt/current.new"
  mv -Tf "$opt/current.new" "$opt/current"
}

eidetic_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

eidetic_manifest_init() {
  EIDETIC_STATE="$(eidetic_target /var/lib/eidetic-player)"
  EIDETIC_BACKUPS="${EIDETIC_STATE}/backups"
  EIDETIC_MANIFEST="${EIDETIC_STATE}/system-ui-manifest-v1.tsv"
  install -d -m 0750 "$EIDETIC_BACKUPS"
  if [[ ! -e "$EIDETIC_MANIFEST" ]]; then
    printf '# eidetic-system-ui-manifest-v1\n' >"$EIDETIC_MANIFEST"
    chmod 0640 "$EIDETIC_MANIFEST"
  fi
}

eidetic_record_original() {
  local logical="$1" target="$2" key backup exists mode owner group hash
  grep -Fq $'\t'"$logical"$'\t' "$EIDETIC_MANIFEST" && return
  [[ ! -L "$target" ]] || eidetic_die "refusing administrative symlink: $logical"
  key="$(printf '%s' "$logical" | sha256sum | awk '{print $1}')"
  backup="${EIDETIC_BACKUPS}/${key}"
  if [[ -e "$target" ]]; then
    [[ -f "$target" ]] || eidetic_die "managed target is not a regular file: $logical"
    cp --preserve=mode,ownership,timestamps -- "$target" "$backup"
    exists=1
    mode="$(stat -c '%a' "$target")"
    owner="$(stat -c '%u' "$target")"
    group="$(stat -c '%g' "$target")"
    hash="$(eidetic_sha256 "$target")"
  else
    exists=0 mode=- owner=- group=- hash=-
  fi
  printf 'file\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$logical" "$exists" "$key" "$mode" "$owner:$group" "$hash" >>"$EIDETIC_MANIFEST"
}

eidetic_install_managed() {
  local source="$1" logical="$2" mode="$3" target
  target="$(eidetic_target "$logical")"
  eidetic_manifest_init
  eidetic_record_original "$logical" "$target"
  install -d -m 0755 "$(dirname "$target")"
  install -m "$mode" "$source" "${target}.eidetic-new"
  mv -f -- "${target}.eidetic-new" "$target"
}

eidetic_detect_raspberry_pi_hardware() {
  local logical compatible_file entry normalized
  EIDETIC_RPI_COMPATIBLE=none
  for logical in \
    /proc/device-tree/compatible \
    /sys/firmware/devicetree/base/compatible; do
    compatible_file="$(eidetic_target "$logical")"
    [[ -r "$compatible_file" ]] || continue
    while IFS= read -r entry; do
      normalized="${entry,,}"
      normalized="${normalized//$'\r'/}"
      [[ -n "$normalized" ]] || continue
      if [[ "$EIDETIC_RPI_COMPATIBLE" == none &&
            "$normalized" =~ ^[a-z0-9][a-z0-9,._+-]*$ ]]; then
        EIDETIC_RPI_COMPATIBLE="$normalized"
      fi
      if [[ "$normalized" == raspberrypi,* ]]; then
        EIDETIC_RPI_COMPATIBLE="$normalized"
        export EIDETIC_RPI_COMPATIBLE
        return 0
      fi
    done < <(tr '\0' '\n' <"$compatible_file"; printf '\n')
  done
  export EIDETIC_RPI_COMPATIBLE
  return 1
}

eidetic_detect_raspios_marker() {
  local rpi_issue package_status raspi_repository
  EIDETIC_RPI_MARKER=none
  rpi_issue="$(eidetic_target /etc/rpi-issue)"
  package_status="$(eidetic_target /var/lib/dpkg/status)"
  raspi_repository="$(eidetic_target /etc/apt/sources.list.d/raspi.list)"
  if [[ -f "$rpi_issue" && ! -L "$rpi_issue" ]]; then
    EIDETIC_RPI_MARKER=rpi-issue
  elif [[ -r "$package_status" ]] &&
       awk 'BEGIN { RS=""; FS="\n" }
         $0 ~ /(^|\n)Package: raspberrypi-ui-mods(\n|$)/ &&
         $0 ~ /(^|\n)Status: install ok installed(\n|$)/ { found=1 }
         END { exit(found ? 0 : 1) }' "$package_status"; then
    EIDETIC_RPI_MARKER=raspberrypi-ui-mods
  elif [[ "${EIDETIC_ROOT:-/}" == "/" ]] &&
       dpkg-query -W -f='${Status}\n' raspberrypi-ui-mods 2>/dev/null |
         grep -qx 'install ok installed'; then
    EIDETIC_RPI_MARKER=raspberrypi-ui-mods
  elif [[ -f "$raspi_repository" && ! -L "$raspi_repository" ]] &&
       grep -Eq 'https?://archive\.raspberrypi\.(com|org)/' "$raspi_repository"; then
    EIDETIC_RPI_MARKER=raspi-repository
  fi
  export EIDETIC_RPI_MARKER
  [[ "$EIDETIC_RPI_MARKER" != none ]]
}

eidetic_platform_diagnostics() {
  local hardware="$1"
  eidetic_log "Detected platform:"
  eidetic_log "  OS: ${ID:-unknown} ${VERSION_ID:-unknown} (${VERSION_CODENAME:-unknown})"
  eidetic_log "  Architecture: ${EIDETIC_ARCH:-unknown}"
  eidetic_log "  Desktop: ${EIDETIC_DESKTOP:-none}"
  eidetic_log "  Raspberry Pi hardware: $hardware"
  eidetic_log "  Raspberry Pi compatible: ${EIDETIC_RPI_COMPATIBLE:-none}"
  eidetic_log "  Raspberry Pi OS marker: ${EIDETIC_RPI_MARKER:-none}"
}

eidetic_detect_platform() {
  local os_release arch desktop hardware=no wsl=no
  os_release="$(eidetic_target /etc/os-release)"
  [[ -r "$os_release" ]] || eidetic_die "cannot read /etc/os-release"
  # shellcheck disable=SC1090
  . "$os_release"
  if [[ "${EIDETIC_ROOT:-/}" != "/" ]]; then
    [[ -r "$(eidetic_target /etc/eidetic-player/architecture)" ]] &&
      arch="$(<"$(eidetic_target /etc/eidetic-player/architecture)")" ||
      arch=unknown
    [[ -r "$(eidetic_target /etc/eidetic-player/desktop-session)" ]] &&
      desktop="$(<"$(eidetic_target /etc/eidetic-player/desktop-session)")" ||
      desktop=none
  else
    grep -qi microsoft /proc/version 2>/dev/null && wsl=yes
    arch="$(dpkg --print-architecture)"
    desktop="${XDG_CURRENT_DESKTOP:-}"
    [[ -n "$desktop" ]] || {
      dpkg-query -W ubuntu-desktop >/dev/null 2>&1 && desktop=GNOME
      dpkg-query -W raspberrypi-ui-mods >/dev/null 2>&1 && desktop=RaspberryPi
    }
    desktop="${desktop:-none}"
  fi
  EIDETIC_ARCH="$arch"
  EIDETIC_DESKTOP="$desktop"
  eidetic_detect_raspberry_pi_hardware && hardware=yes || true
  eidetic_detect_raspios_marker || true
  export EIDETIC_ARCH EIDETIC_DESKTOP
  [[ "${EIDETIC_PLATFORM_DIAGNOSTICS:-show}" == quiet ]] ||
    eidetic_platform_diagnostics "$hardware"

  [[ "$wsl" == no ]] ||
    eidetic_die "real installation under WSL is unsupported; use --dry-run or --root"

  case "${ID:-}" in
    ubuntu)
      [[ "${VERSION_ID:-}" == "26.04" ]] ||
        eidetic_die "unsupported OS release: Ubuntu ${VERSION_ID:-unknown}; expected 26.04 LTS Desktop"
      [[ "$arch" == "amd64" || "$arch" == "arm64" ]] ||
        eidetic_die "unsupported architecture: $arch; Ubuntu requires amd64 or arm64"
      [[ "$desktop" != none && "$desktop" != headless ]] ||
        eidetic_die "Desktop installation required: Ubuntu Server/headless is unsupported"
      EIDETIC_DISTRO=ubuntu
      ;;
    raspbian|debian)
      [[ "${VERSION_ID:-}" == "13" &&
        "${VERSION_CODENAME:-}" == "trixie" ]] ||
        eidetic_die "unsupported OS release: ${ID:-unknown} ${VERSION_ID:-unknown} (${VERSION_CODENAME:-unknown}); expected Raspberry Pi OS Trixie"
      [[ "$arch" == "arm64" ]] ||
        eidetic_die "unsupported architecture: $arch; Raspberry Pi OS requires arm64"
      if [[ "${ID:-}" == "debian" ]]; then
        [[ "$hardware" == yes ]] ||
          eidetic_die "unsupported OS release: generic Debian is not supported"
        [[ "$EIDETIC_RPI_MARKER" != none ]] ||
          eidetic_die "Raspberry Pi OS marker missing: Debian on Raspberry Pi hardware is not sufficient"
      fi
      [[ "$desktop" != none && "$desktop" != headless ]] ||
        eidetic_die "Desktop installation required: Raspberry Pi OS Lite/headless is unsupported"
      EIDETIC_DISTRO=raspios
      ;;
    *)
      eidetic_die "unsupported OS release: ${ID:-unknown} ${VERSION_ID:-unknown} (${VERSION_CODENAME:-unknown})"
      ;;
  esac
  export EIDETIC_DISTRO
}
