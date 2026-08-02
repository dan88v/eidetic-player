import type {
  ExternalArtworkRef,
  ExternalPlaybackMetadata,
  ExternalProviderState,
  PlaybackSourceCapabilities,
  PlaybackSourceKind,
} from "../../../../packages/shared/src/playback-source.js";

export interface ExternalPlaybackRoute {
  readonly physicalOutputId: string;
  readonly description: string;
  readonly routeKind: "pipewire" | "pulse" | "alsa" | "other";
  readonly providerTarget: string;
  readonly levelMode: "fixed" | "variable";
  readonly maximumSoftwareVolume: number;
  readonly availabilityRevision: number;
}

export interface ExternalProviderSnapshot {
  readonly sessionId: string | null;
  readonly generation: number;
  readonly state: ExternalProviderState;
  readonly metadata: ExternalPlaybackMetadata | null;
  readonly artwork: ExternalArtworkRef | null;
  readonly positionSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly volume: number;
  readonly muted: boolean;
  readonly capabilities: PlaybackSourceCapabilities;
}

export type ExternalProviderEventKind =
  | "session-starting"
  | "playing"
  | "paused"
  | "buffering"
  | "metadata"
  | "artwork"
  | "progress"
  | "volume"
  | "mute"
  | "ended"
  | "error"
  | "disconnected";

export interface ExternalProviderEvent {
  readonly kind: ExternalProviderEventKind;
  readonly sessionId: string;
  readonly generation: number;
  readonly monotonicMilliseconds: number;
  readonly snapshot: ExternalProviderSnapshot;
}

export interface ExternalPlaybackProvider {
  readonly kind: Exclude<PlaybackSourceKind, "local">;
  readonly capabilities: PlaybackSourceCapabilities;
  probeActiveSession(): Promise<ExternalProviderSnapshot | null>;
  subscribe(listener: (event: ExternalProviderEvent) => void): () => void;
  configureOutput(route: ExternalPlaybackRoute): Promise<void>;
  acquire(sessionId: string, generation: number): Promise<void>;
  release(generation: number): Promise<void>;
  stop(generation: number): Promise<void>;
  play(generation: number): Promise<void>;
  pause(generation: number): Promise<void>;
  previous(generation: number): Promise<void>;
  next(generation: number): Promise<void>;
  seek(positionSeconds: number, generation: number): Promise<void>;
  setVolume(volume: number, generation: number): Promise<void>;
  setMuted(muted: boolean, generation: number): Promise<void>;
  snapshot(): ExternalProviderSnapshot;
  shutdown(): Promise<void>;
}
