import type { ServerResponse } from "node:http";
import type { NetworkService } from "../network/network-service.js";

export class NetworkSseHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly unsubscribe: () => void;
  private readonly keepalive: NodeJS.Timeout;

  constructor(private readonly network: NetworkService) {
    this.unsubscribe = network.subscribe((snapshot) => {
      for (const client of this.clients) this.send(client, snapshot);
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
    this.send(response, this.network.snapshot());
    response.once("close", () => this.clients.delete(response));
  }
  close(): void {
    clearInterval(this.keepalive);
    this.unsubscribe();
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
  private send(client: ServerResponse, snapshot: unknown): void {
    client.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  }
}
