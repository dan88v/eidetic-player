import type { LibraryApiClient } from "../api/library-api-client";

type Listener = (isFavorite: boolean | undefined) => void;

const MAX_CACHED_TRACKS = 512;
const MAX_STATUS_BATCH = 192;

export class FavoriteTrackStore {
  private readonly values = new Map<string, boolean>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pendingStatus = new Set<string>();
  private statusScheduled = false;

  constructor(private readonly api: LibraryApiClient) {}

  get(trackId: string): boolean | undefined {
    const value = this.values.get(trackId);
    if (value !== undefined) {
      this.values.delete(trackId);
      this.values.set(trackId, value);
    }
    return value;
  }

  ensure(trackIds: readonly string[]): void {
    for (const trackId of trackIds)
      if (!this.values.has(trackId)) this.pendingStatus.add(trackId);
    if (this.pendingStatus.size === 0 || this.statusScheduled) return;
    this.statusScheduled = true;
    queueMicrotask(() => {
      this.statusScheduled = false;
      void this.loadPendingStatus();
    });
  }

  subscribe(trackId: string, listener: Listener): () => void {
    let group = this.listeners.get(trackId);
    if (!group) {
      group = new Set();
      this.listeners.set(trackId, group);
    }
    group.add(listener);
    listener(this.get(trackId));
    this.ensure([trackId]);
    return () => {
      group.delete(listener);
      if (group.size === 0) this.listeners.delete(trackId);
    };
  }

  async set(trackId: string, isFavorite: boolean): Promise<void> {
    const previous = this.values.get(trackId);
    this.commit(trackId, isFavorite);
    try {
      const result = isFavorite
        ? await this.api.addFavoriteTrack(trackId)
        : await this.api.removeFavoriteTrack(trackId);
      this.commit(trackId, result.isFavorite);
    } catch (error) {
      if (previous === undefined) {
        this.values.delete(trackId);
        this.notify(trackId, undefined);
      } else this.commit(trackId, previous);
      throw error;
    }
  }

  seed(trackIds: readonly string[], value: boolean): void {
    for (const trackId of trackIds) this.commit(trackId, value);
  }

  async toggle(trackId: string): Promise<boolean> {
    const next = !(this.get(trackId) ?? false);
    await this.set(trackId, next);
    return next;
  }

  invalidate(): void {
    const visibleIds = [...this.listeners.keys()];
    this.values.clear();
    for (const trackId of visibleIds) this.notify(trackId, undefined);
    this.ensure(visibleIds);
  }

  private async loadPendingStatus(): Promise<void> {
    const ids = [...this.pendingStatus].slice(0, MAX_STATUS_BATCH);
    for (const id of ids) this.pendingStatus.delete(id);
    if (ids.length === 0) return;
    try {
      const response = await this.api.favoriteTrackStatus(ids);
      const favorites = new Set(response.favoriteTrackIds);
      for (const id of ids) this.commit(id, favorites.has(id));
    } catch {
      // An action will retry; status failures do not create one toast per row.
    }
    if (this.pendingStatus.size > 0) this.ensure([]);
  }

  private commit(trackId: string, value: boolean): void {
    this.values.delete(trackId);
    this.values.set(trackId, value);
    this.trim();
    this.notify(trackId, value);
  }

  private notify(trackId: string, value: boolean | undefined): void {
    for (const listener of this.listeners.get(trackId) ?? []) listener(value);
  }

  private trim(): void {
    while (this.values.size > MAX_CACHED_TRACKS) {
      const oldest = this.values.keys().next().value;
      if (!oldest) return;
      if (this.listeners.has(oldest)) {
        const value = this.values.get(oldest);
        this.values.delete(oldest);
        if (value !== undefined) this.values.set(oldest, value);
        if ([...this.values.keys()].every((id) => this.listeners.has(id)))
          return;
      } else this.values.delete(oldest);
    }
  }
}
