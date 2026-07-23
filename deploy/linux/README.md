# Linux service prototype

These files are an uninstalled deployment prototype, not a production
installer. The service runs only the Node backend as an unprivileged user.
Neutralino belongs to the user's graphical session and must not run as a system
service.

Replace the example user and `/opt/eidetic-player` paths for the target
installation. `ExecStart` invokes `/usr/bin/env` directly with an explicit
service `PATH`, without a shell; pin an absolute Node path in the installed
unit when its deployment location is known. Give
the service account read-only access to approved media plus write access to its
XDG directories. Do not place secrets in the repository.

Validate without installing:

```bash
cp deploy/linux/eidetic-player-backend.service.example /tmp/eidetic-player-backend.service
systemd-analyze verify /tmp/eidetic-player-backend.service
rm /tmp/eidetic-player-backend.service
```

For a future kiosk, prefer a graphical user-session unit that starts
Neutralino after the compositor is ready. The backend unit here is useful for
separation and diagnostics, but the final Raspberry Pi startup policy remains
outside Step 2.4.5.

NetworkManager integration is documented separately in
[`network/README.md`](network/README.md). It is optional, reversible, and does
not duplicate this full service: it installs a focused systemd drop-in and
minimal polkit authorization while leaving the backend non-root. Raspberry Pi
network hardware validation remains Step 2.12.3.
