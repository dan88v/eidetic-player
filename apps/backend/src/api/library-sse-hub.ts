import type { ServerResponse } from "node:http";
import type { IndexedLibrarySnapshot } from "../../../../packages/shared/src/library.js";
import type { IndexedLibraryService } from "../library/library-service.js";

export class LibrarySseHub {
  private readonly clients = new Set<ServerResponse>();
  private unsubscribe: (() => void) | null = null;
  private keepalive: NodeJS.Timeout | null = null;

  constructor(private readonly library: IndexedLibraryService) {}

  add(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.flushHeaders();
    this.clients.add(response);
    this.send(response, this.library.snapshot());
    this.unsubscribe ??= this.library.subscribe((snapshot) => {
      this.broadcast(snapshot);
    });
    if (!this.keepalive) {
      this.keepalive = setInterval(() => {
        for (const client of this.clients) client.write(": keepalive\n\n");
      }, 25_000);
      this.keepalive.unref();
    }
    response.once("close", () => {
      this.clients.delete(response);
      this.stopIfIdle();
    });
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  private stopIfIdle(): void {
    if (this.clients.size > 0) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  private broadcast(snapshot: IndexedLibrarySnapshot): void {
    for (const client of this.clients) this.send(client, snapshot);
  }

  private send(client: ServerResponse, snapshot: IndexedLibrarySnapshot): void {
    client.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  }
}
