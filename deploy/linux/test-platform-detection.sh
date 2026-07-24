#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

make_fixture() {
  local name="$1" id="$2" arch="$3" desktop="$4"
  local compatible="${5:-none}" marker="${6:-none}" tree="${7:-proc}"
  local root="$work/$name"
  install -d "$root/etc/eidetic-player"
  cat >"$root/etc/os-release" <<EOF
ID=$id
VERSION_ID=13
VERSION_CODENAME=trixie
EOF
  if [[ "$id" == ubuntu ]]; then
    sed -i 's/VERSION_ID=13/VERSION_ID=26.04/;s/VERSION_CODENAME=trixie/VERSION_CODENAME=resolute/' \
      "$root/etc/os-release"
  fi
  printf '%s\n' "$arch" >"$root/etc/eidetic-player/architecture"
  printf '%s\n' "$desktop" >"$root/etc/eidetic-player/desktop-session"
  if [[ "$compatible" != none ]]; then
    if [[ "$tree" == proc ]]; then
      install -d "$root/proc/device-tree"
      printf 'brcm,bcm2837\0%s\0' "$compatible" >"$root/proc/device-tree/compatible"
    else
      install -d "$root/sys/firmware/devicetree/base"
      printf 'brcm,bcm2837\0%s\0' "$compatible" \
        >"$root/sys/firmware/devicetree/base/compatible"
    fi
  fi
  case "$marker" in
    rpi-issue)
      printf 'Raspberry Pi reference image\n' >"$root/etc/rpi-issue"
      ;;
    package)
      install -d "$root/var/lib/dpkg"
      cat >"$root/var/lib/dpkg/status" <<'EOF'
Package: raspberrypi-ui-mods
Status: install ok installed
Architecture: arm64
EOF
      ;;
    repository)
      install -d "$root/etc/apt/sources.list.d"
      printf 'deb https://archive.raspberrypi.com/debian/ trixie main\n' \
        >"$root/etc/apt/sources.list.d/raspi.list"
      ;;
    none) ;;
    *) printf 'unknown marker fixture: %s\n' "$marker" >&2; exit 1;;
  esac
  printf '%s\n' "$root"
}

expect_supported() {
  local name="$1" expected="$2" root="$3" output
  output="$(
    EIDETIC_ROOT="$root"
    export EIDETIC_ROOT
    eidetic_detect_platform
    printf 'RESULT=%s\n' "$EIDETIC_DISTRO"
  )"
  [[ "$output" == *"RESULT=$expected"* ]] || {
    printf '%s did not resolve to %s:\n%s\n' "$name" "$expected" "$output" >&2
    exit 1
  }
  printf 'PASS %s -> %s\n' "$name" "$expected"
}

expect_rejected() {
  local name="$1" expected_error="$2" root="$3" output
  if output="$(
    {
      EIDETIC_ROOT="$root"
      export EIDETIC_ROOT
      eidetic_detect_platform
    } 2>&1
  )"; then
    printf '%s was unexpectedly supported\n' "$name" >&2
    exit 1
  fi
  [[ "$output" == *"$expected_error"* ]] || {
    printf '%s returned the wrong diagnostic:\n%s\n' "$name" "$output" >&2
    exit 1
  }
  printf 'PASS %s rejected: %s\n' "$name" "$expected_error"
}

root="$(make_fixture modern-rpios debian arm64 RaspberryPi raspberrypi,3-model-b package)"
expect_supported "Raspberry Pi OS modern ID=debian" raspios "$root"

root="$(make_fixture rpi-3b-plus debian arm64 RaspberryPi raspberrypi,3-model-b-plus rpi-issue sys)"
expect_supported "Raspberry Pi 3B+ Device Tree fallback" raspios "$root"

root="$(make_fixture raspbian raspbian arm64 RaspberryPi none none)"
expect_supported "ID=raspbian Trixie arm64" raspios "$root"

root="$(make_fixture generic-debian debian arm64 GNOME none none)"
expect_rejected "generic Debian arm64" "generic Debian is not supported" "$root"

root="$(make_fixture pi-no-marker debian arm64 RaspberryPi raspberrypi,3-model-b none)"
expect_rejected "Debian on Raspberry Pi without OS marker" "Raspberry Pi OS marker missing" "$root"

root="$(make_fixture fake-marker debian arm64 RaspberryPi brcm,bcm2711 repository)"
expect_rejected "Debian with marker but non-Raspberry-Pi hardware" "generic Debian is not supported" "$root"

root="$(make_fixture headless debian arm64 headless raspberrypi,3-model-b package)"
expect_rejected "Raspberry Pi OS headless" "Desktop installation required" "$root"

root="$(make_fixture arm32 debian armhf RaspberryPi raspberrypi,3-model-b package)"
expect_rejected "Raspberry Pi OS 32-bit" "unsupported architecture" "$root"

root="$(make_fixture ubuntu-amd64 ubuntu amd64 GNOME none none)"
expect_supported "Ubuntu 26.04 amd64" ubuntu "$root"

root="$(make_fixture ubuntu-arm64 ubuntu arm64 GNOME none none)"
expect_supported "Ubuntu 26.04 arm64" ubuntu "$root"

root="$(make_fixture staging-does-not-read-host debian arm64 RaspberryPi none package)"
expect_rejected "staging root without Device Tree" "generic Debian is not supported" "$root"

if grep -qi microsoft /proc/version 2>/dev/null; then
  if output="$(
    {
      EIDETIC_ROOT=/
      export EIDETIC_ROOT
      eidetic_detect_platform
    } 2>&1
  )"; then
    printf 'real WSL installation was unexpectedly supported\n' >&2
    exit 1
  fi
  [[ "$output" == *"real installation under WSL is unsupported"* ]] || {
    printf 'WSL rejection diagnostic missing:\n%s\n' "$output" >&2
    exit 1
  }
  printf 'PASS real WSL installation rejected\n'
else
  printf 'SKIP real WSL rejection (not running under WSL)\n'
fi

printf 'Platform detection fixtures passed.\n'
