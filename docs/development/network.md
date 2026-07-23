# Network status and Wi-Fi management

`NetworkService` is the only backend owner of network state and mutations. It
publishes one deduplicated `NetworkSnapshot`, serializes operations, runs one
bounded monitor, and closes its timer and platform adapter during backend
shutdown. AppShell owns the sole Network `EventSource`; Settings and the
passive top-bar indicators consume that shared snapshot without frontend
polling.

Public contracts expose opaque adapter and session-network IDs, safe display
names, link state, connectivity, Wi-Fi radio/scan state, and read-only IP
information. They never expose passwords, profile XML, BSSID or MAC addresses,
Windows interface GUIDs, NetworkManager UUIDs, helper commands, or native
errors.

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

Linux uses `nmcli` with separate arguments, `LC_ALL=C`, explicit terse/escaped
fields, bounded timeouts, no shell, sudo, or interactive prompt. Secrets use
`--passwd-file /dev/stdin`. A temporary connection is activated before the
single Eidetic profile is replaced. Missing NetworkManager degrades to
`unsupported`; the adapter never edits system network files.

Eidetic only creates, replaces, disconnects, or deletes the profile named
`Eidetic Player Wi-Fi`. Profiles created by the operating system or other
applications are preserved.

## UI contract

Settings root has separate Interface and Network rows. Network uses the shared
segmented control as a Wired/Wi-Fi view selector; selecting one never disables
the other. Its in-content header follows Interface: Back and the short
description stay on the left, the selector stays on the right, and the top bar
retains the normal Settings hamburger. Root, Interface, and Network share the
same content width and vertical rhythm. Both panels show current IPv4
configuration read-only. Wi-Fi adds
software radio control, current connection ownership, bounded explicit scan,
supported Open/WPA2 Personal/WPA3 Personal connection, hidden SSID, disconnect,
and conditional Forget.

Password fields explicitly opt into the reusable `password` keyboard profile.
The field remains authoritative, keeps password masking unless the form's
Show/Hide control is used, is cleared immediately when submitted, and is never
persisted. Enterprise/EAP, WEP, captive-portal login, editable IP, VPN, proxy,
hotspot, and SMB remain out of scope.
