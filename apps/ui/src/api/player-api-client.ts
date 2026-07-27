import type {
  ApiResponse,
  ApiSuccess,
  PlayerState,
  RepeatMode,
  ArtworkRef,
} from "../../../../packages/shared/src/player";
import { config } from "../config";
import type {
  BuildInfo,
  SystemCapabilities,
} from "../../../../packages/shared/src/system";
import type { AudioOutputState } from "../../../../packages/shared/src/audio-output";

export interface AppBootstrap {
  readonly playerState: PlayerState;
  readonly audioOutput: AudioOutputState;
  readonly system: SystemCapabilities;
  readonly buildInfo: BuildInfo;
}

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

export class PlayerApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlayerApiError";
  }
}

export class PlayerApiClient {
  private readonly baseUrl = apiBaseUrl;

  async getState(): Promise<PlayerState> {
    const response = await fetch(`${this.baseUrl}/api/player/state`);
    const payload = await this.parse<PlayerState>(response);
    if (!payload.data)
      throw new PlayerApiError(
        "EMPTY_RESPONSE",
        "The player returned no state.",
      );
    return payload.data;
  }

  async bootstrap(signal?: AbortSignal): Promise<AppBootstrap> {
    const response = await fetch(
      `${this.baseUrl}/api/bootstrap`,
      signal ? { signal } : undefined,
    );
    const payload = await this.parse<AppBootstrap>(response);
    if (!payload.data)
      throw new PlayerApiError(
        "EMPTY_RESPONSE",
        "The player returned no bootstrap state.",
      );
    return payload.data;
  }

  subscribe(
    onState: (state: PlayerState) => void,
    onConnectionError: () => void,
    onAudioOutputState?: (state: AudioOutputState) => void,
  ): () => void {
    const source = new EventSource(`${this.baseUrl}/api/player/events`);
    source.onmessage = (event) => {
      try {
        if (typeof event.data !== "string")
          throw new Error("Invalid SSE payload");
        onState(JSON.parse(event.data) as PlayerState);
      } catch {
        onConnectionError();
      }
    };
    source.addEventListener("audio-output", (event) => {
      try {
        if (typeof event.data !== "string")
          throw new Error("Invalid SSE payload");
        onAudioOutputState?.(JSON.parse(event.data) as AudioOutputState);
      } catch {
        onConnectionError();
      }
    });
    source.onerror = onConnectionError;
    return () => {
      source.close();
    };
  }

  open(paths: readonly string[]): Promise<void> {
    return this.post("open", { paths });
  }
  playPause(): Promise<void> {
    return this.post("play-pause", {});
  }
  play(): Promise<void> {
    return this.post("play", {});
  }
  pause(): Promise<void> {
    return this.post("pause", {});
  }
  previous(): Promise<void> {
    return this.post("previous", {});
  }
  next(): Promise<void> {
    return this.post("next", {});
  }
  seek(positionSeconds: number): Promise<void> {
    return this.post("seek", { positionSeconds });
  }
  volume(volume: number): Promise<void> {
    return this.post("volume", { volume });
  }
  mute(muted: boolean): Promise<void> {
    return this.post("mute", { muted });
  }
  shuffle(enabled: boolean): Promise<void> {
    return this.post("shuffle", { enabled });
  }
  repeat(mode: RepeatMode): Promise<void> {
    return this.post("repeat", { mode });
  }
  playQueue(index: number): Promise<void> {
    return this.post("queue/play", { index });
  }
  appendQueue(paths: readonly string[]): Promise<void> {
    return this.post("queue/append", { paths });
  }
  removeQueueItem(queueItemId: string): Promise<void> {
    return this.post("queue/remove", { queueItemId });
  }
  reorderQueueItem(queueItemId: string, toIndex: number): Promise<void> {
    return this.post("queue/reorder", { queueItemId, toIndex });
  }
  clearQueue(): Promise<void> {
    return this.post("queue/clear", {});
  }

  private async post(path: string, body: unknown): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/player/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await this.parse(response);
  }

  private async parse<T>(response: Response): Promise<ApiSuccess<T>> {
    const payload = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new PlayerApiError(
        error?.code ?? "REQUEST_FAILED",
        error?.message ?? "Player request failed.",
      );
    }
    return payload;
  }
}

export function artworkUrl(artwork: ArtworkRef): string {
  return `${apiBaseUrl}/api/artwork/${encodeURIComponent(artwork.id)}`;
}

export function queueArtworkUrl(queueItemId: string): string {
  return `${apiBaseUrl}/api/player/queue/${encodeURIComponent(queueItemId)}/artwork`;
}
