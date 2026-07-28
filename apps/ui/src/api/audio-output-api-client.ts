import type {
  AudioOutputSelectionResult,
  AudioOutputState,
} from "../../../../packages/shared/src/audio-output";
import type { ApiResponse } from "../../../../packages/shared/src/player";
import type {
  AudioProcessingPatch,
  AudioProcessingPatchResult,
  AudioProcessingState,
} from "../../../../packages/shared/src/audio-processing";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class AudioOutputApiClient {
  state(): Promise<AudioOutputState> {
    return this.request("/api/audio-output/state");
  }

  select(deviceId: string): Promise<AudioOutputSelectionResult> {
    return this.request("/api/audio-output/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
  }

  refresh(): Promise<AudioOutputState> {
    return this.request("/api/audio-output/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }

  processingState(): Promise<AudioProcessingState> {
    return this.request("/api/audio-processing/state");
  }

  patchProcessing(
    patch: AudioProcessingPatch,
  ): Promise<AudioProcessingPatchResult> {
    return this.request("/api/audio-processing/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, init);
    const payload = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new PlayerApiError(
        error?.code ?? "AUDIO_OUTPUT_REQUEST_FAILED",
        error?.message ?? "Audio output action failed.",
      );
    }
    return payload.data as T;
  }
}
