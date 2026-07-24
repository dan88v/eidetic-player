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
}

eidetic_validate_ref() {
  [[ -n "$1" && "$1" =~ ^[A-Za-z0-9._/-]+$ ]] || eidetic_die "invalid Git ref"
  [[ "$1" != *".."* && "$1" != /* && "$1" != */ ]] || eidetic_die "unsafe Git ref"
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

eidetic_detect_platform() {
  local os_release arch desktop
  os_release="$(eidetic_target /etc/os-release)"
  [[ -r "$os_release" ]] || eidetic_die "cannot read /etc/os-release"
  # shellcheck disable=SC1090
  . "$os_release"
  if [[ "${EIDETIC_ROOT:-/}" != "/" ]]; then
    arch="$(<"$(eidetic_target /etc/eidetic-player/architecture)")"
    desktop="$(<"$(eidetic_target /etc/eidetic-player/desktop-session)")"
  else
    grep -qi microsoft /proc/version 2>/dev/null && eidetic_die "real installation under WSL is unsupported; use --dry-run or --root"
    arch="$(dpkg --print-architecture)"
    desktop="${XDG_CURRENT_DESKTOP:-}"
    [[ -n "$desktop" ]] || {
      dpkg-query -W ubuntu-desktop >/dev/null 2>&1 && desktop=GNOME
      dpkg-query -W raspberrypi-ui-mods >/dev/null 2>&1 && desktop=RaspberryPi
    }
  fi
  [[ -n "$desktop" && "$desktop" != "headless" ]] || eidetic_die "a supported Desktop installation is required"
  if [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "26.04" && ("$arch" == "amd64" || "$arch" == "arm64") ]]; then
    EIDETIC_DISTRO=ubuntu
  elif [[ ("${ID:-}" == "raspbian" || "${ID:-}" == "debian") && "${VERSION_CODENAME:-}" == "trixie" && "$arch" == "arm64" ]] &&
       { [[ "${ID:-}" == "raspbian" ]] || grep -qi 'Raspberry Pi' "$os_release"; }; then
    EIDETIC_DISTRO=raspios
  else
    eidetic_die "unsupported OS/version/architecture (${ID:-unknown} ${VERSION_ID:-unknown} $arch)"
  fi
  EIDETIC_ARCH="$arch"
  export EIDETIC_DISTRO EIDETIC_ARCH
}
