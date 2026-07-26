# Step 2.14-R2 — READY FOR CI VALIDATION

## Result

The official-source remote correction is implemented and locally verified.
The exact official HTTPS checkout used by GitHub Actions is now accepted
without weakening source validation. Focused tests, the installer-safe
profile, the complete repository gates, the real MPV path, and the real
Windows application smoke all pass.

The change is ready to be committed and pushed for GitHub Actions validation.
CI PASS is not claimed before that new remote run.

## Baseline

- Branch: `main`.
- Initial working tree: clean.
- `HEAD...origin/main`: `0 0`.
- HEAD: `06f524840dd6a03cf0243f5a387849205eb0650c`.
- Step 2.14 is present at HEAD.
- No merge or rebase was in progress.
- Local origin:
  `https://github.com/dan88v/eidetic-player.git`.
- `deploy/linux/lib/common.sh`: Git mode `100755`.
- `deploy/linux/test-staging.sh`: Git mode `100755`.

## Original CI failure and root cause

The Step 2.14 GitHub Actions run reached
`npm run verify:linux:installer`, passed executable-mode, installer-contract,
install-safe, Network, and platform checks, then failed the first staging
installer with:

```text
Error: source checkout is not the official Eidetic Player repository
```

`eidetic_preflight_checkout` read `remote.origin.url` and accepted only the
official HTTPS and SCP-like SSH forms ending in `.git`. GitHub Actions used
the equivalent official HTTPS checkout URL without `.git`, which the exact
allowlist rejected.

The observed local remote includes `.git`; the CI failure demonstrates the
equivalent canonical form without `.git`.

## Test RED before the production fix

A behavioral fixture was first added to `deploy/linux/test-staging.sh` and
executed with Git Bash, not WSL, against the unchanged production logic.

It failed for the required URL:

```text
deploy/linux/test-staging.sh: line 37:
eidetic_is_official_source_remote: command not found
official source remote was rejected:
https://github.com/dan88v/eidetic-player
```

The real checkout remote was not modified.

## Implementation

`deploy/linux/lib/common.sh` now defines the pure,
network-independent `eidetic_is_official_source_remote` function. It returns
success only for an exact allowlist and prints nothing. The existing preflight
uses that function and retains the original error:

```text
source checkout is not the official Eidetic Player repository
```

Accepted forms:

- `https://github.com/dan88v/eidetic-player`
- `https://github.com/dan88v/eidetic-player.git`
- `git@github.com:dan88v/eidetic-player`
- `git@github.com:dan88v/eidetic-player.git`

The fixture rejects empty values, local paths, `file:` URLs, forks, altered
repository names, `.git.evil`, hostile hosts, path traversal, embedded
credentials, hostile SSH hosts, query strings, fragments, and content appended
after `.git`.

Source validation remains active. There is no `GITHUB_ACTIONS`, `CI`,
`EIDETIC_ROOT`, staging, or root bypass; no network access; no Git
configuration mutation; and no permissive host, basename, substring, or
wildcard match.

## Focused verification

Passed before the final gate run:

- local official/malicious URL fixture: PASS;
- `bash -n deploy/linux/lib/common.sh deploy/linux/test-staging.sh`: PASS
  using Git Bash;
- `npm.cmd run verify:linux:executables`: PASS, 33 tracked deployment files;
- focused `linux-installation.test.ts`: 13/13 PASS;
- `npm.cmd run verify:linux:installer`: PASS;
- install-safe suite: 61 total, 50 pass, 11 expected Windows/POSIX/Linux
  staging skips;
- Network deployment verification: PASS.

Linux root staging was **NOT RUN** on Windows. No WSL or real system
installation was used.

## Windows real smoke

The unchanged application path was exercised with:

```text
EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe
npm.cmd run dev
```

Verified:

- backend listening on 4310;
- Vite listening on 5173;
- Neutralino/WebView2 opened;
- real MPV detected with its installed build banner;
- `/health`: `status: ok`;
- `/api/readiness`: `status: ready`, `mpvAvailable: true`;
- a real track was loaded in Now Playing;
- Play and Pause changed real backend player status;
- Neutralino exited with success code 0;
- backend received SIGTERM and shut down;
- no project Neutralino, Node, MPV, or FFmpeg process remained;
- no listener remained on 4310 or 5173;
- no temporary log or screenshot remained.

## Final gates

Two early gate attempts correctly stopped on strict-test issues introduced by
the new static assertion: a TypeScript narrowing error and the
`prefer-regexp-exec` lint rule. Both were corrected without changing
production behavior or test coverage. The subsequent complete final sequence
passed:

- `npm.cmd run format:check`: PASS;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS;
- `npm.cmd test`: 454 total, 446 pass, 8 expected platform skips;
- `npm.cmd run test:posix`: 5 total, 3 pass, 2 expected Windows skips;
- `npm.cmd run verify:network:deployment`: PASS;
- `npm.cmd run verify:linux:executables`: PASS, 33 tracked deployment files;
- `npm.cmd run verify:linux:installer`: PASS;
- install-safe suite: 61 total, 50 pass, 11 expected
  Windows/POSIX/Linux-staging skips;
- `npm.cmd run mpv:doctor`: PASS with the real configured executable,
  headless startup, and JSON IPC;
- `npm.cmd run test:mpv`: 8/8 PASS;
- `git diff --check`: PASS.

## Scope and files changed

Changed production file:

- `deploy/linux/lib/common.sh`

Changed test files:

- `deploy/linux/test-staging.sh`
- `apps/backend/test/linux-installation.test.ts`

Report:

- `prompts/step2.14_r2_ci_source_remote_output.md`

No change was made to CI, package files, installer, update, runtime launcher,
release verifier, executable-mode verifier, backend, player, MPV, UI, or Step
2.14.1.

The fixed fetch remote remains:

```text
https://github.com/dan88v/eidetic-player.git
```

Both changed shell scripts retained Git mode `100755` at the last mode check.

## Limits

- Linux root staging: **NOT RUN**.
- Raspberry Pi: **NOT TESTED**.
- GitHub Actions after this local change: **NOT RUN**.
- No commit or push was performed.

## Status

**READY FOR CI VALIDATION**
