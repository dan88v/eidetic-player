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
trap 'exit 0' TERM INT
while :; do sleep 1; done
EOF

cat >"$fixture/release/eidetic-player" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${EIDETIC_TEST_SCENARIO:?}" == "ui-clean-exit" ]]; then
  exit 0
fi
trap 'exit 143' TERM INT
while :; do sleep 1; done
EOF
chmod 0755 "$fixture/bin/curl" "$fixture/bin/backend" \
  "$fixture/release/eidetic-player"

run_scenario() {
  local scenario="$1" expected_reason="$2" status=0
  rm -f "$fixture/state/eidetic-player/runtime-recovery.log"
  EIDETIC_TEST_SCENARIO="$scenario" \
    XDG_RUNTIME_DIR="$fixture/runtime" \
    XDG_STATE_HOME="$fixture/state" \
    EIDETIC_NODE_BIN="$fixture/bin/backend" \
    EIDETIC_PLAYER_RELEASE="$fixture/release" \
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

printf 'Linux launcher recovery fixtures passed.\n'
