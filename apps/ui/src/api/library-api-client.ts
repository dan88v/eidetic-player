import type {
  LibraryAlbum,
  LibraryAlbumDetail,
  LibraryArtist,
  LibraryArtistDetail,
  LibraryContextRequest,
  IndexedLibrarySnapshot,
  IndexedLibraryStatus,
  LibraryPage,
  LibraryQueueActionResponse,
  LibraryCancelScanRequest,
  LibraryScanRequest,
  LibraryTrack,
  LibraryCategorySearchResults,
  LibraryGroupedSearchResults,
  LibrarySearchCategory,
  FavoriteTrackPage,
  FavoriteTrackMutationResponse,
  FavoriteTrackStatusResponse,
  FavoriteTracksPlayRequest,
  FavoriteAlbumPage,
  FavoriteArtistPage,
  FavoriteAlbumMutationResponse,
  FavoriteArtistMutationResponse,
  FavoriteAlbumStatusResponse,
  FavoriteArtistStatusResponse,
  RecentlyPlayedPage,
  RecentlyPlayedPlayRequest,
  RecentlyPlayedMutationResponse,
  MostPlayedPage,
  MostPlayedPlayRequest,
  ListeningStats,
  ListeningStatsResetResponse,
  PlaylistAddTracksResponse,
  PlaylistDetail,
  PlaylistPage,
  PlaylistSummary,
} from "../../../../packages/shared/src/library";
import type { ApiResponse } from "../../../../packages/shared/src/player";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class LibraryApiClient {
  snapshot(): Promise<IndexedLibrarySnapshot> {
    return this.request("/api/library/snapshot");
  }

  status(): Promise<IndexedLibraryStatus> {
    return this.request("/api/library/status");
  }

  albums(
    cursor: string | null = null,
    limit = 48,
  ): Promise<LibraryPage<LibraryAlbum>> {
    return this.request(this.pagePath("/api/library/albums", cursor, limit));
  }

  album(albumId: string): Promise<LibraryAlbumDetail> {
    return this.request(`/api/library/albums/${encodeURIComponent(albumId)}`);
  }

  artists(
    cursor: string | null = null,
    limit = 48,
  ): Promise<LibraryPage<LibraryArtist>> {
    return this.request(this.pagePath("/api/library/artists", cursor, limit));
  }

  artist(
    artistId: string,
    trackCursor: string | null = null,
    limit = 48,
  ): Promise<LibraryArtistDetail> {
    const path = this.pagePath(
      `/api/library/artists/${encodeURIComponent(artistId)}`,
      trackCursor,
      limit,
      "trackCursor",
    );
    return this.request(path);
  }

  tracks(
    cursor: string | null = null,
    limit = 48,
  ): Promise<LibraryPage<LibraryTrack>> {
    return this.request(this.pagePath("/api/library/tracks", cursor, limit));
  }

  recentlyPlayed(
    cursor: string | null = null,
    limit = 48,
  ): Promise<RecentlyPlayedPage> {
    return this.request(
      this.pagePath("/api/library/recently-played", cursor, limit),
    );
  }

  playRecentlyPlayed(
    request: RecentlyPlayedPlayRequest = {},
  ): Promise<LibraryQueueActionResponse> {
    return this.request("/api/library/recently-played/play", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  removeRecentlyPlayed(
    historyId: string,
  ): Promise<RecentlyPlayedMutationResponse> {
    return this.request(
      `/api/library/recently-played/${encodeURIComponent(historyId)}`,
      { method: "DELETE" },
    );
  }

  clearRecentlyPlayed(): Promise<RecentlyPlayedMutationResponse> {
    return this.request("/api/library/recently-played", { method: "DELETE" });
  }

  mostPlayed(
    cursor: string | null = null,
    limit = 48,
  ): Promise<MostPlayedPage> {
    return this.request(
      this.pagePath("/api/library/history/most-played", cursor, limit),
    );
  }

  playMostPlayed(
    request: MostPlayedPlayRequest = {},
  ): Promise<LibraryQueueActionResponse> {
    return this.request("/api/library/history/most-played/play", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  listeningStats(): Promise<ListeningStats> {
    return this.request("/api/library/history/stats");
  }

  resetListeningStats(): Promise<ListeningStatsResetResponse> {
    return this.request("/api/library/history/stats", { method: "DELETE" });
  }

  favoriteTracks(
    cursor: string | null = null,
    limit = 48,
  ): Promise<FavoriteTrackPage> {
    return this.request(
      this.pagePath("/api/library/favorites/tracks", cursor, limit),
    );
  }

  favoriteTrackStatus(
    trackIds: readonly string[],
  ): Promise<FavoriteTrackStatusResponse> {
    return this.request("/api/library/favorites/tracks/status", {
      method: "POST",
      body: JSON.stringify({ trackIds }),
    });
  }

  addFavoriteTrack(trackId: string): Promise<FavoriteTrackMutationResponse> {
    return this.request(
      `/api/library/favorites/tracks/${encodeURIComponent(trackId)}`,
      { method: "PUT" },
    );
  }

  removeFavoriteTrack(trackId: string): Promise<FavoriteTrackMutationResponse> {
    return this.request(
      `/api/library/favorites/tracks/${encodeURIComponent(trackId)}`,
      { method: "DELETE" },
    );
  }

  playFavorites(
    request: FavoriteTracksPlayRequest = {},
  ): Promise<LibraryQueueActionResponse> {
    return this.request("/api/library/favorites/tracks/play", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  favoriteAlbums(
    cursor: string | null = null,
    limit = 48,
  ): Promise<FavoriteAlbumPage> {
    return this.request(
      this.pagePath("/api/library/favorites/albums", cursor, limit),
    );
  }

  favoriteAlbumStatus(
    albumIds: readonly string[],
  ): Promise<FavoriteAlbumStatusResponse> {
    return this.request("/api/library/favorites/albums/status", {
      method: "POST",
      body: JSON.stringify({ albumIds }),
    });
  }

  addFavoriteAlbum(albumId: string): Promise<FavoriteAlbumMutationResponse> {
    return this.request(
      `/api/library/favorites/albums/${encodeURIComponent(albumId)}`,
      { method: "PUT" },
    );
  }

  removeFavoriteAlbum(albumId: string): Promise<FavoriteAlbumMutationResponse> {
    return this.request(
      `/api/library/favorites/albums/${encodeURIComponent(albumId)}`,
      { method: "DELETE" },
    );
  }

  playFavoriteAlbums(): Promise<LibraryQueueActionResponse> {
    return this.request("/api/library/favorites/albums/play", {
      method: "POST",
    });
  }

  favoriteArtists(
    cursor: string | null = null,
    limit = 48,
  ): Promise<FavoriteArtistPage> {
    return this.request(
      this.pagePath("/api/library/favorites/artists", cursor, limit),
    );
  }

  favoriteArtistStatus(
    artistIds: readonly string[],
  ): Promise<FavoriteArtistStatusResponse> {
    return this.request("/api/library/favorites/artists/status", {
      method: "POST",
      body: JSON.stringify({ artistIds }),
    });
  }

  addFavoriteArtist(artistId: string): Promise<FavoriteArtistMutationResponse> {
    return this.request(
      `/api/library/favorites/artists/${encodeURIComponent(artistId)}`,
      { method: "PUT" },
    );
  }

  removeFavoriteArtist(
    artistId: string,
  ): Promise<FavoriteArtistMutationResponse> {
    return this.request(
      `/api/library/favorites/artists/${encodeURIComponent(artistId)}`,
      { method: "DELETE" },
    );
  }

  playFavoriteArtists(): Promise<LibraryQueueActionResponse> {
    return this.request("/api/library/favorites/artists/play", {
      method: "POST",
    });
  }

  search(
    query: string,
    signal?: AbortSignal,
  ): Promise<LibraryGroupedSearchResults> {
    const search = new URLSearchParams({ q: query });
    return this.request(`/api/library/search?${search.toString()}`, {
      ...(signal ? { signal } : {}),
    });
  }

  searchCategory(
    category: LibrarySearchCategory,
    query: string,
    cursor: string | null = null,
    limit = 48,
    signal?: AbortSignal,
  ): Promise<LibraryCategorySearchResults> {
    const search = new URLSearchParams({ q: query, limit: String(limit) });
    if (cursor) search.set("cursor", cursor);
    return this.request(
      `/api/library/search/${category}?${search.toString()}`,
      { ...(signal ? { signal } : {}) },
    );
  }

  play(request: LibraryContextRequest): Promise<LibraryQueueActionResponse> {
    return this.request("/api/library/play", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  queue(request: LibraryContextRequest): Promise<LibraryQueueActionResponse> {
    return this.request("/api/library/queue", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  queueTrack(trackId: string): Promise<LibraryQueueActionResponse> {
    return this.request("/api/library/tracks/queue", {
      method: "POST",
      body: JSON.stringify({ trackId }),
    });
  }

  playlists(cursor: string | null = null, limit = 100): Promise<PlaylistPage> {
    return this.request(this.pagePath("/api/library/playlists", cursor, limit));
  }

  playlist(playlistId: string): Promise<PlaylistDetail> {
    return this.request(
      `/api/library/playlists/${encodeURIComponent(playlistId)}`,
    );
  }

  createPlaylist(name: string): Promise<PlaylistSummary> {
    return this.request("/api/library/playlists", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  renamePlaylist(playlistId: string, name: string): Promise<PlaylistSummary> {
    return this.request(
      `/api/library/playlists/${encodeURIComponent(playlistId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name }),
      },
    );
  }

  deletePlaylist(
    playlistId: string,
  ): Promise<{ readonly removedCount: number }> {
    return this.request(
      `/api/library/playlists/${encodeURIComponent(playlistId)}`,
      { method: "DELETE" },
    );
  }

  addPlaylistTracks(
    playlistId: string,
    trackIds: readonly string[],
    allowDuplicates = false,
  ): Promise<PlaylistAddTracksResponse> {
    return this.request(
      `/api/library/playlists/${encodeURIComponent(playlistId)}/tracks`,
      {
        method: "POST",
        body: JSON.stringify({ trackIds, allowDuplicates }),
      },
    );
  }

  removePlaylistItem(
    playlistId: string,
    itemId: string,
  ): Promise<{ readonly removedCount: number }> {
    return this.request(
      `/api/library/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    );
  }

  reorderPlaylist(
    playlistId: string,
    itemIds: readonly string[],
  ): Promise<PlaylistDetail> {
    return this.request(
      `/api/library/playlists/${encodeURIComponent(playlistId)}/reorder`,
      {
        method: "POST",
        body: JSON.stringify({ itemIds }),
      },
    );
  }

  playPlaylist(
    playlistId: string,
    selectedItemId?: string,
  ): Promise<LibraryQueueActionResponse> {
    return this.request(
      `/api/library/playlists/${encodeURIComponent(playlistId)}/play`,
      {
        method: "POST",
        body: JSON.stringify(selectedItemId ? { selectedItemId } : {}),
      },
    );
  }

  queuePlaylist(playlistId: string): Promise<LibraryQueueActionResponse> {
    return this.request(
      `/api/library/playlists/${encodeURIComponent(playlistId)}/queue`,
      {
        method: "POST",
        body: "{}",
      },
    );
  }

  artworkUrl(trackId: string): string {
    return `${apiBaseUrl}/api/library/tracks/${encodeURIComponent(trackId)}/artwork`;
  }

  scan(request: LibraryScanRequest = {}): Promise<IndexedLibrarySnapshot> {
    return this.request("/api/library/scan", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  cancel(
    request: LibraryCancelScanRequest = {},
  ): Promise<IndexedLibrarySnapshot> {
    return this.request("/api/library/scan/cancel", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  acknowledgeRecovery(): Promise<void> {
    return this.request("/api/library/recovery/acknowledge", {
      method: "POST",
      body: "{}",
    });
  }

  subscribe(
    onSnapshot: (snapshot: IndexedLibrarySnapshot) => void,
    onConnectionError: () => void,
  ): () => void {
    const source = new EventSource(`${apiBaseUrl}/api/library/events`);
    source.onmessage = (event) => {
      try {
        if (typeof event.data !== "string") throw new Error("Invalid event");
        onSnapshot(JSON.parse(event.data) as IndexedLibrarySnapshot);
      } catch {
        onConnectionError();
      }
    };
    source.onerror = onConnectionError;
    return () => {
      source.close();
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const requestInit: RequestInit = { ...init };
    if (init.body !== undefined) {
      const headers = new Headers(init.headers);
      headers.set("content-type", "application/json");
      requestInit.headers = headers;
    }
    const response = await fetch(`${apiBaseUrl}${path}`, requestInit);
    const payload = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new PlayerApiError(
        error?.code ?? "REQUEST_FAILED",
        error?.message ?? "Library request failed.",
      );
    }
    return payload.data as T;
  }

  private pagePath(
    path: string,
    cursor: string | null,
    limit: number,
    cursorName = "cursor",
  ): string {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set(cursorName, cursor);
    return `${path}?${query.toString()}`;
  }
}
