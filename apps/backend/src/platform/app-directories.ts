import { homedir, tmpdir } from "node:os";
import { posix, win32 } from "node:path";

export interface AppDirectories {
  readonly config: string;
  readonly cache: string;
  readonly data: string;
  readonly runtime: string;
}

function linuxHome(
  environment: NodeJS.ProcessEnv,
  home: string,
  fallback: string,
): string {
  if (home.length > 0) return home;
  return environment.HOME ?? fallback;
}

export function resolveAppDirectories(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
  temporary: string = tmpdir(),
): AppDirectories {
  const resolvedHome = home ?? homedir();
  if (platform === "win32") {
    const roaming =
      environment.APPDATA ?? win32.join(resolvedHome, "AppData", "Roaming");
    const local =
      environment.LOCALAPPDATA ?? win32.join(resolvedHome, "AppData", "Local");
    const runtimeRoot = environment.TEMP ?? environment.TMP ?? temporary;
    return {
      config: win32.join(roaming, "Eidetic Player"),
      cache: win32.join(local, "Eidetic Player", "Cache"),
      data: win32.join(local, "Eidetic Player", "Data"),
      runtime: win32.join(runtimeRoot, "Eidetic Player", "Runtime"),
    };
  }

  const safeHome = linuxHome(environment, resolvedHome, temporary);
  const runtimeRoot =
    environment.XDG_RUNTIME_DIR ??
    posix.join(
      temporary,
      `eidetic-player-${environment.UID ?? String(process.pid)}`,
    );
  return {
    config: posix.join(
      environment.XDG_CONFIG_HOME ?? posix.join(safeHome, ".config"),
      "eidetic-player",
    ),
    cache: posix.join(
      environment.XDG_CACHE_HOME ?? posix.join(safeHome, ".cache"),
      "eidetic-player",
    ),
    data: posix.join(
      environment.XDG_DATA_HOME ?? posix.join(safeHome, ".local", "share"),
      "eidetic-player",
    ),
    runtime: environment.XDG_RUNTIME_DIR
      ? posix.join(runtimeRoot, "eidetic-player")
      : runtimeRoot,
  };
}
