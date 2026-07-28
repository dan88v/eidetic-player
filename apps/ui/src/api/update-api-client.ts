import type { ApiResponse } from "../../../../packages/shared/src/player";
import type { SoftwareUpdateSnapshot } from "../../../../packages/shared/src/update";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class UpdateApiClient {
  state(): Promise<SoftwareUpdateSnapshot> {
    return this.request("/api/system/update/state");
  }

  subscribe(
    onSnapshot: (snapshot: SoftwareUpdateSnapshot) => void,
    onError: () => void,
  ): () => void {
    const source = new EventSource(`${apiBaseUrl}/api/system/update/events`);
    source.onmessage = (event) => {
      onSnapshot(JSON.parse(String(event.data)) as SoftwareUpdateSnapshot);
    };
    source.onerror = onError;
    return () => {
      source.close();
    };
  }

  refreshBranches(): Promise<SoftwareUpdateSnapshot> {
    return this.action("/api/system/update/branches/refresh", {});
  }

  selectBranch(branch: string): Promise<SoftwareUpdateSnapshot> {
    return this.action("/api/system/update/branch", { branch }, "PATCH");
  }

  check(): Promise<SoftwareUpdateSnapshot> {
    return this.action("/api/system/update/check", {});
  }

  start(
    planId: string,
    expectedTargetCommitSha: string,
  ): Promise<SoftwareUpdateSnapshot> {
    return this.action("/api/system/update/start", {
      planId,
      expectedTargetCommitSha,
    });
  }

  private action(
    path: string,
    body: object,
    method = "POST",
  ): Promise<SoftwareUpdateSnapshot> {
    return this.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, init);
    const payload =
      (await response.json()) as ApiResponse<SoftwareUpdateSnapshot>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new PlayerApiError(
        error?.code ?? "UPDATE_REQUEST_FAILED",
        error?.message ?? "Software Update could not complete the request.",
      );
    }
    if (payload.data === undefined)
      throw new PlayerApiError(
        "UPDATE_REQUEST_FAILED",
        "Software Update returned no state.",
      );
    return payload.data;
  }
}
