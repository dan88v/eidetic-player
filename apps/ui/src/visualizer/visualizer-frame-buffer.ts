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
    while (this.frames.length > VISUALIZER_SYNC_BUFFER_CAPACITY)
      this.frames.shift();
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
    let selectedFrame: VisualizerFrame | null = null;
    for (let index = selectedIndex; index >= 0; index -= 1) {
      const frame = this.frames[index];
      if (
        frame?.playerSessionId === playerSessionId &&
        frame.trackId === trackId &&
        frame.trackTransitionId === trackTransitionId &&
        frame.mode === mode &&
        frame.positionSeconds <=
          positionSeconds + VISUALIZER_PRESENTATION_LEAD_SECONDS
      )
        selectedFrame = frame;
      break;
    }
    // Discard consumed frames in place. Retaining only the newest bounded
    // window avoids allocating a second array for every high-frequency SSE
    // frame, which otherwise creates sustained garbage pressure in WebKitGTK.
    for (let index = 0; index <= selectedIndex; index += 1) this.frames.shift();
    return selectedFrame;
  }

  clear(): void {
    this.frames.length = 0;
  }

  get size(): number {
    return this.frames.length;
  }
}
