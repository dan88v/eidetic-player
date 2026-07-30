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

runtime_root="$work/runtime"
runtime_output="$work/runtime.out"
runtime_marker="$work/runtime-injection"
install -d "$runtime_root"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_NON_TTY=1
  eidetic_console_init install "Linux Installer" "$runtime_root" 0.1.0
  eidetic_runtime_configure 0
  EIDETIC_RUNTIME_FULL_VERIFY=0
  eidetic_runtime_begin
  eidetic_runtime_local_event start prepare-source 1
  eidetic_runtime_local_event "done" prepare-source 1 999
  eidetic_runtime_local_event start install-dependencies 2
  eidetic_runtime_local_event skipped install-dependencies 2 0
  eidetic_runtime_local_event start typecheck 3
  eidetic_runtime_local_event failed typecheck 3 61000
  [[ "$EIDETIC_FAILURE_SUBSTEP_LABEL" == "Type-check application" ]] ||
    fail "failed runtime substep was not retained"

  for malformed in \
    $'EIDETIC_PROGRESS_V2\truntime\tstart\tprepare-source\t1\t12' \
    $'EIDETIC_PROGRESS_V1\tforeign\tstart\tprepare-source\t1\t12' \
    $'EIDETIC_PROGRESS_V1\truntime\tstart\tunknown\t1\t12' \
    $'EIDETIC_PROGRESS_V1\truntime\tstart\tprepare-source\tx\t12' \
    $'EIDETIC_PROGRESS_V1\truntime\tstart\tprepare-source\t0\t12' \
    $'EIDETIC_PROGRESS_V1\truntime\tstart\tprepare-source\t1\t99' \
    $'EIDETIC_PROGRESS_V1\truntime\tdone\tprepare-source\t1\t12\t-1' \
    $'EIDETIC_PROGRESS_V1\truntime\tstart\tprepare-source\t1\t12\textra' \
    $'EIDETIC_PROGRESS_V1\truntime\tstart\t$(touch '"$runtime_marker"$')\t1\t12' \
    $'EIDETIC_PROGRESS_V1\truntime\tstart\tprepare-source\t1\t12\001'; do
    eidetic_runtime_accept_line "$malformed" 0 && fail "malformed record accepted"
  done
  oversized="EIDETIC_PROGRESS_V1"
  printf -v oversized '%-300s' "$oversized"
  eidetic_runtime_accept_line "$oversized" 0 &&
    fail "oversized record accepted"
  [[ ! -e "$runtime_marker" ]] || fail "protocol text was executed"
  eidetic_runtime_finish
  eidetic_console_finalize
) >"$runtime_output" 2>&1 || {
  cat "$runtime_output" >&2
  fail "runtime protocol fixture exited unexpectedly"
}
grep -q 'RUNTIME STEP 1/12 START Prepare isolated source' "$runtime_output" ||
  fail "runtime START line missing"
grep -q 'RUNTIME STEP 1/12 DONE Prepare isolated source 00:00' "$runtime_output" ||
  fail "runtime DONE duration missing"
grep -q 'RUNTIME STEP 2/12 SKIPPED Install production build dependencies 00:00' \
  "$runtime_output" || fail "runtime SKIPPED line missing"
grep -q 'RUNTIME STEP 3/12 FAILED Type-check application 01:01' "$runtime_output" ||
  fail "runtime FAILED duration missing"
! grep -q 'EIDETIC_PROGRESS_V1' "$runtime_output" ||
  fail "raw protocol was rendered"
assert_no_ansi "$runtime_output"
! LC_ALL=C grep -q $'\r' "$runtime_output" ||
  fail "non-TTY runtime output contains a carriage return"

protocol_child_root="$work/protocol-child"
protocol_child_output="$work/protocol-child.out"
protocol_job_progress="$work/protocol-job.progress"
install -d "$protocol_child_root"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  export EIDETIC_CONSOLE_FORCE_NON_TTY=1
  eidetic_console_init update "Linux Updater" "$protocol_child_root" 0.1.0
  eidetic_runtime_configure 0
  # Called indirectly by the protocol runner.
  # shellcheck disable=SC2317
  protocol_fixture_child() {
    [[ "$EIDETIC_PROGRESS_FD" == 30 ]] || return 71
    printf 'human stdout must not become progress\n'
    printf 'EIDETIC_PROGRESS_V1\truntime\tstart\tprepare-source\t1\t12\n' \
      >&"$EIDETIC_PROGRESS_FD"
    printf 'EIDETIC_PROGRESS_V1\truntime\tdone\tprepare-source\t1\t12\t4\n' \
      >&"$EIDETIC_PROGRESS_FD"
  }
  exec 6>/dev/null
  exec 7>/dev/null
  exec 8>/dev/null
  exec {protocol_job_fd}>"$protocol_job_progress"
  export EIDETIC_UPDATE_JOB_FD="$protocol_job_fd"
  protocol_owned_fd20=0
  if [[ ! -e /proc/"$BASHPID"/fd/20 ]]; then
    exec 20>/dev/null
    protocol_owned_fd20=1
  fi
  eidetic_runtime_run_protocol_child 0 protocol_fixture_child
  # Called indirectly by the protocol runner.
  # shellcheck disable=SC2317
  external_protocol_fixture() {
    export EIDETIC_PROGRESS_FD
    bash -c \
      'test "$EIDETIC_PROGRESS_FD" = 30 || exit 71; printf "EIDETIC_PROGRESS_V1\truntime\tstart\tinstall-dependencies\t2\t12\n" >&"$EIDETIC_PROGRESS_FD"; printf "EIDETIC_PROGRESS_V1\truntime\tdone\tinstall-dependencies\t2\t12\t5\n" >&"$EIDETIC_PROGRESS_FD"'
  }
  eidetic_runtime_run_protocol_child 0 external_protocol_fixture
  exec 6>&-
  exec 7>&-
  exec 8>&-
  if [[ "$protocol_owned_fd20" == 1 ]]; then
    exec 20>&-
  fi
  exec {protocol_job_fd}>&-
  unset EIDETIC_UPDATE_JOB_FD
  [[ -z "$EIDETIC_RUNTIME_CHILD_PID" &&
    -z "$EIDETIC_RUNTIME_RELAY_PID" &&
    -z "$EIDETIC_RUNTIME_READ_FD" &&
    -z "$EIDETIC_RUNTIME_WRITE_FD" ]] ||
    fail "protocol reader descriptors or children survived EOF"
  eidetic_console_finalize
) >"$protocol_child_output" 2>&1 || {
  cat "$protocol_child_output" >&2
  fail "dedicated protocol child fixture exited unexpectedly"
}
grep -q 'RUNTIME STEP 1/12 DONE Prepare isolated source' "$protocol_child_output" ||
  {
    cat "$protocol_child_output" >&2
    fail "dedicated protocol pipe was not consumed"
  }
grep -q 'RUNTIME STEP 2/12 DONE Install production build dependencies' \
  "$protocol_child_output" ||
  {
    cat "$protocol_child_output" >&2
    fail "progress descriptor was not inherited by an external child"
  }
grep -q 'human stdout must not become progress' "$protocol_child_output" ||
  fail "protocol fixture stdout unexpectedly disappeared"
grep -q $'^EIDETIC_PROGRESS_V1\truntime\tstart\tprepare-source\t1\t12$' \
  "$protocol_job_progress" ||
  fail "runtime progress was not forwarded to the update job"
grep -q $'^EIDETIC_PROGRESS_V1\truntime\tdone\tinstall-dependencies\t2\t12\t5$' \
  "$protocol_job_progress" ||
  fail "external child progress was not forwarded to the update job"

embedded_output="$work/embedded.out"
embedded_log="$work/embedded.log"
embedded_progress="$work/embedded.progress"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  exec {parent_log_fd}>>"$embedded_log"
  exec {parent_progress_fd}>"$embedded_progress"
  export EIDETIC_PARENT_LOG_FD="$parent_log_fd"
  export EIDETIC_PROGRESS_FD="$parent_progress_fd"
  eidetic_console_init_embedded update
  eidetic_console_header "Linux Installer"
  eidetic_console_section "Installation summary"
  eidetic_console_info "embedded technical record"
  eidetic_runtime_configure 0
  eidetic_runtime_local_event start prepare-source 1
  eidetic_runtime_local_event "done" prepare-source 1 8
  eidetic_console_finalize
  exec {parent_log_fd}>&-
  exec {parent_progress_fd}>&-
) >"$embedded_output" 2>&1
[[ ! -s "$embedded_output" ]] ||
  {
    cat "$embedded_output" >&2
    fail "embedded installer rendered a second human console"
  }
grep -q 'embedded technical record' "$embedded_log" ||
  fail "embedded installer omitted parent technical log output"
! grep -q 'EIDETIC_PROGRESS_V1' "$embedded_log" ||
  fail "raw embedded protocol reached the parent log"
grep -q $'^EIDETIC_PROGRESS_V1\truntime\tstart\tprepare-source\t1\t12$' \
  "$embedded_progress" || fail "embedded progress did not use its dedicated FD"
(
  # shellcheck source=lib/console-ui.sh
  . "$SCRIPT_DIR/lib/console-ui.sh"
  EIDETIC_PROGRESS_FD=2 EIDETIC_PARENT_LOG_FD=999 \
    eidetic_console_init_embedded unknown
) >/dev/null 2>&1 && fail "invalid embedded parent or descriptors were accepted"

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
