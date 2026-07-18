import type { WaveformResponse } from "../../../../packages/shared/src/visualizer";
import { config } from "../config";

const baseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class WaveformLoader {
  private controller: AbortController | null = null;
  private generation = 0;

  load(
    queueItemId: string,
    onReady: (points: readonly number[]) => void,
  ): void {
    this.cancel();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    void fetch(
      `${baseUrl}/api/player/queue/${encodeURIComponent(queueItemId)}/waveform`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Waveform unavailable");
        return (await response.json()) as WaveformResponse;
      })
      .then((payload) => {
        if (
          generation === this.generation &&
          payload.queueItemId === queueItemId &&
          payload.status === "ready"
        )
          onReady(payload.points);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // The deterministic waveform remains visible as the fallback.
        }
      });
  }

  cancel(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }
}
