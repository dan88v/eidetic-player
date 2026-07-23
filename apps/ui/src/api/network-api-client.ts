import type {
  NetworkSnapshot,
  WifiHiddenConnectRequest,
  WifiRadioRequest,
} from "../../../../packages/shared/src/network";
import type { ApiResponse } from "../../../../packages/shared/src/player";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class NetworkApiClient {
  state(): Promise<NetworkSnapshot> {
    return this.request("/api/network/state");
  }
  subscribe(
    onSnapshot: (snapshot: NetworkSnapshot) => void,
    onError: () => void,
  ): () => void {
    const source = new EventSource(`${apiBaseUrl}/api/network/events`);
    source.onmessage = (event) => {
      onSnapshot(JSON.parse(String(event.data)) as NetworkSnapshot);
    };
    source.onerror = onError;
    return () => {
      source.close();
    };
  }
  scan(adapterId: string): Promise<void> {
    return this.action("/api/network/wifi/scan", { adapterId });
  }
  setRadio(request: WifiRadioRequest): Promise<void> {
    return this.action("/api/network/wifi/radio", request);
  }
  connect(
    adapterId: string,
    networkId: string,
    password?: string,
  ): Promise<void> {
    return this.action("/api/network/wifi/connect", {
      adapterId,
      networkId,
      ...(password === undefined ? {} : { password }),
    });
  }
  connectHidden(request: WifiHiddenConnectRequest): Promise<void> {
    return this.action("/api/network/wifi/connect-hidden", request);
  }
  disconnect(adapterId: string): Promise<void> {
    return this.action("/api/network/wifi/disconnect", { adapterId });
  }
  forget(adapterId: string): Promise<void> {
    return this.action(
      "/api/network/wifi/managed-profile",
      { adapterId },
      "DELETE",
    );
  }
  private action(path: string, body: object, method = "POST"): Promise<void> {
    return this.request(path, {
      method,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, init);
    const payload = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new PlayerApiError(
        error?.code ?? "NETWORK_REQUEST_FAILED",
        error?.message ?? "Network action failed.",
      );
    }
    return payload.data as T;
  }
}
