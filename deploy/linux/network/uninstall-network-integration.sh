#!/usr/bin/env bash
set -euo pipefail

staging_root="/"
dry_run=false

usage() {
  cat <<'EOF'
Usage: uninstall-network-integration.sh [--root STAGING_ROOT] [--dry-run]

Removes only the three Eidetic Player network deployment artifacts. It never
removes users, groups, profiles, credentials, application data, or pending
network transactions, and it never restarts services.
EOF
}

fail() {
  printf 'uninstall-network-integration: %s\n' "$1" >&2
  exit 2
}

valid_absolute_path() {
  [[ "$1" == /* && "$1" != *$'\n'* && "$1" != *$'\r'* ]] || return 1
  local segment
  local -a segments=()
  IFS='/' read -r -a segments <<< "$1"
  for segment in "${segments[@]}"; do
    [[ "$segment" != ".." ]] || return 1
  done
}

while (($# > 0)); do
  case "$1" in
    --root)
      (($# >= 2)) || fail "--root requires a value"
      staging_root="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

valid_absolute_path "$staging_root" || fail "staging root must be absolute and traversal-free"
staging_root="${staging_root%/}"
[[ -n "$staging_root" ]] || staging_root="/"
readonly ROOT_PREFIX="${staging_root%/}"
readonly POLICY_TARGET="${ROOT_PREFIX}/etc/polkit-1/rules.d/49-eidetic-player-network.rules"
readonly DROPIN_TARGET="${ROOT_PREFIX}/etc/systemd/system/eidetic-player-backend.service.d/20-network.conf"
readonly ENV_TARGET="${ROOT_PREFIX}/etc/eidetic-player/eidetic-player-network.env"

assert_no_symlink() {
  local target="$1"
  local current="${ROOT_PREFIX:-/}"
  local relative="${target#${ROOT_PREFIX}}"
  local segment
  local -a segments=()
  [[ ! -L "$current" ]] || fail "staging root is a symlink"
  IFS='/' read -r -a segments <<< "$relative"
  for segment in "${segments[@]}"; do
    [[ -n "$segment" ]] || continue
    current="${current%/}/${segment}"
    [[ ! -L "$current" ]] || fail "refusing symlink target: $current"
  done
}

for target in "$POLICY_TARGET" "$DROPIN_TARGET" "$ENV_TARGET"; do
  assert_no_symlink "$target"
done

if [[ "$staging_root" == "/" && "$dry_run" == false && "$EUID" -ne 0 ]]; then
  fail "real uninstall must be run explicitly as root"
fi

printf 'uninstall-network-integration: root=%s dry-run=%s\n' "$staging_root" "$dry_run"
printf '  remove: %s\n  remove: %s\n  remove: %s\n' \
  "$POLICY_TARGET" "$DROPIN_TARGET" "$ENV_TARGET"
if [[ "$dry_run" == true ]]; then
  exit 0
fi

rm -f -- "$POLICY_TARGET" "$DROPIN_TARGET" "$ENV_TARGET"
rmdir -- "${DROPIN_TARGET%/*}" 2>/dev/null || true
rmdir -- "${ENV_TARGET%/*}" 2>/dev/null || true

if [[ "$staging_root" == "/" ]] && command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
fi
