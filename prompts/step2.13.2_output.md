# Step 2.13.2 — Linux installer and appliance mode

## Result

Implemented a production-oriented, inspectable Linux deployment path for:

- Raspberry Pi OS 64-bit Trixie Desktop, arm64;
- Ubuntu 26.04 LTS Desktop, amd64 and arm64.

Generic Debian, other Ubuntu releases, 32-bit, headless/Lite/Server and real
WSL installation are rejected. Raspberry Pi hardware remains **NOT TESTED**;
Ubuntu Desktop on a Pi 3B is not declared supported.

## Deployment

- Added `install-eidetic-player.sh` with the documented clone-and-run flow,
  existing-user validation, safe Git refs, Standard/Appliance modes, dry-run,
  unattended and isolated staging-root support.
- The APT plan covers GTK/WebKitGTK, MPV, FFmpeg, build tools, NetworkManager,
  D-Bus, polkit, UDisks2, CIFS and a fallback terminal. It runs `apt-get
update`, never a distribution upgrade, and adds Plymouth only when selected.
- Node comes from `.nvmrc`; production downloads the official linux-x64 or
  linux-arm64 archive and verifies `SHASUMS256.txt`. It does not alter global
  Node. Production runs `npm ci`, typecheck, tests and `build:linux`.
- Releases live under `/opt/eidetic-player/releases`; `current` and `previous`
  are switched atomically. XDG config, cache, database and credentials remain
  outside releases.
- Standard mode makes no autologin, splash, blanking, pointer, fullscreen or
  automatic-start choice.
- Appliance mode requires six independent choices. Autostart uses a bounded
  graphical user service/XDG activation; fullscreen is application
  configuration; display policy is session-aware; pointer hiding is
  event-driven. No automatic reboot is performed.
- The opt-in Plymouth theme is minimal. Ubuntu uses a managed GRUB drop-in;
  Raspberry Pi OS uses a backed-up cmdline. Restore regenerates the relevant
  boot artifacts. Firmware messages before Plymouth are not promised hidden.

## Network, USB and SMB

- Existing narrow NetworkManager polkit integration is installed for the
  unprivileged runtime user.
- USB remains UDisks2-mediated and does not force eject.
- Linux CIFS no longer invokes a generic mount directly. It uses a fixed
  root-owned helper through a narrow polkit rule, validates the private runtime
  mountpoint/source/options, enforces read-only `nosuid,nodev,noexec`, and
  accepts only a mode-0600 credential file owned by the caller. No sudoers rule
  or backend capability is added and no password enters argv/logs.

## Maintenance, recovery and lifecycle

- Backend bootstrap exposes typed installation capabilities.
- Settings → System exists only for appliance capability (or the explicit
  development fixture). Maintenance requires a modal confirmation.
- The frontend sends an empty request to a fixed local endpoint. The backend
  cannot receive shell arguments, pauses playback, then invokes only
  `/usr/local/bin/eidetic-player-maintenance`; normal backend shutdown releases
  MPV/analyzers. A private runtime flag suspends the bounded service restart.
- Added `eidetic-player-maintenance`, `eidetic-player-resume` and the “Return
  to Eidetic Player” launcher.
- Added update with safe ref, dry-run, no-restart and atomic rollback.
- Added default data-preserving uninstall; purge needs both explicit flags.
- Every managed administrative file is backed up with original owner, mode and
  SHA-256 in a versioned manifest. Restore is idempotent and independent of the
  Git checkout.
- Added a read-only human/JSON installation doctor.

## Verification

- PASS: format check, typecheck, lint and production build.
- PASS: complete automated suite (422 pass, 3 platform skips).
- PASS: `test:posix`.
- PASS: Network deployment verifier.
- PASS: `git diff --check`.
- PASS: WSL staging for Raspberry Pi OS Trixie arm64 and Ubuntu 26.04
  amd64/arm64, double install, update dry-run, rollback, doctor, double restore,
  double uninstall, shellcheck/systemd verification and unsupported-Debian
  rejection.
- PASS: real Windows launch via exactly `npm.cmd run dev` with appliance
  fixture; Neutralino/backend started, capability bootstrap and the fixed
  maintenance endpoint responded, and shutdown left ports/processes clean.
- NOT TESTED: manual visual interaction at 1280×800, 1280×720 and 1024×600.
  Browser automation could not attach to the native Neutralino WebView in this
  environment, so no false visual PASS is claimed.
- NOT RUN: `test:case-sensitive` on Linux. WSL2 has an ext4 filesystem but no
  native Linux Node/npm; its inherited Windows Node refuses execution from
  ext4. The repository now includes a cleanup-safe helper for a Linux host/CI.
- Raspberry Pi hardware: **NOT TESTED**.
- Linux CI and hardware validation remain pending.

Cleanup confirmed: no project Neutralino/backend/Vite/MPV process, listening
port, staging root, fixture screenshot/log, real policy/service, mount, network
change or boot-file change remains.

## Main files

- Linux installer/update/uninstall/restore/doctor, common safety library,
  staging tests, runtime commands, service/desktop/polkit/Plymouth templates
  under `deploy/linux/`.
- `packages/shared/src/system.ts`.
- Backend bootstrap/maintenance route and restricted Linux SMB adapter.
- UI bootstrap, System settings, maintenance API and pointer policy.
- Focused deployment regression tests and Linux deployment documentation.

`README.md` and screenshots were intentionally not updated (Step 2.13.3).
No commit or push was performed.
