# Step 2.4.5-prep — WSL2 Debian development environment bootstrap

Date: 19 July 2026  
Status: PASS — environment ready for the later compatibility audit. The full
Step 2.4.5 audit was not started.

## Environment

- Windows: Windows 11 Pro, version 10.0.26200, build 26200, x64.
- Virtualization: firmware virtualization and hypervisor active.
- WSL: 2.7.10.0; kernel 6.18.33.2; WSLg 1.0.73.2.
- Existing Ubuntu: preserved as the default distro and not modified.
- Debian: GNU/Linux 13.6 (Trixie), WSL2, x86_64.
- User: `daniele`, uid 1000, non-root, member of `sudo`.
- Home/workspace filesystem: `/home/daniele` on native WSL ext4.
- systemd: PID 1, state `running`, zero failed units.
- GUI: `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`.
- Audio: `PULSE_SERVER=unix:/mnt/wslg/PulseServer`; PulseAudio 17 with
  `RDPSink`. ALSA reports no physical sound card, expected under WSLg.

## Installed toolchain

- Core: Git 2.47.3, curl, CA certificates, GCC/G++, build-essential,
  pkg-config, jq, file/binutils/procps/psmisc/lsof, rsync, archive tools,
  locales, xdg/desktop tools, DBus X11, Xvfb, and wget.
- Node: NVM 0.40.4; Node 24.18.0; npm 11.16.0, all user-local.
- Media: MPV 0.40.0; FFmpeg 7.1.5.
- GUI: GTK 3.24.49 (`libgtk-3-0t64` runtime); WebKitGTK 4.1 version 2.52.3;
  NSS 3 installed.
- VS Code: Windows 1.129.0, Remote–WSL 0.104.3, Linux x64 server installed.
- Missing requested packages: none.

## Linux clone and checks

- Clone: `/home/daniele/src/eidetic-player`.
- Origin: `https://github.com/dan88v/eidetic-player.git`.
- Branch: `main`.
- Commit: `043e62d842888af865a517e31278bba9afe1f9a4`, identical to Windows.
- `npm ci`: PASS; 212 packages, 0 vulnerabilities; tracked files unchanged.
- `format:check`: PASS.
- `typecheck`: PASS.
- `lint`: PASS.
- `build`: PASS.
- Tests: PASS, 177/177.
- DBus session: PASS.
- Xvfb: PASS.
- PulseAudio/WSLg: PASS.
- MPV detects PulseAudio `RDPSink`; no sound was played.

## Warnings and limits

- npm reports deprecated transitive `yaeti`, `glob@7`, and `inflight`
  packages plus four install scripts pending explicit npm approval.
- MPV lists PipeWire, but no PipeWire client configuration is installed.
  PulseAudio is the verified WSLg path.
- ALSA has no physical card in WSL; this is not a failure.
- Git credentials and private SSH keys were not copied. Linux Git author
  identity was not copied because it was not needed for clone/build.
- WSLg and x86_64 WSL do not replace Debian-on-hardware or ARM/Raspberry Pi
  validation.

## Artifacts

The environment artifacts are isolated from application code in the dedicated
`wsl-debian-prep/` project folder:

- `setup-wsl-debian.ps1`
- `setup-debian-dev.sh`
- `wsl-debian-setup.md`
- `step2.4.5-prep_output.md`

No commit or push was performed. No distro was removed or reset, no default
distro was changed, no credential was copied, and no Eidetic Player application
file was modified.
