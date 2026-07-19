import { randomUUID } from "node:crypto";
import { chmod, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { resolveAppDirectories } from "../platform/app-directories.js";

export interface MpvEndpoint {
  readonly path: string;
  cleanup(): Promise<void>;
}

export async function createMpvEndpoint(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  runtimeDirectory = resolveAppDirectories(platform, environment).runtime,
): Promise<MpvEndpoint> {
  const id = `${String(process.pid)}-${randomUUID()}`;
  if (platform === "win32") {
    return {
      path: `\\\\.\\pipe\\eidetic-player-${id}`,
      cleanup: () => Promise.resolve(),
    };
  }

  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  await chmod(runtimeDirectory, 0o700);
  const path = join(runtimeDirectory, `mpv-${id}.sock`);
  if (Buffer.byteLength(path) >= 100)
    throw new Error(
      "MPV IPC runtime path is too long; set XDG_RUNTIME_DIR to a shorter path.",
    );
  const cleanup = async (): Promise<void> => {
    await unlink(path).catch((error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    });
  };
  await cleanup();
  return { path, cleanup };
}
