# Linux, Debian, and Raspberry Pi preparation

## Compatibility status

Debian 13 (Trixie) amd64 under WSL2/WSLg is the tested Linux development
environment. Node 24.18, MPV 0.40, FFmpeg 7.1, GTK 3, WebKitGTK 4.1 and
Neutralino Linux x64 are the reference toolchain for Step 2.4.5.

Debian bare metal, Linux arm64, and Raspberry Pi OS 64-bit are prepared and
statically audited where artifacts are available, but are not runtime-tested.
Raspberry Pi 3B performance, physical touch, ALSA/PipeWire/USB DAC output,
display boot, and kiosk recovery require real hardware. armhf is best-effort
only and is not the primary target.

The UI bundles the variable Open Sans face under the SIL Open Font License.
`font-display: block` prevents a system-font render followed by a metric-changing
swap; system sans-serif faces remain emergency fallbacks only.

## Workspace and commands

Keep the clone on a native case-sensitive Linux filesystem, such as
`~/src/eidetic-player`; do not run it from `/mnt/c` in WSL.

```bash
npm ci
npm run doctor:linux
npm run test:linux
npm run build:linux
npm run smoke:linux
npm run verify:arm
```

The project uses Node 24.18.0 in `.nvmrc` and requires Node 24.15 or newer in
`package.json`, including the built-in `node:sqlite` API used by Library. MPV
and FFmpeg are discovered from the explicit
`EIDETIC_MPV_PATH` / `EIDETIC_FFMPEG_PATH` variables and then `PATH`. This
works with an interactive shell and with a restricted systemd `PATH`.

## XDG and IPC

Linux paths are centralized and separated:

- config: `${XDG_CONFIG_HOME:-$HOME/.config}/eidetic-player`;
- cache: `${XDG_CACHE_HOME:-$HOME/.cache}/eidetic-player`;
- data: `${XDG_DATA_HOME:-$HOME/.local/share}/eidetic-player`;
- runtime: `$XDG_RUNTIME_DIR/eidetic-player`, with a per-user temp fallback.

Sources and the paused-at-zero player session use config. Regenerable artwork
uses cache. The versioned SQLite Library is stored in
`${XDG_DATA_HOME:-$HOME/.local/share}/eidetic-player/library.db`. MPV Unix
sockets use a private mode-0700 runtime directory, a per-process UUID name, a
conservative length guard, and cleanup on shutdown.

## GUI, dialogs, and WSL limits

Neutralino remains the primary shell. On Linux it uses WebKitGTK; WSLg also
requires a working display, DBus and audio bridge. Native Open Files and Add
Folder dialogs must be checked for cancellation, Unicode and spaces in the
real WebView. A WSLg pass does not prove behavior on Raspberry Pi OS.

If the GUI does not start, run `npm run doctor:linux` and distinguish missing
WebKitGTK/GTK, DBus, `DISPLAY`/`WAYLAND_DISPLAY`, runtime binary architecture,
backend startup, and filesystem permissions. Do not replace Neutralino with
Electron.

## Audio

MPV keeps automatic device selection; no PulseAudio, PipeWire, ALSA, or device
name is hardcoded. Use `--ao=null` for non-audible integration tests. WSLg
normally exposes a PulseAudio-compatible RDP sink and may have no physical ALSA
card; that is not a defect. Raspberry Pi validation must cover its real
ALSA/PipeWire stack and selected USB DAC.

## Performance profile

`EIDETIC_ANALYZER_PROFILE=rpi3` opts into the existing conservative analyzer
profile: 16 kHz and 15 frames/s instead of the desktop 24 kHz and 20 frames/s.
It is explicit, not hardware detection, and is not enabled automatically on
Windows or WSL. Artwork/metadata concurrency remains bounded at two, one
realtime analyzer and one waveform process remain the lifecycle limits, and
all caches are bounded. Further reductions require measurements on a real Pi.

## systemd and future runtime

`deploy/linux/` contains a backend-only, non-root system-service prototype. It
does not install, enable, or start anything. Neutralino must run in a graphical
user session; future kiosk/autostart needs compositor ordering and crash
recovery testing.

Primary recommendation: use Neutralino Linux arm64 in fullscreen/window mode
when its WebKitGTK runtime proves reliable on the Pi. It preserves the native
bridge and dialogs with a smaller architecture change. A browser kiosk plus
separate backend is the documented fallback if real hardware exposes an
unresolvable Neutralino/WebKitGTK limitation. It can simplify systemd recovery
but loses the current native bridge/dialog path and adds browser lifecycle and
RAM uncertainty; it is not implemented in this step.

## CI status

The repository has no GitHub Actions workflow at Step 2.4.5, so no
disproportionate pipeline was introduced. The minimum future Linux amd64 job
should use `npm ci`, then format, typecheck, lint, build, unit tests,
`test:posix`, and `test:case-sensitive`. A non-GUI doctor may run after MPV and
FFmpeg are installed in the job. ARM should remain an artifact/header audit
until a real or emulated runtime job is deliberately provisioned.

## Raspberry Pi checklist

Still required on a Raspberry Pi 3B with Raspberry Pi OS 64-bit:

- execute the arm64 artifact and verify its dynamic libraries;
- cold/warm startup, sustained RAM/CPU, analyzer and LUFS-S load;
- 1280×800 physical touch and all emergency layouts;
- ALSA/PipeWire automatic output and the intended USB DAC;
- MP3/FLAC Queue, artwork, waveform, visualizer and session restore;
- dialogs or the chosen kiosk-safe source workflow;
- SIGTERM, power-loss recovery, stale socket/cache cleanup and boot ordering;
- at least 20 rapid transitions with one MPV, analyzer, EventSource and rAF.
