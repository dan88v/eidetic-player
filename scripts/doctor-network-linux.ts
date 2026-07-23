import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { pendingNetworkTransactionPath } from "../apps/backend/src/network/network-transaction-repository.js";
import { resolveAppDirectories } from "../apps/backend/src/platform/app-directories.js";

const execFileAsync = promisify(execFile);

export const REQUIRED_NETWORK_MANAGER_ACTIONS = [
  "org.freedesktop.NetworkManager.network-control",
  "org.freedesktop.NetworkManager.enable-disable-wifi",
  "org.freedesktop.NetworkManager.settings.modify.system",
] as const;

export type DoctorState = "pass" | "warn" | "fail" | "info";

export interface DoctorCheck {
  readonly id: string;
  readonly state: DoctorState;
  readonly detail: string;
}

interface CommandResult {
  readonly ok: boolean;
  readonly output: string;
}

export interface NetworkDoctorProbe {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly nodeVersion: string;
  read(path: string): Promise<string | null>;
  file(path: string): Promise<boolean>;
  metadata(path: string): Promise<{ mode: number; uid: number } | null>;
  command(
    command: string,
    arguments_?: readonly string[],
  ): Promise<CommandResult>;
}

export function isWslVersion(version: string | null): boolean {
  return /microsoft|wsl/i.test(version ?? "");
}

export function parseNmcliPermissions(
  output: string,
): ReadonlyMap<string, string> {
  const permissions = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.lastIndexOf(":");
    if (separator <= 0) continue;
    permissions.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return permissions;
}

export function parseAdapterKinds(output: string): {
  readonly wifi: boolean;
  readonly wired: boolean;
} {
  const types = output
    .split(/\r?\n/)
    .map((line) => line.split(":")[0]?.toLowerCase());
  return {
    wifi: types.includes("wifi"),
    wired: types.includes("ethernet"),
  };
}

function check(id: string, state: DoctorState, detail: string): DoctorCheck {
  return { id, state, detail };
}

async function installedFile(
  probe: NetworkDoctorProbe,
  id: string,
  path: string,
  absentState: DoctorState,
): Promise<DoctorCheck> {
  return (await probe.file(path))
    ? check(id, "pass", "installed")
    : check(id, absentState, "not installed");
}

export async function inspectNetworkDeployment(
  probe: NetworkDoctorProbe,
): Promise<readonly DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  if (probe.platform !== "linux") {
    return [
      check("platform", "fail", `${probe.platform}; Linux is required`),
      check("node", "info", `${probe.nodeVersion} (${probe.arch})`),
    ];
  }

  const version = await probe.read("/proc/version");
  const wsl = isWslVersion(version);
  const missingRuntime: DoctorState = wsl ? "warn" : "fail";
  checks.push(
    check("platform", "pass", `linux ${probe.arch}`),
    check("node", "pass", probe.nodeVersion),
    check("environment", wsl ? "warn" : "info", wsl ? "WSL" : "native/VM"),
  );

  const pidOne = await probe.command("ps", ["-p", "1", "-o", "comm="]);
  checks.push(
    check(
      "systemd",
      pidOne.ok && pidOne.output.trim() === "systemd" ? "pass" : missingRuntime,
      pidOne.ok && pidOne.output.trim() === "systemd" ? "PID 1" : "not PID 1",
    ),
  );

  const dbusSocket = await probe.file("/run/dbus/system_bus_socket");
  const dbus = await probe.command("busctl", [
    "--system",
    "--no-pager",
    "status",
  ]);
  checks.push(
    check(
      "system-dbus",
      dbusSocket && dbus.ok ? "pass" : missingRuntime,
      dbusSocket && dbus.ok ? "available" : "unavailable",
    ),
  );

  const nmcli = await probe.command("nmcli", ["--version"]);
  checks.push(
    check(
      "nmcli",
      nmcli.ok ? "pass" : missingRuntime,
      nmcli.ok
        ? (nmcli.output.split(/\r?\n/)[0] ?? "available")
        : "not available",
    ),
  );
  const networkManager = await probe.command("systemctl", [
    "is-active",
    "NetworkManager.service",
  ]);
  const networkManagerInstalled = await probe.command("systemctl", [
    "cat",
    "NetworkManager.service",
  ]);
  checks.push(
    check(
      "network-manager",
      networkManager.ok
        ? "pass"
        : networkManagerInstalled.ok
          ? "warn"
          : missingRuntime,
      networkManager.ok
        ? "running"
        : networkManagerInstalled.ok
          ? "installed but not running"
          : "not detected",
    ),
  );

  const polkit = await probe.command("pkaction", ["--version"]);
  checks.push(
    check(
      "polkit",
      polkit.ok ? "pass" : missingRuntime,
      polkit.ok ? "available" : "not available",
    ),
  );
  for (const action of REQUIRED_NETWORK_MANAGER_ACTIONS) {
    const result = await probe.command("pkaction", [
      "--action-id",
      action,
      "--verbose",
    ]);
    checks.push(
      check(
        `action:${action}`,
        result.ok ? "pass" : missingRuntime,
        result.ok ? "registered" : "not registered",
      ),
    );
  }

  checks.push(
    await installedFile(
      probe,
      "polkit-policy",
      "/etc/polkit-1/rules.d/49-eidetic-player-network.rules",
      "warn",
    ),
    await installedFile(
      probe,
      "backend-service",
      "/etc/systemd/system/eidetic-player-backend.service",
      "warn",
    ),
    await installedFile(
      probe,
      "backend-drop-in",
      "/etc/systemd/system/eidetic-player-backend.service.d/20-network.conf",
      "warn",
    ),
  );

  const environment =
    (await probe.read("/etc/eidetic-player/eidetic-player-network.env")) ?? "";
  const group =
    /^EIDETIC_NETWORK_GROUP=([a-z_][a-z0-9_-]{0,31})$/m.exec(
      environment,
    )?.[1] ?? null;
  const groupLookup = group
    ? await probe.command("getent", ["group", group])
    : { ok: false, output: "" };
  const memberships = await probe.command("id", ["-nG"]);
  checks.push(
    check(
      "network-group",
      group && groupLookup.ok ? "pass" : "warn",
      group && groupLookup.ok ? `${group} exists` : "not configured",
    ),
    check(
      "runtime-membership",
      group && memberships.output.split(/\s+/).includes(group)
        ? "pass"
        : "warn",
      group && memberships.output.split(/\s+/).includes(group)
        ? "current user is a member"
        : "current user is not an authorized member",
    ),
  );

  const directories = resolveAppDirectories();
  const configMetadata = await probe.metadata(directories.config);
  checks.push(
    check(
      "app-config-directory",
      !configMetadata || (configMetadata.mode & 0o077) === 0 ? "pass" : "warn",
      !configMetadata
        ? "not created yet"
        : `mode ${configMetadata.mode.toString(8).padStart(4, "0")}`,
    ),
  );
  const pendingPath = pendingNetworkTransactionPath();
  const pendingMetadata = await probe.metadata(pendingPath);
  const expectedUid = userInfo().uid;
  checks.push(
    check(
      "pending-ipv4-transaction",
      !pendingMetadata ||
        ((pendingMetadata.mode & 0o077) === 0 &&
          pendingMetadata.uid === expectedUid)
        ? "pass"
        : "fail",
      !pendingMetadata
        ? "absent"
        : `present; mode ${pendingMetadata.mode
            .toString(8)
            .padStart(4, "0")}; runtime ownership ${
            pendingMetadata.uid === expectedUid ? "matches" : "mismatch"
          }`,
    ),
  );

  const devices = nmcli.ok
    ? await probe.command("nmcli", [
        "-t",
        "-f",
        "TYPE,STATE",
        "device",
        "status",
      ])
    : { ok: false, output: "" };
  const adapters = parseAdapterKinds(devices.output);
  checks.push(
    check(
      "adapters",
      adapters.wifi || adapters.wired ? "pass" : "warn",
      adapters.wifi && adapters.wired
        ? "Wi-Fi and Wired"
        : adapters.wifi
          ? "Wi-Fi only"
          : adapters.wired
            ? "Wired only (valid)"
            : "none detected",
    ),
  );

  const permissionsResult = nmcli.ok
    ? await probe.command("nmcli", [
        "-t",
        "-f",
        "PERMISSION,VALUE",
        "general",
        "permissions",
      ])
    : { ok: false, output: "" };
  const permissions = parseNmcliPermissions(permissionsResult.output);
  const allowed = REQUIRED_NETWORK_MANAGER_ACTIONS.filter(
    (action) => permissions.get(action) === "yes",
  );
  const interactive = REQUIRED_NETWORK_MANAGER_ACTIONS.filter(
    (action) => permissions.get(action) === "auth",
  );
  checks.push(
    check(
      "network-service-capabilities",
      allowed.length === REQUIRED_NETWORK_MANAGER_ACTIONS.length
        ? "pass"
        : "warn",
      `${String(allowed.length)}/${String(
        REQUIRED_NETWORK_MANAGER_ACTIONS.length,
      )} non-interactive permissions granted; ${String(
        interactive.length,
      )} require authorization`,
    ),
  );

  const regulatory = await probe.command("iw", ["reg", "get"]);
  const country = /\bcountry\s+([A-Z0-9]{2}):/i.exec(regulatory.output)?.[1];
  checks.push(
    check(
      "regulatory-domain",
      "info",
      regulatory.ok
        ? (country?.toUpperCase() ?? "unknown/unset")
        : "iw not available",
    ),
  );
  return checks;
}

function createSystemProbe(): NetworkDoctorProbe {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    async read(path) {
      return readFile(path, "utf8").catch(() => null);
    },
    async file(path) {
      return access(path)
        .then(() => true)
        .catch(() => false);
    },
    async metadata(path) {
      return stat(path)
        .then((value) => ({ mode: value.mode & 0o777, uid: value.uid }))
        .catch(() => null);
    },
    async command(command, arguments_ = []) {
      try {
        const result = await execFileAsync(command, [...arguments_], {
          timeout: 5_000,
          maxBuffer: 256 * 1024,
          windowsHide: true,
        });
        return {
          ok: true,
          output: `${result.stdout}${result.stderr}`.trim(),
        };
      } catch (error) {
        const result = error as { stdout?: string; stderr?: string };
        return {
          ok: false,
          output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
        };
      }
    },
  };
}

async function main(): Promise<void> {
  const checks = await inspectNetworkDeployment(createSystemProbe());
  const json = process.argv.includes("--json");
  if (json) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    for (const item of checks)
      console.log(
        `[doctor:network:linux] ${item.state.toUpperCase()} ${item.id}: ${item.detail}`,
      );
  }
  if (checks.some((item) => item.state === "fail")) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
