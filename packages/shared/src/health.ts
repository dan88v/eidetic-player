export interface HealthResponse {
  readonly status: "ok";
  readonly environment: "development" | "production";
}

export type ReadinessStatus = "starting" | "ready" | "degraded";

export interface StartingReadinessResponse {
  readonly status: "starting";
  readonly playerStatus: string;
  readonly mpvAvailable: boolean;
  readonly errorCode?: undefined;
}

export interface SettledReadinessResponse {
  readonly status: "ready" | "degraded";
  readonly playerStatus: string;
  readonly mpvAvailable: boolean;
  readonly errorCode: string | null;
}

export type ReadinessResponse =
  StartingReadinessResponse | SettledReadinessResponse;
