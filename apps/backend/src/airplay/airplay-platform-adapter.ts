import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { resolveAppDirectories } from "../platform/app-directories.js";

export interface AirPlayPlatformStatus {
  readonly available: boolean;
  readonly active: boolean;
  readonly protocol: "airplay2" | "classic" | "unavailable";
  readonly message: string | null;
}

export interface AirPlayPlatformAdapter {
  readonly fixture: boolean;
  readonly controlSocket: string;
  readonly metadataPipe: string;
  readonly hookExecutable: string;
  status(): Promise<AirPlayPlatformStatus>;
  verifyAdvertisement(
    receiverName: string,
  ): Promise<"verified" | "collision" | "unavailable">;
  prepareRuntime(): Promise<void>;
  writeConfiguration(configuration: string): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  restart(): Promise<void>;
  stopRuntime(): Promise<void>;
  close(): Promise<void>;
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function run(
  executable: string,
  args: readonly string[],
  timeoutMilliseconds = 4_000,
): Promise<{ code: number; output: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: string): void => {
      if (output.length < 4096) output += chunk;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("AirPlay service command timed out."));
    }, timeoutMilliseconds);
    timer.unref();
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolveResult({ code: code ?? 1, output });
    });
  });
}

function decodeAvahiField(value: string): string {
  return value.replace(/\\(\d{3})/gu, (_match, digits: string) =>
    String.fromCodePoint(Number(digits)),
  );
}

const AIRPLAY_SERVICE = "eidetic-player-airplay.service";

export function airPlayServiceCommandPlan(
  enabled: boolean,
): readonly (readonly string[])[] {
  return enabled
    ? [
        ["--user", "disable", AIRPLAY_SERVICE],
        ["--user", "reset-failed", AIRPLAY_SERVICE],
        ["--user", "start", AIRPLAY_SERVICE],
      ]
    : [["--user", "disable", "--now", AIRPLAY_SERVICE]];
}

export class LinuxAirPlayPlatformAdapter implements AirPlayPlatformAdapter {
  readonly controlSocket: string;
  readonly metadataPipe: string;
  readonly hookExecutable = "/usr/libexec/eidetic-player-airplay-hook";
  private readonly configRoot: string;
  private readonly configPath: string;
  private fixtureActive = false;

  constructor(
    directories = resolveAppDirectories(),
    readonly fixture = process.env.EIDETIC_AIRPLAY_FIXTURE === "1",
  ) {
    this.configRoot = resolve(directories.config, "airplay");
    this.configPath = resolve(this.configRoot, "shairport-sync.conf");
    this.controlSocket =
      process.platform === "win32"
        ? `\\\\.\\pipe\\eidetic-airplay-${String(process.pid)}`
        : resolve(directories.runtime, "airplay-control.sock");
    this.metadataPipe = resolve(directories.runtime, "airplay-metadata");
  }

  async status(): Promise<AirPlayPlatformStatus> {
    if (this.fixture)
      return {
        available: true,
        active: this.fixtureActive,
        protocol: "airplay2",
        message: null,
      };
    if (process.platform !== "linux")
      return {
        available: false,
        active: false,
        protocol: "unavailable",
        message:
          "AirPlay receiver integration is available on Linux Appliance.",
      };
    try {
      const version = await run(
        "/opt/eidetic-player/current/airplay/bin/shairport-sync",
        ["-V"],
      );
      if (version.code !== 0) throw new Error("version unavailable");
      const state = await run("/usr/bin/systemctl", [
        "--user",
        "is-active",
        "eidetic-player-airplay.service",
      ]);
      const text = version.output.toLowerCase();
      return {
        available: true,
        active: state.code === 0,
        protocol: text.includes("airplay2") ? "airplay2" : "classic",
        message: null,
      };
    } catch {
      return {
        available: false,
        active: false,
        protocol: "unavailable",
        message: "Managed AirPlay components are not installed.",
      };
    }
  }

  async verifyAdvertisement(
    receiverName: string,
  ): Promise<"verified" | "collision" | "unavailable"> {
    if (this.fixture) return "verified";
    if (process.platform !== "linux") return "unavailable";
    const result = await run(
      "/usr/bin/avahi-browse",
      ["--terminate", "--resolve", "--parsable", "_airplay._tcp"],
      6_000,
    ).catch(() => null);
    if (result?.code !== 0) return "unavailable";
    const localHostname = `${hostname().toLowerCase()}.local`;
    const localNames = result.output
      .split("\n")
      .map((line) => line.split(";"))
      .filter(
        (fields) =>
          fields[0] === "=" &&
          decodeAvahiField(fields[6] ?? "").toLowerCase() === localHostname,
      )
      .map((fields) => decodeAvahiField(fields[3] ?? ""));
    if (localNames.includes(receiverName)) return "verified";
    return localNames.length > 0 ? "collision" : "unavailable";
  }

  async prepareRuntime(): Promise<void> {
    await mkdir(dirname(this.metadataPipe), { recursive: true, mode: 0o700 });
    if (this.fixture || process.platform !== "linux") return;
    try {
      const stats = await lstat(this.metadataPipe);
      if (!stats.isFIFO() || stats.isSymbolicLink())
        throw new Error("Unsafe AirPlay metadata pipe.");
      if ((stats.mode & 0o077) !== 0) await chmod(this.metadataPipe, 0o600);
      return;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const result = await run("/usr/bin/mkfifo", [
      "-m",
      "0600",
      this.metadataPipe,
    ]);
    if (result.code !== 0)
      throw new Error("AirPlay metadata pipe could not be created.");
  }

  async writeConfiguration(configuration: string): Promise<void> {
    await mkdir(this.configRoot, { recursive: true, mode: 0o700 });
    const temporary = resolve(
      this.configRoot,
      `.shairport-sync.${String(process.pid)}.${randomUUID()}.tmp`,
    );
    if (dirname(temporary) !== this.configRoot)
      throw new Error("Invalid AirPlay configuration path.");
    let handle;
    try {
      handle = await open(
        temporary,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
        0o600,
      );
      await handle.writeFile(configuration, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.configPath);
      if (process.platform !== "win32") await chmod(this.configPath, 0o600);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.fixture) {
      this.fixtureActive = enabled;
      return;
    }
    if (process.platform !== "linux") return;
    for (const command of airPlayServiceCommandPlan(enabled)) {
      const result = await run("/usr/bin/systemctl", command);
      if (result.code !== 0)
        throw new Error("AirPlay service state could not be changed.");
    }
  }

  async restart(): Promise<void> {
    if (this.fixture) {
      this.fixtureActive = true;
      return;
    }
    if (process.platform !== "linux") return;
    const reset = await run("/usr/bin/systemctl", [
      "--user",
      "reset-failed",
      AIRPLAY_SERVICE,
    ]);
    if (reset.code !== 0)
      throw new Error("AirPlay service could not be restarted.");
    const result = await run("/usr/bin/systemctl", [
      "--user",
      "restart",
      AIRPLAY_SERVICE,
    ]);
    if (result.code !== 0)
      throw new Error("AirPlay service could not be restarted.");
  }

  async stopRuntime(): Promise<void> {
    if (this.fixture) {
      this.fixtureActive = false;
      return;
    }
    if (process.platform !== "linux") return;
    const result = await run("/usr/bin/systemctl", [
      "--user",
      "stop",
      "eidetic-player-airplay.service",
    ]);
    if (result.code !== 0)
      throw new Error("AirPlay service could not be stopped.");
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
