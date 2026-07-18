import type {
  AddLocalSourceResponse,
  DirectoryBrowseResponse,
  LibraryMetadataSummary,
  LibrarySource,
  OpenLibraryEntryResponse,
  SourceListResponse,
} from "../../../../packages/shared/src/library";
import type { ApiResponse } from "../../../../packages/shared/src/player";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class LibraryApiClient {
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

  openEntry(
    sourceId: string,
    entryId: string,
  ): Promise<OpenLibraryEntryResponse> {
    return this.request(
      `/api/sources/${encodeURIComponent(sourceId)}/entries/${encodeURIComponent(entryId)}/open`,
      { method: "POST", body: "{}" },
    );
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
}
