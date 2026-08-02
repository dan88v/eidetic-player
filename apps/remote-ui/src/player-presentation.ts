import type {
  RemotePlayerProgress,
  RemotePlayerState,
} from "../../../packages/shared/src/remote-access";
import type {
  ArtworkRef,
  PlaybackContextKind,
  PublicPlaybackItem,
} from "../../../packages/shared/src/player";

export interface RemotePlayerDisplay {
  readonly title: string;
  readonly artist: string | null;
  readonly album: string | null;
  readonly artwork: ArtworkRef | null;
  readonly hasCurrent: boolean;
}

export interface RemotePlayerStateCheckpoint {
  readonly eventRevision: number;
  readonly requestRevision: number;
  readonly stateRevision: number;
}

function remotePlayerProgressMatches(
  state: RemotePlayerState,
  progress: RemotePlayerProgress,
): boolean {
  return (
    progress.playerSessionId === state.playerSessionId &&
    progress.playbackPlanRevision === state.playbackPlanRevision &&
    progress.trackTransitionId === state.trackTransitionId
  );
}

function remotePlayerStateCanFollow(
  previous: RemotePlayerState,
  next: RemotePlayerState,
): boolean {
  if (next.playerSessionId !== previous.playerSessionId) return false;
  if (next.playbackPlanRevision < previous.playbackPlanRevision) return false;
  if (next.trackTransitionId < previous.trackTransitionId) return false;
  if (next.queueRevision < previous.queueRevision) return false;
  if (next.contextRevision < previous.contextRevision) return false;
  return !(
    next.playbackPlanRevision === previous.playbackPlanRevision &&
    next.trackTransitionId === previous.trackTransitionId &&
    remotePlayerTrackKey(next) !== remotePlayerTrackKey(previous)
  );
}

/**
 * Serializes the Remote player's three asynchronous state sources. SSE event
 * revisions invalidate pending HTTP responses, while progress deltas are
 * accepted only for the exact public Current identity they describe.
 */
export class RemotePlayerStateCoordinator {
  private state: RemotePlayerState | null = null;
  private eventRevision = 0;
  private stateRevision = 0;
  private requestRevision = 0;

  reset(state: RemotePlayerState, eventRevision: number): RemotePlayerState {
    this.state = state;
    this.eventRevision = eventRevision;
    this.stateRevision += 1;
    this.requestRevision += 1;
    return state;
  }

  beginHttpRequest(): RemotePlayerStateCheckpoint {
    this.requestRevision += 1;
    return this.checkpoint();
  }

  checkpoint(): RemotePlayerStateCheckpoint {
    return {
      eventRevision: this.eventRevision,
      requestRevision: this.requestRevision,
      stateRevision: this.stateRevision,
    };
  }

  isCurrent(checkpoint: RemotePlayerStateCheckpoint): boolean {
    return (
      checkpoint.eventRevision === this.eventRevision &&
      checkpoint.requestRevision === this.requestRevision &&
      checkpoint.stateRevision === this.stateRevision
    );
  }

  isLatestHttpRequest(checkpoint: RemotePlayerStateCheckpoint): boolean {
    return checkpoint.requestRevision === this.requestRevision;
  }

  replaceLocal(next: RemotePlayerState): RemotePlayerState | null {
    if (!this.canCommit(next)) return null;
    this.state = next;
    this.stateRevision += 1;
    return next;
  }

  acceptHttp(
    next: RemotePlayerState,
    checkpoint: RemotePlayerStateCheckpoint,
  ): RemotePlayerState | null {
    if (!this.isCurrent(checkpoint) || !this.canCommit(next)) return null;
    this.state = next;
    this.stateRevision += 1;
    return next;
  }

  acceptEvent(
    next: RemotePlayerState,
    eventRevision: number,
  ): RemotePlayerState | null {
    if (!this.observeEvent(eventRevision) || !this.canCommit(next)) return null;
    this.state = next;
    return next;
  }

  acceptProgress(
    progress: RemotePlayerProgress,
    eventRevision: number,
  ): RemotePlayerState | null {
    if (!this.observeEvent(eventRevision) || !this.state) return null;
    if (!remotePlayerProgressMatches(this.state, progress)) return null;
    this.state = mergeRemotePlayerProgress(this.state, progress);
    return this.state;
  }

  private observeEvent(eventRevision: number): boolean {
    if (
      !Number.isSafeInteger(eventRevision) ||
      eventRevision < 0 ||
      eventRevision <= this.eventRevision
    )
      return false;
    this.eventRevision = eventRevision;
    this.stateRevision += 1;
    return true;
  }

  private canCommit(next: RemotePlayerState): boolean {
    return !this.state || remotePlayerStateCanFollow(this.state, next);
  }
}

export function mergeRemotePlayerProgress(
  state: RemotePlayerState,
  progress: RemotePlayerProgress,
): RemotePlayerState {
  if (!remotePlayerProgressMatches(state, progress)) return state;
  return { ...state, ...progress };
}

export function remotePlayerDisplay(
  state: RemotePlayerState,
): RemotePlayerDisplay {
  const current = state.currentPlayback?.item;
  if (current)
    return {
      title: current.displayTitle || current.filename || "Nothing playing",
      artist: current.artist,
      album: current.album,
      artwork: current.artwork,
      hasCurrent: true,
    };
  return {
    title:
      state.currentTrack?.title ??
      state.currentTrack?.filename ??
      "Nothing playing",
    artist: state.currentTrack?.artist ?? null,
    album: state.currentTrack?.album ?? null,
    artwork: state.currentTrack?.artwork ?? null,
    hasCurrent: state.currentTrack !== null,
  };
}

export function remotePlayerTrackKey(state: RemotePlayerState): string | null {
  return (
    state.currentPlayback?.playbackInstanceId ??
    (state.currentTrack ? `legacy-${String(state.trackTransitionId)}` : null)
  );
}

function playbackItemPresentationChanged(
  previous: PublicPlaybackItem | null | undefined,
  next: PublicPlaybackItem | null | undefined,
): boolean {
  return (
    previous?.filename !== next?.filename ||
    previous?.displayTitle !== next?.displayTitle ||
    previous?.artist !== next?.artist ||
    previous?.album !== next?.album ||
    previous?.durationSeconds !== next?.durationSeconds ||
    previous?.artwork?.id !== next?.artwork?.id ||
    previous?.artwork?.revision !== next?.artwork?.revision ||
    previous?.available !== next?.available ||
    previous?.libraryTrackId !== next?.libraryTrackId
  );
}

function currentPlaybackPresentationChanged(
  previous: RemotePlayerState,
  next: RemotePlayerState,
): boolean {
  return (
    remotePlayerTrackKey(previous) !== remotePlayerTrackKey(next) ||
    previous.currentPlayback?.source !== next.currentPlayback?.source ||
    previous.currentPlayback?.relationId !== next.currentPlayback?.relationId ||
    playbackItemPresentationChanged(
      previous.currentPlayback?.item,
      next.currentPlayback?.item,
    ) ||
    previous.currentTrack?.title !== next.currentTrack?.title ||
    previous.currentTrack?.filename !== next.currentTrack?.filename ||
    previous.currentTrack?.artist !== next.currentTrack?.artist ||
    previous.currentTrack?.album !== next.currentTrack?.album ||
    previous.currentTrack?.artwork?.id !== next.currentTrack?.artwork?.id ||
    previous.currentTrack?.artwork?.revision !==
      next.currentTrack?.artwork?.revision
  );
}

function explicitQueuePresentationChanged(
  previous: RemotePlayerState,
  next: RemotePlayerState,
): boolean {
  if (previous.explicitQueue === next.explicitQueue) return false;
  if (previous.explicitQueue.length !== next.explicitQueue.length) return true;
  for (let index = 0; index < previous.explicitQueue.length; index += 1) {
    const before = previous.explicitQueue[index];
    const after = next.explicitQueue[index];
    if (
      before?.explicitQueueEntryId !== after?.explicitQueueEntryId ||
      before?.playbackInstanceId !== after?.playbackInstanceId ||
      before?.index !== after?.index ||
      playbackItemPresentationChanged(before?.item, after?.item)
    )
      return true;
  }
  return false;
}

export function remotePlayerPresentationChanged(
  previous: RemotePlayerState,
  next: RemotePlayerState,
): boolean {
  return (
    currentPlaybackPresentationChanged(previous, next) ||
    previous.status !== next.status ||
    previous.mpvAvailable !== next.mpvAvailable ||
    previous.paused !== next.paused ||
    previous.volume !== next.volume ||
    previous.muted !== next.muted ||
    previous.shuffleEnabled !== next.shuffleEnabled ||
    previous.repeatMode !== next.repeatMode ||
    previous.canGoNext !== next.canGoNext
  );
}

export function remoteQueuePresentationChanged(
  previous: RemotePlayerState,
  next: RemotePlayerState,
): boolean {
  return (
    currentPlaybackPresentationChanged(previous, next) ||
    explicitQueuePresentationChanged(previous, next) ||
    previous.queueRevision !== next.queueRevision ||
    previous.contextRevision !== next.contextRevision ||
    previous.playbackContext?.contextId !== next.playbackContext?.contextId ||
    previous.playbackContext?.title !== next.playbackContext?.title ||
    previous.playbackContext?.kind !== next.playbackContext?.kind ||
    previous.playbackContext?.remainingCount !==
      next.playbackContext?.remainingCount ||
    previous.playbackContext?.nextItem?.displayTitle !==
      next.playbackContext?.nextItem?.displayTitle ||
    previous.playbackContinuation.mode !== next.playbackContinuation.mode ||
    previous.playbackContinuation.artistId !==
      next.playbackContinuation.artistId ||
    previous.playbackContinuation.artistName !==
      next.playbackContinuation.artistName ||
    previous.playbackContinuation.active !== next.playbackContinuation.active
  );
}

export function remoteSameArtistSummary(
  state: RemotePlayerState,
): string | null {
  const continuation = state.playbackContinuation;
  if (continuation.mode !== "same-artist" || !continuation.artistId)
    return null;
  return continuation.artistName
    ? `Continues with tracks by ${continuation.artistName}.`
    : "Continues with tracks by the current artist.";
}

export function remotePlaybackContextKindLabel(
  kind: PlaybackContextKind,
): string {
  switch (kind) {
    case "direct-folder":
      return "Direct folder";
    case "recently-played":
      return "Recently played";
    case "most-played":
      return "Most played";
    case "artist-radio":
      return "Same artist";
    case "legacy-session":
      return "Restored session";
    default:
      return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  }
}

export function formatRemoteTrackCount(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    return null;
  return `${String(value)} ${value === 1 ? "track" : "tracks"}`;
}
