import { execFile as nodeExecFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  lstat,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { ScreenDimLevelPercent } from "../../../../packages/shared/src/display.js";
import type {
  DisplayPlatformAdapter,
  DisplayPlatformCapabilities,
} from "./display-platform-adapter.js";

const WLR_RANDR_PATH = "/usr/bin/wlr-randr";
const BACKLIGHT_ROOT = "/sys/class/backlight";
const SYS_DEVICES_ROOT = `/sys/devices${sep}`;
const DISPLAY_COMMAND_TIMEOUT_MILLISECONDS = 2_500;
const safeOutputName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

interface CommandResult {
  readonly stdout: string;
}

export type DisplayExecFile = (
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly shell: false;
    readonly timeout: number;
    readonly windowsHide: true;
  },
) => Promise<CommandResult>;

export interface BacklightDevice {
  readonly brightnessPath: string;
  readonly maximum: number;
  activeBrightness: number;
}

export interface LinuxDisplayAdapterOptions {
  readonly execFile?: DisplayExecFile;
  readonly environment?: NodeJS.ProcessEnv;
  readonly discoverBacklight?: () => Promise<BacklightDevice | null>;
  readonly executable?: (path: string) => Promise<boolean>;
}

function defaultExecFile(
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly shell: false;
    readonly timeout: number;
    readonly windowsHide: true;
  },
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
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
          reject(
            error instanceof Error
              ? error
              : new Error("display command failed"),
          );
        else resolvePromise({ stdout });
      },
    );
  });
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function positiveInteger(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]+$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeInteger(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]+$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

export async function discoverWritableBacklight(): Promise<BacklightDevice | null> {
  const entries = await readdir(BACKLIGHT_ROOT).catch(() => [] as string[]);
  for (const entry of entries.sort()) {
    if (!safeOutputName.test(entry)) continue;
    const candidate = resolve(BACKLIGHT_ROOT, entry);
    const canonical = await realpath(candidate).catch(() => "");
    if (!canonical.startsWith(SYS_DEVICES_ROOT)) continue;
    const stats = await lstat(canonical).catch(() => null);
    if (!stats?.isDirectory()) continue;
    const brightnessPath = await realpath(
      resolve(canonical, "brightness"),
    ).catch(() => "");
    const maximumPath = await realpath(
      resolve(canonical, "max_brightness"),
    ).catch(() => "");
    const containedPrefix = `${canonical}${sep}`;
    if (
      !brightnessPath.startsWith(containedPrefix) ||
      !maximumPath.startsWith(containedPrefix)
    )
      continue;
    try {
      await access(brightnessPath, constants.R_OK | constants.W_OK);
      const maximum = positiveInteger(await readFile(maximumPath, "utf8"));
      const current = nonNegativeInteger(
        await readFile(brightnessPath, "utf8"),
      );
      if (!maximum || current === null || current > maximum) continue;
      return {
        brightnessPath,
        maximum,
        activeBrightness: current > 0 ? current : maximum,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function parseWlrRandrOutput(
  stdout: string,
): readonly { readonly name: string; readonly enabled: boolean }[] {
  const lines = stdout.split(/\r?\n/u);
  const outputs: { name: string; enabled: boolean }[] = [];
  let current: { name: string; enabled: boolean } | null = null;
  for (const line of lines) {
    if (line.length > 0 && !/^\s/u.test(line)) {
      const name = line.split(/\s/u, 1)[0] ?? "";
      current = safeOutputName.test(name) ? { name, enabled: false } : null;
      if (current) outputs.push(current);
      continue;
    }
    if (current && /^\s+Enabled:\s+yes\s*$/u.test(line)) current.enabled = true;
  }
  return outputs;
}

export class LinuxDisplayPlatformAdapter implements DisplayPlatformAdapter {
  private readonly execFile: DisplayExecFile;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly discoverBacklight: () => Promise<BacklightDevice | null>;
  private readonly executable: (path: string) => Promise<boolean>;
  private backlight: BacklightDevice | null = null;
  private backlightDimmed = false;
  private outputName: string | null = null;
  private capabilities: DisplayPlatformCapabilities = {
    dimMethod: "software",
    standbyMethod: "none",
    standbyAvailable: false,
  };

  constructor(options: LinuxDisplayAdapterOptions = {}) {
    this.execFile = options.execFile ?? defaultExecFile;
    this.environment = options.environment ?? process.env;
    this.discoverBacklight =
      options.discoverBacklight ?? discoverWritableBacklight;
    this.executable = options.executable ?? isExecutable;
  }

  async probe(): Promise<DisplayPlatformCapabilities> {
    this.backlight = await this.discoverBacklight();
    this.backlightDimmed = false;
    this.outputName = null;
    const waylandAvailable =
      this.environment.XDG_SESSION_TYPE === "wayland" &&
      typeof this.environment.WAYLAND_DISPLAY === "string" &&
      this.environment.WAYLAND_DISPLAY.length > 0 &&
      (await this.executable(WLR_RANDR_PATH));
    if (waylandAvailable) {
      const outputs = await this.runWlr([]).catch(() => null);
      const parsed = outputs ? parseWlrRandrOutput(outputs.stdout) : [];
      if (parsed.length === 1) this.outputName = parsed[0]?.name ?? null;
    }
    this.capabilities = {
      dimMethod: this.backlight ? "hardware-backlight" : "software",
      standbyMethod: this.backlight
        ? "backlight-off"
        : this.outputName
          ? "wayland-output"
          : "none",
      standbyAvailable: this.backlight !== null || this.outputName !== null,
    };
    return this.capabilities;
  }

  async dim(levelPercent: ScreenDimLevelPercent): Promise<void> {
    if (!this.backlight) return;
    const current =
      nonNegativeInteger(
        await readFile(this.backlight.brightnessPath, "utf8"),
      ) ?? this.backlight.activeBrightness;
    if (!this.backlightDimmed && current > 0)
      this.backlight.activeBrightness = current;
    const target = Math.max(
      1,
      Math.round((this.backlight.maximum * levelPercent) / 100),
    );
    await writeFile(
      this.backlight.brightnessPath,
      `${String(target)}\n`,
      "utf8",
    );
    this.backlightDimmed = true;
  }

  async standby(): Promise<void> {
    if (this.capabilities.standbyMethod === "backlight-off" && this.backlight) {
      const current =
        nonNegativeInteger(
          await readFile(this.backlight.brightnessPath, "utf8"),
        ) ?? this.backlight.activeBrightness;
      if (!this.backlightDimmed && current > 0)
        this.backlight.activeBrightness = current;
      await writeFile(this.backlight.brightnessPath, "0\n", "utf8");
      return;
    }
    if (
      this.capabilities.standbyMethod === "wayland-output" &&
      this.outputName
    ) {
      await this.runWlr(["--output", this.outputName, "--off"]);
      return;
    }
    throw new Error("display standby unavailable");
  }

  async wake(): Promise<void> {
    if (this.outputName)
      await this.runWlr(["--output", this.outputName, "--on"]);
    if (this.backlight)
      await writeFile(
        this.backlight.brightnessPath,
        `${String(this.backlight.activeBrightness)}\n`,
        "utf8",
      );
    this.backlightDimmed = false;
  }

  private runWlr(arguments_: readonly string[]): Promise<CommandResult> {
    return this.execFile(WLR_RANDR_PATH, arguments_, {
      shell: false,
      timeout: DISPLAY_COMMAND_TIMEOUT_MILLISECONDS,
      windowsHide: true,
    });
  }
}
