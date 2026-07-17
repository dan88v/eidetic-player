# Eidetic Player

Eidetic Player is a lightweight, touch-first local audio player targeting a
horizontal 1280 × 800 display and a future Raspberry Pi 3B deployment. The
current Step 2.2 build uses a vanilla TypeScript UI, a Node.js control service,
Neutralinojs for native file paths, and one persistent MPV process for decoding
and system audio output.

## Requirements

- Node.js 22.12 or newer and npm
- MPV available either as `mpv` in `PATH` or through `EIDETIC_MPV_PATH`
- Windows for the current Neutralino development shell; the MPV IPC layer also
  supports Unix domain sockets for the future Linux target

MPV is deliberately not bundled, downloaded, or installed by this repository.
After installing it, verify the setup with:

```sh
npm run mpv:doctor
```

Copy `.env.example` to `.env` to configure an absolute executable path when MPV
is not in `PATH`:

```dotenv
EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe
```

If MPV cannot be verified with `--version`, the backend still starts, health and
player APIs remain available, and the UI shows a clear unavailable state.

## Install and run

```sh
npm install
npm run neutralino:update
npm run dev
```

`npm run dev` starts the backend and Vite, waits for their health checks, and
opens the Neutralino window. Closing the shell or interrupting the command
terminates its development process tree. Vite proxies `/api` to the backend in
development.

## Commands

| Command                     | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `npm run dev`               | Run backend, UI, and Neutralino shell                |
| `npm run build`             | Build production UI and backend into `dist/`         |
| `npm test`                  | Run lightweight Node unit tests through `tsx`        |
| `npm run test:mpv`          | Run the silent optional MPV integration test         |
| `npm run mpv:doctor`        | Verify MPV discovery, headless startup, and JSON IPC |
| `npm run typecheck`         | Strictly type-check all TypeScript projects          |
| `npm run lint`              | Run ESLint                                           |
| `npm run format:check`      | Verify Prettier formatting                           |
| `npm run neutralino:update` | Update the platform Neutralino runtime               |

## Local files and queue rules

Supported initial extensions are FLAC, WAV/WAVE, MP3, M4A, AAC, ALAC, OGG,
Opus, AIFF/AIF, WMA, APE, and WV. The list lives once in `packages/shared` and is
used by the native dialog, UI drop filter, backend validation, and tests.

- Opening one file reads only its parent directory's first level, natural-sorts
  supported readable files by name, and queues the selected file plus later
  files. Earlier files are not included.
- Opening multiple files uses only the explicit selection, keeps its order, and
  removes duplicates while retaining the first occurrence.
- Invalid selections do not replace the current queue. No recursive scan, audio
  decoding, or bulk metadata analysis happens in Node.js.

The Open Files actions on Now Playing and Sources use the same native
`PlatformBridge`. Native `filesDropped` events enter the same backend open flow.
A regular browser fallback cannot open trusted absolute local paths and reports
that the native shell is required.

## Playback behavior

The real controls cover play/pause, previous (restart after three seconds),
next, absolute seek, queue selection, software volume, mute, Shuffle, and Repeat
Off/All/One. Volume, mute, shuffle, repeat, and existing UI preferences persist
locally. Queue, track, position, metadata, and play/pause state do not persist.

MPV remains authoritative for playback, duration, codec, output sample rate,
audio device, and controls. The backend uses `music-metadata` for asynchronous
tag enrichment and artwork discovery without delaying MPV startup. Missing tags
use filename, Unknown Artist, and Unknown Album fallbacks.

Artwork priority is embedded front cover, then case-insensitive `cover`,
`folder`, and `front` JPEG/PNG/WebP files in the track directory. Images are
validated by MIME and signature and limited to 15 MiB. Embedded images use a
private session directory under the OS temporary directory; the UI receives
only opaque artwork IDs. Current and next-track metadata are cached and
preloaded, while other Queue artwork loads lazily.

## Step 2.2 limits

There is no database, indexed library, online artwork lookup, thumbnail
generation, network source, USB detection, DAC selection, session restore,
audio analysis, or transcoding. The browser/WebView scales original artwork.
Waveform, stereo meter, and spectrum remain deterministic graphics.

See [Architecture](docs/architecture.md) and [UI calibration](docs/ui.md).
