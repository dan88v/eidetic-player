import type { VisualizerFrame } from "../../../../packages/shared/src/visualizer";
import type { VisualizerMode } from "../state/types";

export const VISUALIZER_SYNC_BUFFER_CAPACITY = 24;
// Present the closest already-decoded frame slightly ahead of MPV's reported
// audible position to compensate for analyzer, SSE, and display latency.
export const VISUALIZER_PRESENTATION_LEAD_SECONDS = 0.12;

export class VisualizerFrameBuffer {
  private readonly frames: VisualizerFrame[] = [];

  push(frame: VisualizerFrame): void {
    this.frames.push(frame);
    if (this.frames.length > VISUALIZER_SYNC_BUFFER_CAPACITY)
      this.frames.splice(
        0,
        this.frames.length - VISUALIZER_SYNC_BUFFER_CAPACITY,
      );
  }

  takeForPosition(
    playerSessionId: string,
    trackId: string | null,
    trackTransitionId: number,
    mode: Exclude<VisualizerMode, "none">,
    positionSeconds: number,
  ): VisualizerFrame | null {
    let selectedIndex = -1;
    for (let index = 0; index < this.frames.length; index += 1) {
      const frame = this.frames[index];
      if (!frame) continue;
      if (
        frame.playerSessionId !== playerSessionId ||
        frame.trackId !== trackId ||
        frame.trackTransitionId !== trackTransitionId ||
        frame.mode !== mode
      ) {
        selectedIndex = index;
        continue;
      }
      if (
        frame.positionSeconds <=
        positionSeconds + VISUALIZER_PRESENTATION_LEAD_SECONDS
      )
        selectedIndex = index;
      else break;
    }
    if (selectedIndex < 0) return null;
    const consumed = this.frames.splice(0, selectedIndex + 1);
    for (let index = consumed.length - 1; index >= 0; index -= 1) {
      const frame = consumed[index];
      if (
        frame?.playerSessionId === playerSessionId &&
        frame.trackId === trackId &&
        frame.trackTransitionId === trackTransitionId &&
        frame.mode === mode &&
        frame.positionSeconds <=
          positionSeconds + VISUALIZER_PRESENTATION_LEAD_SECONDS
      )
        return frame;
    }
    return null;
  }

  clear(): void {
    this.frames.length = 0;
  }

  get size(): number {
    return this.frames.length;
  }
}
