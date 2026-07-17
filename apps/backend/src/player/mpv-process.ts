import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface MpvProcessOptions {
  readonly executable: string;
  readonly ipcPath: string;
  readonly extraArguments?: readonly string[];
  readonly onUnexpectedExit?: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void;
}

export class MpvProcess {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stopping = false;

  async start(options: MpvProcessOptions): Promise<void> {
    const arguments_ = [
      "--idle=yes",
      "--no-video",
      "--audio-display=no",
      "--no-terminal",
      "--osc=no",
      "--osd-level=0",
      "--no-config",
      "--gapless-audio=yes",
      `--input-ipc-server=${options.ipcPath}`,
      ...(options.extraArguments ?? []),
    ];
    const child = spawn(options.executable, arguments_, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.resume();
    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.error(`[mpv] ${line}`);
    });
    child.once("exit", (code, signal) => {
      this.child = null;
      if (!this.stopping) options.onUnexpectedExit?.(code, signal);
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  }

  async waitForExit(timeoutMilliseconds: number): Promise<boolean> {
    const child = this.child;
    if (!child) return true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, timeoutMilliseconds);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  forceStop(): void {
    this.stopping = true;
    this.child?.kill("SIGKILL");
  }

  markStopping(): void {
    this.stopping = true;
  }
}
