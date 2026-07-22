import type { LibraryApiClient } from "../api/library-api-client";

type Listener = (isFavorite: boolean | undefined) => void;

const MAX_CACHED_ENTITIES = 512;
const MAX_STATUS_BATCH = 192;

interface FavoriteEntityAdapter {
  readonly status: (ids: readonly string[]) => Promise<ReadonlySet<string>>;
  readonly add: (id: string) => Promise<{ readonly isFavorite: boolean }>;
  readonly remove: (id: string) => Promise<{ readonly isFavorite: boolean }>;
}

export class FavoriteEntityStore {
  private readonly values = new Map<string, boolean>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pendingStatus = new Set<string>();
  private statusScheduled = false;

  constructor(private readonly adapter: FavoriteEntityAdapter) {}

  get(id: string): boolean | undefined {
    const value = this.values.get(id);
    if (value !== undefined) {
      this.values.delete(id);
      this.values.set(id, value);
    }
    return value;
  }

  ensure(ids: readonly string[]): void {
    for (const id of ids) if (!this.values.has(id)) this.pendingStatus.add(id);
    if (this.pendingStatus.size === 0 || this.statusScheduled) return;
    this.statusScheduled = true;
    queueMicrotask(() => {
      this.statusScheduled = false;
      void this.loadPendingStatus();
    });
  }

  subscribe(id: string, listener: Listener): () => void {
    let group = this.listeners.get(id);
    if (!group) {
      group = new Set();
      this.listeners.set(id, group);
    }
    group.add(listener);
    listener(this.get(id));
    this.ensure([id]);
    return () => {
      group.delete(listener);
      if (group.size === 0) this.listeners.delete(id);
    };
  }

  async set(id: string, isFavorite: boolean): Promise<void> {
    const previous = this.values.get(id);
    this.commit(id, isFavorite);
    try {
      const result = isFavorite
        ? await this.adapter.add(id)
        : await this.adapter.remove(id);
      this.commit(id, result.isFavorite);
    } catch (error) {
      if (previous === undefined) {
        this.values.delete(id);
        this.notify(id, undefined);
      } else this.commit(id, previous);
      throw error;
    }
  }

  seed(ids: readonly string[], value: boolean): void {
    for (const id of ids) this.commit(id, value);
  }

  async toggle(id: string): Promise<boolean> {
    const next = !(this.get(id) ?? false);
    await this.set(id, next);
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
      const favorites = await this.adapter.status(ids);
      for (const id of ids) this.commit(id, favorites.has(id));
    } catch {
      // An action will retry; status failures do not create one toast per row.
    }
    if (this.pendingStatus.size > 0) this.ensure([]);
  }

  private commit(id: string, value: boolean): void {
    this.values.delete(id);
    this.values.set(id, value);
    this.trim();
    this.notify(id, value);
  }

  private notify(id: string, value: boolean | undefined): void {
    for (const listener of this.listeners.get(id) ?? []) listener(value);
  }

  private trim(): void {
    while (this.values.size > MAX_CACHED_ENTITIES) {
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

export class FavoriteTrackStore extends FavoriteEntityStore {
  constructor(api: LibraryApiClient) {
    super({
      status: async (ids) =>
        new Set((await api.favoriteTrackStatus(ids)).favoriteTrackIds),
      add: (id) => api.addFavoriteTrack(id),
      remove: (id) => api.removeFavoriteTrack(id),
    });
  }
}

export class FavoriteAlbumStore extends FavoriteEntityStore {
  constructor(api: LibraryApiClient) {
    super({
      status: async (ids) =>
        new Set((await api.favoriteAlbumStatus(ids)).favoriteAlbumIds),
      add: (id) => api.addFavoriteAlbum(id),
      remove: (id) => api.removeFavoriteAlbum(id),
    });
  }
}

export class FavoriteArtistStore extends FavoriteEntityStore {
  constructor(api: LibraryApiClient) {
    super({
      status: async (ids) =>
        new Set((await api.favoriteArtistStatus(ids)).favoriteArtistIds),
      add: (id) => api.addFavoriteArtist(id),
      remove: (id) => api.removeFavoriteArtist(id),
    });
  }
}
