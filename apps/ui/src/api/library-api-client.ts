import type {
  IndexedLibrarySnapshot,
  IndexedLibraryStatus,
  LibraryCancelScanRequest,
  LibraryScanRequest,
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
}
