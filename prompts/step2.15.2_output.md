# Step 2.15.2 — Optional Raspberry GPIO/I²S DAC installer integration

Date: 2026-07-26

## Result

`READY FOR CI VALIDATION`

The optional, default-off `i2s-dac` integration is implemented for both Linux
installer modes. It preserves pre-existing and unowned configuration, owns only
its exact marked block, and does not configure the Linux audio stack.

This report does not claim a new GitHub Actions PASS.

## Baseline Git and CI

- Branch: `main`.
- Initial working tree: clean.
- `HEAD` matched `origin/main` with divergence `0 0`.
- Baseline commit:
  `a44b4145b2b3d953adebaa81df99528c649bcf9b`.
- Step 2.15, Step 2.15.1-R1/R2, Step 2.16, and Step 2.16.1 were present.
- GitHub Actions workflow `Eidetic Player CI` for the exact baseline commit
  completed successfully before changes began.
- No merge, rebase, reset, restore, stash, clean, commit, or push was run.

## Installer audit

- Boolean appliance choices use a `choice` associative array and explicit
  `yes|no` flags.
- Standard fixes the existing appliance choices to No; the GPIO/I²S choice is
  independent and available in both modes.
- Unattended choices are explicit and never prompt.
- The single existing manifest is
  `system-ui-manifest-v1.tsv`; original managed files use deterministic keyed
  backups.
- Whole-file managed records are restored in reverse order by
  `restore-system-ui.sh`.
- Recording boot `config.txt` as a normal managed file would risk replacing
  later hardware changes. GPIO/I²S therefore uses a feature record in the same
  manifest and strict block-level lifecycle operations.
- Release activation and rollback remain atomic symlink operations.
- The existing final installer reboot prompt remains the only reboot prompt.
- Root staging uses `--root` plus Device Tree, OS, desktop, boot, and overlay
  fixtures.

## Option and flags

- Interactive label:
  `Configure a generic GPIO/I²S DAC (PCM5102A-compatible)?`
- Standard: available on recognized Raspberry Pi OS hardware; default No.
- Appliance: available on recognized Raspberry Pi OS hardware; default No.
- Unattended opt-in: `--gpio-i2s-dac`.
- Unattended absence: not requested.
- Uninstall explicit removal: `--remove-gpio-i2s-dac`.
- Uninstall interactive removal default: No.
- Invalid combined flag forms remain rejected by the existing option parser.
- The choice is stored as `EIDETIC_GPIO_I2S_DAC=0|1` in `install.conf`.
- The APT/package plan is unchanged.

## Platform, boot, and overlay detection

- The installer first uses the existing Raspberry Pi hardware and Raspberry Pi
  OS detection based on Device Tree plus narrow OS markers.
- Non-Raspberry platforms do not receive the interactive question.
- An explicit unsupported-platform opt-in reports unavailable and leaves boot
  files untouched while installation continues.
- Boot selection order is:
  1. `/boot/firmware/config.txt`;
  2. `/boot/config.txt`.
- If both exist, the firmware path wins; only one file is selected.
- Missing config, empty config, non-regular config, unexpected symlink, unreadable
  config, or unwritable parent fails safely.
- Overlay availability must match the selected layout:
  `/boot/firmware/overlays/i2s-dac.dtbo` or
  `/boot/overlays/i2s-dac.dtbo`.
- Missing overlay causes `overlay-unavailable`; no package, download, copied
  DTBO, or boot mutation occurs.

## Parser and state model

The line-oriented byte-preserving parser distinguishes:

- not requested;
- unsupported platform;
- overlay unavailable;
- absent/eligible;
- pre-existing;
- managed;
- managed-unowned;
- added;
- conflict/manual review;
- failed.

It covers LF, CRLF, no final newline, `[all]`, missing `[all]`, multiple
sections, comments, reasonable whitespace, duplicate rows, malformed markers,
double blocks, out-of-order markers, and unmanaged byte preservation.

When `[all]` exists, the block is inserted in the final applicable global
section before the next section. When it does not exist, one final `[all]`
section is added without moving existing sections.

## Pre-existing and managed ownership

An active standalone `dtoverlay=i2s-dac` is classified as pre-existing:

- no boot write;
- no boot backup;
- no markers added;
- no ownership claimed;
- no DAC reboot requirement;
- uninstall and restore preserve it.

New opt-in configuration adds exactly:

```text
# BEGIN EIDETIC MANAGED GPIO I2S DAC
dtoverlay=i2s-dac
# END EIDETIC MANAGED GPIO I2S DAC
```

The same block is never duplicated. A marked block without a coherent feature
record is `managed-unowned`; it is preserved and never reclaimed or removed.

The feature record remains in the existing manifest and records only status,
standard logical boot path, deterministic backup key, original/managed
checksums, and block version. Pre-existing, conflict, unowned, and unavailable
states are never recorded as managed ownership.

## Conflict detection

Active HiFiBerry, IQaudio, Allo, JustBoom, AudioInjector, DACBerry,
simple-audio-card, rpi-dac, and evident DAC/I²S/audio overlay names cause a
conservative conflict/manual-review result.

The installer:

- does not replace or disable the other overlay;
- does not add `i2s-dac`;
- continues the general installation;
- reports the skipped DAC configuration.

`vc4-kms-v3d`, `vc4-fkms-v3d`, GPIO-only overlays, HDMI state, comments, and
`dtparam=audio=on` are not conflicts.

## Backup and atomic write

- A deterministic original backup is created only immediately before an actual
  boot change.
- The backup uses metadata-preserving copy and byte-for-byte verification.
- An existing owned original backup is verified and reused; it is not
  overwritten or accumulated during update/reinstall.
- Pre-existing, not-requested, unavailable, and conflict states create no boot
  backup.
- Candidate content is calculated in memory.
- A temporary file is created in the same directory.
- File mode and ownership are copied from the original.
- File and parent directory are fsynced on POSIX.
- `os.replace` performs the atomic rename.
- Post-write validation rereads the file and verifies markers, overlay count,
  ordering, unmanaged bytes, mode, ownership, backup, and manifest.
- No `echo >>`, dynamic shell, `eval`, or global config normalization is used.

## Reboot behavior

- GPIO/I²S reboot-required is reported only after the managed block is actually
  added or explicitly removed.
- Pre-existing, already managed, managed-unowned, unavailable, conflict,
  unsupported, and not-requested states do not report a DAC reboot requirement.
- No automatic reboot, countdown, or second reboot prompt was added.
- Update never reboots for an unchanged DAC configuration.

## Update, reinstall, rollback, and restore

- Update propagates `--gpio-i2s-dac` only when the installed choice was enabled.
- Legacy installs without the choice never gain the overlay during update.
- Update/reinstall re-inspects ownership, preserves managed/pre-existing
  configuration, creates no duplicate block, and creates no second original
  backup.
- A same-session transaction is written only after a successful managed add.
- Installer failure rolls back only if the current whole-file checksum still
  matches that session's managed result.
- External post-write change makes rollback refuse rather than overwrite.
- Proven rollback restores the original byte-for-byte, removes session
  ownership, clears the session transaction, and cancels the DAC change.
- Fault fixtures cover failure before config rename, during backup rename, and
  after config rename/post-write validation.
- Restore never treats boot config as a whole managed file. It preserves the
  current block and its coherent feature record while restoring unrelated
  managed UI files.

## Uninstall

- Default uninstall preserves the managed block.
- A removal question is shown only for proven managed ownership and defaults to
  No.
- Noninteractive uninstall preserves unless `--remove-gpio-i2s-dac` is present.
- Pre-existing and managed-unowned states ignore removal and remain unchanged.
- Externally modified/malformed blocks are not removed.
- Explicit removal creates and verifies a pre-removal backup, removes only the
  exact three managed lines atomically, and preserves all other current boot
  content.
- Removal failure restores the managed file and ownership state.
- Successful removal drops the obsolete original ownership backup so a future
  opt-in can establish a fresh baseline; the pre-removal backup remains.
- Reboot is reported as required after actual removal and is never performed.

## Doctor

No doctor code changed.

The existing R2 read-only doctor already distinguishes GPIO/I²S DAC hardware
from HDMI. A boot section was not added because this step has no reliable
reboot-pending marker and the installer/manifest summaries already provide the
operational ownership state. The doctor continues to avoid sudo, mutation,
repair, playback, and raw device IDs.

## Documentation

The Linux installation guide now documents:

- both installer modes and flags;
- exact managed block and conservative ownership semantics;
- no ALSA/PipeWire/default-output mutation;
- verified PCM5102A-compatible wiring:
  VIN 2, GND 6, SCK 9/GND, BCK 12/GPIO18, LCK 35/GPIO19, DIN 40/GPIO21;
- power-off and module-voltage/regulator/jumper warnings;
- software-overlay-only scope;
- Bluetooth Audio exclusion;
- physical validation deferred to Step 2.15.3.

## Tests

Python parser/lifecycle suite: PASS, 12 tests.

Covered cases include:

- firmware and legacy paths, both paths, no config, empty file, symlink;
- overlay present/absent;
- LF, CRLF, no final newline;
- `[all]` present/absent and multiple sections;
- pre-existing whitespace and comments;
- duplicates, incomplete/double/out-of-order managed markers;
- managed ownership and managed-unowned preservation;
- conflict families plus video/GPIO non-conflicts;
- unmanaged byte preservation;
- backup, idempotency, mode/ownership, transaction cleanup;
- rollback refusal after external change;
- failure before/during/after atomic replacement;
- removal preserve, explicit removal, removal failure rollback, and future
  re-add.

Deployment contract suite is wired through the existing
`scripts/linux-verification.test.ts`; no new install-safe allowlist entry was
added.

## Isolated root staging

`GPIO/I2S ROOT STAGING — PASS`

Executed as WSL root against temporary roots only:

- firmware Standard dry-run and managed apply;
- legacy Appliance dry-run and managed apply;
- pre-existing;
- managed and managed-unowned;
- conflict;
- overlay unavailable;
- verified backup;
- mode and ownership preservation;
- update/reinstall-equivalent idempotency;
- same-session rollback;
- restore preservation;
- uninstall default preserve;
- uninstall explicit managed removal.

The historical full `test-staging.sh` could not complete locally because this
WSL distribution has no Linux Node executable. No package was installed.
Git Bash was rejected as a substitute because NTFS cannot prove POSIX modes.
The new fixture is called by the historical staging suite, so GitHub Linux CI,
where Node is already available, will execute the complete real installer,
update, restore, and uninstall path.

## Shell validation

- `bash -n` for every modified shell script: PASS.
- Python bytecode syntax validation: PASS.
- ShellCheck: NOT AVAILABLE locally; it was not installed.
- New staging script Git mode: `100755`.
- Existing executable modes remained unchanged.

## Windows real smoke

The real Neutralino/WebView2 app was started with exactly `npm.cmd run dev` and
the configured MPV executable at the 1280 × 800 target.

- First launch exposed a transient pre-existing MPV seek/bootstrap error.
- After clean shutdown of residual processes, the required fresh launch was
  stable.
- Neutralino/WebView2: PASS.
- Backend: PASS.
- MPV and FFmpeg discovery: PASS.
- Settings: PASS.
- Audio → Output with System default: PASS.
- Network status page: PASS; no network setting changed.
- Favorites: PASS; no Favorite changed.
- Queue: PASS; no row changed.
- Power surface: PASS; no device action invoked.
- Quit/window close and cleanup: PASS.
- No white flash, blank intermediate surface, layout shift, or shared-control
  regression was observed.

No media, Queue, network, audio-output preference, or application data was
modified.

## Security and regression firewall

- No SSH or remote audit.
- No Raspberry access, update, reinstall, boot edit, reboot, or physical test.
- No ALSA, PipeWire, WirePlumber, PulseAudio, mixer, volume, sink, MPV AO,
  package, backend, UI, shared-contract, workflow, Power, or Network change.
- No `dtparam=audio=off`, `.asoundrc`, `/etc/asound.conf`, alternative overlay,
  wildcard deletion, recursive config chmod/chown, direct config append, or
  automatic reboot.
- Package plan, package manifests, and lockfile are unchanged.

## Final gates

| Gate                                                                    | Result                           |
| ----------------------------------------------------------------------- | -------------------------------- |
| `npm.cmd run format:check`                                              | PASS                             |
| `npm.cmd run typecheck`                                                 | PASS                             |
| `npm.cmd run lint`                                                      | PASS                             |
| `npm.cmd run build`                                                     | PASS                             |
| `npm.cmd run build:linux`                                               | PASS                             |
| `npm.cmd test`                                                          | PASS — 502 pass, 10 skip         |
| `npm.cmd run test:posix`                                                | PASS — 3 pass, 2 platform skip   |
| `npm.cmd run verify:network:deployment`                                 | PASS                             |
| `npm.cmd run verify:linux:executables`                                  | PASS — 36 deployment files       |
| `npm.cmd run verify:linux:installer`                                    | PASS — 54 pass, 11 platform skip |
| `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build` | PASS                             |
| `npm.cmd run mpv:doctor`                                                | PASS                             |
| `npm.cmd run test:mpv`                                                  | PASS — 8 pass                    |
| `git diff --check`                                                      | PASS                             |

## Installer and package plan

- Standard installer: preserved plus optional GPIO/I²S choice.
- Appliance installer: preserved plus optional GPIO/I²S choice.
- Guided Installer redesign: not started.
- Dependencies: none added.
- APT packages: unchanged.
- `package.json` and `package-lock.json`: unchanged.
- CI workflows: unchanged.

## Files modified

- `deploy/linux/install-eidetic-player.sh`
- `deploy/linux/update-eidetic-player.sh`
- `deploy/linux/restore-system-ui.sh`
- `deploy/linux/uninstall-eidetic-player.sh`
- `deploy/linux/lib/gpio_i2s_dac.py`
- `deploy/linux/test_gpio_i2s_dac.py`
- `deploy/linux/test-gpio-i2s-dac-staging.sh`
- `deploy/linux/test-staging.sh`
- `deploy/linux/README.md`
- `docs/development/linux-debian.md`
- `scripts/linux-verification.test.ts`
- `scripts/verify-linux-executable-modes.mjs`
- `prompts/step2.15.2_output.md`

Temporary WSL fixture roots, Python caches, Windows screenshots, logs, and PID
files are removed during final cleanup.

## Raspberry status

`PCM5102A SYSTEM CONFIGURATION — PASS FROM R1`

`RASPBERRY INSTALLER GPIO/I2S VALIDATION — NOT TESTED`

`RASPBERRY REINSTALLATION — NOT TESTED`

`PHYSICAL PCM5102A AUDIO — PASS FROM R1`

`PHYSICAL HDMI AUDIO — NOT TESTED`

No SSH was opened and no Raspberry update was performed.

## Future Step 2.15.3 checklist

After explicit confirmation of a successful Raspberry update/reinstallation:

1. verify installed version;
2. verify the manual `i2s-dac` row is classified pre-existing;
3. verify no duplicate overlay or boot rewrite;
4. boot normally;
5. verify ALSA `sndrpirpidac`;
6. verify PipeWire sink and MPV device;
7. verify Audio Output Settings;
8. test physical PCM5102A and HDMI;
9. verify Network and Favorites without `Load failed`;
10. verify Power, touch, OSK, Queue, Library, SMB, and doctor;
11. verify update;
12. keep uninstall-preserve testing in staging unless separately authorized.

No commit or push was performed.
