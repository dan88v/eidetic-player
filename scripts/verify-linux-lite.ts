import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/gu, "\n");
const lite = read("deploy/linux/install-eidetic-player.sh");
const desktop = read("deploy/linux/install-eidetic-player-desktop.sh");
const packages = read(
  "deploy/linux/manifests/raspios-lite-trixie-arm64.packages",
);
const graphical = read("deploy/linux/runtime/eidetic-player-graphical-launch");
const launcher = read("deploy/linux/runtime/eidetic-player-launch");
const session = read("deploy/linux/runtime/eidetic-player-session");
const sessionProfile = read(
  "deploy/linux/templates/eidetic-player-session-profile.sh",
);
const labwc = read("deploy/linux/templates/eidetic-labwc.service");
const labwcConfig = read("deploy/linux/templates/labwc-rc.xml");
const graphicalTarget = read(
  "deploy/linux/templates/eidetic-graphical-session.target",
);
const common = read("deploy/linux/lib/common.sh");
const ownership = read("deploy/linux/lib/machine_ownership.py");
const update = read("deploy/linux/update-eidetic-player.sh");
const uninstall = read("deploy/linux/uninstall-eidetic-player.sh");
const doctor = read("deploy/linux/doctor-installation.sh");

assert.match(lite, /EIDETIC_INSTALL_PROFILE=raspios-lite/u);
assert.match(desktop, /EIDETIC_INSTALL_PROFILE=desktop/u);
assert.match(
  lite,
  /Raspberry Pi OS Desktop detected\. Use install-eidetic-player-desktop\.sh\./u,
);
assert.match(
  desktop,
  /Raspberry Pi OS Lite detected\. Use install-eidetic-player\.sh\./u,
);
assert.match(lite, /apt-get update/u);
assert.doesNotMatch(lite, /(?:full-upgrade|dist-upgrade|apt-get autoremove)/u);
assert.match(lite, /--no-install-recommends/u);
assert.doesNotMatch(lite, /systemctl reboot|Restart the device now/u);
assert.doesNotMatch(lite, /lightdm|gdm3|plymouth-set-default-theme/u);
assert.match(
  lite,
  /EIDETIC_LITE_INTEGRATION_SCHEMA=\$lite_integration_schema/u,
);
assert.match(lite, /--application-update/u);
assert.match(lite, /machine_bootstrap_required=0/u);
assert.match(lite, /bootstrap skipped/u);
assert.match(lite, /eidetic_managed_transaction_init/u);
assert.match(lite, /eidetic_managed_transaction_rollback/u);
assert.match(common, /eidetic_managed_transaction_capture/u);
assert.match(common, /cp --preserve=mode,ownership,timestamps/u);
assert.doesNotMatch(graphical, /sleep [0-9]/u);
assert.match(graphical, /-type s/u);
assert.match(graphical, /wlr-randr/u);
assert.match(graphical, /timeout 2/u);
assert.match(launcher, /WebKitWebProcess/u);
assert.match(launcher, /524288/u);
assert.match(launcher, /EIDETIC_UI_RENDERER_OVER_LIMIT_SAMPLES:-3/u);
assert.match(launcher, /EIDETIC_UI_RENDERER_CHECK_SECONDS:-5/u);
assert.match(session, /runtime_dir="\/run\/user\/\$runtime_uid"/u);
assert.match(session, /export XDG_RUNTIME_DIR="\$runtime_dir"/u);
assert.match(
  session,
  /systemctl --user --wait start eidetic-graphical-session\.target/u,
);
assert.match(sessionProfile, /"\$\{USER:-\}" = "__EIDETIC_RUNTIME_USER__"/u);
assert.match(sessionProfile, /"\$\(tty/u);
assert.match(sessionProfile, /SSH_CONNECTION/u);
assert.match(
  labwc,
  /ExecStart=\/usr\/bin\/labwc --config-dir \/etc\/eidetic-player\/labwc/u,
);
assert.match(labwc, /StartLimitBurst=/u);
assert.match(
  graphicalTarget,
  /Requires=eidetic-labwc\.service eidetic-player\.service/u,
);
assert.match(labwcConfig, /<context name="Root" \/>/u);
assert.doesNotMatch(labwcConfig, /autostart|wallpaper|panel|idle/u);

assert.match(ownership, /MANAGED_PATHS = \(/u);
assert.match(ownership, /os\.replace\(temporary, target\)/u);
assert.match(ownership, /os\.fsync/u);
assert.match(ownership, /refusing symbolic link/u);
assert.match(ownership, /machine manifest contains a non-allowlisted path/u);
assert.match(ownership, /machine manifest must be root-owned/u);

assert.match(
  update,
  /raspios-lite\) installer_name=install-eidetic-player\.sh/u,
);
assert.match(
  update,
  /desktop\) installer_name=install-eidetic-player-desktop\.sh/u,
);
assert.match(
  update,
  /legacy installation profile cannot be proven; update refused/u,
);
assert.match(update, /--application-update/u);
assert.doesNotMatch(update, /installer_name=.*\|\|/u);
assert.match(
  uninstall,
  /machine_helper="\$SCRIPT_DIR\/lib\/machine_ownership\.py"/u,
);
assert.match(uninstall, /python3 "\$machine_helper" validate/u);
assert.match(uninstall, /eidetic-graphical-session\.target/u);
assert.doesNotMatch(uninstall, /apt(?:-get)? (?:remove|purge|autoremove)/u);
assert.match(doctor, /install-profile/u);
assert.match(doctor, /machine-manifest/u);
assert.match(doctor, /wayland-readiness/u);
assert.match(doctor, /getty-autologin/u);
assert.match(doctor, /renderingClass/u);
assert.doesNotMatch(
  lite,
  /systemctl (?:enable|start).*ssh|sshd_config|authorized_keys/u,
);

const denied = [
  "raspberrypi-ui-mods",
  "lxde",
  "lxde-core",
  "pcmanfm",
  "wf-panel-pi",
  "lightdm",
  "gdm3",
  "chromium",
];
const rows = packages
  .split("\n")
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("\t"));
assert.ok(rows.length > 30);
assert.ok(rows.every((row) => row.length === 7));
const names = rows.map((row) => row[1]);
assert.equal(new Set(names).size, names.length);
for (const name of denied)
  assert.ok(!names.includes(name), `${name} is denied`);
assert.ok(names.includes("labwc"));
assert.ok(names.includes("wlr-randr"));
assert.ok(names.includes("libwebkit2gtk-4.1-0"));
assert.ok(names.includes("pipewire"));
assert.ok(names.includes("wireplumber"));
assert.ok(names.includes("pipewire-alsa"));
assert.ok(!names.includes("pipewire-pulse"));

const normalized = desktop
  .replaceAll("install-eidetic-player-desktop.sh", "install-eidetic-player.sh")
  .replace(
    '# shellcheck source=lib/lite-install.sh\n. "$SCRIPT_DIR/lib/lite-install.sh"\n',
    "",
  )
  .replace(
    /eidetic_classify_raspios_host\ncase "\$EIDETIC_HOST_CLASS" in[\s\S]*?esac\n(?=checkout=)/u,
    "",
  )
  .replace(
    'eidetic_preflight_checkout \\\n+  "$runtime_user" "$checkout" "$preflight_world_write" \\\n+  "$checkout/deploy/linux/install-eidetic-player.sh"',
    'eidetic_preflight_checkout \\\n+  "$runtime_user" "$checkout" "$preflight_world_write"',
  )
  .replace("EIDETIC_INSTALL_PROFILE=desktop\n", "");
const normalizedHash = createHash("sha256").update(normalized).digest("hex");
assert.equal(
  normalizedHash,
  "54d736d275ca38470806deb27bd087958d058ca498daeedef9e13a776cb2b984",
  "Desktop installer changed beyond the filename/profile/classifier contract",
);

console.log("Lite static contract and Desktop golden equivalence passed.");
