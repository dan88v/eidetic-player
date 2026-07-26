#!/usr/bin/env bash
# Each scenario deliberately isolates its console environment in a subshell.
# shellcheck disable=SC2030,SC2031
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

fail() {
  printf 'console UI fixture failed: %s\n' "$*" >&2
  exit 1
}

assert_no_ansi() {
  local file="$1"
  if LC_ALL=C grep -q $'\033\\[' "$file"; then
    fail "ANSI escape found in ${file#"$work"/}"
  fi
}

normal_root="$work/normal"
normal_output="$work/normal.out"
normal_log_path="$work/normal-log-path"
install -d "$normal_root"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_NON_TTY=1
  eidetic_console_init install "Linux Installer" "$normal_root" 0.1.0
  EIDETIC_CONSOLE_PHASE_TOTAL=2
  eidetic_console_phase_begin "Hidden child output"
  printf 'complete child diagnostic\n'
  eidetic_console_phase_done
  eidetic_console_phase_skipped "Optional fixture"
  eidetic_console_command_preview tool --token=do-not-log --safe value
  printf '%s\n' "$EIDETIC_LOG_PATH" >"$normal_log_path"
  eidetic_console_finalize
) >"$normal_output" 2>&1
normal_log="$(<"$normal_log_path")"
grep -q 'STEP 1/2 START Hidden child output' "$normal_output" ||
  fail "non-TTY START line missing"
grep -q 'STEP 1/2 DONE Hidden child output' "$normal_output" ||
  fail "non-TTY DONE line missing"
! grep -q 'complete child diagnostic' "$normal_output" ||
  fail "normal mode exposed child output"
grep -q 'complete child diagnostic' "$normal_log" ||
  fail "normal mode log omitted child output"
grep -q -- '--token=<redacted>' "$normal_log" ||
  fail "sanitized command preview missing"
! grep -q 'do-not-log' "$normal_log" || fail "secret reached log"
[[ "$(stat -c '%a' "$normal_log")" == 600 ]] || fail "log mode is not 0600"
[[ "$(stat -c '%a' "$(dirname "$normal_log")")" == 700 ]] ||
  fail "log directory mode is not 0700"
assert_no_ansi "$normal_log"

color_root="$work/color"
color_output="$work/color.out"
install -d "$color_root"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_TTY=1
  export TERM=xterm-256color
  unset NO_COLOR
  eidetic_console_init install "Linux Installer" "$color_root" 0.1.0
  eidetic_console_success "Color fixture"
  eidetic_console_finalize
) >"$color_output" 2>&1
LC_ALL=C grep -q $'\033\\[' "$color_output" ||
  fail "TTY color output contains no ANSI styling"

for disable_case in no-color no-color-variable dumb non-tty; do
  output="$work/$disable_case.out"
  root="$work/$disable_case"
  install -d "$root"
  (
    # shellcheck source=lib/console-ui.sh
    . "$SCRIPT_DIR/lib/console-ui.sh"
    export EIDETIC_CONSOLE_FORCE_TTY=1
    export TERM=xterm-256color
    unset NO_COLOR
    case "$disable_case" in
      no-color) export EIDETIC_CONSOLE_NO_COLOR=1 ;;
      no-color-variable) export NO_COLOR= ;;
      dumb) export TERM=dumb ;;
      non-tty)
        export EIDETIC_CONSOLE_FORCE_TTY=0
        export EIDETIC_CONSOLE_FORCE_NON_TTY=1
        ;;
    esac
    eidetic_console_init install "Linux Installer" "$root" 0.1.0
    eidetic_console_success "Plain fixture"
    eidetic_console_finalize
  ) >"$output" 2>&1
  assert_no_ansi "$output"
done

prompt_root="$work/prompt"
install -d "$prompt_root"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_NON_TTY=1
  eidetic_console_init install "Linux Installer" "$prompt_root" 0.1.0
  eidetic_prompt_yes_no "Proceed?" no <<< $'invalid\ny'
  [[ "$EIDETIC_PROMPT_RESULT" == yes ]] || fail "yes/no prompt result"
  eidetic_prompt_choice "Choose" 1 2 1 <<< $'9\n2'
  [[ "$EIDETIC_PROMPT_RESULT" == 2 ]] || fail "choice prompt result"
  eidetic_console_finalize
) >"$work/prompt.out" 2>&1
grep -q 'Please answer yes or no' "$work/prompt.out" ||
  fail "invalid yes/no input was not rejected"
grep -q 'Choose a number from 1 to 2' "$work/prompt.out" ||
  fail "invalid numeric choice was not rejected"

verbose_root="$work/verbose"
verbose_log_path="$work/verbose-log-path"
install -d "$verbose_root"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_NON_TTY=1
  EIDETIC_CONSOLE_VERBOSE=1
  eidetic_console_init install "Linux Installer" "$verbose_root" 0.1.0
  EIDETIC_CONSOLE_PHASE_TOTAL=1
  eidetic_console_phase_begin "Verbose child"
  eidetic_console_command_preview printf 'verbose child output'
  printf 'verbose child output\n'
  eidetic_console_phase_done
  set +e
  eidetic_console_capture_start
  bash -c 'exit 37'
  command_status=$?
  eidetic_console_capture_stop
  set -e
  [[ "$command_status" == 37 ]] || fail "command exit code was lost"
  printf '%s\n' "$EIDETIC_LOG_PATH" >"$verbose_log_path"
  eidetic_console_finalize
) >"$work/verbose.out" 2>&1
verbose_log="$(<"$verbose_log_path")"
grep -q 'verbose child output' "$work/verbose.out" ||
  fail "verbose mode hid child output"
grep -q 'verbose child output' "$verbose_log" ||
  fail "verbose log omitted child output"

spinner_root="$work/spinner"
install -d "$spinner_root"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_TTY=1
  export EIDETIC_CONSOLE_NO_COLOR=1
  eidetic_console_init install "Linux Installer" "$spinner_root" 0.1.0
  EIDETIC_CONSOLE_PHASE_TOTAL=1
  eidetic_console_phase_begin "Spinner fixture"
  spinner_pid="$EIDETIC_CONSOLE_SPINNER_PID"
  sleep 0.35
  eidetic_console_phase_done
  [[ -n "$spinner_pid" ]] || fail "spinner did not start"
  ! kill -0 "$spinner_pid" 2>/dev/null || fail "spinner process survived stop"
  eidetic_console_finalize
) >"$work/spinner.out" 2>&1
grep -Eq 'Working 00:0[0-9]' "$work/spinner.out" ||
  fail "spinner elapsed time missing"

interrupt_state="$work/interrupt.state"
interrupt_root="$work/interrupt"
install -d "$interrupt_root"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_TTY=1
  export EIDETIC_CONSOLE_NO_COLOR=1
  active_child=
  # The EXIT trap invokes this callback indirectly.
  # shellcheck disable=SC2317
  interrupt_cleanup() {
    local status="$1"
    eidetic_console_abort_active_phase
    if [[ -n "$active_child" ]]; then
      kill "$active_child" 2>/dev/null || true
      wait "$active_child" 2>/dev/null || true
    fi
    eidetic_console_finalize
    [[ "$status" == 130 ]] || status=130
    exit "$status"
  }
  trap 'exit 130' INT
  trap 'interrupt_cleanup "$?"' EXIT
  eidetic_console_init install "Linux Installer" "$interrupt_root" 0.1.0
  EIDETIC_CONSOLE_PHASE_TOTAL=1
  eidetic_console_phase_begin "Interrupt fixture"
  sleep 30 &
  active_child=$!
  printf '%s %s\n' "$active_child" "$EIDETIC_CONSOLE_SPINNER_PID" \
    >"$interrupt_state"
  wait "$active_child"
) >"$work/interrupt.out" 2>&1 &
interrupt_shell=$!
for _ in $(seq 1 30); do
  [[ -s "$interrupt_state" ]] && break
  sleep 0.1
done
[[ -s "$interrupt_state" ]] || fail "interrupt fixture did not start"
read -r interrupt_child interrupt_spinner <"$interrupt_state"
kill -INT "$interrupt_shell"
set +e
wait "$interrupt_shell"
interrupt_status=$?
set -e
[[ "$interrupt_status" == 130 ]] ||
  fail "SIGINT did not preserve exit code 130"
! kill -0 "$interrupt_child" 2>/dev/null ||
  fail "SIGINT left the active child running"
! kill -0 "$interrupt_spinner" 2>/dev/null ||
  fail "SIGINT left the spinner running"

rotation_root="$work/rotation"
rotation_dir="$rotation_root/var/log/eidetic-player"
install -d -m 0700 "$rotation_dir"
for number in $(seq -w 1 11); do
  printf -v rotation_time '%06d' "$((10#$number))"
  install -m 0600 /dev/null \
    "$rotation_dir/install-20260101-${rotation_time}-100-${number}.log"
done
install -m 0600 /dev/null "$rotation_dir/uninstall-keep.log"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_NON_TTY=1
  eidetic_console_init install "Linux Installer" "$rotation_root" 0.1.0
  eidetic_console_finalize
) >/dev/null 2>&1
[[ "$(find "$rotation_dir" -maxdepth 1 -type f -name 'install-*.log' | wc -l)" == 10 ]] ||
  fail "install log rotation did not retain exactly 10"
[[ -f "$rotation_dir/uninstall-keep.log" ]] ||
  fail "rotation removed a foreign-category file"

symlink_root="$work/symlink"
install -d "$symlink_root/var/log" "$work/symlink-target"
ln -s "$work/symlink-target" "$symlink_root/var/log/eidetic-player"
symlink_log_path="$work/symlink-log-path"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_NON_TTY=1
  eidetic_console_init uninstall "Linux Uninstaller" "$symlink_root" 0.1.0
  printf '%s\n' "$EIDETIC_LOG_PATH" >"$symlink_log_path"
  eidetic_console_finalize
) >/dev/null 2>&1
symlink_log="$(<"$symlink_log_path")"
[[ "$symlink_log" != "$work/symlink-target/"* ]] ||
  fail "unexpected preferred-directory symlink was followed"
[[ -f "$symlink_log" && "$(stat -c '%a' "$symlink_log")" == 600 ]] ||
  fail "fallback log is missing or unsafe"

printf 'Console UI fixtures passed.\n'
