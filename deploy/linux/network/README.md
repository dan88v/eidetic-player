# Linux NetworkManager integration

This optional deployment layer lets the existing non-root
`eidetic-player-backend.service` use the NetworkManager features already
implemented by Eidetic Player. It does not install packages, configure a
network, create a connection profile, start/restart the backend, or run the
application as root.

## Prerequisites

The target needs system D-Bus, NetworkManager with `nmcli`, and polkit. On
Debian/Raspberry Pi OS these capabilities are normally supplied by the
distribution packages that own `/usr/bin/nmcli`,
`org.freedesktop.NetworkManager.service`, and `polkitd`; verify package names on
the target release before installation. The network doctor reports missing
components without installing anything.

Choose an existing runtime user, a dedicated group, and the installed
application directory. Do not hardcode Raspberry Pi account names:

```bash
sudo deploy/linux/network/install-network-integration.sh \
  --user eidetic-runtime \
  --group eidetic-player-network \
  --install-dir /opt/eidetic-player
```

The script itself never invokes `sudo`. A real installation must be launched
explicitly as root. After group membership changes, log out/in or restart the
runtime session. The backend remains unprivileged and receives neither
`CAP_NET_ADMIN` nor sudoers access.

Safe inspection and staging need no root:

```bash
deploy/linux/network/install-network-integration.sh \
  --user fixture-user --group fixture-network \
  --install-dir "/opt/Eidetic Player" --dry-run

deploy/linux/network/install-network-integration.sh \
  --user fixture-user --group fixture-network \
  --install-dir "/opt/Eidetic Player" --root /tmp/eidetic-staging
```

Uninstall is idempotent and removes only the Eidetic policy, drop-in, and
non-secret environment metadata:

```bash
sudo deploy/linux/network/uninstall-network-integration.sh
```

It never removes the user/group, NetworkManager profiles, passwords,
application databases, XDG state, or a pending IPv4 rollback transaction.

## Exact authorization surface

The generated rule authorizes only a subject that simultaneously:

- belongs to the configured dedicated group;
- runs as `eidetic-player-backend.service`;
- has systemd `NoNewPrivileges=true`.

Only these NetworkManager action IDs are authorized:

- `org.freedesktop.NetworkManager.network-control`: scan, activate,
  disconnect, and reactivate managed connections;
- `org.freedesktop.NetworkManager.enable-disable-wifi`: software Wi-Fi radio;
- `org.freedesktop.NetworkManager.settings.modify.system`: create, modify,
  clone, rename, or delete the Eidetic-managed Wi-Fi/Wired profiles used by
  connect and IPv4 rollback.

There is no wildcard. Nonmatching subjects/actions fall through to normal
system policy. Application-side checks still restrict Wi-Fi IPv4 changes to
`Eidetic Player Wi-Fi` and preserve external Wired profiles through a dedicated
Eidetic clone.

The action list is based on NetworkManager's installed policy and official
`nmcli general permissions` documentation. Confirm the action IDs on the
target with `pkaction` and `nmcli general permissions`.

## Boot and recovery

The drop-in adds `After=dbus.service NetworkManager.service` and
`Wants=NetworkManager.service`. It deliberately avoids
`network-online.target`: the player must boot without Internet, Wi-Fi, or
Ethernet. Existing service hardening remains unchanged.

The backend, not a root boot script, owns the pending IPv4 transaction. It
reads the mode-0600 file from the runtime user's XDG config directory before
new mutations. If NetworkManager or the adapter is not ready, recovery stays
visible as `recovery-required`; the existing monitor can rediscover services
and adapters, and local Retry uses the same bounded rollback. Never delete the
pending file to hide a failed rollback.

## Regulatory domain and hardware status

The doctor reports `iw reg get` when available but never changes it. No country
code is stored here. Configure and validate the correct regulatory domain on
the final device during Step 2.12.3.

WSL/static staging cannot certify Wi-Fi, polkit authorization, boot ordering,
DHCP/manual IPv4, or Raspberry Pi hardware. It must not install or enable
NetworkManager merely for simulation.
