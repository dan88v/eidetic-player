import type {
  AddLocalSourceResponse,
  DirectoryBrowseResponse,
  LibraryMetadataSummary,
  LibrarySource,
  OpenLibraryEntryResponse,
  SourceListResponse,
  FolderArtworkPreview,
  DirectoryQueueResponse,
} from "../../../../packages/shared/src/library";
import type {
  ApiResponse,
  PlaybackContextQueueDecision,
} from "../../../../packages/shared/src/player";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";
import type { ContextPlayDecisionProvider } from "./context-play-decision";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class FoldersApiClient {
  constructor(
    private readonly decideContextPlay?: ContextPlayDecisionProvider,
  ) {}

  listSources(): Promise<SourceListResponse> {
    return this.request("/api/sources");
  }

  addLocalSource(nativePath: string): Promise<AddLocalSourceResponse> {
    return this.request("/api/sources/local", {
      method: "POST",
      body: JSON.stringify({ nativePath }),
    });
  }

  renameSource(sourceId: string, displayName: string): Promise<LibrarySource> {
    return this.request(`/api/sources/${encodeURIComponent(sourceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    });
  }

  removeSource(sourceId: string): Promise<void> {
    return this.request(`/api/sources/${encodeURIComponent(sourceId)}`, {
      method: "DELETE",
      body: "{}",
    });
  }

  retrySource(sourceId: string): Promise<LibrarySource> {
    return this.request(`/api/sources/${encodeURIComponent(sourceId)}/retry`, {
      method: "POST",
      body: "{}",
    });
  }

  browse(
    sourceId: string,
    relativePath = "",
  ): Promise<DirectoryBrowseResponse> {
    const query = new URLSearchParams({ relativePath });
    return this.request(
      `/api/sources/${encodeURIComponent(sourceId)}/browse?${query.toString()}`,
    );
  }

  metadata(
    sourceId: string,
    entryId: string,
    signal?: AbortSignal,
  ): Promise<LibraryMetadataSummary> {
    const init: RequestInit = signal === undefined ? {} : { signal };
    return this.request(
      `/api/sources/${encodeURIComponent(sourceId)}/entries/${encodeURIComponent(entryId)}/metadata`,
      init,
    );
  }

  async openEntry(
    sourceId: string,
    entryId: string,
  ): Promise<OpenLibraryEntryResponse> {
    const queueDecision = await this.contextPlayDecision();
    if (queueDecision === null)
      return { selectedIndex: 0, queueLength: 0, cancelled: true };
    return this.request(
      `/api/sources/${encodeURIComponent(sourceId)}/entries/${encodeURIComponent(entryId)}/open`,
      { method: "POST", body: JSON.stringify(queueDecision ?? {}) },
    );
  }

  addEntryToQueue(
    sourceId: string,
    entryId: string,
  ): Promise<DirectoryQueueResponse> {
    return this.request(
      `/api/sources/${encodeURIComponent(sourceId)}/entries/${encodeURIComponent(entryId)}/queue`,
      { method: "POST", body: "{}" },
    );
  }

  folderArtwork(
    sourceId: string,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<FolderArtworkPreview> {
    const query = new URLSearchParams({ relativePath });
    return this.request(
      `/api/sources/${encodeURIComponent(sourceId)}/folder-artwork?${query.toString()}`,
      signal ? { signal } : {},
    );
  }

  async playDirectory(
    sourceId: string,
    relativePath: string,
  ): Promise<DirectoryQueueResponse> {
    const queueDecision = await this.contextPlayDecision();
    if (queueDecision === null)
      return { queueLength: 0, appendedCount: 0, cancelled: true };
    return this.directoryAction(sourceId, relativePath, "play", queueDecision);
  }

  addDirectoryToQueue(
    sourceId: string,
    relativePath: string,
  ): Promise<DirectoryQueueResponse> {
    return this.directoryAction(sourceId, relativePath, "queue");
  }

  private directoryAction(
    sourceId: string,
    relativePath: string,
    action: "play" | "queue",
    queueDecision?: PlaybackContextQueueDecision,
  ): Promise<DirectoryQueueResponse> {
    return this.request(
      `/api/sources/${encodeURIComponent(sourceId)}/directory/${action}`,
      {
        method: "POST",
        body: JSON.stringify({ relativePath, ...(queueDecision ?? {}) }),
      },
    );
  }

  private contextPlayDecision(): Promise<
    PlaybackContextQueueDecision | null | undefined
  > {
    return this.decideContextPlay?.() ?? Promise.resolve(undefined);
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
        error?.message ?? "Folders request failed.",
      );
    }
    return payload.data as T;
  }
}
