import {
  type AudioProcessingPatch,
  type AudioProcessingPatchResult,
  type AudioProcessingPreferences,
  type AudioProcessingState,
} from "../../../../packages/shared/src/audio-processing.js";
import {
  isUiPreferenceKey,
  isValidUiPreferenceValue,
  type PreferencesSnapshot,
  type UiPreferences,
} from "../../../../packages/shared/src/preferences.js";
import type { PlayerCommandRequestMetadata } from "../../../../packages/shared/src/player.js";
import type { PreferencesStore } from "../preferences/preferences-store.js";
import { AudioProcessingError } from "./audio-processing-error.js";
import { buildAudioSignalPath, buildEideticDspFilter } from "./dsp-config.js";
import { MpvDspFilterAdapter } from "./mpv-dsp-filter-adapter.js";

const audioPreferenceKeys = [
  "outputLevelMode",
  "lastVariableVolume",
  "maximumSoftwareVolume",
  "audioProcessingEnabled",
  "channelMode",
  "balanceDb",
  "equalizerEnabled",
  "equalizerBands",
  "headroomMode",
  "manualPreampDb",
] as const;

type AudioPreferenceKey = (typeof audioPreferenceKeys)[number];

export interface AudioProcessingPlayerAdapter {
  isMpvAvailable(): boolean;
  getState(): {
    readonly volume: number;
    readonly muted: boolean;
    readonly paused: boolean;
  };
  pauseForAudioPolicy(): Promise<void>;
  setVolume(
    volume: number,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void>;
  setMuted(
    muted: boolean,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void>;
  commandMpv(command: readonly unknown[]): Promise<unknown>;
  subscribeAudioOutputProperties(
    listener: (name: string, value: unknown) => void,
  ): () => void;
}

function processingPreferences(
  preferences: UiPreferences,
): AudioProcessingPreferences {
  return {
    outputLevelMode: preferences.outputLevelMode,
    lastVariableVolume: preferences.lastVariableVolume,
    maximumSoftwareVolume: preferences.maximumSoftwareVolume,
    audioProcessingEnabled: preferences.audioProcessingEnabled,
    channelMode: preferences.channelMode,
    balanceDb: preferences.balanceDb,
    equalizerEnabled: preferences.equalizerEnabled,
    equalizerBands: preferences.equalizerBands.map((band) => ({ ...band })),
    headroomMode: preferences.headroomMode,
    manualPreampDb: preferences.manualPreampDb,
  };
}

export class AudioProcessingService {
  private preferences: AudioProcessingPreferences;
  private revision = 0;
  private operation: Promise<void> = Promise.resolve();
  private readonly dsp: MpvDspFilterAdapter;
  private unsubscribeOutput = (): void => undefined;

  constructor(
    private readonly player: AudioProcessingPlayerAdapter,
    private readonly store: PreferencesStore,
  ) {
    this.preferences = processingPreferences(store.snapshot().preferences);
    this.dsp = new MpvDspFilterAdapter(player);
  }

  async initialize(snapshot: PreferencesSnapshot): Promise<void> {
    this.preferences = processingPreferences(snapshot.preferences);
    this.unsubscribeOutput = this.player.subscribeAudioOutputProperties(
      (name) => {
        if (name !== "audio-device" && name !== "current-ao") return;
        void this.dsp
          .apply(buildEideticDspFilter(this.preferences))
          .catch(() => {
            console.warn("[audio-processing] DSP reapply failed");
          });
      },
    );
    await this.applyRuntimePolicy();
    this.revision += 1;
  }

  async recoverAfterMpvRestart(): Promise<void> {
    await this.applyRuntimePolicy();
    this.revision += 1;
  }

  private async applyRuntimePolicy(): Promise<void> {
    if (!this.player.isMpvAvailable()) {
      await this.dsp.apply(buildEideticDspFilter(this.preferences));
      return;
    }
    if (this.preferences.outputLevelMode === "fixed") {
      await this.player.pauseForAudioPolicy();
      await this.player.setVolume(100);
      await this.player.setMuted(false);
    } else {
      const target = Math.min(
        this.preferences.maximumSoftwareVolume,
        this.player.getState().volume,
      );
      if (target !== this.player.getState().volume)
        await this.player.setVolume(target);
    }
    await this.dsp.apply(buildEideticDspFilter(this.preferences));
  }

  snapshot(): AudioProcessingState {
    return {
      preferences: {
        ...this.preferences,
        equalizerBands: this.preferences.equalizerBands.map((band) => ({
          ...band,
        })),
      },
      signalPath: buildAudioSignalPath(
        this.preferences,
        this.player.getState().volume,
      ),
      fixedOutputConfirmationRequired:
        this.preferences.outputLevelMode !== "fixed",
      revision: this.revision,
    };
  }

  patch(patch: AudioProcessingPatch): Promise<AudioProcessingPatchResult> {
    let result!: AudioProcessingPatchResult;
    const pending = this.operation.then(async () => {
      result = await this.patchNow(patch);
    });
    this.operation = pending.catch(() => undefined);
    return pending.then(() => result);
  }

  async setVolume(
    volume: number,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    if (this.preferences.outputLevelMode === "fixed")
      throw new AudioProcessingError(
        "FIXED_OUTPUT_LEVEL_LOCKED",
        "Software volume is disabled while Output level is Fixed.",
        409,
      );
    const limited = Math.min(volume, this.preferences.maximumSoftwareVolume);
    await this.player.setVolume(limited, metadata);
  }

  async setMuted(
    muted: boolean,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    if (this.preferences.outputLevelMode === "fixed")
      throw new AudioProcessingError(
        "FIXED_OUTPUT_LEVEL_LOCKED",
        "Mute is disabled while Output level is Fixed.",
        409,
      );
    await this.player.setMuted(muted, metadata);
  }

  close(): void {
    this.unsubscribeOutput();
  }

  private async patchNow(
    patch: AudioProcessingPatch,
  ): Promise<AudioProcessingPatchResult> {
    if (typeof patch.changes !== "object" || Array.isArray(patch.changes))
      throw this.invalid();
    const changes = patch.changes as Record<string, unknown>;
    for (const [key, value] of Object.entries(changes)) {
      if (
        !audioPreferenceKeys.includes(key as AudioPreferenceKey) ||
        !isUiPreferenceKey(key) ||
        !isValidUiPreferenceValue(key, value)
      )
        throw this.invalid();
    }
    const previous = this.preferences;
    const next: AudioProcessingPreferences = {
      ...previous,
      ...patch.changes,
      equalizerBands:
        patch.changes.equalizerBands?.map((band) => ({ ...band })) ??
        previous.equalizerBands,
    };
    const enteringFixed =
      previous.outputLevelMode !== "fixed" && next.outputLevelMode === "fixed";
    const leavingFixed =
      previous.outputLevelMode === "fixed" &&
      next.outputLevelMode === "variable";
    if (enteringFixed && patch.confirmFixedOutput !== true)
      throw new AudioProcessingError(
        "FIXED_OUTPUT_CONFIRMATION_REQUIRED",
        "Confirm that volume will be controlled by an external amplifier.",
        409,
      );
    if (next.outputLevelMode === "fixed" && "maximumSoftwareVolume" in changes)
      throw new AudioProcessingError(
        "FIXED_OUTPUT_LEVEL_LOCKED",
        "Maximum software volume applies only to Variable output.",
        409,
      );
    if (next.channelMode !== "stereo" && "balanceDb" in changes)
      throw new AudioProcessingError(
        "INVALID_AUDIO_PROCESSING",
        "Balance is available only in Stereo mode.",
      );
    const softwareVolume = this.player.getState().volume;
    const previousSignal = buildAudioSignalPath(previous, softwareVolume);
    const signal = buildAudioSignalPath(next, softwareVolume);
    const enablingPositiveGainFeature =
      (!previous.audioProcessingEnabled && next.audioProcessingEnabled) ||
      (next.audioProcessingEnabled &&
        !previous.equalizerEnabled &&
        next.equalizerEnabled);
    const protectedPositiveGain =
      next.outputLevelMode === "fixed" &&
      next.headroomMode !== "off" &&
      signal.projectedPeakGainDb > 0;
    if (protectedPositiveGain && enablingPositiveGainFeature) {
      if (patch.confirmPositiveGain !== true)
        throw new AudioProcessingError(
          "POSITIVE_GAIN_CONFIRMATION_REQUIRED",
          "The current EQ and headroom settings can add positive gain and may clip.",
          409,
        );
    } else if (
      protectedPositiveGain &&
      (enteringFixed ||
        signal.projectedPeakGainDb >
          Math.max(0, previousSignal.projectedPeakGainDb))
    ) {
      throw new AudioProcessingError(
        "FIXED_OUTPUT_POSITIVE_GAIN",
        "Fixed output requires non-positive projected gain unless Headroom is explicitly Off.",
        409,
      );
    }

    let persistedChanges: Partial<UiPreferences> = { ...patch.changes };
    if (enteringFixed)
      persistedChanges = {
        ...persistedChanges,
        lastVariableVolume: Math.min(
          previous.maximumSoftwareVolume,
          this.player.getState().volume,
        ),
      };
    if (
      next.outputLevelMode === "variable" &&
      next.maximumSoftwareVolume < this.player.getState().volume
    )
      persistedChanges = {
        ...persistedChanges,
        volume: next.maximumSoftwareVolume,
      };

    const previousFilter = buildEideticDspFilter(previous);
    const nextFilter = buildEideticDspFilter({
      ...next,
      ...(persistedChanges.lastVariableVolume !== undefined
        ? { lastVariableVolume: persistedChanges.lastVariableVolume }
        : {}),
    });
    try {
      await this.dsp.apply(nextFilter);
      const snapshot = await this.store.patch({ changes: persistedChanges });
      this.preferences = processingPreferences(snapshot.preferences);
      if (enteringFixed) {
        await this.player.pauseForAudioPolicy();
        await this.player.setVolume(100);
        await this.player.setMuted(false);
      } else if (leavingFixed) {
        const restored = Math.min(
          this.preferences.lastVariableVolume,
          this.preferences.maximumSoftwareVolume,
        );
        await this.player.setVolume(restored);
        await this.player.setMuted(false);
      } else if (
        this.preferences.outputLevelMode === "variable" &&
        this.player.getState().volume > this.preferences.maximumSoftwareVolume
      ) {
        await this.player.setVolume(this.preferences.maximumSoftwareVolume);
      }
      this.revision += 1;
      return { state: this.snapshot(), pausedForFixedOutput: enteringFixed };
    } catch (error) {
      await this.dsp.apply(previousFilter).catch(() => undefined);
      if (error instanceof AudioProcessingError) throw error;
      throw new AudioProcessingError(
        "AUDIO_PROCESSING_APPLY_FAILED",
        "Audio processing settings could not be applied.",
        422,
      );
    }
  }

  private invalid(): AudioProcessingError {
    return new AudioProcessingError(
      "INVALID_AUDIO_PROCESSING",
      "Audio processing settings are invalid.",
    );
  }
}
