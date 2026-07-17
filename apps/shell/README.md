# Development shell

Neutralinojs is an intentionally thin Windows development shell. Its generated
root configuration reads application metadata and target dimensions from
`packages/config`, enables native dropped-file events, and permits the native
open dialog. The UI's Neutralino `PlatformBridge` adapter returns only selected
or dropped absolute paths. Playback, validation, queue, metadata, and MPV process
logic remain in the Node backend.
