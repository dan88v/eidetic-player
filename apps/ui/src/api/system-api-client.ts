import type { ApiResponse } from "../../../../packages/shared/src/player";
import type { SystemPowerAction } from "../../../../packages/shared/src/system";
import { config } from "../config";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class SystemApiClient {
  async requestPowerAction(action: SystemPowerAction): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/system/power`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const payload = (await response.json()) as ApiResponse<unknown>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new Error(error?.message ?? "The system action failed.");
    }
  }

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
