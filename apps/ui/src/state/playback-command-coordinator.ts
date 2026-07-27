import type {
  PlayerCommandRequestMetadata,
  PlayerCommandState,
  PlayerState,
} from "../../../../packages/shared/src/player";

export type UiPlaybackCommandKind =
  "volume" | "mute" | "transport" | "navigation";

export interface UiPlaybackCommandDiagnostic {
  readonly sequence: number;
  readonly atMilliseconds: number;
  readonly clientIntentId: number;
  readonly kind: UiPlaybackCommandKind;
  readonly stage:
    | "ui-requested"
    | "api-failed"
    | "state-received"
    | "confirmed"
    | "failed"
    | "superseded";
}

interface PendingUiIntent<T> {
  readonly clientSessionId: string;
  readonly clientIntentId: number;
  readonly target: T;
}

interface ReconciledCommand {
  readonly clientSessionId: string | null;
  readonly clientIntentId: number;
  readonly phase: PlayerCommandState["volume"]["phase"];
}

type UiCommandTarget = number | boolean | string | null;

export interface PlaybackCommandCoordinatorCallbacks {
  readonly onConfirmed?: (
    kind: UiPlaybackCommandKind,
    target: number | boolean | string | null,
  ) => void;
  readonly onFailed?: (kind: UiPlaybackCommandKind) => void;
}

const DIAGNOSTIC_LIMIT = 96;

export class PlaybackCommandCoordinator {
  private readonly clientSessionId = crypto.randomUUID();
  private nextClientIntentId = 0;
  private diagnosticSequence = 0;
  private readonly diagnostics: UiPlaybackCommandDiagnostic[] = [];
  private volume: PendingUiIntent<number> | null = null;
  private mute: PendingUiIntent<boolean> | null = null;
  private transport: PendingUiIntent<boolean> | null = null;
  private navigation: PendingUiIntent<string | null> | null = null;

  constructor(
    private readonly callbacks: PlaybackCommandCoordinatorCallbacks = {},
  ) {}

  beginVolume(
    state: PlayerState,
    target: number,
  ): {
    readonly state: PlayerState;
    readonly metadata: PlayerCommandRequestMetadata;
  } {
    const metadata = this.begin("volume", target);
    return {
      state: { ...state, volume: target },
      metadata,
    };
  }

  beginMute(
    state: PlayerState,
    target: boolean,
  ): {
    readonly state: PlayerState;
    readonly metadata: PlayerCommandRequestMetadata;
  } {
    const metadata = this.begin("mute", target);
    return {
      state: { ...state, muted: target },
      metadata,
    };
  }

  beginTransport(
    state: PlayerState,
    targetPaused: boolean,
  ): {
    readonly state: PlayerState;
    readonly metadata: PlayerCommandRequestMetadata;
  } {
    const metadata = this.begin("transport", targetPaused);
    return {
      state: { ...state, paused: targetPaused },
      metadata,
    };
  }

  beginNavigation(
    targetQueueItemId: string | null,
  ): PlayerCommandRequestMetadata {
    return this.begin("navigation", targetQueueItemId);
  }

  pendingNavigationTarget(): string | null | undefined {
    return this.navigation?.target;
  }

  receive(state: PlayerState): PlayerState {
    this.record("navigation", "state-received", 0);
    const commands = state.commands;
    if (commands) {
      this.volume = this.reconcile("volume", this.volume, commands.volume);
      this.mute = this.reconcile("mute", this.mute, commands.mute);
      this.transport = this.reconcile(
        "transport",
        this.transport,
        commands.transport,
      );
      this.navigation = this.reconcile(
        "navigation",
        this.navigation,
        commands.navigation,
      );
    }
    return {
      ...state,
      ...(this.volume ? { volume: this.volume.target } : {}),
      ...(this.mute ? { muted: this.mute.target } : {}),
      ...(this.transport ? { paused: this.transport.target } : {}),
    };
  }

  apiFailed(
    kind: UiPlaybackCommandKind,
    clientIntentId: number,
    authoritative: PlayerState,
  ): PlayerState {
    const pending = this.pending(kind);
    if (pending?.clientIntentId !== clientIntentId)
      return this.receive(authoritative);
    this.assign(kind, null);
    this.record(kind, "api-failed", clientIntentId);
    this.callbacks.onFailed?.(kind);
    return this.receive(authoritative);
  }

  diagnosticSnapshot(): readonly UiPlaybackCommandDiagnostic[] {
    return [...this.diagnostics];
  }

  private begin(
    kind: UiPlaybackCommandKind,
    target: UiCommandTarget,
  ): PlayerCommandRequestMetadata {
    const previous = this.pending(kind);
    if (previous) this.record(kind, "superseded", previous.clientIntentId);
    const metadata = {
      clientSessionId: this.clientSessionId,
      intentId: ++this.nextClientIntentId,
      requestedAtMilliseconds: performance.now(),
    };
    this.assign(kind, {
      clientSessionId: metadata.clientSessionId,
      clientIntentId: metadata.intentId,
      target,
    });
    this.record(kind, "ui-requested", metadata.intentId);
    return metadata;
  }

  private reconcile<T extends number | boolean | string | null>(
    kind: UiPlaybackCommandKind,
    pending: PendingUiIntent<T> | null,
    command: ReconciledCommand,
  ): PendingUiIntent<T> | null {
    if (
      pending?.clientSessionId !== command.clientSessionId ||
      command.clientIntentId !== pending.clientIntentId
    )
      return pending;
    if (command.phase === "confirmed") {
      this.record(kind, "confirmed", pending.clientIntentId);
      this.callbacks.onConfirmed?.(kind, pending.target);
      return null;
    }
    if (command.phase === "failed") {
      this.record(kind, "failed", pending.clientIntentId);
      this.callbacks.onFailed?.(kind);
      return null;
    }
    return pending;
  }

  private pending(
    kind: UiPlaybackCommandKind,
  ): PendingUiIntent<unknown> | null {
    if (kind === "volume") return this.volume;
    if (kind === "mute") return this.mute;
    if (kind === "transport") return this.transport;
    return this.navigation;
  }

  private assign(
    kind: UiPlaybackCommandKind,
    value: PendingUiIntent<UiCommandTarget> | null,
  ): void {
    if (kind === "volume")
      this.volume = value as PendingUiIntent<number> | null;
    else if (kind === "mute")
      this.mute = value as PendingUiIntent<boolean> | null;
    else if (kind === "transport")
      this.transport = value as PendingUiIntent<boolean> | null;
    else this.navigation = value as PendingUiIntent<string | null> | null;
  }

  private record(
    kind: UiPlaybackCommandKind,
    stage: UiPlaybackCommandDiagnostic["stage"],
    clientIntentId: number,
  ): void {
    this.diagnostics.push({
      sequence: ++this.diagnosticSequence,
      atMilliseconds: performance.now(),
      clientIntentId,
      kind,
      stage,
    });
    if (this.diagnostics.length > DIAGNOSTIC_LIMIT) this.diagnostics.shift();
  }
}
