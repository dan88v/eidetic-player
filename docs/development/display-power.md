# Display dim and standby

Display power policy is split between the UI idle controller and a narrow
backend platform service. It does not belong to playback, audio output, the
updater, or the platform shell.

## Ownership

- `DisplayIdleController` owns local activity, the single monotonic transition
  timer, the software dim overlay, and the wake shield.
- `DisplayPowerService` owns capability state, serialized platform operations,
  startup/shutdown restoration, bounded wake retries, and test fail-safes.
- Platform adapters own hardware brightness and real display-output commands.
- The existing Preferences store owns the three display settings.
- The existing Audio Output state is authoritative for HDMI standby
  inhibition.
- The idle controller observes the existing player state only to suspend its
  own automatic timer while playback is loading or playing. Playback remains
  owned by MPV and PlayerService.

Display state is returned by explicit REST operations and bootstrap. Changes
are also published as a named event on the local UI's existing player SSE so a
Remote wake and backend test fail-safe can reconcile the UI-owned software
overlay. There is no display polling, permanent display request, or additional
Display EventSource.

## Timer and activity contract

The normal runtime uses one timeout for the next absolute deadline, calculated
with `performance.now()`. Dim and standby share the same last-activity epoch;
standby does not start a second countdown after dimming. Releasing an
inhibition establishes a new epoch and therefore a full countdown.

Local `pointerdown`, `keydown`, and `wheel` activity resets the deadline.
Trusted, non-zero mouse movement is coalesced before it resets the deadline.
While dimmed or in standby, mouse movement must contain at least two coalesced
samples totaling eight pixels within 1.2 seconds before it can wake the
display. This rejects the isolated pointer relocation that a Wayland output
topology change can synthesize when the output is disabled. Touch-start and
pointer events are not both registered.

While dimmed or in standby, a viewport-sized wake shield consumes the first
input before restoring the display. That input must never activate Play, Next,
volume, navigation, or text input underneath it. Subsequent input behaves
normally. A capture-phase click fallback covers WebKitGTK touch taps that do
not expose a usable Pointer Event; the compatibility click following a normal
`pointerdown` remains consumed without issuing a duplicate wake.

An authenticated Remote wake is not a local input and therefore is not
consumed by the shield. The backend publishes its newer Display revision; the
idle controller accepts that snapshot, removes the software overlay and wake
shield, establishes a fresh local activity epoch, and resumes the saved idle
policy without issuing a second wake request.

Remote access does not wake the display automatically. Only the authenticated
`Wake display` action calls the display wake adapter; enabling its listener,
pairing a device, or receiving ordinary Remote traffic does not reset local
idle activity.

Automatic dim and standby are suspended while playback is loading or playing.
Starting playback clears the idle timer and restores Active if necessary.
Pause or stop establishes a new activity epoch, so the full configured
countdown starts then rather than expiring immediately. This runtime policy
does not change the saved timeout preferences or pause, stop, or reroute audio.

## Dimming and standby

Hardware backlight dimming is used only when a writable, contained sysfs
backlight device is discovered. The active brightness is retained in memory
and restored exactly on wake. Otherwise the UI uses a constant-opacity black
overlay:

> Software dimming — display power consumption is unchanged.

Software dimming is never advertised as standby. Real standby is exposed only
when a verified backlight-off or single-output Wayland method is available.
The Linux Wayland adapter invokes `/usr/bin/wlr-randr` with a discovered,
validated output name and a fixed argument array; the UI cannot supply a path,
command, or output name.

The Windows adapter deliberately provides software dim plus simulated standby
for development QA. It does not power off the development monitor.

## Safety

Display mutations are local-only and accept bounded JSON bodies. Errors expose
stable codes rather than raw paths, commands, sockets, environment data, or
platform errors.

Standby is inhibited whenever the canonical selected physical audio output is
HDMI. Audio is never paused or rerouted. Updater active phases and Maintenance
transitions restore Active and suspend the idle timer. Ordered shutdown and
the next startup both attempt to restore output-on and the retained active
brightness.

The appliance installer’s `EIDETIC_DISABLE_BLANKING=1` policy remains the
system-level blanking authority. Runtime dim/standby works on top of that
deliberately disabled desktop policy and does not modify `install.conf`.

## Settings

`Settings → System → Display` reuses the canonical navigation rows, selection
rows, status row, action buttons, and confirmation dialog. Defaults are Dim
Off, 20% dim level, and Standby Off. Dim level choices are 5%, 10%, 20%, 30%,
40%, and 50%. If both timeouts are enabled, standby must be later than dim.
Unsupported standby choices and tests stay disabled while software dim remains
available.
