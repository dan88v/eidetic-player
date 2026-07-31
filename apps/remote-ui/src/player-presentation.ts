import type { RemotePlayerState } from "../../../packages/shared/src/remote-access";

export function remotePlayerTrackKey(state: RemotePlayerState): string | null {
  return state.queue[state.currentQueueIndex]?.id ?? null;
}

export function remotePlayerPresentationChanged(
  previous: RemotePlayerState,
  next: RemotePlayerState,
): boolean {
  return (
    remotePlayerTrackKey(previous) !== remotePlayerTrackKey(next) ||
    previous.status !== next.status ||
    previous.mpvAvailable !== next.mpvAvailable ||
    previous.paused !== next.paused ||
    previous.volume !== next.volume ||
    previous.muted !== next.muted ||
    previous.shuffleEnabled !== next.shuffleEnabled ||
    previous.repeatMode !== next.repeatMode ||
    previous.currentTrack?.title !== next.currentTrack?.title ||
    previous.currentTrack?.filename !== next.currentTrack?.filename ||
    previous.currentTrack?.artist !== next.currentTrack?.artist ||
    previous.currentTrack?.album !== next.currentTrack?.album ||
    previous.currentTrack?.artwork?.revision !==
      next.currentTrack?.artwork?.revision
  );
}

export function formatRemoteTrackCount(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    return null;
  return `${String(value)} ${value === 1 ? "track" : "tracks"}`;
}
