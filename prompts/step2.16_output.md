# Step 2.16 — Raspberry/Linux Network bring-up

Date: 2026-07-26

## Result

`BLOCKED — SAFE RASPBERRY NETWORK VALIDATION NOT POSSIBLE`

Local production fixes, the deterministic Windows fixture, focused
regressions, real Neutralino smoke testing, Linux packaging checks, and the
complete local gate set are ready for CI validation. Raspberry mutating tests
were deliberately stopped because the SSH control path used Wi-Fi and no
independent wired control path was available. The user explicitly deferred
those tests until the first step after the next Raspberry software
reinstallation.

This result does not claim a new GitHub Actions PASS.

## Baseline Git and CI

- Branch: `main`.
- Initial working tree: clean.
- `HEAD` matched `origin/main` with divergence `0 0`.
- Baseline commit: `3dea6d7285598fba853e7c3286068c6b04c0592f`.
- Step 2.15, Step 2.15.1-R1, Step 2.15.1-R2, and the ShellCheck R2 follow-up
  were present.
- The GitHub Actions push workflow for the exact baseline commit completed
  successfully before changes began.
- No merge, rebase, reset, restore, stash, clean, commit, or push was run.

## Windows baseline

The mandatory real application command `npm.cmd run dev` was used with
`EIDETIC_MPV_PATH` pointing to the installed MPV.

- Backend `127.0.0.1:4310`: PASS.
- Vite `127.0.0.1:5173`: PASS.
- Neutralino/WebView2: PASS.
- MPV discovery and real play/pause: PASS.
- Settings → Network navigation: PASS.
- Read-only real Windows Ethernet/Wi-Fi state: PASS.
- Hidden-network form and OSK: PASS.
- Power menu and application Quit: PASS.
- Real Windows network mutations: NOT RUN.
- Shutdown: PASS; no Neutralino, MPV, backend, Vite, or related listeners
  remained.

## SSH mode and safe-control decision

- OpenSSH was used interactively from the VS Code integrated terminal.
- The user entered the password only in the OpenSSH password prompt.
- The password was not requested in chat, placed in argv or environment,
  stored in a file, copied to the repository, or included in this report.
- Normal host-key verification remained enabled.
- The route back to the SSH client was inspected read-only and used
  `<wifi-interface>`, not `<wired-interface>`.
- One Ethernet device was present but disconnected; Wi-Fi was the active
  route.
- Therefore no remote snapshot directory was needed and no scan, radio,
  profile, connection, IPv4, service, package, update, or reboot mutation was
  attempted.
- The SSH control master was closed and its socket removed.

## Raspberry read-only audit

Sanitized observations from the currently installed build:

- Raspberry Pi 3 hardware: detected.
- Linux distribution: Debian 13 family.
- NetworkManager: active and enabled.
- `nmcli`: present, version 1.52.1.
- NetworkManager connectivity: full.
- Wi-Fi software and hardware radio: enabled.
- Devices: one disconnected Ethernet adapter and one connected Wi-Fi adapter.
- Active route: Wi-Fi.
- Profiles: three existing profiles; no Eidetic-managed profile was present
  or active.
- `eidetic-player.service`: active.
- Pending IPv4 transaction: none reported.
- No profile inventory was modified and no secret was read.

The installed Network API was reachable but returned an unusable snapshot:
connectivity `unknown`, no active route, unsupported permissions, no adapters,
unknown radio, unsupported scan, idle operation, and no pending IPv4
transaction.

### Reproduced production defect

- Reproduction: run the adapter's read-only `nmcli device show` query on both
  real devices.
- Actual `nmcli` state: exit code 2 because `IP4.METHOD` is not a valid field
  for `device show`.
- Actual API state: the complete refresh degraded to the safe generic failure
  snapshot.
- Expected: device/address data and each active profile's DHCP/manual method
  produce a valid Network snapshot.
- Root cause: the Linux adapter requested a connection-profile property from
  the device-detail command.
- Fix: device details no longer request `IP4.METHOD`; the IPv4 method is read
  separately from the active connection profile using one bounded, shell-free
  argv call.
- Installer impact: none. The installer already installs NetworkManager and
  `nmcli`, starts the service dependency, applies the narrow polkit policy, and
  checks the tools. A future installation will receive the corrected backend.

## Raspberry validation matrix

| Function                            | Current-build result                           |
| ----------------------------------- | ---------------------------------------------- |
| NetworkManager/nmcli                | PASS                                           |
| Ethernet detection                  | PASS                                           |
| Ethernet preferred route            | NOT TESTED                                     |
| Wi-Fi scan                          | NOT TESTED                                     |
| WPA2 physical connect               | NOT TESTED                                     |
| WPA3 physical connect               | NOT TESTED                                     |
| Hidden-network UI                   | NOT TESTED                                     |
| Hidden-network physical connect     | NOT TESTED                                     |
| Disconnect preserves profile        | NOT TESTED                                     |
| Forget removes only Eidetic profile | NOT TESTED                                     |
| Wi-Fi radio off/on                  | NOT TESTED                                     |
| DHCP                                | NOT TESTED                                     |
| Manual IPv4                         | NOT TESTED                                     |
| Revert now                          | NOT TESTED                                     |
| Automatic 30-second rollback        | NOT TESTED                                     |
| Keep settings                       | NOT TESTED                                     |
| Local-network state                 | NOT TESTED                                     |
| Internet state                      | PASS at NetworkManager; FAIL in installed API  |
| Secret handling                     | PASS for no-secret audit; mutations NOT TESTED |
| OSK                                 | NOT TESTED                                     |
| Touch UI                            | NOT TESTED                                     |
| Local/USB playback continuity       | NOT TESTED                                     |
| SMB full-loss reconnect             | NOT TESTED                                     |

`RASPBERRY CURRENT-BUILD NETWORK VALIDATION — PARTIAL`

`RASPBERRY UPDATED-BUILD NETWORK VALIDATION — NOT TESTED`

The remote state required no restoration because the audit was read-only. The
original radio, routes, profiles, IPv4 configuration, service state, and
connectivity were left unchanged.

## Local changes

### Linux NetworkManager adapter

- Corrected IPv4 method discovery for current NetworkManager/`nmcli`.
- Preserved `LC_ALL=C`, bounded timeouts, separate argv, no shell, stdin-only
  secret transport, opaque public IDs, and safe public errors.
- Added injectable bounded-process execution solely for deterministic adapter
  regression testing.

### Windows fixture

- Added deterministic Wired and Wi-Fi adapters.
- Added Open, WPA2 Personal, WPA3 Personal, and unsupported networks with
  contract-valid opaque IDs and reserved example addresses.
- Added scan, radio, connect, hidden connect, disconnect, Forget, and managed
  profile state transitions.
- Submitted passwords are validated when required but never retained.
- Wired remains the preferred route while fixture Wi-Fi is connected.
- Existing IPv4 Apply, Revert, timeout, Keep, recovery, and DHCP behavior is
  preserved.

### Network UI margin correction

The user explicitly added this UI correction to the step. The standalone Wired
detail grid was visibly flush against its card edge in the real Neutralino
fixture screen. A component-scoped direct-child rule now gives it the same
horizontal and vertical content rhythm as the IPv4 section without changing
nested Wi-Fi detail geometry or global selectors.

### Documentation and dependencies

- Documented portable Linux IPv4-method discovery and fixture capabilities.
- No dependency, package plan, installer, polkit, workflow, player, audio
  output, or power-helper change was made.

## Automatic and real fixture validation

Focused regressions passed for:

- NetworkManager device parsing without `IP4.METHOD`;
- escaped colon in an active connection name, kept as one argv item;
- per-profile DHCP/manual discovery;
- Ethernet plus Wi-Fi and wired route priority;
- forced `LC_ALL=C`;
- fixture security inventory and contract-valid opaque IDs;
- fixture scan, WPA2, hidden WPA3, disconnect, Forget, radio, and secret
  non-retention;
- existing NetworkService serialization, deduplication, safe public errors,
  secret handling, Wi-Fi sorting, profile lifecycle, IPv4 validation,
  confirmation, rollback, timeout, startup recovery, and failure recovery;
- scoped Network detail margins.

The real Neutralino fixture smoke at the 1280 × 800 target verified:

- Settings and Network navigation;
- corrected Wired detail margins;
- automatic/result scan plus manual scan through the real backend;
- Open, WPA2, WPA3, and unsupported list states;
- WPA2 connection and Ethernet route priority;
- hidden WPA3 connection;
- Disconnect and Forget;
- radio off/on;
- password absence from the public snapshot;
- IPv4 Manual Apply → Revert now;
- IPv4 Manual Apply → Keep settings;
- final DHCP Apply → Keep settings;
- no pending transaction after restoration;
- MPV, mini-player, top bar, touch geometry, scrolling, and responsive content.

Existing automated coverage retains the 30-second automatic IPv4 rollback,
error states, OSK/password controls, toast, SMB availability callback, and
operation locking. A physical hidden network, physical WPA2/WPA3, Raspberry
touch/OSK, playback continuity during Raspberry mutations, and real SMB
reconnect after total loss remain NOT TESTED.

No real Windows network setting was changed. Final shutdown left zero
Neutralino/MPV processes and zero listeners on ports 4310 and 5173. Temporary
screenshots, SSH prompt captures, logs, and PID files were removed.

## Final gates

| Gate                                                                    | Result                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------- |
| `npm.cmd run format:check`                                              | PASS                                            |
| `npm.cmd run typecheck`                                                 | PASS                                            |
| `npm.cmd run lint`                                                      | PASS                                            |
| `npm.cmd run build`                                                     | PASS                                            |
| `npm.cmd run build:linux`                                               | PASS                                            |
| `npm.cmd test`                                                          | PASS — 511 tests, 501 passed, 10 expected skips |
| `npm.cmd run test:posix`                                                | PASS — 3 passed, 2 platform skips               |
| `npm.cmd run verify:network:deployment`                                 | PASS                                            |
| `npm.cmd run verify:linux:executables`                                  | PASS                                            |
| `npm.cmd run verify:linux:installer`                                    | PASS                                            |
| `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build` | PASS                                            |
| `npm.cmd run mpv:doctor`                                                | PASS                                            |
| `npm.cmd run test:mpv`                                                  | PASS — 8 passed                                 |
| `git diff --check`                                                      | PASS                                            |

The first final `typecheck` invocation found an optional test-runner options
access. It was corrected to use optional chaining, formatted, and `typecheck`
then passed before lint and builds continued. No production behavior changed
for this gate correction.

Linux root staging: NOT RUN.

## Post-CI and post-reinstallation Raspberry checklist

Only after an intentional commit, push, green GitHub Actions run, and the
planned Raspberry software reinstallation:

1. Establish SSH through connected Ethernet and verify it is the control route.
2. Run the sanitized read-only audit again and confirm the corrected API.
3. Verify Settings → Network, Ethernet, automatic/manual Wi-Fi scan, WPA2, and
   WPA3 when physically available.
4. Verify Ethernet remains preferred while Wi-Fi is connected.
5. Verify Disconnect, reconnect, Forget confirmation, and radio off/on.
6. Verify Wi-Fi DHCP.
7. Using only the real current Wi-Fi values, verify Manual IPv4, Revert now,
   automatic 30-second rollback, Keep settings, and final DHCP restoration.
8. Confirm no pending transaction and no unrelated profile change.
9. Verify Power, Audio Output, PCM5102A enumeration, MPV playback, touch, OSK,
   Queue continuity, and doctor output.
10. Verify SMB reconnect when an independent safe control path permits a full
    connectivity-loss test.

## Files changed

- `apps/backend/src/network/fixture-network-adapter.ts`
- `apps/backend/src/network/network-manager-adapter.ts`
- `apps/backend/src/network/platform-network-adapter.ts`
- `apps/backend/test/network-fixture.test.ts`
- `apps/backend/test/network-manager-adapter.test.ts`
- `apps/ui/src/styles/screens.css`
- `apps/ui/test/network-settings.test.ts`
- `docs/development/network.md`
- `prompts/step2.16_output.md`

No commit or push was performed.
