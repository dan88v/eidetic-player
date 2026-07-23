import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  inspectNetworkDeployment,
  isWslVersion,
  parseAdapterKinds,
  parseNmcliPermissions,
  type NetworkDoctorProbe,
} from "../../../scripts/doctor-network-linux.js";
import { verifyNetworkDeployment } from "../../../scripts/verify-network-deployment.js";

const execFileAsync = promisify(execFile);

function fakeProbe(
  overrides: Partial<NetworkDoctorProbe> = {},
): NetworkDoctorProbe {
  return {
    platform: "linux",
    arch: "x64",
    nodeVersion: "v24.18.0",
    read(path) {
      return Promise.resolve(path === "/proc/version" ? "Linux fixture" : null);
    },
    file() {
      return Promise.resolve(false);
    },
    metadata() {
      return Promise.resolve(null);
    },
    command(command, arguments_ = []) {
      if (command === "ps")
        return Promise.resolve({ ok: true, output: "systemd" });
      if (command === "nmcli" && arguments_[0] === "--version")
        return Promise.resolve({
          ok: true,
          output: "nmcli tool, version fixture",
        });
      if (command === "nmcli" && arguments_.includes("device"))
        return Promise.resolve({ ok: true, output: "ethernet:connected" });
      if (command === "nmcli" && arguments_.includes("permissions"))
        return Promise.resolve({
          ok: true,
          output:
            "org.freedesktop.NetworkManager.network-control:yes\n" +
            "org.freedesktop.NetworkManager.enable-disable-wifi:yes\n" +
            "org.freedesktop.NetworkManager.settings.modify.system:yes",
        });
      if (command === "pkaction")
        return Promise.resolve({ ok: true, output: "fixture" });
      if (command === "systemctl" && arguments_[0] === "is-active")
        return Promise.resolve({ ok: true, output: "active" });
      if (command === "busctl")
        return Promise.resolve({ ok: true, output: "fixture" });
      if (command === "iw")
        return Promise.resolve({
          ok: true,
          output: "country 00: DFS-UNSET",
        });
      return Promise.resolve({ ok: false, output: "" });
    },
    ...overrides,
  };
}

void test("deployment policy and scripts preserve the minimal security surface", async () => {
  const result = await verifyNetworkDeployment();
  assert.deepEqual(result.failed, []);
});

void test("doctor parsers classify permissions, Wired-only, and WSL", () => {
  assert.equal(isWslVersion("Linux microsoft-standard-WSL2"), true);
  assert.equal(isWslVersion("Linux raspberrypi"), false);
  assert.deepEqual(parseAdapterKinds("ethernet:connected"), {
    wifi: false,
    wired: true,
  });
  assert.equal(
    parseNmcliPermissions(
      "org.freedesktop.NetworkManager.network-control:yes",
    ).get("org.freedesktop.NetworkManager.network-control"),
    "yes",
  );
});

void test("doctor reports complete fixture capabilities without exposing network names", async () => {
  const checks = await inspectNetworkDeployment(
    fakeProbe({
      file(path) {
        return Promise.resolve(path === "/run/dbus/system_bus_socket");
      },
    }),
  );
  assert.equal(
    checks.find((item) => item.id === "adapters")?.detail,
    "Wired only (valid)",
  );
  assert.equal(
    checks.find((item) => item.id === "network-service-capabilities")?.state,
    "pass",
  );
  assert.equal(JSON.stringify(checks).includes("fixture-ssid"), false);
});

void test("doctor distinguishes missing nmcli, polkit, NetworkManager, and WSL", async () => {
  const missing = await inspectNetworkDeployment(
    fakeProbe({
      command() {
        return Promise.resolve({ ok: false, output: "" });
      },
    }),
  );
  assert.equal(missing.find((item) => item.id === "nmcli")?.state, "fail");
  assert.equal(missing.find((item) => item.id === "polkit")?.state, "fail");
  assert.equal(
    missing.find((item) => item.id === "network-manager")?.state,
    "fail",
  );

  const wsl = await inspectNetworkDeployment(
    fakeProbe({
      read(path) {
        return Promise.resolve(
          path === "/proc/version" ? "Linux microsoft-standard-WSL2" : null,
        );
      },
      command() {
        return Promise.resolve({ ok: false, output: "" });
      },
    }),
  );
  assert.equal(wsl.find((item) => item.id === "environment")?.state, "warn");
  assert.equal(
    wsl.some((item) => item.state === "fail"),
    false,
  );
});

void test(
  "installer staging and uninstaller are idempotent with Unicode paths",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "eidetic rete ü "));
    const outside = await mkdtemp(resolve(tmpdir(), "eidetic outside "));
    const installer = resolve(
      "deploy/linux/network/install-network-integration.sh",
    );
    const uninstaller = resolve(
      "deploy/linux/network/uninstall-network-integration.sh",
    );
    const installArguments = [
      installer,
      "--user",
      "fixture_user",
      "--group",
      "fixture_network",
      "--install-dir",
      "/opt/Eidetic Player ü",
      "--root",
      root,
    ];
    try {
      await execFileAsync("bash", [
        installer,
        "--user",
        "dry_fixture",
        "--group",
        "dry_network",
        "--install-dir",
        "/opt/Dry Run",
        "--dry-run",
      ]);
      await assert.rejects(
        execFileAsync("bash", [
          installer,
          "--user",
          "../invalid",
          "--group",
          "fixture_network",
          "--install-dir",
          "/opt/eidetic",
          "--root",
          root,
        ]),
      );
      await mkdir(resolve(root, "etc"), { recursive: true });
      await symlink(outside, resolve(root, "etc/polkit-1"));
      await assert.rejects(execFileAsync("bash", installArguments));
      await unlink(resolve(root, "etc/polkit-1"));

      await execFileAsync("bash", installArguments);
      await execFileAsync("bash", installArguments);

      const policy = resolve(
        root,
        "etc/polkit-1/rules.d/49-eidetic-player-network.rules",
      );
      const dropIn = resolve(
        root,
        "etc/systemd/system/eidetic-player-backend.service.d/20-network.conf",
      );
      const environment = resolve(
        root,
        "etc/eidetic-player/eidetic-player-network.env",
      );
      assert.equal((await stat(policy)).mode & 0o777, 0o644);
      assert.equal((await stat(dropIn)).mode & 0o777, 0o644);
      assert.equal((await stat(environment)).mode & 0o777, 0o640);
      assert.match(
        await readFile(environment, "utf8"),
        /EIDETIC_PLAYER_INSTALL_DIR="\/opt\/Eidetic Player ü"/,
      );

      await execFileAsync("bash", [uninstaller, "--root", root]);
      await execFileAsync("bash", [uninstaller, "--root", root]);
      await assert.rejects(stat(policy));
      await assert.rejects(stat(dropIn));
      await assert.rejects(stat(environment));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  },
);
