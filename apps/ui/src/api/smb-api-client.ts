import type {
  DirectoryBrowseResponse,
  DirectoryQueueResponse,
  FolderArtworkPreview,
  LibraryMetadataSummary,
  OpenLibraryEntryResponse,
} from "../../../../packages/shared/src/library";
import type { ApiResponse } from "../../../../packages/shared/src/player";
import type {
  AddSmbConnectionRequest,
  EditSmbConnectionRequest,
  SmbConnection,
  SmbSnapshot,
} from "../../../../packages/shared/src/smb";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class SmbApiClient {
  connections(): Promise<SmbSnapshot> {
    return this.request("/api/smb/connections");
  }

  subscribe(
    onSnapshot: (snapshot: SmbSnapshot) => void,
    onError: () => void,
  ): () => void {
    const source = new EventSource(`${apiBaseUrl}/api/smb/events`);
    source.onmessage = (event) => {
      onSnapshot(JSON.parse(String(event.data)) as SmbSnapshot);
    };
    source.onerror = onError;
    return () => {
      source.close();
    };
  }

  add(input: AddSmbConnectionRequest): Promise<SmbConnection> {
    return this.request("/api/smb/connections", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  edit(id: string, input: EditSmbConnectionRequest): Promise<SmbConnection> {
    return this.request(`/api/smb/connections/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  remove(id: string): Promise<void> {
    return this.request(`/api/smb/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: "{}",
    });
  }

  retry(id: string): Promise<SmbConnection> {
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/retry`,
      { method: "POST", body: "{}" },
    );
  }

  browse(id: string, relativePath = ""): Promise<DirectoryBrowseResponse> {
    const query = new URLSearchParams({ relativePath });
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/browse?${query.toString()}`,
    );
  }

  metadata(
    id: string,
    entryId: string,
    signal?: AbortSignal,
  ): Promise<LibraryMetadataSummary> {
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/metadata`,
      signal ? { signal } : {},
    );
  }

  openEntry(id: string, entryId: string): Promise<OpenLibraryEntryResponse> {
    return this.entryAction(id, entryId, "open");
  }

  addEntryToQueue(
    id: string,
    entryId: string,
  ): Promise<DirectoryQueueResponse> {
    return this.entryAction(id, entryId, "queue");
  }

  folderArtwork(
    id: string,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<FolderArtworkPreview> {
    const query = new URLSearchParams({ relativePath });
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/folder-artwork?${query.toString()}`,
      signal ? { signal } : {},
    );
  }

  playDirectory(
    id: string,
    relativePath: string,
  ): Promise<DirectoryQueueResponse> {
    return this.directoryAction(id, relativePath, "play");
  }

  addDirectoryToQueue(
    id: string,
    relativePath: string,
  ): Promise<DirectoryQueueResponse> {
    return this.directoryAction(id, relativePath, "queue");
  }

  private entryAction<T>(
    id: string,
    entryId: string,
    action: "open" | "queue",
  ): Promise<T> {
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/${action}`,
      { method: "POST", body: "{}" },
    );
  }

  private directoryAction(
    id: string,
    relativePath: string,
    action: "play" | "queue",
  ): Promise<DirectoryQueueResponse> {
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/directory/${action}`,
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
        error?.message ?? "Network share request failed.",
      );
    }
    return payload.data as T;
  }
}
