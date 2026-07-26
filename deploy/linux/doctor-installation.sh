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
for tool in mpv ffmpeg nmcli dbus-daemon udisksctl mount.cifs; do
  if [[ "$EIDETIC_ROOT" != "/" ]] || command -v "$tool" >/dev/null; then check "$tool" pass; else check "$tool" fail; fi
done
check maintenance "$([[ -x "$(eidetic_target /usr/local/bin/eidetic-player-maintenance)" ]] && printf pass || printf fail)"
check resume "$([[ -x "$(eidetic_target /usr/local/bin/eidetic-player-resume)" ]] && printf pass || printf fail)"
pkexec_path="$(eidetic_target /usr/bin/pkexec)"
power_helper="$(eidetic_target /usr/libexec/eidetic-player-power-helper)"
power_policy="$(eidetic_target /etc/polkit-1/rules.d/49-eidetic-player-power.rules)"
systemctl_path="$(eidetic_target /usr/bin/systemctl)"
check pkexec "$([[ -x "$pkexec_path" ]] && printf pass || printf fail)"
check power-helper "$([[ -x "$power_helper" && ! -L "$power_helper" ]] && printf pass || printf fail)"
check power-helper-mode "$([[ -f "$power_helper" && "$(stat -c '%a' "$power_helper")" == 755 ]] && printf pass || printf fail)"
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  check power-helper-owner "$([[ -f "$power_helper" && "$(stat -c '%u:%g' "$power_helper")" == 0:0 ]] && printf pass || printf fail)"
else
  check power-helper-owner pass
fi
check power-policy "$([[ -r "$power_policy" && ! -L "$power_policy" ]] && printf pass || printf fail)"
check power-policy-mode "$([[ -f "$power_policy" && "$(stat -c '%a' "$power_policy")" == 644 ]] && printf pass || printf fail)"
check power-policy-rendered "$([[ -f "$power_policy" ]] && ! grep -Fq '__EIDETIC_RUNTIME_USER__' "$power_policy" && printf pass || printf fail)"
check systemctl-user "$([[ -x "$systemctl_path" ]] && printf pass || printf fail)"
installation_mode=unknown
install_conf="$(eidetic_target /etc/eidetic-player/install.conf)"
if [[ -r "$install_conf" ]]; then
  installation_mode="$(grep '^EIDETIC_INSTALLATION_MODE=' "$install_conf" | cut -d= -f2-)"
fi
power_ready=0
[[ -x "$pkexec_path" && -x "$power_helper" && -r "$power_policy" ]] && power_ready=1
case "$installation_mode" in
  standard)
    check power-capabilities "$([[ "$power_ready" == 1 ]] && printf pass || printf fail)"
    ;;
  appliance)
    check power-capabilities "$([[ "$power_ready" == 1 && -x "$systemctl_path" && -x "$(eidetic_target /usr/local/bin/eidetic-player-maintenance)" ]] && printf pass || printf fail)"
    ;;
  *)
    check power-capabilities fail
    ;;
esac
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
