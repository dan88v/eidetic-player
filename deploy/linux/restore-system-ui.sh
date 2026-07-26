#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
EIDETIC_ROOT=/
dry_run=0
include_power_integration=0
usage() { printf 'Usage: %s [--dry-run] [--root PATH] [--help]\n' "$0"; }
while (($#)); do
  case "$1" in
    --dry-run) dry_run=1; shift;;
    --root) [[ $# -ge 2 ]] || eidetic_die "--root needs a value"; EIDETIC_ROOT="$2"; shift 2;;
    --include-power-integration) include_power_integration=1; shift;;
    --help) usage; exit 0;;
    *) eidetic_die "unknown option: $1";;
  esac
done
[[ "$EIDETIC_ROOT" == "/" ]] || eidetic_validate_root "$EIDETIC_ROOT"
export EIDETIC_ROOT
eidetic_require_root
keyboard_state_file="$(eidetic_target /var/lib/eidetic-player/rpi-onscreen-keyboard-v1)"
if [[ -f "$keyboard_state_file" ]]; then
  keyboard_state="$(<"$keyboard_state_file")"
  case "$keyboard_state" in
    always-on | autodetect | always-off) ;;
    *) eidetic_die "invalid saved Raspberry Pi OS on-screen keyboard state" ;;
  esac
  if ((dry_run)); then
    eidetic_log "Would restore Raspberry Pi OS on-screen keyboard: $keyboard_state"
  else
    eidetic_require_rpi_keyboard_support
    eidetic_set_rpi_keyboard_state "$keyboard_state" ||
      eidetic_die "failed to restore the Raspberry Pi OS on-screen keyboard"
    [[ "$(eidetic_get_rpi_keyboard_state)" == "$keyboard_state" ]] ||
      eidetic_die "Raspberry Pi OS on-screen keyboard restore verification failed"
  fi
fi
manifest="$(eidetic_target /var/lib/eidetic-player/system-ui-manifest-v1.tsv)"
backups="$(eidetic_target /var/lib/eidetic-player/backups)"
[[ -e "$manifest" ]] || { eidetic_log "No Eidetic system UI manifest is present."; exit 0; }
mapfile -t records < <(grep '^file	' "$manifest" | tac)
preserved_records=()
for record in "${records[@]}"; do
  IFS=$'\t' read -r _ logical existed key mode ownership hash <<<"$record"
  if (( ! include_power_integration )); then
    case "$logical" in
      /usr/libexec/eidetic-player-power-helper | /etc/polkit-1/rules.d/49-eidetic-player-power.rules)
        preserved_records+=("$record")
        continue
        ;;
    esac
  fi
  target="$(eidetic_target "$logical")"
  [[ ! -L "$target" ]] || eidetic_die "refusing administrative symlink: $logical"
  if ((dry_run)); then
    eidetic_log "Would restore $logical (original=$existed, sha256=$hash)"
    continue
  fi
  if [[ "$existed" == 1 ]]; then
    backup="$backups/$key"
    [[ -f "$backup" ]] || eidetic_die "missing backup for $logical"
    [[ "$(eidetic_sha256 "$backup")" == "$hash" ]] || eidetic_die "backup checksum mismatch for $logical"
    install -d -m 0755 "$(dirname "$target")"
    install -m "$mode" "$backup" "${target}.eidetic-restore"
    if [[ "$ownership" != "-:-" && "$EIDETIC_ROOT" == "/" ]]; then
      chown "$ownership" "${target}.eidetic-restore"
    fi
    mv -f -- "${target}.eidetic-restore" "$target"
  elif [[ -e "$target" ]]; then
    rm -f -- "$target"
  fi
done
if (( ! dry_run )); then
  printf '# eidetic-system-ui-manifest-v1\n' >"$manifest"
  for record in "${preserved_records[@]}"; do
    printf '%s\n' "$record" >>"$manifest"
  done
fi
if (( ! dry_run )) && [[ "$EIDETIC_ROOT" == "/" ]]; then
  theme_file="$(eidetic_target /var/lib/eidetic-player/plymouth-previous-theme)"
  if [[ -s "$theme_file" ]] && command -v plymouth-set-default-theme >/dev/null; then
    plymouth-set-default-theme "$(<"$theme_file")"
    update-initramfs -u
  fi
  command -v update-grub >/dev/null && update-grub
fi
eidetic_log "Eidetic-managed system UI files restored."
