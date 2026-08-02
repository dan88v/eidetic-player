# Step 3.2.2 output — Raspberry AirPlay, startup, and waveform regression correction

## Status

The locally reproduced lifecycle and performance regressions are corrected in
the working tree and all applicable local/static gates pass. Nothing was
committed, pushed, or installed on the Raspberry Pi. Target-device
AirPlay/audio validation is still required before this correction can be called
deployed.

`LOCAL CORRECTION — NOT DEPLOYED`

`AIRPLAY AUDIO — REQUIRES PHYSICAL RETEST`

## Baseline and scope

- Branch: `main`.
- Baseline HEAD and `origin/main`:
  `2ae5072359ca4620c93ceb0bd52336ee2f2e2c55`.
- The existing uncommitted Step 3.2.1 doctor correction is preserved.
- No commit, push, reset, restore, stash, clean, install, update, or reboot was
  performed.

## Read-only Raspberry evidence

The installed release was build `2ae5072`. The application service was active,
but the managed AirPlay receiver was failed after exhausting three rapid
starts. Its unit required the backend control socket before launch, while a
persisted systemd user enablement started it before the backend had created
that socket:

- application service start: approximately `00:25:58`;
- backend listening: approximately `00:26:06`;
- AirPlay receiver exhausted its three-start limit by approximately
  `00:26:07`;
- MPV became ready later, approximately `00:26:13`.

The AirPlay API consequently reported `enabled: true`, `serviceStatus: error`,
and `AirPlay service state could not be changed.` A later backend start could
not recover it because `systemctl start` remained blocked by the old
`start-limit-hit` state.

The large general slowdown had a separate measurable source. Linux removable
storage had reached 328 refreshes at a 2.5-second interval. Each empty `lsblk`
enumeration took approximately 2.1–2.8 seconds, so enumeration was effectively
continuous despite no USB storage being attached. The Pi measured about 79 °C
and `get_throttled=0x20000`, recording CPU frequency capping since boot.

Once startup settled, the backend and Library were responsive: sampled API
calls were approximately 2–26 ms, the populated Library had 1,725 Tracks, and a
cached current waveform response was approximately 19 ms. This separated the
startup/background-load regression from SQLite or ordinary REST latency.

Waveform source review found two additional causes:

- the backend preloader still selected the legacy MPV Queue, which is empty for
  the Step 3.1 Context playback model (`currentQueueIndex: -1`);
- a backend preload and UI request that missed the cache together were
  serialized but could decode the same Track twice because the queued request
  did not recheck the completed cache entry.

The real AirPlay attempt reached the fail-closed grant and delivered a title,
but did not deliver a playing event, progress, artwork, or audio. Stopping the
sender then released to MPV while the provider unnecessarily restarted the
receiver. The available logs prove the boot race and bad release lifecycle;
they do not yet prove the underlying device-level reason the granted stream
failed to enter playing.

## Corrections

### AirPlay startup and recovery

- The persistent `airplay.json` setting is now the only On/Off authority.
- Every enabled startup removes legacy systemd boot enablement, clears a stale
  failed/start-limit state, and starts the receiver only after the backend
  runtime and private control socket are ready.
- An already-running receiver is also detached from boot enablement, then
  restarted once to load the newly rendered route.
- Explicit receiver restarts clear stale systemd failure state first.
- The managed unit uses one bounded verbose level so the next physical session
  records ALSA/timing errors in its journal without packet-level debug logging.

### AirPlay session release

- Natural `ended` and `disconnected` events are retained through the Arbiter's
  serialized release. They no longer make `stop()` restart Shairport while MPV
  is reclaiming the same output.
- Explicit preemption/error recovery retains the receiver restart behavior.
- After a fail-closed grant, buffering is bounded to 12 seconds. If Shairport
  never reports actual playback, the provider emits an error so the Arbiter
  releases the external source and restores local ownership instead of leaving
  the player frozen indefinitely.

### Raspberry background load

- Linux USB discovery performs its bootstrap enumeration once and then owns one
  `udevadm monitor --udev --subsystem-match=block --property` process.
- A 200 ms debounce coalesces a physical block-device event into one refresh.
- Windows and fixture providers without an event monitor retain the established
  single fallback poll.
- Shutdown removes the listener, debounce, monitor process, and fallback timer.

### Waveform responsiveness

- Backend preload now follows the Step 3.1 `currentPlayback` and
  `explicitQueue` playback-instance IDs, with legacy Queue fallback.
- Queued waveform requests recheck the cache after earlier work completes, so
  one concurrent preload/request pair cannot decode the same file twice.
- FFmpeg still produces the same 512 normalized display points, but its mono
  analysis stream is reduced from 8 kHz to 2 kHz to lower Pi-side sample-loop
  work.
- Production waveform HTTP uses the existing alternate loopback origin, like
  the visualizer. A slow cold decode therefore cannot occupy the last
  connection on the origin already used by the five app-lifetime SSE streams
  and queue Library/player commands behind it.

## Regression coverage

Focused tests cover:

- the exact systemd command plan with no receiver boot enablement;
- recovery of an already-running legacy-enabled receiver;
- natural AirPlay release without a receiver restart;
- bounded AirPlay buffering failure;
- Step 3.1 playback-plan waveform identity with legacy fallback;
- the 2 kHz extraction contract and cache recheck after serialized work;
- event-driven removable storage with no fallback timer;
- alternate-origin waveform requests and existing abort behavior.

The existing Step 3.2.1 deployment regression continues to guard the read-only
AirPlay doctor correction.

## Validation

- focused backend/UI suite — PASS, 64 tests, 0 failed;
- `npm.cmd run verify:airplay:deployment` — PASS;
- `npm.cmd run typecheck` — PASS;
- `npm.cmd run format:check` — PASS;
- `npm.cmd run lint` — PASS;
- `git diff --check` — PASS.
- `npm.cmd run build` — PASS for local UI, Remote UI, and backend;
- `npm.cmd test` — PASS, 832 tests: 819 passed, 13 platform skips, 0 failed;
- `npm.cmd run mpv:doctor` — PASS with MPV `v0.41.0-744-g304426c39`;
- `npm.cmd run test:mpv` — PASS, 14 tests, including real output
  release/restore and 24 automatic Context transitions;
- `npm.cmd run ffmpeg:doctor` — PASS;
- `npm.cmd run test:ffmpeg` — PASS, 3 tests, including a real waveform and
  one-process realtime analysis;
- `npm.cmd run verify:linux:executables` — PASS, 55 tracked deployment files;
- `npm.cmd run verify:linux:installer` — PASS, including 74 installer-safe
  tests (63 passed, 11 platform skips), network deployment, and AirPlay
  deployment;
- exact `npm.cmd run dev` — PASS for real Neutralino/WebView2, backend, Vite,
  and MPV startup; ports 4310/5173 and the launched processes were verified and
  removed afterward.

No visual geometry changed. Interactive surface inspection and a real-media
waveform load were NOT TESTED in the Neutralino window because the automation
session could not capture or control the interactive desktop. No residual
Neutralino, backend, Vite, MPV, FFmpeg, port, or temporary QA image remained.

## Physical validation still required

After the user commits, pushes, and installs the corrected build, validate on
the Pi:

1. reboot with AirPlay left On and confirm it reaches Ready without an Off/On
   toggle or `start-limit-hit`;
2. confirm removable diagnostics hold one event monitor and the refresh count
   stays unchanged with no USB event;
3. play Spotify from the phone and confirm audible output, `playing`, progress,
   metadata, and artwork when the sender supplies it;
4. if audio still fails, capture the new verbose receiver journal, NQPTP state,
   ALSA open error, and provider snapshot before stopping the phone;
5. stop the sender and confirm the configured local resume policy restores MPV
   once, with working Play/Pause afterward;
6. test a cold current waveform and a five-Track transition sequence while
   watching backend CPU, temperature, FFmpeg process count, Library latency,
   and UI command response.

Until item 3 passes, the no-audio defect is contained and observable but not
claimed physically solved. No commit or push was performed.
