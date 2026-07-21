import type { PlayerState } from "../../../../packages/shared/src/player";
import { deriveCassetteProgress } from "./cassette-progress";

export interface CassetteSnapshot {
  readonly status: PlayerState["status"];
  readonly paused: boolean;
  readonly queueRevision: number;
  readonly queueEmpty: boolean;
  readonly seeking: boolean;
  readonly progress: number;
  readonly confidence: "exact" | "estimated";
}

export function createCassetteSnapshot(
  state: PlayerState,
  previewPositionSeconds: number | null = null,
): CassetteSnapshot {
  const progress = deriveCassetteProgress({
    queue: state.queue.map(({ id, durationSeconds }) =>
      durationSeconds === undefined ? { id } : { id, durationSeconds },
    ),
    currentQueueIndex: state.currentQueueIndex,
    positionSeconds: state.positionSeconds,
    currentDurationSeconds: state.durationSeconds,
    previewPositionSeconds,
  });
  return {
    status: state.status,
    paused: state.paused,
    queueRevision: state.queueRevision,
    queueEmpty: state.queue.length === 0,
    seeking: previewPositionSeconds !== null,
    progress: progress.value,
    confidence: progress.confidence,
  };
}
