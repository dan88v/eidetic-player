# Linux installation and trial guide

Eidetic Player is in **active development**. The installer is designed to be
inspectable, repeatable and reversible, but Raspberry Pi hardware and complete
appliance boot validation are still pending. Test first on a system you can
recover, keep normal OS backups, and read the scripts before granting root
access.

## Exact supported targets

Production installation accepts only:

- Raspberry Pi OS 64-bit Trixie **Desktop**, arm64, for Raspberry Pi 3B and
  later;
- Ubuntu 26.04 LTS **Desktop**, amd64 or arm64.

Ubuntu Desktop is not declared supported or recommended on a Raspberry Pi 3B.
The installer rejects 32-bit systems, Raspberry Pi OS Lite, generic Debian,
Ubuntu Server, other Ubuntu releases and real installation under WSL.

WSL is useful only for `--dry-run` and isolated `--root` staging. Those checks
do not validate Raspberry Pi hardware, a graphical login, audio, USB, CIFS,
NetworkManager, Plymouth or boot behavior.

## Before installing

1. Start from an up-to-date supported Desktop image. The Eidetic installer runs
   `apt-get update`, but deliberately does not perform a full distribution
   upgrade.
2. Confirm that the intended runtime user already exists and can log in to the
   graphical desktop. Eidetic Player itself runs as that non-root user.
3. Confirm that the system has working network access, audio output and enough
   free storage for Node, dependencies, a source checkout and retained
   releases.
4. Back up important system configuration and application data.
5. Clone the repository and inspect at least:

   ```bash
   less deploy/linux/install-eidetic-player.sh
   less deploy/linux/restore-system-ui.sh
   ```

6. Review the command and package plan without changing the host:

   ```bash
   sudo ./deploy/linux/install-eidetic-player.sh \
     --user "$(id -un)" \
     --mode standard \
     --dry-run
   ```

Do not use `curl | bash`, `wget | sh`, or a remotely hosted script that has not
been inspected.

## Standard trial installation

The documented source path is:

```bash
git clone --depth 1 https://github.com/dan88v/eidetic-player.git
cd eidetic-player
sudo ./deploy/linux/install-eidetic-player.sh
```

When `sudo` does not supply the intended desktop account through `SUDO_USER`,
specify it:

```bash
sudo ./deploy/linux/install-eidetic-player.sh --user "$(id -un)"
```

The runtime user must exist. Do not pass `root`.

Standard mode is the recommended first trial. It installs the production
application, required service integration and desktop launcher without
automatically taking over the session. It does not enable autostart,
fullscreen, autologin, splash replacement, display blanking changes or pointer
hiding.

The installer:

- detects the exact OS, Desktop and architecture;
- prints the required APT package plan;
- runs `apt-get update`, never `full-upgrade`;
- installs GTK/WebKitGTK, MPV, FFmpeg, build tools, NetworkManager, D-Bus,
  polkit, UDisks2, CIFS support and a fallback terminal;
- reads Node from `.nvmrc`, downloads the official linux-x64 or linux-arm64
  archive and verifies `SHASUMS256.txt`;
- runs `npm ci`, typecheck, essential tests and the production
  Linux/Neutralino build;
- installs immutable releases under `/opt/eidetic-player/releases`;
- atomically updates `current` and retains `previous`;
- keeps config, cache, database and credentials in the runtime user's XDG
  directories.

No automatic reboot is performed.

## Installer options

```text
--user USER
--ref REF
--mode standard|appliance
--dry-run
--unattended
--root PATH
--autostart yes|no
--fullscreen yes|no
--disable-blanking yes|no
--hide-pointer yes|no
--splash yes|no
--autologin yes|no
--help
```

`--ref` defaults to `main`; `--mode` defaults to `standard`. The final six
yes/no flags are appliance choices. In `--unattended` appliance mode every
choice must be supplied explicitly.

`--root` redirects administrative paths into an isolated staging tree. It is a
deployment test facility, not an alternate production prefix.

## Appliance trial

After Standard mode has been verified, Appliance mode can configure each
behavior independently:

1. start Eidetic Player automatically;
2. open the application fullscreen;
3. disable display blanking for the graphical session;
4. hide the pointer while inactive and reveal it on movement;
5. install the minimal Eidetic Player Plymouth splash;
6. enable graphical autologin for the runtime user.

Interactive example:

```bash
sudo ./deploy/linux/install-eidetic-player.sh \
  --user "$(id -un)" \
  --mode appliance
```

Review every answer carefully. Autologin, Plymouth and boot-command-line
changes affect the operating-system UI. Every managed administrative file is
backed up and recorded in the versioned manifest under
`/var/lib/eidetic-player`, but ordinary system recovery access should still be
kept available.

The Plymouth option does not promise to hide firmware messages displayed
before Plymouth starts. The installer does not disable virtual consoles or
recovery paths and does not force a display resolution.

Appliance capability adds Settings → System → Maintenance mode. After
confirmation, playback and the player lifecycle stop, bounded automatic
restart is suspended for that session, and a local terminal opens. The “Return
to Eidetic Player” desktop launcher invokes `eidetic-player-resume` and starts
one application instance.

## First-run checks

After installation:

1. Sign in to the graphical desktop as the selected runtime user.
2. Start **Eidetic Player** from the desktop launcher.
3. Confirm that only one application window opens.
4. Add a local folder you are prepared to index, then verify playback,
   artwork, Queue controls and shutdown.
5. Verify the intended audio output through the OS before testing MPV.
6. Test USB and SMB only with media that does not need write access; Eidetic
   uses read-only access.
7. In Appliance mode, test Maintenance and “Return to Eidetic Player” before
   enabling optional autologin or splash behavior.
8. Shut down the app and confirm that no MPV, FFmpeg, backend or GUI process
   remains.

Run the read-only installation doctor from the repository:

```bash
npm run doctor:install:linux
npm run doctor:install:linux -- --json
```

The doctor reports platform, runtime, Neutralino, GTK/WebKitGTK, MPV, FFmpeg,
audio/system services, USB/CIFS support, service files, appliance state,
maintenance commands, XDG state and active/previous releases. It must not
change configuration or expose credentials and media paths.

## Permissions and data safety

The backend and GUI run as the non-root runtime user.

- NetworkManager uses the existing narrow Eidetic polkit integration.
- USB operations remain mediated by UDisks2 and safe removal does not force
  eject.
- CIFS mounts pass through a fixed root-owned helper and a narrow polkit rule.
- SMB is read-only with `nosuid,nodev,noexec`.
- The helper accepts only the private Eidetic runtime mountpoint, guest access
  or a caller-owned mode-0600 credential file.
- No sudoers rule or `CAP_SYS_ADMIN` is granted to the backend.
- Passwords are not placed in command arguments or logs.

The installer, updater and removal tools never modify or delete music, NAS
content or USB media. They do not remove shared APT packages, system users,
groups or unrelated NetworkManager profiles.

## Update and rollback

Preview update options:

```bash
sudo ./deploy/linux/update-eidetic-player.sh --help
sudo ./deploy/linux/update-eidetic-player.sh --dry-run
```

Install and switch to the configured ref:

```bash
sudo ./deploy/linux/update-eidetic-player.sh
```

Use another safe Git ref:

```bash
sudo ./deploy/linux/update-eidetic-player.sh --ref main
```

Rollback atomically to the retained release:

```bash
sudo ./deploy/linux/update-eidetic-player.sh --rollback
```

`--no-restart` prevents the update command from restarting the app. Update
builds and verifies before switching `current`, preserves XDG data and keeps
`previous` available.

## Restore system UI

Preview exactly which Eidetic-managed files would be restored:

```bash
sudo ./deploy/linux/restore-system-ui.sh --dry-run
```

Restore the recorded originals:

```bash
sudo ./deploy/linux/restore-system-ui.sh
```

Restore is idempotent, uses the installed manifest/backups rather than the
original Git checkout, and does not alter application data, music, shares, USB
content or user NetworkManager profiles.

## Uninstall

Preview the command:

```bash
sudo ./deploy/linux/uninstall-eidetic-player.sh --dry-run
```

Default uninstall stops services, restores managed system UI changes and
removes Eidetic binaries, launchers, service files and policy. It preserves
the runtime user's config, database and credentials:

```bash
sudo ./deploy/linux/uninstall-eidetic-player.sh
```

Permanent application-data removal requires both explicit flags:

```bash
sudo ./deploy/linux/uninstall-eidetic-player.sh \
  --purge-data --yes-really-purge-data
```

Purge still does not remove media, NAS/USB content, unrelated network profiles,
shared packages, users or groups.

## Staging without hardware

On a Linux shell or WSL, the isolated fixture exercise is:

```bash
bash deploy/linux/test-staging.sh
```

It covers Raspberry Pi OS Trixie arm64, Ubuntu 26.04 amd64/arm64, unsupported
OS rejection, double install, update dry-run, rollback, doctor, double restore,
double uninstall, shellcheck when available and systemd unit verification.

For the case-sensitive import gate, use a native Linux Node/npm installation
and filesystem:

```bash
bash deploy/linux/test-case-sensitive-wsl.sh
```

These checks create and remove temporary staging roots. They must not install
real policies, alter the host network, configure autologin, edit the real
bootloader, mount media or reboot WSL.

## Reporting problems

When reporting an installation problem, include:

- OS name/version and `dpkg --print-architecture`;
- Standard or Appliance mode and the selected non-secret options;
- the failing command and sanitized output;
- `npm run doctor:install:linux -- --json` output;
- whether the issue occurred on real hardware, a VM or staging.

Do not attach passwords, SMB credential files, SSIDs, private hostnames, media
paths or the contents of XDG application data.
