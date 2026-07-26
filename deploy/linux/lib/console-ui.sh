# Focused terminal UI for the Eidetic Player installer tools. This file is
# sourced; it intentionally has no global `set` flags and no external TUI
# dependency.
# shellcheck shell=bash

EIDETIC_CONSOLE_VERBOSE=${EIDETIC_CONSOLE_VERBOSE:-0}
EIDETIC_CONSOLE_NO_COLOR=${EIDETIC_CONSOLE_NO_COLOR:-0}
export EIDETIC_CONSOLE_ACTIVE=0
EIDETIC_CONSOLE_TTY=0
EIDETIC_CONSOLE_COLOR=0
EIDETIC_CONSOLE_CAPTURED=0
EIDETIC_CONSOLE_SPINNER_PID=
EIDETIC_CONSOLE_PHASE=0
EIDETIC_CONSOLE_PHASE_TOTAL=0
EIDETIC_CONSOLE_PHASE_LABEL=
EIDETIC_CONSOLE_WARNINGS=()
EIDETIC_LOG_PATH=
EIDETIC_LOG_FALLBACK=0
export EIDETIC_PROMPT_RESULT=

eidetic_console_detect() {
  if [[ "${EIDETIC_CONSOLE_FORCE_NON_TTY:-0}" == 1 ]]; then
    EIDETIC_CONSOLE_TTY=0
  elif [[ "${EIDETIC_CONSOLE_FORCE_TTY:-0}" == 1 ]] || [[ -t 1 ]]; then
    EIDETIC_CONSOLE_TTY=1
  else
    EIDETIC_CONSOLE_TTY=0
  fi
  if [[ "$EIDETIC_CONSOLE_TTY" == 1 &&
    "$EIDETIC_CONSOLE_NO_COLOR" != 1 &&
    "${TERM:-dumb}" != dumb &&
    ! -v NO_COLOR ]]; then
    EIDETIC_CONSOLE_COLOR=1
  else
    EIDETIC_CONSOLE_COLOR=0
  fi
}

eidetic_console_plain_log() {
  [[ -n "${EIDETIC_LOG_PATH:-}" ]] || return 0
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$EIDETIC_LOG_PATH"
}

eidetic_console_write() {
  local style="$1" plain="$2" code='' reset=''
  if [[ "$EIDETIC_CONSOLE_COLOR" == 1 ]]; then
    case "$style" in
      accent) code=$'\033[1;36m' ;;
      success) code=$'\033[1;32m' ;;
      warning) code=$'\033[1;33m' ;;
      error) code=$'\033[1;31m' ;;
      dim) code=$'\033[2m' ;;
    esac
    reset=$'\033[0m'
  fi
  printf '%s%s%s\n' "$code" "$plain" "$reset" >&3
  eidetic_console_plain_log "$plain"
}

eidetic_console_info() { eidetic_console_write plain "$*"; }
eidetic_console_success() { eidetic_console_write success "DONE: $*"; }
eidetic_console_warning() {
  EIDETIC_CONSOLE_WARNINGS+=("$*")
  eidetic_console_write warning "WARNING: $*"
}
eidetic_console_error() { eidetic_console_write error "FAILED: $*"; }
eidetic_console_section() {
  printf '\n' >&3
  eidetic_console_write accent "$*"
}

eidetic_console_header() {
  local subtitle="$1" width=50 left right
  [[ "$EIDETIC_CONSOLE_TTY" == 1 ]] || {
    eidetic_console_write accent "EIDETIC PLAYER - $subtitle"
    return
  }
  left=$(((width - ${#subtitle}) / 2))
  right=$((width - ${#subtitle} - left))
  eidetic_console_write accent "+--------------------------------------------------+"
  eidetic_console_write accent "|                  EIDETIC PLAYER                  |"
  printf '|%*s%s%*s|\n' "$left" '' "$subtitle" "$right" '' >&3
  eidetic_console_plain_log "$subtitle"
  eidetic_console_write accent "+--------------------------------------------------+"
}

eidetic_console_secure_directory() {
  local directory="$1"
  [[ ! -L "$directory" ]] || return 1
  if [[ -e "$directory" && ! -d "$directory" ]]; then return 1; fi
  install -d -m 0700 "$directory" 2>/dev/null || return 1
  chmod 0700 "$directory" 2>/dev/null || return 1
}

eidetic_console_rotate_logs() {
  local directory="$1" category="$2" entry
  local -a logs=()
  [[ -d "$directory" && ! -L "$directory" ]] || return 1
  while IFS= read -r entry; do
    [[ -f "$entry" && ! -L "$entry" ]] || continue
    logs+=("$entry")
  done < <(
    find -P "$directory" -maxdepth 1 -type f \
      -name "${category}-????????-??????-*.log" -print 2>/dev/null |
      LC_ALL=C sort
  )
  while ((${#logs[@]} > 10)); do
    rm -f -- "${logs[0]}" || return 1
    logs=("${logs[@]:1}")
  done
}

eidetic_console_init_log() {
  local category="$1" root="${2:-/}" preferred fallback stamp candidate attempt
  preferred="${root%/}/var/log/eidetic-player"
  [[ "$root" != / ]] || preferred=/var/log/eidetic-player
  if eidetic_console_secure_directory "$preferred"; then
    fallback="$preferred"
  else
    fallback="$(mktemp -d "${TMPDIR:-/tmp}/eidetic-player-${category}-logs.XXXXXX")" ||
      return 1
    chmod 0700 "$fallback"
    EIDETIC_LOG_FALLBACK=1
  fi
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  for attempt in 0 1 2 3 4 5 6 7 8 9; do
    candidate="$fallback/${category}-${stamp}-${BASHPID}-${attempt}.log"
    if (set -o noclobber; : >"$candidate") 2>/dev/null; then
      EIDETIC_LOG_PATH="$candidate"
      break
    fi
  done
  [[ -n "$EIDETIC_LOG_PATH" ]] || return 1
  chmod 0600 "$EIDETIC_LOG_PATH"
  eidetic_console_rotate_logs "$fallback" "$category" ||
    EIDETIC_CONSOLE_WARNINGS+=("Old $category log rotation could not be completed.")
}

eidetic_console_init() {
  local category="$1" subtitle="$2" root="${3:-/}" version="${4:-unknown}"
  exec 3>&1 4>&2
  eidetic_console_detect
  eidetic_console_init_log "$category" "$root" || {
    printf 'Error: a protected installer log could not be created.\n' >&2
    return 1
  }
  EIDETIC_CONSOLE_ACTIVE=1
  eidetic_console_plain_log "Eidetic Player $subtitle"
  eidetic_console_plain_log "Version: $version"
  eidetic_console_plain_log "Verbose: $EIDETIC_CONSOLE_VERBOSE"
  eidetic_console_header "$subtitle"
  if [[ "$EIDETIC_LOG_FALLBACK" == 1 ]]; then
    eidetic_console_warning "Using protected fallback log: $EIDETIC_LOG_PATH"
  fi
}

eidetic_console_redact_argument() {
  local argument="$1"
  case "${argument,,}" in
    *password=* | *token=* | *secret=* | *credential=* | *passphrase=*)
      printf '%s=<redacted>' "${argument%%=*}"
      ;;
    *) printf '%q' "$argument" ;;
  esac
}

eidetic_console_command_preview() {
  local argument rendered='' separator=''
  for argument in "$@"; do
    rendered+="$separator$(eidetic_console_redact_argument "$argument")"
    separator=' '
  done
  eidetic_console_plain_log "COMMAND: $rendered"
  [[ "$EIDETIC_CONSOLE_VERBOSE" == 1 ]] &&
    eidetic_console_write dim "  $ $rendered"
  return 0
}

eidetic_console_progress() {
  local completed="$1" total="$2" width=20 percent filled empty bar
  ((total > 0)) || return 0
  percent=$((completed * 100 / total))
  filled=$((completed * width / total))
  empty=$((width - filled))
  printf -v bar '%*s' "$filled" ''
  bar="${bar// /#}"
  printf -v empty '%*s' "$empty" ''
  empty="${empty// /-}"
  eidetic_console_write dim "Overall [$bar$empty] $percent%"
}

eidetic_console_spinner_start() {
  local started="$SECONDS"
  [[ "$EIDETIC_CONSOLE_TTY" == 1 &&
    "$EIDETIC_CONSOLE_VERBOSE" != 1 ]] || return 0
  (
    local -a frames=('|' '/' '-' "\\")
    local index=0 elapsed minutes seconds
    while :; do
      elapsed=$((SECONDS - started))
      minutes=$((elapsed / 60))
      seconds=$((elapsed % 60))
      printf '\r  %s Working %02d:%02d' \
        "${frames[index++ % ${#frames[@]}]}" "$minutes" "$seconds" >&3
      sleep 0.2
    done
  ) &
  EIDETIC_CONSOLE_SPINNER_PID=$!
}

eidetic_console_spinner_stop() {
  if [[ -n "${EIDETIC_CONSOLE_SPINNER_PID:-}" ]]; then
    kill "$EIDETIC_CONSOLE_SPINNER_PID" 2>/dev/null || true
    wait "$EIDETIC_CONSOLE_SPINNER_PID" 2>/dev/null || true
    EIDETIC_CONSOLE_SPINNER_PID=
    [[ "$EIDETIC_CONSOLE_TTY" != 1 ]] ||
      printf '\r%*s\r' 32 '' >&3
  fi
}

eidetic_console_capture_start() {
  [[ "$EIDETIC_CONSOLE_CAPTURED" != 1 ]] || return 0
  exec 8>&1 9>&2
  if [[ "$EIDETIC_CONSOLE_VERBOSE" == 1 ]]; then
    exec > >(tee -a "$EIDETIC_LOG_PATH" >&3)
    exec 2> >(tee -a "$EIDETIC_LOG_PATH" >&4)
  else
    exec >>"$EIDETIC_LOG_PATH" 2>&1
  fi
  EIDETIC_CONSOLE_CAPTURED=1
}

eidetic_console_capture_stop() {
  [[ "$EIDETIC_CONSOLE_CAPTURED" == 1 ]] || return 0
  exec 1>&8 2>&9
  exec 8>&- 9>&-
  EIDETIC_CONSOLE_CAPTURED=0
}

eidetic_console_phase_begin() {
  local label="$1"
  EIDETIC_CONSOLE_PHASE=$((EIDETIC_CONSOLE_PHASE + 1))
  EIDETIC_CONSOLE_PHASE_LABEL="$label"
  if [[ "$EIDETIC_CONSOLE_TTY" == 1 ]]; then
    eidetic_console_write accent \
      "[$EIDETIC_CONSOLE_PHASE/$EIDETIC_CONSOLE_PHASE_TOTAL] $label"
    eidetic_console_progress "$((EIDETIC_CONSOLE_PHASE - 1))" \
      "$EIDETIC_CONSOLE_PHASE_TOTAL"
  else
    eidetic_console_write plain \
      "STEP $EIDETIC_CONSOLE_PHASE/$EIDETIC_CONSOLE_PHASE_TOTAL START $label"
  fi
  eidetic_console_capture_start
  eidetic_console_spinner_start
}

eidetic_console_phase_done() {
  eidetic_console_spinner_stop
  eidetic_console_capture_stop
  if [[ "$EIDETIC_CONSOLE_TTY" == 1 ]]; then
    eidetic_console_success "$EIDETIC_CONSOLE_PHASE_LABEL"
    eidetic_console_progress "$EIDETIC_CONSOLE_PHASE" \
      "$EIDETIC_CONSOLE_PHASE_TOTAL"
  else
    eidetic_console_write plain \
      "STEP $EIDETIC_CONSOLE_PHASE/$EIDETIC_CONSOLE_PHASE_TOTAL DONE $EIDETIC_CONSOLE_PHASE_LABEL"
  fi
}

eidetic_console_phase_skipped() {
  local label="$1"
  EIDETIC_CONSOLE_PHASE=$((EIDETIC_CONSOLE_PHASE + 1))
  EIDETIC_CONSOLE_PHASE_LABEL="$label"
  if [[ "$EIDETIC_CONSOLE_TTY" == 1 ]]; then
    eidetic_console_write dim \
      "[$EIDETIC_CONSOLE_PHASE/$EIDETIC_CONSOLE_PHASE_TOTAL] SKIPPED: $label"
    eidetic_console_progress "$EIDETIC_CONSOLE_PHASE" \
      "$EIDETIC_CONSOLE_PHASE_TOTAL"
  else
    eidetic_console_write plain \
      "STEP $EIDETIC_CONSOLE_PHASE/$EIDETIC_CONSOLE_PHASE_TOTAL SKIPPED $label"
  fi
}

eidetic_console_abort_active_phase() {
  eidetic_console_spinner_stop
  eidetic_console_capture_stop
}

eidetic_prompt_yes_no() {
  local question="$1" default="${2:-no}" suffix answer normalized
  [[ "$default" == yes ]] && suffix='[Y/n]' || suffix='[y/N]'
  while :; do
    printf '%s %s: ' "$question" "$suffix" >&3
    eidetic_console_plain_log "PROMPT: $question $suffix"
    if ! IFS= read -r answer; then
      if [[ "$default" == no ]]; then
        EIDETIC_PROMPT_RESULT=no
        return 0
      fi
      return 1
    fi
    normalized="${answer,,}"
    case "$normalized" in
      '') EIDETIC_PROMPT_RESULT="$default"; return 0 ;;
      y | yes) EIDETIC_PROMPT_RESULT=yes; return 0 ;;
      n | no) EIDETIC_PROMPT_RESULT=no; return 0 ;;
      *) eidetic_console_warning "Please answer yes or no." ;;
    esac
  done
}

eidetic_prompt_choice() {
  local question="$1" minimum="$2" maximum="$3" default="${4:-}" answer
  while :; do
    if [[ -n "$default" ]]; then
      printf '%s [%s-%s] (default %s): ' \
        "$question" "$minimum" "$maximum" "$default" >&3
    else
      printf '%s [%s-%s]: ' "$question" "$minimum" "$maximum" >&3
    fi
    eidetic_console_plain_log "PROMPT: $question [$minimum-$maximum]"
    IFS= read -r answer || return 1
    [[ -n "$answer" ]] || answer="$default"
    if [[ "$answer" =~ ^[0-9]+$ ]] &&
      ((answer >= minimum && answer <= maximum)); then
      export EIDETIC_PROMPT_RESULT="$answer"
      return 0
    fi
    eidetic_console_warning "Choose a number from $minimum to $maximum."
  done
}

eidetic_console_failure_panel() {
  local title="$1" reason="$2" status="$3" rollback="${4:-not required}"
  eidetic_console_abort_active_phase
  eidetic_console_section "+--------------------------------------------------+"
  eidetic_console_error "$title"
  eidetic_console_info "Step: ${EIDETIC_CONSOLE_PHASE_LABEL:-Preflight}"
  eidetic_console_info "Reason: $reason"
  eidetic_console_info "Exit code: $status"
  eidetic_console_info "Rollback: $rollback"
  eidetic_console_info "Log: $EIDETIC_LOG_PATH"
  eidetic_console_info "Diagnostics: eidetic-player-doctor"
  if [[ "$EIDETIC_CONSOLE_VERBOSE" != 1 && -r "$EIDETIC_LOG_PATH" ]]; then
    eidetic_console_info "Recent diagnostic excerpt:"
    tail -n 12 "$EIDETIC_LOG_PATH" |
      sed -E \
        's/((password|token|secret|credential|passphrase)[^= ]*)=[^ ]+/\1=<redacted>/Ig' |
      while IFS= read -r line; do printf '  %s\n' "$line" >&3; done
  fi
}

eidetic_console_warning_summary() {
  local warning
  ((${#EIDETIC_CONSOLE_WARNINGS[@]} > 0)) || return 0
  eidetic_console_section "Warnings"
  for warning in "${EIDETIC_CONSOLE_WARNINGS[@]}"; do
    eidetic_console_info "  - $warning"
  done
}

eidetic_console_strip_ansi_log() {
  [[ -f "${EIDETIC_LOG_PATH:-}" && ! -L "$EIDETIC_LOG_PATH" ]] || return 0
  local clean="${EIDETIC_LOG_PATH}.clean"
  LC_ALL=C sed $'s/\033\\[[0-9;?]*[ -\\/]*[@-~]//g' \
    "$EIDETIC_LOG_PATH" >"$clean" &&
    chmod 0600 "$clean" &&
    mv -f -- "$clean" "$EIDETIC_LOG_PATH"
}

eidetic_console_finalize() {
  eidetic_console_abort_active_phase
  eidetic_console_strip_ansi_log || true
  [[ -z "${EIDETIC_LOG_PATH:-}" ]] || chmod 0600 "$EIDETIC_LOG_PATH" 2>/dev/null || true
}
