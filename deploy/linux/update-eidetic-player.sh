#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
EIDETIC_ROOT=/
git_ref=
dry_run=0
no_restart=0
rollback=0

choice_to_flag() {
  [[ "$1" == 1 ]] && printf yes || printf no
}

usage() { printf 'Usage: %s [--ref REF] [--dry-run] [--root PATH] [--no-restart] [--rollback] [--help]\n' "$0"; }
while (($#)); do
  case "$1" in
    --ref) git_ref="${2:-}"; shift 2;;
    --root) EIDETIC_ROOT="${2:-}"; shift 2;;
    --dry-run) dry_run=1; shift;;
    --no-restart) no_restart=1; shift;;
    --rollback) rollback=1; shift;;
    --help) usage; exit 0;;
    *) eidetic_die "unknown option: $1";;
  esac
done
[[ "$EIDETIC_ROOT" == "/" ]] || eidetic_validate_root "$EIDETIC_ROOT"
export EIDETIC_ROOT
eidetic_require_root
conf="$(eidetic_target /etc/eidetic-player/install.conf)"
[[ -r "$conf" ]] || eidetic_die "Eidetic Player is not installed"
# shellcheck disable=SC1090
. "$conf"
git_ref="${git_ref:-${EIDETIC_GIT_REF:-main}}"
eidetic_validate_ref "$git_ref"
backend_host="${BACKEND_HOST:-127.0.0.1}"
backend_port="${BACKEND_PORT:-4310}"
opt="$(eidetic_target /opt/eidetic-player)"

if [[ "${BACKEND_HOST+x}" == x ]] || [[ "${BACKEND_PORT+x}" == x ]]; then
  if [[ "${BACKEND_HOST+x}" == x ]] &&
    [[ "$backend_host" != "127.0.0.1" && "$backend_host" != "localhost" ]]; then
    eidetic_die "DECISION REQUIRED: BACKEND_HOST=$backend_host is not supported in production"
  fi
  if ! [[ "$backend_port" =~ ^[0-9]+$ ]] || ((backend_port < 1 || backend_port > 65535)); then
    eidetic_die "DECISION REQUIRED: BACKEND_PORT=$backend_port is invalid in production"
  fi
  if [[ "${BACKEND_PORT+x}" == x && "$backend_port" != "4310" ]]; then
    eidetic_die "DECISION REQUIRED: BACKEND_PORT=$backend_port is not supported in this release"
  fi
fi

if ((rollback)); then
  [[ -L "$opt/previous" ]] || eidetic_die "no previous release is available"
  eidetic_log "Rollback plan: current -> $(readlink "$opt/previous")"
  ((dry_run)) && exit 0
  old="$(readlink "$opt/current")"
  previous="$(readlink "$opt/previous")"
  ln -sfn "$previous" "$opt/current.new"; mv -Tf "$opt/current.new" "$opt/current"
  ln -sfn "$old" "$opt/previous.new"; mv -Tf "$opt/previous.new" "$opt/previous"
  exit 0
fi

mode="${EIDETIC_INSTALLATION_MODE:-standard}"
if [[ "$mode" != "appliance" ]]; then
  mode=standard
fi

if [[ "$mode" == "standard" ]]; then
  autostart=0
  fullscreen=0
  borderless=0
  blanking=0
  pointer=0
  splash=0
  autologin=0
else
  autostart="${EIDETIC_AUTOSTART:-0}"
  fullscreen="${EIDETIC_FULLSCREEN:-0}"
  if [[ "${EIDETIC_BORDERLESS+x}" == x ]]; then
    borderless="${EIDETIC_BORDERLESS}"
  else
    borderless=1
  fi
  blanking="${EIDETIC_DISABLE_BLANKING:-0}"
  pointer="${EIDETIC_HIDE_POINTER:-0}"
  splash="${EIDETIC_SPLASH:-0}"
  autologin="${EIDETIC_AUTOLOGIN:-0}"
fi

args=(--user "$EIDETIC_RUNTIME_USER" --ref "$git_ref" --mode "$mode" --unattended
  --autostart "$(choice_to_flag "$autostart")" --fullscreen "$(choice_to_flag "$fullscreen")"
  --borderless "$(choice_to_flag "$borderless")"
  --disable-blanking "$(choice_to_flag "$blanking")"
  --hide-pointer "$(choice_to_flag "$pointer")"
  --splash "$(choice_to_flag "$splash")" --autologin "$(choice_to_flag "$autologin")"
  --rpi-onscreen-keyboard "${EIDETIC_RPI_ONSCREEN_KEYBOARD:-keep}")
[[ "$EIDETIC_ROOT" == "/" ]] || args+=(--root "$EIDETIC_ROOT")
((dry_run)) && args+=(--dry-run)
BACKEND_HOST="$backend_host" BACKEND_PORT="$backend_port" \
  "$SCRIPT_DIR/install-eidetic-player.sh" "${args[@]}"
((no_restart)) || [[ "$EIDETIC_ROOT" != "/" ]] || runuser -u "$EIDETIC_RUNTIME_USER" -- systemctl --user try-restart eidetic-player.service
