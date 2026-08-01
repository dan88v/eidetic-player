import type {
  AddSmbLibrarySourceResponse,
  DirectoryBrowseResponse,
  DirectoryQueueResponse,
  FolderArtworkPreview,
  LibraryMetadataSummary,
  OpenLibraryEntryResponse,
  SmbLibraryCoverage,
} from "../../../../packages/shared/src/library";
import type {
  ApiResponse,
  PlaybackContextQueueDecision,
} from "../../../../packages/shared/src/player";
import type {
  AddSmbConnectionRequest,
  EditSmbConnectionRequest,
  SmbConnection,
  SmbSnapshot,
} from "../../../../packages/shared/src/smb";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";
import type { ContextPlayDecisionProvider } from "./context-play-decision";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class SmbApiClient {
  constructor(
    private readonly decideContextPlay?: ContextPlayDecisionProvider,
  ) {}

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

  libraryCoverage(
    id: string,
    logicalRelativePath: string,
  ): Promise<SmbLibraryCoverage> {
    const query = new URLSearchParams({ logicalRelativePath });
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/library-coverage?${query.toString()}`,
    );
  }

  addLibrarySource(
    id: string,
    logicalRelativePath: string,
  ): Promise<AddSmbLibrarySourceResponse> {
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/library-sources`,
      {
        method: "POST",
        body: JSON.stringify({ logicalRelativePath }),
      },
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

  async openEntry(
    id: string,
    entryId: string,
  ): Promise<OpenLibraryEntryResponse> {
    const queueDecision = await this.contextPlayDecision();
    if (queueDecision === null)
      return { selectedIndex: 0, queueLength: 0, cancelled: true };
    return this.entryAction(id, entryId, "open", queueDecision);
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

  async playDirectory(
    id: string,
    relativePath: string,
  ): Promise<DirectoryQueueResponse> {
    const queueDecision = await this.contextPlayDecision();
    if (queueDecision === null)
      return { queueLength: 0, appendedCount: 0, cancelled: true };
    return this.directoryAction(id, relativePath, "play", queueDecision);
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
    queueDecision?: PlaybackContextQueueDecision,
  ): Promise<T> {
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/${action}`,
      { method: "POST", body: JSON.stringify(queueDecision ?? {}) },
    );
  }

  private directoryAction(
    id: string,
    relativePath: string,
    action: "play" | "queue",
    queueDecision?: PlaybackContextQueueDecision,
  ): Promise<DirectoryQueueResponse> {
    return this.request(
      `/api/smb/connections/${encodeURIComponent(id)}/directory/${action}`,
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
        error?.message ?? "Network share request failed.",
      );
    }
    return payload.data as T;
  }
}
