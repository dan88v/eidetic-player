# Step 2.17.3 output — Now Playing metadata integrity, readability and artwork navigation

Date: 2026-07-27

## Status

Implementation and real Windows validation are complete. Final automated gates
are recorded after the implementation sections.

`READY FOR CI VALIDATION`

`WINDOWS AC/DC METADATA VALIDATION — PASS`

`RASPBERRY METADATA VALIDATION — NOT REQUIRED FOR THIS STEP`

No commit, push, merge, rebase, reset, restore, stash, clean, Raspberry
connection, installer/update action, or dependency change was performed.

## Git and CI baseline

- Branch: `main`.
- Baseline and exact `origin/main`:
  `4a5a73d1599854469a99c3de0da6e3464c668cf9`.
- Divergence: `0 0`.
- Working tree: clean.
- Step 2.17, Step 2.17.1, and Step 2.17.2 were present.
- GitHub `Linux checks` for the exact baseline completed successfully.
- Initial `git diff --check`: PASS.

## Real Windows baseline

The required real path was started before code changes:

```powershell
$env:EIDETIC_MPV_PATH = "C:\Tools\mpv\mpv.exe"
npm.cmd run mpv:doctor
npm.cmd run dev
```

MPV 0.41 discovery and JSON IPC passed. In the real Neutralino/WebView2 app
the user played the affected media without exposing its path, filename, title,
or album. Sanitized state:

- Build ID: `4a5a73d-dev`;
- source: Network Share;
- Queue: 10 items, current index 0;
- player: playing, not paused;
- volume: 97.989433;
- mute off, shuffle off, repeat off;
- Now Playing/API artist: `AC`;
- parser artists array: `AC | DC`;
- current indexed Library Track artist: `AC`;
- clicking the Now Playing cover: no action.

The real persistent MPV process was queried through its existing JSON IPC
endpoint. No second MPV was launched. MPV raw `artist` and `album_artist` were
both exactly `AC/DC`.

## Metadata pipeline matrix

| Level                           | Baseline                                                | Fixed result                                    |
| ------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Tag/file evidence               | `AC/DC` through MPV raw                                 | unchanged                                       |
| MPV raw                         | `AC/DC`                                                 | `AC/DC`                                         |
| `music-metadata` ID3v2.3 common | artist `AC`, artists `AC \| DC`                         | reconstructed at parser boundary                |
| `MetadataService`               | artist `AC`, artists `AC \| DC`                         | artist `AC/DC`, artists `[AC/DC]`               |
| `PlayerService`                 | parser enrichment replaced intact MPV value with `AC`   | `AC/DC`                                         |
| API player state                | `AC`                                                    | `AC/DC`                                         |
| Queue                           | no artist field is rendered; 10 stable structural items | unchanged design and order                      |
| Existing Library record         | `AC`                                                    | retained until that file is reindexed           |
| New Library indexing fixture    | not applicable                                          | one `AC/DC` Track and one `AC/DC` Artist entity |
| Presentation snapshot           | received `AC`                                           | preserves `AC/DC` literally                     |
| Now Playing DOM                 | `AC`                                                    | `AC/DC` through `textContent`                   |
| Mini-player                     | shared presentation snapshot                            | preserves the same literal value                |

Favorites, Recently Played, Playlists, Library rows, USB browse, SMB browse,
and Folders consume either the normalized Library record or the same
`MetadataService` result. No surface-specific slash formatter was found.
Queue rows do not contain or display an artist field, so artist rendering there
is not applicable and the Queue design was not changed.

## Root cause and minimum fix

Classification: **Case A — parser metadata divides on slash**.

For ID3v2.3, `music-metadata` follows the historical TPE1 delimiter rule and
turns the literal frame value into separate native/common values. Eidetic then
preferred `common.artist` (`AC`) over the intact MPV artist. The UI, shared
presentation snapshot, JSON, and DOM did not truncate the value.

The fix is not artist-specific and contains no `AC/DC` production hardcode.
`MetadataService` now reconstructs ID3v2.3 `TPE1` and `TPE2` frame text with
the original slash boundary before playback, Folders, USB, SMB, or Library can
consume it. That reconstructed value is atomic. ID3v2.4 and formats that
provide actual repeated artist values retain their existing behavior.

The shared backend metadata text boundary:

- accepts strings only;
- trims outer whitespace;
- converts NUL, control characters, and inappropriate multiline whitespace to
  safe spaces;
- bounds text to 512 grapheme clusters;
- preserves slash, backslash, ampersand, plus, hyphen, dots, apostrophes,
  commas, colons, semicolons, brackets, parentheses, markup-like text, valid
  Unicode, and combining characters;
- performs no path parsing and no implicit artist separation.

Existing unchanged Library rows are deliberately not rewritten. The current
incremental scanner skips unchanged size/mtime pairs, so an ordinary rescan
does not rewrite an already persisted `AC` row. A newly indexed or genuinely
modified file receives the corrected value. No destructive migration or
manual database edit was introduced.

## Now Playing typography and compact layout

- Track title: unchanged.
- Artist: from `1.8125rem` (29 px) to
  `clamp(1.9375rem, 2.45vw, 2rem)` (31–32 px).
- Album: from `1.4375rem` (23 px) to
  `clamp(1.5rem, 2vw, 1.625rem)` (24–26 px).
- Both remain one line with CSS ellipsis and their existing colors.
- Base 1280×800 artwork, visualizer, timeline, and transport remain unchanged.

The first real 1024×768 pass exposed an existing compact-layout failure:
artist, album, and technical metadata were not visible. The user explicitly
expanded this step for compact viewports. At widths up to 68.75rem:

- square artwork is now `clamp(18rem, 40vw, 25rem)`, never above 40vw;
- the visualizer is `clamp(5rem, 12vh, 6rem)`;
- metadata, technical line, timeline, transport, and focus remain visible.

At the smaller combined width/height fallback, artwork is
`clamp(16rem, 36vw, 20rem)`, the visualizer is
`clamp(4rem, 10vh, 5rem)`, artist/album retain a compact visual hierarchy, and
the technical row is no longer hidden.

The first real 1024×600 Technical visualizer pass then exposed a Canvas
collision: its 64 px surface still used 48 px values, 17 px labels, 14 px
bars, and the complete dB scale. The renderer now uses 24 px values and 11 px
labels below 120 px. Below 84 px it uses two 9 px L/R bars with a 4 px gap and
omits only the dB scale labels. Crest, LUFS-S, L/R, live levels, and peak holds
remain visible, with computed non-overlapping geometry. At 84 px and above the
scale is retained; the full-height presentation is unchanged.

No title, timeline, transport, Favorite, Queue, or primary 1280×800 geometry
was moved.

## Cover navigation and accessibility

The Default Now Playing artwork is wrapped by one native `button`:

- `type="button"`;
- accessible name from the existing `Open Library` i18n key;
- canonical `onOpenLibrary` callback;
- entire square hit target;
- native click, touch, Enter, and Space semantics;
- canonical visible focus outline;
- no tabindex, pointer capture, key handler, double event, nested button,
  drag, context menu, delay, playback action, or Queue mutation.

The reusable artwork component, decode-before-commit behavior, image alt text,
placeholder behavior, dimensions, and generation protection are unchanged.
The Favorite and transport buttons remain siblings outside the cover button.

## Tests

The focused suite first failed on the unmodified baseline for:

1. ID3v2.3 `AC/DC` reconstruction (`AC` observed);
2. the requested artist/album font ranges;
3. missing native artwork button/navigation.

After the fix, focused coverage passes for:

- `AC/DC`, `AC`, `DC`;
- leading, trailing, repeated, and spaced slash;
- `Artist A / Artist B`, `A/B`, and backslash;
- apostrophe, ampersand, punctuation, Unicode, combining characters;
- markup-like strings rendered as literal text;
- control characters, null, empty, non-string, and oversized input;
- metadata-over-fallback precedence;
- JSON/API serialization;
- shared presentation;
- ID3v2.3 artist/album-artist reconstruction;
- one atomic Library Track/Artist entity through a real temporary scanner and
  SQLite repository;
- native artwork button structure, label, callback, textContent, no nested
  pointer/key handlers, and compact CSS geometry.
- Technical meter geometry at 64 px and 96 px, including scale visibility,
  fixed lower anchoring, and a strict gap below the Crest/LUFS-S values.

Temporary test media and databases were generated only under the OS temporary
directory and removed by the tests. No user media was modified.

## Real Windows post-fix smoke

The backend hot reload exposed `artist: AC/DC` and `artists: [AC/DC]` while the
original 10 Queue IDs remained stable through that ordinary update. The user
confirmed in the real app:

- 1280×800: `AC/DC`, artwork click, typography, metadata, visualizer, timeline,
  transport, and layout PASS;
- 1024×768 initial attempt: FAIL because artist/album/technical data were not
  visible;
- 1024×600 initial Technical attempt: FAIL because the value and meter regions
  overlapped;
- 1024×600 after the ultra-compact Canvas correction: user-approved PASS;
- 1024×768 after compact correction: user-approved PASS;
- 1280×800: full Technical layout remained unchanged, user-approved PASS;
- 1366×768: layout, visible focus, Enter, Space, Library navigation, unchanged
  playback/Queue, and Technical visualizer user-approved PASS.

The normal close path left zero Neutralino and MPV processes and no listeners
on ports 4310 or 5173.

The functional state was restored to Queue count 10, current index 0, position
approximately 71.958 seconds, playing, volume 97.989433, mute/shuffle off, and
repeat off. A second deliberate app launch regenerated Queue session IDs while
preserving the same items and order; the first hot reload had preserved them.
This startup observation predates and is outside the metadata/UI fix and was
not changed.

## Documentation

Updated:

- architecture metadata text contract;
- UI/UX Now Playing cover, text rendering, fonts, and accessibility;
- testing guidance for raw-to-DOM metadata and cover navigation.

No installer, updater, deploy, Raspberry, or audio/network documentation was
changed.

## Final gates

All requested final gates passed:

- `npm.cmd run format:check`: PASS;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS;
- `npm.cmd run build:linux`: PASS;
- `npm.cmd test`: PASS, 528 tests (518 passed, 10 platform skips);
- `npm.cmd run test:posix`: PASS, 3 passed and 2 Windows platform skips;
- `npm.cmd run verify:network:deployment`: PASS;
- `npm.cmd run verify:linux:executables`: PASS, 41 tracked deployment
  files; Windows verified Git modes while POSIX world-write inspection remains
  a CI/device check;
- `npm.cmd run test:install:linux`: PASS, 71 install-safe tests (60 passed, 11
  platform skips);
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build --source-root .`:
  PASS;
- `npm.cmd run mpv:doctor`: PASS with MPV 0.41 and JSON IPC;
- `npm.cmd run test:mpv`: PASS, 8 real integrations;
- `npm.cmd run ffmpeg:doctor`: PASS;
- `npm.cmd run test:ffmpeg`: PASS, 3 real integrations;
- `git diff --check`: PASS.

The deployment verifier created two untracked Python cache directories. They
were moved out of the repository into a recoverable OS-temporary quarantine;
no `git clean` or recursive deletion was used. The final working tree contains
only the intended source, test, documentation, and report changes.

## Files and invariants

Expected changes are limited to:

- backend metadata text normalization and ID3v2.3 reconstruction;
- the existing PlayerService metadata boundary;
- Now Playing screen and scoped responsive CSS;
- focused backend/UI tests;
- pertinent development documentation;
- this report.

Explicit invariants:

- package plan and lockfile unchanged;
- dependencies unchanged;
- CI workflow unchanged;
- shared public types unchanged;
- MPV playback architecture unchanged;
- Queue drawer and mini-player source unchanged;
- installer, updater, deploy, Build ID, network, audio output, system, side
  menu, and power menu unchanged;
- no Raspberry test required or performed;
- no automatic commit or push.
