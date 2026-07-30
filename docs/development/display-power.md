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

Display state is returned by explicit REST operations and bootstrap. There is
no display polling, permanent HTTP request, or display EventSource.

## Timer and activity contract

The normal runtime uses one timeout for the next absolute deadline, calculated
with `performance.now()`. Dim and standby share the same last-activity epoch;
standby does not start a second countdown after dimming. Releasing an
inhibition establishes a new epoch and therefore a full countdown.

Local `pointerdown`, `keydown`, and `wheel` activity resets the deadline.
Trusted, non-zero mouse movement is coalesced before it resets the deadline.
Touch-start and pointer events are not both registered.

While dimmed or in standby, a viewport-sized wake shield consumes the first
input before restoring the display. That input must never activate Play, Next,
volume, navigation, or text input underneath it. Subsequent input behaves
normally.

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
Off, 20% dim level, and Standby Off. If both timeouts are enabled, standby must
be later than dim. Unsupported standby choices and tests stay disabled while
software dim remains available.
