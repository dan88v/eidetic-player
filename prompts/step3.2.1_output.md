# Step 3.2.1 output — Consolidated AirPlay, runtime, and Queue corrections

Date: 2026-08-03

## Status

Steps 3.2.1, 3.2.2, 3.2.3, and 3.2.4 are consolidated in this single report.
The source corrections are present in the working tree and remain uncommitted;
no application update, commit, or push was performed. Live diagnosis did apply
the persistent realtime user-manager drop-in, update the Pi from kernel
`6.18.34` to `6.18.39`, restart the AirPlay receiver during controlled tests,
and leave its temporary acceptance buffer at 4.0 seconds. The new Settings
buffer control and touch corrections are not installed on the Raspberry Pi.

`LOCAL CORRECTIONS — NOT DEPLOYED`

`AIRPLAY BUFFER SETTINGS — LOCALLY VALIDATED, RPI UPDATE PENDING`

## Consolidated diagnosis and corrections

### Installation doctor false negative

The post-update doctor used Shairport's `--displayConfig` while the managed
receiver was already active. Shairport continued into startup, collided with
the real receiver on port 7000, and exited 139 even though the activated build
and AirPlay runtime were healthy.

The doctor now validates the generated config as a regular, non-symlink,
runtime-user-owned `0600` file without starting a second receiver. Runtime
health remains covered by the managed receiver, NQPTP, FIFO, control socket,
Avahi, and port checks. The deployment verifier prevents reintroduction of a
Shairport config invocation.

### AirPlay startup, Raspberry load, and waveform responsiveness

The receiver had been persistently enabled in systemd and started before the
backend created its private control socket. Three rapid failures exhausted the
start limit. The persistent `airplay.json` setting is now the only On/Off
authority: backend startup disables legacy boot enablement, clears stale
failure state, renders the route, and starts/restarts the receiver only after
its runtime is ready. Natural end/disconnect no longer restarts the receiver;
true preemption/error recovery retains the bounded restart path. A granted
session that never reaches playing fails closed after 12 seconds and restores
Local ownership.

The large general slowdown was separate: empty `lsblk` calls took about
2.1–2.8 seconds every 2.5 seconds, effectively loading the Pi continuously.
Linux removable storage now owns one `udevadm` block-event monitor and a 200 ms
debounce; only platforms without an event provider retain one fallback poll.

Waveform preload now follows Step 3.1 playback-instance IDs, rechecks the cache
after serialized work, uses the existing alternate loopback origin, and lowers
the FFmpeg analysis stream from 8 kHz to 2 kHz without changing the 512 output
points. This prevents duplicate cold decodes and avoids queuing ordinary API
work behind a waveform response.

### Post-update stability gate

Build `4f58142` had activated successfully, but the remote wrapper sampled
backend `starting` and ran the doctor before enabled AirPlay had left its own
transient startup state. Later read-only checks on the same build showed
backend ready, AirPlay ready, receiver active with zero restarts, and the unit
correctly disabled from boot.

Both remote update and verification scripts now wait up to 180 seconds for
backend and AirPlay to reach closed terminal states before running the doctor.
AirPlay `error` remains terminal so a real failure is reported rather than
hidden by a timeout.

### Queue History truth and Previous latency

The Pi's bounded History still contained `Voices → Wake Up → X-Ray Mind → 03
River Of Deceit`; the planner had not removed or reordered the two apparently
skipped Tracks. One Previous selects one available History entry. The observed
multi-entry result is consistent with repeated input while the former slow
command appeared unanswered, not a planner jump.

Previous had unnecessarily rebuilt the full technical MPV playlist when the
History target was no longer present. It now inserts that one occurrence at
index 0 and selects it directly, preserving execution identity and leaving the
normal reconciler authoritative. Forward History now takes presentation
priority over Context, so `Then continues from` is hidden until forward History
is exhausted and can no longer promise a later Context Track before the Tracks
that Next will actually visit.

The final real-MPV gate exposed one related stopped-state edge case: when the
currently playing removable, removable-Library, or SMB item became unavailable,
MPV's `stop keep-playlist` event briefly reset the technical playlist index to
`-1` even though the planner correctly retained Current. Availability
reconciliation now restores the preserved occurrence index after stopping, so
Queue state, Current, and the playback plan stay aligned without autoplay or
advancement.

### Live AirPlay follow-up

The physical test confirmed the core arbitration path: AirPlay preempted MPV,
published title and album, produced audio, and returned to the preserved MPV
session after disconnect. The remaining issues had three distinct causes and
contracts.

- **Intermittent silence:** during the real session the receiver remained
  active, but its journal recorded nine XRUN/recovery pairs: `DAC ... XRUN`
  followed by `recovering from a previous underrun`. Shairport was using SOXR
  with the default 0.2-second
  backend buffer on a Pi at about 75.2 °C; `get_throttled=0x60000` also recorded
  historical throttling/frequency capping. The generated Pi configuration now
  uses the lighter `vernier` interpolator and a 0.5-second backend buffer. This
  targets the measured ALSA underrun rather than changing source ownership.
- **Progress:** AirPlay never uses a waveform. Progress is now advertised only
  after a valid sender `prgr` anchor. When available, local and Remote Now
  Playing show a non-seekable **Line** timeline advanced by one session-scoped
  250 ms timer while playing; buffering/flush freezes it and metadata change,
  end, release, and shutdown remove it. If the sender supplies no usable
  progress, the AirPlay-only timeline is hidden instead of displaying a dead
  rail.
- **Artwork:** cover-art metadata remains enabled. JPEG validation now accepts
  a valid JPEG signature even when a sender appends legal/trailing bytes, while
  the existing size, opaque-ID, generation, and MIME protections remain. If the
  sender does not emit a valid `PICT` item, the truthful placeholder remains;
  the player does not borrow Local artwork.
- **Fixed-output volume:** the DAC remains at fixed unity. Shairport now accepts
  sender attenuation and caps its maximum at 0 dB, so iPhone 0–100% controls
  AirPlay loudness and 100% equals the player's fixed level with no boost. This
  AirPlay-only level never changes the suspended MPV volume or persisted Local
  preference, which is restored unchanged after disconnect.

No dependency, polling loop, observer, EventSource, MPV instance, FFmpeg
process, queue reconstruction, or persistent AirPlay media state was added.

### Settings navigation and receiver identity follow-up

Remote access now lives under Settings > Network, after AirPlay, and its Back
action returns to Network. It no longer occupies a separate Settings-root row.

The AirPlay page now presents Receiver Name as a canonical navigation row: the
current value is right-aligned before the chevron and opens a dedicated editor
page. That page uses the established Settings header, panel, validated
1-to-40-character text field, on-screen keyboard integration, and primary Save
action. Saving still uses the existing revisioned AirPlay API and is disabled
while an AirPlay session owns playback.

Audio Buffer follows the same navigation and single-choice pattern. Its row
shows the current value and opens a dedicated 1, 2, or 4 second page. New and
migrated installations default to 2 seconds; the choice is stored atomically,
validated at the API and store boundaries, and rendered into the Shairport
configuration. The first implementation incorrectly disabled the row during an
active stream and exposed its explanation through a native desktop tooltip.
The active-session row and choices now remain available and use the existing dark
confirmation surface, never a native `title` tooltip. Confirming persists the
choice without touching the current stream and labels it `Next session`; the
provider's release event rewrites the config and restarts the now-idle receiver
before the following connection. Receiver-name editing remains protected. The
Linux installer seeds schema 2 with the same default; the read-only doctor
accepts both legacy schema 1 and schema 2 while validating that the effective
choice is exactly 1, 2, or 4 seconds.

New installations generate `Eidetic Player - 1A2B`-style identities with four
cryptographically random uppercase hexadecimal characters. Existing generated
two-character identities migrate once to the new form. A user-defined receiver
name is preserved during the suffix migration. The Linux installer and its
deployment contract use the same four-hex rule.

### Post-update AirPlay Starting recovery

The remote update SSH session reset during Neutralino synchronization, but
read-only inspection proved that build `8913746` had continued to activation:
`current` pointed at the exact target, backend readiness was `ready`, MPV was
playing, and the user service was active with zero restarts. The transport
disconnect therefore did not roll back or partially activate the release.

AirPlay exposed a separate reproducible inconsistency. Its persistent state was
On while the receiver unit was inactive and the API remained `off`, which the
UI presented as Starting. A same-state On request returned HTTP 500 before any
receiver start appeared in systemd. Directly starting the managed unit worked
immediately, opened port 7000, and produced a clean Shairport log. The failing
preparatory command was `systemctl --user reset-failed`: systemd returns
non-zero when this inactive unit is not loaded, even though there is no failure
to clear. The backend treated that harmless result as fatal and never reached
the mandatory `start` command.

Failure reset is now best-effort while `start`, `restart`, disable, and stop
remain mandatory. The Settings PATCH publishes Starting only during the
operation and catches every route/service/advertisement failure, terminating in
an explicit sanitized Error instead of leaving `enabled=true` paired with Off
or Starting. A controlled live start followed by the normal revisioned API
verification restored the installed Pi to `serviceStatus=ready`, receiver
`active/running`, zero restarts, and a successful advertisement response.

### Live AirPlay XRUN diagnosis

Monitoring a real active AirPlay session separated the audible drops from
source arbitration and discovery. AirPlay remained the active source, MPV
remained suspended, Shairport stayed active with zero restarts, and artwork and
metadata remained coherent. Every reported drop aligned with an ALSA `DAC in
unexpected state XRUN prior to writing` entry followed immediately by
`recovering from a previous underrun`; nine pairs occurred between 12:55:11 and
12:59:04. Turning on the case fan lowered the Pi from 77.4 C to 65.5 C, but new
XRUNs still occurred, proving that temperature was an aggravating factor rather
than the sole cause. They continued every 18-to-60 seconds after the fan had
reduced the Pi to 52.1 C, while the session remained active and the receiver
still reported zero restarts.

The receiver startup log exposed a deeper scheduling contract failure: `Can not
set realtime properties of thread "alsa_buf_mon"`. The receiver unit already
requested Shairport's upstream `LimitRTPRIO=5`, but both the running receiver
and its containing `user@1000.service` had an effective `/proc` hard limit of
zero. A user service cannot raise its child limit above that parent ceiling, so
the receiver-unit setting alone could never become effective.

Installation now adds a runtime-UID-specific `user@UID.service` drop-in with
the same narrow limit. The updater applies it immediately to an already-running
user manager with `prlimit`; the drop-in makes it persistent across the next
manager start. The receiver remains non-root and receives no capability. The
read-only installation doctor checks the effective manager limit and, while
the receiver is active, its actual process limit instead of accepting only the
unit text.

The same physical session also exposed an independent and more fundamental
network fault. With AirPlay traffic active, 7 of 20 ICMP packets were lost and
the kernel repeatedly logged `Controller never released inhibit bit(s)`,
`CMD53 ... failed -5`, `brcmf_sdio_rxglom ... failed -5`, and receive recovery
failures from the onboard `brcmfmac` SDIO adapter. After AirPlay was disabled,
two control runs had zero packet loss; the latest 20-packet run stayed between
4 and 21 ms with zero new SDIO errors, zero XRUNs, and a 46 C CPU. This proves
that source arbitration and receiver restarts are not the cause of every
audible interruption: sustained AirPlay traffic is exposing a Raspberry
Wi-Fi/kernel/hardware path failure. Realtime scheduling still needs correction
for the measured ALSA underruns, but it cannot recover packets that never reach
Shairport.

The controlled live retest made that separation conclusive. Raising the
running user manager to `5/5` gave the new receiver process the same effective
limit and moved `alsa_buf_mon` from normal timesharing to `FIFO/4`. Across both
loaded samples it produced zero realtime warnings, zero ALSA XRUNs, and zero
service restarts. The first 33-second AirPlay sample nevertheless lost 2 of 25
packets and produced nine new SDIO errors. Disabling NetworkManager Wi-Fi power
saving and reconnecting did not fix it: the next 31-second sample lost 1 of 25
packets and produced 20 new SDIO errors; the following SSH attempt timed out and
a ten-packet recovery sample lost two packets with latency up to 91 ms. The
profile was restored to `default` rather than persisting a disproven workaround.

A temporary receiver-only fixture then increased the buffer from 0.5 to 2.0
seconds. Its first three samples delivered 85 of 85 ping replies with no
audible drop, XRUN, or service restart, but later listening reproduced the
silence. The buffer therefore mitigated burst loss without resolving the SDIO
fault; the earlier clean interval is not treated as a permanent fix.

The Pi was then moved from Raspberry kernel `6.18.34+rpt-rpi-v8` to the current
archive kernel `6.18.39+rpt-rpi-v8`, with the old kernel and initramfs retained
for rollback. A 0.5-second run on the new kernel still dropped and was not a
valid comparison with the prior 2-second run. Repeating at 2 seconds produced
60 of 60 ping replies, only two initial SDIO errors followed by a clean window,
zero XRUNs, and zero receiver restarts; the user reported it was substantially
better. A subsequent 4-second run produced 25 of 25 replies with zero new SDIO
errors, XRUNs, or restarts, and its longer play/pause delay was considered
acceptable. These are bounded acceptance windows, not proof that the onboard
Wi-Fi kernel fault is gone.

The product now exposes that measured tradeoff instead of baking one test
value into every installation: 2 seconds is the balanced default, with 1 and
4 seconds available from the canonical Settings choice page. The underlying
SDIO fault remains separately documented and must not be misreported as an
arbitration or ALSA scheduling regression.

### Deterministic Neutralino synchronization for Linux CI

The Linux release workflow failed after the UI and backend builds because
`neu update` began ZIP extraction from its response-end callback without first
waiting for the destination file to finish writing. It also did not reject a
non-success HTTP response or verify the declared/downloaded length before
opening the archive. All three orchestrator retries therefore remained exposed
to the same truncated-file race and `yauzl` reported a missing end-of-central-
directory signature.

The release build now uses a repository-owned synchronizer pinned to the exact
`binaryVersion` and `clientVersion` in `neutralino.config.json`. It receives the
complete response before writing, verifies HTTP success, Content-Length when
present, a 64 MiB bound, the ZIP local header, and a complete terminal ZIP
directory record. Extraction starts only after the exclusive archive write has
completed, uses a fresh OS temporary directory for every orchestrator attempt,
and always removes it. Only the seven expected non-empty regular Neutralino
binaries are copied to `bin`; non-Windows executable modes are restored to
`0755`. The configured Neutralino client must also match the installed pinned
package before synchronization can proceed.

Regression coverage feeds a deliberately truncated first response into the
synchronizer, proves it is rejected before extraction, and then proves a clean
second attempt succeeds without reusing corrupt state. A real download of the
pinned 6.8.0 release and a real `neu build --release` both complete locally.

### Raspberry touch, pointer, and single-tap recovery

Read-only inspection of the affected Raspberry excluded the prior display-wake
and update-overlay failures: Display was `active`, the update job was terminal
`succeeded`, backend readiness was `ready`, and MPV was available. The physical
controller instead identifies as `TSTP MTouch` but udev/libinput exposes it as
an absolute mouse (`ID_INPUT_MOUSE=1`, pointer capability) beside the real
Logitech K400 mouse. A long press can therefore open WebKit's native context
menu, every absolute relocation was treated as mouse activity, and the shared
scroll fallback's former 8 px threshold could classify normal controller noise
as a drag and suppress the click belonging to a short tap.

The appliance pointer now starts hidden and uses bounded modality evidence.
Touch, pen, touch-derived compatibility input, and an unconfirmed absolute
relocation keep it hidden. The first implementation reset its own touch guard
when hiding the cursor, allowing a burst of synthesized mouse events to reveal
it again. Touch or context-menu input now starts a persistent 2.5-second
quarantine. Only three hover-only mouse samples with at least 12 px cumulative
distance can confirm deliberate mouse use; button-held motion cannot establish
mouse identity. A real mouse remains native with ordinary click and keyboard
semantics, while a touch-emulated drag stays hidden. The app surface still
suppresses the browser context menu so a long touch cannot leave native chrome
intercepting the following input.

The local direct-manipulation fallback now requires 16 px before a tap becomes
a drag. Sub-threshold motion leaves the native semantic click untouched; only
a real drag suppresses its generated click. Focused regression coverage proves
one absolute relocation does not reveal the pointer, confirmed mouse movement
does, touch and compatibility input hide it, the context-menu listener is
removed on teardown, and 7/7 or 12/8 px tap jitter remains below the drag
threshold while a 16 px gesture begins scrolling.

## Regression coverage

Focused coverage proves:

- read-only doctor behavior and the AirPlay deployment contract;
- backend-owned receiver startup, stale-failure recovery, natural release, and
  bounded buffering failure;
- event-driven removable storage and waveform identity/cache/origin behavior;
- paired backend/AirPlay remote stability gates;
- one-entry targeted History Previous and truthful Context continuation;
- low-power AirPlay config (`vernier`, persisted and validated 1/2/4-second
  buffer with a 2-second default, no sender-volume ignore, 0 dB maximum);
- fragmented metadata, conditional/moving/frozen progress, sender attenuation
  on a fixed route without Local preference mutation, and JPEG data with
  trailing bytes;
- conditional AirPlay Line timeline on hardware, mini-player, and Remote UI
  without another SSE.
- Settings-root/Network placement, Remote access Back navigation, dedicated
  receiver-name and audio-buffer pages, revisioned Save/PATCH paths, schema-1
  2-second migration, deferred active-session buffer apply, and four-hex
  identity migration
  without replacing a custom receiver name.
- inactive/unloaded systemd reset handling and terminal Error publication when
  receiver activation fails, preventing persistent enabled/Starting state.
- the upstream Shairport `LimitRTPRIO=5` receiver contract, its matching
  runtime-user manager ceiling, live-update `prlimit`, and effective doctor
  checks tied to the measured ALSA XRUN and failed realtime-thread warning.
- deterministic Neutralino archive URL/version coherence, structural and
  length validation, clean retry isolation, and expected binary staging.
- touch/mouse modality separation, initial pointer hiding, context-menu
  suppression, teardown, and tap-versus-drag slop on noisy absolute input.

Final validation after all deliverables:

- focused AirPlay/arbitration tests — PASS, 27 tests, 0 failed;
- focused active-buffer, Network Settings, and pointer-modality tests — PASS,
  33 tests, 0 failed;
- focused build protocol and Neutralino synchronization tests — PASS, 8 tests,
  0 failed;
- real pinned Neutralino 6.8.0 download and `neu build --release` — PASS;
- `npm.cmd run format:check` — PASS;
- `npm.cmd run typecheck` — PASS;
- `npm.cmd run lint` — PASS;
- `npm.cmd run build` — PASS for local UI, Remote UI, and backend;
- `npm.cmd test` — PASS, 845 tests: 832 passed, 13 platform skips,
  0 failed;
- `npm.cmd run mpv:doctor` — PASS with MPV v0.41.0 and JSON IPC;
- `npm.cmd run test:mpv` — PASS, 14 tests, including one persistent MPV,
  output release/restore, rapid transport, and 24 automatic Context
  transitions;
- `npm.cmd run ffmpeg:doctor` — PASS;
- `npm.cmd run test:ffmpeg` — PASS, 3 tests, including real waveform and
  one-process realtime analysis;
- `npm.cmd run verify:airplay:deployment` — PASS;
- `npm.cmd run verify:linux:executables` — PASS, 56 tracked deployment files;
- `npm.cmd run verify:linux:installer` — PASS, including 76 install-safe tests
  (65 passed, 11 platform skips), Network deployment, and AirPlay deployment;
- final `git diff --check` — PASS.

## Real-system and visual scope

The diagnosis used the real Raspberry build and its managed journals, a
revisioned AirPlay disable/enable cycle, a transient `prlimit`, and one
controlled NetworkManager reconnect. The Wi-Fi profile was restored to its
original `default` power-saving setting after the workaround failed. AirPlay is
enabled and physically Playing; Local remains preserved in its prior paused
state. The Pi runs kernel `6.18.39+rpt-rpi-v8`; `6.18.34` remains installed for
rollback. The active receiver has the temporary 4.0-second acceptance value,
effective `5/5` realtime limit, `FIFO/4` ALSA monitor, and zero XRUNs or service
restarts in the latest measured window. The realtime user-manager drop-in is
already persistent on the Pi, while the Settings-buffer and touch changes have
not been installed. The onboard Wi-Fi SDIO fault remains an explicit residual
risk despite the improved bounded samples.

The UI change is deliberately conditional and geometry-preserving: it switches
only AirPlay from the configured waveform style to Line, or hides the timeline
when progress is unavailable. The exact `npm.cmd run dev` command started the
real Neutralino/WebView2 application. A direct capture of its 1296 × 839 window
(1280 × 800 content target plus native frame) was inspected first in the empty
Local state and then with the AirPlay fixture at 1:23/4:00. Artwork reservation,
title/artist/album, Line timeline, bottom controls, spacing, and viewport fit
were stable with no flash, scroll, or layout shift. The fixture always exposes
progress; the progress-unavailable hidden state is therefore covered by the
focused source/UI regression rather than claimed as physically visualized.

The same real 1280 x 800 content surface was inspected for the Settings
follow-up. Settings root contains Interface, Audio, Playback, Network, and
System without a separate Remote access row. Network fits Wired, Wi-Fi,
AirPlay, and Remote access without scrolling; AirPlay shows the four-hex name
at the right before its chevron and the 2-second buffer on its own canonical
row. The dedicated Receiver Name page keeps its field and Save action fully
visible. The Audio Buffer page fits all three full-width touch choices, their
descriptions, and the selected checkmark without scrolling. Its navigation row
remains enabled and exposes no native HelpText or `title` tooltip. The active
session path is covered by the real provider/service fixture: confirmation
leaves the current stream unchanged, persists the requested value, publishes
`Next session`, and applies it after the provider release event. A real fixture
change from 2 to 4 and back to 2 passed through the WebView2 UI, revisioned API,
atomic store, receiver restart, and generated config; the config was observed
at `4.0` and restored to `2.0`. Remote access opens from Network and Back
returns there. The subsequent Raspberry test verified physical advertisement,
sender connection, artwork, metadata, audio, and Local preservation.

All development runs closed through the real window. Final teardown found
zero listeners on ports 4310/5173, zero Neutralino, MPV, or FFmpeg processes,
and no generated QA file in the worktree.

No commit or push was performed.
