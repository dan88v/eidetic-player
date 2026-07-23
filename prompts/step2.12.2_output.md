# Step 2.12.2 output — Linux/Raspberry Pi network deployment preparation

## Status

**COMPLETE.** The reversible Linux deployment, read-only doctor, static audit,
recovery/restart fixtures, Windows gates, Debian 13/WSL staging validation, and
mandatory QA in the real Neutralino/WebView2 window launched with
`npm.cmd run dev` are complete. The Step 2.12.1 visual gap is closed.

Raspberry Pi network hardware is **NOT TESTED**. Step 2.12.3 remains deferred.
Step 2.13 SMB Sources was not started.

## Environment and baseline

- Repository: `C:\Users\dan88\Desktop\eidetic-player`.
- Branch: `main`; initial worktree clean; no merge/rebase.
- Initial `HEAD`: `1ca927d network settings panel working`.
- `HEAD...origin/main`: `0 0` after `git fetch --prune origin`.
- Node `v24.18.0`; npm `11.16.0`.
- Step 2.12.1 was committed before this work.
- Latest known Linux CI remained the externally pending status documented by
  Step 2.12.1; no new CI run was created because this step made no commit/push.

## Deployment artifacts and user/group model

Added `deploy/linux/network/` with:

- `README.md`;
- non-secret environment example;
- minimal polkit rule template;
- focused backend systemd drop-in;
- explicit installer and reversible uninstaller.

The backend remains non-root. Installation requires explicit `--user`,
`--group`, and `--install-dir`; the suggested group is configurable and no
username, home, UID, or GID is hardcoded. A real root installation may create
the group and add the existing runtime user, after which a new login/session is
required. No sudoers entry, `CAP_NET_ADMIN`, privileged helper service, package
download, network profile, or Wi-Fi secret is added.

## Polkit actions

The rule requires all three subject constraints: membership in the configured
dedicated group, exact system unit `eidetic-player-backend.service`, and
`NoNewPrivileges=true`. Nonmatching actions/subjects fall through to the
distribution policy. There is no wildcard.

- `org.freedesktop.NetworkManager.network-control`: scan, activate/connect,
  disconnect, and reactivate managed connections.
- `org.freedesktop.NetworkManager.enable-disable-wifi`: software Wi-Fi radio.
- `org.freedesktop.NetworkManager.settings.modify.system`: create/modify/
  replace/delete Eidetic-managed profiles and perform IPv4 apply/rollback.

The backend still validates opaque adapter IDs and restricts mutation to its
managed Wi-Fi profile or dedicated Wired clone.

## Installer, uninstaller, and systemd

- Both shell scripts use strict mode, validate account names and absolute
  traversal-free paths, quote spaces/Unicode, reject symlinks in managed target
  paths, and support `--help`, `--dry-run`, and isolated `--root`.
- Installation is idempotent and manages exactly the policy (`0644`), drop-in
  (`0644`), and environment metadata (`0640`, `root:<network-group>` on a real
  install). It invokes no internal `sudo` and never starts/restarts a service.
- Uninstall is idempotent and removes only those three Eidetic artifacts. It
  preserves users/groups, profiles, credentials, databases, XDG data, and the
  pending rollback transaction.
- The drop-in uses `After=dbus.service NetworkManager.service` and
  `Wants=NetworkManager.service`. It has no `network-online.target`, hard
  requirement, or elevated capability, and preserves the base service
  hardening.
- `systemd-analyze verify` passed on the composed staged service in Debian/WSL.

## Read-only network doctor

Added `npm run doctor:network:linux` with human and `--json` output. It checks
platform/Node, WSL, PID-1 systemd, system D-Bus, NetworkManager installed versus
running, `nmcli`, polkit and required action IDs, installed policy, runtime
group/membership, service/drop-in, XDG config and pending transaction
owner/mode, Wired/Wi-Fi adapter kinds, visible NetworkManager permissions, and
informational regulatory domain.

It uses bounded argument-array processes and does not scan Wi-Fi, expose
SSID/password data, connect/disconnect, change radio/IP, or edit files.
Wired-only is a valid capability state. The Windows invocation correctly
returned exit 1 with `platform: win32; Linux is required`.

## Recovery and NetworkManager restart behavior

The backend remains the sole owner of the mode-0600 pending IPv4 transaction
in the runtime user's XDG config directory and processes it before new
mutations. Successful rollback removes it; failed/corrupt recovery remains
`recovery-required`. Missing NetworkManager or a delayed adapter does not
trigger a root boot mutation: the existing single bounded monitor refreshes
the snapshot when the adapter becomes available, while local Retry reuses the
same rollback path and Open system settings remains the manual route.

A focused regression fixture now proves an initial `unsupported` read followed
by NetworkManager recovery: no backend crash, second monitor, automatic
mutation, or stale error remains.

## Security audit

PASS:

- exact three-action policy and no NetworkManager wildcard;
- exact systemd unit, group, and `NoNewPrivileges` constraints;
- no secret/SSID/password/PSK in deployment or doctor output;
- no sudoers, `CAP_NET_ADMIN`, `eval`, shell-built command, or profile path;
- no `/etc/network/interfaces`, `dhcpcd`, `wpa_supplicant`, regulatory-domain,
  DHCP, manual-IP, or NetworkManager profile mutation;
- invalid user/group and traversal are rejected;
- staging path with spaces/Unicode renders safely;
- symlink target rejection is covered by the Linux test fixture;
- installed modes and narrowly scoped uninstall are verified.

## Debian 13/WSL validation

PASS on a temporary ext4 mirror/staging tree under `/tmp`:

- Debian `13.6`, WSL2, systemd PID 1;
- `bash -n` for both scripts;
- installer dry-run;
- install twice and uninstall twice;
- modes `0644`, `0644`, `0640`;
- `/opt/Eidetic Player ü` safely rendered in the environment file;
- composed `systemd-analyze verify`;
- all staging/mirror directories removed afterward.

No WSL network setting was changed and nothing was installed below real
`/etc`. Debian had no Linux Node, `nmcli`, `pkaction`, or `shellcheck`.
Accordingly `doctor:network:linux`, `test:posix`, `test:case-sensitive`,
deployment Node tests, `build:linux`, real NetworkManager, and real polkit
authorization were **NOT RUN in WSL**; no packages were installed merely to
simulate a Raspberry Pi. The deployment Node fixtures passed on Windows and
the shell staging path passed on the case-sensitive ext4 mirror. Linux CI
remains pending for the complete Node execution on a case-sensitive host.

## Windows visual QA

`npm.cmd run dev` launched the actual backend, Vite, and Neutralino shell; the
health endpoint returned 200. QA was performed directly in that native window,
first with the real read-only Network snapshot and then with
`EIDETIC_NETWORK_FIXTURE=1` for safe mutation flows. The real host adapter was
never changed.

- 1280×800: **PASS**.
- 1280×720: **PASS**.
- 1024×600: **PASS**.

PASS: Settings root, Network header, Wired/Wi-Fi selector, compact DHCP view,
Manual fields, inline validation, IPv4 keyboard, Apply summary, Keep, Revert,
dirty Continue editing/Discard dialog, recovery-required fixture, top-bar
indicators, scrolling, focus, and mini-player separation. No horizontal
overflow, clipped action, dialog collision, or unintended overlap was found.

The Revert flow exposed one direct defect: the backend restored DHCP but
published transaction completion before the refreshed adapter snapshot, so
the dialog and Manual draft could remain stale. The backend now publishes the
restored adapter and cleared transaction atomically; the panel closes the
completed transaction dialog, clears drafts, and rerenders. A clean
`npm.cmd run dev` retest confirmed DHCP in both backend state and UI after
Revert. Keep retained Manual as expected.

## Tests and non-regressions

PASS:

- `npm.cmd run format:check`;
- `npm.cmd run typecheck`;
- `npm.cmd run lint`;
- `npm.cmd run build`;
- `npm.cmd test`: 396 tests, 393 passed, 3 platform skips, 0 failed;
- `npm.cmd run test:posix`: 3 passed, 2 Windows platform skips, 0 failed;
- `npm.cmd run verify:network:deployment`;
- focused Network deployment/doctor and NetworkService restart tests;
- focused atomic rollback publication and completed-dialog resync tests;
- `git diff --check`.

`npm.cmd run test:case-sensitive` was additionally attempted on Windows and is
not applicable there: the existing POSIX path checker reported imports because
Windows path semantics do not use `/` as its filesystem root. A Linux Node was
not available in Debian WSL, so the authoritative Linux execution remains CI
pending.

The full suite covers Step 2.12 status/Wi-Fi, Step 2.12.1 validation and
rollback/recovery, Interface Settings, on-screen keyboard, top-bar indicators,
USB, Default/Cassette players, mini-player, Library/Favorites/History/
Playlists, Queue, toast, and shutdown behavior. MPV/FFmpeg doctor and
integration commands were intentionally not run.

## Files changed

- `AGENTS.md`
- `apps/backend/src/network/network-service.ts`
- `apps/backend/test/network-deployment.test.ts`
- `apps/backend/test/network-ipv4.test.ts`
- `apps/backend/test/network-service.test.ts`
- `apps/ui/src/screens/network-settings-panel.ts`
- `apps/ui/test/network-settings.test.ts`
- `deploy/linux/README.md`
- `deploy/linux/network/*`
- `docs/development/linux-debian.md`
- `docs/development/network.md`
- `docs/development/security-accessibility.md`
- `docs/development/testing.md`
- `docs/development/ui-ux.md`
- `docs/development/workflow.md`
- `package.json`
- `scripts/doctor-network-linux.ts`
- `scripts/verify-network-deployment.ts`
- `prompts/step2.12.2_output.md`

## Cleanup and source control

The Neutralino/backend/Vite process tree, ordinary dev MPV child, removable
storage enumeration helper, temporary logs, WSL staging/mirror trees, and
listeners on 4310/5173 were removed. No real host/WSL policy, service/drop-in,
NetworkManager profile, pending QA transaction, or network configuration was
installed or changed. No fixture screenshot remains.

No commit, push, merge, rebase, reset, restore, stash, clean, or force-push was
performed.
