# Step 2.13.2-R1 — Raspberry Pi OS 64-bit detection

## Cause and correction

The installer treated modern Raspberry Pi OS as generic Debian because
`/etc/os-release` reports `ID=debian` and the old condition required the same
file to contain the literal text `Raspberry Pi`.

That branding check was removed. `ID=debian`, arm64 and Trixie are now accepted
as `raspios` only when:

- a supported Desktop is detected;
- a NUL-separated Device Tree entry begins exactly with `raspberrypi,`;
- at least one allowlisted Raspberry Pi OS marker is present.

Hardware detection checks `/proc/device-tree/compatible` first and
`/sys/firmware/devicetree/base/compatible` as fallback. It does not use
`/proc/cpuinfo`, a generic `brcm` match or the host Device Tree while `--root`
is active.

The marker allowlist is:

- `/etc/rpi-issue`;
- installed package `raspberrypi-ui-mods`;
- official `archive.raspberrypi.com`/`.org` repository in
  `/etc/apt/sources.list.d/raspi.list`.

`ID=raspbian` Trixie arm64 remains supported without requiring the Debian
hardware-plus-marker path.

## Diagnostics and compatibility

Platform detection now prints a sanitized summary with OS/version/codename,
architecture, Desktop, Raspberry Pi hardware yes/no, public compatible entry
and matched marker. Rejections distinguish unsupported release, unsupported
architecture, missing Raspberry Pi OS marker, missing Desktop and real WSL.

The summary does not include username, home, hostname, IP, MAC, hardware serial
or credentials. Doctor `--json` suppresses the human summary so its output
remains valid JSON.

Raspberry Pi 3B (`raspberrypi,3-model-b`) and 3B+
(`raspberrypi,3-model-b-plus`) are covered. Generic Debian remains rejected,
including Debian on non-Pi hardware with a copied marker and Debian on Pi
hardware without a Raspberry Pi OS marker. Headless/Lite, 32-bit and Bookworm
remain rejected. Ubuntu 26.04 Desktop amd64/arm64 is unchanged.

## Fixtures and dry-run

Added isolated fixtures for:

1. modern Raspberry Pi OS with `ID=debian`, Pi 3B Device Tree and package
   marker;
2. Pi 3B+ through the `/sys` Device Tree fallback;
3. `ID=raspbian`;
4. generic Debian arm64;
5. Pi hardware without an OS marker;
6. fake marker without Pi hardware;
7. headless Raspberry Pi OS;
8. 32-bit Raspberry Pi OS;
9. Ubuntu 26.04 amd64;
10. Ubuntu 26.04 arm64;
11. real WSL rejection;
12. staging root isolation from the host Device Tree.

The full staging deployment now installs twice using the modern
`ID=debian`/Pi 3B fixture. Its dry-run reaches:

```text
Target: raspios arm64
APT plan: ...
```

It performs no host package, service, network, boot, mount or administrative
filesystem modification.

The documented real-device check is:

```bash
runtime_user="${SUDO_USER:-$(id -un)}"
sudo ./deploy/linux/install-eidetic-player.sh \
  --user "$runtime_user" \
  --mode standard \
  --dry-run
```

Real Raspberry Pi execution is **NOT TESTED** in this environment and no
hardware PASS is claimed.

## Verification

- targeted platform fixtures: PASS;
- targeted deployment/static tests: PASS;
- full isolated staging, double install, update dry-run, rollback, doctor,
  double restore and double uninstall: PASS;
- `bash -n`: PASS;
- shellcheck: NOT AVAILABLE in the WSL distribution;
- Windows `npm.cmd run dev` smoke: backend, Vite and Neutralino started and
  clean shutdown passed;
- one pre-existing frontend bootstrap timeout warning was logged during the
  smoke; it did not prevent the required services/window from starting and was
  not changed outside this detection-only scope.

Final formatting, typecheck, full test suite and diff checks are recorded in
the final task summary.

## Files changed

- `deploy/linux/lib/common.sh`
- `deploy/linux/doctor-installation.sh`
- `deploy/linux/test-platform-detection.sh`
- `deploy/linux/test-staging.sh`
- `apps/backend/test/linux-installation.test.ts`
- `deploy/linux/README.md`
- `prompts/step2.13.2_rpi_os_detection_output.md`

No UI, Player, Library, package plan, Node build, service, Network/USB/SMB,
polkit, Plymouth or Maintenance behavior was modified. Step 2.13.4 was not
started. No commit or push was performed.
