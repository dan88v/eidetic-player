# Step 2.17.9 — Raspberry Pi Bootstrap and MPV Recovery Hotfix

Status: DEPLOYED TO RASPBERRY PI — BOOTSTRAP, MPV RECOVERY, AND HTTP
CONNECTION-STARVATION HOTFIXES

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

## Post-deployment regression and corrected diagnosis

The first `a2be5bf` deployment restored the authoritative Build ID and
Appliance capabilities, but it did not restore application function. A full
service restart reproduced the same failure with fresh Neutralino, backend,
and MPV processes:

- Library remained permanently on `Loading`;
- Sources and file browsing did not complete;
- REST-backed power actions could not complete;
- direct Raspberry API probes still returned valid Library, browse, Build,
  system-capability, and MPV data.

The same defect was then reproduced in the required real Windows application
with the exact `npm.cmd run dev` command. WebView2 DevTools showed
`/api/library/albums?limit=48` permanently `Pending`, while a direct request to
the same backend completed in under one second.

The in-app updater had added a sixth permanent EventSource connection at
application startup. WebView2's HTTP/1.1 per-host connection budget was
therefore fully occupied by the player, Library, SMB, network, removable
storage, and updater SSE streams. Bootstrap completed before saturation, which
explains the correct Build ID, while subsequent Library, browsing, artwork,
and system REST requests waited indefinitely.

The Software Update EventSource is now demand-driven:

- the initial update state remains one ordinary REST request;
- no updater stream is opened for idle or terminal jobs;
- starting or resuming an active update opens the single updater stream;
- update progress remains global across navigation;
- terminal state or the final subscriber closes the stream immediately.

This restores one HTTP connection for normal REST work without polling,
duplicate streams, or loss of update progress.

The production frontend also no longer turns one transient bootstrap failure
into permanent development defaults. Production bootstrap requests use a
bounded five-second attempt and bounded 0.5/1/2/5-second backoff, retaining the
dark splash until authoritative backend state arrives. Development retains its
explicit fallback for backend-independent UI work.

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
`npm.cmd run dev` command and inspected at 1280 × 800. The original permanent
Library loading state was reproduced before the correction. After hot reload:

- Library rendered the populated Album grid;
- Sources rendered the indexed Diskstation source and connected SMB resource;
- Browse opened `SMB / Diskstation` and rendered its folder grid;
- the Power dialog opened and exposed the correct Windows Quit action;
- confirmed Quit closed Neutralino, backend, Vite, MPV, and the development
  orchestrator cleanly.

The MPV-starting/recovery layout, drawer, mini-player, transport, top bar, and
stable dark surfaces remained intact. The development build label was
correctly limited to this development launch.

## Validation

The completed final validation set is:

- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS;
- `npm test`: PASS — 598 passed, 11 platform skips, 0 failed;
- `npm run mpv:doctor`: PASS;
- `npm run test:mpv`: PASS — 10 passed;
- `npm run ffmpeg:doctor`: PASS;
- `npm run test:ffmpeg`: PASS — 3 passed;
- `npm run verify:linux:executables`: PASS — 46 tracked deployment files.

Final process inspection found no residual MPV, FFmpeg, Neutralino, or Vite
process.

## Raspberry deployment

GitHub Actions run `30427595601` completed successfully for exact commit
`a2be5bfa3769fbd7b9068fcf15ead94556325422`. The official interactive remote
updater then:

- fast-forwarded the clean Raspberry checkout from `05842f9` to `a2be5bf`;
- preserved application data, configuration, and the pre-existing GPIO/I2S
  integration;
- built and staged the release in isolation;
- activated it and restarted only `eidetic-player.service`;
- passed hard service, HTTP, and exact Build ID verification;
- passed the complete read-only installation doctor, including MPV, FFmpeg,
  power helper, Polkit policy, power capabilities, update integration, and
  build-info coherence;
- reported the application reachable with MPV available;
- passed the same-commit `Already up to date.` proof;
- performed no Raspberry reboot.

The first post-restart readiness response already returned HTTP success with
Build `a2be5bf`, `mpvAvailable: true`, and payload status `starting`. This is
the intended core/player barrier separation: the shell can start with
authoritative platform and Build information before the remaining player
initialization completes.

The first deployment did not pass functional acceptance despite its successful
installer and doctor checks; it is retained above as diagnostic history, not
as the final product PASS.

The corrective commit was subsequently built by GitHub Actions and installed
with the official interactive remote updater. The updater preserved data and
configuration, activated the new release, restarted the full player service,
and passed exact Build ID, readiness, doctor, and no-op verification. Final
Raspberry acceptance additionally exercised populated Library loading, Sources
and SMB folder browsing, and opening the Appliance power menu after the fresh
service start.

## Header updater alignment correction

After Raspberry functional acceptance, the inactive updater indicator was
found to leave a visible blank slot between the remaining system icons and the
clock. The indicator used `visibility: hidden`: its contents disappeared, but
its fixed 44-pixel touch box and the adjacent icon gap remained in the header
layout.

The inactive updater indicator now uses `display: none`. It contributes no
layout width while idle. When an update becomes active, it returns as the final
system icon immediately to the left of the clock; because the clock side of the
header remains anchored, the system icon group grows toward the left.

The focused Software Update regression test now requires the inactive updater
rule to use `display: none` and rejects the former `visibility: hidden`
behavior. No application logic, updater lifecycle, touch target, dependency, or
runtime process was changed.

The defect and correction were inspected in the real Neutralino/WebView2 app at
1280 x 800 using the required `npm.cmd run dev` path. Before the correction,
the invisible 44-pixel updater touch box plus its group gap separated SMB from
the clock. After hot reload, the remaining Wi-Fi, audio, and SMB icons were
contiguous with the clock-side group, with no reserved updater slot, no layout
shift, and no change to the Now Playing, transport, or mini-player surfaces.

Validation for this final correction:

- full `npm test`: PASS — 598 passed, 11 platform skips, 0 failed;
- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS.

The update installation action itself was not run for this layout correction;
the user will exercise it on the Raspberry Pi after committing and pushing the
reviewed changes.
