#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

EIDETIC_ROOT=/
dry_run=0
purge=0
yes=0
unattended=0
guided=1
remove_gpio_i2s_dac=0
gpio_dac_removed=0
uninstall_cancelled=0

usage() {
  cat <<'EOF'
Usage: sudo ./deploy/linux/uninstall-eidetic-player.sh [options]

Without technical options, the uninstaller starts the guided procedure.
Application data and useful backups are preserved by default.

Common options:
  -v, --verbose               Show sanitized commands and live process output
  --no-color                  Disable terminal colors
  -h, --help                  Show this help
  --version                   Show uninstaller provenance

Automation and technical options:
  --unattended                Never prompt
  --dry-run                   Show the removal plan only
  --root PATH                 Use an isolated staging root
  --remove-gpio-i2s-dac      Remove only a proven Eidetic-managed DAC block
  --purge-data                Remove application data
  --yes-really-purge-data    Required together with --purge-data

Guided data removal requires typing DELETE exactly. The purge flags are the
explicit unattended equivalent; neither choice removes media, NAS, or USB data.

Examples:
  sudo ./deploy/linux/uninstall-eidetic-player.sh
  sudo ./deploy/linux/uninstall-eidetic-player.sh -v
  sudo ./deploy/linux/uninstall-eidetic-player.sh --unattended
EOF
}

while (($#)); do
  case "$1" in
    -v | --verbose) EIDETIC_CONSOLE_VERBOSE=1; shift ;;
    --no-color) export EIDETIC_CONSOLE_NO_COLOR=1; shift ;;
    --unattended) guided=0; unattended=1; shift ;;
    --root)
      [[ $# -ge 2 ]] || eidetic_die "--root needs a value"
      EIDETIC_ROOT="$2"
      shift 2
      ;;
    --dry-run) guided=0; dry_run=1; shift ;;
    --purge-data) guided=0; purge=1; shift ;;
    --yes-really-purge-data) guided=0; yes=1; shift ;;
    --remove-gpio-i2s-dac) guided=0; remove_gpio_i2s_dac=1; shift ;;
    -h | --help) usage; exit 0 ;;
    --version)
      printf 'eidetic-player-linux-uninstaller %s\n' "$(eidetic_project_version)"
      exit 0
      ;;
    *) eidetic_die "unknown option: $1" ;;
  esac
done

if ((unattended)); then export EIDETIC_CONSOLE_FORCE_NON_TTY=1; fi
uninstaller_version="$(eidetic_project_version)"
eidetic_console_init uninstall "Linux Uninstaller" "$EIDETIC_ROOT" \
  "$uninstaller_version" || exit 1

uninstall_exit() {
  local status="$1"
  eidetic_console_abort_active_phase
  if ((status != 0)); then
    if [[ "$uninstall_cancelled" == 1 ]]; then
      eidetic_console_info "Uninstallation cancelled by user."
      eidetic_console_info "Log: $EIDETIC_LOG_PATH"
    else
      eidetic_console_failure_panel "UNINSTALLATION FAILED" \
        "${EIDETIC_FAILURE_REASON:-The current operation did not complete.}" \
        "$status" "not available for partial uninstall"
    fi
  fi
  eidetic_console_finalize
  return "$status"
}
trap 'uninstall_exit "$?"' EXIT
trap 'uninstall_cancelled=1; exit 130' INT
trap 'uninstall_cancelled=1; exit 143' TERM

if ((guided)) && { [[ ! -t 0 || ! -t 1 ]] &&
  [[ "${EIDETIC_CONSOLE_FORCE_TTY:-0}" != 1 ]]; }; then
  EIDETIC_FAILURE_REASON="Guided uninstall requires an interactive terminal. Use --unattended for automation."
  usage >&3
  exit 64
fi

[[ "$EIDETIC_ROOT" == "/" ]] || eidetic_validate_root "$EIDETIC_ROOT"
export EIDETIC_ROOT
eidetic_require_root
if ((purge && !yes)); then
  eidetic_die "--purge-data requires --yes-really-purge-data"
fi
if ((!purge && yes)); then
  eidetic_die "--yes-really-purge-data requires --purge-data"
fi

export EIDETIC_CONSOLE_PHASE_TOTAL=5
eidetic_console_phase_begin "Installation inventory"
conf="$(eidetic_target /etc/eidetic-player/install.conf)"
runtime_user=
[[ ! -r "$conf" ]] ||
  runtime_user="$(grep '^EIDETIC_RUNTIME_USER=' "$conf" | cut -d= -f2-)"
opt="$(eidetic_target /opt/eidetic-player)"
manifest="$(eidetic_target /var/lib/eidetic-player/system-ui-manifest-v1.tsv)"
gpio_dac_helper="$SCRIPT_DIR/lib/gpio_i2s_dac.py"
gpio_dac_state=unsupported-platform
if command -v python3 >/dev/null; then
  gpio_dac_state="$(
    python3 "$gpio_dac_helper" inspect --root "$EIDETIC_ROOT" --raspberry
  )" || eidetic_die "GPIO/I2S DAC ownership inspection failed"
fi
eidetic_console_phase_done

if ((guided)); then
  eidetic_prompt_yes_no "Remove Eidetic Player application data?" no ||
    eidetic_die "application data choice input ended unexpectedly"
  if [[ "$EIDETIC_PROMPT_RESULT" == yes ]]; then
    eidetic_console_warning \
      "Library, Favorites, settings, Audio Output preference, session, SMB configuration, cache, and application data will be removed."
    printf 'Type DELETE to permanently remove application data: ' >&3
    eidetic_console_plain_log \
      "PROMPT: exact DELETE confirmation requested; response intentionally not logged"
    delete_confirmation=
    IFS= read -r delete_confirmation || true
    if [[ "$delete_confirmation" == DELETE ]]; then
      purge=1
      yes=1
    else
      purge=0
      yes=0
      eidetic_console_warning \
        "DELETE was not confirmed exactly; application data will be preserved."
    fi
    unset delete_confirmation
  fi
fi

if [[ "$gpio_dac_state" == managed ]]; then
  if ((guided)); then
    eidetic_prompt_yes_no \
      "Remove the GPIO/I2S DAC configuration added by Eidetic?" no ||
      eidetic_die "GPIO/I2S DAC removal choice input ended unexpectedly"
    [[ "$EIDETIC_PROMPT_RESULT" != yes ]] || remove_gpio_i2s_dac=1
  fi
elif ((remove_gpio_i2s_dac)); then
  eidetic_console_warning \
    "GPIO/I2S DAC removal skipped: configuration is not proven Eidetic-managed ($gpio_dac_state)."
  remove_gpio_i2s_dac=0
fi

eidetic_console_section "Uninstallation summary"
eidetic_console_info "  Installation         $([[ -e "$opt" ]] && printf detected || printf not-found)"
eidetic_console_info "  Runtime user         ${runtime_user:-unknown}"
eidetic_console_info "  Binaries/services    Will be removed"
eidetic_console_info "  Managed integration  Will be restored when integrity is proven"
eidetic_console_info "  Application data     $([[ "$purge" == 1 ]] && printf 'Will be removed' || printf Preserved)"
eidetic_console_info "  Useful backups       Preserved"
eidetic_console_info "  GPIO/I2S DAC         $(
  if ((remove_gpio_i2s_dac)); then printf 'Will remove managed block'
  else printf 'Preserved (%s)' "$gpio_dac_state"; fi
)"

if ((guided)); then
  eidetic_prompt_yes_no "Proceed with uninstallation?" yes ||
    eidetic_die "uninstall confirmation input ended unexpectedly"
  if [[ "$EIDETIC_PROMPT_RESULT" == no ]]; then
    eidetic_console_info "Uninstallation cancelled before any change."
    exit 0
  fi
fi

eidetic_console_phase_begin "Service shutdown"
if [[ "$EIDETIC_ROOT" == "/" && -n "$runtime_user" ]]; then
  eidetic_console_command_preview runuser -u "$runtime_user" -- \
    systemctl --user stop eidetic-player.service
  /usr/sbin/runuser -u "$runtime_user" -- systemctl --user stop \
    eidetic-player.service 2>/dev/null || true
fi
eidetic_console_phase_done

eidetic_console_phase_begin "Optional GPIO/I2S configuration"
if [[ "$gpio_dac_state" == managed && "$remove_gpio_i2s_dac" == 1 ]]; then
  if ((dry_run)); then
    eidetic_log \
      "Would remove the Eidetic-managed GPIO/I2S DAC block; reboot would be required."
  else
    [[ "$(python3 "$gpio_dac_helper" remove --root "$EIDETIC_ROOT" --raspberry)" == removed ]] ||
      eidetic_die "GPIO/I2S DAC managed block was not removed"
    gpio_dac_removed=1
  fi
else
  eidetic_log "GPIO/I2S DAC configuration preserved ($gpio_dac_state)."
fi
eidetic_console_phase_done

eidetic_console_phase_begin "Managed system restore"
update_state_path="$(eidetic_target /var/lib/eidetic-player/update)"
[[ "$update_state_path" == */var/lib/eidetic-player/update &&
  "$update_state_path" != "/" ]] || eidetic_die "unsafe update state path"
if ((dry_run)); then
  eidetic_log \
    "Would remove the Software Update runner, helper, policy, unit, and runtime state."
  ((!purge)) ||
    eidetic_log "Would remove /etc/eidetic-player/update.conf."
else
  if [[ "$EIDETIC_ROOT" == "/" ]]; then
    systemctl stop eidetic-player-update.service 2>/dev/null || true
  fi
  for update_path in \
    /etc/systemd/system/eidetic-player-update.service \
    /usr/libexec/eidetic-player-update-helper \
    /usr/libexec/eidetic-player-update-runner \
    /usr/libexec/eidetic-player-update-journal.mjs \
    /etc/polkit-1/rules.d/49-eidetic-player-update.rules; do
    target_update_path="$(eidetic_target "$update_path")"
    [[ ! -L "$target_update_path" ]] ||
      eidetic_die "unsafe update integration path"
    rm -f -- "$target_update_path"
  done
  rm -rf -- "$update_state_path"
  ((!purge)) || rm -f -- "$(eidetic_target /etc/eidetic-player/update.conf)"
fi
restore_args=()
[[ "$EIDETIC_ROOT" == "/" ]] || restore_args+=(--root "$EIDETIC_ROOT")
((dry_run)) && restore_args+=(--dry-run)
restore_args+=(--include-power-integration)
"$SCRIPT_DIR/restore-system-ui.sh" "${restore_args[@]}"
eidetic_console_phase_done

eidetic_console_phase_begin "Application removal"
if ((dry_run)); then
  eidetic_log "Would remove $opt; application data choice: $(
    [[ "$purge" == 1 ]] && printf removed || printf preserved
  )."
else
  [[ "$opt" == "$(eidetic_target /opt/eidetic-player)" && "$opt" != "/" ]] ||
    eidetic_die "unsafe install path"
  rm -rf -- "$opt"
  if ((purge)) && [[ -n "$runtime_user" ]]; then
    home="$(getent passwd "$runtime_user" | cut -d: -f6)"
    for relative in \
      .config/eidetic-player \
      .cache/eidetic-player \
      .local/share/eidetic-player; do
      target="$(eidetic_target "$home/$relative")"
      [[ "$target" == *"/eidetic-player" && "$target" != "/" ]] ||
        eidetic_die "unsafe data path"
      rm -rf -- "$target"
    done
  fi
fi
eidetic_console_phase_done

eidetic_console_section "Uninstallation completed successfully."
eidetic_console_info "  Components           Removed"
eidetic_console_info "  Service              Removed"
eidetic_console_info "  System integration   Restored where ownership and integrity were proven"
eidetic_console_info "  Application data     $([[ "$purge" == 1 ]] && printf Removed || printf Preserved)"
eidetic_console_info "  Useful backups       Preserved"
eidetic_console_info "  GPIO/I2S DAC         $([[ "$gpio_dac_removed" == 1 ]] && printf Removed || printf Preserved)"
eidetic_console_info "  Log                  $EIDETIC_LOG_PATH"
eidetic_console_info \
  "Shared APT packages, users, groups, media, shares, USB files, and NetworkManager profiles were preserved."
eidetic_console_warning_summary

if ((gpio_dac_removed)); then
  eidetic_console_warning \
    "GPIO/I2S DAC configuration was removed; a reboot is required and was not performed."
  if ((guided)) && [[ "$EIDETIC_ROOT" == "/" && -t 0 ]]; then
    eidetic_prompt_yes_no "Restart the device now?" no ||
      eidetic_die "reboot choice input ended unexpectedly"
    if [[ "$EIDETIC_PROMPT_RESULT" == yes ]]; then
      systemctl reboot
    else
      eidetic_console_info "Reboot was not performed."
    fi
  fi
fi
