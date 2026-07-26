import { constants, accessSync } from "node:fs";
import {
  execFile as nodeExecFile,
  spawn as nodeSpawn,
  type ChildProcess,
} from "node:child_process";
import type { SystemPowerAction } from "../../../../packages/shared/src/system.js";
import {
  PowerActionError,
  type HostPowerActionAdapter,
} from "./power-action-coordinator.js";

export const linuxPowerPaths = {
  pkexec: "/usr/bin/pkexec",
  helper: "/usr/libexec/eidetic-player-power-helper",
  policy: "/etc/polkit-1/rules.d/49-eidetic-player-power.rules",
  systemctl: "/usr/bin/systemctl",
  maintenance: "/usr/local/bin/eidetic-player-maintenance",
} as const;

export const POWER_ACTION_DELAY_MS = 200;
export const POWER_PREFLIGHT_TIMEOUT_MS = 2_000;

export interface PowerIntegrationProbe {
  executable(path: string): boolean;
  readable(path: string): boolean;
}

export interface PowerExecResult {
  readonly stdout: string;
}

export type PowerExecFile = (
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly shell: false;
    readonly timeout: number;
    readonly windowsHide: true;
  },
) => Promise<PowerExecResult>;

export type PowerSpawn = (
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly detached: true;
    readonly shell: false;
    readonly stdio: "ignore";
  },
) => Pick<ChildProcess, "once" | "unref">;

export interface ScheduledPowerAction {
  unref(): void;
}

export type PowerScheduler = (
  callback: () => void,
  delayMilliseconds: number,
) => ScheduledPowerAction;

export interface LinuxPowerAdapterOptions {
  readonly execFile?: PowerExecFile;
  readonly spawn?: PowerSpawn;
  readonly schedule?: PowerScheduler;
  readonly stopBackend?: () => void;
  readonly log?: (message: string) => void;
  readonly executeHostActions?: boolean;
}

export function createFilesystemPowerProbe(): PowerIntegrationProbe {
  const canAccess = (path: string, mode: number): boolean => {
    try {
      accessSync(path, mode);
      return true;
    } catch {
      return false;
    }
  };
  return {
    executable: (path) => canAccess(path, constants.X_OK),
    readable: (path) => canAccess(path, constants.R_OK),
  };
}

export function detectAvailablePowerActions(
  installationMode: "development" | "standard" | "appliance",
  platform: NodeJS.Platform,
  probe: PowerIntegrationProbe = createFilesystemPowerProbe(),
): readonly SystemPowerAction[] {
  if (platform !== "linux")
    return installationMode === "appliance" ? ["maintenance"] : ["quit"];
  if (installationMode === "development") return ["quit"];

  const powerIntegrationAvailable =
    probe.executable(linuxPowerPaths.pkexec) &&
    probe.executable(linuxPowerPaths.helper) &&
    probe.readable(linuxPowerPaths.policy);

  if (installationMode === "standard")
    return powerIntegrationAvailable
      ? ["quit", "reboot", "shutdown"]
      : ["quit"];

  const actions: SystemPowerAction[] = [];
  if (probe.executable(linuxPowerPaths.systemctl)) actions.push("restart-app");
  actions.push("maintenance");
  if (powerIntegrationAvailable) actions.push("reboot", "shutdown");
  return actions;
}

function defaultExecFile(
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly shell: false;
    readonly timeout: number;
    readonly windowsHide: true;
  },
): Promise<PowerExecResult> {
  return new Promise((resolve, reject) => {
    nodeExecFile(
      executable,
      [...arguments_],
      {
        encoding: "utf8",
        shell: options.shell,
        timeout: options.timeout,
        windowsHide: options.windowsHide,
      },
      (error, stdout) => {
        if (error)
          reject(error instanceof Error ? error : new Error("execFile failed"));
        else resolve({ stdout });
      },
    );
  });
}

function defaultSpawn(
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly detached: true;
    readonly shell: false;
    readonly stdio: "ignore";
  },
): Pick<ChildProcess, "once" | "unref"> {
  return nodeSpawn(executable, [...arguments_], options);
}

function defaultSchedule(
  callback: () => void,
  delayMilliseconds: number,
): ScheduledPowerAction {
  return setTimeout(callback, delayMilliseconds);
}

function publicPowerFailure(): PowerActionError {
  return new PowerActionError(
    "POWER_ACTION_FAILED",
    "The system action could not be started.",
    503,
  );
}

export function createLinuxPowerActionAdapter(
  options: LinuxPowerAdapterOptions = {},
): HostPowerActionAdapter {
  const execFile = options.execFile ?? defaultExecFile;
  const spawn = options.spawn ?? defaultSpawn;
  const schedule = options.schedule ?? defaultSchedule;
  const stopBackend = options.stopBackend ?? (() => undefined);
  const log =
    options.log ??
    ((message) => {
      console.warn(message);
    });
  const executeHostActions = options.executeHostActions ?? true;

  const preflight = async (
    action: SystemPowerAction,
    executable: string,
    arguments_: readonly string[],
    validate?: (result: PowerExecResult) => boolean,
  ): Promise<void> => {
    try {
      const result = await execFile(executable, arguments_, {
        shell: false,
        timeout: POWER_PREFLIGHT_TIMEOUT_MS,
        windowsHide: true,
      });
      if (validate && !validate(result)) throw new Error("invalid result");
    } catch (error) {
      const exitCode =
        error &&
        typeof error === "object" &&
        "code" in error &&
        (typeof error.code === "number" || typeof error.code === "string")
          ? String(error.code)
          : "unknown";
      log(`[power] action=${action} phase=preflight exit=${exitCode}`);
      throw publicPowerFailure();
    }
  };

  const scheduleAction = (
    action: SystemPowerAction,
    executable: string,
    arguments_: readonly string[],
    stopAfterSpawn = false,
  ): void => {
    try {
      const timer = schedule(() => {
        if (!executeHostActions) return;
        try {
          const child = spawn(executable, arguments_, {
            detached: true,
            shell: false,
            stdio: "ignore",
          });
          child.once("error", () => {
            log(`[power] action=${action} phase=execute exit=spawn`);
          });
          child.unref();
          if (stopAfterSpawn) stopBackend();
        } catch {
          log(`[power] action=${action} phase=execute exit=spawn`);
        }
      }, POWER_ACTION_DELAY_MS);
      timer.unref();
    } catch {
      log(`[power] action=${action} phase=schedule exit=failed`);
      throw publicPowerFailure();
    }
  };

  return {
    async execute(action): Promise<void> {
      switch (action) {
        case "quit":
          return;
        case "maintenance":
          scheduleAction(action, linuxPowerPaths.maintenance, [], true);
          return;
        case "restart-app":
          await preflight(
            action,
            linuxPowerPaths.systemctl,
            [
              "--user",
              "show",
              "--property=LoadState",
              "--value",
              "eidetic-player.service",
            ],
            ({ stdout }) => stdout.trim() === "loaded",
          );
          scheduleAction(action, linuxPowerPaths.systemctl, [
            "--user",
            "--no-block",
            "restart",
            "eidetic-player.service",
          ]);
          return;
        case "reboot":
        case "shutdown":
          await preflight(action, linuxPowerPaths.pkexec, [
            "--disable-internal-agent",
            linuxPowerPaths.helper,
            "probe",
          ]);
          scheduleAction(action, linuxPowerPaths.pkexec, [
            "--disable-internal-agent",
            linuxPowerPaths.helper,
            action,
          ]);
          return;
      }
    },
  };
}
