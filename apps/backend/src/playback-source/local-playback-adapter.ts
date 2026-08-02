import { randomUUID } from "node:crypto";
import type { AudioOutputService } from "../audio-output/audio-output-service.js";
import type { AudioProcessingService } from "../audio-processing/audio-processing-service.js";
import type {
  LocalPlaybackSuspensionSnapshot,
  PlayerService,
} from "../player/player-service.js";
import type { PlayerSessionService } from "../player-session/player-session-service.js";
import type { ExternalPlaybackRoute } from "./external-playback-provider.js";
import { PlaybackSourceError } from "./playback-source-error.js";
import type { ActivePlaybackOutput } from "../../../../packages/shared/src/playback-source.js";

export interface LocalPlaybackSuspensionToken {
  readonly suspensionId: string;
  readonly player: LocalPlaybackSuspensionSnapshot;
  readonly playerSessionRevision: number;
  readonly currentPlaybackOccurrenceId: string | null;
  readonly currentTrackGeneration: number;
  readonly positionSeconds: number;
  readonly wasPlaying: boolean;
  readonly wasPaused: boolean;
  readonly outputRouteRevision: number;
  readonly capturedAt: string;
}

export class LocalPlaybackAdapter {
  constructor(
    private readonly player: PlayerService,
    private readonly playerSession: PlayerSessionService,
    private readonly audioOutput: AudioOutputService,
    private readonly audioProcessing: AudioProcessingService,
  ) {}

  snapshot(): ReturnType<PlayerService["getPublicState"]> {
    return this.player.getPublicState();
  }

  subscribe(listener: () => void): () => void {
    return this.player.subscribe(() => {
      listener();
    });
  }

  output(): ActivePlaybackOutput {
    const state = this.audioOutput.snapshot();
    const selected = state.canonicalOutputs.find(
      (candidate) => candidate.id === state.selectedPhysicalOutputId,
    );
    const processing = this.audioProcessing.snapshot().preferences;
    return {
      description: selected?.description ?? state.preferredDevice.description,
      levelMode: processing.outputLevelMode,
      maximumSoftwareVolume: processing.maximumSoftwareVolume,
    };
  }

  async captureSuspension(): Promise<LocalPlaybackSuspensionToken> {
    await this.playerSession.flush();
    const player = this.player.captureExternalPlaybackSuspension();
    return {
      suspensionId: `local-suspension-${randomUUID()}`,
      player,
      playerSessionRevision: player.playbackPlanRevision,
      currentPlaybackOccurrenceId: player.playbackInstanceId,
      currentTrackGeneration: player.trackTransitionId,
      positionSeconds: player.positionSeconds,
      wasPlaying: player.wasPlaying,
      wasPaused: player.wasPaused,
      outputRouteRevision: this.audioOutput.snapshot().revision,
      capturedAt: new Date().toISOString(),
    };
  }

  routeForExternalPlayback(): ExternalPlaybackRoute {
    const state = this.audioOutput.snapshot();
    const output = state.canonicalOutputs.find(
      (candidate) => candidate.id === state.selectedPhysicalOutputId,
    );
    if (!output || output.systemDefault || !output.available)
      throw new PlaybackSourceError(
        "EXTERNAL_OUTPUT_ROUTE_UNAVAILABLE",
        "Select an available physical audio output before using an external source.",
      );
    const route =
      output.routes.find(
        (candidate) =>
          candidate.id === state.preferredDevice.deviceId &&
          candidate.available,
      ) ?? output.routes.find((candidate) => candidate.available);
    if (!route)
      throw new PlaybackSourceError(
        "EXTERNAL_OUTPUT_ROUTE_UNAVAILABLE",
        "The selected audio output has no compatible route.",
      );
    const processing = this.audioProcessing.snapshot().preferences;
    return {
      physicalOutputId: output.id,
      description: output.description,
      routeKind:
        route.kind === "pipewire" ||
        route.kind === "pulse" ||
        route.kind === "alsa"
          ? route.kind
          : "other",
      providerTarget: route.id,
      levelMode: processing.outputLevelMode,
      maximumSoftwareVolume: processing.maximumSoftwareVolume,
      availabilityRevision: state.revision,
    };
  }

  releaseAudioOutput(): Promise<void> {
    return this.player.releaseAudioOutputForExternalPlayback();
  }

  async restoreAudioOutput(
    token: LocalPlaybackSuspensionToken,
    resume: boolean,
  ): Promise<void> {
    await this.audioOutput.prepareForPlayback();
    await this.player.restoreAudioOutputAfterExternalPlayback(
      token.player,
      false,
    );
    await this.audioProcessing.recoverAfterMpvRestart();
    if (resume && this.player.getPlaybackPlanSnapshot().current)
      await this.player.play();
  }
}
