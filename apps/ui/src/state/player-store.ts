import type { PlayerState } from "../../../../packages/shared/src/player";

export type PlayerStateListener = (
  state: PlayerState,
  previous: PlayerState,
) => void;

export class PlayerStore {
  private state: PlayerState;
  private readonly listeners = new Set<PlayerStateListener>();

  constructor(initialState: PlayerState) {
    this.state = initialState;
  }
  getState(): PlayerState {
    return this.state;
  }
  setState(state: PlayerState): void {
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
