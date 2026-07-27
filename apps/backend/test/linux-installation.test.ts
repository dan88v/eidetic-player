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
    "--full-verify",
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

  const normalization = source.indexOf("borderless_value=$(");
  const dryRunExit = source.indexOf("if ((dry_run));");
  const realStagingSplit = source.indexOf(
    'if [[ "$EIDETIC_ROOT" == "/" ]]',
    source.indexOf("trap cleanup EXIT"),
  );
  assert.ok(normalization >= 0, "expected one normalized borderless value");
  assert.equal(
    source.split("borderless_value=$(").length - 1,
    1,
    "expected one borderless normalization",
  );
  assert.ok(normalization < dryRunExit);
  assert.ok(normalization < realStagingSplit);
  assert.ok(source.includes('EIDETIC_BORDERLESS="$borderless_value"'));
  assert.ok(source.includes("EIDETIC_BORDERLESS=$borderless_value"));
  assert.ok(!source.includes("EIDETIC_BORDERLESS=$EIDETIC_BORDERLESS"));
  assert.doesNotMatch(source, /\$\{EIDETIC_BORDERLESS:-[^}]*\}/);
});

void test("Linux staging covers Raspberry cmdline and guarded tail paths", async () => {
  const [installer, staging, restore, uninstall] = await Promise.all([
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/test-staging.sh"),
    read("deploy/linux/restore-system-ui.sh"),
    read("deploy/linux/uninstall-eidetic-player.sh"),
  ]);

  for (const contract of [
    "fixture_rpi_cmdline=",
    'install -d "$root/boot/firmware"',
    'assert_rpi_cmdline_augmented "$root"',
    'assert_rpi_cmdline_original "$root"',
    "cmp -s",
    "all_yes_fixture raspios-all-yes",
    "all_yes_fixture ubuntu-all-yes",
    '[[ ! -e "$root/boot/firmware/cmdline.txt" ]]',
    'assert_token_count "$file" quiet 1',
    'assert_token_count "$file" splash 1',
    "--disable-blanking yes --hide-pointer yes --splash yes --autologin yes",
    'shellcheck -x -P "$SCRIPT_DIR"',
  ])
    assert.ok(
      staging.includes(contract),
      `missing staging contract: ${contract}`,
    );

  assert.ok(
    staging.includes('write_legacy_conf "$root" appliance 1 1 1 1 1'),
    "legacy Appliance splash coverage must remain enabled",
  );
  assert.match(
    staging,
    /for \(field_number = 1; field_number <= NF; field_number \+= 1\)/,
  );
  assert.doesNotMatch(
    staging,
    /for \(index =/,
    "awk built-in function names must not be used as loop variables",
  );
  assert.ok(
    installer.includes(
      'cmdline="$(eidetic_target /boot/firmware/cmdline.txt)"',
    ),
  );
  assert.ok(
    installer.includes(
      '[[ -f "$cmdline" ]] || eidetic_die "Raspberry Pi boot cmdline was not found"',
    ),
  );

  const splash = installer.indexOf('if [[ "${choice[splash]}" == yes ]]');
  const splashRealOnly = installer.indexOf(
    'if [[ "$EIDETIC_ROOT" == "/" ]]',
    splash,
  );
  const networkRealOnly = installer.indexOf(
    'if [[ "$EIDETIC_ROOT" == "/" ]]',
    splashRealOnly + 1,
  );
  const keyboard = installer.indexOf(
    'if [[ "$rpi_keyboard" == disable ]]',
    networkRealOnly,
  );
  const rebootRealOnly = installer.indexOf(
    'if [[ "$EIDETIC_ROOT" == "/" ]]',
    keyboard,
  );
  assert.ok(
    splash >= 0 &&
      splash < splashRealOnly &&
      splashRealOnly < networkRealOnly &&
      networkRealOnly < keyboard &&
      keyboard < rebootRealOnly,
  );

  const guardedSplashCommands = installer.slice(
    splashRealOnly,
    networkRealOnly,
  );
  for (const command of [
    "plymouth-set-default-theme",
    "update-initramfs",
    "update-grub",
  ])
    assert.ok(guardedSplashCommands.includes(command));

  const guardedNetworkCommands = installer.slice(networkRealOnly, keyboard);
  for (const command of [
    "groupadd",
    "usermod",
    "install-network-integration.sh",
    "systemctl daemon-reload",
    "loginctl enable-linger",
  ])
    assert.ok(guardedNetworkCommands.includes(command));

  assert.ok(installer.slice(rebootRealOnly).includes("systemctl reboot"));

  const restoreRealOnly = restore.indexOf(
    'if (( ! dry_run )) && [[ "$EIDETIC_ROOT" == "/" ]]',
  );
  assert.ok(restoreRealOnly >= 0);
  for (const command of [
    "plymouth-set-default-theme",
    "update-initramfs",
    "update-grub",
  ])
    assert.ok(restore.slice(restoreRealOnly).includes(command));

  const uninstallRealOnly = uninstall.indexOf(
    'if [[ "$EIDETIC_ROOT" == "/" && -n "$runtime_user" ]]',
  );
  assert.ok(uninstallRealOnly >= 0);
  assert.ok(
    uninstall
      .slice(
        uninstallRealOnly,
        uninstall.indexOf("restore_args=()", uninstallRealOnly),
      )
      .includes("systemctl --user stop"),
  );
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
    "verification_phases=(ci typecheck verify:linux:installer)",
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
  const [installer, common, fixture, staging, workflow] = await Promise.all([
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/lib/common.sh"),
    read("deploy/linux/test-unprivileged-build.sh"),
    read("deploy/linux/test-staging.sh"),
    read(".github/workflows/ci.yml"),
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
    common,
    /EIDETIC_SOURCE_REMOTE=https:\/\/github\.com\/dan88v\/eidetic-player\.git/,
  );
  assert.match(installer, /SOURCE_REMOTE="\$EIDETIC_SOURCE_REMOTE"/);
  assert.doesNotMatch(
    installer,
    /git -C "\$SCRIPT_DIR\/\.\.\/\.\." (?:fetch|archive|checkout|reset|pull)/,
  );
  assert.match(installer, /eidetic_preflight_checkout/);
  assert.match(common, /eidetic_is_official_source_remote "\$origin"/);
  assert.match(
    common,
    /source checkout is not the official Eidetic Player repository/,
  );
  const validator =
    /eidetic_is_official_source_remote\(\)\s*\{([\s\S]*?)\n\}/.exec(common);
  const validatorBody = validator?.[1];
  assert.ok(validatorBody, "expected reusable official-source validator");
  assert.doesNotMatch(validatorBody, /\b(?:GITHUB_ACTIONS|CI|EIDETIC_ROOT)\b/);
  assert.doesNotMatch(`${workflow}\n${staging}`, /git\s+remote\s+set-url/);
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
    /Disable the Raspberry Pi OS on-screen keyboard and use Eidetic Player's keyboard instead\?/,
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
  const [backend, adapter, client, settings] = await Promise.all([
    read("apps/backend/src/index.ts"),
    read("apps/backend/src/system/linux-power-adapter.ts"),
    read("apps/ui/src/api/system-api-client.ts"),
    read("apps/ui/src/screens/settings.ts"),
  ]);
  assert.match(
    adapter,
    /maintenance: "\/usr\/local\/bin\/eidetic-player-maintenance"/,
  );
  assert.match(backend, /url\.pathname === "\/api\/system\/maintenance"/);
  assert.match(client, /body: "\{\}"/);
  assert.match(settings, /showModal\(\)/);
  assert.match(settings, /systemCapabilities\.maintenanceMode/);
});

void test("power integration is managed, exact-match and restore-safe", async () => {
  const [
    installer,
    helper,
    policy,
    restore,
    uninstall,
    doctor,
    staging,
    modes,
  ] = await Promise.all([
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/runtime/eidetic-player-power-helper"),
    read("deploy/linux/templates/eidetic-player-power.polkit.rules"),
    read("deploy/linux/restore-system-ui.sh"),
    read("deploy/linux/uninstall-eidetic-player.sh"),
    read("deploy/linux/doctor-installation.sh"),
    read("deploy/linux/test-staging.sh"),
    read("scripts/verify-linux-executable-modes.mjs"),
  ]);
  assert.match(installer, /polkitd pkexec/u);
  assert.match(installer, /\[\[ -x \/usr\/bin\/pkexec \]\]/u);
  assert.match(
    installer,
    /eidetic_install_managed "\$SCRIPT_DIR\/runtime\/eidetic-player-power-helper" \/usr\/libexec\/eidetic-player-power-helper 0755/u,
  );
  assert.match(
    installer,
    /eidetic_install_managed "\$power_policy" \/etc\/polkit-1\/rules\.d\/49-eidetic-player-power\.rules 0644/u,
  );
  assert.match(helper, /case "\$action" in[\s\S]*probe \| reboot \| shutdown/u);
  assert.match(policy, /org\.freedesktop\.policykit\.exec/u);
  assert.match(policy, /subject\.user !== "__EIDETIC_RUNTIME_USER__"/u);
  assert.match(policy, /subject\.active/u);
  assert.match(policy, /subject\.local/u);
  assert.doesNotMatch(policy, /isInGroup|\*/u);
  assert.match(restore, /preserved_records/u);
  assert.match(uninstall, /--include-power-integration/u);
  assert.match(doctor, /power-helper-mode/u);
  assert.match(doctor, /power-policy-rendered/u);
  assert.match(staging, /assert_power_installed/u);
  assert.match(staging, /destructive-power-action-attempted/u);
  assert.match(modes, /eidetic-player-power-helper/u);
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
  assert.match(
    helper,
    /share_pattern='\^\/\/\[A-Za-z0-9\._-\]\+\/\[A-Za-z0-9\._\$\[:space:\]-\]\+\$'/,
  );
  assert.match(helper, /"\$3" =~ \$share_pattern/);
  assert.doesNotMatch(
    helper,
    /"\$3" =~ \^/,
    "the SMB share regex must not expose $[ to Bash parsing",
  );
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

void test("guided updater pins Build IDs and separates hard health from soft MPV readiness", async () => {
  const [update, installer, doctor] = await Promise.all([
    read("deploy/linux/update-eidetic-player.sh"),
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/doctor-installation.sh"),
  ]);
  assert.match(update, /Already up to date\./);
  assert.match(update, /exit 64/);
  assert.match(update, /--unattended/);
  assert.match(update, /--resolved-commit "\$target_sha"/);
  assert.match(update, /wait_for_build "\$target_sha" 60 0/);
  assert.match(update, /wait_for_build "\$target_sha" 120 1/);
  assert.match(update, /wait_for_build "\$current_sha" 60 0/);
  assert.match(update, /previous release restored and verified/);
  assert.match(update, /runtime verification was intentionally skipped/);
  assert.doesNotMatch(update, /\b(?:reboot|shutdown|poweroff)\b.*(?:-f|now)/);
  assert.match(installer, /build-info\.json/);
  assert.match(installer, /NODE_ENV=production/);
  assert.match(doctor, /Build provenance/);
  assert.match(doctor, /API coherence/);
});

void test("installer writes a shared MPV path for all install modes", async () => {
  const installer = await read("deploy/linux/install-eidetic-player.sh");
  assert.ok(
    installer.includes('backend_host="${BACKEND_HOST:-127.0.0.1}"'),
    "expected backend host default contract in installer",
  );
  assert.ok(
    installer.includes('backend_port="${BACKEND_PORT:-4310}"'),
    "expected backend port default contract in installer",
  );
  assert.ok(
    installer.includes("BACKEND_HOST=$backend_host"),
    "expected install.conf BACKEND_HOST write",
  );
  assert.ok(
    installer.includes("BACKEND_PORT=$backend_port"),
    "expected install.conf BACKEND_PORT write",
  );
  assert.ok(
    !installer.includes("BACKEND_HOST=localhost"),
    "unexpected BACKEND_HOST default in installer",
  );
  assert.match(installer, /EIDETIC_MPV_PATH=\/usr\/bin\/mpv/);
  assert.match(
    installer,
    /PATH=\/opt\/eidetic-player\/node\/current\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin/,
  );
});

void test("launcher waits on backend readiness endpoint with bounded attempts", async () => {
  const launcher = await read("deploy/linux/runtime/eidetic-player-launch");
  assert.ok(
    launcher.includes('backend_host="${BACKEND_HOST:-127.0.0.1}"'),
    "expected BACKEND_HOST contract in launcher",
  );
  assert.ok(
    launcher.includes('backend_port="${BACKEND_PORT:-4310}"'),
    "expected BACKEND_PORT contract in launcher",
  );
  assert.ok(
    launcher.includes(
      'readiness_endpoint="http://${backend_host}:${backend_port}/api/readiness"',
    ),
    "expected readiness endpoint contract in launcher",
  );
  assert.doesNotMatch(launcher, /43789/);
  assert.match(
    launcher,
    /readiness_timeout_ms="\$\{EIDETIC_READINESS_TIMEOUT_MS:-30000\}"/,
  );
  assert.match(launcher, /readiness_poll_ms=250/);
  assert.match(
    launcher,
    /max_readiness_attempts=\$\(\(readiness_timeout_ms \/ readiness_poll_ms\)\)/,
  );
  assert.match(
    launcher,
    /for attempt in \$\(seq 1 "\$max_readiness_attempts"\)/,
  );
  assert.match(launcher, /if \[\[ "\$readiness_code" == "200" \]\]/);
  assert.match(launcher, /if ! kill -0 "\$backend_pid"/);
  assert.doesNotMatch(launcher, /\/api\/health/);
  assert.match(
    launcher,
    /Backend readiness was not reachable at %s:%s within %d ms/,
  );
  assert.match(launcher, /backend process ended during readiness check/);
});

void test("system service and desktop path flow through launcher and single backend entrypoint", async () => {
  const [service, launcher, desktop] = await Promise.all([
    read("deploy/linux/templates/eidetic-player.service"),
    read("deploy/linux/runtime/eidetic-player-launch"),
    read("deploy/linux/templates/eidetic-player.desktop"),
  ]);
  assert.match(service, /EnvironmentFile=\/etc\/eidetic-player\/install.conf/);
  assert.match(
    service,
    /ExecStart=\/opt\/eidetic-player\/current\/bin\/eidetic-player-launch/,
  );
  assert.match(
    launcher,
    /backend_entry="\$release\/backend\/apps\/backend\/src\/index\.js"/,
  );
  assert.match(launcher, /"\$release\/eidetic-player" &/);
  assert.match(desktop, /Exec=\/usr\/local\/bin\/eidetic-player/);
});
