import type {
  PlayerCommandRequestMetadata,
  PlayerState,
} from "../../../../packages/shared/src/player";
import {
  PlaybackCommandCoordinator,
  type PlaybackCommandCoordinatorCallbacks,
  type UiPlaybackCommandKind,
  type UiPlaybackCommandDiagnostic,
} from "./playback-command-coordinator";

export type PlayerStateListener = (
  state: PlayerState,
  previous: PlayerState,
) => void;

export class PlayerStore {
  private state: PlayerState;
  private authoritativeState: PlayerState;
  private readonly listeners = new Set<PlayerStateListener>();
  private readonly commands: PlaybackCommandCoordinator;

  constructor(
    initialState: PlayerState,
    callbacks?: PlaybackCommandCoordinatorCallbacks,
  ) {
    this.state = initialState;
    this.authoritativeState = initialState;
    this.commands = new PlaybackCommandCoordinator(callbacks);
  }
  getState(): PlayerState {
    return this.state;
  }
  setState(state: PlayerState): void {
    this.authoritativeState = state;
    this.publish(this.commands.receive(state));
  }
  beginVolumeIntent(volume: number): PlayerCommandRequestMetadata {
    const intent = this.commands.beginVolume(this.state, volume);
    this.publish(intent.state);
    return intent.metadata;
  }
  beginMuteIntent(muted: boolean): PlayerCommandRequestMetadata {
    const intent = this.commands.beginMute(this.state, muted);
    this.publish(intent.state);
    return intent.metadata;
  }
  beginTransportIntent(paused: boolean): PlayerCommandRequestMetadata {
    const intent = this.commands.beginTransport(this.state, paused);
    this.publish(intent.state);
    return intent.metadata;
  }
  beginNavigationIntent(
    targetQueueItemId: string | null,
  ): PlayerCommandRequestMetadata {
    return this.commands.beginNavigation(targetQueueItemId);
  }
  pendingNavigationTarget(): string | null | undefined {
    return this.commands.pendingNavigationTarget();
  }
  failIntent(
    kind: UiPlaybackCommandKind,
    metadata: PlayerCommandRequestMetadata,
  ): void {
    this.publish(
      this.commands.apiFailed(kind, metadata.intentId, this.authoritativeState),
    );
  }
  commandDiagnostics(): readonly UiPlaybackCommandDiagnostic[] {
    return this.commands.diagnosticSnapshot();
  }
  private publish(state: PlayerState): void {
    const previous = this.state;
    this.state = state;
    for (const listener of this.listeners) listener(state, previous);
  }
  subscribe(listener: PlayerStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const disconnectedPlayerState: PlayerState = {
  playerSessionId: "disconnected",
  trackTransitionId: 0,
  status: "loading",
  mpvAvailable: false,
  mpvVersion: null,
  currentTrack: null,
  positionSeconds: 0,
  durationSeconds: 0,
  paused: true,
  volume: 100,
  muted: false,
  shuffleEnabled: false,
  repeatMode: "off",
  currentQueueIndex: -1,
  queue: [],
  queueRevision: 0,
  audioDevice: "Default output",
  error: null,
};
