import type {
  AddRemovableLibrarySourceResponse,
  DirectoryBrowseResponse,
  DirectoryQueueResponse,
  FolderArtworkPreview,
  LibraryMetadataSummary,
  OpenLibraryEntryResponse,
  RemovableDeviceListResponse,
  RemovableLibraryCoverage,
} from "../../../../packages/shared/src/library";
import type { ApiResponse } from "../../../../packages/shared/src/player";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class RemovableStorageApiClient {
  devices(): Promise<RemovableDeviceListResponse> {
    return this.request("/api/removable-storage/devices");
  }

  subscribe(
    onSnapshot: (snapshot: RemovableDeviceListResponse) => void,
    onError: () => void,
  ): () => void {
    const source = new EventSource(
      `${apiBaseUrl}/api/removable-storage/events`,
    );
    source.onmessage = (event) => {
      onSnapshot(JSON.parse(String(event.data)) as RemovableDeviceListResponse);
    };
    source.onerror = onError;
    return () => {
      source.close();
    };
  }

  browse(
    deviceId: string,
    relativePath = "",
  ): Promise<DirectoryBrowseResponse> {
    const query = new URLSearchParams({ relativePath });
    return this.request(
      `/api/removable-storage/${encodeURIComponent(deviceId)}/browse?${query.toString()}`,
    );
  }

  metadata(
    deviceId: string,
    entryId: string,
    signal?: AbortSignal,
  ): Promise<LibraryMetadataSummary> {
    return this.request(
      `/api/removable-storage/${encodeURIComponent(deviceId)}/entries/${encodeURIComponent(entryId)}/metadata`,
      signal ? { signal } : {},
    );
  }

  openEntry(
    deviceId: string,
    entryId: string,
  ): Promise<OpenLibraryEntryResponse> {
    return this.entryAction(deviceId, entryId, "open");
  }

  addEntryToQueue(
    deviceId: string,
    entryId: string,
  ): Promise<DirectoryQueueResponse> {
    return this.entryAction(deviceId, entryId, "queue");
  }

  folderArtwork(
    deviceId: string,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<FolderArtworkPreview> {
    const query = new URLSearchParams({ relativePath });
    return this.request(
      `/api/removable-storage/${encodeURIComponent(deviceId)}/folder-artwork?${query.toString()}`,
      signal ? { signal } : {},
    );
  }

  playDirectory(
    deviceId: string,
    relativePath: string,
  ): Promise<DirectoryQueueResponse> {
    return this.directoryAction(deviceId, relativePath, "play");
  }

  addDirectoryToQueue(
    deviceId: string,
    relativePath: string,
  ): Promise<DirectoryQueueResponse> {
    return this.directoryAction(deviceId, relativePath, "queue");
  }

  libraryCoverage(
    deviceId: string,
    logicalRelativePath: string,
  ): Promise<RemovableLibraryCoverage> {
    const query = new URLSearchParams({ logicalRelativePath });
    return this.request(
      `/api/removable-storage/${encodeURIComponent(deviceId)}/library-sources?${query.toString()}`,
    );
  }

  addLibrarySource(
    deviceId: string,
    logicalRelativePath: string,
  ): Promise<AddRemovableLibrarySourceResponse> {
    return this.request(
      `/api/removable-storage/${encodeURIComponent(deviceId)}/library-sources`,
      {
        method: "POST",
        body: JSON.stringify({ logicalRelativePath }),
      },
    );
  }

  private entryAction<T>(
    deviceId: string,
    entryId: string,
    action: "open" | "queue",
  ): Promise<T> {
    return this.request(
      `/api/removable-storage/${encodeURIComponent(deviceId)}/entries/${encodeURIComponent(entryId)}/${action}`,
      { method: "POST", body: "{}" },
    );
  }

  private directoryAction(
    deviceId: string,
    relativePath: string,
    action: "play" | "queue",
  ): Promise<DirectoryQueueResponse> {
    return this.request(
      `/api/removable-storage/${encodeURIComponent(deviceId)}/directory/${action}`,
      { method: "POST", body: JSON.stringify({ relativePath }) },
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
        error?.message ?? "USB storage request failed.",
      );
    }
    return payload.data as T;
  }
}
