# Step 2.17.9 — Raspberry Pi Bootstrap and MPV Recovery Hotfix

Status: DEPLOYED TO RASPBERRY PI — BOOTSTRAP, MPV RECOVERY, AND HTTP
CONNECTION-STARVATION HOTFIXES - TEST

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

## In-app update start failure and Settings correction

### Raspberry diagnosis

The first real `Start update` test did execute the privileged path, despite the
UI appearing to do nothing. Read-only SSH diagnostics found two failed system
unit invocations at 14:06 and 14:07 CEST:

- installed build `4c32905`;
- checked target `2e55449`;
- target resolution completed;
- both runs failed in step 3, before activation;
- the protected log reported `invalid Git metadata path in source checkout`;
- rollback was not required and the installed release remained `4c32905`.

The installed runner invoked
`/opt/eidetic-player/current/deploy/linux/update-eidetic-player.sh`. A packaged
release intentionally contains no `.git` directory, but the embedded installer
preflight correctly requires a real checkout. The in-app path therefore could
never reach its isolated application build.

The backend also could not observe the failure. The protected
`/var/lib/eidetic-player` parent was `root:root 0750`, while the root system
unit used `Group=root` and `UMask=0077`. The `daniele` backend could neither
traverse the state parent nor read the sanitized journal. In addition, the
helper used `systemctl start --no-block`; the immediate HTTP 202 snapshot could
remain `idle`, causing the demand-driven UI stream to close before the runner
created its first journal entry.

### Updater and journal correction

When the updater runs from an installed release without Git metadata, it now:

- creates bounded private bootstrap workspace/runtime directories;
- fetches only the already checked exact target SHA from the fixed official
  remote as the runtime user;
- invokes the installer from that checkout, preserving the existing checkout
  preflight and separate isolated build checkout;
- removes the bootstrap directories on success or failure using guarded exact
  path families.

The installed update service is rendered with the configured runtime group and
`UMask=0027`. `/var/lib/eidetic-player` grants that group traverse-only `0710`
access; the setgid update directory remains `2750`. Root-only requests stay
`0600`, while atomic current/history journals remain `0640` and become readable
by the backend. The doctor and staging suite now verify the rendered unit,
state traversal, ownership, and runtime-user journal readability.

After the helper accepts a job, the backend publishes a job-specific `queued`
state before returning. It no longer performs the racy immediate journal read,
and a stale journal from an earlier job cannot replace the newly accepted job.
This guarantees that the single demand-driven updater EventSource opens
immediately and later progress or failure remains visible.

### Software Update UI

The requested Settings layout now keeps only Update branch, Current build, the
Target build, and job status in the bordered information panel.

- `Check for updates` and `Start update` are separate equal-width sibling
  buttons below the panel.
- `Refresh branches` is a separate full-width button below the branch list.
- Current build shows its embedded build timestamp beside the Build ID.
- Target build shows the canonical GitHub commit timestamp beside the checked
  Build ID when available. The target has not yet been built locally, so the
  commit timestamp is the truthful pre-install target time; timestamp lookup is
  best-effort and never blocks checking or updating.
- Confirming Start renders `Starting update...` immediately while authorization
  is pending. Accepted work then renders `Update in progress` from the
  authoritative queued/running snapshot.

The real Neutralino/WebView2 app was launched at 1280 x 800 with the exact
`npm.cmd run dev` command and the supported Appliance fixture. The Software
Update page, confirmation dialog, active job status, adjacent top-bar updater
indicator, and Update branch page were exercised with real pointer input.
Both 50% actions fit without overflow or wrapping instability, timestamps fit
the canonical rows, Refresh branches is visually separate, and Now Playing,
the top bar, mini-player, and transport retained their established geometry.

This patch itself must be installed once with the official remote updater,
because the currently installed in-app runner fails before it can repair its
own bootstrap and journal integration. After that installation, the next
in-app update can validate the repaired end-to-end path.

Validation for this updater correction:

- focused updater and installation regressions: PASS — 40 passed, 3
  platform-specific skips, 0 failed;
- full `npm test`: PASS — 598 passed, 11 platform-specific skips, 0 failed;
- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS;
- `npm run verify:linux:executables`: PASS — all 46 tracked deployment files
  have valid Git modes;
- `bash -n` on the changed Linux scripts: PASS;
- `deploy/linux/test-staging.sh`: PASS, including installed-release bootstrap,
  rendered update-service identity, state-directory access, and journal
  readability fixtures;
- real Neutralino/WebView2 visual and interaction QA at 1280 x 800: PASS.

The bootstrap correction was subsequently installed successfully through the
official remote updater. End-to-end execution of the repaired in-app path
remains intentionally pending for the next published commit.

## Identical-build timestamp correction

After the repaired release was installed remotely, an up-to-date check showed
the same Build ID twice but paired it with two different instants: Current
build used the embedded release build time, while Target build used the GitHub
commit time. Both values were individually valid, but the presentation was
misleading for an exact-SHA no-op.

The backend now reuses `currentBuiltAt` for `targetCommitAt` whenever the
resolved current and target SHAs are identical. A genuinely different target
continues to show its canonical commit timestamp because that future release
has not yet been built locally. The up-to-date service regression now requires
the two timestamps to match.

Validation for this final semantic correction:

- focused updater/UI regressions: PASS — 7 passed, 0 failed;
- full `npm test`: PASS — 598 passed, 11 platform-specific skips, 0 failed;
- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS.

No UI structure or styling changed in this correction; the already validated
Software Update row geometry remains unchanged.

## In-app runtime-identity correction

The first in-app update after installing the repaired bootstrap reached the
expected protected system service but failed during preparation. Read-only SSH
diagnostics captured the exact protected log:

`runuser: cannot set user id: Operation not permitted`

The job had correctly pinned target `db0fb4a`, entered step 3, and required no
rollback. The service template combined `User=root` with
`NoNewPrivileges=yes`, but the installer deliberately uses `runuser` to fetch,
install dependencies, and build as the unprivileged runtime identity. On the
Raspberry Pi this hardening flag blocked the required root-to-runtime UID
transition before the checked source could be fetched.

The fixed, root-owned updater unit now declares `NoNewPrivileges=no`
explicitly. This does not broaden the public authorization surface: the
Polkit rule still accepts only the exact helper and action, the helper writes a
closed root-only request, and the runner still validates branch, current SHA,
target SHA, expiry, origin, paths, and installed provenance. It only permits
the already required privilege drop inside that fixed workflow.

Focused source, doctor, and staging regressions now require the rendered unit
to preserve `Group=<runtime user>`, `UMask=0027`, and
`NoNewPrivileges=no`.

Validation for this runtime-identity correction:

- SSH diagnosis: PASS — exact protected failure and no-rollback state
  captured;
- focused Linux/updater regressions: PASS — 27 passed, 0 failed;
- full `deploy/linux/test-staging.sh`: PASS in 184.5 seconds;
- full `npm test`: PASS — 598 passed, 11 platform-specific skips, 0 failed;
- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS;
- `npm run verify:linux:executables`: PASS — all 46 tracked deployment files
  retain valid Git modes;
- Bash syntax checks for the affected updater, doctor, and staging scripts:
  PASS.

No Raspberry mutation or reboot was performed during diagnosis. Because the
currently installed system unit is the component blocking `runuser`, this unit
correction must be installed once through the official remote updater before
the next in-app update test.

## In-app progress-state and descriptor correction

The corrected service unit was installed remotely as Build `8dd3ae3`; the
official updater, hard health gate, doctor, and same-commit no-op all passed.
The next in-app target, `5a83c9f`, then appeared to move from `Queued` to
`Interrupted`.

Two read-only SSH inspections and a persistent systemd monitor proved that
this first status was false. While the UI said `Interrupted`, the
`Type=oneshot` unit remained `activating` and continued through dependency
installation, typecheck, and installer verification. The backend had used
`systemctl is-active`, which returns non-success while a oneshot service is
still activating. Reconciliation now reads `ActiveState` directly and treats
both `activating` and `active` as live. A focused pure-state regression covers
the exact systemd values.

The real update eventually reached a separate terminal failure after roughly
eight minutes:

`ERROR: no dedicated runtime progress descriptor is available`

The root runner already owned descriptor 7 for job events, while the nested
updater/installer path also had descriptor 6 open. The runtime protocol helper
assumed one of those two fixed descriptors would be free and aborted before
the application build. It now asks Bash for a free dynamic descriptor, exports
that exact inherited number to the runtime child, and closes only that owned
descriptor afterward. The console protocol fixture deliberately occupies both
6 and 7 and verifies that structured events still cross an external child
without leaking into human output.

The failed Raspberry attempt did not activate a release and required no
rollback; Build `8dd3ae3` remained installed. No reboot was performed.

Validation for these two corrections:

- persistent Raspberry systemd monitor: PASS — proved `activating` remained
  live through the real runtime build and captured the later descriptor
  failure;
- occupied-descriptor console protocol regression: PASS;
- full `deploy/linux/test-staging.sh`: PASS in 193.1 seconds;
- full `npm test`: PASS — 599 passed, 11 platform-specific skips, 0 failed;
- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS;
- `npm run verify:linux:executables`: PASS — all 46 tracked deployment files
  retain valid Git modes;
- Bash syntax checks for the affected protocol files: PASS.

No UI structure or styling changed. The next published build must first be
installed with the official remote updater because Build `8dd3ae3` still
contains both defects; the following commit can then exercise the corrected
in-app progress and runtime path.
