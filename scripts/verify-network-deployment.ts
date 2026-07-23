import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { REQUIRED_NETWORK_MANAGER_ACTIONS } from "./doctor-network-linux.js";

const execFileAsync = promisify(execFile);
const deployment = resolve("deploy/linux/network");

export interface DeploymentVerification {
  readonly passed: readonly string[];
  readonly failed: readonly string[];
}

function requireMatch(
  passed: string[],
  failed: string[],
  label: string,
  condition: boolean,
): void {
  (condition ? passed : failed).push(label);
}

export async function verifyNetworkDeployment(): Promise<DeploymentVerification> {
  const [policy, dropIn, environment, installer, uninstaller] =
    await Promise.all([
      readFile(
        resolve(deployment, "eidetic-player-network.polkit.rules.template"),
        "utf8",
      ),
      readFile(
        resolve(deployment, "eidetic-player-backend-network.conf.example"),
        "utf8",
      ),
      readFile(
        resolve(deployment, "eidetic-player-network.env.example"),
        "utf8",
      ),
      readFile(resolve(deployment, "install-network-integration.sh"), "utf8"),
      readFile(resolve(deployment, "uninstall-network-integration.sh"), "utf8"),
    ]);
  const all = [policy, dropIn, environment, installer, uninstaller].join("\n");
  const passed: string[] = [];
  const failed: string[] = [];

  for (const action of REQUIRED_NETWORK_MANAGER_ACTIONS)
    requireMatch(
      passed,
      failed,
      `policy action ${action}`,
      policy.includes(`"${action}"`),
    );
  requireMatch(
    passed,
    failed,
    "no NetworkManager wildcard",
    !policy.includes("org.freedesktop.NetworkManager.*"),
  );
  requireMatch(
    passed,
    failed,
    "unit/group/no-new-privileges subject constraints",
    policy.includes(
      'subject.system_unit === "eidetic-player-backend.service"',
    ) &&
      policy.includes("subject.isInGroup") &&
      policy.includes("subject.no_new_privileges === true"),
  );
  requireMatch(
    passed,
    failed,
    "systemd soft ordering",
    dropIn.includes("After=dbus.service NetworkManager.service") &&
      dropIn.includes("Wants=NetworkManager.service") &&
      !dropIn.includes("network-online.target") &&
      !dropIn.includes("Requires=NetworkManager"),
  );
  requireMatch(
    passed,
    failed,
    "non-secret environment only",
    environment.includes("EIDETIC_NETWORK_GROUP=") &&
      environment.includes("EIDETIC_PLAYER_INSTALL_DIR=") &&
      !/(?:PASSWORD|PSK|SSID|WIFI_SECRET)=/i.test(environment),
  );
  for (const option of [
    "--user",
    "--group",
    "--install-dir",
    "--root",
    "--dry-run",
    "--help",
  ])
    requireMatch(
      passed,
      failed,
      `installer option ${option}`,
      installer.includes(option),
    );
  for (const option of ["--root", "--dry-run", "--help"])
    requireMatch(
      passed,
      failed,
      `uninstaller option ${option}`,
      uninstaller.includes(option),
    );
  requireMatch(
    passed,
    failed,
    "strict shell",
    [installer, uninstaller].every((script) =>
      script.includes("set -euo pipefail"),
    ),
  );
  requireMatch(
    passed,
    failed,
    "no elevated capabilities, sudoers, eval, or network profiles",
    !/CAP_NET_ADMIN|sudoers|\beval\b|system-connections|wpa_supplicant|dhcpcd\.conf|\/etc\/network\/interfaces/.test(
      all,
    ),
  );
  requireMatch(
    passed,
    failed,
    "installer does not restart services",
    !/\bsystemctl\s+(restart|start|enable)\b/.test(installer),
  );

  if (process.platform === "linux") {
    for (const name of [
      "install-network-integration.sh",
      "uninstall-network-integration.sh",
    ]) {
      try {
        await execFileAsync("bash", ["-n", resolve(deployment, name)], {
          timeout: 5_000,
        });
        passed.push(`bash -n ${name}`);
      } catch {
        failed.push(`bash -n ${name}`);
      }
    }
  }
  return { passed, failed };
}

async function main(): Promise<void> {
  const result = await verifyNetworkDeployment();
  for (const item of result.passed)
    console.log(`[verify:network:deployment] PASS ${item}`);
  for (const item of result.failed)
    console.error(`[verify:network:deployment] FAIL ${item}`);
  if (result.failed.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
