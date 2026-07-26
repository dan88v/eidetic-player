# Step 2.14-R4 — READY FOR CI VALIDATION

## Result

Linux staging fixtures now model the Raspberry Pi boot cmdline explicitly,
verify its complete splash lifecycle, and add isolated Raspberry Pi OS and
Ubuntu all-yes tail-path coverage.

No production behavior was changed. All locally executable focused and full
gates pass, including the real Windows Neutralino/backend/MPV smoke. The full
Linux staging script was not run locally because Docker is unavailable and
WSL use is prohibited. CI PASS is not claimed before the next GitHub Actions
run.

## Baseline

- Branch: `main`.
- Initial working tree: clean.
- `HEAD...origin/main`: `0 0`.
- HEAD: `d1915ca5f0d81c6ac15c84db41467d10e08472dc`.
- Commit: `step 2.14 r3 CI Validation Fix`.
- R2 and R3 are present in history.
- Step 2.14.1 was not started.
- No merge or rebase was in progress.
- Installer and staging script Git modes: `100755`.

## Original CI failure and root cause

The R3 GitHub Actions run passed source checkout validation, executable modes,
installer contracts, install-safe tests, platform detection, staged-release
verification, and borderless normalization. It then reported:

```text
[verify:linux:release] PASS incoming release is not current before verification
Error: Raspberry Pi boot cmdline was not found
```

The Raspberry Pi OS fixture created OS, architecture, desktop, Device Tree,
and package markers, but did not create
`/boot/firmware/cmdline.txt` inside its temporary root.

The legacy Appliance migration intentionally retained `EIDETIC_SPLASH=1`.
The installer correctly entered the Raspberry splash branch, resolved:

```bash
cmdline="$(eidetic_target /boot/firmware/cmdline.txt)"
```

and retained the production check:

```bash
[[ -f "$cmdline" ]] ||
  eidetic_die "Raspberry Pi boot cmdline was not found"
```

The fixture filesystem was incomplete. Disabling splash or weakening the
installer check would have produced a false pass.

## Test RED

Before completing the fixture, a static staging/tail-path contract was added
and run against the unchanged fixture. The focused suite produced 13 passes
and one expected failure:

```text
AssertionError: missing staging contract: fixture_rpi_cmdline=
```

The real CI log above remains the authoritative Linux behavioral
reproduction. No remote, splash choice, `set -u`, production check, CI
workflow, or host filesystem was altered.

## Simulated Raspberry Pi cmdline

Raspberry Pi OS roots now receive a synthetic, single-line baseline:

```text
console=serial0,115200 console=tty1 root=PARTUUID=fixture rootfstype=ext4 fsck.repair=yes rootwait
```

The directory and file are created only below the temporary Raspberry root:

```text
$root/boot/firmware/cmdline.txt
```

Ubuntu roots do not receive this file. The identifier is deliberately
fictional and contains no user or machine data.

## Cmdline contract, idempotence, restore, and uninstall

The staging helper validates shell-token equality rather than substrings. It
asserts:

- the cmdline exists;
- it contains exactly one line;
- every original baseline token remains present exactly once;
- `quiet` appears exactly once;
- `splash` appears exactly once.

The existing legacy Appliance flow performs repeated splash-enabled updates.
Assertions after the first and subsequent updates prove that the two tokens
are not duplicated and no extra line is added.

The first restore compares the file byte-for-byte with a freshly generated
copy of the original baseline using `cmp`. The second restore performs the
same comparison and proves idempotence.

Both uninstall calls are followed by the same exact comparison. The
pre-existing simulated system file remains present and unchanged after
uninstall.

## Dedicated all-yes matrices

The existing Raspberry Pi OS, Ubuntu amd64, Ubuntu arm64, Standard, Appliance,
full-verify dry-run, update, rollback, restore, uninstall, R2 remote, and R3
environment-contamination fixtures remain present.

Two additional roots are separate from the lifecycle matrix.

### Raspberry Pi OS all yes

The fixture requests Appliance mode with autostart, fullscreen, borderless,
disable blanking, hide pointer, splash, and autologin all enabled; keyboard
remains `keep`.

It verifies:

- every corresponding `install.conf` value is `1`;
- user autostart desktop exists below the staged runtime home;
- display-policy autostart exists;
- LightDM configuration exists and names the runtime user;
- Plymouth theme, script, and generated `line.ppm` exist;
- cmdline retains all original tokens plus one `quiet` and one `splash`;
- `current` is a symlink to an existing staged release;
- a repeated update preserves the same all-yes contract and cmdline token
  counts;
- two restores and two uninstalls remain idempotent;
- cmdline is restored byte-for-byte and preserved.

### Ubuntu all yes

The Ubuntu fixture uses the same all-yes choices and verifies:

- every corresponding `install.conf` value is `1`;
- autostart and display-policy desktop files exist;
- GDM configuration contains `AutomaticLoginEnable=true`;
- GDM configuration names the actual runtime user;
- Plymouth theme, script, and generated `line.ppm` exist;
- `/etc/default/grub.d/90-eidetic-player.cfg` exists;
- no Raspberry cmdline is requested or created;
- `current` points to an existing staged release;
- update, two restores, and two uninstalls complete idempotently.

Every root lives below the suite's `mktemp` directory and is removed by the
existing final trap.

## Audit from splash through EOF

Operations were classified as follows.

### A — staging-safe through `eidetic_target` or managed install

- common configuration, service, desktop, runtime helper, SMB helper, and
  polkit installation;
- user autostart and display-policy directories/files below the staged runtime
  home;
- generated GDM or LightDM configuration;
- Plymouth theme, script, and generated line image;
- Raspberry cmdline update;
- Ubuntu GRUB fragment;
- manifest/backups used by restore;
- release activation under staged `/opt/eidetic-player`;
- staging completion logging.

### B — real-only behind `EIDETIC_ROOT == "/"`

- `plymouth-set-default-theme`;
- `update-initramfs`;
- `update-grub`;
- `groupadd`;
- `usermod`;
- real Network integration installation;
- `systemctl daemon-reload`;
- `loginctl enable-linger`;
- reboot prompt and `systemctl reboot`.

Restore keeps its Plymouth/initramfs/GRUB commands behind the same real-root
condition. Uninstall keeps user-service `systemctl stop` behind a real-root
condition.

Focused static assertions check the ordering of the splash, real splash
guard, Network guard, keyboard branch, and reboot guard. They also require
each host command to remain inside the appropriate guarded section.

### C — explicit fixture prerequisites

- Raspberry Pi OS platform markers;
- Raspberry `/boot/firmware/cmdline.txt`;
- the exact original cmdline used for restore comparison;
- all-yes runtime-home and tail-path assertions.

### D — not reached by these choices

- Raspberry keyboard mutation and `raspi-config`, because every new all-yes
  fixture explicitly uses keyboard `keep`;
- real apt/MPV installation and real build/fetch execution;
- real Plymouth activation, Network installation, service reload, linger, and
  reboot.

## Filesystem prerequisite inventory

Every staging-reachable prerequisite found across the installer and common
helpers was classified:

- source checkout `.git`, HEAD/config, `.nvmrc`, installer, common library,
  launcher, and Network installer: existing tracked checkout inputs validated
  by preflight;
- `/etc/os-release`, architecture, and desktop markers: created by every
  platform root;
- Raspberry Device Tree and Raspberry Pi OS package marker: created by
  Raspberry roots;
- `/etc/eidetic-player`: created by the fixture and installer staging path;
- runtime user UID, GID, and home: obtained from the existing test user;
- Node staging executable: created by the installer staging branch;
- releases and incoming directory: created by the installer;
- backend entrypoint, Neutralino executable/resources/configuration,
  `package.json`, lockfile, and `music-metadata`: synthesized by the existing
  staging artifact branch and verified before activation;
- launcher and administrative templates: existing tracked source files,
  installed through managed paths;
- GDM input: optional; installer generates a `[daemon]` baseline when absent;
- LightDM input: generated by the installer;
- Plymouth source theme/script: existing tracked inputs; `line.ppm` is
  generated;
- Ubuntu GRUB target directory: created by managed installation;
- Raspberry cmdline: now explicitly created only by Raspberry fixtures;
- `raspi-config`: required only for keyboard disable and not reached by the
  `keep` fixtures;
- validated staged release: constructed and verified before atomic
  activation.

No additional staging-reachable missing filesystem prerequisite was found by
the source audit. A real Linux execution is still required to confirm the
complete behavioral path.

## Tests

Focused checks:

- Bash syntax for staging, installer, restore, and uninstall: PASS using Git
  Bash;
- ShellCheck: **NOT AVAILABLE** and not installed;
- focused Linux/Neutralino tests: 20/20 PASS;
- executable-mode verifier: PASS, 33 tracked files;
- installer-safe verifier: PASS;
- install-safe suite: 62 total, 51 pass, 11 expected
  Windows/POSIX/Linux-staging skips;
- Network deployment verifier: PASS.

Final gates:

- `npm.cmd run format:check`: PASS;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS;
- `npm.cmd test`: 455 total, 447 pass, 8 expected platform skips;
- `npm.cmd run test:posix`: 5 total, 3 pass, 2 expected Windows skips;
- `npm.cmd run verify:network:deployment`: PASS;
- `npm.cmd run verify:linux:executables`: PASS;
- `npm.cmd run verify:linux:installer`: PASS;
- `npm.cmd run mpv:doctor`: PASS with real MPV, headless startup, and JSON
  IPC;
- `npm.cmd run test:mpv`: 8/8 PASS;
- `git diff --check`: PASS.

Docker is not available. Linux staging was **NOT RUN locally**; WSL was not
used. No Linux or Raspberry behavioral PASS is invented.

## Windows real smoke

The unchanged application was run with:

```text
EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe
npm.cmd run dev
```

Verified:

- backend on 4310;
- Vite on 5173;
- Neutralino/WebView2;
- real MPV available;
- `/health`: `status: ok`;
- `/api/readiness`: `status: ready`, `mpvAvailable: true`;
- a loaded track moved from paused to playing and back to paused;
- Neutralino exited with success code 0;
- backend received SIGTERM;
- no project Neutralino, backend, Vite, Node, MPV, or FFmpeg process remained;
- no listener remained on 4310 or 5173;
- no temporary smoke artifact remained.

## Files changed

- `deploy/linux/test-staging.sh`
- `apps/backend/test/linux-installation.test.ts`
- `prompts/step2.14_r4_staging_filesystem_output.md`

`deploy/linux/test-staging.sh` retains Git mode `100755`.

No production installer, common library, update, restore, uninstall, runtime,
CI, package, backend source, UI, MPV, Network, release verifier, or executable
verifier file was modified.

There is no CI/root/staging bypass, no host `/boot` write, and no reduction of
the existing staging matrix.

## Limits and status

- Linux staging: **NOT RUN locally**.
- Raspberry Pi: **NOT TESTED**.
- New GitHub Actions run: **NOT RUN**.
- CI PASS: **NOT CLAIMED**.
- No commit or push was performed.

**READY FOR CI VALIDATION**
