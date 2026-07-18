import type { WaveformResponse } from "../../../../packages/shared/src/visualizer";
import { config } from "../config";

const baseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;
const cache = new Map<string, readonly number[]>();

async function requestWaveform(
  queueItemId: string,
  signal: AbortSignal,
): Promise<readonly number[] | null> {
  const response = await fetch(
    `${baseUrl}/api/player/queue/${encodeURIComponent(queueItemId)}/waveform`,
    { signal },
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as WaveformResponse;
  if (payload.queueItemId !== queueItemId || payload.status !== "ready")
    return null;
  cache.delete(queueItemId);
  cache.set(queueItemId, payload.points);
  while (cache.size > 4) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return payload.points;
}

export class WaveformLoader {
  private controller: AbortController | null = null;
  private preloadController: AbortController | null = null;
  private preloadId: string | null = null;
  private generation = 0;

  load(
    queueItemId: string,
    trackGeneration: number,
    onReady: (points: readonly number[], generation: number) => void,
  ): void {
    this.cancel();
    const generation = ++this.generation;
    const cached = cache.get(queueItemId);
    if (cached) {
      onReady(cached, trackGeneration);
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    void requestWaveform(queueItemId, controller.signal)
      .then((points) => {
        if (generation === this.generation && points)
          onReady(points, trackGeneration);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // The neutral empty rail remains visible.
        }
      });
  }

  preload(queueItemId: string | null): void {
    if (queueItemId === this.preloadId) return;
    this.preloadController?.abort();
    this.preloadController = null;
    this.preloadId = queueItemId;
    if (!queueItemId || cache.has(queueItemId)) return;
    const controller = new AbortController();
    this.preloadController = controller;
    void requestWaveform(queueItemId, controller.signal).catch(() => undefined);
  }

  hasCached(queueItemId: string): boolean {
    return cache.has(queueItemId);
  }

  cancel(): void {
    this.generation += 1;
    this.controller?.abort();
    this.preloadController?.abort();
    this.controller = null;
    this.preloadController = null;
    this.preloadId = null;
  }
}
