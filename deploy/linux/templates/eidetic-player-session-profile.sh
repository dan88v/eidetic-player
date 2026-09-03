# Eidetic Player Raspberry Pi OS Lite appliance session.
if [ "${USER:-}" = "__EIDETIC_RUNTIME_USER__" ] &&
  [ "$(tty 2>/dev/null || true)" = /dev/tty1 ] &&
  [ -z "${SSH_CONNECTION:-}" ] && [ -z "${SSH_TTY:-}" ] &&
  [ -z "${WAYLAND_DISPLAY:-}" ] && [ "${EIDETIC_SESSION_HANDOFF:-0}" != 1 ]; then
  export EIDETIC_SESSION_HANDOFF=1
  EIDETIC_RUNTIME_USER=__EIDETIC_RUNTIME_USER__
  export EIDETIC_RUNTIME_USER
  exec /usr/local/bin/eidetic-player-session
fi
