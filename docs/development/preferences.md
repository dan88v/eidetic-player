# UI preferences persistence

## Ownership and scope

The backend JSON file is the sole authority for UI preferences:

- Linux: `${XDG_CONFIG_HOME:-$HOME/.config}/eidetic-player/preferences.json`;
- Windows: the backend's canonical roaming config root under
  `Eidetic Player/preferences.json`.

The config directory is mode `0700` and the file is mode `0600` on POSIX.
Neither path is inside an installed release, `current`, or `previous`.
Installer updates, release rollback, and ordinary uninstall preserve it.
Only the existing strongly confirmed purge-data flow removes the config root.

The file does not contain Audio Output selection, SMB records or credentials,
Library/Favorites/Recently Played/Playlist data, Queue, current media, media
paths, or player-session state. Those stores retain their existing owners.

## Schema and writes

Schema version 1 contains a monotonic revision, the closed set of UI
preferences, and the legacy-import state. Each known field is validated
independently. An invalid known value falls back only in memory; unknown
top-level, migration, and preference fields are preserved on an unrelated
patch.

Writes are serialized and use a same-directory private temporary file, file
`fsync`, atomic rename, and parent-directory `fsync` on POSIX. The previous
valid document is retained as `preferences.json.bak`. A corrupt main file can
be read from that backup without overwriting the corrupt evidence. If neither
copy is valid, or if the schema is newer than the running application, the
store is degraded and read-only; the original files remain untouched.

`GET /api/preferences`, `PATCH /api/preferences`, and
`POST /api/preferences/migrate-legacy` expose only the typed snapshot and
known preference fields. PATCH uses optimistic revision checks. It never
returns a filesystem path or raw invalid data.

## Bootstrap and saving

`GET /api/bootstrap` includes the authoritative preference snapshot. The UI
keeps the existing splash mounted while the backend loads and, if required,
performs the one-time legacy import. AppStore and the first meaningful render
are then created from the resulting backend values. A divergent localStorage
value cannot override that bootstrap.

UI changes remain immediate in memory. One controller coalesces dirty fields,
uses a 300 ms trailing debounce, serializes PATCH requests, and retries at
most three times with bounded backoff. A revision conflict reloads the latest
snapshot and reapplies only still-dirty fields. A final failure retains the
dirty values and shows one warning:

`Settings could not be saved. They will be retried.`

Volume remains immediate through PlayerService while its preference write is
debounced and flushed at gesture commit. Preferences also flush on Power
actions, `pagehide`, hidden visibility, app teardown, and test teardown. Flush
waits are bounded and never hold Quit indefinitely.

## Legacy migration and rollback

When no backend file exists, bootstrap reports `required`. The UI reads only
the exact legacy localStorage key whitelist with `getItem`; it never
enumerates localStorage or reads cookies, IndexedDB, history, cache, or other
browser data. Valid values are submitted once to the migration endpoint.
Legacy `spectrum` maps to `spectrumMono`. Keys are not deleted.

On Raspberry Pi, Neutralino's loopback server uses a changing ephemeral port.
WebKitGTK therefore creates files such as
`http_127.0.0.1_<port>.localstorage`, so a new process cannot reliably see the
previous origin. The audit proved that a localStorage compatibility mirror
would also be invisible to a restarted legacy rollback build; no ineffective
mirror is written.

If no prior key is visible, the backend records `manual-required` rather than
silently finalizing defaults. Recover a previously recorded, non-sensitive
snapshot from a visible terminal in the Raspberry checkout:

```text
/opt/eidetic-player/node/current/bin/node scripts/import-preferences.mjs
```

Paste one JSON object containing only UI preference fields, then send EOF
(`Ctrl+D`). The controller reads stdin rather than argv, has a 16 KiB bound,
rejects unknown fields locally, sends only to the fixed loopback endpoint, and
prints only field count and revision. The backend validates every value and
requires explicit overwrite confirmation. Do not put SMB data, credentials,
media paths, Queue, Favorites, Audio Output IDs, or exported browser data in
the input.
