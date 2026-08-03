# Network status and Wi-Fi management

`NetworkService` is the only backend owner of network state and mutations. It
publishes one deduplicated `NetworkSnapshot`, serializes operations, runs one
bounded monitor, and closes its timer and platform adapter during backend
shutdown. AppShell owns the sole Network `EventSource`; Settings and the
passive top-bar indicators consume that shared snapshot without frontend
polling.

Public contracts expose opaque adapter and session-network IDs, safe display
names, link state, connectivity, Wi-Fi radio/scan state, current IP information,
validated IPv4 drafts, and a public safe-transaction summary. They never expose
passwords, profile XML, BSSID or MAC addresses, Windows interface GUIDs,
NetworkManager UUIDs, helper commands, native paths, or native errors.

## IPv4 configuration and recovery

Each Wired or Wi-Fi adapter has a session-only DHCP/Manual draft. Manual values
use dotted-decimal masks and the shared validator rejects malformed, reserved,
network, broadcast, multicast, off-subnet, and inconsistent DNS values.
Gateway and both DNS values are optional; DNS 2 requires DNS 1. The backend
repeats validation and remains authoritative.

Apply captures the real adapter state and atomically writes a versioned,
mode-0600 pending transaction before mutation. The adapter then applies and
rereads IPv4 before the service publishes a 30-second confirmation. Keep
removes the pending snapshot. Revert and timeout share one verified rollback
path and remove it only after success. Startup treats every remaining
transaction as untrusted and rolls it back before accepting another mutation.
Invalid, future, or unrecoverable pending data stays on disk and produces
`recovery-required`.

Only one transaction and one countdown timer may exist. Wi-Fi mutations are
rejected while it is active; the existing monitor and SSE remain the sole
Network update channel. Internet is not required for a successful apply:
adapter values are authoritative, while LAN and Internet remain informational.

## Platform adapters

Windows uses a bounded, hidden, non-interactive PowerShell host around
`wlanapi.dll` Native Wi-Fi calls. Its request is supplied through stdin, so a
password never enters argv or the process list. Native Wi-Fi owns interface
enumeration, radio state, scan, profile creation, connect, disconnect, and
deletion. The compiled helper assembly is versioned and cached in the system
temporary directory; it contains no request or credential data and avoids
recompilation on monitor refresh. Connection first uses a temporary Eidetic profile; the existing
`Eidetic Player Wi-Fi` profile is replaced only after the new network is
accepted, and the temporary profile is removed on success or failure. Location
access denial becomes the public `permission-required` state.
IPv4 mutation delegates protected cmdlets to a short-lived elevated helper.
Eidetic itself does not run permanently elevated, and temporary structured
request/result/script files are removed after the bounded operation.

Linux uses `nmcli` with separate arguments, `LC_ALL=C`, explicit terse/escaped
fields, bounded timeouts, no shell, sudo, or interactive prompt. Secrets use
`--passwd-file /dev/stdin`. A temporary connection is activated before the
single Eidetic profile is replaced. Missing NetworkManager degrades to
`unsupported`; the adapter never edits system network files. Device state and
addresses come from `device show`, while the IPv4 method is read from the
active connection profile because `IP4.METHOD` is not a portable
`device show` field.

Eidetic only creates, replaces, disconnects, or deletes the profile named
`Eidetic Player Wi-Fi`. Profiles created by the operating system or other
applications are preserved.

For IPv4, system-managed Wi-Fi profiles stay read-only. Wired configuration
clones the active profile into a dedicated Eidetic profile so rollback can
reactivate the original without altering or deleting it. No system file, sudo,
UUID, or unrelated profile is modified. Product polkit/deployment policy
is provided by the optional Linux deployment layer.

## Linux deployment and authorization

The optional `deploy/linux/network/` integration keeps the backend non-root
and grants no Linux capability or sudoers access. Its generated polkit rule
matches the dedicated configured group, the exact
`eidetic-player-backend.service` system unit, and systemd
`NoNewPrivileges=true`. It authorizes only:

- `org.freedesktop.NetworkManager.network-control` for activation, scan,
  disconnect, and reactivation;
- `org.freedesktop.NetworkManager.enable-disable-wifi` for the software radio;
- `org.freedesktop.NetworkManager.settings.modify.system` for Eidetic-managed
  connection creation/change/removal and IPv4 rollback.

There is no NetworkManager wildcard. Nonmatching actions and subjects fall
through to the distribution policy, while the backend continues to enforce
opaque adapter IDs and its managed-profile boundary.

The mode-0600 pending transaction remains in the runtime user's XDG config
directory and is processed before new mutations. A successful automatic
rollback removes it. Failed rollback, missing NetworkManager at boot, or an
adapter not yet present keeps `recovery-required` visible: the bounded existing
monitor can rediscover the service/adapter, and local Retry repeats the same
rollback path. Open system settings remains the manual recovery route. No root
boot helper mutates the network.

## UI contract

Settings root has separate Interface and Network rows. Network is a canonical
navigation list containing Wired, Wi-Fi, AirPlay, and Remote access in that
order. Wired and Wi-Fi open their existing detail surfaces; AirPlay opens the
managed receiver settings, and Remote access opens its existing listener and
pairing page. Root, Interface, and Network share the same content width and
vertical rhythm. Current
network/adapter details retain
the actual DHCP values, so the IPv4 section shows only its DHCP/Manual selector
until Manual is selected. Manual reveals five fields using the existing IPv4
keyboard profile; Apply stays hidden until the draft changes. Apply shows a
summary and opens a non-dismissible Keep/Revert countdown. Dirty drafts use the
shared discard dialog when changing adapter/view, going Back, or leaving
Network. Wi-Fi adds
software radio control, current connection ownership, bounded explicit scan,
supported Open/WPA2 Personal/WPA3 Personal connection, hidden SSID, disconnect,
and conditional Forget.

Password fields explicitly opt into the reusable `password` keyboard profile.
The field remains authoritative, keeps password masking unless the form's
Show/Hide control is used, is cleared immediately when submitted, and is never
persisted. Enterprise/EAP, WEP, captive-portal login, IPv6 editing, VPN, proxy,
hotspot, SMB, and Raspberry Pi deployment policy remain out of scope.

On Windows, `EIDETIC_NETWORK_FIXTURE=1` supplies deterministic Wired and Wi-Fi
adapters plus Open, WPA2 Personal, WPA3 Personal, and unsupported networks.
The fixture supports scan, radio, connect, hidden-network, disconnect, Forget,
and IPv4 safe-transaction UI validation without touching the host network or
retaining submitted passwords. Its documentation-only addresses use reserved
example ranges.

On supported Linux appliances, AirPlay displays only its On/Off preference,
receiver name, public status, selected canonical output, and the local-network
access notice. Receiver Name is a navigation row with the current value at the
right; its dedicated page owns the validated text field and Save action.
Technical component versions, ports, paths, and raw receiver configuration
remain confined to protected logs and the read-only doctor.
