#!/usr/bin/env bash
# Environment bootstrap only; keep application sources unchanged.
set -euo pipefail

repo_url="https://github.com/dan88v/eidetic-player.git"
repo_path="${HOME}/src/eidetic-player"
node_version="24.18.0"
nvm_version="v0.40.4"
skip_packages=false
skip_clone=false

while (($#)); do
  case "$1" in
    --repo-url) repo_url="$2"; shift 2 ;;
    --repo-path) repo_path="${2/#\~/${HOME}}"; shift 2 ;;
    --node-version) node_version="$2"; shift 2 ;;
    --skip-packages) skip_packages=true; shift ;;
    --skip-clone) skip_clone=true; shift ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[[ "$(id -u)" -ne 0 ]] || {
  echo "Run this script as a non-root user." >&2
  exit 3
}
[[ -r /etc/os-release ]] || { echo "Unsupported Linux environment." >&2; exit 4; }
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID}" == "debian" ]] || { echo "This script targets Debian." >&2; exit 4; }
printf 'Preparing Debian %s (%s) as %s\n' "${VERSION_ID}" "$(uname -m)" "$(id -un)"

core_packages=(
  git curl ca-certificates build-essential pkg-config jq file binutils procps
  psmisc lsof rsync unzip zip xz-utils locales xdg-utils desktop-file-utils
  dbus-x11 xvfb wget
)
media_packages=(ffmpeg mpv alsa-utils pulseaudio-utils)
gui_packages=(libgtk-3-0 libwebkit2gtk-4.1-0 libnss3)

if [[ "${skip_packages}" == false ]]; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get full-upgrade -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${core_packages[@]}"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${media_packages[@]}"
  available_gui=()
  for package in "${gui_packages[@]}"; do
    if apt-cache show "${package}" >/dev/null 2>&1; then
      available_gui+=("${package}")
    else
      printf 'WARN: optional package unavailable: %s\n' "${package}" >&2
    fi
  done
  ((${#available_gui[@]})) &&
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${available_gui[@]}"
fi

export NVM_DIR="${HOME}/.nvm"
unset npm_config_prefix
if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
  installer="$(mktemp)"
  trap 'rm -f "${installer}"' EXIT
  curl -fsSLo "${installer}" \
    "https://raw.githubusercontent.com/nvm-sh/nvm/${nvm_version}/install.sh"
  grep -q "nvm-sh/nvm" "${installer}"
  bash "${installer}"
fi
# shellcheck disable=SC1091
source "${NVM_DIR}/nvm.sh"
nvm install "${node_version}"
nvm alias default "${node_version}"
nvm use "${node_version}" >/dev/null

if [[ "${skip_clone}" == false ]]; then
  mkdir -p "$(dirname "${repo_path}")"
  if [[ ! -d "${repo_path}/.git" ]]; then
    git clone "${repo_url}" "${repo_path}"
  fi
  git -C "${repo_path}" remote get-url origin
  git -C "${repo_path}" status --short
  (
    cd "${repo_path}"
    npm ci
    npm run format:check
    npm run typecheck
    npm run lint
    npm run build
    npm test
    git status --short
  )
fi

dbus-run-session -- true
xvfb-run -a sh -c 'test -n "$DISPLAY"'
printf 'Node %s, npm %s, MPV and FFmpeg ready.\n' \
  "$(node --version)" "$(npm --version)"
