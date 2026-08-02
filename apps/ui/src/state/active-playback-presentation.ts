import type { PlayerState } from "../../../../packages/shared/src/player";
import {
  playbackSourceDisplayName,
  type ExternalArtworkRef,
  type PlaybackSourceCapabilities,
  type PlaybackSourceSnapshot,
} from "../../../../packages/shared/src/playback-source";
import {
  createTrackPresentationSnapshot,
  type TrackPresentationSnapshot,
} from "./track-transition-coordinator";

export interface UiActivePlaybackPresentation {
  readonly source: PlaybackSourceSnapshot["activeSource"];
  readonly sourceName: string;
  readonly heading: string;
  readonly external: boolean;
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly artwork: ExternalArtworkRef | null;
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly paused: boolean;
  readonly capabilities: PlaybackSourceCapabilities;
  readonly volume: number;
  readonly muted: boolean;
  readonly generation: number;
}

export function createActivePlaybackPresentation(
  player: PlayerState,
  source: PlaybackSourceSnapshot,
  localPresentation?: TrackPresentationSnapshot,
): UiActivePlaybackPresentation {
  if (source.activeSource === "local") {
    const local = localPresentation ?? createTrackPresentationSnapshot(player);
    return {
      source: "local",
      sourceName: playbackSourceDisplayName("local"),
      heading: "Now Playing",
      external: false,
      title: local.title,
      artist: local.artist,
      album: local.album,
      artwork: null,
      positionSeconds: local.positionSeconds,
      durationSeconds: local.durationSeconds,
      paused: player.paused,
      capabilities: source.capabilities,
      volume: player.volume,
      muted: player.muted,
      generation: local.generation,
    };
  }
  const sourceName = playbackSourceDisplayName(source.activeSource);
  return {
    source: source.activeSource,
    sourceName,
    heading: `Now Playing — ${sourceName}`,
    external: true,
    title: source.metadata?.title ?? null,
    artist: source.metadata?.artist ?? null,
    album: source.metadata?.album ?? null,
    artwork: source.artwork,
    positionSeconds: source.positionSeconds ?? 0,
    durationSeconds:
      source.durationSeconds ?? source.metadata?.durationSeconds ?? 0,
    paused: source.providerState !== "playing",
    capabilities: source.capabilities,
    volume: source.volume,
    muted: source.muted,
    generation: source.transitionGeneration,
  };
}
