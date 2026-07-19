# Eidetic Player

Eidetic Player is a lightweight, touch-first local audio player targeting a
horizontal 1280 × 800 display and a future Raspberry Pi 3B deployment. The
current Step 2.4.1 build uses a vanilla TypeScript UI, a Node.js control service,
Neutralinojs for native file paths, and one persistent MPV process for decoding
and system audio output.

## Requirements

- Node.js 22.12 or newer and npm
- MPV available either as `mpv` in `PATH` or through `EIDETIC_MPV_PATH`
- FFmpeg is optional for real visualizers and waveform generation; configure
  `EIDETIC_FFMPEG_PATH` or make `ffmpeg` available in `PATH`
- Windows for the current Neutralino development shell; the MPV IPC layer also
  supports Unix domain sockets for the future Linux target

MPV is deliberately not bundled, downloaded, or installed by this repository.
After installing it, verify the setup with:

```sh
npm run mpv:doctor
npm run ffmpeg:doctor
```

Copy `.env.example` to `.env` to configure an absolute executable path when MPV
is not in `PATH`:

```dotenv
EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe
EIDETIC_FFMPEG_PATH=C:\Tools\ffmpeg\bin\ffmpeg.exe
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
| `npm run test:ffmpeg`       | Run the optional real FFmpeg analysis integration    |
| `npm run mpv:doctor`        | Verify MPV discovery, headless startup, and JSON IPC |
| `npm run ffmpeg:doctor`     | Verify FFmpeg discovery and version execution        |
| `npm run typecheck`         | Strictly type-check all TypeScript projects          |
| `npm run lint`              | Run ESLint                                           |
| `npm run format:check`      | Verify Prettier formatting                           |
| `npm run neutralino:update` | Update the platform Neutralino runtime               |

## Local files and queue rules

Supported initial extensions are FLAC, WAV/WAVE, MP3, M4A, AAC, ALAC, OGG,
Opus, AIFF/AIF, WMA, APE, and WV. The list lives once in `packages/shared` and is
used by the native dialog, UI drop filter, backend validation, and tests.

- Opening one file reads only its parent directory's first level, natural-sorts
  supported readable files by name, queues the whole folder, and starts exactly
  at the selected file while MPV prepares the ordered playlist in pause.
- Opening multiple files uses only the explicit selection, keeps its order, and
  removes duplicates while retaining the first occurrence.
- Invalid selections do not replace the current queue. No recursive scan, audio
  decoding, or bulk metadata analysis happens in Node.js.
- Queue `Add Files` appends only the explicit selection without expanding a
  folder or interrupting playback. Individual opaque Queue IDs can be removed;
  `Clear Queue` uses an accessible confirmation and resets playback.

File actions outside the empty Now Playing screen use the native
`PlatformBridge`. Native `filesDropped` events enter the same backend open flow.
A regular browser fallback cannot open trusted absolute local paths and reports
that the native shell is required.

## Local Sources, Folders, and Library

Sources can add a real local folder through Neutralino's native folder dialog.
Rename changes only its display name, while Remove only removes configuration:
media files are never changed or deleted. USB Storage and Network Shares remain
non-functional placeholders.

Sources persist in `%APPDATA%\Eidetic Player\sources.json` on Windows and
`${XDG_CONFIG_HOME:-~/.config}/eidetic-player/sources.json` on Linux using
atomic writes and corruption recovery.

Folders reads one directory level on demand. Its source/folder cards support
persistent sorting and List/Grid preferences, clickable body/artwork Open
targets, per-folder file counts, and lazy real-artwork previews (sidecar first,
otherwise up to four unique embedded covers from the first eight direct audio
files). Folder and audio-row menus expose Play/Add to Queue. Audio rows add compact
container/codec, bitrate, bit-depth, and sample-rate quality without a second
metadata parse. Opening a row or playing a folder uses the existing atomic
`PlayerService` path; adding a folder appends without starting an empty Queue.

Library is a separate placeholder for the indexed database planned in the next
step. Folders and Library have independent navigation entries and Now Playing
shortcuts so both workflows can coexist.

Native roots remain backend-only after Add Folder. UI contracts use opaque
source/entry IDs and logical relative paths. Central Windows/POSIX containment
checks block traversal and prefix collisions; symlinks and junctions are not
browsable. The directory LRU is limited to 32 entries.

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

## Real analysis and waveform

FFmpeg runs only as a sidecar and never changes MPV's playback signal. One
shared, real-time process decodes stereo float PCM at 24 kHz for a 20 Hz SSE
stream. The internal engine computes L/R peak and RMS plus logarithmic FFT bands
for Meter, Mono Spectrum, and Stereo Spectrum. It stops on pause, seek, track
change, Queue clear, leaving Now Playing, mode None, or the last subscriber
disconnecting.

Waveforms decode mono PCM at 8 kHz without `-re`, aggregate incrementally into
512 normalized points, and use a 64-entry session LRU keyed by canonical file
identity. Current track has priority, followed by the next track. If FFmpeg is
missing or fails, playback continues and the existing deterministic Canvas
graphics remain available.

`EIDETIC_ANALYZER_ENABLED=false` disables real-time analysis and
`EIDETIC_WAVEFORM_PRELOAD_NEXT=false` disables next-track waveform preload.

## Step 2.4.1 limits

There is no database, indexed/searchable Artist/Album/Genre library, recursive
scan, filesystem watcher, online artwork lookup, thumbnail generation, real
network/USB provider, DAC selection, Queue/playback restore, tag editing, audio
DSP, or modification of the signal played by MPV. Runtime Linux and FFmpeg
performance on Raspberry Pi 3B have not yet been validated.

See [Architecture](docs/architecture.md) and [UI calibration](docs/ui.md).
