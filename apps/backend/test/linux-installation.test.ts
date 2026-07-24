import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

void test("Linux installer is explicit, staging-safe and never upgrades the distribution", async () => {
  const source = await read("deploy/linux/install-eidetic-player.sh");
  for (const flag of [
    "--user",
    "--ref",
    "--mode",
    "--dry-run",
    "--unattended",
    "--root",
    "--autostart",
    "--fullscreen",
    "--disable-blanking",
    "--hide-pointer",
    "--splash",
    "--autologin",
  ])
    assert.match(source, new RegExp(flag));
  assert.match(source, /SHASUMS256\.txt/);
  assert.match(source, /sha256sum --check --strict/);
  assert.match(source, /npm ci/);
  assert.match(source, /npm run build:linux/);
  assert.doesNotMatch(source, /(?:full-upgrade|dist-upgrade|curl[^\\n]*\|)/);
});

void test("Raspberry Pi OS detection uses Device Tree plus narrow OS markers", async () => {
  const [common, fixtures] = await Promise.all([
    read("deploy/linux/lib/common.sh"),
    read("deploy/linux/test-platform-detection.sh"),
  ]);
  assert.match(common, /eidetic_detect_raspberry_pi_hardware/);
  assert.match(common, /\/proc\/device-tree\/compatible/);
  assert.match(common, /\/sys\/firmware\/devicetree\/base\/compatible/);
  assert.match(common, /tr '\\0' '\\n'/);
  assert.match(common, /raspberrypi,\*/);
  assert.match(common, /rpi-issue/);
  assert.match(common, /raspberrypi-ui-mods/);
  assert.match(common, /archive\\\.raspberrypi/);
  assert.doesNotMatch(common, /grep -qi 'Raspberry Pi' "\$os_release"/);
  assert.match(fixtures, /raspberrypi,3-model-b/);
  assert.match(fixtures, /raspberrypi,3-model-b-plus/);
  assert.match(fixtures, /staging root without Device Tree/);
});

void test("maintenance API has a fixed command and no frontend arguments", async () => {
  const [backend, client, settings] = await Promise.all([
    read("apps/backend/src/index.ts"),
    read("apps/ui/src/api/system-api-client.ts"),
    read("apps/ui/src/screens/settings.ts"),
  ]);
  assert.match(backend, /"\/usr\/local\/bin\/eidetic-player-maintenance"/);
  assert.match(client, /body: "\{\}"/);
  assert.match(settings, /showModal\(\)/);
  assert.match(settings, /systemCapabilities\.maintenanceMode/);
});

void test("SMB privilege is constrained to the Eidetic helper", async () => {
  const [adapter, helper, policy] = await Promise.all([
    read("apps/backend/src/smb/smb-platform-adapter.ts"),
    read("deploy/linux/runtime/eidetic-player-smb-helper"),
    read("deploy/linux/templates/eidetic-player-smb.polkit.rules"),
  ]);
  assert.match(adapter, /pkexec/);
  assert.match(helper, /ro\|nosuid\|nodev\|noexec/);
  assert.match(helper, /PKEXEC_UID/);
  assert.match(policy, /eidetic-player-smb-helper/);
  assert.doesNotMatch(policy, /\*/);
});

void test("restore, update, uninstall and doctor expose the required safe modes", async () => {
  const [restore, update, uninstall, doctor] = await Promise.all([
    read("deploy/linux/restore-system-ui.sh"),
    read("deploy/linux/update-eidetic-player.sh"),
    read("deploy/linux/uninstall-eidetic-player.sh"),
    read("deploy/linux/doctor-installation.sh"),
  ]);
  assert.match(restore, /--dry-run/);
  assert.match(restore, /--root/);
  assert.match(update, /--rollback/);
  assert.match(update, /--no-restart/);
  assert.match(uninstall, /--yes-really-purge-data/);
  assert.match(doctor, /--json/);
});
