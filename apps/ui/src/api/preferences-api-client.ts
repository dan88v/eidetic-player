import type { ApiResponse } from "../../../../packages/shared/src/player";
import type {
  LegacyPreferencesMigration,
  PreferencesPatch,
  PreferencesSnapshot,
} from "../../../../packages/shared/src/preferences";
import { config } from "../config";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class PreferencesApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PreferencesApiError";
  }
}

export class PreferencesApiClient {
  async get(signal?: AbortSignal): Promise<PreferencesSnapshot> {
    return this.request("/api/preferences", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
  }

  async patch(patch: PreferencesPatch): Promise<PreferencesSnapshot> {
    return this.request("/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async migrateLegacy(
    migration: LegacyPreferencesMigration,
    signal?: AbortSignal,
  ): Promise<PreferencesSnapshot> {
    return this.request("/api/preferences/migrate-legacy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(migration),
      ...(signal ? { signal } : {}),
    });
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<PreferencesSnapshot> {
    const timeout = AbortSignal.timeout(3_000);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    const response = await fetch(`${apiBaseUrl}${path}`, { ...init, signal });
    const payload = (await response.json()) as ApiResponse<PreferencesSnapshot>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new PreferencesApiError(
        error?.code ?? "PREFERENCES_REQUEST_FAILED",
        error?.message ?? "Settings request failed.",
        response.status,
      );
    }
    const data = payload.data;
    if (!data)
      throw new PreferencesApiError(
        "PREFERENCES_EMPTY_RESPONSE",
        "Settings response was empty.",
        response.status,
      );
    return data;
  }
}
