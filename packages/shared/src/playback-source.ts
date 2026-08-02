export const playbackSourceKinds = ["local", "airplay", "spotify"] as const;

export type PlaybackSourceKind = (typeof playbackSourceKinds)[number];

export const playbackSourcePhases = [
  "idle",
  "acquiring",
  "active",
  "releasing",
  "recovering",
  "error",
] as const;

export type PlaybackSourcePhase = (typeof playbackSourcePhases)[number];

export type ExternalPlaybackEndPolicy = "keep-paused" | "resume-interrupted";

export type ExternalProviderState =
  "playing" | "paused" | "stopped" | "buffering" | "error";

export interface PlaybackSourceCapabilities {
  readonly play: boolean;
  readonly pause: boolean;
  readonly stop: boolean;
  readonly previous: boolean;
  readonly next: boolean;
  readonly seek: boolean;
  readonly volume: boolean;
  readonly mute: boolean;
  readonly metadata: boolean;
  readonly artwork: boolean;
  readonly progress: boolean;
}

export const localPlaybackSourceCapabilities: PlaybackSourceCapabilities =
  Object.freeze({
    play: true,
    pause: true,
    stop: true,
    previous: true,
    next: true,
    seek: true,
    volume: true,
    mute: true,
    metadata: true,
    artwork: true,
    progress: true,
  });

export interface ExternalPlaybackMetadata {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly durationSeconds: number | null;
}

/** Opaque, backend-owned external artwork reference. */
export interface ExternalArtworkRef {
  readonly id: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly revision: string;
}

export interface PlaybackSourceError {
  readonly code: string;
  readonly message: string;
}

export interface ActivePlaybackOutput {
  readonly description: string;
  readonly levelMode: "fixed" | "variable";
  readonly maximumSoftwareVolume: number;
}

export interface PlaybackSourceSnapshot {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly transitionGeneration: number;
  readonly activeSource: PlaybackSourceKind;
  readonly phase: PlaybackSourcePhase;
  readonly sessionId: string | null;
  readonly providerState: ExternalProviderState;
  readonly metadata: ExternalPlaybackMetadata | null;
  readonly artwork: ExternalArtworkRef | null;
  readonly positionSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly capabilities: PlaybackSourceCapabilities;
  readonly volume: number;
  readonly muted: boolean;
  readonly output: ActivePlaybackOutput;
  readonly localPlaybackSuspended: boolean;
  readonly localWasPlaying: boolean;
  readonly lastError: PlaybackSourceError | null;
}

export const defaultPlaybackSourceSnapshot: PlaybackSourceSnapshot =
  Object.freeze<PlaybackSourceSnapshot>({
    schemaVersion: 1,
    revision: 0,
    transitionGeneration: 0,
    activeSource: "local",
    phase: "idle",
    sessionId: null,
    providerState: "stopped",
    metadata: null,
    artwork: null,
    positionSeconds: null,
    durationSeconds: null,
    capabilities: localPlaybackSourceCapabilities,
    volume: 100,
    muted: false,
    output: {
      description: "System default",
      levelMode: "variable",
      maximumSoftwareVolume: 100,
    },
    localPlaybackSuspended: false,
    localWasPlaying: false,
    lastError: null,
  });

export interface ActivePlaybackPresentation {
  readonly source: PlaybackSourceKind;
  readonly sourceName: "Eidetic Player" | "AirPlay" | "Spotify Connect";
  readonly status: ExternalProviderState;
  readonly metadata: ExternalPlaybackMetadata | null;
  readonly artwork: ExternalArtworkRef | null;
  readonly positionSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly capabilities: PlaybackSourceCapabilities;
  readonly volume: number;
  readonly muted: boolean;
  readonly output: ActivePlaybackOutput;
  readonly localPlaybackSuspended: boolean;
  readonly error: PlaybackSourceError | null;
}

export function playbackSourceDisplayName(
  source: PlaybackSourceKind,
): ActivePlaybackPresentation["sourceName"] {
  if (source === "airplay") return "AirPlay";
  if (source === "spotify") return "Spotify Connect";
  return "Eidetic Player";
}

export function activePlaybackPresentation(
  snapshot: PlaybackSourceSnapshot,
): ActivePlaybackPresentation {
  return {
    source: snapshot.activeSource,
    sourceName: playbackSourceDisplayName(snapshot.activeSource),
    status: snapshot.providerState,
    metadata: snapshot.metadata,
    artwork: snapshot.artwork,
    positionSeconds: snapshot.positionSeconds,
    durationSeconds: snapshot.durationSeconds,
    capabilities: snapshot.capabilities,
    volume: snapshot.volume,
    muted: snapshot.muted,
    output: snapshot.output,
    localPlaybackSuspended: snapshot.localPlaybackSuspended,
    error: snapshot.lastError,
  };
}

export function playbackSourceKeepsDisplayActive(
  snapshot: PlaybackSourceSnapshot,
): boolean {
  return (
    snapshot.activeSource !== "local" &&
    (snapshot.providerState === "playing" ||
      snapshot.providerState === "buffering")
  );
}
