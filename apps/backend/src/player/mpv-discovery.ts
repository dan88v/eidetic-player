import { dirname } from "node:path";
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

export type MpvCandidateType = "configured" | "linux-system" | "path";

export type MpvDiscoveryStatus =
  | "success"
  | "not-found"
  | "permission-denied"
  | "timeout"
  | "invalid-version"
  | "spawn-failed";

export interface MpvDiscoveryCandidate {
  readonly type: MpvCandidateType;
  readonly executable: string;
}

export interface MpvDiscoveryDiagnostic {
  readonly type: MpvCandidateType;
  readonly candidate: string;
  readonly status: MpvDiscoveryStatus;
  readonly version?: string;
}

export interface MpvDiscoveryResult {
  readonly executable: string;
  readonly version: string;
  readonly diagnostics: readonly MpvDiscoveryDiagnostic[];
}

export function isValidMpvVersionLine(line: string): boolean {
  const trimmedLine = line.trim();
  return /^(?:mpv)\s+v?\d+\.\d+(?:\.\d+)?(?:\s|$)/i.test(trimmedLine);
}

function sanitizeCandidate(candidate: MpvDiscoveryCandidate): string {
  return candidate.type === "configured"
    ? "configured MPV path"
    : candidate.executable;
}

export function resolveMpvCandidates(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): readonly MpvDiscoveryCandidate[] {
  const configured = environment.EIDETIC_MPV_PATH?.trim();
  const candidates: MpvDiscoveryCandidate[] = [];
  if (configured)
    candidates.push({ type: "configured", executable: configured });
  if (platform === "linux")
    candidates.push({ type: "linux-system", executable: "/usr/bin/mpv" });
  candidates.push({ type: "path", executable: "mpv" });

  const keys = new Set<string>();
  const deduped: MpvDiscoveryCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.executable.toLowerCase();
    if (keys.has(key)) continue;
    keys.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function classifyExecError(error: unknown): MpvDiscoveryStatus {
  if (!(error instanceof Error)) return "spawn-failed";
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "not-found";
  if (code === "EACCES" || code === "EPERM") return "permission-denied";
  if (code === "ETIMEDOUT") return "timeout";
  return "spawn-failed";
}

async function verifyCandidate(
  candidate: MpvDiscoveryCandidate,
  environment: NodeJS.ProcessEnv,
): Promise<MpvDiscoveryDiagnostic> {
  try {
    const { stdout } = await execFileAsync(
      candidate.executable,
      ["--version"],
      {
        timeout: 4_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        cwd: dirname(candidate.executable),
        env: environment,
      },
    );
    const firstLine = stdout.split(/\r?\n/, 1)[0]?.trim();
    if (!firstLine || !isValidMpvVersionLine(firstLine)) {
      return {
        type: candidate.type,
        candidate: sanitizeCandidate(candidate),
        status: "invalid-version",
      };
    }
    return {
      type: candidate.type,
      candidate: sanitizeCandidate(candidate),
      status: "success",
      version: firstLine,
    };
  } catch (error) {
    return {
      type: candidate.type,
      candidate: sanitizeCandidate(candidate),
      status: classifyExecError(error),
    };
  }
}

export async function verifyMpv(
  executable: string,
): Promise<MpvDiscoveryResult | null> {
  const diagnostic = await verifyCandidate(
    { type: "path", executable },
    process.env,
  );
  if (diagnostic.status !== "success" || !diagnostic.version) return null;
  return { executable, version: diagnostic.version, diagnostics: [diagnostic] };
}

export async function discoverMpv(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<MpvDiscoveryResult | null> {
  if (environment === process.env) loadLocalEnvironment();
  const candidates = resolveMpvCandidates(platform, environment);
  const normalizedEnvironment =
    environment === process.env ? process.env : environment;
  const diagnostics: MpvDiscoveryDiagnostic[] = [];

  for (const candidate of candidates) {
    const diagnostic = await verifyCandidate(candidate, normalizedEnvironment);
    diagnostics.push(diagnostic);

    if (diagnostic.status === "success" && diagnostic.version) {
      console.log(`[player] MPV available: ${diagnostic.version}`);
      return {
        executable: candidate.executable,
        version: diagnostic.version,
        diagnostics,
      };
    }
    console.log(
      `[player] MPV candidate ${diagnostic.candidate} (${diagnostic.type}) => ${diagnostic.status}`,
    );
  }

  console.log("[player] MPV unavailable: no candidate succeeded");
  return null;
}
