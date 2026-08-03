# Step 3.2.1 output — Consolidated AirPlay, runtime, and Queue corrections

Date: 2026-08-03

## Status

Steps 3.2.1, 3.2.2, 3.2.3, and 3.2.4 are consolidated in this single report.
The corrections are present in the working tree, uncommitted, and not installed
on the Raspberry Pi. No commit, push, update, service restart, or reboot was
performed.

`LOCAL CORRECTIONS — NOT DEPLOYED`

`AIRPLAY AUDIO CHANGES — REQUIRE PHYSICAL RETEST`

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

The receiver startup log exposed the missing scheduling contract: `Can not set
realtime properties of thread "alsa_buf_mon"`, while systemd reported
`LimitRTPRIO=0`. The official Shairport Sync 5.2.1 unit specifies
`LimitRTPRIO=5`; Eidetic's NQPTP unit already had its own realtime allowance,
but the Shairport user unit had omitted it. The receiver template now restores
the exact upstream limit, and deployment verification makes that requirement
non-regressible. The live receiver was not restarted during the active session,
so the scheduling correction still requires an installed-build Raspberry
acceptance test.

## Regression coverage

Focused coverage proves:

- read-only doctor behavior and the AirPlay deployment contract;
- backend-owned receiver startup, stale-failure recovery, natural release, and
  bounded buffering failure;
- event-driven removable storage and waveform identity/cache/origin behavior;
- paired backend/AirPlay remote stability gates;
- one-entry targeted History Previous and truthful Context continuation;
- low-power AirPlay config (`vernier`, 0.5-second buffer, no sender-volume
  ignore, 0 dB maximum);
- fragmented metadata, conditional/moving/frozen progress, sender attenuation
  on a fixed route without Local preference mutation, and JPEG data with
  trailing bytes;
- conditional AirPlay Line timeline on hardware, mini-player, and Remote UI
  without another SSE.
- Settings-root/Network placement, Remote access Back navigation, the dedicated
  receiver-name editor, revisioned Save path, and four-hex default/migration
  behavior without replacing a custom receiver name.
- inactive/unloaded systemd reset handling and terminal Error publication when
  receiver activation fails, preventing persistent enabled/Starting state.
- the upstream Shairport `LimitRTPRIO=5` receiver-unit contract, tied to the
  measured ALSA XRUN and failed realtime-thread warning on the Pi.

Final validation after all deliverables:

- focused AirPlay/arbitration/UI/Settings tests — PASS, 35 tests, 0 failed;
- `npm.cmd run format:check` — PASS;
- `npm.cmd run typecheck` — PASS;
- `npm.cmd run lint` — PASS;
- `npm.cmd run build` — PASS for local UI, Remote UI, and backend;
- `npm.cmd test` — PASS, 838 tests: 825 passed, 13 platform skips,
  0 failed;
- `npm.cmd run mpv:doctor` — PASS with MPV v0.41.0 and JSON IPC;
- `npm.cmd run test:mpv` — PASS, 14 tests, including one persistent MPV,
  output release/restore, rapid transport, and 24 automatic Context
  transitions;
- `npm.cmd run ffmpeg:doctor` — PASS;
- `npm.cmd run test:ffmpeg` — PASS, 3 tests, including real waveform and
  one-process realtime analysis;
- `npm.cmd run verify:airplay:deployment` — PASS;
- `npm.cmd run verify:linux:executables` — PASS, 55 tracked deployment files;
- `npm.cmd run verify:linux:installer` — PASS, including 74 install-safe tests
  (63 passed, 11 platform skips), Network deployment, and AirPlay deployment;
- final `git diff --check` — PASS.

## Real-system and visual scope

The diagnosis used read-only inspection of the real Raspberry build and its
managed journals. The new config/provider/UI behavior has not been installed,
so the Pi must be retested for uninterrupted audio, phone attenuation,
sender-dependent artwork/progress, and exact Local restoration.

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
at the right before its chevron; the dedicated Receiver Name page keeps its
field and Save action fully visible. Remote access opens from Network and Back
returns there. The isolated Windows fixture has no selected physical audio
output, so applying a name while its receiver preference was On correctly
surfaced the existing route warning after the revisioned API persisted the
edit; physical advertisement remains part of the Raspberry retest.

All development runs closed through the real window. Final teardown found
zero listeners on ports 4310/5173, zero Neutralino, MPV, or FFmpeg processes,
and no retained QA image.

No commit or push was performed.
