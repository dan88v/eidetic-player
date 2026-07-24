# Step 2.13.1 output — SMB Library Integration

## Outcome

Step 2.13.1 is complete. An open SMB root or nested folder can become a
persistent Library Source without replacing SMB Quick Browse. Raspberry Pi
CIFS/polkit deployment and hardware validation were not started.

Baseline was clean `main` at `d2c010f`, synchronized `0/0` with
`origin/main`. The baseline GitHub `Eidetic Player CI / Linux checks` succeeded
on 24 July 2026 in 58 seconds. The local Step 2.13.1 changes were not committed
or pushed, so their Linux CI remains pending.

## Source model and connection dependency

- `LibrarySource.type` and the persisted Source union now include `smb`.
- Source config version 3 stores only stable Source ID, display name, opaque
  SMB connection ID, logical relative root, and timestamps.
- Server, share, username/domain, credential reference, password, UNC/mount
  root, and current native root are not duplicated in the Source record or
  public Source contract.
- Resolution is always Source → `SmbConnectionService` → current readable
  backend root → contained logical root. Directory type, access, traversal,
  mixed separators, symlinks/junctions, and containment are revalidated.
- Connection Remove is rejected with
  `Remove the related Library sources first.` while a dependent Source exists.
  Removing the Source leaves the connection, secret, session, Quick Browse,
  Queue, and NAS files intact.

## Add, naming, coverage, and first scan

- SMB root and nested browser headers now use the canonical action order:
  Play Folder, Add this folder to Library, and overflow.
- The request sends only connection ID and logical relative path. It disables
  only the Add action, prevents duplicate submission, remains in Quick Browse,
  and changes to `In Library` without a duplicate success toast or layout
  shift.
- Root Sources default to the connection display name; nested Sources use the
  logical basename and remain renameable.
- Coverage is segment-aware and scoped to one connection: exact,
  covered-by-parent, and overlaps-child are blocked; siblings,
  `Music`/`MusicBackup`, Unicode paths, and equivalent folders on different
  connections remain valid.
- The new Source alone is queued through the existing deduplicating single
  Library scheduler. There is no global scan, second scanner, concurrent run,
  reconnect scan, or autoplay.
- A final readability check after persistence rolls the Source record back if
  the connection disappears across the commit boundary.

## Library, Sources, Folders, and Queue

- Library Sources shows the real SMB Source with Network Share icon, `SMB`
  badge, safe description, availability/scan state, Open, Rescan/Retry,
  Rename, and non-destructive Remove.
- Available Resources continues to show the live Network Share separately; it
  is not duplicated as a Library Source.
- Folders root shows SMB Sources with a stable Network Share icon and
  `SMB Library folder` description. Artwork preview no longer hides provider
  identity. Unavailable cards retain the existing disabled-action convention.
- Scanner output flows through the normal Albums, Artists, Tracks, Search,
  Favorites, Playlists, History, Stats, artwork, metadata, and contextual
  playback paths without feature-specific SMB branches.
- Indexed playback and indexed Folders playback now carry `libraryTrackId`;
  public paths are opaque `library-source://` identities. Native UNC/mount
  paths do not reach Player REST/SSE.
- SMB Quick Browse remains independent and retains `smb://` public paths,
  opaque SMB origins, UUID/order/current/revision, and no `libraryTrackId`.
  The session repository now correctly validates and restores SMB Quick Browse
  origins instead of discarding them.

## Disconnect and reconnect

- SMB connection changes invalidate the Quick Browse root and refresh all
  dependent Source roots, including a changed backend root after Edit.
- Offline propagation marks Source/catalog/Folder Queue items unavailable. The
  existing scheduler performs cooperative `source-unavailable` abort, keeps
  valid batches, and skips mark-missing finalization.
- Metadata, Library IDs, Favorites, Playlists, History, and Stats remain
  durable. Reconnect restores resolution and availability without rescan,
  autoplay, Queue reconstruction, position restore, or backoff reset.
- Current SMB playback uses the existing Stop-with-Queue/current-preserved
  behavior; unrelated Local/USB playback continues.

## Cosmetic closure

- Add/Edit Network Share now uses a compact three-column form without a
  normal-state scrollbar. The on-screen keyboard no longer stretches the
  dialog to fill all available height.
- Authentication remains explicit, with a lightweight Account/Guest choice
  aligned to the right of its own row. The action footer has a deliberate gap
  below the fields.
- Library Source cards expose Open only inside the three-dot menu.
- Sources now settles a completed SMB scan from Scanning to Available directly
  from the live Library snapshot; leaving and reopening the page is unnecessary.
- Album Grid cards remove the browser's asymmetric default button padding,
  keep artwork exactly 1:1, and use equal top/side insets. Album titles use the
  full card width while the three-dot button stays fixed at bottom right.

## Regression coverage

Focused tests cover:

- Source config v1/v2 compatibility and v3 SMB records;
- root/nested naming, exact/parent/child/sibling overlap, similar prefixes,
  Unicode, platform case semantics, and distinct connections;
- targeted first scan, catalog availability, stable generation/IDs, and no
  reconnect scan;
- scheduler deduplication, cooperative unavailable cancellation, and no
  mark-missing;
- connection dependency, Source removal independence, public path boundaries,
  SMB Quick Browse session persistence, and indexed SMB origins;
- Add/In Library/Covered UI, Sources/Folders provider identity, canonical
  resource browser, and absence of native Source/API fields.
- restored SMB Queue identity through Shuffle, duplicate-path occurrence
  alignment, and indexed SMB presentation as `Network Share`;
- separation of the high-frequency visualizer stream onto the alternate
  loopback origin so player commands and artwork cannot be starved by the six
  app-lifetime HTTP/1.1 streams.

## Post-closure playback regression fixes

- Adding SMB SSE had raised the app to six permanent streams on one WebView2
  HTTP/1.1 origin. That consumed the per-origin connection budget: main-player
  artwork and Play/Previous/Next/Shuffle requests waited indefinitely without
  reaching the backend. The visualizer EventSource now uses the alternate
  loopback origin while remaining one stream with the existing lifecycle; no
  polling, duplicate analyzer, timer, or frame loop was added.
- Shuffle now keeps Queue IDs attached to paths whenever MPV reorders or
  restores the playlist, including duplicate path occurrences. The remap is
  completed while playlist events are suppressed, before the refreshed state
  is published.
- Disabling Shuffle now reloads the natural-order playlist directly on the
  current item and waits until MPV is seekable before restoring a non-zero
  position. Near-zero positions no longer issue a spurious seek. This removes
  the `MPV: error running command` HTTP 500 while retaining current Queue ID,
  position, and paused/playing state.
- MPV IPC failures now include only the safe command name (for example
  `MPV seek`) and never command arguments or native media paths.
- Indexed SMB playback now reports `Network Share`, not `Local File`, after
  session restore.
- A cold close/reopen on the real indexed SMB track retained the exact current
  filename, Queue ID, five Queue identities, opaque `library-source://` path,
  paused state, Shuffle state, and a readable embedded cover.
- One orphaned Neutralino QA window was also found and closed. Final QA used
  exactly one app window and clean process-tree shutdown between restarts.

Final command results:

- `npm.cmd run format:check` — PASS;
- `npm.cmd run typecheck` — PASS;
- `npm.cmd run lint` — PASS;
- `npm.cmd run build` — PASS;
- `npm.cmd test` — PASS (421 tests: 418 passed, 3 skipped);
- `npm.cmd run test:posix` — PASS;
- `npm.cmd run mpv:doctor` — PASS;
- `npm.cmd run test:mpv` — PASS;
- `npm.cmd run ffmpeg:doctor` — PASS;
- `npm.cmd run test:ffmpeg` — PASS;
- `git diff --check` — PASS.

The visualizer stream origin changed, so both FFmpeg doctor and the real FFmpeg
integration suite were rerun.

## Real Windows QA

The actual Neutralino/WebView2 application was launched with exactly
`npm.cmd run dev`. The existing real `Diskstation` connection
(`10.0.0.2 / music`) connected through the native Windows SMB path. No
connection, credential, or NAS content was edited.

The nested read-only QA folder `Aerosmith & Yungblud - One More Time` was added
from Quick Browse:

- browser remained open and changed to `In Library`;
- parent root changed to `Covered`;
- one targeted scan completed in 383 ms with 5/5 FLAC tracks and no failures;
- SMB Source appeared separately in Library Sources and Folders;
- Albums, Artists, Tracks, and Search returned the indexed catalog;
- a temporary Favorite and Playlist item were added and removed;
- Quick Browse playback produced five `smb://` Queue items without
  `libraryTrackId`;
- indexed playback produced five Queue items, the selected item at index 3,
  an exact `libraryTrackId`, and an opaque `library-source://` path;
- connection Remove returned controlled HTTP 409 and preserved the connection;
- Source Remove preserved all five Queue rows, IDs/current/revision, the live
  connection, and Quick Browse.

Sources, SMB root/nested browse, `In Library`/`Covered`, and Folders were
inspected in the real app at 1280×800, 1280×720, and 1024×600. No white flash,
blank intermediate surface, layout shift, clipped action group, stale
clickable row, or shared-control regression was observed. The 1280×800 QA
found and corrected the provider-icon loss and native indexed path before the
reduced viewport passes.

The cosmetic closure was re-inspected in the real 1280×800 application with
`npm.cmd run dev`: Sources showed no exposed Open button and retained Open in
the overflow menu; the compact SMB dialog had no visible scrollbar with the
on-screen keyboard open; and Album Grid showed square covers with equal
top/side insets, full-width titles, and unchanged bottom-right overflow
buttons.

Post-closure regression QA used repeated cold starts with exactly
`npm.cmd run dev` and one Neutralino window. With the visualizer active, the
restored indexed SMB track displayed its decoded artwork immediately;
Play/Pause, Previous, Next, and Shuffle remained visible, enabled, and
on-screen. Real REST → MPV commands changed playing/paused state and moved Next
then Previous to the expected Queue items. A second cold start with Shuffle
enabled retained the same current filename and Queue ID, all five
filename-to-ID associations, `Network Share`, and the opaque Library path.
The follow-up Shuffle QA exercised ON → OFF at the restored near-zero paused
position and again after playing/seeking to 12 seconds. Both requests returned
HTTP 200; the latter retained 12.567 seconds, paused state, current filename,
current Queue ID, and all filename-to-ID associations. Backend stderr remained
clean. The native MPV integration suite now contains and passes a dedicated
Shuffle-disable regression test.

A safe physical NAS disconnect/reconnect was not performed. Native online SMB
Library integration is PASS; native offline/reconnect is NOT TESTED. Fixture
and scheduler coverage validates unavailable abort, catalog preservation,
Queue stability, and reconnect without rescan/autoplay.

## Cleanup and scope

- Temporary Favorite and Playlist state were removed.
- The QA SMB Library Source was removed; `Diskstation` remained connected and
  unchanged.
- Music browsing visibility was restored from temporary `Both` to the original
  `Library`.
- Playback was stopped and the real application closed cleanly.
- No project Neutralino, Node, Vite, MPV, FFmpeg, SMB helper, retry timer, scan,
  listener on 4310/5173, fixture, screenshot, or QA temp directory remained.
- No NAS file was created, modified, renamed, or deleted.
- No deployment helper, CIFS/polkit policy, discovery, SMB1, other protocol,
  Step 2.13.2 work, commit, or push was performed.
