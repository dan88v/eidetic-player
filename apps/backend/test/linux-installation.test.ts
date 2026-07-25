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
    "--borderless",
    "--disable-blanking",
    "--hide-pointer",
    "--splash",
    "--autologin",
    "--rpi-onscreen-keyboard",
  ])
    assert.match(source, new RegExp(flag));
  assert.match(source, /SHASUMS256\.txt/);
  assert.match(source, /sha256sum --check --strict/);
  assert.match(
    source,
    /"\$node_release\/bin\/npm" --prefix "\$build_source" ci/,
  );
  assert.match(
    source,
    /"\$node_release\/bin\/npm" --prefix "\$build_source" run "\$phase"/,
  );
  assert.doesNotMatch(source, /(?:full-upgrade|dist-upgrade|curl[^\\n]*\|)/);
});

void test("Linux build synchronizes and selects the correct Neutralino binary", async () => {
  const [packageJson, installer] = await Promise.all([
    read("package.json"),
    read("deploy/linux/install-eidetic-player.sh"),
  ]);

  void test("Linux release packages and launches the compiled backend entrypoint", async () => {
    const [installer, launcher] = await Promise.all([
      read("deploy/linux/install-eidetic-player.sh"),
      read("deploy/linux/runtime/eidetic-player-launch"),
    ]);

    assert.match(
      installer,
      /backend_entry_rel="apps\/backend\/src\/index\.js"/,
    );

    assert.match(installer, /package-lock\.json/);

    assert.match(installer, /--omit=dev/);

    assert.match(installer, /node_modules\/music-metadata/);

    assert.match(launcher, /backend\/apps\/backend\/src\/index\.js/);

    assert.doesNotMatch(launcher, /release\/backend\/index\.js/);

    assert.doesNotMatch(installer, /release_stage\/backend\/index\.js/);
  });

  assert.match(packageJson, /"neutralino:sync":\s*"neu update"/);
  assert.match(
    packageJson,
    /"build:linux":\s*"[^"]*npm run neutralino:sync[^"]*neu build --release"/,
  );

  assert.match(installer, /neutralino_arch=x64/);
  assert.match(installer, /neutralino_arch=arm64/);
  assert.match(installer, /eidetic-player-linux_\$\{neutralino_arch\}/);

  assert.doesNotMatch(
    installer,
    /find "\$build_source\/dist".*-name '\*linux\*'.*-perm \/111/,
  );
});

void test("Linux repository lifecycle runs as the non-root runtime identity", async () => {
  const [installer, common, update, fixture] = await Promise.all([
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/lib/common.sh"),
    read("deploy/linux/update-eidetic-player.sh"),
    read("deploy/linux/test-unprivileged-build.sh"),
  ]);

  assert.match(common, /runtime user must not be root/);
  assert.match(common, /runuser --user "\$user" --/);
  assert.match(common, /env -i --chdir="\$workspace"/);
  for (const variable of [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "XDG_RUNTIME_DIR",
    "npm_config_cache",
    "npm_config_userconfig",
  ])
    assert.match(common, new RegExp(`${variable}=`));
  assert.doesNotMatch(common, /(?:su -c|eval)/);
  assert.doesNotMatch(common, /^\s*sudo\s/m);

  assert.match(installer, /eidetic_prepare_build_workspace/);
  assert.match(installer, /eidetic_prepare_build_runtime/);
  assert.match(installer, /eidetic_validate_mpv_runtime_budget/);
  assert.match(installer, /Build phase \(runtime user UID/);
  assert.match(
    installer,
    /"\$node_release\/bin\/npm" --prefix "\$build_source" ci/,
  );
  assert.match(
    installer,
    /"\$node_release\/bin\/npm" --prefix "\$build_source" test/,
  );
  assert.match(
    installer,
    /"\$node_release\/bin\/npm" --prefix "\$build_source" run "\$phase"/,
  );
  assert.match(update, /install-eidetic-player\.sh" "\$\{args\[@\]\}"/);

  const lifecycle = installer.indexOf(
    "for phase in ci typecheck test build:linux",
  );
  const verification = installer.indexOf("backend artifact was not produced");
  const releaseStage = installer.indexOf('release_stage="$(mktemp');
  const activation = installer.indexOf("eidetic_activate_release");
  assert.ok(lifecycle >= 0 && lifecycle < verification);
  assert.ok(verification < releaseStage && releaseStage < activation);

  assert.match(fixture, /\[\[ "\$\(id -u\)" -ne 0 \]\]/);
  assert.match(fixture, /chmod 000 locked/);
  assert.match(fixture, /mode-000 directory was readable/);
  assert.match(fixture, /current_before=.*readlink/);
  assert.match(fixture, /previous_before=.*readlink/);
  assert.match(fixture, /failing lifecycle fixture unexpectedly succeeded/);
  assert.match(fixture, /\.incoming-/);
  assert.match(fixture, /literal_payload="; touch/);
  assert.match(
    fixture,
    /Runtime, socket, read-only checkout, isolated Git and transaction fixtures passed/,
  );
});

void test("Linux build uses a short private runtime and an isolated Git checkout", async () => {
  const [installer, common, fixture] = await Promise.all([
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/lib/common.sh"),
    read("deploy/linux/test-unprivileged-build.sh"),
  ]);
  assert.match(common, /mktemp -d -p "\$parent" 'ep-r\.XXXXXX'/);
  assert.match(common, /XDG_RUNTIME_DIR="\$runtime"/);
  assert.match(common, /TMPDIR="\$workspace\/\.tmp"/);
  assert.match(common, /representative=.*mpv-9999999999-/);
  assert.match(common, /\(\(bytes < 100\)\)/);
  assert.match(common, /GIT_TERMINAL_PROMPT=0/);
  assert.match(common, /GIT_CONFIG_GLOBAL=\/dev\/null/);
  assert.match(common, /GIT_CONFIG_NOSYSTEM=1/);
  assert.match(common, /git -C "\$source" init --quiet/);
  assert.match(common, /fetch --depth 1 --no-tags origin "\$ref"/);
  assert.match(common, /checkout --quiet --detach FETCH_HEAD/);
  assert.match(
    installer,
    /SOURCE_REMOTE=https:\/\/github\.com\/dan88v\/eidetic-player\.git/,
  );
  assert.doesNotMatch(
    installer,
    /git -C "\$SCRIPT_DIR\/\.\.\/\.\." (?:fetch|archive|checkout|reset|pull)/,
  );
  assert.match(installer, /eidetic_preflight_checkout/);
  assert.match(common, /source checkout directory is world-writable/);
  assert.match(common, /source checkout is not readable by the runtime user/);
  assert.doesNotMatch(common, /^\s*chmod(?: -R)? 777/m);
  assert.match(fixture, /checkout_snapshot/);
  assert.match(fixture, /FETCH_HEAD/);
  assert.match(fixture, /checkout Ü space/);
  assert.match(fixture, /remote Ü; literal\.git/);
  assert.match(fixture, /python3 - <<'PY'/);
});

void test("Raspberry Pi OS keyboard choice is explicit, reversible and staged", async () => {
  const [installer, common, update, restore, fixture] = await Promise.all([
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/lib/common.sh"),
    read("deploy/linux/update-eidetic-player.sh"),
    read("deploy/linux/restore-system-ui.sh"),
    read("deploy/linux/test-rpi-keyboard.sh"),
  ]);
  assert.match(installer, /rpi_keyboard=keep/);
  assert.match(
    installer,
    /Disable the Raspberry Pi OS on-screen keyboard and use Eidetic Player's keyboard instead\? \[y\/N\]/,
  );
  assert.match(installer, /Raspberry Pi OS on-screen keyboard: \$rpi_keyboard/);
  assert.match(installer, /EIDETIC_RPI_ONSCREEN_KEYBOARD=\$rpi_keyboard/);
  assert.match(common, /nonint get_squeekboard/);
  assert.match(common, /nonint do_squeekboard "\$option"/);
  assert.match(common, /always-on\) option=S1/);
  assert.match(common, /autodetect\) option=S2/);
  assert.match(common, /always-off\) option=S3/);
  assert.match(update, /EIDETIC_RPI_ONSCREEN_KEYBOARD:-keep/);
  assert.match(restore, /rpi-onscreen-keyboard-v1/);
  assert.match(restore, /eidetic_set_rpi_keyboard_state/);
  assert.match(fixture, /fixture-keyboard-fail/);
  assert.match(fixture, /install_disable/);
  assert.match(fixture, /restore-system-ui\.sh.*--dry-run/);
  assert.match(fixture, /uninstall-eidetic-player\.sh.*update_root/);
  assert.doesNotMatch(
    `${installer}\n${common}\n${restore}`,
    /(?:apt(?:-get)? remove|apt(?:-get)? purge|pkill squeekboard)/,
  );
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
