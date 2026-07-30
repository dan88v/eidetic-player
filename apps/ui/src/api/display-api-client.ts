import type { ApiResponse } from "../../../../packages/shared/src/player";
import type {
  DisplaySnapshot,
  ScreenDimLevelPercent,
} from "../../../../packages/shared/src/display";
import { config } from "../config";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class DisplayApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DisplayApiError";
  }
}

export class DisplayApiClient {
  state(): Promise<DisplaySnapshot> {
    return this.request("/api/display/state", { method: "GET" });
  }

  dim(levelPercent: ScreenDimLevelPercent): Promise<DisplaySnapshot> {
    return this.post("/api/display/dim", { levelPercent });
  }

  standby(): Promise<DisplaySnapshot> {
    return this.post("/api/display/standby", {});
  }

  wake(): Promise<DisplaySnapshot> {
    return this.post("/api/display/wake", {});
  }

  testDim(levelPercent: ScreenDimLevelPercent): Promise<DisplaySnapshot> {
    return this.post("/api/display/test/dim", { levelPercent });
  }

  testStandby(): Promise<DisplaySnapshot> {
    return this.post("/api/display/test/standby", {});
  }

  private post(path: string, body: unknown): Promise<DisplaySnapshot> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<DisplaySnapshot> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(5_000),
    });
    const payload = (await response.json()) as ApiResponse<DisplaySnapshot>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new DisplayApiError(
        error?.code ?? "DISPLAY_REQUEST_FAILED",
        error?.message ?? "Display control failed.",
        response.status,
      );
    }
    if (!payload.data)
      throw new DisplayApiError(
        "DISPLAY_EMPTY_RESPONSE",
        "Display response was empty.",
        response.status,
      );
    return payload.data;
  }
}
