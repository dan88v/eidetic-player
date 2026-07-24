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
opt="$(eidetic_target /opt/eidetic-player)"
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
args=(--user "$EIDETIC_RUNTIME_USER" --ref "$git_ref" --mode "$EIDETIC_INSTALLATION_MODE" --unattended
  --autostart "$([[ "${EIDETIC_AUTOSTART:-0}" == 1 ]] && printf yes || printf no)" --fullscreen "$([[ "${EIDETIC_FULLSCREEN:-0}" == 1 ]] && printf yes || printf no)"
  --disable-blanking "$([[ "${EIDETIC_DISABLE_BLANKING:-0}" == 1 ]] && printf yes || printf no)"
  --hide-pointer "$([[ "${EIDETIC_HIDE_POINTER:-0}" == 1 ]] && printf yes || printf no)"
  --splash "$([[ "${EIDETIC_SPLASH:-0}" == 1 ]] && printf yes || printf no)" --autologin "$([[ "${EIDETIC_AUTOLOGIN:-0}" == 1 ]] && printf yes || printf no)"
  --rpi-onscreen-keyboard "${EIDETIC_RPI_ONSCREEN_KEYBOARD:-keep}")
[[ "$EIDETIC_ROOT" == "/" ]] || args+=(--root "$EIDETIC_ROOT")
((dry_run)) && args+=(--dry-run)
"$SCRIPT_DIR/install-eidetic-player.sh" "${args[@]}"
((no_restart)) || [[ "$EIDETIC_ROOT" != "/" ]] || runuser -u "$EIDETIC_RUNTIME_USER" -- systemctl --user try-restart eidetic-player.service
