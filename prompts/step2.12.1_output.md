# Step 2.12.1 — DHCP/manual IPv4 configuration and safe rollback

## Outcome

- Added shared IPv4 draft/configuration, validation, and public transaction
  contracts. Adapter and transaction identifiers exposed to the UI remain
  opaque; native interface/profile references stay backend-only.
- Wired and Wi-Fi now expose a per-adapter DHCP/Manual draft. In DHCP the IPv4
  section shows only the method selector because effective values already live
  in Current network/adapter details. Selecting Manual reveals the five
  approved fields with the existing `ipv4` keyboard profile and inline errors.
  Apply stays hidden until the draft genuinely differs from current state, then
  remains disabled until that changed draft is valid.
- Gateway and DNS are optional. Validation normalizes whitespace and covers
  IPv4 syntax, octet bounds, /1–/30 contiguous masks, reserved/network/
  broadcast/multicast/loopback addresses, same-subnet gateways, DNS ordering,
  and duplicate DNS. Frontend and backend use the same pure validator; the
  backend revalidates authoritatively.
- Changing adapter/view, Back, or leaving Network with a changed draft opens
  `Discard network changes?` with Continue editing/Discard. Drafts are
  session-only and are never persisted in browser storage.
- Apply closes input focus, prevents duplicate submission, and shows interface,
  requested values, and the interruption warning before mutation.

## Safe transaction

- `NetworkService` owns one global IPv4 transaction. It captures the real
  adapter state, writes a versioned restrictive pending file atomically,
  applies through the platform adapter, rereads/verifies the effective values,
  and then publishes the 30-second confirmation over the existing single SSE.
- The non-dismissible `Network settings applied` dialog provides Revert and
  Keep settings. One backend timer updates the countdown. Revert and timeout
  share the same verified rollback path; the pending file is removed only
  after successful Keep or rollback.
- Startup treats every pending transaction as untrusted and attempts rollback
  before allowing another mutation. Corrupt/future/unrecoverable state remains
  present as `recovery-required`, with Retry and Open system settings in the
  UI. Wi-Fi/radio mutations conflict while a transaction is active.
- Successful apply depends on effective adapter values, not Internet access;
  LAN and Internet remain separate connectivity information.

## Platform adapters and security

- Windows captures only the selected adapter, then uses a bounded,
  short-lived elevated PowerShell helper for the protected IPv4/DNS mutation.
  Structured temporary input contains no secret, native data never reaches
  the frontend, helper output is bounded, and temporary helper files are
  removed. Cancellation, access, adapter, conflict, timeout, validation, and
  rollback error categories have safe public mappings.
- NetworkManager uses `ipv4.method auto` or Manual address/prefix, optional
  gateway/DNS, and bounded profile activation without shell, sudo, terminal
  prompt, UUID exposure, or system-file editing. System-managed Wi-Fi remains
  read-only. Eidetic Wi-Fi is managed directly; Wired clones into a dedicated
  Eidetic profile and preserves/reactivates the previous profile for rollback.
- The pending file is backend-only, versioned, atomically renamed, mode 0600,
  and contains no Wi-Fi credentials, profile XML, command line, or stack.

## Tests and QA

- Focused Network tests: PASS for validation, Keep, explicit Revert, timeout,
  duplicate Apply, crash/startup recovery, corrupt/future pending state,
  atomic cleanup, one SSE, dirty-state/UI contract, keyboard profile, and
  platform security invariants.
- Fixture end-to-end through the running backend API: PASS for real state read,
  Manual apply, public `awaiting-confirmation` with 30 seconds, explicit
  rollback, restored DHCP values, and pending-file removal.
- `npm.cmd run dev`: PASS with `FixtureNetworkAdapter`; backend, Vite, and
  Neutralino started, and shutdown left no Step 2.12.1 project processes or QA
  logs.
- Windows primary adapter read-only behavior from Step 2.12 remains unchanged.
  Real Windows IPv4 Apply/Rollback: **NOT TESTED** because no safe secondary
  adapter/test-network plan was available. The primary network was not
  modified.
- Real NetworkManager/Raspberry Pi runtime: **NOT TESTED**. POSIX adapter tests
  are covered; product polkit/deployment remains Step 2.12.2.
- Visual QA at 1280×800, 1280×720, and 1024×600: **NOT TESTED**. The required
  app ran, but this session exposed no controllable browser, so no honest
  screenshot-based visual PASS could be recorded. Source/responsive checks do
  not replace that inspection.
- Final gates: PASS for `format:check`, `typecheck`, `lint`, `build`,
  `npm test` (389 total, 387 passed, 2 expected skips), `test:posix`
  (3 passed, 2 expected skips), and `git diff --check`.
- MPV/FFmpeg doctor and integration tests were not run because playback and
  audio processes were outside this step.
- Known Linux CI status remains the Step 2.12 baseline: pending external Linux
  CI/runtime confirmation.

Step 2.12.2, SMB, IPv6 editing, hotspot, VPN, proxy, kiosk automation, Player,
Library, USB, and other unrelated surfaces were not started or modified. No
commit or push was performed.
