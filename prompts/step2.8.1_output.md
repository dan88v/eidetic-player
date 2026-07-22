# Step 2.8.1 — README and screenshots refresh

Date: 2026-07-22

## Result

Step 2.8.1 is complete within its documentation-only scope. `README.md` now
describes the implemented product, setup, architecture, platform status,
limitations, roadmap, and CI behavior in English. The CI section is the final
section of the document.

The previous screenshots were removed with `git rm`:

- `docs/images/folders.png`
- `docs/images/now-playing-technical.png`

They were replaced by exactly four current screenshots:

| File                                    | Dimensions |          Size |
| --------------------------------------- | ---------: | ------------: |
| `docs/screenshots/default-spectrum.png` | 1280 × 800 |  49,904 bytes |
| `docs/screenshots/library.png`          | 1280 × 800 |  53,404 bytes |
| `docs/screenshots/favorites.png`        | 1280 × 800 |  40,210 bytes |
| `docs/screenshots/cassette-player.png`  | 1280 × 800 | 636,557 bytes |

## Screenshot procedure

All four images were captured from the real Neutralino client area at exactly
1280 × 800, without desktop or window chrome. The application used an isolated
temporary profile containing only six generated FLAC files, synthetic metadata,
and generated geometric artwork. No personal media, paths, metadata, or artwork
were used.

The screenshots cover the Default Player with Stereo Spectrum, Library Albums,
Favorite Tracks, and the Cassette Player. Playback, Queue state, Favorites,
visualization, seek position, and cassette-reel state came from the running
application rather than a mock page. No toast, open drawer, transient menu, or
mouse cursor is present.

The Neutralino window was closed normally after capture. The temporary profile
and all intermediate demo material were removed, and no Neutralino, backend,
Vite, MPV, FFmpeg, or related listener remained active.

## Documentation verification

- The README references all four new images with descriptive alt text.
- Every relative README link resolves to a repository file or directory.
- Active documentation under `README.md` and `docs/` contains no reference to
  either obsolete screenshot path.
- The previous filenames remain mentioned only in the immutable historical
  `step2.4.4` audit report; that earlier step report was not rewritten.
- Current functionality is separated from planned work, including explicit
  Raspberry Pi and Linux validation limits.
- Windows commands use `npm.cmd`; Linux commands and the dedicated Linux guide
  are included.

## Files changed

- `README.md`
- removed `docs/images/folders.png`
- removed `docs/images/now-playing-technical.png`
- added the four files under `docs/screenshots/`
- added `prompts/step2.8.1_output.md`

No application source, CSS, database, configuration, dependency, or test file
was changed. Step 2.8.2 was not started. No commit or push was performed.

## Checks

- `npm.cmd run format:check`
- `git diff --check`
