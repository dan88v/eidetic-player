import type {
  ArtworkRef,
  CurrentPlaybackSource,
  PlaybackContextSummary,
  PlaybackContinuationSummary,
  PlayerState,
} from "../../../../packages/shared/src/player";

export interface QueueDrawerTrack {
  readonly id: string;
  readonly index: number;
  readonly filename: string;
  readonly displayTitle: string;
  readonly artist: string | null;
  readonly album: string | null;
  readonly artwork: ArtworkRef | null;
  readonly available: boolean;
  readonly libraryTrackId: string | null;
}

export interface QueueDrawerCurrentTrack extends Omit<
  QueueDrawerTrack,
  "index"
> {
  readonly source: CurrentPlaybackSource | null;
}

export interface QueueDrawerPresentation {
  readonly current: QueueDrawerCurrentTrack | null;
  readonly explicitQueue: readonly QueueDrawerTrack[];
  readonly context: PlaybackContextSummary | null;
  readonly continuation: PlaybackContinuationSummary | null;
  readonly authoritative: boolean;
}

/**
 * Produces the path-free drawer model. `explicitQueue` is authoritative when
 * present; the legacy technical Queue is read only as a compatibility bridge
 * for an older bootstrap payload.
 */
export function queueDrawerPresentation(
  state: PlayerState,
): QueueDrawerPresentation {
  const authoritative = state.explicitQueue !== undefined;
  const current =
    state.currentPlayback !== undefined
      ? state.currentPlayback
        ? {
            id: state.currentPlayback.playbackInstanceId,
            filename: state.currentPlayback.item.filename,
            displayTitle: state.currentPlayback.item.displayTitle,
            artist: state.currentPlayback.item.artist,
            album: state.currentPlayback.item.album,
            artwork: state.currentPlayback.item.artwork,
            available: state.currentPlayback.item.available,
            libraryTrackId: state.currentPlayback.item.libraryTrackId,
            source: state.currentPlayback.source,
          }
        : null
      : legacyCurrent(state);
  const explicitQueue = state.explicitQueue
    ? state.explicitQueue.map<QueueDrawerTrack>((entry) => ({
        id: entry.explicitQueueEntryId,
        index: entry.index,
        filename: entry.item.filename,
        displayTitle: entry.item.displayTitle,
        artist: entry.item.artist,
        album: entry.item.album,
        artwork: entry.item.artwork,
        available: entry.item.available,
        libraryTrackId: entry.item.libraryTrackId,
      }))
    : legacyFuture(state);
  return {
    current,
    explicitQueue,
    context: state.playbackContext ?? null,
    continuation: state.playbackContinuation ?? null,
    authoritative,
  };
}

function legacyCurrent(state: PlayerState): QueueDrawerCurrentTrack | null {
  const item =
    state.queue.find((candidate) => candidate.isCurrent) ??
    state.queue[state.currentQueueIndex];
  if (!item) return null;
  return {
    id: item.id,
    filename: item.filename,
    displayTitle: item.displayTitle,
    artist: null,
    album: null,
    artwork: item.artwork,
    available: item.available !== false,
    libraryTrackId: item.libraryTrackId ?? null,
    source: null,
  };
}

function legacyFuture(state: PlayerState): readonly QueueDrawerTrack[] {
  const current =
    state.queue.find((candidate) => candidate.isCurrent) ??
    state.queue[state.currentQueueIndex];
  const currentIndex = current?.index ?? -1;
  return state.queue
    .filter((item) => !item.isCurrent && item.index > currentIndex)
    .map((item, index) => ({
      id: item.id,
      index,
      filename: item.filename,
      displayTitle: item.displayTitle,
      artist: null,
      album: null,
      artwork: item.artwork,
      available: item.available !== false,
      libraryTrackId: item.libraryTrackId ?? null,
    }));
}
