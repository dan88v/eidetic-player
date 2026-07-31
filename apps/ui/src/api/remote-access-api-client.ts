import type { RemoteAccessState } from "../../../../packages/shared/src/remote-access";
import type { ApiResponse } from "../../../../packages/shared/src/player";
import { config } from "../config";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class RemoteAccessApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RemoteAccessApiError";
  }
}

export class RemoteAccessApiClient {
  private readonly subscribers = new Set<(state: RemoteAccessState) => void>();

  subscribe(listener: (state: RemoteAccessState) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  receiveState(state: RemoteAccessState): void {
    for (const listener of this.subscribers) listener(state);
  }

  state(): Promise<RemoteAccessState> {
    return this.request("/api/remote-access/state", { method: "GET" });
  }

  enable(): Promise<RemoteAccessState> {
    return this.post("/api/remote-access/enable");
  }

  disable(): Promise<RemoteAccessState> {
    return this.post("/api/remote-access/disable");
  }

  retry(): Promise<RemoteAccessState> {
    return this.post("/api/remote-access/retry");
  }

  createPairingCode(): Promise<RemoteAccessState> {
    return this.post("/api/remote-access/pairing-code");
  }

  cancelPairingCode(): Promise<RemoteAccessState> {
    return this.delete("/api/remote-access/pairing-code");
  }

  revokeDevice(deviceId: string): Promise<RemoteAccessState> {
    return this.delete(
      `/api/remote-access/devices/${encodeURIComponent(deviceId)}`,
    );
  }

  revokeAll(): Promise<RemoteAccessState> {
    return this.delete("/api/remote-access/devices");
  }

  private post(path: string): Promise<RemoteAccessState> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }

  private delete(path: string): Promise<RemoteAccessState> {
    return this.request(path, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<RemoteAccessState> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(8_000),
    });
    const payload = (await response.json()) as ApiResponse<RemoteAccessState>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new RemoteAccessApiError(
        error?.code ?? "REMOTE_ACCESS_REQUEST_FAILED",
        error?.message ?? "Remote access action failed.",
        response.status,
      );
    }
    if (!payload.data)
      throw new RemoteAccessApiError(
        "REMOTE_ACCESS_EMPTY_RESPONSE",
        "Remote access response was empty.",
        response.status,
      );
    return payload.data;
  }
}
