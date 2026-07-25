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

## Raspberry Pi OS detection

Current Raspberry Pi OS 64-bit Trixie images may identify themselves as
`ID=debian`, `VERSION_ID=13` and `VERSION_CODENAME=trixie` in
`/etc/os-release`. Eidetic Player does not require a branding string in that
file.

For `ID=debian`, the installer requires all of the following:

- arm64 and Trixie;
- a supported graphical Desktop;
- a NUL-separated Device Tree entry beginning exactly with `raspberrypi,`,
  read from `/proc/device-tree/compatible` or the
  `/sys/firmware/devicetree/base/compatible` fallback;
- at least one Raspberry Pi OS marker from this allowlist:
  - `/etc/rpi-issue`;
  - the installed `raspberrypi-ui-mods` package;
  - the official Raspberry Pi repository in
    `/etc/apt/sources.list.d/raspi.list`.

Hardware detection and Desktop detection are separate. A Broadcom-compatible
entry alone is insufficient, and generic Debian remains unsupported even when
a Raspberry Pi OS marker is copied onto it. `ID=raspbian` Trixie arm64 remains
recognized directly.

## Runtime bootstrap and readiness

The backend exposes two separate endpoints:

- `/health`: server liveness probe (HTTP 200 when the HTTP process is listening).
- `/api/readiness`: bootstrap probe used only by the production launcher.

`/api/readiness` behavior:

- returns HTTP 503 while bootstrap is still running;
- returns HTTP 200 once bootstrap is settled;
- returns `status: "ready"` when startup succeeds;
- returns `status: "degraded"` when startup completed with a recoverable startup
  error.

Production Linux launcher (`deploy/linux/runtime/eidetic-player-launch`) now waits
only on `/api/readiness`, with these constants:

- timeout: `30_000` ms
- poll interval: `250` ms

The GUI is started only after HTTP 200 is observed. If the backend exits before
readiness is reached, or the timeout is reached first, the launcher exits
non-zero and does not open the GUI.

## Linux MPV discovery

Linux MPV resolution order is:

1. configured `EIDETIC_MPV_PATH` (if set)
2. `/usr/bin/mpv`
3. PATH `mpv`

Candidates are deduplicated, validated with bounded `--version` checks, and
`invalid-version`, `permission-denied`, `timeout`, `not-found`, `spawn-failed`,
and `success` results are tracked for diagnostics.

Before accepting or rejecting the platform, the installer prints a sanitized
summary of OS release, architecture, Desktop, Raspberry Pi-compatible Device
Tree entry and matched OS marker. It does not print hostname, IP address,
hardware serial, MAC address, user home or credentials.

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
   git clone --depth 1 https://github.com/dan88v/eidetic-player.git
   cd eidetic-player
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

Clone and update the checkout as the normal desktop user, never with sudo. The
installer needs only traversable directories, readable bootstrap files and an
executable installer script. It treats the checkout and its `.git` directory
as read-only: dependency installation, tests and build never create
`node_modules`, `dist`, caches or temporary files there. `chmod 777` and
world-writable repository permissions are neither required nor accepted.

If the preflight reports that the checkout is not readable, repair ownership
and private permissions instead of making it world-writable:

```bash
sudo chown -R "$(id -un):$(id -gn)" "$PWD"
sudo chmod -R u+rwX,go-rwx "$PWD"
```

A root-owned checkout is accepted when the runtime user can safely traverse
and read every required bootstrap file. The installer reports suspicious
root ownership but does not change ownership or modes automatically.

On a real Raspberry Pi, this read-only verification must reach `Target:
raspios arm64` and the APT plan without installing packages or changing
services, network, boot files or administrative paths:

```bash
runtime_user="${SUDO_USER:-$(id -un)}"
sudo ./deploy/linux/install-eidetic-player.sh \
  --user "$runtime_user" \
  --mode standard \
  --dry-run
```

A successful dry-run proves platform detection and planning only. It is not a
Raspberry Pi hardware PASS.

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
automatically taking over the session. It does not enable autostart, fullscreen,
borderless, display blanking changes, pointer hiding, splash replacement or
autologin. Desktop panel hiding is not implemented.

The installer:

- detects the exact OS, Desktop and architecture;
- prints the required APT package plan;
- runs `apt-get update`, never `full-upgrade`;
- installs GTK/WebKitGTK, MPV, FFmpeg, build tools, NetworkManager, D-Bus,
  polkit, UDisks2, CIFS support and a fallback terminal;
- reads Node from `.nvmrc`, downloads the official linux-x64 or linux-arm64
  archive and verifies `SHASUMS256.txt`;
- uses root only for packages and managed paths under `/opt`, `/etc` and
  `/usr/local`;
- creates a separate temporary Git repository owned by the runtime user,
  fetches the validated ref from the fixed official Eidetic remote, and checks
  out `FETCH_HEAD` detached without modifying the original checkout;
- runs `npm ci`, typecheck, the complete test suite and the production
  Linux/Neutralino build as the existing non-root runtime user in that isolated
  source tree;
- installs immutable releases under `/opt/eidetic-player/releases`;
- atomically updates `current` and retains `previous`;
- keeps config, cache, database and credentials in the runtime user's XDG
  directories.

The build retains a deliberately long mode-0700 workspace name containing a
space and Unicode, owned by the runtime UID and primary group. `TMPDIR`, npm
cache and the isolated repository remain inside that workspace. A second,
concurrency-unique `/tmp/ep-r.XXXXXX` directory is assigned to
`XDG_RUNTIME_DIR`; it is short enough for MPV's portable Unix-socket budget,
also mode 0700 and runtime-owned. The installer validates a representative
socket path before npm starts.

Both temporary roots receive cleanup on success or failure, including sockets,
npm cache and a failed isolated fetch. The controlled environment supplies the
runtime user's `HOME`, `USER` and `LOGNAME`, managed Node in `PATH`, UTF-8
locale, disabled Git prompting and no global/system Git configuration. It does
not use the real `/run/user/<uid>` desktop runtime. npm does not run as root or
create a root-owned `.npm` directory in the user's home.

No final release directory is created or activated until dependency
installation, typecheck, tests, Linux build and artifact validation all
succeed. A failed phase reports its name, removes the private workspace and
incoming release, and leaves both `current` and `previous` unchanged. Package
or managed Node installation already completed by an earlier attempt is
reused safely on the next run. A failed attempt does not require reinstalling
Raspberry Pi OS, Node, the checkout or application data.

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
--borderless yes|no
--disable-blanking yes|no
--hide-pointer yes|no
--splash yes|no
--autologin yes|no
--rpi-onscreen-keyboard keep|disable
--help
```

`--ref` defaults to `main`; `--mode` defaults to `standard`. The final seven
yes/no flags are appliance choices. In `--unattended` appliance mode every
choice must be supplied explicitly.

`--rpi-onscreen-keyboard` defaults to `keep`. On Raspberry Pi OS, an
interactive Standard or Appliance installation asks once whether to disable
the OS keyboard in favour of Eidetic Player's internal keyboard; the default
answer is No. Unattended installation never prompts and disables it only when
`disable` is explicit. Ubuntu accepts `keep` and rejects `disable`.

`--root` redirects administrative paths into an isolated staging tree. It is a
deployment test facility, not an alternate production prefix.

## Raspberry Pi OS on-screen keyboard

Raspberry Pi OS Bookworm and Trixie use Squeekboard. Eidetic does not uninstall
that package or change its own internal keyboard. When `disable` is selected,
the installer verifies that the installed `raspi-config` exposes its supported
non-interactive `get_squeekboard` and `do_squeekboard` functions, records the
original Always On, Autodetect or Always Off state once, then applies the
official `S3 Always Off` choice and verifies it before activating the release.

Restore and uninstall map the saved state back exactly through the same
official mechanism: `S1` for Always On, `S2` for Autodetect and `S3` for Always
Off. Repeated install, restore and uninstall do not overwrite the original
saved state.

If the installed `raspi-config` lacks this support, the installer stops without
activating a release or leaving a partial keyboard change. Configure it
manually with:

```bash
sudo raspi-config
```

Then select **Display Options → D6 Onscreen Keyboard** and choose **S1 Always
On**, **S2 Autodetect** or **S3 Always Off**. This option is Raspberry Pi OS
only; no generic Ubuntu keyboard configuration is added.

## Appliance trial

After Standard mode has been verified, Appliance mode can configure each
behavior independently:

1. start Eidetic Player automatically;
2. open the application fullscreen;
3. run without window borders (independent from fullscreen);
4. disable display blanking for the graphical session;
5. hide the pointer while inactive and reveal it on movement;
6. install the minimal Eidetic Player Plymouth splash;
7. enable graphical autologin for the runtime user.

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
uses the same non-root build/test environment and transactional release switch
as installation. It builds and verifies before switching `current`, preserves
XDG data and keeps `previous` available.

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
content or user NetworkManager profiles. If Eidetic disabled the Raspberry Pi
OS on-screen keyboard, restore also reapplies its exact saved state.

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
sudo bash deploy/linux/test-staging.sh "$(id -un)"
```

It covers Raspberry Pi OS Trixie arm64, Ubuntu 26.04 amd64/arm64, unsupported
OS rejection, double install, a real staging update, rollback, doctor, double
restore, double uninstall, shellcheck when available and systemd unit
verification. When run as root it also changes from the administrative UID to
the supplied runtime user in a private path containing spaces and Unicode,
checks the short private XDG runtime and real Unix socket creation/cleanup,
mode-000 permission denial, read-only checkout invariance, isolated Git fetch,
controlled environment, cache ownership, failure cleanup, retry, atomic
activation and literal handling of an injection-shaped argument. Raspberry Pi
fixtures cover keyboard keep/disable, all three saved states, dry-run,
unsupported versions, transactional failure, update, repeated restore and
uninstall without changing the WSL host keyboard.

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
