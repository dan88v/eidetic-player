#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
EIDETIC_ROOT=/
dry_run=0
purge=0
yes=0
usage() { printf 'Usage: %s [--dry-run] [--root PATH] [--purge-data --yes-really-purge-data] [--help]\n' "$0"; }
while (($#)); do
  case "$1" in
    --root) EIDETIC_ROOT="${2:-}"; shift 2;;
    --dry-run) dry_run=1; shift;;
    --purge-data) purge=1; shift;;
    --yes-really-purge-data) yes=1; shift;;
    --help) usage; exit 0;;
    *) eidetic_die "unknown option: $1";;
  esac
done
[[ "$EIDETIC_ROOT" == "/" ]] || eidetic_validate_root "$EIDETIC_ROOT"
export EIDETIC_ROOT
eidetic_require_root
if ((purge && !yes)); then eidetic_die "--purge-data requires --yes-really-purge-data"; fi
conf="$(eidetic_target /etc/eidetic-player/install.conf)"
runtime_user=
[[ ! -r "$conf" ]] || runtime_user="$(grep '^EIDETIC_RUNTIME_USER=' "$conf" | cut -d= -f2-)"
if [[ "$EIDETIC_ROOT" == "/" && -n "$runtime_user" ]]; then
  runuser -u "$runtime_user" -- systemctl --user stop eidetic-player.service 2>/dev/null || true
fi
restore_args=()
[[ "$EIDETIC_ROOT" == "/" ]] || restore_args+=(--root "$EIDETIC_ROOT")
((dry_run)) && restore_args+=(--dry-run)
"$SCRIPT_DIR/restore-system-ui.sh" "${restore_args[@]}"
opt="$(eidetic_target /opt/eidetic-player)"
if ((dry_run)); then eidetic_log "Would remove $opt; application data would be preserved."; exit 0; fi
[[ "$opt" == "$(eidetic_target /opt/eidetic-player)" && "$opt" != "/" ]] || eidetic_die "unsafe install path"
rm -rf -- "$opt"
if ((purge)) && [[ -n "$runtime_user" ]]; then
  home="$(getent passwd "$runtime_user" | cut -d: -f6)"
  for relative in .config/eidetic-player .cache/eidetic-player .local/share/eidetic-player; do
    target="$(eidetic_target "$home/$relative")"
    [[ "$target" == *"/eidetic-player" && "$target" != "/" ]] || eidetic_die "unsafe data path"
    rm -rf -- "$target"
  done
fi
eidetic_log "Uninstalled. Shared APT packages, users, groups, media, shares, USB files and NetworkManager profiles were preserved."
