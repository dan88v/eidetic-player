import type {
  AirPlaySettingsPatch,
  AirPlayState,
} from "../../../../packages/shared/src/airplay";
import type { ApiResponse } from "../../../../packages/shared/src/player";
import { config } from "../config";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class AirPlayApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AirPlayApiError";
  }
}

export class AirPlayApiClient {
  state(): Promise<AirPlayState> {
    return this.request("/api/airplay/state", { method: "GET" });
  }

  patch(settings: AirPlaySettingsPatch): Promise<AirPlayState> {
    return this.request("/api/airplay/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<AirPlayState> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(8_000),
    });
    const payload = (await response.json()) as ApiResponse<AirPlayState>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new AirPlayApiError(
        error?.code ?? "AIRPLAY_REQUEST_FAILED",
        error?.message ?? "AirPlay settings could not be updated.",
        response.status,
      );
    }
    if (!payload.data)
      throw new AirPlayApiError(
        "AIRPLAY_EMPTY_RESPONSE",
        "AirPlay response was empty.",
        response.status,
      );
    return payload.data;
  }
}
