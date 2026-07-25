#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly POLICY_SOURCE="${SCRIPT_DIR}/eidetic-player-network.polkit.rules.template"
readonly DROPIN_SOURCE="${SCRIPT_DIR}/eidetic-player-backend-network.conf.example"

runtime_user=""
network_group=""
install_dir=""
staging_root="/"
dry_run=false

usage() {
  cat <<'EOF'
Usage: install-network-integration.sh --user USER --group GROUP \
  --install-dir ABSOLUTE_PATH [--root STAGING_ROOT] [--dry-run]

Installs only the Eidetic Player NetworkManager polkit rule, systemd drop-in,
and non-secret environment metadata. It never changes network configuration,
starts/restarts services, downloads packages, or invokes sudo.
EOF
}

fail() {
  printf 'install-network-integration: %s\n' "$1" >&2
  exit 2
}

valid_account_name() {
  [[ "$1" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]
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
    --user)
      (($# >= 2)) || fail "--user requires a value"
      runtime_user="$2"
      shift 2
      ;;
    --group)
      (($# >= 2)) || fail "--group requires a value"
      network_group="$2"
      shift 2
      ;;
    --install-dir)
      (($# >= 2)) || fail "--install-dir requires a value"
      install_dir="$2"
      shift 2
      ;;
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

[[ -n "$runtime_user" ]] || fail "--user is required"
[[ -n "$network_group" ]] || fail "--group is required"
[[ -n "$install_dir" ]] || fail "--install-dir is required"
valid_account_name "$runtime_user" || fail "invalid runtime user"
valid_account_name "$network_group" || fail "invalid network group"
valid_absolute_path "$install_dir" || fail "install directory must be absolute and traversal-free"
valid_absolute_path "$staging_root" || fail "staging root must be absolute and traversal-free"
[[ -f "$POLICY_SOURCE" && -f "$DROPIN_SOURCE" ]] || fail "deployment templates are missing"

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
  fail "real installation must be run explicitly as root"
fi

if [[ "$staging_root" == "/" && "$dry_run" == false ]]; then
  getent passwd "$runtime_user" >/dev/null || fail "runtime user does not exist"
fi

printf 'install-network-integration: user=%s group=%s install-dir=%s root=%s dry-run=%s\n' \
  "$runtime_user" "$network_group" "$install_dir" "$staging_root" "$dry_run"
printf '  policy: %s (0644 root:root)\n' "$POLICY_TARGET"
printf '  drop-in: %s (0644 root:root)\n' "$DROPIN_TARGET"
printf '  environment: %s (0640 root:%s)\n' "$ENV_TARGET" "$network_group"

if [[ "$dry_run" == true ]]; then
  exit 0
fi

if [[ "$staging_root" == "/" ]]; then
  if ! getent group "$network_group" >/dev/null; then
    groupadd -- "$network_group"
  fi
  if ! id -nG "$runtime_user" | tr ' ' '\n' | grep -Fxq -- "$network_group"; then
    usermod -a -G "$network_group" -- "$runtime_user"
  fi
fi

temporary_dir="$(mktemp -d)"
rendered_policy="${temporary_dir}/49-eidetic-player-network.rules"
rendered_environment="${temporary_dir}/eidetic-player-network.env"
cleanup() {
  rm -f -- "$rendered_policy" "$rendered_environment"
  rmdir -- "$temporary_dir"
}
trap cleanup EXIT
sed "s/@EIDETIC_NETWORK_GROUP@/${network_group}/g" "$POLICY_SOURCE" > "$rendered_policy"
escaped_install_dir="${install_dir//\\/\\\\}"
escaped_install_dir="${escaped_install_dir//\"/\\\"}"
{
  printf '# Generated non-secret Eidetic Player network deployment metadata.\n'
  printf 'EIDETIC_NETWORK_GROUP=%s\n' "$network_group"
  printf 'EIDETIC_PLAYER_INSTALL_DIR="%s"\n' "$escaped_install_dir"
} > "$rendered_environment"

install -D -m 0644 -- "$rendered_policy" "$POLICY_TARGET"
install -D -m 0644 -- "$DROPIN_SOURCE" "$DROPIN_TARGET"
install -D -m 0640 -- "$rendered_environment" "$ENV_TARGET"

if [[ "$staging_root" == "/" ]]; then
  chown root:root -- "$POLICY_TARGET" "$DROPIN_TARGET"
  chown "root:${network_group}" -- "$ENV_TARGET"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload
  fi
  printf 'Runtime user group membership changed; log out/in or restart its session before use.\n'
fi
