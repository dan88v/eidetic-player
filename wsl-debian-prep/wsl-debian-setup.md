# Eidetic Player: Debian development environment in WSL2

This guide prepares a separate Debian environment for compatibility work. It
does not replace testing on Debian or Raspberry Pi hardware. The files in this
folder are environment tooling only and do not modify application code.

## Prerequisites

- Windows 11 with virtualization enabled in firmware.
- PowerShell as Administrator only when WSL or Debian must be installed.
- A normal, non-root Unix user created during Debian's first launch.

Run `setup-wsl-debian.ps1` from PowerShell. The script detects existing WSL and
Debian installations, never unregisters a distro, and exits when a reboot or
interactive first launch is required. Its Bash companion updates Debian,
installs the toolchain, installs user-local NVM/Node, clones under `~/src`, and
runs preliminary checks.

## Manual sequence

```powershell
wsl --install --no-distribution
wsl --set-default-version 2
wsl --update
wsl --install --no-launch -d Debian
wsl -d Debian
```

Choose a lowercase Unix username and type its password only in the terminal.
Do not configure passwordless sudo. Debian 13 normally starts with systemd
already enabled; verify with `ps -p 1 -o comm=` and change `/etc/wsl.conf` only
if that check fails.

Use the Linux filesystem for the working clone:

```bash
mkdir -p ~/src
git clone https://example.invalid/owner/eidetic-player.git ~/src/eidetic-player
cd ~/src/eidetic-player
npm ci
```

`/mnt/c` is convenient for exchanging files but is slower and has different
permission, case-sensitivity, watcher, and path semantics. It is not the
primary workspace.

## VS Code

Install `ms-vscode-remote.remote-wsl` in Windows VS Code, then run `code .`
inside the Linux clone. Do not install a separate Linux desktop copy of VS
Code. The server is installed automatically in the user's home.

## Verification

```bash
systemctl is-system-running
node --version
npm --version
mpv --version
ffmpeg -version
ldconfig -p | grep -E 'webkit2gtk|gtk-3'
dbus-run-session -- true
xvfb-run -a sh -c 'echo Xvfb-ready'
pactl info
pactl list short sinks
aplay -l
```

PulseAudio through WSLg can work even when ALSA reports no physical card.
DISPLAY or PULSE_SERVER can be absent on older/non-WSLg systems; record that
limitation instead of inventing a device. WSLg is not proof that the native
Neutralino shell will behave identically on Debian or Raspberry Pi.

Update later with `sudo apt-get update && sudo apt-get full-upgrade`, then
`git pull --ff-only` and `npm ci` in the Linux clone. Stop all WSL distros with
`wsl --shutdown` from PowerShell only when appropriate.

## Troubleshooting

- Reboot requested: reboot Windows and rerun the same setup command.
- Virtualization disabled: enable it in firmware; do not reset any distro.
- Install blocked: verify an elevated PowerShell and `wsl --status`.
- Debian does not start: inspect `wsl --list --verbose` and Windows events.
- systemd inactive: preserve `/etc/wsl.conf`, add `[boot] systemd=true`, run
  `wsl --shutdown`, and reopen Debian.
- DNS or apt unavailable: test name resolution and the configured Debian
  mirrors before changing WSL networking.
- `code` missing: install Windows VS Code and enable its command-line command.
- Git authentication: configure Linux authentication separately; never copy
  private keys or tokens automatically.
- WebKitGTK missing: use `apt-cache search webkit2gtk` for the release's real
  runtime package; do not add third-party repositories.
- DISPLAY absent: update WSL and confirm WSLg is installed.
- PULSE_SERVER absent or MPV silent: inspect `pactl info`, sinks, and
  `mpv --ao=help`; do not assume ALSA hardware exists in WSL.
- Repository permissions: clone as the normal user under its home, never with
  sudo.
- Node missing in non-interactive shells: source `$HOME/.nvm/nvm.sh` explicitly.
