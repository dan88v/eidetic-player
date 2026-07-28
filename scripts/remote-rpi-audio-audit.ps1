param(
  [string]$HostName = "10.0.0.112",
  [string]$UserName = "daniele"
)

$ErrorActionPreference = "Stop"

$audit = @'
set -u
printf '\n=== Eidetic Step 2.17.8 read-only audio audit ===\n'
printf '\n[Build and application]\n'
curl -fsS --max-time 3 http://127.0.0.1:4310/api/bootstrap 2>/dev/null || true

printf '\n[Service and processes]\n'
systemctl --user is-active eidetic-player.service 2>/dev/null || true
ps -eo pid,ppid,comm,args | grep -E '[m]pv|[f]fmpeg|eidetic-player' || true

printf '\n[Installed preferences - non-secret audio fields]\n'
python3 - <<'PY'
import json, pathlib
p = pathlib.Path.home() / ".config/eidetic-player/preferences.json"
try:
    document = json.loads(p.read_text())
    preferences = document.get("preferences", {})
    keys = (
        "volume", "muted", "outputLevelMode", "lastVariableVolume",
        "maximumSoftwareVolume", "audioProcessingEnabled", "channelMode",
        "balanceDb", "equalizerEnabled", "headroomMode", "manualPreampDb",
    )
    print("schemaVersion=" + str(document.get("schemaVersion")))
    for key in keys:
        if key in preferences:
            print(f"{key}={preferences[key]}")
except Exception as error:
    print("preferences=unavailable:" + type(error).__name__)
PY

printf '\n[MPV output state via application]\n'
curl -fsS --max-time 3 http://127.0.0.1:4310/api/audio-output/state 2>/dev/null || true

printf '\n\n[MPV runtime]\n'
pid=$(pgrep -n -x mpv 2>/dev/null || true)
printf 'mpv_pid=%s\n' "${pid:-none}"
if [ -n "${pid:-}" ]; then
  tr '\0' '\n' <"/proc/$pid/cmdline" | sed -n '1,80p'
  socket=$(tr '\0' '\n' <"/proc/$pid/cmdline" |
    sed -n 's/^--input-ipc-server=//p' | head -n1)
  printf 'ipc=%s\n' "${socket:-unavailable}"
  if [ -n "${socket:-}" ]; then
    python3 - "$socket" <<'PY'
import json, socket, sys
path = sys.argv[1]
properties = [
    "audio-device", "audio-device-list", "current-ao", "audio-params",
    "volume", "mute", "af",
]
try:
    client = socket.socket(socket.AF_UNIX)
    client.settimeout(1)
    client.connect(path)
    for request_id, prop in enumerate(properties, 1):
        request = {"command": ["get_property", prop], "request_id": request_id}
        client.sendall((json.dumps(request) + "\n").encode())
    data = b""
    while data.count(b"\n") < len(properties):
        chunk = client.recv(65536)
        if not chunk:
            break
        data += chunk
    for line in data.splitlines():
        response = json.loads(line)
        request_id = response.get("request_id")
        if request_id:
            prop = properties[request_id - 1]
            print(prop + "=" + json.dumps(response.get("data"), separators=(",", ":")))
except Exception as error:
    print("ipc_probe=unavailable:" + type(error).__name__)
PY
  fi
fi

printf '\n[ALSA cards and PCMs]\n'
cat /proc/asound/cards 2>/dev/null || true
aplay -l 2>/dev/null || true
aplay -L 2>/dev/null | sed -n '1,100p' || true

printf '\n[PipeWire nodes]\n'
wpctl status 2>/dev/null | sed -n '1,160p' || printf 'wpctl status unavailable\n'

printf '\n[Mixer read-only]\n'
amixer 2>/dev/null | sed -n '1,140p' || true

printf '\n[MPV filter capability]\n'
mpv --version 2>/dev/null | head -n3 || true
mpv --no-config --af=help 2>/dev/null |
  grep -E 'lavfi|format|pan|equalizer|volume' | head -n40 || true

printf '\n[CPU]\n'
lscpu | grep -E '^(Architecture|CPU\(s\)|Model name|CPU max MHz|CPU min MHz)' || true

printf '\n[Analyzer count]\n'
printf 'ffmpeg_processes='
pgrep -x ffmpeg 2>/dev/null | wc -l
printf 'mpv_processes='
pgrep -x mpv 2>/dev/null | wc -l
printf '\n=== Audit complete: no state changed ===\n'
'@

$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($audit))
$remoteCommand = "echo $encoded | base64 -d | bash"

Write-Host "Read-only Raspberry audio audit: $UserName@$HostName"
Write-Host "Enter only the SSH password in this visible window."
& ssh "$UserName@$HostName" $remoteCommand
$sshExit = $LASTEXITCODE
Write-Host ""
Write-Host "SSH audit finished with exit code $sshExit."
Write-Host "Leave this window open and send the complete output to Codex."
if ($sshExit -ne 0) {
  Write-Warning "The read-only audit did not complete successfully."
}
