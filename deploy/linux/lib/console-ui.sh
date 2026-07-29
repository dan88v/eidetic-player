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
EIDETIC_CONSOLE_EMBEDDED=0
EIDETIC_PARENT_LOG_FD=${EIDETIC_PARENT_LOG_FD:-}
EIDETIC_FAILURE_SUBSTEP_LABEL=
EIDETIC_RUNTIME_ACTIVE_ID=
EIDETIC_RUNTIME_ACTIVE_INDEX=0
EIDETIC_RUNTIME_COMPLETED=0
EIDETIC_RUNTIME_TOTAL=0
EIDETIC_RUNTIME_STARTED_MS=
EIDETIC_RUNTIME_ELAPSED_MS=
EIDETIC_RUNTIME_CHILD_PID=
EIDETIC_RUNTIME_RELAY_PID=
EIDETIC_RUNTIME_READ_FD=
EIDETIC_RUNTIME_WRITE_FD=
EIDETIC_CONSOLE_STARTED_MS=
declare -A EIDETIC_RUNTIME_LABELS=(
  [prepare-source]="Prepare isolated source"
  [install-dependencies]="Install production build dependencies"
  [typecheck]="Type-check application"
  [verify-installer]="Verify Linux installer contract"
  [format-check]="Check source formatting"
  [lint]="Lint source"
  [test-suite]="Run application test suite"
  [test-posix]="Run POSIX platform tests"
  [test-case-sensitive]="Check case-sensitive imports"
  [clean-build]="Clean build outputs"
  [generate-build-info]="Generate build provenance"
  [generate-shell-config]="Generate production shell configuration"
  [build-ui]="Build user interface"
  [build-backend]="Build backend"
  [sync-neutralino]="Synchronize Neutralino runtime"
  [package-neutralino]="Package Neutralino release"
  [verify-runtime]="Verify Linux runtime artifacts"
)
declare -A EIDETIC_RUNTIME_COMMANDS=(
  [prepare-source]="git fetch isolated source"
  [install-dependencies]="npm ci"
  [typecheck]="npm run typecheck"
  [verify-installer]="npm run verify:linux:installer"
  [format-check]="npm run format:check"
  [lint]="npm run lint"
  [test-suite]="npm test"
  [test-posix]="npm run test:posix"
  [test-case-sensitive]="npm run test:case-sensitive"
  [clean-build]="npm run clean"
  [generate-build-info]="npm run build:info"
  [generate-shell-config]="npm run shell:config:prod"
  [build-ui]="npm run build:ui"
  [build-backend]="npm run build:backend"
  [sync-neutralino]="npm run neutralino:sync"
  [package-neutralino]="npm run neutralino:build"
  [verify-runtime]="node scripts/verify-linux-release.ts --phase build"
)
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
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  if [[ "$EIDETIC_CONSOLE_EMBEDDED" == 1 ]]; then
    [[ "$EIDETIC_PARENT_LOG_FD" =~ ^[0-9]+$ ]] || return 0
    printf '%s\n' "$line" >&"$EIDETIC_PARENT_LOG_FD"
  elif [[ -n "${EIDETIC_LOG_PATH:-}" ]]; then
    printf '%s\n' "$line" >>"$EIDETIC_LOG_PATH"
  fi
}

eidetic_console_write() {
  local style="$1" plain="$2" code='' reset=''
  if [[ "$EIDETIC_CONSOLE_EMBEDDED" == 1 ]]; then
    eidetic_console_plain_log "$plain"
    return
  fi
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
  if [[ "$EIDETIC_CONSOLE_EMBEDDED" == 1 ]]; then
    eidetic_console_plain_log "$*"
    return
  fi
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
  EIDETIC_CONSOLE_STARTED_MS="$(eidetic_console_monotonic_ms)"
  eidetic_console_plain_log "Eidetic Player $subtitle"
  eidetic_console_plain_log "Version: $version"
  eidetic_console_plain_log "Verbose: $EIDETIC_CONSOLE_VERBOSE"
  eidetic_console_header "$subtitle"
  if [[ "$EIDETIC_LOG_FALLBACK" == 1 ]]; then
    eidetic_console_warning "Using protected fallback log: $EIDETIC_LOG_PATH"
  fi
}

eidetic_console_init_embedded() {
  local parent="${1:-}" progress_fd="${EIDETIC_PROGRESS_FD:-}"
  local parent_log_fd="${EIDETIC_PARENT_LOG_FD:-}"
  [[ "$parent" == update ]] || {
    printf 'Error: unknown embedded installer parent scope.\n' >&2
    return 1
  }
  [[ "$progress_fd" =~ ^[0-9]+$ && "$parent_log_fd" =~ ^[0-9]+$ ]] || {
    printf 'Error: embedded installer descriptors are not numeric.\n' >&2
    return 1
  }
  { : >&"$progress_fd"; } 2>/dev/null || {
    printf 'Error: embedded installer progress descriptor is not open.\n' >&2
    return 1
  }
  { : >&"$parent_log_fd"; } 2>/dev/null || {
    printf 'Error: embedded installer parent log descriptor is not open.\n' >&2
    return 1
  }
  exec 3>&1 4>&2
  eidetic_console_detect
  EIDETIC_CONSOLE_EMBEDDED=1
  EIDETIC_CONSOLE_ACTIVE=1
  EIDETIC_CONSOLE_STARTED_MS="$(eidetic_console_monotonic_ms)"
  EIDETIC_LOG_PATH="parent update log"
  eidetic_console_plain_log "Embedded installer started for updater"
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

eidetic_runtime_progress() {
  local completed="$1" total="$2" width=20 filled empty bar
  ((total > 0)) || return 0
  filled=$((completed * width / total))
  empty=$((width - filled))
  printf -v bar '%*s' "$filled" ''
  bar="${bar// /#}"
  printf -v empty '%*s' "$empty" ''
  empty="${empty// /-}"
  eidetic_console_write dim \
    "  Runtime progress [$bar$empty] $completed/$total"
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
  if [[ "$EIDETIC_CONSOLE_EMBEDDED" == 1 ]]; then
    EIDETIC_CONSOLE_PHASE_LABEL="$label"
    return
  fi
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
  [[ "$EIDETIC_CONSOLE_EMBEDDED" != 1 ]] || return 0
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
  [[ "$EIDETIC_CONSOLE_EMBEDDED" != 1 ]] || {
    EIDETIC_CONSOLE_PHASE_LABEL="$label"
    return 0
  }
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
  if [[ -n "${EIDETIC_RUNTIME_CHILD_PID:-}" ]]; then
    kill "$EIDETIC_RUNTIME_CHILD_PID" 2>/dev/null || true
    wait "$EIDETIC_RUNTIME_CHILD_PID" 2>/dev/null || true
    EIDETIC_RUNTIME_CHILD_PID=
  fi
  if [[ -n "${EIDETIC_RUNTIME_RELAY_PID:-}" ]]; then
    kill "$EIDETIC_RUNTIME_RELAY_PID" 2>/dev/null || true
    wait "$EIDETIC_RUNTIME_RELAY_PID" 2>/dev/null || true
    EIDETIC_RUNTIME_RELAY_PID=
  fi
  [[ -z "${EIDETIC_RUNTIME_READ_FD:-}" ]] ||
    exec {EIDETIC_RUNTIME_READ_FD}<&- 2>/dev/null || true
  [[ -z "${EIDETIC_RUNTIME_WRITE_FD:-}" ]] ||
    exec {EIDETIC_RUNTIME_WRITE_FD}>&- 2>/dev/null || true
  EIDETIC_RUNTIME_READ_FD=
  EIDETIC_RUNTIME_WRITE_FD=
}

eidetic_console_monotonic_ms() {
  local uptime whole fraction
  if read -r uptime _ </proc/uptime 2>/dev/null; then
    whole="${uptime%%.*}"
    fraction="${uptime#*.}000"
    fraction="${fraction:0:3}"
    printf '%s\n' "$((10#$whole * 1000 + 10#$fraction))"
  else
    printf '%s\n' "$((SECONDS * 1000))"
  fi
}

eidetic_console_duration() {
  local milliseconds="${1:-0}" seconds
  [[ "$milliseconds" =~ ^[0-9]+$ ]] || milliseconds=0
  seconds=$((milliseconds / 1000))
  printf '%02d:%02d' "$((seconds / 60))" "$((seconds % 60))"
}

eidetic_console_total_elapsed_ms() {
  local now
  now="$(eidetic_console_monotonic_ms)"
  if [[ -n "${EIDETIC_CONSOLE_STARTED_MS:-}" ]]; then
    printf '%s\n' "$((now - EIDETIC_CONSOLE_STARTED_MS))"
  else
    printf '0\n'
  fi
}

eidetic_runtime_configure() {
  local full="${1:-0}"
  EIDETIC_RUNTIME_TOTAL=12
  [[ "$full" != 1 ]] || EIDETIC_RUNTIME_TOTAL=17
  EIDETIC_RUNTIME_ACTIVE_ID=
  EIDETIC_RUNTIME_ACTIVE_INDEX=0
  EIDETIC_RUNTIME_COMPLETED=0
  EIDETIC_RUNTIME_ELAPSED_MS=
}

eidetic_runtime_begin() {
  EIDETIC_RUNTIME_STARTED_MS="$(eidetic_console_monotonic_ms)"
  [[ "$EIDETIC_CONSOLE_EMBEDDED" == 1 ]] || eidetic_console_spinner_stop
}

eidetic_runtime_finish() {
  local now
  now="$(eidetic_console_monotonic_ms)"
  if [[ -n "$EIDETIC_RUNTIME_STARTED_MS" ]]; then
    export EIDETIC_RUNTIME_ELAPSED_MS=$((now - EIDETIC_RUNTIME_STARTED_MS))
  fi
  EIDETIC_RUNTIME_ACTIVE_ID=
  EIDETIC_RUNTIME_ACTIVE_INDEX=0
}

eidetic_runtime_expected_id() {
  local index="$1" full="${2:-0}"
  local -a default_ids=(
    prepare-source install-dependencies typecheck verify-installer clean-build
    generate-build-info generate-shell-config build-ui build-backend
    sync-neutralino package-neutralino verify-runtime
  )
  local -a full_ids=(
    prepare-source install-dependencies typecheck verify-installer format-check
    lint test-suite test-posix test-case-sensitive clean-build
    generate-build-info generate-shell-config build-ui build-backend
    sync-neutralino package-neutralino verify-runtime
  )
  if [[ "$full" == 1 ]]; then
    printf '%s' "${full_ids[index - 1]:-}"
  else
    printf '%s' "${default_ids[index - 1]:-}"
  fi
}

eidetic_runtime_emit_external() {
  local event="$1" id="$2" index="$3" elapsed="${4:-}"
  [[ "$EIDETIC_CONSOLE_EMBEDDED" == 1 ]] || return 0
  if [[ "$event" == start ]]; then
    printf 'EIDETIC_PROGRESS_V1\truntime\t%s\t%s\t%s\t%s\n' \
      "$event" "$id" "$index" "$EIDETIC_RUNTIME_TOTAL" >&"$EIDETIC_PROGRESS_FD"
  else
    printf 'EIDETIC_PROGRESS_V1\truntime\t%s\t%s\t%s\t%s\t%s\n' \
      "$event" "$id" "$index" "$EIDETIC_RUNTIME_TOTAL" "$elapsed" \
      >&"$EIDETIC_PROGRESS_FD"
  fi
}

eidetic_runtime_render_event() {
  local event="$1" id="$2" index="$3" elapsed="${4:-0}"
  local label="${EIDETIC_RUNTIME_LABELS[$id]}" duration
  duration="$(eidetic_console_duration "$elapsed")"
  if [[ "$EIDETIC_CONSOLE_EMBEDDED" == 1 ]]; then
    eidetic_runtime_emit_external "$event" "$id" "$index" "$elapsed"
    return
  fi
  case "$event" in
    start)
      eidetic_console_plain_log "COMMAND: ${EIDETIC_RUNTIME_COMMANDS[$id]}"
      if [[ "$EIDETIC_CONSOLE_TTY" == 1 ]]; then
        eidetic_console_write accent "  [$index/$EIDETIC_RUNTIME_TOTAL] $label"
        eidetic_runtime_progress "$((index - 1))" "$EIDETIC_RUNTIME_TOTAL"
      else
        eidetic_console_write plain \
          "RUNTIME STEP $index/$EIDETIC_RUNTIME_TOTAL START $label"
      fi
      if [[ "$EIDETIC_CONSOLE_VERBOSE" == 1 ]]; then
        eidetic_console_write dim "  $ ${EIDETIC_RUNTIME_COMMANDS[$id]}"
      fi
      eidetic_console_spinner_start
      ;;
    "done")
      eidetic_console_spinner_stop
      if [[ "$EIDETIC_CONSOLE_TTY" == 1 ]]; then
        eidetic_console_write success "  $label ($duration)"
        eidetic_runtime_progress "$index" "$EIDETIC_RUNTIME_TOTAL"
      else
        eidetic_console_write plain \
          "RUNTIME STEP $index/$EIDETIC_RUNTIME_TOTAL DONE $label $duration"
      fi
      ;;
    skipped)
      eidetic_console_spinner_stop
      if [[ "$EIDETIC_CONSOLE_TTY" == 1 ]]; then
        eidetic_console_write dim "  SKIPPED: $label ($duration)"
        eidetic_runtime_progress "$index" "$EIDETIC_RUNTIME_TOTAL"
      else
        eidetic_console_write plain \
          "RUNTIME STEP $index/$EIDETIC_RUNTIME_TOTAL SKIPPED $label $duration"
      fi
      ;;
    failed)
      eidetic_console_spinner_stop
      if [[ "$EIDETIC_CONSOLE_TTY" == 1 ]]; then
        eidetic_console_write error "FAILED: $label ($duration)"
      else
        eidetic_console_write plain \
          "RUNTIME STEP $index/$EIDETIC_RUNTIME_TOTAL FAILED $label $duration"
      fi
      ;;
  esac
}

eidetic_runtime_accept_line() {
  local line="$1" full="${2:-0}" magic scope event id index total elapsed extra
  local expected
  ((${#line} <= 256)) || {
    eidetic_console_plain_log "WARNING: ignored oversized runtime progress record"
    return 1
  }
  [[ "$line" != *[$'\001'-$'\010'$'\013'$'\014'$'\016'-$'\037'$'\177']* ]] || {
    eidetic_console_plain_log "WARNING: ignored runtime progress record with control characters"
    return 1
  }
  IFS=$'\t' read -r magic scope event id index total elapsed extra <<<"$line"
  [[ -z "${extra:-}" ]] || return 1
  [[ "$magic" == EIDETIC_PROGRESS_V1 && "$scope" == runtime ]] || return 1
  [[ "$event" == start || "$event" == "done" || "$event" == skipped ||
    "$event" == failed ]] || return 1
  [[ "$id" =~ ^[a-z][a-z0-9-]{0,31}$ ]] || return 1
  [[ -v "EIDETIC_RUNTIME_LABELS[$id]" ]] || return 1
  [[ "$index" =~ ^[0-9]+$ && "$total" =~ ^[0-9]+$ ]] || return 1
  ((index >= 1 && index <= EIDETIC_RUNTIME_TOTAL)) || return 1
  ((total == EIDETIC_RUNTIME_TOTAL)) || return 1
  expected="$(eidetic_runtime_expected_id "$index" "$full")"
  [[ "$id" == "$expected" ]] || return 1
  if [[ "$event" == start ]]; then
    [[ -z "${elapsed:-}" ]] || return 1
    ((index == EIDETIC_RUNTIME_COMPLETED + 1)) || return 1
    [[ -z "$EIDETIC_RUNTIME_ACTIVE_ID" ]] || return 1
    EIDETIC_RUNTIME_ACTIVE_ID="$id"
    EIDETIC_RUNTIME_ACTIVE_INDEX="$index"
    EIDETIC_FAILURE_SUBSTEP_LABEL="${EIDETIC_RUNTIME_LABELS[$id]}"
  else
    [[ "$elapsed" =~ ^[0-9]+$ ]] || return 1
    [[ "$EIDETIC_RUNTIME_ACTIVE_ID" == "$id" &&
      "$EIDETIC_RUNTIME_ACTIVE_INDEX" == "$index" ]] || return 1
    if [[ "$event" == "done" || "$event" == skipped ]]; then
      EIDETIC_RUNTIME_COMPLETED="$index"
      EIDETIC_FAILURE_SUBSTEP_LABEL=
    fi
    EIDETIC_RUNTIME_ACTIVE_ID=
    EIDETIC_RUNTIME_ACTIVE_INDEX=0
  fi
  eidetic_runtime_render_event "$event" "$id" "$index" "${elapsed:-0}"
}

eidetic_runtime_local_event() {
  local event="$1" id="$2" index="$3" elapsed="${4:-}"
  local line
  if [[ "$event" == start ]]; then
    printf -v line 'EIDETIC_PROGRESS_V1\truntime\t%s\t%s\t%s\t%s' \
      "$event" "$id" "$index" "$EIDETIC_RUNTIME_TOTAL"
  else
    printf -v line 'EIDETIC_PROGRESS_V1\truntime\t%s\t%s\t%s\t%s\t%s' \
      "$event" "$id" "$index" "$EIDETIC_RUNTIME_TOTAL" "$elapsed"
  fi
  eidetic_runtime_accept_line "$line" "${EIDETIC_RUNTIME_FULL_VERIFY:-0}"
}

eidetic_runtime_run_step() {
  local id="$1" index="$2" started ended status terminal_event
  shift 2
  started="$(eidetic_console_monotonic_ms)"
  eidetic_runtime_local_event start "$id" "$index"
  set +e
  "$@"
  status=$?
  set -e
  ended="$(eidetic_console_monotonic_ms)"
  if [[ "$status" == 0 ]]; then
    terminal_event="done"
  else
    terminal_event=failed
  fi
  eidetic_runtime_local_event \
    "$terminal_event" "$id" "$index" "$((ended - started))"
  return "$status"
}

eidetic_runtime_run_protocol_child() {
  local full="$1" progress_fd read_fd relay_read_fd relay_write_fd
  local status relay_status
  local previous_progress_fd="${EIDETIC_PROGRESS_FD:-}" had_progress_fd=0
  shift
  [[ -z "${EIDETIC_PROGRESS_FD+x}" ]] || had_progress_fd=1
  coproc EIDETIC_PROGRESS_RELAY { cat; }
  relay_read_fd="${EIDETIC_PROGRESS_RELAY[0]}"
  relay_write_fd="${EIDETIC_PROGRESS_RELAY[1]}"
  exec {read_fd}<&"$relay_read_fd"
  if [[ ! -e /proc/"$BASHPID"/fd/8 ]]; then
    exec 8>"/proc/$BASHPID/fd/$relay_write_fd"
    progress_fd=8
  elif [[ ! -e /proc/"$BASHPID"/fd/20 ]]; then
    exec 20>"/proc/$BASHPID/fd/$relay_write_fd"
    progress_fd=20
  elif [[ ! -e /proc/"$BASHPID"/fd/30 ]]; then
    exec 30>"/proc/$BASHPID/fd/$relay_write_fd"
    progress_fd=30
  elif [[ ! -e /proc/"$BASHPID"/fd/7 ]]; then
    exec 7>"/proc/$BASHPID/fd/$relay_write_fd"
    progress_fd=7
  elif [[ ! -e /proc/"$BASHPID"/fd/6 ]]; then
    exec 6>"/proc/$BASHPID/fd/$relay_write_fd"
    progress_fd=6
  else
    exec {read_fd}<&-
    exec {relay_read_fd}<&-
    exec {relay_write_fd}>&-
    wait "$EIDETIC_PROGRESS_RELAY_PID" 2>/dev/null || true
    eidetic_console_plain_log \
      "ERROR: no dedicated runtime progress descriptor is available"
    return 70
  fi
  exec {relay_read_fd}<&-
  exec {relay_write_fd}>&-
  EIDETIC_RUNTIME_READ_FD="$read_fd"
  EIDETIC_RUNTIME_WRITE_FD="$progress_fd"
  EIDETIC_RUNTIME_RELAY_PID="$EIDETIC_PROGRESS_RELAY_PID"
  export EIDETIC_PROGRESS_FD="$progress_fd"
  if [[ "$progress_fd" == 8 ]]; then
    "$@" 8>&8 &
  elif [[ "$progress_fd" == 20 ]]; then
    "$@" 20>&20 &
  elif [[ "$progress_fd" == 30 ]]; then
    "$@" 30>&30 &
  elif [[ "$progress_fd" == 7 ]]; then
    "$@" 7>&7 &
  else
    "$@" 6>&6 &
  fi
  EIDETIC_RUNTIME_CHILD_PID=$!
  if [[ "$had_progress_fd" == 1 ]]; then
    export EIDETIC_PROGRESS_FD="$previous_progress_fd"
  else
    unset EIDETIC_PROGRESS_FD
  fi
  if [[ "$progress_fd" == 8 ]]; then
    exec 8>&-
  elif [[ "$progress_fd" == 20 ]]; then
    exec 20>&-
  elif [[ "$progress_fd" == 30 ]]; then
    exec 30>&-
  elif [[ "$progress_fd" == 7 ]]; then
    exec 7>&-
  else
    exec 6>&-
  fi
  EIDETIC_RUNTIME_WRITE_FD=
  while IFS= read -r line <&"$read_fd"; do
    eidetic_runtime_accept_line "$line" "$full" ||
      eidetic_console_plain_log "WARNING: ignored malformed runtime progress record"
  done
  exec {read_fd}<&-
  EIDETIC_RUNTIME_READ_FD=
  set +e
  wait "$EIDETIC_RUNTIME_CHILD_PID"
  status=$?
  wait "$EIDETIC_RUNTIME_RELAY_PID"
  relay_status=$?
  set -e
  EIDETIC_RUNTIME_CHILD_PID=
  EIDETIC_RUNTIME_RELAY_PID=
  ((status != 0)) && return "$status"
  return "$relay_status"
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
  [[ -z "${EIDETIC_FAILURE_SUBSTEP_LABEL:-}" ]] ||
    eidetic_console_info "Substep: $EIDETIC_FAILURE_SUBSTEP_LABEL"
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
