# Step 2.13.3 — README and full-width screenshots refresh

## Result

Completed the documentation-only README and screenshot refresh. Eidetic Player
is now described explicitly as being in active development, with Raspberry Pi
hardware and full appliance validation still pending.

No application code, CSS, contracts, dependencies, database implementation,
tests, installer or Linux deployment script was changed. Step 2.13.4 was not
started.

## Screenshots

Removed the four previous README screenshots:

- `docs/screenshots/default-spectrum.png`
- `docs/screenshots/cassette-player.png`
- `docs/screenshots/library.png`
- `docs/screenshots/favorites.png`

Added exactly five PNG files:

| File                               | Dimensions | Size          |
| ---------------------------------- | ---------- | ------------- |
| `default-player-mono-spectrum.png` | 1280 × 800 | 188,268 bytes |
| `cassette-player-full.png`         | 1280 × 800 | 519,364 bytes |
| `library-album-grid.png`           | 1280 × 800 | 478,639 bytes |
| `favorite-tracks.png`              | 1280 × 800 | 98,780 bytes  |
| `sources-network-share-dialog.png` | 1280 × 800 | 54,514 bytes  |

All five have a valid PNG signature, unique SHA-256 hash and exact 1280 × 800
client dimensions. They contain no Windows frame, desktop, cursor, accidental
toast, local path, password or corrupt text.

The application was started with exactly `npm.cmd run dev`. Captures came from
the real Neutralino/WebView2 framebuffer, not a browser, mock, headless page,
HTML reconstruction or generated image.

The Default, Cassette, Library and Favorites captures use the real connected
Library and its real artwork/metadata. Eight available real tracks were added
temporarily to place unavailable Favorites outside the captured viewport.

The Sources capture used a temporary isolated APPDATA/LOCALAPPDATA profile
because the real Sources screen exposed a private SMB hostname/address. The
isolated profile contained no sources, credentials or demo media. The Add
Network Share dialog shows Account selected and all Name, Server, Share,
Username, Password and Domain fields empty.

Before QA, the complete real application state was backed up. After capture it
was restored exactly, including Queue/session, current item, preferences,
player/visualizer modes, Library database and original Favorites. The isolated
profile and backup were removed.

## README and Linux trial documentation

The English README now provides:

- a prominent active-development warning;
- product overview and five separate full-width screenshot sections;
- current Playback, Main Player, visualizer, Library, Favorites, History,
  Playlist, USB, SMB, Network and UI functionality;
- Raspberry Pi 3B+ and ideal 1280 × 800 target;
- exact Raspberry Pi OS Trixie Desktop and Ubuntu 26.04 Desktop support scope;
- honest Raspberry Pi/hardware validation limitations;
- Windows source quick start;
- the real Linux installer path and actual flags;
- Standard and independently configurable Appliance modes;
- real update, rollback, doctor, restore, uninstall and purge commands;
- architecture, security, local-data behavior, current limits, roadmap and
  license;
- Continuous Integration as the final section.

`deploy/linux/README.md` is now a detailed trial guide for Raspberry Pi OS and
Ubuntu. It covers preparation, dry-run, a recommended Standard first install,
Appliance choices, first-run checks, doctor, permissions, update/rollback,
restore, uninstall/purge, staging and safe problem reporting.

## Quality and privacy

- README local links: 13 checked, 0 broken.
- Continuous Integration is the final README section.
- No active reference to an old README screenshot remains.
- No mojibake, local Windows path, private IP, private hostname, username or
  credential appears in the updated documentation.
- Repository URL, installer flags and maintenance commands match the committed
  files.
- Future features are listed only as unavailable/current limitations.

Cleanup confirmed:

- zero Eidetic Neutralino/backend/Vite/MPV processes;
- zero listeners on ports 4310/5173/9222;
- zero intermediate screenshots or capture helper;
- zero isolated profiles or temporary Favorites;
- no media, NAS, USB, network profile or credential modification.

## Changed files

- `README.md`
- `deploy/linux/README.md`
- five files under `docs/screenshots/`
- `prompts/step2.13.3_output.md`

No commit or push was performed.
