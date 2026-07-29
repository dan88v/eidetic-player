# Raspberry Pi remote reinstall

These scripts reproduce the visible, interactive SSH workflow used on
2026-07-27. They never store or pipe a password. Privileged `sudo` prompts
remain attached to the terminal.

## SSH access from the Windows development machine

Routine Raspberry operations use the dedicated Ed25519 key and SSH alias
provisioned on the Windows development machine:

```text
Host eidetic-rpi 10.0.0.112
  HostName 10.0.0.112
  User daniele
  IdentityFile C:/Users/dan88/.ssh/id_ed25519_eidetic_rpi
  IdentitiesOnly yes
  BatchMode yes
  ConnectTimeout 10
```

Use `ssh eidetic-rpi` for direct diagnostics. The remote update, reinstall, and
verification scripts may keep their default `10.0.0.112` address because the
same SSH stanza matches both the alias and address. SSH authentication is
non-interactive; `sudo` authorization remains a separate, visible privilege
boundary when a workflow requires it.

The private key stays exclusively under the Windows user profile and must
never be copied into the repository, logs, prompts, or Raspberry checkout. The
Raspberry stores only its public key in
`/home/daniele/.ssh/authorized_keys`. Verify the configured path before remote
work with:

```powershell
ssh.exe eidetic-rpi "hostname; id -un"
```

The expected output is hostname `eidetic` and user `daniele`. A password prompt
or authentication failure is a blocking configuration error; do not silently
fall back to scripts that capture or pipe credentials.

## Guided update

After the exact `main` CI run is green, run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/remote-rpi-update.ps1
```

The updater:

1. validates the exact checkout path, official origin, `main` branch and clean
   working tree;
2. synchronizes the checkout to `origin/main` using fast-forward only;
3. records the installed and target Build IDs;
4. starts the guided production updater with visible SSH, `sudo` and updater
   prompts;
5. verifies the installed Build ID, user service, readiness API and read-only
   installation doctor;
6. reruns the updater unattended on the same ref to prove
   `Already up to date.`;
7. performs no reboot.

For a settings-persistence release, record the non-sensitive UI preference
vector before update. After update, check `/api/preferences`, file ownership
and modes, restart only `eidetic-player.service`, and repeat the comparison.
Then run the updater again and confirm both `Already up to date.` and an
unchanged preference revision. If bootstrap reports `manual-required`, use the
stdin-only procedure in [`preferences.md`](preferences.md); never inspect
WebKit databases blindly or place the snapshot on a command line.

Host and user can be overridden explicitly:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/remote-rpi-update.ps1 `
  -HostAddress 10.0.0.112 `
  -RemoteUser daniele
```

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
