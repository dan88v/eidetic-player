# Linux production deployment

Step 2.13.2 supports only:

- Raspberry Pi OS 64-bit Trixie Desktop on arm64 (Pi 3B or newer; hardware
  validation is still pending);
- Ubuntu 26.04 LTS Desktop on amd64 or arm64. Ubuntu on a Pi 3B is not a
  supported target.

Lite, Server, 32-bit, generic Debian, other Ubuntu releases and real
installation under WSL are rejected.

## Install

Inspect the cloned script, then run:

```bash
git clone --depth 1 https://github.com/dan88v/eidetic-player.git
cd eidetic-player
sudo ./deploy/linux/install-eidetic-player.sh --user "$(id -un)"
```

The user must already exist. `--ref` defaults to `main`; `--mode` defaults to
`standard`. Use `--help` for the complete option list. The installer displays
the APT plan, runs `apt-get update` but never a full upgrade, obtains the Node
version from `.nvmrc`, downloads the official architecture-specific Node
archive, verifies it against `SHASUMS256.txt`, then runs `npm ci`, typecheck,
the essential tests and the production Linux/Neutralino build.

Releases are switched atomically under `/opt/eidetic-player/releases`.
`current` is active and `previous` is retained. Configuration, database,
credentials and caches remain in the runtime user's XDG directories.

Standard mode installs the application, user service and desktop launcher. It
does not enable autostart, fullscreen, autologin, splash replacement, display
policy or pointer hiding.

Appliance mode asks six independent questions. With `--unattended`, every
choice must be supplied explicitly. It never reboots automatically.
Autostart uses one bounded systemd user unit plus XDG session activation.
Fullscreen is generated into the Neutralino application configuration.
Blanking uses a one-shot X11/Wayland-aware session policy. Pointer hiding is
event-driven in the application and pointer movement restores it.

The optional Plymouth theme is deliberately minimal. Ubuntu uses a managed
GRUB drop-in; Raspberry Pi OS updates its single cmdline after taking a
verified backup. Firmware messages before Plymouth are not guaranteed to be
hidden, and virtual consoles/recovery remain available.

## Permissions

The backend and GUI run as the non-root runtime user. NetworkManager uses the
existing narrow polkit integration. USB remains mediated by UDisks2 with no
forced eject. CIFS mounts are read-only and pass through a root-owned helper
whose polkit rule applies only to the local active user in the dedicated
group. The helper accepts only the private Eidetic runtime mountpoint,
`ro,nosuid,nodev,noexec`, guest or a user-owned mode-0600 credential file.
There is no sudoers rule and the backend receives no `CAP_SYS_ADMIN`.

## Maintenance, update and removal

In appliance mode, Settings → System → Maintenance mode confirms before
pausing playback and requesting the fixed local maintenance command. The user
service stops, its bounded restart is suspended by a private runtime flag and
a local terminal opens. The “Return to Eidetic Player” launcher invokes
`eidetic-player-resume` and starts one service instance. No frontend-supplied
command or argument is executed.

```bash
sudo ./deploy/linux/update-eidetic-player.sh --help
sudo ./deploy/linux/restore-system-ui.sh --dry-run
sudo ./deploy/linux/uninstall-eidetic-player.sh --help
npm run doctor:install:linux
```

Update builds and verifies before switching, retains `previous`, supports
`--rollback`, and restarts only when allowed. Uninstall restores every
manifested system file and preserves XDG application data by default. Purging
data requires both `--purge-data` and `--yes-really-purge-data`; media,
NetworkManager profiles, NAS content, USB content, packages, users and groups
are never removed.

The versioned manifest and original files are stored under
`/var/lib/eidetic-player`. Restore is idempotent and uses only that installed
state, not the Git checkout.

## Non-hardware verification

`doctor:install:linux` is read-only and supports `--json`. WSL may be used only
with `--dry-run` or an isolated `--root`. The complete fixture exercise is:

```bash
bash deploy/linux/test-staging.sh
```

It covers Raspberry Pi OS Trixie arm64, Ubuntu 26.04 amd64/arm64, unsupported
OS rejection, double install/restore/uninstall, update dry-run, rollback,
doctor, shellcheck when installed, and systemd unit verification. It does not
modify the WSL host network, bootloader, policies, services or mounts.
