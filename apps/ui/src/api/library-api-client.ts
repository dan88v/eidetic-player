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
