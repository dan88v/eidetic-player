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
  const authoritativeItem = state.currentPlayback?.item ?? null;
  const hasAuthoritativePlayback = state.currentPlayback !== undefined;
  const playbackInstanceId =
    state.currentPlayback?.playbackInstanceId ?? queueItem?.id ?? null;
  const observedTrack = state.currentTrack;
  const observedTrackMatchesPlayback =
    !hasAuthoritativePlayback ||
    (authoritativeItem !== null &&
      observedTrack !== null &&
      observedTrack.filename === authoritativeItem.filename &&
      observedTrack.title === authoritativeItem.displayTitle &&
      (authoritativeItem.artist === null ||
        observedTrack.artist === authoritativeItem.artist) &&
      (authoritativeItem.album === null ||
        observedTrack.album === authoritativeItem.album));
  const track = observedTrackMatchesPlayback ? observedTrack : null;
  const durationSeconds = Math.max(
    0,
    track ? state.durationSeconds : (authoritativeItem?.durationSeconds ?? 0),
  );
  const positionSeconds = Math.max(
    0,
    Math.min(durationSeconds, track ? state.positionSeconds : 0),
  );
  return Object.freeze({
    generation: state.trackTransitionId,
    trackId: playbackInstanceId,
    queueItemId: playbackInstanceId,
    title:
      authoritativeItem?.displayTitle ??
      (hasAuthoritativePlayback ? null : (track?.title ?? null)),
    artist:
      authoritativeItem?.artist ??
      (hasAuthoritativePlayback ? null : (track?.artist ?? null)),
    album:
      authoritativeItem?.album ??
      (hasAuthoritativePlayback ? null : (track?.album ?? null)),
    technical: track ? composeTechnicalDetails(track).join(" · ") : "",
    artwork: hasAuthoritativePlayback
      ? (authoritativeItem?.artwork ?? null)
      : (track?.artwork ?? queueItem?.artwork ?? null),
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
  private highestPlaybackPlanRevision = 0;

  noteTrackCommand(): number {
    this.commandId += 1;
    return this.commandId;
  }

  accept(state: PlayerState): PlayerState {
    const previous = this.accepted;
    if (!previous) {
      this.accepted = state;
      this.acceptedGenerations = state.currentTrack ? 1 : 0;
      this.highestPlaybackPlanRevision = state.playbackPlanRevision ?? 0;
      return state;
    }
    if (state.playerSessionId !== previous.playerSessionId) {
      this.accepted = state;
      this.acceptedGenerations = state.currentTrack ? 1 : 0;
      this.highestPlaybackPlanRevision = state.playbackPlanRevision ?? 0;
      this.settledCommandId = this.commandId;
      return state;
    }
    const staleGeneration =
      state.trackTransitionId < previous.trackTransitionId;
    const sameGenerationDifferentTrack =
      state.trackTransitionId === previous.trackTransitionId &&
      this.trackId(state) !== this.trackId(previous);
    const authoritativePlanAdvanced =
      sameGenerationDifferentTrack &&
      state.playbackPlanRevision !== undefined &&
      state.playbackPlanRevision > this.highestPlaybackPlanRevision;
    if (
      staleGeneration ||
      (sameGenerationDifferentTrack && !authoritativePlanAdvanced)
    ) {
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
    if (state.playbackPlanRevision !== undefined)
      this.highestPlaybackPlanRevision = Math.max(
        this.highestPlaybackPlanRevision,
        state.playbackPlanRevision,
      );
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
    return (
      state.currentPlayback?.playbackInstanceId ??
      state.queue[state.currentQueueIndex]?.id ??
      null
    );
  }
}
