import type {
  PlayerCommandRequestMetadata,
  RepeatMode,
} from "../../../../packages/shared/src/player.js";
import type { AudioProcessingService } from "../audio-processing/audio-processing-service.js";
import type { PersistedQueueOrigin } from "../player-session/player-session-types.js";
import type { PlayerService } from "../player/player-service.js";
import type { PlaybackSourceArbiter } from "./playback-source-arbiter.js";
import { PlaybackSourceError } from "./playback-source-error.js";

export class ActivePlaybackController {
  constructor(
    private readonly player: PlayerService,
    private readonly audioProcessing: AudioProcessingService,
    private readonly arbiter: PlaybackSourceArbiter,
  ) {}

  async requestLocalOwnership(): Promise<void> {
    await this.arbiter.requestLocalOwnership(false);
  }

  async resumeLocalPlayback(): Promise<void> {
    await this.arbiter.resumeLocalPlayback();
  }

  async playPause(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    if (this.arbiter.snapshot().activeSource === "local")
      return this.player.playPause(metadata);
    if (this.arbiter.snapshot().providerState === "playing")
      return this.arbiter.pause(metadata);
    return this.arbiter.play(metadata);
  }

  async play(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    if (this.arbiter.snapshot().activeSource === "local")
      return this.player.play(metadata);
    return this.arbiter.play(metadata);
  }

  async pause(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    if (this.arbiter.snapshot().activeSource === "local")
      return this.player.pause(metadata);
    return this.arbiter.pause(metadata);
  }

  async previous(
    metadata?: PlayerCommandRequestMetadata,
    targetQueueItemId?: string | null,
  ): Promise<void> {
    if (this.arbiter.snapshot().activeSource === "local")
      return this.player.previous(metadata, targetQueueItemId);
    return this.arbiter.previous(metadata);
  }

  async next(
    metadata?: PlayerCommandRequestMetadata,
    targetQueueItemId?: string | null,
  ): Promise<void> {
    if (this.arbiter.snapshot().activeSource === "local")
      return this.player.next(metadata, targetQueueItemId);
    return this.arbiter.next(metadata);
  }

  async seek(
    positionSeconds: number,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    if (this.arbiter.snapshot().activeSource === "local")
      return this.player.seek(positionSeconds);
    return this.arbiter.seek(positionSeconds, metadata);
  }

  async setVolume(
    volume: number,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    if (this.arbiter.snapshot().activeSource === "local")
      return this.audioProcessing.setVolume(volume, metadata);
    return this.arbiter.setVolume(volume, metadata);
  }

  async setMuted(
    muted: boolean,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    if (this.arbiter.snapshot().activeSource === "local")
      return this.audioProcessing.setMuted(muted, metadata);
    return this.arbiter.setMuted(muted, metadata);
  }

  async playQueueIndex(
    index: number,
    resolveOrigin: (origin: PersistedQueueOrigin) => Promise<string>,
    queueItemId?: string,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    await this.requestLocalOwnership();
    await this.player.playQueueIndex(
      index,
      resolveOrigin,
      queueItemId,
      metadata,
    );
  }

  setShuffle(enabled: boolean): Promise<void> {
    if (this.arbiter.snapshot().activeSource !== "local")
      throw new PlaybackSourceError(
        "SOURCE_ACTION_NOT_SUPPORTED",
        "Shuffle is not supported by the active external source.",
      );
    return this.player.setShuffle(enabled);
  }

  setRepeatMode(mode: RepeatMode): Promise<void> {
    if (this.arbiter.snapshot().activeSource !== "local")
      throw new PlaybackSourceError(
        "SOURCE_ACTION_NOT_SUPPORTED",
        "Repeat is not supported by the active external source.",
      );
    return this.player.setRepeatMode(mode);
  }
}
