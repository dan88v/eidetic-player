#!/usr/bin/env bash
set -euo pipefail
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
work="$(mktemp -d)"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
(
  cd "$source_root"
  tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=.codex-tmp -cf - .
) | tar -xf - -C "$work"
cd "$work"
npm ci --ignore-scripts
npm run test:case-sensitive
