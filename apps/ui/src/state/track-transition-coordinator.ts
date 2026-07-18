import type {
  ArtworkRef,
  PlayerState,
} from "../../../../packages/shared/src/player";
import { composeTechnicalDetails } from "../../../../packages/shared/src/metadata";

export interface TrackPresentationSnapshot {
  readonly generation: number;
  readonly trackId: string | null;
  readonly queueItemId: string | null;
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly technical: string;
  readonly artwork: ArtworkRef | null;
  readonly positionSeconds: number;
  readonly durationSeconds: number;
}

export interface TransitionDiagnostics {
  readonly acceptedGenerations: number;
  readonly staleStatesIgnored: number;
  readonly cancelledCommands: number;
}

export function createTrackPresentationSnapshot(
  state: PlayerState,
): TrackPresentationSnapshot {
  const queueItem = state.queue[state.currentQueueIndex] ?? null;
  const track = state.currentTrack;
  const durationSeconds = Math.max(0, state.durationSeconds);
  const positionSeconds = Math.max(
    0,
    Math.min(durationSeconds, state.positionSeconds),
  );
  return Object.freeze({
    generation: state.trackTransitionId,
    trackId: queueItem?.id ?? null,
    queueItemId: queueItem?.id ?? null,
    title: track?.title ?? null,
    artist: track?.artist ?? null,
    album: track?.album ?? null,
    technical: track ? composeTechnicalDetails(track).join(" · ") : "",
    artwork: track?.artwork ?? queueItem?.artwork ?? null,
    positionSeconds,
    durationSeconds,
  });
}

export class TrackTransitionCoordinator {
  private accepted: PlayerState | null = null;
  private commandId = 0;
  private settledCommandId = 0;
  private cancelledCommands = 0;
  private acceptedGenerations = 0;
  private staleStatesIgnored = 0;

  noteTrackCommand(): number {
    this.commandId += 1;
    return this.commandId;
  }

  accept(state: PlayerState): PlayerState {
    const previous = this.accepted;
    if (!previous) {
      this.accepted = state;
      this.acceptedGenerations = state.currentTrack ? 1 : 0;
      return state;
    }
    if (state.playerSessionId !== previous.playerSessionId) {
      this.accepted = state;
      this.acceptedGenerations = state.currentTrack ? 1 : 0;
      this.settledCommandId = this.commandId;
      return state;
    }
    const staleGeneration =
      state.trackTransitionId < previous.trackTransitionId;
    const sameGenerationDifferentTrack =
      state.trackTransitionId === previous.trackTransitionId &&
      this.trackId(state) !== this.trackId(previous);
    if (staleGeneration || sameGenerationDifferentTrack) {
      this.staleStatesIgnored += 1;
      return previous;
    }
    if (state.trackTransitionId > previous.trackTransitionId) {
      this.acceptedGenerations += 1;
      this.cancelledCommands += Math.max(
        0,
        this.commandId - this.settledCommandId - 1,
      );
      this.settledCommandId = this.commandId;
    }
    this.accepted = state;
    return state;
  }

  getDiagnostics(): TransitionDiagnostics {
    return {
      acceptedGenerations: this.acceptedGenerations,
      staleStatesIgnored: this.staleStatesIgnored,
      cancelledCommands: this.cancelledCommands,
    };
  }

  private trackId(state: PlayerState): string | null {
    return state.queue[state.currentQueueIndex]?.id ?? null;
  }
}
