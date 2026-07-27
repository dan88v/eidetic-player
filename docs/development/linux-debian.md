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
npm run doctor:network:linux
npm run verify:network:deployment
npm run verify:linux:executables
npm run verify:linux:installer
npm run test:linux
npm run build:linux
npm run verify:linux:release -- --root . --arch x64 --phase build
npm run smoke:linux
npm run verify:arm
```

## Installer terminal UX

`sudo ./deploy/linux/install-eidetic-player.sh` and
`sudo ./deploy/linux/uninstall-eidetic-player.sh` are guided on an interactive
terminal. The installer asks for Standard or Appliance, keeps the established
technical choices, shows a pre-change summary, then reports nine real phases
with elapsed-time spinner and completed-phase progress. The uninstaller
preserves all application data by default; guided deletion requires a separate
Yes followed by exact `DELETE`. GPIO/IÂ²S removal is independent and available
only for a block whose Eidetic ownership is proven.

`-v`/`--verbose` enables sanitized command previews and live child output.
`--no-color`, a defined `NO_COLOR`, `TERM=dumb`, or non-TTY output disables
ANSI styling. `-h`/`--help` and `--version` are read-only and do not require
root. Automation must use explicit technical choices and `--unattended`; no
arguments on a non-TTY fails safely instead of prompting or selecting a mode.

Complete non-ANSI diagnostics are logged with mode 0600 under
`/var/log/eidetic-player`, with a reported private fallback when that directory
is not yet writable. The newest ten install logs and newest ten uninstall logs
are retained independently. Failure output includes the failed phase, original
exit code, rollback result, log path, and `eidetic-player-doctor`.

The updater follows the same console contract. Its no-argument path is guided
only on a TTY; unattended callers must be explicit. Update logs rotate
independently at ten files. A resolved target identical to the installed full
commit exits before build or restart. Otherwise the updater pins that commit,
activates only after `build-info.json` validation, restarts without reboot,
verifies service + HTTP + target Build ID for 60 seconds, and rolls back once
on a hard failure. MPV readiness has a separate 120-second soft window and
cannot roll back an otherwise healthy target.

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

## Mounted USB storage

The Linux provider consumes `lsblk --json` transport topology, accepts USB
filesystem disk/partition nodes, including unmounted volumes, whose
physical ancestry reports `TRAN=usb`, excludes `/` and non-USB/network/optical
devices, and prefers filesystem UUID for stable identity. Step 2.11.2 adds an
isolated UDisks2 adapter using bounded `udisksctl --no-user-interaction`
argument arrays: Mount targets one volume; safe removal unmounts all mounted
volumes without force and powers off the physical drive. It never invokes a
shell, sudo, udev, or systemd and never opens a hidden password prompt.

An opted-in USB Library Source persists the stable identity and logical
relative root, not its mount point. Reconnect resolution and availability are
provider-neutral, but physical Debian/Raspberry Pi OS relink, permission, scan
interruption, and playback-disconnect behavior still require real-hardware QA.

Debian/Raspberry Pi OS runtime detection, UDisks2 availability, polkit
authorization, read-only media, and disconnect latency remain hardware checks;
WSL may expose no representative USB block topology. Missing UDisks2 or denied
authorization degrades to unavailable capability or a structured error without
sudo. Step 2.11.3 will own polkit/udev policy, automount, kiosk permissions,
boot, and deployment.

## Audio

MPV keeps automatic device selection; no PulseAudio, PipeWire, ALSA, or device
name is hardcoded. Use `--ao=null` for non-audible integration tests. WSLg
normally exposes a PulseAudio-compatible RDP sink and may have no physical ALSA
card; that is not a defect. Raspberry Pi validation must cover its real
ALSA/PipeWire stack and selected USB DAC.

The optional Raspberry GPIO/I²S integration is limited to the generic
`i2s-dac` overlay and is opt-in in both installer modes. It owns only its exact
marked block in the selected boot `config.txt`; pre-existing and ambiguous
configuration is preserved. It does not configure ALSA, PipeWire, the default
sink, mixer state, or MPV. Wiring and lifecycle details are documented in the
Linux installation guide.

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

`deploy/linux/network/` adds the optional NetworkManager deployment layer. Its
explicit installer requires the runtime user, dedicated authorization group,
and installation directory. It installs only a narrowly scoped polkit rule,
the backend service drop-in, and non-secret deployment metadata. The drop-in
uses `After=dbus.service NetworkManager.service` and
`Wants=NetworkManager.service`; it does not require
`network-online.target`, so missing Internet or adapters cannot block the
player. The uninstaller removes only those three artifacts. Neither script
starts/restarts the service or changes a NetworkManager profile.

Run `npm run doctor:network:linux` as the runtime user after installation. The
read-only doctor distinguishes missing D-Bus, NetworkManager, `nmcli`, polkit,
authorization, and adapters; Wired-only is valid. It also checks the backend
drop-in, dedicated group membership, pending IPv4 transaction ownership/mode,
and reports `iw reg get` only as information. Verify the distribution packages
that provide missing executables/services on the actual target; the doctor
does not install them.

The production installer also installs the dedicated `pkexec` package, the
root-owned mode-0755 `/usr/libexec/eidetic-player-power-helper`, and a rendered
mode-0644 rule at
`/etc/polkit-1/rules.d/49-eidetic-player-power.rules`. The rule authorizes only
`org.freedesktop.policykit.exec` for that exact helper, active local sessions,
and the exact validated runtime user. It does not authorize systemctl, pkexec,
shells, directories, administrative groups, or arbitrary arguments. The
helper's closed argument parser remains the second authorization barrier.

Standard exposes device reboot/shutdown only while pkexec, helper, and policy
are all available. Appliance adds the fixed user-service restart when
`/usr/bin/systemctl` is executable, always retains Maintenance, and never
exposes Quit. Missing integration degrades only these capabilities; playback
and the rest of bootstrap remain available.

The Wi-Fi regulatory domain must be configured correctly on the final device.
No country is selected or stored by this repository. Configuration and
hardware validation are deferred to Step 2.12.3.

Primary recommendation: use Neutralino Linux arm64 in fullscreen/window mode
when its WebKitGTK runtime proves reliable on the Pi. It preserves the native
bridge and dialogs with a smaller architecture change. A browser kiosk plus
separate backend is the documented fallback if real hardware exposes an
unresolvable Neutralino/WebKitGTK limitation. It can simplify systemd recovery
but loses the current native bridge/dialog path and adds browser lifecycle and
RAM uncertainty; it is not implemented in this step.

## CI status

The `Eidetic Player CI` GitHub Actions workflow runs the core Linux amd64 gates
on `ubuntu-latest`: reproducible install and audit, format, typecheck, lint,
Git executable modes, shell syntax, installer-safe verification, standard and
Linux release builds, release-artifact verification, the full unit suite,
`test:posix`, and `test:case-sensitive`. The focused deployment profile never
replaces the full application regression suite. It reads Node from `.nvmrc`
and uses the standard npm cache keyed by `package-lock.json`.

The hosted job deliberately excludes GUI/runtime checks, MPV, FFmpeg,
Neutralino GUI execution, and ARM verification. Continue to run `doctor:linux`,
`smoke:linux`, and `verify:arm` manually in the native
case-sensitive Debian/WSL workspace for platform-sensitive milestones. ARM
remains an artifact/header audit until a real or emulated runtime job is
deliberately provisioned, and Raspberry Pi validation still requires hardware.

## Raspberry Pi checklist

Still required on a Raspberry Pi 3B with Raspberry Pi OS 64-bit:

- execute the arm64 artifact and verify its dynamic libraries;
- cold/warm startup, sustained RAM/CPU, analyzer and LUFS-S load;
- 1280×800 physical touch and all emergency layouts;
- ALSA/PipeWire automatic output and the intended USB DAC;
- MP3/FLAC Queue, artwork, waveform, visualizer and session restore;
- dialogs or the chosen kiosk-safe source workflow;
- SIGTERM, power-loss recovery, stale socket/cache cleanup and boot ordering;
- NetworkManager/polkit authorization, radio, scan/connect/disconnect/forget,
  DHCP/manual IPv4 rollback, service restart, delayed adapters, and regulatory
  domain on the installed device;
- at least 20 rapid transitions with one MPV, analyzer, EventSource and rAF.
