# Step 2.12 — Network status and Wi-Fi management

## Baseline and scope

- Started from clean, synchronized `main` at `dbd4e35` (Step 2.11.2), with
  `HEAD...origin/main` equal to `0 0`.
- The Step 2.11.2 report records physical Linux/Raspberry Pi verification and
  Linux CI for the then-uncommitted changes as pending; that hosted Linux
  baseline is unchanged.
- Implemented only network status, read-only IP information, and management of
  one Eidetic Wi-Fi profile. Editable IPv4, static IP, deployment policy, SMB,
  hotspot, Enterprise/EAP, WEP, captive portal, VPN, and proxy remain out of
  scope.
- No commit, push, merge, rebase, reset, restore, stash, or clean was run.

## Implementation

- Added typed shared Network contracts with opaque adapter/session-network IDs,
  connectivity, Wired/Wi-Fi snapshots, software/hardware radio, operation,
  permission, scan, supported security, and safe public error states.
- `NetworkService` is the single backend owner. It serializes operations,
  deduplicates snapshots, runs one bounded monitor, publishes one SSE stream,
  and closes the monitor and platform adapter during shutdown.
- AppShell owns one app-lifetime `NetworkApiClient` and EventSource. The same
  snapshot updates Settings and passive Ethernet/Wi-Fi top-bar indicators;
  there is no frontend polling or second listener.
- Windows uses a bounded, hidden, non-interactive PowerShell host around Native
  Wi-Fi `wlanapi.dll` calls for enumeration, radio, scan, profile, connect,
  disconnect, and delete. Requests and passwords travel through stdin. A
  versioned, secret-free temporary assembly cache avoids recompiling the helper
  on every monitor refresh. A temporary profile is accepted before replacing
  `Eidetic Player Wi-Fi`, and
  temporary state is removed on success/failure. Other system profiles are
  never deleted.
- Linux uses isolated `nmcli` calls with argument arrays, `LC_ALL=C`, explicit
  terse/escaped fields, bounded timeouts, no shell/sudo/prompt, and
  `--passwd-file /dev/stdin`. It also activates a temporary connection before
  replacing only the Eidetic profile. Missing NetworkManager degrades to
  `unsupported`; system network files are never edited.
- Public state excludes password, PSK/profile XML, BSSID/MAC, Windows GUID,
  NetworkManager UUID, native interface names, commands, paths, and stacks.
  API mutations accept only opaque IDs returned by the service.
- Settings root now contains separate Interface and Network rows. Interface
  behavior is unchanged. The cosmetic alignment follow-up gives root,
  Interface, and Network the same 70 rem content width and vertical rhythm.
  Network keeps the normal top-bar hamburger and uses the same in-content Back
  and short-description header as Interface, with the shared Wired/Wi-Fi
  selector aligned on the right of that row.
- Wired and Wi-Fi panels show adapter-specific status, link speed, DHCP/manual
  state, IPv4, mask, gateway, first two DNS values, and connectivity read-only.
- Wi-Fi adds software On/Off, hardware-off/permission states, initial/manual
  bounded scan, sorted/deduplicated networks, Open/WPA2/WPA3 Personal and hidden
  connection dialogs, Disconnect, and conditional Forget. System-managed
  connections never show Forget.
- Password fields are cleared at submit and never persisted. The reusable
  on-screen keyboard gained an explicit opt-in `password` profile using QWERTY
  and symbols; other password fields remain ineligible. Show/Hide stays
  form-owned.
- Documentation now covers ownership, platform adapters, security, lifecycle,
  Settings behavior, top-bar state, and the password keyboard profile.

## Automated verification

- Focused Network/keyboard/UI tests pass for snapshot deduplication, serialized
  operations, SSID/security aggregation, opaque public data, secret transport,
  shell-free bounded helpers, one global EventSource, top-bar binding, Settings
  summary, password opt-in/clearing, and teardown.
- Cosmetic follow-up coverage passes 5/5 focused Network UI tests, including
  the Interface-style content header, unchanged hamburger, right-aligned
  selector, global EventSource ownership, and passive top-bar indicators.
- `npm.cmd run format:check` — PASS.
- `npm.cmd run typecheck` — PASS.
- `npm.cmd run lint` — PASS.
- `npm.cmd run build` — PASS.
- `npm.cmd test` — PASS: 380 tests, 378 passed, 2 expected POSIX skips.
- `npm.cmd run test:posix` — PASS: 5 tests, 3 passed, 2 expected Windows-host
  skips.
- `git diff --check` — PASS.
- MPV/FFmpeg doctor and integration suites were not run, as required by this
  step; playback/audio processes were not modified.

## Real Windows QA

The real application was exercised against the active Windows Wi-Fi connection
without changing connectivity.

- Native read-only enumeration found one Wi-Fi adapter, software radio On,
  current SSID, real DHCP IPv4/mask/gateway/DNS/link speed, and system Internet
  connectivity — PASS.
- Entering Wi-Fi triggered the bounded Native Wi-Fi scan; the connected WPA2
  network appeared once, without BSSID, and was marked `Managed by system` —
  PASS.
- Settings root, Network in-content Back/description and unchanged hamburger,
  right-aligned selector, Wired no-adapter state, Wi-Fi panel,
  Rescan, hidden-network dialog, top-bar indicators, mini-player regression,
  scroll behavior, and no horizontal overflow were visually inspected at
  1280×800, 1024×600, and 800×480 — PASS.
- At all three viewports the description and selector remain on one row without
  overlap; root, Interface, and Network share matching left/right bounds and
  panel spacing — PASS.
- Hidden-network Open security hides its password field and Show/Hide action;
  WPA choices expose the opt-in password field — PASS.
- Real Connect, Disconnect, Forget, and radio Off were deliberately **NOT
  TESTED** because the available Wi-Fi connection was the user's primary
  network and no safe alternate route was available. Fixture/service tests
  cover their command and lifecycle paths.
- Permission-required UI was covered structurally but could not be triggered
  without changing Windows privacy state.

## Linux and cleanup

- `nmcli` secret/command boundaries are covered by tests and `test:posix`; a
  real NetworkManager/Raspberry Pi adapter, including the missing-tool runtime
  state, was **NOT TESTED** on this Windows host.
- The development session shut down through the existing lifecycle. Its
  backend, Vite, Neutralino, MPV, and network helper processes were verified
  absent afterward.
- Test media and the connected USB volume were not modified.
