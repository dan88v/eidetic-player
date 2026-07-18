import type { VisualizerFrame } from "../../../../packages/shared/src/visualizer";
import { config } from "../config";
import type { VisualizerMode } from "../state/types";

const baseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class VisualizerStreamClient {
  private source: EventSource | null = null;
  private latest: VisualizerFrame | null = null;
  private sequence = -1;

  private mode: VisualizerMode | null = null;

  open(
    mode: Exclude<VisualizerMode, "none">,
    onFrameAvailable: () => void,
  ): void {
    if (this.source && this.mode === mode) return;
    this.close();
    this.mode = mode;
    const source = new EventSource(
      `${baseUrl}/api/visualizer/events?mode=${encodeURIComponent(mode)}`,
    );
    source.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data as string) as VisualizerFrame;
        if (frame.sequence < this.sequence) return;
        this.sequence = frame.sequence;
        this.latest = frame;
        onFrameAvailable();
      } catch {
        // A malformed analysis frame is ignored without affecting playback.
      }
    };
    this.source = source;
  }

  close(): void {
    this.source?.close();
    this.source = null;
    this.latest = null;
    this.sequence = -1;
    this.mode = null;
  }

  takeLatest(): VisualizerFrame | null {
    const frame = this.latest;
    this.latest = null;
    return frame;
  }
}
