import type { VisualizerFrame } from "../../../../packages/shared/src/visualizer";

export const VISUALIZER_SYNC_BUFFER_CAPACITY = 24;
export const VISUALIZER_FRAME_TOLERANCE_SECONDS = 0.05;

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
    trackId: string | null,
    trackTransitionId: number,
    positionSeconds: number,
  ): VisualizerFrame | null {
    let selectedIndex = -1;
    for (let index = 0; index < this.frames.length; index += 1) {
      const frame = this.frames[index];
      if (!frame) continue;
      if (
        frame.trackId !== trackId ||
        frame.trackTransitionId !== trackTransitionId
      ) {
        selectedIndex = index;
        continue;
      }
      if (
        frame.positionSeconds <=
        positionSeconds + VISUALIZER_FRAME_TOLERANCE_SECONDS
      )
        selectedIndex = index;
      else break;
    }
    if (selectedIndex < 0) return null;
    const consumed = this.frames.splice(0, selectedIndex + 1);
    for (let index = consumed.length - 1; index >= 0; index -= 1) {
      const frame = consumed[index];
      if (
        frame?.trackId === trackId &&
        frame.trackTransitionId === trackTransitionId &&
        frame.positionSeconds <=
          positionSeconds + VISUALIZER_FRAME_TOLERANCE_SECONDS
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
