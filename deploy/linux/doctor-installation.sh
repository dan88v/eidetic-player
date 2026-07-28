#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

eidetic_audio_service_state() {
  local service="$1" load active
  command -v systemctl >/dev/null 2>&1 || {
    printf unavailable
    return
  }
  load="$(systemctl --user show --property=LoadState --value "$service" 2>/dev/null || true)"
  case "$load" in
    not-found) printf not-found; return ;;
    loaded|masked) ;;
    *) printf unavailable; return ;;
  esac
  active="$(systemctl --user is-active "$service" 2>/dev/null || true)"
  [[ "$active" == active ]] && printf active || printf inactive
}

eidetic_audio_stack() {
  local pipewire="$1" pipewire_pulse="$2" wireplumber="$3" pulseaudio="$4"
  if [[ "$pipewire" == active && "$wireplumber" == active ]]; then
    [[ "$pipewire_pulse" == active ]] && printf pipewire-pulse || printf pipewire
  elif [[ "$pulseaudio" == active ]]; then
    printf pulseaudio
  elif [[ "$pipewire" == unavailable && "$pulseaudio" == unavailable ]]; then
    printf unknown
  else
    printf alsa-only
  fi
}

eidetic_audio_hardware_summary() {
  local cards="$1" pcm="$2" modules="${3:-}" count hdmi=not-detected gpio=not-detected
  count="$(grep -Ec '^[[:space:]]*[0-9]+[[:space:]]+\[' <<<"$cards" || true)"
  grep -Eqi 'vc4hdmi|vc4-hdmi|HDMI' <<<"$cards" && hdmi=detected

  local card_signal=0 pcm_signal=0 module_signal=0
  grep -Eqi 'sndrpirpidac|RPi[- ]?DAC|hifiberry|iqaudio|allo|(^|[^[:alnum:]])(i2s|simple)[-_ ]?(dac|card)' <<<"$cards" &&
    card_signal=1
  grep -Eqi 'sndrpirpidac|RPi[- ]?DAC|pcm1794a|hifiberry|iqaudio|allo|simple[-_ ]?(dac|card)' <<<"$pcm" &&
    pcm_signal=1
  grep -Eqi 'snd_soc_rpi_simple_soundcard|snd_soc_pcm1794a' <<<"$modules" &&
    module_signal=1
  if ((card_signal && pcm_signal)); then
    gpio=detected
  elif ((module_signal && card_signal)); then
    gpio=unknown
  fi
  printf '%s|%s|%s' "$count" "$hdmi" "$gpio"
}

eidetic_audio_read_app() {
  local node_path="$1"
  [[ -x "$node_path" ]] || {
    printf '%s\n' \
      reachable=unavailable \
      mpvAvailable=false \
      currentAo=null \
      preferredAvailable=false \
      effectiveOutput=none \
      deviceCount=0 \
      initialEnumerationStatus=unavailable \
      mpvVersion=unavailable
    return
  }
  # The single-quoted payload is JavaScript; its template expressions must not
  # be expanded by Bash.
  # shellcheck disable=SC2016
  "$node_path" -e '
const http = require("node:http");
function request(path) {
  return new Promise((resolve, reject) => {
    const call = http.get(
      { host: "127.0.0.1", port: 4310, path, timeout: 750 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 131072) response.destroy();
        });
        response.on("end", () => {
          if (response.statusCode !== 200) reject(new Error("status"));
          else resolve(body);
        });
      },
    );
    call.on("timeout", () => call.destroy(new Error("timeout")));
    call.on("error", reject);
  });
}

function unavailable(state = "unavailable") {
  console.log(`reachable=${state}`);
  console.log("mpvAvailable=false");
  console.log("currentAo=null");
  console.log("preferredAvailable=false");
  console.log("effectiveOutput=none");
  console.log("deviceCount=0");
  console.log("initialEnumerationStatus=unavailable");
  console.log("mpvVersion=unavailable");
}
Promise.all([
  request("/api/audio-output/state"),
  request("/api/player/state"),
]).then(([audioText, playerText]) => {
  let audio;
  let player;
  try {
    audio = JSON.parse(audioText);
    player = JSON.parse(playerText);
  } catch {
    unavailable("invalid");
    return;
  }
  const state = audio?.ok === true ? audio.data : null;
  const playerState = player?.ok === true ? player.data : null;
  const diagnostics = state?.diagnostics;
  if (!state || !diagnostics || !playerState) {
    unavailable("invalid");
    return;
  }
  const currentAo =
    typeof diagnostics.currentAo === "string" &&
    /^[A-Za-z0-9._+-]{1,128}$/u.test(diagnostics.currentAo)
      ? diagnostics.currentAo
      : "null";
  const deviceCount =
    Number.isInteger(diagnostics.normalizedDeviceCount) &&
    diagnostics.normalizedDeviceCount >= 0 &&
    diagnostics.normalizedDeviceCount <= 64
      ? diagnostics.normalizedDeviceCount
      : 0;
  const enumeration = ["ready", "timed-out", "unavailable"].includes(
    diagnostics.initialEnumerationStatus,
  )
    ? diagnostics.initialEnumerationStatus
    : "unavailable";
  const effective =
    state.effectiveDeviceId === "auto"
      ? "system-default"
      : typeof state.effectiveDeviceId === "string" &&
          state.effectiveDeviceId.length > 0
        ? "specific"
        : "none";
  const version =
    typeof playerState.mpvVersion === "string"
      ? playerState.mpvVersion
          .slice(0, 128)
          .replace(/[^A-Za-z0-9 .()+_-]/gu, "")
          .trim() || "unavailable"
      : "unavailable";
  console.log("reachable=reachable");
  console.log(`mpvAvailable=${state.mpvAvailable === true}`);
  console.log(`currentAo=${currentAo}`);
  console.log(
    `preferredAvailable=${diagnostics.preferredDeviceAvailable === true}`,
  );
  console.log(`effectiveOutput=${effective}`);
  console.log(`deviceCount=${deviceCount}`);
  console.log(`initialEnumerationStatus=${enumeration}`);
  console.log(`mpvVersion=${version}`);
}).catch(() => unavailable());
' 2>/dev/null || true
}

eidetic_build_info_read() {
  local node_path="$1" manifest="$2"
  if [[ "${EIDETIC_ROOT:-/}" != "/" ]]; then
    local commit short ref package built source dirty
    commit="$(sed -n 's/.*"commitSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    short="$(sed -n 's/.*"shortCommitSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    ref="$(sed -n 's/.*"ref"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    package="$(sed -n 's/.*"packageVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    built="$(sed -n 's/.*"builtAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    source="$(sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    dirty="$(sed -n 's/.*"dirty"[[:space:]]*:[[:space:]]*\([^,}]*\).*/\1/p' "$manifest" | tr -d '[:space:]' | head -n 1)"
    [[ "$commit" =~ ^[0-9a-f]{40}$ &&
      "$short" == "${commit:0:7}" &&
      "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$ &&
      "$built" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T &&
      "$source" =~ ^(ci|git|explicit)$ ]] || return 1
    [[ -n "$dirty" ]] || dirty="unset"
    printf '%s\n' \
      "commitSha=$commit" "shortCommitSha=$short" "ref=$ref" \
      "packageVersion=$package" "builtAt=$built" "source=$source" \
      "dirty=$dirty"
    return
  fi
  [[ -x "$node_path" && -r "$manifest" ]] || return 1
  # shellcheck disable=SC2016
  "$node_path" -e '
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (
  value?.schemaVersion !== 1 ||
  !/^[0-9a-f]{40}$/u.test(value.commitSha) ||
  value.shortCommitSha !== value.commitSha.slice(0, 7) ||
  !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(value.ref) ||
  !["ci", "git", "explicit"].includes(value.source) ||
  !Number.isFinite(Date.parse(value.builtAt))
) process.exit(1);
for (const key of [
  "commitSha", "shortCommitSha", "ref", "packageVersion", "builtAt", "source",
]) console.log(`${key}=${value[key]}`);
console.log(`dirty=${typeof value.dirty === "boolean" ? value.dirty : "unset"}`);
' "$manifest" 2>/dev/null
}

eidetic_api_build_sha() {
  local node_path="$1"
  [[ -x "$node_path" ]] || return 1
  # The single-quoted payload is JavaScript.
  # shellcheck disable=SC2016
  curl --silent --show-error --max-time 2 --fail \
    http://127.0.0.1:4310/api/readiness 2>/dev/null |
    "$node_path" -e '
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  const value = JSON.parse(body);
  if (!/^[0-9a-f]{40}$/u.test(value?.buildInfo?.commitSha)) process.exit(1);
  process.stdout.write(value.buildInfo.commitSha);
});
' 2>/dev/null
}

main() {
  EIDETIC_ROOT=/
  json=0
  while (($#)); do
    case "$1" in
      --root) EIDETIC_ROOT="${2:-}"; shift 2 ;;
      --json) json=1; shift ;;
      --help) printf 'Usage: %s [--root PATH] [--json]\n' "$0"; exit 0 ;;
      *) eidetic_die "unknown option: $1" ;;
    esac
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
update_config="$(eidetic_target /etc/eidetic-player/update.conf)"
check update-config "$(
  if [[ -f "$update_config" && ! -L "$update_config" &&
    "$(stat -c '%a' "$update_config")" == 644 ]] &&
    grep -qx 'EIDETIC_UPDATE_CONFIG_SCHEMA=1' "$update_config" &&
    grep -Eq '^EIDETIC_UPDATE_BRANCH=[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$' \
      "$update_config" &&
    grep -Fxq "EIDETIC_UPDATE_REMOTE=$EIDETIC_SOURCE_REMOTE" "$update_config"; then
    printf pass
  else
    printf fail
  fi
)"
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  check update-config-owner "$(
    if [[ -f "$update_config" &&
      "$(stat -c '%u:%g' "$update_config")" == 0:0 ]]; then
      printf pass
    else
      printf fail
    fi
  )"
else
  check update-config-owner pass
fi
if [[ "$installation_mode" == appliance ]]; then
  update_helper="$(eidetic_target /usr/libexec/eidetic-player-update-helper)"
  update_runner="$(eidetic_target /usr/libexec/eidetic-player-update-runner)"
  update_journal="$(eidetic_target /usr/libexec/eidetic-player-update-journal.mjs)"
  update_unit="$(eidetic_target /etc/systemd/system/eidetic-player-update.service)"
  update_policy="$(eidetic_target /etc/polkit-1/rules.d/49-eidetic-player-update.rules)"
  update_state="$(eidetic_target /var/lib/eidetic-player/update)"
  check update-helper "$(
    if [[ -x "$update_helper" && ! -L "$update_helper" &&
      "$(stat -c '%a' "$update_helper")" == 755 ]]; then
      printf pass
    else
      printf fail
    fi
  )"
  check update-runner "$(
    if [[ -x "$update_runner" && ! -L "$update_runner" &&
      "$(stat -c '%a' "$update_runner")" == 755 ]]; then
      printf pass
    else
      printf fail
    fi
  )"
  check update-journal "$(
    if [[ -x "$update_journal" && ! -L "$update_journal" &&
      "$(stat -c '%a' "$update_journal")" == 755 ]]; then
      printf pass
    else
      printf fail
    fi
  )"
  check update-unit "$(
    if [[ -r "$update_unit" && ! -L "$update_unit" &&
      "$(stat -c '%a' "$update_unit")" == 644 ]]; then
      printf pass
    else
      printf fail
    fi
  )"
  check update-policy "$(
    if [[ -r "$update_policy" && ! -L "$update_policy" &&
      "$(stat -c '%a' "$update_policy")" == 644 ]] &&
      ! grep -Fq '__EIDETIC_RUNTIME_USER__' "$update_policy"; then
      printf pass
    else
      printf fail
    fi
  )"
  check update-state "$(
    if [[ -d "$update_state" && ! -L "$update_state" &&
      "$(stat -c '%a' "$update_state")" == 2750 ]]; then
      printf pass
    else
      printf fail
    fi
  )"
  if [[ "$EIDETIC_ROOT" == "/" ]]; then
    check update-integration-owner "$(
      if [[ -f "$update_helper" && -f "$update_runner" &&
        -f "$update_journal" && -f "$update_unit" &&
        -f "$update_policy" && -d "$update_state" &&
        "$(stat -c '%u:%g' "$update_helper")" == 0:0 &&
        "$(stat -c '%u:%g' "$update_runner")" == 0:0 &&
        "$(stat -c '%u:%g' "$update_journal")" == 0:0 &&
        "$(stat -c '%u:%g' "$update_unit")" == 0:0 &&
        "$(stat -c '%u:%g' "$update_policy")" == 0:0 &&
        "$(stat -c '%u' "$update_state")" == 0 ]]; then
        printf pass
      else
        printf fail
      fi
    )"
  else
    check update-integration-owner pass
  fi
fi
check manifest "$([[ -r "$(eidetic_target /var/lib/eidetic-player/system-ui-manifest-v1.tsv)" ]] && printf pass || printf fail)"
node_path="$(eidetic_target /opt/eidetic-player/node/current/bin/node)"
build_manifest="$(eidetic_target /opt/eidetic-player/current/build-info.json)"
build_commit_sha=unknown
build_short_sha=unknown
build_ref=unknown
build_package_version=unknown
build_built_at=unknown
build_source=unknown
build_dirty="unset"
if build_info_lines="$(eidetic_build_info_read "$node_path" "$build_manifest")"; then
  while IFS='=' read -r key value; do
    case "$key" in
      commitSha) build_commit_sha="$value" ;;
      shortCommitSha) build_short_sha="$value" ;;
      ref) build_ref="$value" ;;
      packageVersion) build_package_version="$value" ;;
      builtAt) build_built_at="$value" ;;
      source) build_source="$value" ;;
      dirty) build_dirty="$value" ;;
    esac
  done <<<"$build_info_lines"
  check build-info pass
else
  check build-info fail
fi
build_api_coherence=unavailable
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  api_build_sha="$(eidetic_api_build_sha "$node_path" || true)"
  if [[ -n "$api_build_sha" ]]; then
    if [[ "$api_build_sha" == "$build_commit_sha" ]]; then
      build_api_coherence=match
    else
      build_api_coherence=mismatch
      check build-api fail
    fi
  fi
else
  build_api_coherence=not-applicable
fi

pipewire_state=unavailable
pipewire_pulse_state=unavailable
wireplumber_state=unavailable
pulseaudio_state=unavailable
audio_stack=unknown
wpctl_state=not-available
pactl_state=not-available
aplay_state=not-available
mpv_executable=not-available
alsa_card_count=null
hdmi_state=unknown
gpio_i2s_dac_state=unknown
app_reachable=unavailable
app_mpv_available=false
app_current_ao=null
app_preferred_available=false
app_effective_output=none
app_device_count=0
app_initial_enumeration_status=unavailable
app_mpv_version=unavailable

if [[ "$EIDETIC_ROOT" == "/" ]]; then
  pipewire_state="$(eidetic_audio_service_state pipewire.service)"
  pipewire_pulse_state="$(eidetic_audio_service_state pipewire-pulse.service)"
  wireplumber_state="$(eidetic_audio_service_state wireplumber.service)"
  pulseaudio_state="$(eidetic_audio_service_state pulseaudio.service)"
  audio_stack="$(
    eidetic_audio_stack \
      "$pipewire_state" \
      "$pipewire_pulse_state" \
      "$wireplumber_state" \
      "$pulseaudio_state"
  )"
  command -v wpctl >/dev/null 2>&1 && wpctl_state=available
  command -v pactl >/dev/null 2>&1 && pactl_state=available
  command -v aplay >/dev/null 2>&1 && aplay_state=available
  command -v mpv >/dev/null 2>&1 && mpv_executable=available

  cards="$(sed -n '1,256p' /proc/asound/cards 2>/dev/null || true)"
  pcm="$(sed -n '1,256p' /proc/asound/pcm 2>/dev/null || true)"
  modules="$(sed -n '1,512p' /proc/modules 2>/dev/null || true)"
  IFS='|' read -r alsa_card_count hdmi_state gpio_i2s_dac_state <<<"$(
    eidetic_audio_hardware_summary "$cards" "$pcm" "$modules"
  )"

  while IFS='=' read -r key value; do
    case "$key" in
      reachable) app_reachable="$value" ;;
      mpvAvailable) app_mpv_available="$value" ;;
      currentAo) app_current_ao="$value" ;;
      preferredAvailable) app_preferred_available="$value" ;;
      effectiveOutput) app_effective_output="$value" ;;
      deviceCount) app_device_count="$value" ;;
      initialEnumerationStatus) app_initial_enumeration_status="$value" ;;
      mpvVersion) app_mpv_version="$value" ;;
    esac
  done < <(
    eidetic_audio_read_app \
      "$(eidetic_target /opt/eidetic-player/node/current/bin/node)"
  )
fi

if ((json)); then
  printf '{"status":"%s","checks":{' "$status"
  sep=
  for item in "${checks[@]}"; do printf '%s"%s":"%s"' "$sep" "${item%%:*}" "${item#*:}"; sep=,; done
  printf '},"audio":{'
  printf '"stack":"%s",' "$audio_stack"
  printf '"services":{"pipewire":"%s","pipewirePulse":"%s","wireplumber":"%s","pulseaudio":"%s"},' \
    "$pipewire_state" "$pipewire_pulse_state" "$wireplumber_state" "$pulseaudio_state"
  printf '"tools":{"wpctl":"%s","pactl":"%s","aplay":"%s"},' \
    "$wpctl_state" "$pactl_state" "$aplay_state"
  printf '"mpv":{"executable":"%s","version":' "$mpv_executable"
  if [[ "$app_mpv_version" == unavailable ]]; then
    printf 'null},'
  else
    printf '"%s"},' "$app_mpv_version"
  fi
  printf '"alsaCardCount":%s,"hdmi":"%s","gpioI2sDac":"%s",' \
    "$alsa_card_count" "$hdmi_state" "$gpio_i2s_dac_state"
  printf '"app":{"reachable":"%s","mpvAvailable":%s,"currentAo":' \
    "$app_reachable" "$app_mpv_available"
  if [[ "$app_current_ao" == null ]]; then
    printf 'null,'
  else
    printf '"%s",' "$app_current_ao"
  fi
  printf '"preferredAvailable":%s,"effectiveOutput":"%s","deviceCount":%s,' \
    "$app_preferred_available" "$app_effective_output" "$app_device_count"
  printf '"initialEnumerationStatus":"%s"}},' "$app_initial_enumeration_status"
  # Build provenance fields are validated against a closed, JSON-safe alphabet.
  printf '"build":{"commitSha":"%s","shortCommitSha":"%s","ref":"%s","packageVersion":"%s","builtAt":"%s","source":"%s","dirty":"%s","apiCoherence":"%s"}}\n' \
    "$build_commit_sha" "$build_short_sha" "$build_ref" "$build_package_version" \
    "$build_built_at" "$build_source" "$build_dirty" "$build_api_coherence"
else
  printf 'Eidetic Player installation doctor: %s\n' "$status"
  for item in "${checks[@]}"; do printf '  %-18s %s\n' "${item%%:*}" "${item#*:}"; done
  printf 'Audio diagnostics (read-only):\n'
  printf '  stack              %s\n' "$audio_stack"
  printf '  services           pipewire=%s pipewire-pulse=%s wireplumber=%s pulseaudio=%s\n' \
    "$pipewire_state" "$pipewire_pulse_state" "$wireplumber_state" "$pulseaudio_state"
  printf '  tools              wpctl=%s pactl=%s aplay=%s\n' \
    "$wpctl_state" "$pactl_state" "$aplay_state"
  printf '  ALSA               cards=%s HDMI=%s GPIO-I2S-DAC=%s\n' \
    "$alsa_card_count" "$hdmi_state" "$gpio_i2s_dac_state"
  printf '  app                 reachable=%s MPV=%s ao=%s preferred-available=%s\n' \
    "$app_reachable" "$app_mpv_available" "$app_current_ao" "$app_preferred_available"
  printf '  app outputs         effective=%s devices=%s initial-enumeration=%s\n' \
    "$app_effective_output" "$app_device_count" "$app_initial_enumeration_status"
  printf 'Build provenance:\n'
  printf '  commit              %s\n' "$build_commit_sha"
  printf '  Build ID            %s\n' "$build_short_sha"
  printf '  ref                 %s\n' "$build_ref"
  printf '  package             %s\n' "$build_package_version"
  printf '  built at            %s\n' "$build_built_at"
  printf '  source/dirty        %s/%s\n' "$build_source" "$build_dirty"
  printf '  API coherence       %s\n' "$build_api_coherence"
  printf 'Read-only: no configuration, service, mount, network or data was changed.\n'
fi
[[ "$status" == pass ]]
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
