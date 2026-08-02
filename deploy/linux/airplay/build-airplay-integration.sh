#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST="$SCRIPT_DIR/sources.json"
OUTPUT=

while (($#)); do
  case "$1" in
    --output)
      (($# >= 2)) || { printf 'missing --output value\n' >&2; exit 64; }
      OUTPUT="$2"
      shift 2
      ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 64 ;;
  esac
done

[[ -n "$OUTPUT" && "$OUTPUT" == /* ]] || {
  printf 'an absolute --output path is required\n' >&2
  exit 64
}
((EUID != 0)) || {
  printf 'AirPlay sources must be built by the unprivileged runtime user\n' >&2
  exit 77
}
[[ -f "$MANIFEST" && ! -L "$MANIFEST" ]] || {
  printf 'AirPlay source manifest is unavailable\n' >&2
  exit 1
}
for tool in python3 curl sha256sum tar autoreconf patch make install file; do
  command -v "$tool" >/dev/null || {
    printf 'required AirPlay build tool is unavailable: %s\n' "$tool" >&2
    exit 1
  }
done

mapfile -d '' fields < <(python3 - "$MANIFEST" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as source:
    manifest = json.load(source)
values = [
    manifest["integrationVersion"],
    manifest["shairportSync"]["release"],
    manifest["shairportSync"]["archiveUrl"],
    manifest["shairportSync"]["sha256"],
    manifest["nqptp"]["release"],
    manifest["nqptp"]["archiveUrl"],
    manifest["nqptp"]["sha256"],
]
for value in values:
    if not isinstance(value, str) or "\x00" in value or "\n" in value:
        raise SystemExit("invalid AirPlay source manifest")
    sys.stdout.buffer.write(value.encode("utf-8") + b"\x00")
PY
)
(( ${#fields[@]} == 7 )) || { printf 'invalid AirPlay source manifest\n' >&2; exit 1; }
integration_version="${fields[0]}"
shairport_version="${fields[1]}"
shairport_url="${fields[2]}"
shairport_sha="${fields[3]}"
nqptp_version="${fields[4]}"
nqptp_url="${fields[5]}"
nqptp_sha="${fields[6]}"

case "$integration_version" in
  *[!A-Za-z0-9.+_-]*) printf 'unsafe integration version\n' >&2; exit 1 ;;
esac
[[ ! -e "$OUTPUT" ]] || { printf 'AirPlay output already exists\n' >&2; exit 1; }
output_parent="$(dirname -- "$OUTPUT")"
mkdir -p -- "$output_parent"
[[ -d "$output_parent" && ! -L "$output_parent" ]] || exit 1

workspace="$(mktemp -d "${TMPDIR:-/tmp}/eidetic-airplay.XXXXXXXX")"
chmod 0700 "$workspace"
cleanup() { rm -rf -- "$workspace"; }
trap cleanup EXIT

download() {
  local url="$1" destination="$2"
  curl --fail --location --proto '=https' --tlsv1.2 \
    --connect-timeout 15 --max-time 180 --retry 3 --retry-delay 2 \
    --output "$destination" "$url"
}

extract_checked() {
  local archive="$1" destination="$2" expected_root="$3"
  mkdir -m 0700 -- "$destination"
  python3 - "$archive" "$destination" "$expected_root" <<'PY'
import os
import pathlib
import sys
import tarfile

archive, destination, expected_root = sys.argv[1:]
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    roots = set()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or not path.parts:
            raise SystemExit("unsafe archive path")
        roots.add(path.parts[0])
        if member.isdev() or member.isfifo():
            raise SystemExit("unsafe archive member")
        if member.issym() or member.islnk():
            target = pathlib.PurePosixPath(member.linkname)
            resolved = pathlib.PurePosixPath(*path.parts[:-1], *target.parts)
            if target.is_absolute() or ".." in resolved.parts or resolved.parts[0] != expected_root:
                raise SystemExit("archive link escapes source root")
    if roots != {expected_root}:
        raise SystemExit("unexpected archive root")
    bundle.extractall(destination)
root = os.path.realpath(os.path.join(destination, expected_root))
if os.path.dirname(root) != os.path.realpath(destination):
    raise SystemExit("invalid extracted source root")
PY
}

shairport_archive="$workspace/shairport-sync.tar.gz"
nqptp_archive="$workspace/nqptp.tar.gz"
download "$shairport_url" "$shairport_archive"
download "$nqptp_url" "$nqptp_archive"
printf '%s  %s\n' "$shairport_sha" "$shairport_archive" | sha256sum --check --strict
printf '%s  %s\n' "$nqptp_sha" "$nqptp_archive" | sha256sum --check --strict

extract_checked "$shairport_archive" "$workspace/shairport" "shairport-sync-$shairport_version"
extract_checked "$nqptp_archive" "$workspace/nqptp" "nqptp-$nqptp_version"
shairport_source="$workspace/shairport/shairport-sync-$shairport_version"
nqptp_source="$workspace/nqptp/nqptp-$nqptp_version"

(
  cd "$shairport_source"
  patch --batch --forward -p1 <"$SCRIPT_DIR/patches/shairport-sync-5.2.1-eidetic-fail-closed.patch"
  autoreconf -fi
  ./configure --prefix=/opt/eidetic-player/current/airplay \
    --with-airplay-2 --with-alsa --with-pipewire --with-avahi \
    --with-ssl=openssl --with-soxr --with-metadata --with-metadata-pipe
  make -j2
)
(
  cd "$nqptp_source"
  autoreconf -fi
  ./configure --prefix=/opt/eidetic-player/current/airplay
  make -j2
)

stage="$workspace/artifact"
install -d -m 0755 "$stage/bin" "$stage/share/eidetic-player-airplay/licenses" \
  "$stage/share/eidetic-player-airplay/sources"
install -m 0755 "$shairport_source/shairport-sync" "$stage/bin/shairport-sync"
install -m 0755 "$nqptp_source/nqptp" "$stage/bin/nqptp"
install -m 0644 "$MANIFEST" "$stage/share/eidetic-player-airplay/sources.json"
install -m 0644 "$SCRIPT_DIR/THIRD_PARTY_NOTICES.md" \
  "$stage/share/eidetic-player-airplay/THIRD_PARTY_NOTICES.md"
install -m 0644 "$SCRIPT_DIR/patches/shairport-sync-5.2.1-eidetic-fail-closed.patch" \
  "$stage/share/eidetic-player-airplay/sources/"
install -m 0644 "$shairport_archive" \
  "$stage/share/eidetic-player-airplay/sources/shairport-sync-$shairport_version.tar.gz"
install -m 0644 "$nqptp_archive" \
  "$stage/share/eidetic-player-airplay/sources/nqptp-$nqptp_version.tar.gz"
install -m 0644 "$shairport_source/LICENSES" \
  "$stage/share/eidetic-player-airplay/licenses/SHAIRPORT-LICENSES"
install -m 0644 "$nqptp_source/LICENSE" \
  "$stage/share/eidetic-player-airplay/licenses/NQPTP-GPL-2.0.txt"

shairport_binary_sha="$(sha256sum "$stage/bin/shairport-sync" | cut -d' ' -f1)"
nqptp_binary_sha="$(sha256sum "$stage/bin/nqptp" | cut -d' ' -f1)"
compiler="$(cc --version | head -n 1 | tr -cd '[:alnum:] ._()+-')"
architecture="$(uname -m)"
python3 - "$stage/artifact.json" "$integration_version" "$architecture" \
  "$compiler" "$shairport_binary_sha" "$nqptp_binary_sha" <<'PY'
import json
import sys

path, version, architecture, compiler, shairport_hash, nqptp_hash = sys.argv[1:]
document = {
    "schemaVersion": 1,
    "integrationVersion": version,
    "architecture": architecture,
    "compiler": compiler,
    "binaries": {
        "shairport-sync": shairport_hash,
        "nqptp": nqptp_hash,
    },
}
with open(path, "x", encoding="utf-8") as target:
    json.dump(document, target, indent=2)
    target.write("\n")
PY
chmod 0644 "$stage/artifact.json"
file "$stage/bin/shairport-sync" "$stage/bin/nqptp"
shairport_features="$("$stage/bin/shairport-sync" -V 2>&1)"
for feature in 5.2.1 AirPlay2 smi5 OpenSSL Avahi ALSA PipeWire soxr metadata; do
  grep -Fq "$feature" <<<"$shairport_features" || {
    printf 'Shairport Sync feature missing from version string: %s\n' "$feature" >&2
    exit 1
  }
done
nqptp_features="$("$stage/bin/nqptp" -V 2>&1)"
grep -Fq '1.2.8' <<<"$nqptp_features"
grep -Eq 'Shared Memory Interface Version:[[:space:]]*5' <<<"$nqptp_features"
printf '%s\n%s\n' "$shairport_features" "$nqptp_features"
mv -- "$stage" "$OUTPUT"
printf 'AirPlay integration built: %s\n' "$integration_version"
