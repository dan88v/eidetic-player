export interface HealthResponse {
  readonly status: "ok";
  readonly environment: "development" | "production";
}
