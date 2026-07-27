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
full_verify=0
verbose=0
no_color=0
unattended=0
guided=1
SOURCE_REMOTE="$EIDETIC_SOURCE_REMOTE"

choice_to_flag() {
  [[ "$1" == 1 ]] && printf yes || printf no
}

usage() {
  cat <<'EOF'
Usage: sudo ./deploy/linux/update-eidetic-player.sh [options]

Without options, the updater starts the guided procedure.

  --ref REF        Update to a branch, tag or exact 40-character commit SHA
  --dry-run        Resolve and display the plan without changing the system
  --root PATH      Use an isolated staging root
  --no-restart     Activate files without restarting or runtime verification
  --rollback       Switch atomically to the previous verified release
  --full-verify    Run the complete application verification suite
  --unattended     Never prompt
  -v, --verbose    Show sanitized commands and live process output
  --no-color       Disable terminal colors
  -h, --help       Show this help
  --version        Show updater provenance
EOF
}

while (($#)); do
  guided=0
  case "$1" in
    -v | --verbose) verbose=1; shift ;;
    --no-color) no_color=1; shift ;;
    --unattended) unattended=1; shift ;;
    --ref) [[ $# -ge 2 ]] || eidetic_die "--ref needs a value"; git_ref="$2"; shift 2 ;;
    --root) [[ $# -ge 2 ]] || eidetic_die "--root needs a value"; EIDETIC_ROOT="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --no-restart) no_restart=1; shift ;;
    --rollback) rollback=1; shift ;;
    --full-verify) full_verify=1; shift ;;
    -h | --help) usage; exit 0 ;;
    --version)
      printf 'eidetic-player-linux-updater %s\n' "$(eidetic_project_version)"
      exit 0
      ;;
    *) eidetic_die "unknown option: $1" ;;
  esac
done

if ((unattended)); then export EIDETIC_CONSOLE_FORCE_NON_TTY=1; fi
if ((guided)) && { [[ ! -t 0 || ! -t 1 ]] &&
  [[ "${EIDETIC_CONSOLE_FORCE_TTY:-0}" != 1 ]]; }; then
  printf 'Error: guided update requires an interactive terminal. Use --unattended with explicit options.\n' >&2
  exit 64
fi
((verbose)) && export EIDETIC_CONSOLE_VERBOSE=1
((no_color)) && export EIDETIC_CONSOLE_NO_COLOR=1
eidetic_console_init update "Linux Updater" "$EIDETIC_ROOT" \
  "$(eidetic_project_version)" || exit 1
export EIDETIC_CONSOLE_PHASE_TOTAL=$((rollback ? 5 : 7))
rollback_result="not required"
cleanup() {
  local status="$1"
  eidetic_console_abort_active_phase
  if ((status != 0)); then
    eidetic_console_failure_panel "UPDATE FAILED" \
      "${EIDETIC_FAILURE_REASON:-The update did not complete.}" \
      "$status" "$rollback_result"
  fi
  eidetic_console_finalize
  return "$status"
}
trap 'cleanup "$?"' EXIT

[[ "$EIDETIC_ROOT" == "/" ]] || eidetic_validate_root "$EIDETIC_ROOT"
export EIDETIC_ROOT
eidetic_require_root
conf="$(eidetic_target /etc/eidetic-player/install.conf)"
[[ -r "$conf" ]] || eidetic_die "Eidetic Player is not installed"
administrative_path="$PATH"
# shellcheck disable=SC1090
. "$conf"
PATH="$administrative_path"
export PATH
git_ref="${git_ref:-${EIDETIC_GIT_REF:-main}}"
eidetic_validate_ref "$git_ref"
backend_host="${BACKEND_HOST:-127.0.0.1}"
backend_port="${BACKEND_PORT:-4310}"
opt="$(eidetic_target /opt/eidetic-player)"
node_path="$(eidetic_target /opt/eidetic-player/node/current/bin/node)"
runtime_uid="${EIDETIC_RUNTIME_UID:-$(id -u "$EIDETIC_RUNTIME_USER")}"
current_manifest="$opt/current/build-info.json"

read_manifest_field() {
  local manifest="$1" field="$2"
  if [[ "$EIDETIC_ROOT" != "/" ]]; then
    local value
    value="$(
      sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" \
        "$manifest" | head -n 1
    )"
    case "$field" in
      commitSha) [[ "$value" =~ ^[0-9a-f]{40}$ ]] || return 1 ;;
      shortCommitSha) [[ "$value" =~ ^[0-9a-f]{7}$ ]] || return 1 ;;
      *) return 1 ;;
    esac
    printf '%s' "$value"
    return
  fi
  [[ -x "$node_path" && -r "$manifest" ]] || return 1
  "$node_path" -e '
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const field = value[process.argv[2]];
if (typeof field !== "string") process.exit(1);
process.stdout.write(field);
' "$manifest" "$field"
}

systemctl_user() {
  /usr/sbin/runuser -u "$EIDETIC_RUNTIME_USER" -- env \
    "XDG_RUNTIME_DIR=/run/user/$runtime_uid" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$runtime_uid/bus" \
    systemctl --user "$@"
}

switch_releases() {
  local current_target previous_target
  [[ -L "$opt/current" && -L "$opt/previous" ]] ||
    return 1
  current_target="$(readlink "$opt/current")"
  previous_target="$(readlink "$opt/previous")"
  [[ -d "$opt/$previous_target" ]] ||
    return 1
  ln -sfn "$previous_target" "$opt/current.new"
  mv -Tf "$opt/current.new" "$opt/current"
  ln -sfn "$current_target" "$opt/previous.new"
  mv -Tf "$opt/previous.new" "$opt/previous"
}

probe_build() {
  local expected="$1" require_mpv="$2" response_file
  response_file="$(mktemp)"
  if ! curl --silent --show-error --max-time 2 --fail \
    "http://${backend_host}:${backend_port}/api/readiness" \
    >"$response_file"; then
    rm -f -- "$response_file"
    return 1
  fi
  "$node_path" -e '
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const expected = process.argv[2];
const requireMpv = process.argv[3] === "1";
if (value?.buildInfo?.commitSha !== expected) process.exit(2);
if (requireMpv && value?.mpvAvailable !== true) process.exit(3);
' "$response_file" "$expected" "$require_mpv"
  local result=$?
  rm -f -- "$response_file"
  return "$result"
}

wait_for_build() {
  local expected="$1" timeout="$2" require_mpv="$3" deadline
  deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    if systemctl_user is-active --quiet eidetic-player.service &&
      probe_build "$expected" "$require_mpv"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_legacy_release() {
  local timeout="$1" deadline
  deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    if systemctl_user is-active --quiet eidetic-player.service &&
      curl --silent --max-time 2 --fail \
        "http://${backend_host}:${backend_port}/api/readiness" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_previous_release() {
  if [[ -n "$current_sha" ]]; then
    wait_for_build "$current_sha" 60 0
  else
    wait_for_legacy_release 60
  fi
}

rollback_after_hard_failure() {
  local reason="$1"
  EIDETIC_FAILURE_REASON="$reason"
  eidetic_console_abort_active_phase
  if switch_releases && systemctl_user restart eidetic-player.service &&
    wait_for_previous_release; then
    if [[ -n "$current_sha" ]]; then
      rollback_result="previous release restored and verified"
    else
      rollback_result="previous legacy release restored; service and backend verified"
    fi
  else
    rollback_result="automatic rollback could not be verified; manual recovery is required"
  fi
  exit 1
}

eidetic_console_phase_begin "Installed release"
current_target="$(readlink "$opt/current")"
if current_sha="$(read_manifest_field "$current_manifest" commitSha)"; then
  current_short="${current_sha:0:7}"
else
  current_sha=
  current_release_name="${current_target##*/}"
  if [[ "$current_release_name" =~ -([0-9a-f]{7,40})(-[0-9]+)?$ ]]; then
    current_short="${BASH_REMATCH[1]:0:7}"
  else
    current_short=unknown
  fi
  eidetic_console_warning \
    "Installed release has legacy/unknown provenance; full-SHA up-to-date comparison is unavailable."
fi
eidetic_console_phase_done

if ((rollback)); then
  eidetic_console_phase_begin "Rollback target"
  previous_manifest="$opt/previous/build-info.json"
  if previous_sha="$(read_manifest_field "$previous_manifest" commitSha)"; then
    previous_short="${previous_sha:0:7}"
  else
    previous_sha=
    previous_target="$(readlink "$opt/previous")"
    previous_release_name="${previous_target##*/}"
    if [[ "$previous_release_name" =~ -([0-9a-f]{7,40})(-[0-9]+)?$ ]]; then
      previous_short="${BASH_REMATCH[1]:0:7}"
    else
      previous_short=unknown
    fi
    eidetic_console_warning \
      "Previous release has legacy/unknown provenance; rollback can verify service/backend health only."
  fi
  eidetic_console_phase_done
  eidetic_console_section "Rollback summary"
  eidetic_console_info "  Current              $current_short"
  eidetic_console_info "  Target               $previous_short"
  if ((dry_run)); then
    eidetic_console_info "Dry-run complete: no release or service was changed."
    exit 0
  fi
  if ((guided)); then
    eidetic_prompt_yes_no "Proceed with rollback?" yes ||
      eidetic_die "rollback confirmation input ended unexpectedly"
    [[ "$EIDETIC_PROMPT_RESULT" == yes ]] || exit 0
  fi
  eidetic_console_phase_begin "Atomic rollback"
  switch_releases || eidetic_die "previous release could not be activated atomically"
  eidetic_console_phase_done
  if ((no_restart)) || [[ "$EIDETIC_ROOT" != "/" ]]; then
    eidetic_console_phase_skipped "Service restart"
    eidetic_console_phase_skipped "Rollback health"
    eidetic_console_info "Rollback activated without runtime verification."
    exit 0
  fi
  eidetic_console_phase_begin "Service restart"
  systemctl_user restart eidetic-player.service
  eidetic_console_phase_done
  eidetic_console_phase_begin "Rollback health"
  if [[ -n "$previous_sha" ]]; then
    wait_for_build "$previous_sha" 60 0 ||
      eidetic_die "rolled-back release did not pass Build-ID health verification; manual recovery is required"
  else
    wait_for_legacy_release 60 ||
      eidetic_die "rolled-back legacy release did not pass service/backend health verification; manual recovery is required"
  fi
  eidetic_console_phase_done
  eidetic_console_section "Rollback completed successfully."
  exit 0
fi

eidetic_console_phase_begin "Target resolution"
staging_target_explicit=0
if [[ "$EIDETIC_ROOT" != "/" ]]; then
  target_sha="${EIDETIC_UPDATE_TARGET_SHA:-0000000000000000000000000000000000000000}"
  [[ -z "${EIDETIC_UPDATE_TARGET_SHA:-}" ]] || staging_target_explicit=1
elif [[ "$git_ref" =~ ^[0-9a-f]{40}$ ]]; then
  target_sha="$git_ref"
else
  mapfile -t remote_matches < <(
    timeout 15 git ls-remote --exit-code "$SOURCE_REMOTE" \
      "$git_ref" "refs/heads/$git_ref" "refs/tags/$git_ref" |
      awk 'NR <= 10 { print $1 }'
  )
  ((${#remote_matches[@]} > 0 && ${#remote_matches[@]} <= 10)) ||
    eidetic_die "target ref could not be resolved safely"
  target_sha="${remote_matches[${#remote_matches[@]} - 1]}"
fi
[[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] ||
  eidetic_die "target did not resolve to an exact commit SHA"
target_short="${target_sha:0:7}"
eidetic_console_phase_done

if [[ -n "$current_sha" ]] &&
  { [[ "$EIDETIC_ROOT" == "/" ]] || ((staging_target_explicit)); } &&
  [[ "$current_sha" == "$target_sha" ]]; then
  eidetic_console_plain_log "Already up to date."
  printf 'Already up to date.\n' >&3
  exit 0
fi

eidetic_console_section "Update summary"
eidetic_console_info "  Installed build      $current_short"
eidetic_console_info "  Target build         $target_short"
eidetic_console_info "  Ref                  $git_ref"
eidetic_console_info "  Mode                 ${EIDETIC_INSTALLATION_MODE:-standard}"
eidetic_console_info "  Runtime user         $EIDETIC_RUNTIME_USER"
eidetic_console_info "  Application data     Preserved"
eidetic_console_info "  GPIO/I2S             $([[ "${EIDETIC_GPIO_I2S_DAC:-0}" == 1 ]] && printf 'Pre-existing, preserved' || printf 'Not configured')"
eidetic_console_info "  Configuration        Preserved"
eidetic_console_info "  Restart              $([[ "$no_restart" == 1 ]] && printf skipped || printf required)"
eidetic_console_info "  Reboot               Never"
if ((guided)); then
  eidetic_prompt_yes_no "Update from $current_short to $target_short?" yes ||
    eidetic_die "update confirmation input ended unexpectedly"
  if [[ "$EIDETIC_PROMPT_RESULT" == no ]]; then
    eidetic_console_plain_log "Final status: cancelled"
    eidetic_console_info "Update cancelled before any change."
    exit 0
  fi
fi
if ((dry_run)); then
  eidetic_console_plain_log "Final status: dry-run"
  eidetic_console_info "Dry-run complete: no release or service was changed."
  exit 0
fi

mode="${EIDETIC_INSTALLATION_MODE:-standard}"
if [[ "$mode" != "appliance" ]]; then
  mode=standard
fi
if [[ "$mode" == "standard" ]]; then
  autostart=0 fullscreen=0 borderless=0 blanking=0 pointer=0 splash=0 autologin=0
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

args=(--user "$EIDETIC_RUNTIME_USER" --ref "$git_ref"
  --resolved-commit "$target_sha" --mode "$mode" --unattended
  --autostart "$(choice_to_flag "$autostart")" --fullscreen "$(choice_to_flag "$fullscreen")"
  --borderless "$(choice_to_flag "$borderless")"
  --disable-blanking "$(choice_to_flag "$blanking")"
  --hide-pointer "$(choice_to_flag "$pointer")"
  --splash "$(choice_to_flag "$splash")" --autologin "$(choice_to_flag "$autologin")"
  --rpi-onscreen-keyboard "${EIDETIC_RPI_ONSCREEN_KEYBOARD:-keep}")
[[ "${EIDETIC_GPIO_I2S_DAC:-0}" != 1 ]] || args+=(--gpio-i2s-dac)
[[ "$EIDETIC_ROOT" == "/" ]] || args+=(--root "$EIDETIC_ROOT")
((full_verify)) && args+=(--full-verify)
((verbose)) && args+=(--verbose)
((no_color)) && args+=(--no-color)

eidetic_console_phase_begin "Build, stage and activate"
BACKEND_HOST="$backend_host" BACKEND_PORT="$backend_port" \
  "$SCRIPT_DIR/install-eidetic-player.sh" "${args[@]}"
eidetic_console_phase_done

if ((no_restart)) || [[ "$EIDETIC_ROOT" != "/" ]]; then
  eidetic_console_phase_skipped "Service restart"
  eidetic_console_phase_skipped "Hard health verification"
  eidetic_console_phase_skipped "Player readiness"
  eidetic_console_phase_begin "Finalization"
  eidetic_console_phase_done
  eidetic_console_section "Update completed successfully."
  eidetic_console_info "New build $target_short is active; runtime verification was intentionally skipped."
  exit 0
fi

eidetic_console_phase_begin "Service restart"
systemctl_user restart eidetic-player.service ||
  rollback_after_hard_failure "new release service could not be restarted"
eidetic_console_phase_done

eidetic_console_phase_begin "Hard health verification"
if ! wait_for_build "$target_sha" 60 0; then
  rollback_after_hard_failure "new release failed hard health verification"
fi
eidetic_console_phase_done

eidetic_console_phase_begin "Player readiness"
if wait_for_build "$target_sha" 120 1; then
  eidetic_console_phase_done
else
  eidetic_console_abort_active_phase
  eidetic_console_warning \
    "MPV was not ready within 120 seconds; backend health and Build ID are valid, so the new release remains active."
fi

eidetic_console_phase_begin "Finalization"
eidetic_console_phase_done
eidetic_console_section "Update completed successfully."
eidetic_console_info "  Build                $target_short"
eidetic_console_info "  Release              $(readlink "$opt/current")"
eidetic_console_info "  Service              active"
eidetic_console_info "  Reboot               not performed"
eidetic_console_info "  Log                  $EIDETIC_LOG_PATH"
eidetic_console_warning_summary
