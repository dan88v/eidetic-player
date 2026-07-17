import type { ServerResponse } from "node:http";
import type { PlayerService } from "../player/player-service.js";

export class SseHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly unsubscribe: () => void;
  private readonly keepalive: NodeJS.Timeout;

  constructor(private readonly player: PlayerService) {
    this.unsubscribe = player.subscribe((state) => {
      this.broadcast(state);
    });
    this.keepalive = setInterval(() => {
      for (const client of this.clients) client.write(": keepalive\n\n");
    }, 25_000);
    this.keepalive.unref();
  }

  add(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.flushHeaders();
    this.clients.add(response);
    this.send(response, this.player.getState());
    response.once("close", () => this.clients.delete(response));
  }

  close(): void {
    clearInterval(this.keepalive);
    this.unsubscribe();
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  private broadcast(state: unknown): void {
    for (const client of this.clients) this.send(client, state);
  }

  private send(client: ServerResponse, state: unknown): void {
    client.write(`data: ${JSON.stringify(state)}\n\n`);
  }
}
