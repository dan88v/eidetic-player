import {
  audioOutputDevicesEqual,
  defaultAudioOutputPreference,
  disconnectedAudioOutputState,
  isAudioOutputDeviceId,
  normalizeAudioOutputDescription,
  normalizeMpvAudioOutputDevices,
  systemDefaultAudioOutputDevice,
  type AudioOutputDevice,
  type AudioOutputPreference,
  type AudioOutputSelectionResult,
  type AudioOutputState,
  type AudioOutputStatus,
} from "../../../../packages/shared/src/audio-output.js";
import { AudioOutputError } from "./audio-output-error.js";
import { AudioOutputRepository } from "./audio-output-repository.js";

export type AudioOutputPropertyName = "audio-device-list" | "audio-device";

export interface AudioOutputMpvAdapter {
  isMpvAvailable(): boolean;
  isPlaybackActive(): boolean;
  readAudioOutputProperty(name: AudioOutputPropertyName): Promise<unknown>;
  writeAudioOutputDevice(deviceId: string): Promise<void>;
  subscribeAudioOutputProperties(
    listener: (name: AudioOutputPropertyName, value: unknown) => void,
  ): () => void;
  subscribePlaybackActivity(listener: (active: boolean) => void): () => void;
}

type StateListener = (state: AudioOutputState) => void;

function effectiveId(value: unknown): string {
  return isAudioOutputDeviceId(value) ? value : "auto";
}

export class AudioOutputService {
  private state: AudioOutputState = disconnectedAudioOutputState;
  private readonly listeners = new Set<StateListener>();
  private unsubscribeProperties = (): void => undefined;
  private unsubscribePlayback = (): void => undefined;
  private eventChain: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(
    private readonly adapter: AudioOutputMpvAdapter,
    private readonly repository = new AudioOutputRepository(),
    private readonly confirmationTimeoutMilliseconds = 1_500,
  ) {}

  snapshot(): AudioOutputState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    const preferredDevice = await this.repository.read().catch(() => {
      console.warn("[audio-output] preference read failed");
      return defaultAudioOutputPreference;
    });
    this.state = { ...this.state, preferredDevice };
    this.unsubscribeProperties = this.adapter.subscribeAudioOutputProperties(
      (name, value) => {
        this.enqueueEvent(async () => {
          if (name === "audio-device-list")
            await this.receiveDeviceList(value, true);
          else this.updateEffectiveDevice(value);
        });
      },
    );
    this.unsubscribePlayback = this.adapter.subscribePlaybackActivity(() => {
      if (this.state.switching || !this.state.mpvAvailable) return;
      this.update({
        status: this.resolveStatus(
          this.state.preferredDevice,
          this.state.devices,
          this.state.effectiveDeviceId,
        ),
      });
    });
    if (!this.adapter.isMpvAvailable()) {
      this.update({
        mpvAvailable: false,
        status: "mpv-unavailable",
      });
      this.initialized = true;
      return;
    }

    try {
      const [rawDevices, rawEffective] = await Promise.all([
        this.adapter.readAudioOutputProperty("audio-device-list"),
        this.adapter.readAudioOutputProperty("audio-device"),
      ]);
      const devices = normalizeMpvAudioOutputDevices(rawDevices);
      const preferredAvailable = this.isAvailable(
        preferredDevice.deviceId,
        devices,
      );
      const requestedDeviceId = preferredAvailable
        ? preferredDevice.deviceId
        : "auto";
      if (effectiveId(rawEffective) !== requestedDeviceId)
        await this.applyAndConfirm(requestedDeviceId);
      this.state = {
        ...this.state,
        mpvAvailable: true,
        devices,
        preferredDevice,
        effectiveDeviceId: requestedDeviceId,
        status: this.resolveStatus(preferredDevice, devices, requestedDeviceId),
        switching: false,
        revision: this.state.revision + 1,
      };
    } catch {
      await this.tryTechnicalFallback();
      this.update({
        mpvAvailable: this.adapter.isMpvAvailable(),
        effectiveDeviceId: "auto",
        status: this.adapter.isMpvAvailable() ? "error" : "mpv-unavailable",
      });
      console.warn("[audio-output] initialization failed");
    }

    this.initialized = true;
  }

  async select(deviceId: string): Promise<AudioOutputSelectionResult> {
    if (!isAudioOutputDeviceId(deviceId))
      throw new AudioOutputError(
        "INVALID_AUDIO_OUTPUT",
        "Select a valid audio output.",
      );
    if (!this.state.mpvAvailable)
      throw new AudioOutputError(
        "MPV_NOT_AVAILABLE",
        "MPV is unavailable.",
        409,
      );
    const selected = this.state.devices.find(
      (device) => device.id === deviceId && device.available,
    );
    if (!selected)
      throw new AudioOutputError(
        "AUDIO_OUTPUT_NOT_AVAILABLE",
        "The selected audio output is unavailable.",
        409,
      );
    if (this.state.switching)
      throw new AudioOutputError(
        "AUDIO_OUTPUT_SWITCH_FAILED",
        "Audio output could not be changed.",
        409,
      );
    if (
      this.state.preferredDevice.deviceId === deviceId &&
      this.state.effectiveDeviceId === deviceId
    )
      return { changed: false, deviceId };

    const previousState = this.state;
    const nextPreference: AudioOutputPreference = {
      deviceId,
      description:
        deviceId === "auto"
          ? systemDefaultAudioOutputDevice.description
          : normalizeAudioOutputDescription(selected.description, deviceId),
    };
    this.update({ switching: true, status: "switching" });
    try {
      await this.applyAndConfirm(deviceId);
      await this.repository.write(nextPreference);
      this.update({
        preferredDevice: nextPreference,
        effectiveDeviceId: deviceId,
        switching: false,
        status: this.resolveStatus(
          nextPreference,
          this.state.devices,
          deviceId,
        ),
        notice: null,
      });
      return { changed: true, deviceId };
    } catch {
      const rollbackSucceeded = await this.rollback(
        previousState.effectiveDeviceId,
      );
      this.update({
        preferredDevice: previousState.preferredDevice,
        effectiveDeviceId: rollbackSucceeded
          ? previousState.effectiveDeviceId
          : "auto",
        switching: false,
        status: rollbackSucceeded
          ? this.resolveStatus(
              previousState.preferredDevice,
              this.state.devices,
              previousState.effectiveDeviceId,
            )
          : "error",
      });
      console.warn(
        `[audio-output] switch failed; rollback=${rollbackSucceeded ? "ok" : "fallback"}`,
      );
      throw new AudioOutputError(
        "AUDIO_OUTPUT_SWITCH_FAILED",
        "Audio output could not be changed.",
        422,
      );
    }
  }

  async refresh(): Promise<AudioOutputState> {
    if (!this.adapter.isMpvAvailable()) {
      this.update({
        mpvAvailable: false,
        devices: [systemDefaultAudioOutputDevice],
        effectiveDeviceId: "auto",
        status: "mpv-unavailable",
      });
      throw new AudioOutputError(
        "MPV_NOT_AVAILABLE",
        "MPV is unavailable.",
        409,
      );
    }
    try {
      const value =
        await this.adapter.readAudioOutputProperty("audio-device-list");
      await this.receiveDeviceList(value, true);
      return this.state;
    } catch (error) {
      if (error instanceof AudioOutputError) throw error;
      throw new AudioOutputError(
        "AUDIO_OUTPUT_REFRESH_FAILED",
        "Audio outputs could not be refreshed.",
        422,
      );
    }
  }

  async prepareForPlayback(): Promise<void> {
    if (!this.initialized || !this.state.mpvAvailable) return;
    const preferredAvailable = this.isAvailable(
      this.state.preferredDevice.deviceId,
      this.state.devices,
    );
    const target = preferredAvailable
      ? this.state.preferredDevice.deviceId
      : "auto";
    if (this.state.effectiveDeviceId === target) return;
    try {
      await this.applyAndConfirm(target);
      this.update({
        effectiveDeviceId: target,
        status: this.resolveStatus(
          this.state.preferredDevice,
          this.state.devices,
          target,
          true,
        ),
      });
    } catch {
      await this.tryTechnicalFallback();
      this.update({ effectiveDeviceId: "auto", status: "error" });
      console.warn("[audio-output] pre-playback apply failed");
    }
  }

  close(): void {
    this.unsubscribeProperties();
    this.unsubscribePlayback();
    this.listeners.clear();
  }

  private async receiveDeviceList(
    value: unknown,
    notifyRuntimeUnplug: boolean,
  ): Promise<void> {
    const mpvAvailable = this.adapter.isMpvAvailable();
    if (!mpvAvailable) {
      this.update({
        mpvAvailable: false,
        devices: [systemDefaultAudioOutputDevice],
        effectiveDeviceId: "auto",
        status: "mpv-unavailable",
      });
      return;
    }
    const devices = normalizeMpvAudioOutputDevices(value);
    if (
      this.state.mpvAvailable &&
      audioOutputDevicesEqual(devices, this.state.devices)
    )
      return;
    const wasAvailable = this.isAvailable(
      this.state.preferredDevice.deviceId,
      this.state.devices,
    );
    const preferredAvailable = this.isAvailable(
      this.state.preferredDevice.deviceId,
      devices,
    );
    let effectiveDeviceId = this.state.effectiveDeviceId;
    let notice = this.state.notice;
    let noticeRevision = this.state.noticeRevision;
    if (
      this.state.preferredDevice.deviceId !== "auto" &&
      wasAvailable &&
      !preferredAvailable
    ) {
      if (effectiveDeviceId !== "auto") {
        try {
          await this.applyAndConfirm("auto");
          effectiveDeviceId = "auto";
        } catch {
          await this.tryTechnicalFallback();
          effectiveDeviceId = "auto";
        }
      }
      if (notifyRuntimeUnplug) {
        notice = "preferred-unavailable";
        noticeRevision += 1;
      }
    }
    this.update({
      mpvAvailable: true,
      devices,
      effectiveDeviceId,
      status: this.resolveStatus(
        this.state.preferredDevice,
        devices,
        effectiveDeviceId,
      ),
      notice,
      noticeRevision,
    });
  }

  private updateEffectiveDevice(value: unknown): void {
    const id = effectiveId(value);
    if (id === this.state.effectiveDeviceId) return;
    this.update({
      effectiveDeviceId: id,
      status: this.resolveStatus(
        this.state.preferredDevice,
        this.state.devices,
        id,
      ),
    });
  }

  private resolveStatus(
    preference: AudioOutputPreference,
    devices: readonly AudioOutputDevice[],
    currentDeviceId: string,
    playbackStarting = false,
  ): AudioOutputStatus {
    if (!this.adapter.isMpvAvailable()) return "mpv-unavailable";
    if (!this.isAvailable(preference.deviceId, devices))
      return "preferred-unavailable";
    if (preference.deviceId !== currentDeviceId) return "pending-playback";
    if (!playbackStarting && !this.adapter.isPlaybackActive())
      return "pending-playback";
    return preference.deviceId === "auto" ? "system-default" : "active";
  }

  private isAvailable(
    deviceId: string,
    devices: readonly AudioOutputDevice[],
  ): boolean {
    return devices.some((device) => device.id === deviceId && device.available);
  }

  private async applyAndConfirm(deviceId: string): Promise<void> {
    await this.adapter.writeAudioOutputDevice(deviceId);
    const deadline = Date.now() + this.confirmationTimeoutMilliseconds;
    do {
      const current =
        await this.adapter.readAudioOutputProperty("audio-device");
      if (effectiveId(current) === deviceId) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error("audio output confirmation timed out");
  }

  private async rollback(deviceId: string): Promise<boolean> {
    try {
      await this.applyAndConfirm(deviceId);
      return true;
    } catch {
      await this.tryTechnicalFallback();
      return false;
    }
  }

  private async tryTechnicalFallback(): Promise<void> {
    try {
      await this.applyAndConfirm("auto");
    } catch {
      console.warn("[audio-output] system default fallback failed");
    }
  }

  private enqueueEvent(operation: () => Promise<void>): void {
    this.eventChain = this.eventChain.then(operation, operation).catch(() => {
      console.warn("[audio-output] MPV event handling failed");
    });
  }

  private update(patch: Partial<AudioOutputState>): void {
    const next = {
      ...this.state,
      ...patch,
      revision: this.state.revision + 1,
    };
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
