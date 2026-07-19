import type { ServerResponse } from "node:http";
import type { VisualizerFrame } from "../../../../packages/shared/src/visualizer.js";
import { AudioAnalyzerService } from "./audio-analyzer-service.js";

export type VisualizerTransportMode =
  "meter" | "spectrumMono" | "spectrumStereo" | "technical";

export class VisualizerHub {
  private readonly clients = new Map<ServerResponse, VisualizerTransportMode>();
  private readonly keepalive: NodeJS.Timeout;
  private readonly unsubscribe: () => void;

  constructor(private readonly analyzer: AudioAnalyzerService) {
    this.unsubscribe = analyzer.subscribe((frame) => {
      this.broadcast(frame);
    });
    this.keepalive = setInterval(() => {
      for (const client of this.clients.keys()) client.write(": keepalive\n\n");
    }, 15_000);
    this.keepalive.unref();
  }

  add(response: ServerResponse, mode: VisualizerTransportMode): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(": connected\n\n");
    this.clients.set(response, mode);
    this.analyzer.setSubscriberCount(this.clients.size);
    response.once("close", () => {
      this.clients.delete(response);
      this.analyzer.setSubscriberCount(this.clients.size);
    });
  }

  async close(): Promise<void> {
    clearInterval(this.keepalive);
    this.unsubscribe();
    for (const client of this.clients.keys()) client.end();
    this.clients.clear();
    await this.analyzer.close();
  }

  private broadcast(frame: VisualizerFrame): void {
    const payloads = new Map<VisualizerTransportMode, string>();
    for (const [client, mode] of this.clients) {
      let payload = payloads.get(mode);
      if (!payload) {
        const round = (value: number): number =>
          Math.round(value * 10_000) / 10_000;
        const values = (source: readonly number[]): number[] =>
          source.map(round);
        const compact: VisualizerFrame = {
          playerSessionId: frame.playerSessionId,
          trackId: frame.trackId,
          trackTransitionId: frame.trackTransitionId,
          positionSeconds: Math.round(frame.positionSeconds * 1_000) / 1_000,
          sequence: frame.sequence,
          sampleRate: frame.sampleRate,
          mode,
          shortTermLufs:
            mode === "technical" && frame.shortTermLufs !== null
              ? Math.round(frame.shortTermLufs * 10) / 10
              : null,
          meter:
            mode === "meter" || mode === "technical"
              ? {
                  leftPeak: round(frame.meter.leftPeak),
                  leftRms: round(frame.meter.leftRms),
                  rightPeak: round(frame.meter.rightPeak),
                  rightRms: round(frame.meter.rightRms),
                }
              : { leftPeak: 0, leftRms: 0, rightPeak: 0, rightRms: 0 },
          monoBands: mode === "spectrumMono" ? values(frame.monoBands) : [],
          leftBands: mode === "spectrumStereo" ? values(frame.leftBands) : [],
          rightBands: mode === "spectrumStereo" ? values(frame.rightBands) : [],
          source: frame.source,
        };
        payload = `data: ${JSON.stringify(compact)}\n\n`;
        payloads.set(mode, payload);
      }
      client.write(payload);
    }
  }
}
