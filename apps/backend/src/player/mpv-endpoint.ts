import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface MpvEndpoint {
  readonly path: string;
  cleanup(): Promise<void>;
}

export async function createMpvEndpoint(
  platform: NodeJS.Platform = process.platform,
): Promise<MpvEndpoint> {
  const id = `${String(process.pid)}-${randomUUID()}`;
  if (platform === "win32") {
    return {
      path: `\\\\.\\pipe\\eidetic-player-${id}`,
      cleanup: () => Promise.resolve(),
    };
  }

  const path = join(tmpdir(), `eidetic-player-${id}.sock`);
  const cleanup = async (): Promise<void> => {
    await unlink(path).catch((error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    });
  };
  await cleanup();
  return { path, cleanup };
}
