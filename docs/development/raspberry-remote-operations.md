# Raspberry Pi remote reinstall

These scripts reproduce the visible, interactive SSH workflow used on
2026-07-27. They never store or pipe a password. SSH and `sudo` prompts remain
attached to the terminal.

## Reinstall

From a visible PowerShell terminal at the repository root:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/remote-rpi-reinstall.ps1
```

Defaults:

- host: `10.0.0.112`;
- user: `daniele`;
- checkout: `/home/daniele/eidetic-player`;
- repository: `https://github.com/dan88v/eidetic-player.git`;
- branch: `main`.

The script:

1. stops the Eidetic Player user service;
2. runs the current guided uninstaller;
3. verifies that `/opt/eidetic-player` was removed;
4. validates the exact checkout path and refuses symbolic links;
5. removes only `/home/daniele/eidetic-player`;
6. clones `main`;
7. starts the guided installer.

The uninstaller and installer choices remain manual. An SSH exit code of `255`
is expected when the final installer prompt reboots the Raspberry Pi because
the remote host closes the connection.

Host and user can be overridden explicitly:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/remote-rpi-reinstall.ps1 `
  -HostAddress 10.0.0.112 `
  -RemoteUser daniele
```

## Post-reboot verification

After the device answers on the network:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/remote-rpi-verify.ps1
```

The verifier shows:

- cloned commit;
- complete user-service status;
- every backend readiness response for up to 120 seconds;
- Eidetic Player and MPV processes;
- the read-only installation doctor.

The readiness wait is intentional. The first 2026-07-27 check ran only 36
seconds after boot and observed a transient degraded player state. The backend
PID subsequently changed, all installed paths and doctor checks passed, and a
physical playback test confirmed MPV and the preserved PCM5102A DAC worked.

## Validated 2026-07-27 result

- guided uninstall: PASS;
- old checkout removal: PASS;
- clone of `main` commit `4054bf5`: PASS;
- guided Appliance installation: PASS;
- application data: preserved;
- pre-existing GPIO/I2S DAC configuration: preserved;
- reboot: PASS;
- service after reboot: active;
- installation doctor: PASS;
- ALSA: three cards, HDMI and GPIO/I2S DAC detected;
- physical MPV playback through the audio device: PASS.
