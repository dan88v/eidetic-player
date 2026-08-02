import type {
  ExternalPlaybackEndPolicy,
  PlaybackSourceCapabilities,
  PlaybackSourceKind,
  PlaybackSourceSnapshot,
} from "../../../../packages/shared/src/playback-source.js";
import { localPlaybackSourceCapabilities } from "../../../../packages/shared/src/playback-source.js";
import type { PreferencesStore } from "../preferences/preferences-store.js";
import type {
  ExternalPlaybackProvider,
  ExternalProviderEvent,
  ExternalProviderSnapshot,
} from "./external-playback-provider.js";
import type {
  LocalPlaybackAdapter,
  LocalPlaybackSuspensionToken,
} from "./local-playback-adapter.js";
import {
  defaultPlaybackArbitrationDocument,
  type PlaybackArbitrationDocument,
  type PlaybackArbitrationStore,
} from "./playback-arbitration-store.js";
import { PlaybackSourceError } from "./playback-source-error.js";
import type { PlayerCommandRequestMetadata } from "../../../../packages/shared/src/player.js";

type SourceListener = (snapshot: PlaybackSourceSnapshot) => void;
type ExternalSource = Exclude<PlaybackSourceKind, "local">;

const TRANSITION_TIMEOUT_MILLISECONDS = 3_000;

function withTimeout<T>(
  operation: Promise<T>,
  code: string,
  message: string,
  milliseconds = TRANSITION_TIMEOUT_MILLISECONDS,
): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      reject(new PlaybackSourceError(code, message));
    }, milliseconds);
    handle.unref();
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}

function providerStateFromLocal(
  state: ReturnType<LocalPlaybackAdapter["snapshot"]>,
): PlaybackSourceSnapshot["providerState"] {
  if (state.status === "playing") return "playing";
  if (state.status === "loading") return "buffering";
  if (state.status === "error" || state.status === "unavailable")
    return "error";
  if (state.status === "paused") return "paused";
  return "stopped";
}

function unsupported(
  capabilities: PlaybackSourceCapabilities,
  action: keyof PlaybackSourceCapabilities,
  source: ExternalSource,
): void {
  if (capabilities[action]) return;
  throw new PlaybackSourceError(
    "SOURCE_ACTION_NOT_SUPPORTED",
    `${source === "spotify" ? "Spotify Connect" : "AirPlay"} does not support this action.`,
  );
}

export class PlaybackSourceArbiter {
  private readonly providers = new Map<
    ExternalSource,
    ExternalPlaybackProvider
  >();
  private readonly listeners = new Set<SourceListener>();
  private readonly unsubscribers: (() => void)[] = [];
  private transitionChain: Promise<void> = Promise.resolve();
  private activeProvider: ExternalPlaybackProvider | null = null;
  private activeProviderGeneration = 0;
  private localSuspension: LocalPlaybackSuspensionToken | null = null;
  private document = defaultPlaybackArbitrationDocument();
  private initialized = false;
  private shuttingDown = false;
  private revision = 0;
  private localIntentRevision = 0;
  private suspensionIntentRevision = 0;
  private applyingProviderLevel = false;
  private readonly externalIntentIds = new Map<string, number>();
  private source: PlaybackSourceSnapshot;

  constructor(
    private readonly local: LocalPlaybackAdapter,
    providers: readonly ExternalPlaybackProvider[],
    private readonly store: PlaybackArbitrationStore,
    private readonly preferences: PreferencesStore,
  ) {
    for (const provider of providers) {
      if (this.providers.has(provider.kind))
        throw new Error(`Duplicate external provider: ${provider.kind}`);
      this.providers.set(provider.kind, provider);
    }
    const localState = local.snapshot();
    this.source = {
      schemaVersion: 1,
      revision: 0,
      transitionGeneration: 0,
      activeSource: "local",
      phase: "idle",
      sessionId: null,
      providerState: providerStateFromLocal(localState),
      metadata: null,
      artwork: null,
      positionSeconds: null,
      durationSeconds: null,
      capabilities: localPlaybackSourceCapabilities,
      volume: localState.volume,
      muted: localState.muted,
      output: local.output(),
      localPlaybackSuspended: false,
      localWasPlaying: false,
      lastError: null,
    };
  }

  snapshot(): PlaybackSourceSnapshot {
    return this.source;
  }

  subscribe(listener: SourceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const loaded = await this.store.load();
    this.document = loaded.document;
    this.unsubscribers.push(
      this.local.subscribe(() => {
        this.receiveLocalState();
      }),
    );
    for (const provider of this.providers.values())
      this.unsubscribers.push(
        provider.subscribe((event) => {
          this.receiveProviderEvent(provider, event);
        }),
      );
    const probes = await Promise.all(
      [...this.providers.values()].map(async (provider) => ({
        provider,
        snapshot: await withTimeout(
          provider.probeActiveSession(),
          "EXTERNAL_SOURCE_PROBE_TIMEOUT",
          "An external playback source did not respond during startup.",
        ).catch(() => null),
      })),
    );
    const active = probes.filter(
      (entry): entry is typeof entry & { snapshot: ExternalProviderSnapshot } =>
        entry.snapshot !== null,
    );
    if (active.length > 1) {
      const token = await this.local.captureSuspension();
      await withTimeout(
        this.local.releaseAudioOutput(),
        "MPV_OUTPUT_RELEASE_TIMEOUT",
        "Local playback did not release the audio output during startup reconciliation.",
      );
      const releases = await Promise.allSettled(
        active.map(({ provider }) =>
          withTimeout(
            (async () => {
              await provider.stop(this.document.transitionGeneration + 1);
              await provider.release(this.document.transitionGeneration + 1);
            })(),
            "EXTERNAL_SOURCE_RELEASE_TIMEOUT",
            "External playback sources could not be reconciled.",
          ),
        ),
      );
      const allReleased = releases.every(
        (result) => result.status === "fulfilled",
      );
      if (allReleased) await this.local.restoreAudioOutput(token, false);
      this.publish({
        activeSource: "local",
        phase: "error",
        providerState: "error",
        localPlaybackSuspended: !allReleased,
        localWasPlaying: token.wasPlaying,
        lastError: {
          code: "MULTIPLE_EXTERNAL_SOURCES",
          message: allReleased
            ? "Multiple external playback sources were stopped during startup."
            : "Multiple external playback sources could not be released safely during startup.",
        },
      });
      await this.persist(
        allReleased
          ? "multiple-external-sources"
          : "multiple-external-sources-release-failed",
        false,
      );
    } else if (active[0]) {
      await this.acquireNow(
        active[0].provider.kind,
        active[0].snapshot.sessionId ?? "",
        true,
      ).catch((error: unknown) => {
        this.publishError(error, "EXTERNAL_STARTUP_RECONCILIATION_FAILED");
      });
    } else {
      this.publishLocal(null);
      if (this.document.activeSource !== "local")
        await this.persist("interrupted-external-restored-local", true);
    }
    this.initialized = true;
  }

  acquire(source: ExternalSource, sessionId: string): Promise<void> {
    return this.enqueue(() => this.acquireNow(source, sessionId, false));
  }

  requestLocalOwnership(forceResume = false): Promise<void> {
    this.localIntentRevision += 1;
    if (this.source.activeSource === "local") return Promise.resolve();
    return this.enqueue(() =>
      this.releaseExternalNow("local-intent", forceResume, false),
    );
  }

  resumeLocalPlayback(): Promise<void> {
    return this.requestLocalOwnership(true);
  }

  setEndPolicy(policy: ExternalPlaybackEndPolicy): void {
    this.document = { ...this.document, endPolicy: policy };
  }

  async play(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    await this.externalCommand(
      "transport",
      metadata,
      "play",
      (provider, generation) => provider.play(generation),
    );
  }

  async pause(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    await this.externalCommand(
      "transport",
      metadata,
      "pause",
      (provider, generation) => provider.pause(generation),
    );
  }

  async previous(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    await this.externalCommand(
      "navigation",
      metadata,
      "previous",
      (provider, generation) => provider.previous(generation),
    );
  }

  async next(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    await this.externalCommand(
      "navigation",
      metadata,
      "next",
      (provider, generation) => provider.next(generation),
    );
  }

  async seek(
    positionSeconds: number,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    await this.externalCommand(
      "seek",
      metadata,
      "seek",
      (provider, generation) => provider.seek(positionSeconds, generation),
    );
  }

  setVolume(
    volume: number,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    return this.externalIntent("volume", metadata, () =>
      this.setVolumeNow(volume),
    );
  }

  private async setVolumeNow(volume: number): Promise<void> {
    const provider = this.requireActiveProvider();
    const output = this.source.output;
    if (output.levelMode === "fixed")
      throw new PlaybackSourceError(
        "FIXED_OUTPUT_LEVEL_LOCKED",
        "Software volume is disabled while Output level is Fixed.",
      );
    unsupported(provider.capabilities, "volume", provider.kind);
    const target = Math.max(
      0,
      Math.min(100, output.maximumSoftwareVolume, volume),
    );
    this.applyingProviderLevel = true;
    try {
      await withTimeout(
        provider.setVolume(target, this.source.transitionGeneration),
        "EXTERNAL_SOURCE_COMMAND_TIMEOUT",
        "The active source did not confirm the volume change.",
      );
      const confirmed = provider.snapshot().volume;
      if (Math.abs(confirmed - target) > 0.5)
        throw new PlaybackSourceError(
          "EXTERNAL_VOLUME_CONFIRMATION_FAILED",
          "The active source did not confirm the volume change.",
        );
      await this.persistGlobalLevel(confirmed, undefined);
      this.updateSuspendedLevel(confirmed, undefined);
      this.publish({ volume: confirmed });
    } finally {
      this.applyingProviderLevel = false;
    }
  }

  setMuted(
    muted: boolean,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    return this.externalIntent("mute", metadata, () => this.setMutedNow(muted));
  }

  private async setMutedNow(muted: boolean): Promise<void> {
    const provider = this.requireActiveProvider();
    if (this.source.output.levelMode === "fixed")
      throw new PlaybackSourceError(
        "FIXED_OUTPUT_LEVEL_LOCKED",
        "Mute is disabled while Output level is Fixed.",
      );
    unsupported(provider.capabilities, "mute", provider.kind);
    this.applyingProviderLevel = true;
    try {
      await withTimeout(
        provider.setMuted(muted, this.source.transitionGeneration),
        "EXTERNAL_SOURCE_COMMAND_TIMEOUT",
        "The active source did not confirm the mute change.",
      );
      const confirmed = provider.snapshot().muted;
      if (confirmed !== muted)
        throw new PlaybackSourceError(
          "EXTERNAL_MUTE_CONFIRMATION_FAILED",
          "The active source did not confirm the mute change.",
        );
      await this.persistGlobalLevel(undefined, confirmed);
      this.updateSuspendedLevel(undefined, confirmed);
      this.publish({ muted: confirmed });
    } finally {
      this.applyingProviderLevel = false;
    }
  }

  async flush(): Promise<void> {
    await this.transitionChain.catch(() => undefined);
    await this.persist("flush", true).catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.enqueue(async () => {
      if (this.activeProvider)
        await withTimeout(
          this.activeProvider.release(this.source.transitionGeneration + 1),
          "EXTERNAL_SOURCE_RELEASE_TIMEOUT",
          "The active source did not release during shutdown.",
        ).catch(() => undefined);
      await this.persist("shutdown", true).catch(() => undefined);
    }).catch(() => undefined);
    while (this.unsubscribers.length > 0) this.unsubscribers.pop()?.();
    await Promise.all(
      [...this.providers.values()].map((provider) => provider.shutdown()),
    );
    this.listeners.clear();
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.transitionChain.then(operation);
    this.transitionChain = next.catch(() => undefined);
    return next;
  }

  private async acquireNow(
    source: ExternalSource,
    sessionId: string,
    adopting: boolean,
  ): Promise<void> {
    const provider = this.providers.get(source);
    if (!provider || !sessionId)
      throw new PlaybackSourceError(
        "EXTERNAL_SOURCE_NOT_AVAILABLE",
        "The requested external playback source is unavailable.",
        404,
      );
    const generation = this.source.transitionGeneration + 1;
    const route = this.local.routeForExternalPlayback();
    const replacing = this.activeProvider !== null;
    const previousProvider = this.activeProvider;
    this.publish({
      transitionGeneration: generation,
      phase: "acquiring",
      lastError: null,
    });
    let captured = false;
    try {
      if (!replacing) {
        this.localSuspension = await this.local.captureSuspension();
        this.suspensionIntentRevision = this.localIntentRevision;
        captured = true;
        await withTimeout(
          this.local.releaseAudioOutput(),
          "MPV_OUTPUT_RELEASE_TIMEOUT",
          "Local playback did not release the audio output.",
        );
      } else if (previousProvider) {
        await withTimeout(
          previousProvider.stop(generation),
          "EXTERNAL_SOURCE_RELEASE_TIMEOUT",
          "The previous external source did not release the audio output.",
        );
        await withTimeout(
          previousProvider.release(generation),
          "EXTERNAL_SOURCE_RELEASE_TIMEOUT",
          "The previous external source did not release the audio output.",
        );
      }
      await withTimeout(
        provider.configureOutput(route),
        "EXTERNAL_OUTPUT_CONFIGURE_TIMEOUT",
        "The external source could not configure the selected audio output.",
      );
      const processing = this.preferences.snapshot().preferences;
      const targetVolume =
        processing.outputLevelMode === "fixed"
          ? 100
          : Math.min(processing.maximumSoftwareVolume, processing.volume);
      if (provider.capabilities.volume)
        await provider.setVolume(targetVolume, generation);
      if (provider.capabilities.mute)
        await provider.setMuted(
          processing.outputLevelMode === "fixed" ? false : processing.muted,
          generation,
        );
      await withTimeout(
        provider.acquire(sessionId, generation),
        "EXTERNAL_SOURCE_ACQUIRE_TIMEOUT",
        "The external source did not acquire the audio output.",
      );
      const confirmed = provider.snapshot();
      if (
        confirmed.sessionId !== sessionId ||
        (confirmed.state !== "playing" && confirmed.state !== "paused")
      )
        throw new PlaybackSourceError(
          "EXTERNAL_SOURCE_CONFIRMATION_FAILED",
          "The external source did not confirm ownership.",
        );
      this.activeProvider = provider;
      this.activeProviderGeneration = confirmed.generation;
      this.publishProvider(provider, confirmed, {
        transitionGeneration: generation,
        phase: "active",
        output: {
          description: route.description,
          levelMode: route.levelMode,
          maximumSoftwareVolume: route.maximumSoftwareVolume,
        },
        localPlaybackSuspended: true,
        localWasPlaying: this.localSuspension?.wasPlaying ?? false,
        lastError: null,
      });
      await this.persist(adopting ? "adopted" : "acquired", true);
    } catch (error) {
      await provider.stop(generation).catch(() => undefined);
      await provider.release(generation).catch(() => undefined);
      this.activeProvider = null;
      if (this.localSuspension && (captured || replacing)) {
        await this.local
          .restoreAudioOutput(
            this.localSuspension,
            this.localSuspension.wasPlaying,
          )
          .catch(() => undefined);
        this.localSuspension = null;
        this.publishLocal(error);
      } else {
        this.publishError(error, "EXTERNAL_SOURCE_ACQUIRE_FAILED", source);
      }
      await this.persist("acquire-failed", false).catch(() => undefined);
      throw error;
    }
  }

  private async releaseExternalNow(
    reason: string,
    forceResume: boolean,
    providerFailed: boolean,
  ): Promise<void> {
    const provider = this.activeProvider;
    const token = this.localSuspension;
    if (!provider || !token) {
      this.activeProvider = null;
      this.localSuspension = null;
      this.publishLocal(null);
      return;
    }
    const generation = this.source.transitionGeneration + 1;
    this.publish({ transitionGeneration: generation, phase: "releasing" });
    try {
      await withTimeout(
        provider.stop(generation),
        "EXTERNAL_SOURCE_RELEASE_TIMEOUT",
        "The active external source did not stop.",
      );
      await withTimeout(
        provider.release(generation),
        "EXTERNAL_SOURCE_RELEASE_TIMEOUT",
        "The active external source did not release the audio output.",
      );
      const policy =
        this.preferences.snapshot().preferences.externalPlaybackEndPolicy;
      const noNewLocalIntent =
        this.suspensionIntentRevision === this.localIntentRevision;
      const resume =
        forceResume ||
        (!providerFailed &&
          policy === "resume-interrupted" &&
          token.wasPlaying &&
          noNewLocalIntent);
      await this.local.restoreAudioOutput(token, resume);
      this.activeProvider = null;
      this.localSuspension = null;
      this.publishLocal(null, generation);
      await this.persist(reason, true);
    } catch (error) {
      this.publishError(error, "EXTERNAL_SOURCE_RELEASE_FAILED", provider.kind);
      await this.persist("release-failed", false).catch(() => undefined);
      throw error;
    }
  }

  private async externalCommand(
    intentKind: string,
    metadata: PlayerCommandRequestMetadata | undefined,
    capability: keyof PlaybackSourceCapabilities,
    command: (
      provider: ExternalPlaybackProvider,
      generation: number,
    ) => Promise<void>,
  ): Promise<void> {
    await this.externalIntent(intentKind, metadata, async () => {
      const provider = this.requireActiveProvider();
      unsupported(provider.capabilities, capability, provider.kind);
      await withTimeout(
        command(provider, this.source.transitionGeneration),
        "EXTERNAL_SOURCE_COMMAND_TIMEOUT",
        "The active external source did not confirm the command.",
      );
    });
  }

  private externalIntent(
    kind: string,
    metadata: PlayerCommandRequestMetadata | undefined,
    operation: () => Promise<void>,
  ): Promise<void> {
    const key = metadata
      ? `${metadata.clientSessionId ?? "anonymous"}:${kind}`
      : null;
    const intentId = metadata?.intentId;
    if (key) {
      const previous = this.externalIntentIds.get(key) ?? -1;
      if (intentId === undefined || intentId <= previous)
        return Promise.resolve();
      this.externalIntentIds.set(key, intentId);
    }
    return this.enqueue(async () => {
      if (key && this.externalIntentIds.get(key) !== intentId) return;
      await operation();
    });
  }

  private requireActiveProvider(): ExternalPlaybackProvider {
    if (!this.activeProvider || this.source.activeSource === "local")
      throw new PlaybackSourceError(
        "EXTERNAL_SOURCE_NOT_ACTIVE",
        "No external playback source is active.",
      );
    return this.activeProvider;
  }

  private receiveProviderEvent(
    provider: ExternalPlaybackProvider,
    event: ExternalProviderEvent,
  ): void {
    if (
      provider !== this.activeProvider ||
      event.sessionId !== this.source.sessionId ||
      event.generation < this.activeProviderGeneration
    )
      return;
    this.activeProviderGeneration = event.generation;
    if (
      event.kind === "ended" ||
      event.kind === "disconnected" ||
      event.kind === "error"
    ) {
      if (this.shuttingDown) return;
      void this.enqueue(() =>
        this.releaseExternalNow(event.kind, false, event.kind === "error"),
      ).catch(() => undefined);
      return;
    }
    this.publishProvider(provider, event.snapshot);
    if (
      !this.applyingProviderLevel &&
      (event.kind === "volume" || event.kind === "mute")
    )
      void this.reconcileProviderLevel(provider, event).catch(() => undefined);
  }

  private async reconcileProviderLevel(
    provider: ExternalPlaybackProvider,
    event: ExternalProviderEvent,
  ): Promise<void> {
    const output = this.source.output;
    if (output.levelMode === "fixed") {
      this.applyingProviderLevel = true;
      try {
        if (provider.capabilities.volume)
          await provider.setVolume(100, this.source.transitionGeneration);
        if (provider.capabilities.mute)
          await provider.setMuted(false, this.source.transitionGeneration);
        this.updateSuspendedLevel(100, false);
        this.publish({ volume: 100, muted: false });
      } finally {
        this.applyingProviderLevel = false;
      }
      return;
    }
    const volume = Math.max(
      0,
      Math.min(100, output.maximumSoftwareVolume, event.snapshot.volume),
    );
    await this.persistGlobalLevel(volume, event.snapshot.muted);
    this.updateSuspendedLevel(volume, event.snapshot.muted);
    this.publish({ volume, muted: event.snapshot.muted });
  }

  private async persistGlobalLevel(
    volume: number | undefined,
    muted: boolean | undefined,
  ): Promise<void> {
    const changes = {
      ...(volume !== undefined ? { volume, lastVariableVolume: volume } : {}),
      ...(muted !== undefined ? { muted } : {}),
    };
    if (Object.keys(changes).length > 0)
      await this.preferences.patch({ changes });
  }

  private updateSuspendedLevel(
    volume: number | undefined,
    muted: boolean | undefined,
  ): void {
    if (!this.localSuspension) return;
    this.localSuspension = {
      ...this.localSuspension,
      player: {
        ...this.localSuspension.player,
        ...(volume !== undefined ? { volume } : {}),
        ...(muted !== undefined ? { muted } : {}),
      },
    };
  }

  private receiveLocalState(): void {
    if (
      this.source.activeSource !== "local" ||
      this.source.phase === "acquiring"
    )
      return;
    const state = this.local.snapshot();
    const providerState = providerStateFromLocal(state);
    const output = this.local.output();
    if (
      providerState === this.source.providerState &&
      state.volume === this.source.volume &&
      state.muted === this.source.muted &&
      output.description === this.source.output.description &&
      output.levelMode === this.source.output.levelMode &&
      output.maximumSoftwareVolume === this.source.output.maximumSoftwareVolume
    )
      return;
    this.publish({
      providerState,
      volume: state.volume,
      muted: state.muted,
      output,
    });
  }

  private publishProvider(
    provider: ExternalPlaybackProvider,
    snapshot: ExternalProviderSnapshot,
    patch: Partial<PlaybackSourceSnapshot> = {},
  ): void {
    this.publish({
      activeSource: provider.kind,
      sessionId: snapshot.sessionId,
      providerState: snapshot.state,
      metadata: snapshot.metadata,
      artwork: snapshot.artwork,
      positionSeconds: snapshot.positionSeconds,
      durationSeconds: snapshot.durationSeconds,
      capabilities: snapshot.capabilities,
      volume: snapshot.volume,
      muted: snapshot.muted,
      ...patch,
    });
  }

  private publishLocal(
    error: unknown,
    transitionGeneration = this.source.transitionGeneration,
  ): void {
    const state = this.local.snapshot();
    this.publish({
      transitionGeneration,
      activeSource: "local",
      phase: error ? "error" : "active",
      sessionId: null,
      providerState: providerStateFromLocal(state),
      metadata: null,
      artwork: null,
      positionSeconds: null,
      durationSeconds: null,
      capabilities: localPlaybackSourceCapabilities,
      volume: state.volume,
      muted: state.muted,
      output: this.local.output(),
      localPlaybackSuspended: false,
      localWasPlaying: false,
      lastError: error
        ? this.sanitizedError(error, "SOURCE_ROLLBACK_FAILED")
        : null,
    });
  }

  private publishError(
    error: unknown,
    fallbackCode: string,
    source: PlaybackSourceKind = this.source.activeSource,
  ): void {
    this.publish({
      activeSource: source,
      phase: "error",
      providerState: "error",
      lastError: this.sanitizedError(error, fallbackCode),
    });
  }

  private sanitizedError(error: unknown, fallbackCode: string) {
    if (error instanceof PlaybackSourceError)
      return { code: error.code, message: error.message };
    return {
      code: fallbackCode,
      message: "Playback source ownership could not be changed safely.",
    };
  }

  private publish(patch: Partial<PlaybackSourceSnapshot>): void {
    const next = Object.freeze({
      ...this.source,
      ...patch,
      schemaVersion: 1 as const,
      revision: ++this.revision,
    });
    this.source = next;
    for (const listener of this.listeners) listener(next);
  }

  private async persist(code: string, success: boolean): Promise<void> {
    const token = this.localSuspension;
    const document: PlaybackArbitrationDocument = {
      schemaVersion: 1,
      revision: this.document.revision + 1,
      transitionGeneration: this.source.transitionGeneration,
      activeSource: this.source.activeSource,
      phase:
        this.source.phase === "acquiring"
          ? "acquiring-external"
          : this.source.phase === "releasing"
            ? "releasing-external"
            : this.source.phase === "recovering"
              ? "recovering"
              : this.source.phase === "error"
                ? "error"
                : this.source.activeSource === "local"
                  ? this.source.providerState === "playing"
                    ? "local-active"
                    : "local-idle"
                  : "external-active",
      providerSessionId: this.source.sessionId,
      localSuspensionId: token?.suspensionId ?? null,
      localSessionRevision: token?.playerSessionRevision ?? null,
      localOccurrenceId: token?.currentPlaybackOccurrenceId ?? null,
      localWasPlaying: token?.wasPlaying ?? false,
      suspendedAt: token?.capturedAt ?? null,
      endPolicy:
        this.preferences.snapshot().preferences.externalPlaybackEndPolicy,
      lastTransitionResult: { code, success },
      updatedAt: new Date().toISOString(),
    };
    await this.store.save(document);
    this.document = document;
  }
}
