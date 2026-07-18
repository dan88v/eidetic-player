import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let environmentLoaded = false;

export interface FfmpegDiscoveryResult {
  readonly executable: string;
  readonly version: string;
}

function loadEnvironment(): void {
  if (environmentLoaded) return;
  environmentLoaded = true;
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function verifyFfmpeg(
  executable: string,
): Promise<FfmpegDiscoveryResult | null> {
  try {
    const { stdout } = await execFileAsync(executable, ["-version"], {
      timeout: 4_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    const version = stdout.split(/\r?\n/, 1)[0]?.trim();
    return version?.toLowerCase().startsWith("ffmpeg version")
      ? { executable, version }
      : null;
  } catch {
    return null;
  }
}

export async function discoverFfmpeg(
  environment: NodeJS.ProcessEnv = process.env,
  mpvExecutable?: string,
): Promise<FfmpegDiscoveryResult | null> {
  if (environment === process.env) loadEnvironment();
  const candidates: string[] = [];
  const configured = environment.EIDETIC_FFMPEG_PATH?.trim();
  if (configured) candidates.push(configured);
  const mpv = mpvExecutable ?? environment.EIDETIC_MPV_PATH?.trim();
  if (mpv) {
    const adjacent = join(
      dirname(mpv),
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    );
    if (existsSync(adjacent)) candidates.push(adjacent);
  }
  candidates.push("ffmpeg");
  for (const candidate of [...new Set(candidates)]) {
    const result = await verifyFfmpeg(candidate);
    if (result) return result;
  }
  return null;
}
