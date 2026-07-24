# Security and accessibility guidelines

## Trust boundaries

Treat all of these as untrusted input:

- frontend JSON request bodies;
- file paths returned by the shell;
- dropped paths;
- metadata and embedded artwork;
- MIME declarations;
- Queue and artwork IDs from URLs;
- MPV and FFmpeg output;
- persisted browser values.

Validate again at the backend even when the shell or UI has already filtered
the input.

## Filesystem and process safety

- Accept only supported local audio files for playback operations.
- Validate existence, file type, readability, and supported extension.
- Keep folder expansion non-recursive unless a future step explicitly changes
  it.
- Use opaque IDs for Queue, artwork, and waveform endpoints.
- Reject unknown IDs and traversal-like input; never resolve client-provided
  paths in media endpoints.
- Do not expose absolute paths in SSE, browser URLs, logs shown to users, or
  accessible labels.
- Validate artwork signatures as well as declared MIME types and enforce size
  limits.
- Never execute SVG from media tags.
- Spawn MPV and FFmpeg without a shell and with argument arrays.
- Keep executable discovery explicit and verified with version commands.
- Keep Neutralino native allowlists minimal.
- Never use wildcard CORS for convenience.
- Keep Linux NetworkManager authorization limited to the documented action
  IDs, dedicated runtime group, exact backend systemd unit, and
  `NoNewPrivileges=true`. Never add a NetworkManager wildcard, sudoers rule,
  `CAP_NET_ADMIN`, or a privileged network boot helper.
- Linux deployment installers must validate user/group and traversal-free
  absolute paths, reject symlink targets, quote values with spaces/Unicode,
  support an isolated staging root, and never edit system connection profiles.
- SMB uses only operating-system clients: deviceless UNC on Windows and
  read-only CIFS mounts on Linux. Never put a password in argv/logs or use
  SMB1, automatic Guest fallback, sudo, force unmount, drive letters, or a
  command shell. Revalidate connection state, root containment, entry type,
  extension, readability, traversal, mixed separators, null bytes, and
  symlink/junction exclusion for every browse/play operation.

## Secrets and private data

Do not commit:

- `.env`;
- credentials;
- SMB passwords;
- personal media;
- personal absolute paths;
- logs containing sensitive paths;
- generated temporary artwork or waveform data.

Examples and docs use placeholders or environment variables.

The Linux network environment file contains only the authorization group and
installation directory. Wi-Fi SSIDs, passwords, PSKs, profile contents, and
pending transaction contents must not appear in deployment reports or doctor
output.

SMB connection JSON contains no password. Windows secrets live in the current
user's Credential Manager. Linux secrets use an atomic backend-only mode-0600
credential file in a private directory and are removed when their Eidetic
connection is removed. Reports and screenshots use fixtures or redact real
identities.

## Failure behavior

Playback, metadata, artwork, and analysis fail independently:

- artwork failure shows the placeholder and does not stop playback;
- metadata failure preserves MPV fallback metadata;
- analyzer failure falls back visually and does not stop MPV;
- MPV absence produces a controlled unavailable state;
- UI messages are concise and do not expose stack traces.

Rate-limit repeated warnings and prevent retry/restart loops.

## Accessibility baseline

- Use semantic HTML elements before ARIA.
- Interactive icons are real buttons with localized accessible names.
- Sliders expose minimum, maximum, current value, and keyboard behavior.
- Current navigation and Queue state are conveyed accessibly, not by color
  alone.
- Dialogs and drawers trap focus, close with Escape, and restore focus.
- Hidden/backdrop content is not focusable.
- Pointer interactions have equivalent keyboard operation during development.
- Focus remains visible against the dark theme.
- Decorative artwork uses empty alt text; Now Playing artwork may use concise,
  localized descriptive text.
- Dynamic labels reflect current action/state for Play/Pause, Repeat, Mute, and
  visualizer cycling.

Accessibility must survive incremental DOM reconciliation. Updating or removing
a Queue row must not silently discard focus without a deliberate fallback.
