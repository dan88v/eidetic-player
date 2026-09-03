# Raspberry Pi OS Lite installation primitives. This library is sourced only by
# deployment entrypoints; every detection function is read-only.

eidetic_lite_package_installed() {
  local package="$1" status_file
  status_file="$(eidetic_target /var/lib/dpkg/status)"
  if [[ "${EIDETIC_ROOT:-/}" == "/" ]]; then
    dpkg-query -W -f='${Status}\n' "$package" 2>/dev/null |
      grep -qx 'install ok installed'
  elif [[ -r "$status_file" && ! -L "$status_file" ]]; then
    awk -v package="$package" 'BEGIN { RS=""; FS="\n" }
      $0 ~ "(^|\\n)Package: " package "(\\n|$)" &&
      $0 ~ /(^|\n)Status: install ok installed(\n|$)/ { found=1 }
      END { exit(found ? 0 : 1) }' "$status_file"
  else
    return 1
  fi
}

eidetic_lite_package_version() {
  local package="$1" status_file
  status_file="$(eidetic_target /var/lib/dpkg/status)"
  if [[ "${EIDETIC_ROOT:-/}" == "/" ]]; then
    dpkg-query -W -f='${Version}\n' "$package" 2>/dev/null
  elif [[ -r "$status_file" && ! -L "$status_file" ]]; then
    awk -v package="$package" 'BEGIN { RS=""; FS="\n" }
      $0 ~ "(^|\\n)Package: " package "(\\n|$)" {
        for (index = 1; index <= NF; index += 1) {
          if ($index ~ /^Version: /) {
            sub(/^Version: /, "", $index); print $index; exit
          }
        }
      }' "$status_file"
  fi
}

eidetic_lite_unit_enabled() {
  local unit="$1" candidate
  if [[ "${EIDETIC_ROOT:-/}" == "/" ]]; then
    systemctl is-enabled --quiet "$unit" 2>/dev/null
    return
  fi
  for candidate in \
    "/etc/systemd/system/display-manager.service" \
    "/etc/systemd/system/graphical.target.wants/$unit" \
    "/etc/systemd/system/multi-user.target.wants/$unit"; do
    [[ -e "$(eidetic_target "$candidate")" ]] && return 0
  done
  return 1
}

eidetic_lite_default_target() {
  local target
  if [[ "${EIDETIC_ROOT:-/}" == "/" ]]; then
    systemctl get-default 2>/dev/null || printf 'unknown\n'
    return
  fi
  target="$(eidetic_target /etc/systemd/system/default.target)"
  if [[ -L "$target" ]]; then
    basename -- "$(readlink "$target")"
  elif [[ -r "$(eidetic_target /etc/eidetic-player/default-target)" ]]; then
    tr -d '\r\n' <"$(eidetic_target /etc/eidetic-player/default-target)"
  else
    printf 'unknown\n'
  fi
}

eidetic_classify_raspios_host() {
  local os_release arch hardware=no wsl=no container=no desktop_marker=none
  local default_target desktop_packages=0 display_managers=0 session_files=0
  local active_graphical=0 desktop_score=0 lite_score=0 package unit
  os_release="$(eidetic_target /etc/os-release)"
  EIDETIC_HOST_CLASS=UNSUPPORTED
  EIDETIC_HOST_CLASS_REASON="unsupported operating system"
  [[ -r "$os_release" && ! -L "$os_release" ]] || {
    EIDETIC_HOST_CLASS_REASON="cannot read a regular /etc/os-release"
    export EIDETIC_HOST_CLASS EIDETIC_HOST_CLASS_REASON
    return 0
  }
  # shellcheck disable=SC1090
  . "$os_release"
  if [[ "${EIDETIC_ROOT:-/}" == "/" ]]; then
    arch="$(dpkg --print-architecture 2>/dev/null || printf unknown)"
    grep -qi microsoft /proc/version 2>/dev/null && wsl=yes
    [[ -e /.dockerenv ]] && container=yes
    if command -v systemd-detect-virt >/dev/null 2>&1 &&
      systemd-detect-virt --container --quiet 2>/dev/null; then
      container=yes
    fi
  else
    arch="$(tr -d '\r\n' <"$(eidetic_target /etc/eidetic-player/architecture)" 2>/dev/null || printf unknown)"
  fi
  EIDETIC_ARCH="$arch"
  eidetic_detect_raspberry_pi_hardware && hardware=yes || true
  eidetic_detect_raspios_marker || true
  if [[ "$wsl" == yes || "$container" == yes ]]; then
    EIDETIC_HOST_CLASS_REASON="containers and WSL are unsupported"
  elif [[ "${ID:-}" != raspbian && "${ID:-}" != debian ]]; then
    EIDETIC_HOST_CLASS_REASON="expected Raspberry Pi OS/Raspbian"
  elif [[ "${VERSION_ID:-}" != 13 || "${VERSION_CODENAME:-}" != trixie ]]; then
    EIDETIC_HOST_CLASS_REASON="expected Debian 13/Trixie"
  elif [[ "$arch" != arm64 ]]; then
    EIDETIC_HOST_CLASS_REASON="expected arm64"
  elif [[ "$hardware" != yes ]]; then
    EIDETIC_HOST_CLASS_REASON="Raspberry Pi hardware marker missing"
  elif [[ "${EIDETIC_RPI_MARKER:-none}" == none ]]; then
    EIDETIC_HOST_CLASS_REASON="Raspberry Pi OS marker missing"
  else
    for package in raspberrypi-ui-mods rpd-theme rpd-applications; do
      eidetic_lite_package_installed "$package" && desktop_packages=$((desktop_packages + 1))
    done
    for unit in lightdm.service gdm.service gdm3.service sddm.service; do
      if eidetic_lite_package_installed "${unit%.service}" ||
        eidetic_lite_unit_enabled "$unit"; then
        display_managers=$((display_managers + 1))
      fi
    done
    for package in lightdm gdm3 sddm; do
      eidetic_lite_package_installed "$package" && display_managers=$((display_managers + 1))
    done
    [[ -d "$(eidetic_target /usr/share/wayland-sessions)" ]] &&
      find "$(eidetic_target /usr/share/wayland-sessions)" -maxdepth 1 -type f \
        -name '*.desktop' -print -quit 2>/dev/null | grep -q . && session_files=1
    [[ -d "$(eidetic_target /etc/xdg/lxsession)" ]] && session_files=$((session_files + 1))
    if [[ "${EIDETIC_ROOT:-/}" == "/" ]]; then
      loginctl list-sessions --no-legend 2>/dev/null |
        while read -r session _; do
          [[ -n "$session" ]] || continue
          loginctl show-session "$session" -p Type --value 2>/dev/null
        done | grep -Eq '^(wayland|x11)$' && active_graphical=1
      desktop_marker="${XDG_CURRENT_DESKTOP:-none}"
    elif [[ -r "$(eidetic_target /etc/eidetic-player/desktop-session)" ]]; then
      desktop_marker="$(tr -d '\r\n' <"$(eidetic_target /etc/eidetic-player/desktop-session)")"
      [[ "$desktop_marker" == active-wayland || "$desktop_marker" == active-x11 ]] && active_graphical=1
    fi
    default_target="$(eidetic_lite_default_target)"
    ((desktop_packages > 0)) && desktop_score=$((desktop_score + 1))
    ((display_managers > 0)) && desktop_score=$((desktop_score + 1))
    ((session_files > 0)) && desktop_score=$((desktop_score + 1))
    ((active_graphical > 0)) && desktop_score=$((desktop_score + 1))
    [[ "$default_target" == graphical.target ]] && desktop_score=$((desktop_score + 1))
    [[ "$desktop_marker" != none && "$desktop_marker" != headless &&
      "$desktop_marker" != console ]] && desktop_score=$((desktop_score + 1))

    ((display_managers == 0)) && lite_score=$((lite_score + 1))
    ((desktop_packages == 0)) && lite_score=$((lite_score + 1))
    ((active_graphical == 0)) && lite_score=$((lite_score + 1))
    [[ "$default_target" == multi-user.target ]] && lite_score=$((lite_score + 1))
    [[ "$desktop_marker" == headless || "$desktop_marker" == console ]] &&
      lite_score=$((lite_score + 1))

    if ((desktop_score >= 2 && lite_score >= 3)); then
      EIDETIC_HOST_CLASS=AMBIGUOUS
      EIDETIC_HOST_CLASS_REASON="strong Desktop and Lite signals conflict"
    elif ((desktop_score >= 2 && lite_score < 3)); then
      EIDETIC_HOST_CLASS=DESKTOP
      EIDETIC_HOST_CLASS_REASON="Raspberry Pi Desktop stack detected"
    elif ((lite_score >= 4 && desktop_score < 2)); then
      EIDETIC_HOST_CLASS=RPIOS_LITE
      EIDETIC_HOST_CLASS_REASON="console Raspberry Pi OS Lite detected"
    else
      EIDETIC_HOST_CLASS=UNKNOWN
      EIDETIC_HOST_CLASS_REASON="insufficient independent Desktop/Lite signals"
    fi
  fi
  EIDETIC_DESKTOP_SCORE="$desktop_score"
  EIDETIC_LITE_SCORE="$lite_score"
  export EIDETIC_HOST_CLASS EIDETIC_HOST_CLASS_REASON EIDETIC_ARCH
  export EIDETIC_DESKTOP_SCORE EIDETIC_LITE_SCORE
}

eidetic_validate_lite_runtime_user() {
  local user="$1" record uid gid home shell uid_min home_target owner
  eidetic_validate_user "$user"
  record="$(getent passwd "$user")" || eidetic_die "cannot resolve runtime user: $user"
  IFS=: read -r resolved _ uid gid _ home shell <<<"$record"
  [[ "$resolved" == "$user" && "$(id -u "$user")" == "$uid" ]] ||
    eidetic_die "runtime user NSS identity does not round-trip"
  uid_min="$(awk '$1 == "UID_MIN" && $2 ~ /^[0-9]+$/ { print $2; exit }' \
    "$(eidetic_target /etc/login.defs)" 2>/dev/null || true)"
  [[ "$uid_min" =~ ^[0-9]+$ ]] || uid_min=1000
  ((uid >= uid_min && uid != 0)) || eidetic_die "runtime user must be a normal non-root account"
  getent group "$gid" >/dev/null || eidetic_die "runtime user primary group is invalid"
  [[ "$home" == /* && "$home" != / && "$home" != *'/../'* && "$home" != */.. ]] ||
    eidetic_die "runtime user has an unsafe home directory"
  [[ -x "$shell" && "${shell##*/}" != nologin && "${shell##*/}" != false ]] ||
    eidetic_die "runtime user must have a valid executable login shell"
  home_target="$(eidetic_target "$home")"
  [[ -d "$home_target" && ! -L "$home_target" ]] ||
    eidetic_die "runtime user home must be a real directory: $home"
  owner="$(stat -c %u "$home_target")"
  if [[ "${EIDETIC_ROOT:-/}" == "/" ]]; then
    [[ "$owner" == "$uid" ]] || eidetic_die "runtime user home has the wrong owner"
  fi
  eidetic_load_runtime_identity "$user"
  EIDETIC_RUNTIME_SHELL="$shell"
  export EIDETIC_RUNTIME_SHELL
}

eidetic_network_preflight() {
  local competing=0 nm_package=no nm_active=no nm_connection=no
  if [[ "${EIDETIC_ROOT:-/}" != "/" ]]; then
    if [[ -r "$(eidetic_target /etc/eidetic-player/network-state)" ]]; then
      EIDETIC_NETWORK_CLASS="$(tr -d '\r\n' <"$(eidetic_target /etc/eidetic-player/network-state)")"
    else
      EIDETIC_NETWORK_CLASS=UNKNOWN
    fi
  else
    eidetic_lite_package_installed network-manager && nm_package=yes
    systemctl is-active --quiet NetworkManager.service 2>/dev/null && nm_active=yes
    nmcli -t -f GENERAL.STATE device show 2>/dev/null |
      grep -Eq ':100 \(connected\)$|:100$' && nm_connection=yes
    for unit in dhcpcd.service systemd-networkd.service wpa_supplicant.service; do
      systemctl is-active --quiet "$unit" 2>/dev/null && competing=$((competing + 1))
    done
    if ((competing > 0)); then
      EIDETIC_NETWORK_CLASS=CONFLICT
    elif [[ "$nm_package" == yes && "$nm_active" == yes && "$nm_connection" == yes ]]; then
      EIDETIC_NETWORK_CLASS=NM_AUTHORITATIVE
    elif [[ "$nm_package" == no ]]; then
      EIDETIC_NETWORK_CLASS=MIGRATION_REQUIRED
    else
      EIDETIC_NETWORK_CLASS=UNKNOWN
    fi
  fi
  case "$EIDETIC_NETWORK_CLASS" in
    NM_AUTHORITATIVE|MIGRATION_REQUIRED|CONFLICT|UNKNOWN) ;;
    *) EIDETIC_NETWORK_CLASS=UNKNOWN ;;
  esac
  export EIDETIC_NETWORK_CLASS
}

eidetic_parse_lite_package_manifest() {
  local manifest="$1" line=0 category package purpose required lifecycle recommends verification
  declare -g -a EIDETIC_LITE_PACKAGES_RECOMMENDS=()
  declare -g -a EIDETIC_LITE_PACKAGES_NO_RECOMMENDS=()
  declare -g -a EIDETIC_LITE_PACKAGE_ROWS=()
  declare -A seen=()
  [[ -f "$manifest" && ! -L "$manifest" ]] || eidetic_die "Lite package manifest is unavailable"
  while IFS=$'\t' read -r category package purpose required lifecycle recommends verification; do
    line=$((line + 1))
    [[ -n "$category" && "${category:0:1}" != '#' ]] || continue
    [[ "$category" =~ ^[a-z][a-z0-9/-]*$ ]] || eidetic_die "invalid package category at line $line"
    [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || eidetic_die "invalid package name at line $line"
    [[ "$purpose" =~ ^[A-Za-z0-9_.:/+[:space:]-]{1,120}$ ]] || eidetic_die "invalid package purpose at line $line"
    [[ "$required" == required || "$required" == optional ]] || eidetic_die "invalid package requirement at line $line"
    [[ "$lifecycle" == runtime || "$lifecycle" == build-only ]] || eidetic_die "invalid package lifecycle at line $line"
    [[ "$recommends" == recommends || "$recommends" == no-recommends ]] || eidetic_die "invalid recommends policy at line $line"
    [[ "$verification" =~ ^[A-Za-z0-9_.:/+[:space:]-]{1,120}$ ]] || eidetic_die "invalid verification at line $line"
    [[ -z "${seen[$package]:-}" ]] || eidetic_die "duplicate Lite package: $package"
    seen["$package"]=1
    EIDETIC_LITE_PACKAGE_ROWS+=("$category|$package|$purpose|$required|$lifecycle|$recommends|$verification")
    [[ "$required" == required ]] || continue
    if [[ "$recommends" == recommends ]]; then
      EIDETIC_LITE_PACKAGES_RECOMMENDS+=("$package")
    else
      EIDETIC_LITE_PACKAGES_NO_RECOMMENDS+=("$package")
    fi
  done <"$manifest"
  ((${#EIDETIC_LITE_PACKAGE_ROWS[@]} > 0)) || eidetic_die "Lite package manifest is empty"
}
