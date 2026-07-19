import type { VisualizerFrame } from "../../../../packages/shared/src/visualizer";
import { config } from "../config";
import type { VisualizerMode } from "../state/types";
import { VisualizerFrameBuffer } from "./visualizer-frame-buffer";

const baseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class VisualizerStreamClient {
  private source: EventSource | null = null;
  private readonly buffer = new VisualizerFrameBuffer();
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
        if (frame.sequence <= this.sequence) return;
        this.sequence = frame.sequence;
        this.buffer.push(frame);
        onFrameAvailable();
      } catch {
        // A malformed analysis frame is ignored without affecting playback.
      }
    };
    this.source = source;
  }

  takeForPosition(
    playerSessionId: string,
    trackId: string | null,
    trackTransitionId: number,
    positionSeconds: number,
  ): VisualizerFrame | null {
    const activeMode = this.mode && this.mode !== "none" ? this.mode : "meter";
    return this.buffer.takeForPosition(
      playerSessionId,
      trackId,
      trackTransitionId,
      activeMode,
      positionSeconds,
    );
  }

  clearFrames(): void {
    this.buffer.clear();
  }

  bufferedFrameCount(): number {
    return this.buffer.size;
  }

  close(): void {
    this.source?.close();
    this.source = null;
    this.clearFrames();
    this.sequence = -1;
    this.mode = null;
  }
}
