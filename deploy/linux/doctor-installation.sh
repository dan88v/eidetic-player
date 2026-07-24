#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
EIDETIC_ROOT=/
json=0
while (($#)); do
  case "$1" in --root) EIDETIC_ROOT="${2:-}"; shift 2;; --json) json=1; shift;; --help) printf 'Usage: %s [--root PATH] [--json]\n' "$0"; exit 0;; *) eidetic_die "unknown option: $1";; esac
done
[[ "$EIDETIC_ROOT" == "/" ]] || eidetic_validate_root "$EIDETIC_ROOT"
export EIDETIC_ROOT
status=pass
checks=()
check() { local name="$1" result="$2"; checks+=("$name:$result"); [[ "$result" == pass ]] || status=fail; }
((json)) && EIDETIC_PLATFORM_DIAGNOSTICS=quiet
export EIDETIC_PLATFORM_DIAGNOSTICS
if eidetic_detect_platform 2>/dev/null; then check platform pass; else check platform fail; fi
check current "$([[ -L "$(eidetic_target /opt/eidetic-player/current)" ]] && printf pass || printf fail)"
check node "$([[ -x "$(eidetic_target /opt/eidetic-player/node/current/bin/node)" ]] && printf pass || printf fail)"
check neutralino "$([[ -x "$(eidetic_target /opt/eidetic-player/current/eidetic-player)" ]] && printf pass || printf fail)"
for tool in mpv ffmpeg nmcli dbus-daemon pkexec udisksctl mount.cifs; do
  if [[ "$EIDETIC_ROOT" != "/" ]] || command -v "$tool" >/dev/null; then check "$tool" pass; else check "$tool" fail; fi
done
check maintenance "$([[ -x "$(eidetic_target /usr/local/bin/eidetic-player-maintenance)" ]] && printf pass || printf fail)"
check resume "$([[ -x "$(eidetic_target /usr/local/bin/eidetic-player-resume)" ]] && printf pass || printf fail)"
check manifest "$([[ -r "$(eidetic_target /var/lib/eidetic-player/system-ui-manifest-v1.tsv)" ]] && printf pass || printf fail)"
if ((json)); then
  printf '{"status":"%s","checks":{' "$status"
  sep=
  for item in "${checks[@]}"; do printf '%s"%s":"%s"' "$sep" "${item%%:*}" "${item#*:}"; sep=,; done
  printf '}}\n'
else
  printf 'Eidetic Player installation doctor: %s\n' "$status"
  for item in "${checks[@]}"; do printf '  %-18s %s\n' "${item%%:*}" "${item#*:}"; done
  printf 'Read-only: no configuration, service, mount, network or data was changed.\n'
fi
[[ "$status" == pass ]]
