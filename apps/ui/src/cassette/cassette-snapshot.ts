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
  const playbackQueue =
    state.currentPlayback !== undefined
      ? [
          ...(state.currentPlayback
            ? [
                {
                  id: state.currentPlayback.playbackInstanceId,
                  durationSeconds: state.durationSeconds,
                },
              ]
            : []),
          ...(state.explicitQueue ?? []).map((entry) => ({
            id: entry.playbackInstanceId,
            ...(entry.item.durationSeconds !== undefined
              ? { durationSeconds: entry.item.durationSeconds }
              : {}),
          })),
          ...Array.from(
            {
              length: Math.min(1, state.playbackContext?.remainingCount ?? 0),
            },
            (_, index) => ({
              id: `${state.playbackContext?.contextId ?? "context"}:${String(index)}`,
            }),
          ),
        ]
      : state.queue.map(({ id, durationSeconds }) =>
          durationSeconds === undefined ? { id } : { id, durationSeconds },
        );
  const progress = deriveCassetteProgress({
    queue: playbackQueue,
    currentQueueIndex:
      state.currentPlayback !== undefined ? 0 : state.currentQueueIndex,
    positionSeconds: state.positionSeconds,
    currentDurationSeconds: state.durationSeconds,
    previewPositionSeconds,
  });
  return {
    status: state.status,
    paused: state.paused,
    queueRevision:
      state.queueRevision +
      (state.contextRevision ?? 0) +
      state.trackTransitionId,
    queueEmpty: playbackQueue.length === 0,
    seeking: previewPositionSeconds !== null,
    progress: progress.value,
    confidence: progress.confidence,
  };
}
