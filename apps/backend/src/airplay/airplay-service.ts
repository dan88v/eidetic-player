import type {
  AirPlaySettingsPatch,
  AirPlayState,
} from "../../../../packages/shared/src/airplay.js";
import type { ExternalPlaybackRoute } from "../playback-source/external-playback-provider.js";
import { renderAirPlayConfig } from "./airplay-config-renderer.js";
import type { AirPlayPlatformAdapter } from "./airplay-platform-adapter.js";
import type { AirPlayProvider } from "./airplay-provider.js";
import {
  AIRPLAY_INTEGRATION_VERSION,
  AirPlayStore,
  AirPlayStoreError,
} from "./airplay-store.js";

type StateListener = (state: AirPlayState) => void;

export class AirPlayService {
  private readonly listeners = new Set<StateListener>();
  private state: AirPlayState = {
    schemaVersion: 1,
    revision: 0,
    available: false,
    enabled: true,
    receiverName: "Eidetic Player",
    receiverNameOrigin: "generated",
    audioBufferSeconds: 2,
    protocol: "unavailable",
    serviceStatus: "unavailable",
    integrationVersion: AIRPLAY_INTEGRATION_VERSION,
    message: null,
  };
  private initialized = false;
  private readonly unsubscribeProvider: () => void;

  constructor(
    private readonly provider: AirPlayProvider,
    private readonly platform: AirPlayPlatformAdapter,
    private readonly requestLocalOwnership: () => Promise<void>,
    private readonly store = new AirPlayStore(),
  ) {
    this.unsubscribeProvider = this.provider.subscribe((event) => {
      if (
        event.kind === "session-starting" ||
        event.kind === "buffering" ||
        event.kind === "playing" ||
        event.kind === "metadata" ||
        event.kind === "artwork" ||
        event.kind === "progress"
      )
        this.publish({ serviceStatus: "active", message: null });
      else if (
        event.kind === "ended" ||
        event.kind === "disconnected" ||
        event.kind === "error"
      )
        this.publish({
          serviceStatus: this.state.enabled ? "ready" : "off",
          message:
            event.kind === "error"
              ? "The AirPlay session ended unexpectedly."
              : null,
        });
    });
  }

  snapshot(): AirPlayState {
    return this.state;
  }
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(resolveRoute: () => ExternalPlaybackRoute): Promise<void> {
    let document;
    try {
      document = await this.store.initialize();
    } catch (error) {
      this.publish({
        available: false,
        serviceStatus: "error",
        message:
          error instanceof Error
            ? error.message
            : "AirPlay settings are unavailable.",
      });
      return;
    }
    const status = await this.platform.status();
    this.state = {
      schemaVersion: 1,
      revision: document.revision,
      available: status.available,
      enabled: document.enabled,
      receiverName: document.receiverName,
      receiverNameOrigin: document.receiverNameOrigin,
      audioBufferSeconds: document.audioBufferSeconds,
      protocol: status.protocol,
      serviceStatus: !status.available
        ? "unavailable"
        : document.enabled
          ? "starting"
          : "off",
      integrationVersion: AIRPLAY_INTEGRATION_VERSION,
      message: status.message,
    };
    if (!status.available) {
      this.initialized = true;
      return;
    }
    try {
      await this.provider.initialize();
    } catch {
      this.publish({
        serviceStatus: "error",
        message: "AirPlay runtime initialization failed.",
      });
      this.initialized = true;
      return;
    }
    if (document.enabled) {
      try {
        const route = resolveRoute();
        let advertisement = await this.startVerifiedReceiver(route);
        for (
          let attempt = 1;
          advertisement === "collision" && attempt < 3;
          attempt += 1
        ) {
          if (this.store.snapshot().receiverNameOrigin !== "generated") break;
          await this.platform.setEnabled(false);
          const regenerated = await this.store.regenerateGeneratedName();
          this.publish({
            revision: regenerated.revision,
            receiverName: regenerated.receiverName,
          });
          advertisement = await this.startVerifiedReceiver(route);
        }
        if (advertisement !== "verified")
          throw this.advertisementError(advertisement);
        const active = await this.platform.status();
        this.publish({
          protocol: active.protocol,
          serviceStatus: "ready",
          message: null,
        });
      } catch (error) {
        await this.platform.setEnabled(false).catch(() => undefined);
        this.publish({
          serviceStatus: "error",
          message:
            error instanceof Error
              ? error.message
              : "Select an available physical audio output for AirPlay.",
        });
      }
    } else this.publish({ serviceStatus: "off" });
    this.initialized = true;
  }

  async patch(
    patch: AirPlaySettingsPatch,
    resolveRoute: () => ExternalPlaybackRoute,
  ): Promise<AirPlayState> {
    if (!this.initialized)
      throw new AirPlayStoreError(
        "AIRPLAY_NOT_READY",
        "AirPlay settings are not ready.",
        503,
      );
    if (
      patch.expectedRevision !== undefined &&
      patch.expectedRevision !== this.state.revision
    )
      throw new AirPlayStoreError(
        "AIRPLAY_REVISION_CONFLICT",
        "AirPlay settings changed in another request.",
        409,
      );
    if (patch.enabled === false && this.state.enabled)
      await this.requestLocalOwnership();
    if (
      (patch.receiverName !== undefined ||
        patch.audioBufferSeconds !== undefined) &&
      this.provider.snapshot().sessionId !== null
    )
      throw new AirPlayStoreError(
        "AIRPLAY_SESSION_ACTIVE",
        "Stop AirPlay playback before changing receiver settings.",
        409,
      );
    const document = await this.store.save({
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.receiverName === undefined
        ? {}
        : { receiverName: patch.receiverName }),
      ...(patch.audioBufferSeconds === undefined
        ? {}
        : { audioBufferSeconds: patch.audioBufferSeconds }),
    });
    this.publish({
      revision: document.revision,
      enabled: document.enabled,
      receiverName: document.receiverName,
      receiverNameOrigin: document.receiverNameOrigin,
      audioBufferSeconds: document.audioBufferSeconds,
      serviceStatus: document.enabled ? "starting" : "off",
      message: null,
    });
    if (!document.enabled) {
      await this.platform.setEnabled(false);
      this.publish({ serviceStatus: "off", message: null });
      return this.state;
    }
    try {
      const advertisement = await this.startVerifiedReceiver(resolveRoute());
      if (advertisement !== "verified")
        throw this.advertisementError(advertisement);
      const active = await this.platform.status();
      this.publish({
        protocol: active.protocol,
        serviceStatus: "ready",
        message: null,
      });
      return this.state;
    } catch (error) {
      await this.platform.setEnabled(false).catch(() => undefined);
      const activationError = this.activationError(error);
      this.publish({
        serviceStatus: "error",
        message: activationError.message,
      });
      throw activationError;
    }
  }

  async refreshRoute(route: ExternalPlaybackRoute): Promise<void> {
    if (!this.state.enabled || this.provider.snapshot().sessionId) return;
    try {
      await this.applyRoute(route, true);
      this.publish({ serviceStatus: "ready", message: null });
    } catch {
      await this.platform.setEnabled(false).catch(() => undefined);
      this.publish({
        serviceStatus: "error",
        message: "The selected audio output is not available to AirPlay.",
      });
      throw new AirPlayStoreError(
        "AIRPLAY_OUTPUT_UNAVAILABLE",
        "The selected audio output is not available to AirPlay.",
        409,
      );
    }
  }

  assertRouteMutable(): void {
    if (this.provider.snapshot().sessionId)
      throw new AirPlayStoreError(
        "AIRPLAY_SESSION_ACTIVE",
        "Stop AirPlay playback before changing its audio output.",
        409,
      );
  }

  close(): void {
    this.unsubscribeProvider();
    this.listeners.clear();
  }

  private async applyRoute(
    route: ExternalPlaybackRoute,
    restart: boolean,
  ): Promise<void> {
    const document = this.store.snapshot();
    const configurationRoute: ExternalPlaybackRoute = this.platform.fixture
      ? {
          ...route,
          routeKind: "alsa",
          providerTarget: "alsa/eidetic-airplay-fixture",
        }
      : route;
    const configuration = renderAirPlayConfig(document, configurationRoute, {
      controlSocket: this.platform.controlSocket,
      metadataPipe: this.platform.metadataPipe,
      hookExecutable: this.platform.hookExecutable,
    });
    await this.platform.writeConfiguration(configuration);
    this.provider.setPreparedRoute(route);
    if (restart) await this.platform.restart();
  }

  private async startVerifiedReceiver(
    route: ExternalPlaybackRoute,
  ): Promise<"verified" | "collision" | "unavailable"> {
    await this.applyRoute(route, false);
    const before = await this.platform.status();
    // The setting store, not a systemd boot symlink, is authoritative. Always
    // remove legacy enablement before starting the receiver after the backend
    // control socket exists. An already-running receiver still needs a restart
    // to consume the freshly rendered route.
    await this.platform.setEnabled(true);
    if (before.active) await this.platform.restart();
    const status = await this.platform.status();
    if (!status.active) return "unavailable";
    return this.platform.verifyAdvertisement(
      this.store.snapshot().receiverName,
    );
  }

  private advertisementError(
    status: "collision" | "unavailable",
  ): AirPlayStoreError {
    return new AirPlayStoreError(
      status === "collision"
        ? "AIRPLAY_NAME_CONFLICT"
        : "AIRPLAY_ADVERTISEMENT_UNAVAILABLE",
      status === "collision"
        ? "The receiver name is already in use on this network. Choose another name."
        : "AirPlay could not be advertised on this network.",
      409,
    );
  }

  private activationError(error: unknown): AirPlayStoreError {
    if (error instanceof AirPlayStoreError) return error;
    return new AirPlayStoreError(
      "AIRPLAY_START_FAILED",
      error instanceof Error && error.message
        ? error.message
        : "AirPlay could not be started.",
      409,
    );
  }

  private publish(patch: Partial<AirPlayState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}
