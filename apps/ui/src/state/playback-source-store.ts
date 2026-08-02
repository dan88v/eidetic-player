import type { PlaybackSourceSnapshot } from "../../../../packages/shared/src/playback-source";

export type PlaybackSourceListener = (
  state: PlaybackSourceSnapshot,
  previous: PlaybackSourceSnapshot,
) => void;

export class PlaybackSourceStore {
  private readonly listeners = new Set<PlaybackSourceListener>();

  constructor(private state: PlaybackSourceSnapshot) {}

  getState(): PlaybackSourceSnapshot {
    return this.state;
  }

  setState(state: PlaybackSourceSnapshot): void {
    if (state.revision < this.state.revision) return;
    this.commit(state);
  }

  replaceStateAfterReconnect(state: PlaybackSourceSnapshot): void {
    this.commit(state);
  }

  private commit(state: PlaybackSourceSnapshot): void {
    const previous = this.state;
    this.state = state;
    for (const listener of this.listeners) listener(state, previous);
  }

  subscribe(listener: PlaybackSourceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
