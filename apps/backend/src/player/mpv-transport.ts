import { createConnection, type Socket } from "node:net";
import { JsonLineParser } from "./json-line-parser.js";

export type MpvPlaylistEntryId = number;

export interface MpvPlaylistEntry {
  readonly id?: MpvPlaylistEntryId;
  readonly filename?: unknown;
  readonly title?: unknown;
  readonly current?: unknown;
  readonly playing?: unknown;
}

export interface MpvResponse {
  readonly request_id?: number;
  readonly error?: string;
  readonly data?: unknown;
  readonly event?: string;
  readonly name?: string;
  /** The observation identifier supplied to observe_property. */
  readonly id?: number;
  /** The stable MPV playlist entry identifier carried by file events. */
  readonly playlist_entry_id?: MpvPlaylistEntryId;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly commandName: string;
  readonly background: boolean;
}

interface QueuedBackgroundRequest {
  readonly command: readonly unknown[];
  readonly timeoutMilliseconds: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

export type MpvMessageListener = (message: MpvResponse) => void;
export type MpvRequestPriority = "interactive" | "background";

export class MpvTransport {
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<MpvMessageListener>();
  private disconnected = false;
  private readonly parser: JsonLineParser;
  private readonly backgroundQueue: QueuedBackgroundRequest[] = [];
  private activeBackgroundRequests = 0;
  private static readonly maximumBackgroundRequests = 2;

  private constructor(private readonly socket: Socket) {
    this.parser = new JsonLineParser(
      (message) => {
        this.handleMessage(message);
      },
      (error) => {
        console.error("[mpv] invalid IPC message", error.message);
      },
    );
    socket.on("data", (chunk) => {
      this.parser.push(chunk);
    });
    socket.once("close", () => {
      this.disconnect(new Error("MPV IPC disconnected"));
    });
    socket.once("error", (error) => {
      this.disconnect(error);
    });
  }

  static async connect(
    path: string,
    timeoutMilliseconds = 5_000,
  ): Promise<MpvTransport> {
    const deadline = Date.now() + timeoutMilliseconds;
    let lastError: Error = new Error("MPV IPC endpoint did not become ready");
    while (Date.now() < deadline) {
      try {
        const socket = await new Promise<Socket>((resolve, reject) => {
          const candidate = createConnection(path);
          candidate.once("connect", () => {
            resolve(candidate);
          });
          candidate.once("error", reject);
        });
        return new MpvTransport(socket);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
    }
    throw lastError;
  }

  subscribe(listener: MpvMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(
    command: readonly unknown[],
    timeoutMilliseconds = 3_000,
    priority: MpvRequestPriority = "interactive",
  ): Promise<unknown> {
    if (this.disconnected)
      return Promise.reject(new Error("MPV IPC is not connected"));
    if (priority === "background")
      return new Promise((resolve, reject) => {
        this.backgroundQueue.push({
          command,
          timeoutMilliseconds,
          resolve,
          reject,
        });
        this.drainBackgroundQueue();
      });
    return this.send(command, timeoutMilliseconds, false);
  }

  private send(
    command: readonly unknown[],
    timeoutMilliseconds: number,
    background: boolean,
  ): Promise<unknown> {
    const requestId = ++this.requestId;
    const commandName = typeof command[0] === "string" ? command[0] : "unknown";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        if (background) {
          this.activeBackgroundRequests -= 1;
          this.drainBackgroundQueue();
        }
        reject(new Error(`MPV request ${String(requestId)} timed out`));
      }, timeoutMilliseconds);
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        commandName,
        background,
      });
      this.socket.write(
        `${JSON.stringify({ command, request_id: requestId })}\n`,
      );
    });
  }

  close(): void {
    this.socket.destroy();
    this.disconnect(new Error("MPV IPC closed"));
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const response = message as MpvResponse;
    if (typeof response.request_id === "number") {
      const pending = this.pending.get(response.request_id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(response.request_id);
        if (pending.background) {
          this.activeBackgroundRequests -= 1;
          this.drainBackgroundQueue();
        }
        if (response.error && response.error !== "success") {
          pending.reject(
            new Error(`MPV ${pending.commandName}: ${response.error}`),
          );
        } else pending.resolve(response.data);
      }
    }
    if (response.event) {
      for (const listener of this.listeners) listener(response);
    }
  }

  private disconnect(error: Error): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.parser.reset();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const queued of this.backgroundQueue) queued.reject(error);
    this.backgroundQueue.length = 0;
    this.activeBackgroundRequests = 0;
  }

  private drainBackgroundQueue(): void {
    while (
      !this.disconnected &&
      this.activeBackgroundRequests < MpvTransport.maximumBackgroundRequests
    ) {
      const queued = this.backgroundQueue.shift();
      if (!queued) return;
      this.activeBackgroundRequests += 1;
      void this.send(queued.command, queued.timeoutMilliseconds, true).then(
        queued.resolve,
        queued.reject,
      );
    }
  }
}
