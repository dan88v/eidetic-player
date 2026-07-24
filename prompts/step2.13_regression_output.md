# Step 2.13-R output — Sources information architecture and SMB UI corrections

## Status

**COMPLETE with the native SMB limitation recorded below.**

This corrective step reorganizes Sources, makes USB and SMB Quick Browse use
one visual shell, clarifies Account/Guest, makes the SMB dialog keyboard-aware,
and corrects the unequal top artwork inset in Grid folder cards. SMB Library
Integration was not started.

## Baseline

- Branch `main`, clean starting worktree, no merge/rebase.
- Starting `HEAD`: `6800ac3 added network shares as sources`.
- Node `v24.18.0`; npm `11.16.0`.
- Step 2.13 was already committed in the baseline.
- No commit, push, merge, rebase, reset, restore, stash, or clean was run.
- Linux CI remains pending; no new CI run exists because this work was not
  committed or pushed.

## Problems reproduced

Temporary screenshots from the real Neutralino/WebView2 application showed:

- indexed Local and USB folders split into unrelated sections;
- Add Folder and Rescan mixed in one global toolbar;
- live USB, indexed USB folders, and configured SMB shares presented at the
  same information level;
- an SMB root title duplicated below `SMB / <display name>`;
- SMB missing the USB resource-browser header and breadcrumb styling;
- Account/Guest with no visually strong selected state;
- the whole SMB dialog scrolling as one surface;
- the on-screen keyboard covering or clipping the dialog footer at 1024x600;
- Grid folder artwork with lateral inset but no matching top inset.

All temporary before/after screenshots were deleted after QA.

## Sources information architecture

Sources now has only the top-bar page title and two clear groups using the
existing Eidetic surface, border, radius, typography, icon, button, and spacing
tokens.

The final visual polish keeps one 5.5 rem (88 px) icon size for section headers
and Source cards. Section h2/h3 descriptions and Source-card name/detail pairs
use the same `1.9` line-height, with native h3 margins removed and a compact
internal gap. This centers each two-line text block vertically against its
icon, including Library Sources, Others/Ready, and Diskstation/server-share.

1. `Library Sources`
   - description: `Folders indexed in your music library.`;
   - owns global `Rescan Library` / `Cancel Scan`;
   - contains one unified list of persistent Local and USB sources;
   - rows show a Local/USB type badge, safe display name, state, Open, Rescan,
     Retry when applicable, Rename, and Remove;
   - scanning and failed indexed states are surfaced;
   - empty copy is `No Library sources configured.`.
2. `Available Resources`
   - `Local Storage` owns Add Folder and does not duplicate Local sources;
   - `USB Storage` contains only currently detected devices and keeps Browse,
     Mount/Retry, capacity/read-only information, and safe removal;
   - `Network Shares` owns Add Share and contains only configured/live SMB
     connections with Browse, Retry, Edit, and Remove.

No drive letter, local absolute path, stable volume identity, mount point, UNC
root, credential reference, or password is rendered.

## USB and SMB browser parity

`createFoldersScreen` remains the provider-neutral renderer. USB and SMB now
apply the shared `resource-browser-screen` shell rather than separate SMB
styling:

- provider title only in the top bar;
- Back left; Play Folder and provider menu right;
- same compact root/current breadcrumb;
- same Grid/List folder cards, track rows, metadata, quality, loading, empty,
  unavailable, scrolling, and responsive rules;
- separate USB and SMB session state remains intact.

USB intentionally retains Add this folder to Library and safe removal. SMB has
no Add to Library or scan action; its header menu offers Add folder to Queue.
Grid artwork now uses the same `space-2` inset on the top and both sides, while
List view explicitly retains its established edge-to-edge row geometry.

## SMB dialog and keyboard

Add/Edit reuse the existing `source-dialog` primitive with:

- fixed dialog header;
- canonical segmented Account/Guest buttons with `aria-pressed`, accent
  selection, and visible focus;
- internally scrollable form body;
- fixed Cancel/Connect or Cancel/Save footer;
- existing focus trap, Escape, focus restoration, inline errors, and
  Show/Hide password action.

Guest hides Username, Password, and Domain/Workgroup and immediately clears the
password and resets it to concealed form. Opening or closing clears password
and errors; Edit restores the saved auth mode and keeps Server/Share read-only.
The single Eidetic keyboard adapter publishes its measured height and observes
only the mounted keyboard for responsive size changes. At 1024x600 the title,
selected auth mode, focused field, and footer remain visible above the
keyboard; the keyboard geometry itself was not changed.

## Files changed

- UI: `sources.ts`, `folders.ts`, `usb-storage.ts`, `smb-browse.ts`,
  `eidetic-keyboard-adapter.ts`, and `screens.css`.
- Tests: `smb-ui.test.ts`, `step2.7.1.test.ts`, `step2.11.1.test.ts`,
  `step2.11.2.test.ts`, and the affected historical chrome assertion.
- Documentation: `smb.md`, `ui-ux.md`, `on-screen-keyboard.md`, and
  `testing.md`.
- This report: `prompts/step2.13_regression_output.md`.

No backend SMB repository, credential store, Windows/Linux adapter, reconnect,
Queue origin, playback, Library database, top-bar SMB indicator, mini-player,
toast, visualizer, or keyboard package file was changed.

## Tests

- focused corrective suite: 64 passed, 0 failed;
- `npm.cmd run format:check`: PASS;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS, 103 UI modules transformed;
- `npm.cmd test`: 413 tests, 410 passed, 3 platform skips, 0 failed;
- `git diff --check`: PASS.

MPV/FFmpeg doctors, integration tests, and benchmarks were intentionally not
run because playback and backend process lifecycle are outside this corrective
step.

## Real application QA

The real Windows application was launched with exactly `npm.cmd run dev`.
Temporary isolated APPDATA/LOCALAPPDATA/TEMP roots prevented changes to the
user's real SMB configuration and credential store.

The connected physical USB volume `Others` was used read-only. Its
`ArchivioFenice` and `Shawn Mendes - Shawn (2024)` folders were browsed without
modifying media. USB root/nested and SMB fixture root/nested were compared
directly in Neutralino/WebView2. Grid cards, equal artwork insets, Play Folder,
provider menus, breadcrumbs, track rows, metadata/quality, and scrolling were
inspected.

Sources and dialog layouts were inspected during the corrective iterations at
1280x800, 1280x720, and 1024x600. Runtime QA covered Add Account, Add Guest,
Edit Guest, visible auth selection, text keyboard, fixed header/footer, and the
focused-field body at 1024x600. Existing automated coverage protects Edit
Account, password cleanup, Show/Hide, focus trap, Escape, and teardown.

No safe real NAS credential/share was available. SMB browsing used the
Step 2.13 fixture pointed read-only at the USB volume. Real Windows
SMB/Credential Manager and Linux CIFS remain **NOT TESTED** and are not reported
as native SMB passes.

## Non-regressions and cleanup

Focused and full suites cover SMB Add/Edit/Remove, credential boundaries,
top-bar state, one EventSource, reconnect/backoff, Queue/public path
boundaries, USB Quick Browse and Library Sources, local Sources, Rescan/Cancel,
Folders, Library, player chrome, mini-player, keyboard, toast, and Queue.
Playback code was not changed.

Neutralino was closed normally. Final checks found:

- zero Eidetic Node/Neutralino/MPV/FFmpeg processes;
- zero listeners on 4310 and 5173;
- no QA helper;
- no isolated SMB fixture/configuration;
- no screenshots;
- no dialog/keyboard overlay;
- no changes to USB or NAS media;
- no changes to real SMB credentials/configuration.

Step 2.13.1 — SMB Library Integration remains the next step and was not
started. No commit or push was performed.
