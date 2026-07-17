import { execFile } from "node:child_process";
import { loadEnvFile } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let localEnvironmentLoaded = false;

function loadLocalEnvironment(): void {
  if (localEnvironmentLoaded) return;
  localEnvironmentLoaded = true;
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export interface MpvDiscoveryResult {
  readonly executable: string;
  readonly version: string;
}

export async function verifyMpv(
  executable: string,
): Promise<MpvDiscoveryResult | null> {
  try {
    const { stdout } = await execFileAsync(executable, ["--version"], {
      timeout: 4_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    const firstLine = stdout.split(/\r?\n/, 1)[0]?.trim();
    if (!firstLine?.toLowerCase().includes("mpv")) return null;
    return { executable, version: firstLine };
  } catch {
    return null;
  }
}

export async function discoverMpv(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<MpvDiscoveryResult | null> {
  if (environment === process.env) loadLocalEnvironment();
  const configured = environment.EIDETIC_MPV_PATH?.trim();
  if (configured) {
    const result = await verifyMpv(configured);
    if (result) return result;
  }
  return verifyMpv("mpv");
}
