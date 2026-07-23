import { createMpvEndpoint, type MpvEndpoint } from "./mpv-endpoint.js";
import { MpvProcess } from "./mpv-process.js";
import { MpvTransport, type MpvMessageListener } from "./mpv-transport.js";

const observedProperties = [
  "pause",
  "time-pos",
  "duration",
  "playlist",
  "playlist-pos",
  "media-title",
  "metadata",
  "path",
  "audio-params",
  "audio-codec-name",
  "audio-buffer",
  "volume",
  "mute",
  "idle-active",
  "audio-device",
] as const;

export interface MpvControllerOptions {
  readonly executable: string;
  readonly extraArguments?: readonly string[];
  readonly onUnexpectedExit?: () => void;
}

export class MpvController {
  private endpoint: MpvEndpoint | null = null;
  private transport: MpvTransport | null = null;
  private readonly process = new MpvProcess();

  async start(options: MpvControllerOptions): Promise<void> {
    this.endpoint = await createMpvEndpoint();
    try {
      await this.process.start({
        executable: options.executable,
        ipcPath: this.endpoint.path,
        ...(options.extraArguments
          ? { extraArguments: options.extraArguments }
          : {}),
        onUnexpectedExit: () => {
          this.transport?.close();
          this.transport = null;
          void this.endpoint?.cleanup();
          options.onUnexpectedExit?.();
        },
      });
      this.transport = await MpvTransport.connect(this.endpoint.path);
      await Promise.all(
        observedProperties.map((property, index) =>
          this.command(["observe_property", index + 1, property]),
        ),
      );
    } catch (error) {
      this.process.markStopping();
      this.process.forceStop();
      await this.endpoint.cleanup();
      this.endpoint = null;
      throw error;
    }
  }

  subscribe(listener: MpvMessageListener): () => void {
    if (!this.transport) throw new Error("MPV controller is not started");
    return this.transport.subscribe(listener);
  }

  command(command: readonly unknown[], timeout?: number): Promise<unknown> {
    if (!this.transport) return Promise.reject(new Error("MPV is unavailable"));
    return this.transport.request(command, timeout);
  }

  getProperty(name: string): Promise<unknown> {
    return this.command(["get_property", name]);
  }

  setProperty(name: string, value: unknown): Promise<unknown> {
    return this.command(["set_property", name, value]);
  }

  async loadPlaylist(
    paths: readonly string[],
    selectedIndex = 0,
  ): Promise<void> {
    const first = paths[0];
    if (!first || !paths[selectedIndex])
      throw new Error("Cannot load an empty playlist");
    await this.setProperty("pause", true);
    // MPV's loadfile "replace" behavior can retain non-current playlist
    // entries in an already populated session. Clear those entries first so
    // every direct-open operation is an exact Queue replacement.
    await this.command(["playlist-clear"]);
    const selected = paths[selectedIndex] ?? first;
    await this.command(["loadfile", selected, "replace"]);
    for (let index = 0; index < selectedIndex; index += 1) {
      const path = paths[index];
      if (path) await this.command(["loadfile", path, "insert-at", index]);
    }
    for (const path of paths.slice(selectedIndex + 1)) {
      await this.command(["loadfile", path, "append"]);
    }
    const deadline = Date.now() + 2_000;
    let currentIndex: unknown;
    let currentPath: unknown;
    do {
      [currentIndex, currentPath] = await Promise.all([
        this.getProperty("playlist-pos"),
        this.getProperty("path"),
      ]);
      if (currentIndex === selectedIndex && currentPath === selected) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error(
      `MPV selected item mismatch: expected index ${String(selectedIndex)} and the requested path, got index ${String(currentIndex)} and ${typeof currentPath === "string" ? "another path" : "no path"}`,
    );
  }

  async appendToPlaylist(paths: readonly string[]): Promise<void> {
    for (const path of paths) await this.command(["loadfile", path, "append"]);
  }

  async clearPlaylist(): Promise<void> {
    await this.command(["stop"]).catch(() => undefined);
    await this.command(["playlist-clear"]).catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.process.markStopping();
    try {
      await this.command(["quit"], 800);
    } catch {
      // MPV commonly closes IPC before acknowledging quit.
    }
    const exited = await this.process.waitForExit(1_200);
    if (!exited) this.process.forceStop();
    this.transport?.close();
    this.transport = null;
    await this.endpoint?.cleanup();
    this.endpoint = null;
  }
}
