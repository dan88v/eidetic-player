import type { ApiResponse } from "../../../../packages/shared/src/player";
import { config } from "../config";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class SystemApiClient {
  async enterMaintenanceMode(): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/system/maintenance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const payload = (await response.json()) as ApiResponse<unknown>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new Error(error?.message ?? "Maintenance mode is unavailable.");
    }
  }
}
