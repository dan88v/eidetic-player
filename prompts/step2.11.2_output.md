# Step 2.11.2 — USB mount and safe removal controls

## Baseline and scope

- Started from clean, synchronized `main` at `dea2528` (Step 2.11.1).
- Implemented only manual Mount and Safely remove. No automount, deployment,
  udev/polkit policy, DAC selection, or Step 2.11.3 work was added.
- No commit or push was performed.

## Implementation

- `RemovableStorageService` now owns capability-driven operations, one
  serialized operation per physical device, duplicate-request reuse,
  conflicting-operation rejection, structured public state/errors, monitor
  concurrency, reconnect reset, and shutdown cancellation.
- Public contracts expose only opaque IDs, capabilities, operation state,
  abstract error code, affected-volume count, and Retry availability. Native
  roots, drive letters, PnP IDs, device nodes, UUIDs, commands, and stacks stay
  backend-only.
- Windows uses a bounded, hidden, non-interactive Configuration Manager helper.
  It resolves the provider-owned disk PnP node to its parent physical USB node
  and calls `CM_Request_Device_EjectW`; it does not remove a drive letter.
  Veto/busy, access denied, not found, timeout, unsupported, and generic failure
  are mapped. Manual Windows Mount remains unsupported (`canMount=false`).
- Linux uses an isolated, bounded `udisksctl` adapter with argument arrays and
  `--no-user-interaction`: per-volume mount/unmount and whole-drive power-off.
  It uses no shell, sudo, force, or hidden password prompt. Missing UDisks2 and
  authorization failures degrade safely.
- The provider retains physical-device → partition/volume relationships.
  Mount targets one volume; safe removal blocks and releases all volumes,
  invalidates browse/lazy state, cancels affected Library availability/scan
  work, stops only affected playback, preserves Queue/current/catalog, unmounts
  every mounted volume, then ejects/powers off once.
- Failure never produces `safe-to-remove`, autoplay, auto-resume, rescan, Queue
  clearing, or forced unmount. Busy/failed states remain retryable where the
  error can be retried.
- Sources shows capability-driven Mount or Browse plus the compact
  `… → Safely remove` menu. The USB Browser header reuses its compact menu.
  Confirmation uses the existing shared dialog and appears only when use is
  detected (the open browser always confirms). Progress disables conflicting
  actions; Back remains available; Safe to remove is persistent.
- Cosmetic follow-up: the global app header now reads
  `USB / <device name>`. In the USB Browser action row, Back stays on the left
  and Play, Add this folder to Library, and `…` are grouped on the right.
  Nested folders use a compact `Root › current folder` breadcrumb with a
  restrained current-folder highlight; the duplicate in-content title was
  removed.
- Main Player, mini-player, USB Library Folders, and Queue received no new
  mount/removal control.

## Tests

- Focused controller/fixture coverage passes for capability, mount,
  multi-partition ordering, duplicate requests, busy partial failure,
  permission, not found, unsupported, timeout, generic failure, Retry,
  system/boot exclusion, monitor refresh during an operation, reconnect state,
  and shutdown abort/cleanup.
- Focused UI/security coverage passes for approved surfaces, conditional
  confirmation, operation states, bounded helpers, physical Windows parent
  eject, non-interactive Linux operation, opaque IDs, and no force/sudo.
- `npm.cmd run format:check` — PASS.
- `npm.cmd run typecheck` — PASS.
- `npm.cmd run lint` — PASS.
- `npm.cmd run build` — PASS.
- `npm.cmd test` — PASS: 370 tests, 368 passed, 2 expected POSIX skips.
- `npm.cmd run test:posix` — PASS: 3 passed, 2 expected Windows-host skips.
- `npm.cmd run mpv:doctor` — PASS.
- `npm.cmd run test:mpv` — PASS: 7/7, including removable Quick Browse and
  indexed removable Queue disconnect/reconnect behavior.
- `git diff --check` — PASS.

## Real Windows QA

`npm.cmd run dev` was exercised against the connected Kingston `Others`
volume and the Shawn Mendes album without modifying media.

- Sources showed `Browse` and the compact `Safely remove` menu — PASS.
- The shared in-use confirmation correctly described playback Stop, preserved
  Queue items, and all mounted volumes — PASS.
- USB playback Stop on removal attempt — PASS.
- Failure remained mounted, did not claim safe, did not auto-resume, and kept
  the 12 Queue UUIDs/order/current index/revision exactly unchanged — PASS.
- The corrected physical-device request succeeded through Windows:
  `safe-to-remove` was returned, D: disappeared, and Sources persistently showed
  `Safe to remove` with no Browse action — PASS.
- Current logs contained no `[removable-storage] enumeration failed`.
- Sources/dialog/safe state were inspected in the real Neutralino app at
  1280×800, 1280×720, and 1024×600 with stable geometry, no overlap, blank
  surface, flash, or shared-player regression — PASS.
- The cosmetic follow-up was re-inspected in the real Neutralino app at the
  same three viewports: top-bar identity, opposing Back/action alignment, and
  compact nested breadcrumb remained readable and overlap-free — PASS.
- Physical unplug/reconnect — PASS. Windows remounted `Others` as D:, the
  backend restored the same opaque device ID and idle/readable capability
  state, and Sources/USB Browser restored Browse and both compact removal menus.
- Reconnect caused no autoplay and no Library scan/rescan. Manual selection of
  `That’s The Dream` rebuilt the 12-track Queue at exact index 2 and played
  normally — PASS.
- The USB Browser root, Shawn Mendes folder, and header
  `… → Safely remove` were inspected after reconnect — PASS.
- The in-app browser control surface was unavailable (`agent.browsers.list()`
  returned no browser), so real Neutralino screenshots and native pointer input
  were used.
- No removable Library Source existed in the baseline user state, so physical
  Source/Library ID relink was not applicable; provider/source fixture tests
  cover stable relink without rescan.

## Linux, cleanup, and remaining status

- WSL runtime confirmed Linux and `lsblk`; `udisksctl` is absent, so missing
  UDisks2 behavior is covered but physical Linux/Raspberry Pi mount/eject is
  **NOT TESTED**. Polkit/udev/automount/kiosk deployment remains Step 2.11.3.
- Linux CI for these uncommitted changes is pending; the previously documented
  hosted Linux baseline is unchanged.
- Neutralino, backend, Vite, MPV, FFmpeg, monitor, and helper processes shut
  down cleanly; no listeners remained on 4310/5173.
- Pre-QA `player-session.json`, `sources.json`, and `library.db` were restored
  byte-for-byte and verified by SHA-256.
- All 14 USB files matched the initial names, lengths, timestamps, and SHA-256
  manifest (77,693,105 bytes); no media was modified.
- QA screenshots, logs, and backup were moved to the Recycle Bin after
  verification.
- Step 2.11.3 was not started.
