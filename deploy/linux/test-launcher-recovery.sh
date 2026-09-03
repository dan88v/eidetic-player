#!/usr/bin/env bash
set -euo pipefail

fixture="$(mktemp -d /tmp/eidetic-launcher-recovery.XXXXXX)"
cleanup() {
  [[ "$fixture" == /tmp/eidetic-launcher-recovery.* ]] || return
  rm -rf -- "$fixture"
}
trap cleanup EXIT

mkdir -p "$fixture/bin" "$fixture/release/backend/apps/backend/src" \
  "$fixture/runtime/eidetic-player" "$fixture/state"
: >"$fixture/release/backend/apps/backend/src/index.js"

cat >"$fixture/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${EIDETIC_SYSTEMCTL_LOG:?}"
[[ "$*" != "--user reset-failed eidetic-player.service" ]]
EOF

cat >"$fixture/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=
while (($#)); do
  if [[ "$1" == "--output" ]]; then
    output="$2"
    shift 2
  else
    shift
  fi
done
printf '{}\n' >"$output"
printf '200'
EOF

cat >"$fixture/bin/backend" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${EIDETIC_TEST_SCENARIO:?}" == "backend-exit" ]]; then
  sleep 1
  exit 23
fi
if [[ "$EIDETIC_TEST_SCENARIO" == "backend-hang-on-term" ]]; then
  trap '' TERM INT
  while :; do read -r -t 0.2 || true; done
fi
trap 'exit 0' TERM INT
while :; do sleep 1; done
EOF

cat >"$fixture/release/eidetic-player" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${EIDETIC_TEST_SCENARIO:?}" == "ui-clean-exit" ||
  "$EIDETIC_TEST_SCENARIO" == "backend-hang-on-term" ]]; then
  exit 0
fi
trap 'exit 143' TERM INT
while :; do sleep 1; done
EOF
chmod 0755 "$fixture/bin/curl" "$fixture/bin/backend" \
  "$fixture/bin/systemctl" "$fixture/release/eidetic-player"

verify_cold_service_entrypoint() {
  local entrypoint="$1" final_action="$2"
  : >"$fixture/systemctl.log"
  EIDETIC_SYSTEMCTL_LOG="$fixture/systemctl.log" \
    XDG_RUNTIME_DIR="$fixture/runtime" \
    PATH="$fixture/bin:/usr/bin:/bin" \
    bash "$entrypoint"
  [[ "$(sed -n '1p' "$fixture/systemctl.log")" == \
    "--user reset-failed eidetic-player.service" ]]
  [[ "$(sed -n '2p' "$fixture/systemctl.log")" == \
    "--user $final_action eidetic-player.service" ]]
  [[ "$(wc -l <"$fixture/systemctl.log")" -eq 2 ]]
}

verify_cold_service_entrypoint deploy/linux/runtime/eidetic-player restart
verify_cold_service_entrypoint deploy/linux/runtime/eidetic-player-resume start

run_scenario() {
  local scenario="$1" expected_reason="$2" status=0
  rm -f "$fixture/state/eidetic-player/runtime-recovery.log"
  EIDETIC_TEST_SCENARIO="$scenario" \
    XDG_RUNTIME_DIR="$fixture/runtime" \
    XDG_STATE_HOME="$fixture/state" \
    EIDETIC_NODE_BIN="$fixture/bin/backend" \
    EIDETIC_PLAYER_RELEASE="$fixture/release" \
    EIDETIC_CHILD_TERMINATION_TIMEOUT_SECONDS=2 \
    PATH="$fixture/bin:/usr/bin:/bin" \
    timeout 8 bash deploy/linux/runtime/eidetic-player-launch || status=$?
  if ((status == 0 || status == 124)); then
    printf 'launcher scenario %s returned unexpected status %s\n' "$scenario" "$status" >&2
    exit 1
  fi
  grep -q "reason=$expected_reason" \
    "$fixture/state/eidetic-player/runtime-recovery.log"
  [[ "$(stat -c %a "$fixture/state/eidetic-player/runtime-recovery.log")" == "600" ]]
}

run_scenario ui-clean-exit ui-exit
run_scenario backend-exit backend-exited

run_scenario backend-hang-on-term ui-exit
grep -q 'reason=backend-termination-timeout' \
  "$fixture/state/eidetic-player/runtime-recovery.log"

printf 'Linux launcher and cold-start recovery fixtures passed.\n'
