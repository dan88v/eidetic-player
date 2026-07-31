# LAN remote access

Remote access is an optional appliance feature for controlling Eidetic Player
from a phone on the same trusted private network. It is disabled by default and
must not affect local startup, playback, analysis, or the existing loopback
API.

## Process and listener boundaries

- The local UI continues to use the backend listener on `127.0.0.1:4310`.
- Remote access owns a separate listener on `0.0.0.0:8080`.
- The remote listener starts only when remote access is available and enabled.
- Only private IPv4 and link-local clients are accepted. Loopback is accepted
  only by the explicit development fixture.
- Listener failure is reported in Settings but does not fail backend readiness.
- Disabling remote access closes the listener and active remote streams.
  Paired devices and their browser sessions remain valid for a later re-enable
  until they expire or are revoked.

The remote gateway receives narrow adapters for player, queue, library,
folders, artwork, audio-output state, and display wake. It does not proxy the
local API and cannot reach update, display configuration, network
administration, SMB credentials, analysis, or visualizer endpoints.

## Persistent state

Remote state is independent from UI preferences and is stored in
`remote-access.json`. The Linux directory and file modes are respectively
`0700` and `0600`. Writes use a temporary file, sync, atomic rename, and parent
directory sync. Symlinks, unexpected owners, malformed current schemas, and
future schemas fail closed.

The store contains only:

- enabled preference;
- paired device ID, display name, token hash, creation time, and last-seen
  time;
- schema data needed for safe forward compatibility.

Pairing codes, raw bearer tokens, cookies, CSRF values, source credentials, and
media paths are never persisted or returned by the local management API.

## Pairing and sessions

Pairing uses a six-digit one-time code with a five-minute lifetime. A code has
at most five attempts, with per-address accounting, and a maximum of eight
paired devices. Successful pairing consumes the code and creates a
high-entropy token; only its cryptographic hash is stored.

The browser session uses an `HttpOnly`, `SameSite=Strict` cookie. Mutating
requests additionally require the in-memory CSRF value returned by authenticated
bootstrap. Host and Origin are validated, CORS is not enabled, request bodies
are bounded, and rate limits apply to pairing and authenticated traffic.
Revoking a device invalidates its session and closes its active event stream.

Because the appliance serves plain HTTP on the LAN, the Settings page and
pairing UI explicitly describe the trusted-network-only boundary. This feature
is not intended for internet exposure.

## Remote API and connection budget

The gateway uses an explicit route allowlist:

- pairing, authenticated bootstrap, logout, and one multiplexed SSE stream;
- player commands and queue play/reorder/remove/clear;
- read-only audio-output mode and software-volume limits;
- paginated Library, search, favorites, history, playlists, and their explicit
  play/queue actions;
- configured source listing and bounded folder/SMB browse actions;
- authenticated player and queue artwork;
- display wake only.

Each visible remote client owns at most one SSE connection. Player,
audio-output, library-invalidation, and session-revocation events share that
stream. The stream closes while the page is hidden and bootstrap is refreshed
before reconnecting. Remote access never starts an FFmpeg analyzer, adds a
visualizer stream, or adds polling.

The local appliance UI receives Remote access management snapshots as a named
event on its existing player SSE. This lets a completed pairing consume the
code, update Paired devices, and show confirmation immediately without polling
or opening another local connection.

## UI and packaging

`apps/remote-ui` is a standalone vanilla TypeScript application. It does not
import `apps/ui`, use local storage, register a service worker, or include a
visualizer. Its mobile shell provides Player, Queue, Library, and Browse with a
persistent mini-player and bottom navigation.

The local Settings root contains the Remote access entry. Its dedicated page
manages the listener preference, pairing-code lifetime, and paired-device
revocation through loopback-only management routes.

The separate Vite build emits `dist/remote-ui`. Linux release verification
requires that directory, and the installer copies it into the application
release alongside the backend and local UI. No new runtime dependency or
privileged service is required; update and uninstall continue to operate on the
versioned application directory.
