# Step 2.15.1-R2 — CI ShellCheck SC2016 follow-up

Date: 2026-07-26

## Result

`READY FOR CI VALIDATION`

The GitHub Actions failure was caused by ShellCheck SC2016 on the intentionally
single-quoted JavaScript payload passed to `node -e` by the Linux installation
doctor. JavaScript template expressions such as `${state}` must remain literal
until Node evaluates the payload; Bash must not expand them.

## Fix

- Added a narrowly scoped `# shellcheck disable=SC2016` directive immediately
  before that one `node -e` command.
- Added an explanatory comment documenting why single quotes are required.
- Added a focused source regression assertion so the suppression cannot be
  accidentally detached from the intended command.
- No global ShellCheck rule was disabled.
- No runtime behavior, doctor output, installer behavior or package plan was
  changed.

## Verification

- `bash -n deploy/linux/doctor-installation.sh`: PASS
- `npm.cmd run format:check`: PASS
- `npm.cmd run lint`: PASS
- Focused audio-doctor tests: 3 PASS, 0 FAIL, 2 native-Linux fixtures skipped
  on Windows
- `npm.cmd run verify:linux:executables`: PASS
- Doctor Git mode remains `100755`
- `git diff --check`: PASS
- Local ShellCheck execution: NOT RUN because ShellCheck is not installed and
  the R2 instructions explicitly prohibit installing it

The new GitHub Actions run has not occurred yet, so this report does not claim
CI PASS.

No commit or push was made.
