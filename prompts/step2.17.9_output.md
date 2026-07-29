# Step 2.17.9 — Raspberry Pi Bootstrap and MPV Recovery Hotfix

Status: READY FOR COMMIT AND TARGET DEPLOYMENT

## Reported regression and Raspberry evidence

The installed Raspberry Pi release was Build `05842f9` in Appliance mode.
Configuration, MPV, FFmpeg, the indexed Library database, the configured SMB
source, user preferences, power helper, Polkit integration, and application
data were present.

The downloaded user-service journal isolated the failure:

- Raspberry desktop startup was congested for roughly four minutes;
- the backend subsequently reached its MPV version probes;
- both four-second probes timed out;
- MPV unavailability rejected the whole backend bootstrap;
- session restore and Library automatic-scan scheduling failed as a cascade;
- the frontend's five-second safety fallback mounted development defaults,
  producing `Build dev`, Windows/development capabilities, no real power menu,
  and missing Library navigation.

The data was not lost. The live backend reported 1,224 tracks, 68 albums, 79
artists, one configured source, and a valid Library integrity check. A
user-service-only restart later found `/usr/bin/mpv` 0.40.0, restored the
selected GPIO/I2S audio route, returned the real Build ID and Appliance
preferences, and reached ready state without rebooting the Pi.

The captured diagnostic artifacts are local, ignored working files:

- `rpi-diagnostics-20260729-013815.log`;
- `rpi-restart-probe-20260729-014235.log`.

## MPV-independent application bootstrap

The backend now has separate core and player barriers.

The core barrier owns preferences, removable storage, and SMB state. It:

- makes readiness HTTP-reachable;
- serves `/api/bootstrap` with authoritative system capabilities, Build ID,
  preferences, and current player state;
- unblocks preference routes;
- starts Library automatic-scan scheduling.

MPV discovery, audio-output preparation, DSP initialization, analyzer startup,
and player-session restore continue independently. A slow or missing MPV can
therefore disable playback, but it cannot replace Appliance state with
development defaults or block navigation, Library, Folders, Settings, update,
drawer, or system menus.

Session restore detects unavailable MPV before touching the saved session. It
defers restoration and preserves the durable file for a later successful
recovery.

## MPV diagnosis and recovery

Linux MPV version probes now have a 12-second cold-start allowance. A killed or
timed-out child is classified as `timeout` rather than `spawn-failed`.

Recovery uses one bounded timeout chain at 5, 15, and 30 seconds. It:

- coalesces concurrent automatic and manual attempts;
- rediscovers MPV and recreates its JSON IPC controller;
- reapplies audio output and DSP policy;
- restores the saved player session;
- refreshes readiness and waveform preloading;
- receives a fresh bounded budget after a successful recovery;
- also starts after a failed runtime MPV restart.

The existing immediate controlled restart remains the first response to an
unexpected MPV exit. Its state is now `loading`, preventing a concurrent manual
restart race. If it fails, the bounded recovery chain takes over.

`POST /api/player/retry-mpv` accepts only an empty JSON object and returns a
sanitized 503 failure when MPV remains unavailable.

## Now Playing recovery UI

The MPV recovery control is contextual to Now Playing, to the right of the
cover. Settings > Audio is unchanged.

When playback is offline, Now Playing:

- explains that Library and file browsing remain available;
- reports automatic recovery;
- exposes a 48-pixel-or-larger `Retry MPV` touch control after startup fails;
- disables the control while startup or recovery is active;
- replaces the playback-only visualizer slot with the recovery status, avoiding
  overflow and layout shift.

Only playback controls are unavailable. Library, Folders, drawer navigation,
Settings, power, and other application UI remain independent.

## Power-menu capability correction

The installed doctor validated the root-owned power helper and Polkit policy,
but the backend omitted reboot and shutdown while still exposing restart-app
and maintenance. Capability discovery had incorrectly required the
unprivileged application to read the root-owned Polkit rule.

Availability now checks the executable runtime entry points (`pkexec` and the
fixed helper). The existing privileged, bounded `pkexec ... helper probe`
remains authoritative before reboot or shutdown is scheduled. Policy
validation remains owned by installation verification and the doctor.

## Regression coverage

Focused tests cover:

- Raspberry/Linux MPV probe timeout and timeout classification;
- session preservation while MPV is unavailable;
- fixed-output/DSP initialization without MPV commands;
- bounded, singleton recovery, manual coalescing, and a fresh later budget;
- contextual Now Playing recovery with no Settings control;
- core bootstrap/readiness independence from the player barrier;
- power capability discovery without unprivileged policy-file read access;
- unchanged privileged power preflight and fixed action arguments.

The real Windows Neutralino/WebView2 app was launched with the required exact
`npm.cmd run dev` command and inspected at 1280 × 800. The MPV-starting view,
recovery layout, drawer, navigation to Library, mini-player, transport, top bar,
and stable dark surfaces passed visual inspection. The development build label
was correctly limited to this development launch.

## Validation

The completed final validation set is:

- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS;
- `npm test`: PASS — 596 passed, 11 platform skips, 0 failed;
- `npm run mpv:doctor`: PASS;
- `npm run test:mpv`: PASS — 10 passed;
- `npm run ffmpeg:doctor`: PASS;
- `npm run test:ffmpeg`: PASS — 3 passed;
- `npm run verify:linux:executables`: PASS — 46 tracked deployment files.

Final process inspection found no residual MPV, FFmpeg, Neutralino, or Vite
process.

The Raspberry target still requires installation of this hotfix build followed
by the real bootstrap, Library, MPV recovery, Build ID, power capability,
process-singleton, and clean-shutdown checks.
