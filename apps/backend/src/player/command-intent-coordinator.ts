import { performance } from "node:perf_hooks";
import type {
  PlayerBooleanCommandState,
  PlayerCommandPhase,
  PlayerCommandRequestMetadata,
  PlayerCommandState,
  PlayerLevelCommandState,
  PlayerNavigationCommandState,
} from "../../../../packages/shared/src/player.js";

export type PlaybackCommandKind =
  "volume" | "mute" | "transport" | "navigation";

export type PlaybackCommandDiagnosticStage =
  | "ui-requested"
  | "api-received"
  | "service-accepted"
  | "ipc-sent"
  | "ipc-acknowledged"
  | "property-confirmed"
  | "transition-start"
  | "start-file"
  | "file-loaded"
  | "playback-restart"
  | "state-published"
  | "stale-discarded"
  | "failed"
  | "timed-out"
  | "superseded";

export interface PlaybackCommandDiagnostic {
  readonly sequence: number;
  readonly atMilliseconds: number;
  readonly generation: number;
  readonly clientSessionId: string | null;
  readonly clientIntentId: number;
  readonly kind: PlaybackCommandKind;
  readonly stage: PlaybackCommandDiagnosticStage;
}

interface MutableIntent<T> {
  generation: number;
  clientSessionId: string | null;
  clientIntentId: number;
  phase: PlayerCommandPhase;
  target: T;
  timer: NodeJS.Timeout | null;
}

type CommandTarget = number | boolean | string | null;

export interface BegunCommand {
  readonly accepted: boolean;
  readonly generation: number;
}

const VOLUME_CONFIRMATION_TOLERANCE = 0.55;
const DIAGNOSTIC_LIMIT = 192;

export class CommandIntentCoordinator {
  private generation = 0;
  private failureRevision = 0;
  private diagnosticSequence = 0;
  private readonly diagnostics: PlaybackCommandDiagnostic[] = [];
  private readonly lastClientIntent = new Map<string, number>();
  private volume: MutableIntent<number>;
  private mute: MutableIntent<boolean>;
  private transport: MutableIntent<boolean>;
  private navigation: MutableIntent<string | null>;

  constructor(
    initial: {
      readonly volume: number;
      readonly muted: boolean;
      readonly paused: boolean;
    },
    private readonly onChange: (state: PlayerCommandState) => void,
    private readonly confirmationTimeoutMilliseconds = 2_000,
    private readonly diagnosticsEnabled = process.env.NODE_ENV === "test" ||
      process.env.EIDETIC_COMMAND_DIAGNOSTICS === "1",
  ) {
    this.confirmedVolume = initial.volume;
    this.confirmedMute = initial.muted;
    this.confirmedPaused = initial.paused;
    this.volume = this.initialIntent(initial.volume);
    this.mute = this.initialIntent(initial.muted);
    this.transport = this.initialIntent(initial.paused);
    this.navigation = this.initialIntent<string | null>(null);
  }

  snapshot(): PlayerCommandState {
    return {
      volume: this.levelSnapshot(this.volume),
      mute: this.booleanSnapshot(this.mute),
      transport: this.booleanSnapshot(this.transport),
      navigation: this.navigationSnapshot(this.navigation),
      failureRevision: this.failureRevision,
    };
  }

  diagnosticSnapshot(): readonly PlaybackCommandDiagnostic[] {
    return [...this.diagnostics];
  }

  record(
    kind: PlaybackCommandKind,
    stage: PlaybackCommandDiagnosticStage,
    generation = this.current(kind).generation,
    clientIntentId = this.current(kind).clientIntentId,
  ): void {
    if (!this.diagnosticsEnabled) return;
    this.diagnostics.push({
      sequence: ++this.diagnosticSequence,
      atMilliseconds: performance.now(),
      generation,
      clientSessionId: this.current(kind).clientSessionId,
      clientIntentId,
      kind,
      stage,
    });
    if (this.diagnostics.length > DIAGNOSTIC_LIMIT) this.diagnostics.shift();
  }

  noteApiReceived(
    kind: PlaybackCommandKind,
    metadata?: PlayerCommandRequestMetadata,
  ): void {
    if (metadata) this.record(kind, "ui-requested", 0, metadata.intentId);
    this.record(kind, "api-received", 0, metadata?.intentId ?? 0);
  }

  beginVolume(
    target: number,
    metadata?: PlayerCommandRequestMetadata,
  ): BegunCommand {
    return this.begin("volume", target, metadata);
  }

  beginMute(
    target: boolean,
    metadata?: PlayerCommandRequestMetadata,
  ): BegunCommand {
    return this.begin("mute", target, metadata);
  }

  beginTransport(
    targetPaused: boolean,
    metadata?: PlayerCommandRequestMetadata,
  ): BegunCommand {
    return this.begin("transport", targetPaused, metadata);
  }

  beginNavigation(
    targetQueueItemId: string | null,
    metadata?: PlayerCommandRequestMetadata,
  ): BegunCommand {
    return this.begin("navigation", targetQueueItemId, metadata);
  }

  acknowledge(kind: PlaybackCommandKind, generation: number): void {
    const intent = this.current(kind);
    if (intent.generation !== generation) {
      this.record(kind, "stale-discarded", generation);
      return;
    }
    if (!this.isPending(intent)) {
      this.record(kind, "ipc-acknowledged", generation);
      return;
    }
    intent.phase = "acknowledged";
    this.record(kind, "ipc-acknowledged", generation);
    if (kind === "navigation") {
      this.finishTimer(intent);
      intent.phase = "confirmed";
    }
    this.onChange(this.snapshot());
  }

  fail(kind: PlaybackCommandKind, generation: number): void {
    const intent = this.current(kind);
    if (intent.generation !== generation) {
      this.record(kind, "stale-discarded", generation);
      return;
    }
    if (!this.isPending(intent)) return;
    this.finishTimer(intent);
    intent.phase = "failed";
    if (kind === "volume") intent.target = this.confirmedVolume;
    else if (kind === "mute") intent.target = this.confirmedMute;
    else if (kind === "transport") intent.target = this.confirmedPaused;
    this.failureRevision += 1;
    this.record(kind, "failed", generation);
    this.onChange(this.snapshot());
  }

  observeVolume(value: number): number {
    if (this.isPending(this.volume)) {
      if (
        Math.abs(value - this.volume.target) <= VOLUME_CONFIRMATION_TOLERANCE
      ) {
        this.confirmedVolume = value;
        this.confirm("volume", this.volume);
      } else {
        this.record("volume", "stale-discarded");
      }
      return this.volume.target;
    }
    this.confirmedVolume = value;
    this.volume.target = value;
    return value;
  }

  observeMute(value: boolean): boolean {
    if (this.isPending(this.mute)) {
      if (value === this.mute.target) {
        this.confirmedMute = value;
        this.confirm("mute", this.mute);
      } else {
        this.record("mute", "stale-discarded");
      }
      return this.mute.target;
    }
    this.confirmedMute = value;
    this.mute.target = value;
    return value;
  }

  observePaused(value: boolean): boolean {
    if (this.isPending(this.transport)) {
      if (value === this.transport.target) {
        this.confirmedPaused = value;
        this.confirm("transport", this.transport);
      } else {
        this.record("transport", "stale-discarded");
      }
      return this.transport.target;
    }
    this.confirmedPaused = value;
    this.transport.target = value;
    return value;
  }

  confirmNavigation(queueItemId: string | null): void {
    if (
      this.navigation.target === queueItemId &&
      this.navigation.generation > 0
    )
      this.record("navigation", "property-confirmed");
  }

  pendingVolume(): Readonly<MutableIntent<number>> | null {
    return this.isPending(this.volume) ? this.volume : null;
  }

  pendingMute(): Readonly<MutableIntent<boolean>> | null {
    return this.isPending(this.mute) ? this.mute : null;
  }

  pendingPausedTarget(): boolean | null {
    return this.isPending(this.transport) ? this.transport.target : null;
  }

  hasPendingIntent(): boolean {
    return (
      this.isPending(this.volume) ||
      this.isPending(this.mute) ||
      this.isPending(this.transport) ||
      this.isPending(this.navigation)
    );
  }

  confirmedPausedTarget(): boolean {
    return this.confirmedPaused;
  }

  dispose(): void {
    for (const intent of [
      this.volume,
      this.mute,
      this.transport,
      this.navigation,
    ])
      this.finishTimer(intent);
  }

  private confirmedVolume: number;
  private confirmedMute: boolean;
  private confirmedPaused: boolean;

  private initialIntent<T>(target: T): MutableIntent<T> {
    return {
      generation: 0,
      clientSessionId: null,
      clientIntentId: 0,
      phase: "confirmed",
      target,
      timer: null,
    };
  }

  private begin(
    kind: PlaybackCommandKind,
    target: CommandTarget,
    metadata?: PlayerCommandRequestMetadata,
  ): BegunCommand {
    const clientIntentId = metadata?.intentId ?? 0;
    const clientSessionId = metadata?.clientSessionId ?? null;
    const clientKey = `${kind}:${clientSessionId ?? "backend"}`;
    const previousClientIntent = this.lastClientIntent.get(clientKey) ?? -1;
    if (clientIntentId > 0 && clientIntentId <= previousClientIntent) {
      this.record(kind, "stale-discarded", 0, clientIntentId);
      return { accepted: false, generation: this.current(kind).generation };
    }
    if (clientIntentId > 0)
      this.lastClientIntent.set(clientKey, clientIntentId);
    const previous = this.current(kind);
    if (this.isPending(previous)) {
      this.finishTimer(previous);
      this.record(
        kind,
        "superseded",
        previous.generation,
        previous.clientIntentId,
      );
    }
    const intent: MutableIntent<CommandTarget> = {
      generation: ++this.generation,
      clientSessionId,
      clientIntentId,
      phase: "pending",
      target,
      timer: null,
    };
    intent.timer = setTimeout(() => {
      this.timeout(kind, intent.generation);
    }, this.confirmationTimeoutMilliseconds);
    intent.timer.unref();
    this.assign(kind, intent);
    this.record(kind, "service-accepted", intent.generation, clientIntentId);
    this.onChange(this.snapshot());
    return { accepted: true, generation: intent.generation };
  }

  private timeout(kind: PlaybackCommandKind, generation: number): void {
    const intent = this.current(kind);
    if (intent.generation !== generation || !this.isPending(intent)) return;
    this.record(kind, "timed-out", generation);
    this.fail(kind, generation);
  }

  private confirm<T>(
    kind: PlaybackCommandKind,
    intent: MutableIntent<T>,
  ): void {
    this.finishTimer(intent);
    intent.phase = "confirmed";
    this.record(kind, "property-confirmed", intent.generation);
    this.onChange(this.snapshot());
  }

  private isPending(intent: MutableIntent<unknown>): boolean {
    return intent.phase === "pending" || intent.phase === "acknowledged";
  }

  private finishTimer(intent: MutableIntent<unknown>): void {
    if (intent.timer) clearTimeout(intent.timer);
    intent.timer = null;
  }

  private current(kind: PlaybackCommandKind): MutableIntent<unknown> {
    if (kind === "volume") return this.volume;
    if (kind === "mute") return this.mute;
    if (kind === "transport") return this.transport;
    return this.navigation;
  }

  private assign(
    kind: PlaybackCommandKind,
    intent: MutableIntent<CommandTarget>,
  ): void {
    if (kind === "volume") this.volume = intent as MutableIntent<number>;
    else if (kind === "mute") this.mute = intent as MutableIntent<boolean>;
    else if (kind === "transport")
      this.transport = intent as MutableIntent<boolean>;
    else this.navigation = intent as MutableIntent<string | null>;
  }

  private levelSnapshot(
    intent: MutableIntent<number>,
  ): PlayerLevelCommandState {
    return {
      generation: intent.generation,
      clientSessionId: intent.clientSessionId,
      clientIntentId: intent.clientIntentId,
      phase: intent.phase,
      target: intent.target,
    };
  }

  private booleanSnapshot(
    intent: MutableIntent<boolean>,
  ): PlayerBooleanCommandState {
    return {
      generation: intent.generation,
      clientSessionId: intent.clientSessionId,
      clientIntentId: intent.clientIntentId,
      phase: intent.phase,
      target: intent.target,
    };
  }

  private navigationSnapshot(
    intent: MutableIntent<string | null>,
  ): PlayerNavigationCommandState {
    return {
      generation: intent.generation,
      clientSessionId: intent.clientSessionId,
      clientIntentId: intent.clientIntentId,
      phase: intent.phase,
      targetQueueItemId: intent.target,
    };
  }
}
