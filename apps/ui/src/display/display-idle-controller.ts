import type {
  DisplaySnapshot,
  ScreenDimLevelPercent,
  ScreenDimTimeoutSeconds,
  ScreenStandbyTimeoutSeconds,
} from "../../../../packages/shared/src/display";
import type { DisplayApiClient } from "../api/display-api-client";

const DIM_TEST_MILLISECONDS = 10_000;
const STANDBY_TEST_MILLISECONDS = 15_000;

export interface DisplayIdlePreferences {
  readonly screenDimTimeoutSeconds: ScreenDimTimeoutSeconds;
  readonly screenDimLevelPercent: ScreenDimLevelPercent;
  readonly screenStandbyTimeoutSeconds: ScreenStandbyTimeoutSeconds;
}

export interface DisplayIdleControllerOptions {
  readonly root: HTMLElement;
  readonly document?: Document;
  readonly window?: Window;
  readonly api: DisplayApiClient;
  readonly initialSnapshot: DisplaySnapshot;
  readonly preferences: DisplayIdlePreferences;
  readonly animationsEnabled: boolean;
  readonly onSnapshot: (snapshot: DisplaySnapshot) => void;
  readonly onError: (message: string) => void;
}

type TransitionKind = "dim" | "standby" | "test-wake";

export interface DisplayIdleDeadline {
  readonly kind: TransitionKind;
  readonly at: number;
}

export function nextDisplayIdleDeadline(
  now: number,
  lastActivityAt: number,
  preferences: DisplayIdlePreferences,
  state: DisplaySnapshot["state"],
  standbyAllowed: boolean,
): DisplayIdleDeadline | null {
  const dimAt =
    preferences.screenDimTimeoutSeconds === 0
      ? Number.POSITIVE_INFINITY
      : lastActivityAt + preferences.screenDimTimeoutSeconds * 1_000;
  const standbyAt =
    !standbyAllowed || preferences.screenStandbyTimeoutSeconds === 0
      ? Number.POSITIVE_INFINITY
      : lastActivityAt + preferences.screenStandbyTimeoutSeconds * 1_000;
  if (state === "active" && dimAt <= now) return { kind: "dim", at: now };
  if ((state === "active" || state === "dimmed") && standbyAt <= now)
    return { kind: "standby", at: now };
  if (state === "active" && dimAt < standbyAt)
    return Number.isFinite(dimAt) ? { kind: "dim", at: dimAt } : null;
  if (state === "active" || state === "dimmed")
    return Number.isFinite(standbyAt)
      ? { kind: "standby", at: standbyAt }
      : null;
  return null;
}

export class DisplayIdleController {
  private readonly document: Document;
  private readonly window: Window;
  private readonly overlay: HTMLDivElement;
  private readonly wakeShield: HTMLDivElement;
  private preferences: DisplayIdlePreferences;
  private snapshot: DisplaySnapshot;
  private lastActivityAt: number;
  private timer: number | null = null;
  private testWakeAt: number | null = null;
  private inhibited = false;
  private playbackActive = false;
  private hdmiAudioActive = false;
  private operation: Promise<void> = Promise.resolve();
  private destroyed = false;
  private suppressClickUntil = 0;
  private lastMouseActivityAt = Number.NEGATIVE_INFINITY;
  private wakeRecoveryRequired = false;
  private hdmiInhibitedVisualState: "active" | "dimmed" = "active";

  constructor(private readonly options: DisplayIdleControllerOptions) {
    this.document = options.document ?? document;
    this.window = options.window ?? window;
    this.preferences = options.preferences;
    this.snapshot = options.initialSnapshot;
    this.lastActivityAt = this.now();
    this.overlay = this.document.createElement("div");
    this.overlay.className = "display-dim-overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    this.wakeShield = this.document.createElement("div");
    this.wakeShield.className = "display-wake-shield";
    this.wakeShield.hidden = true;
    this.wakeShield.setAttribute("aria-hidden", "true");
    options.root.append(this.overlay, this.wakeShield);
    this.setAnimationsEnabled(options.animationsEnabled);
    this.applySnapshot(options.initialSnapshot);
    this.addListeners();
    this.schedule();
  }

  getSnapshot(): DisplaySnapshot {
    return this.snapshot;
  }

  updatePreferences(preferences: DisplayIdlePreferences): void {
    this.preferences = preferences;
    this.lastActivityAt = this.now();
    if (this.snapshot.state !== "active") void this.wake();
    else this.schedule();
  }

  setAnimationsEnabled(enabled: boolean): void {
    this.overlay.dataset.motion = enabled ? "enabled" : "reduced";
  }

  setPlaybackActive(active: boolean): void {
    if (active === this.playbackActive) return;
    this.playbackActive = active;
    this.lastActivityAt = this.now();
    if (active) {
      this.testWakeAt = null;
      this.clearTimer();
      if (this.snapshot.state !== "active" || this.wakeRecoveryRequired)
        void this.wake();
      else
        this.applySnapshot({
          ...this.snapshot,
          nextTransitionAt: null,
        });
      return;
    }
    this.schedule();
  }

  setHdmiAudioActive(active: boolean): void {
    if (active === this.hdmiAudioActive) return;
    this.hdmiAudioActive = active;
    this.lastActivityAt = this.now();
    const releasedState =
      !active &&
      !this.inhibited &&
      this.snapshot.state === "inhibited" &&
      this.snapshot.standbyInhibitedReason === "hdmi-audio-active"
        ? this.hdmiInhibitedVisualState
        : this.snapshot.state;
    this.applySnapshot({
      ...this.snapshot,
      state: releasedState,
      standbyInhibitedReason: active ? "hdmi-audio-active" : null,
    });
    if (active && this.snapshot.state === "standby") void this.wake();
    else this.schedule();
  }

  setInhibited(inhibited: boolean): void {
    if (inhibited === this.inhibited) return;
    this.inhibited = inhibited;
    this.lastActivityAt = this.now();
    if (inhibited)
      void this.wake().then(() => {
        this.applySnapshot({ ...this.snapshot, state: "inhibited" });
      });
    else {
      if (this.snapshot.state === "inhibited")
        this.applySnapshot({ ...this.snapshot, state: "active" });
      this.schedule();
    }
  }

  testDim(): Promise<void> {
    if (this.inhibited)
      return Promise.reject(
        new Error("Display tests are unavailable during this system action."),
      );
    if (this.testWakeAt !== null)
      return Promise.reject(new Error("A display test is already active."));
    return this.run(async () => {
      this.applySnapshot({
        ...this.snapshot,
        state: "transitioning",
        testActive: "dim",
      });
      const snapshot = await this.options.api.testDim(
        this.preferences.screenDimLevelPercent,
      );
      this.applySnapshot(snapshot);
      this.testWakeAt = this.now() + DIM_TEST_MILLISECONDS;
      this.schedule();
    }, true);
  }

  testStandby(): Promise<void> {
    if (this.inhibited)
      return Promise.reject(
        new Error("Display tests are unavailable during this system action."),
      );
    if (this.testWakeAt !== null)
      return Promise.reject(new Error("A display test is already active."));
    return this.run(async () => {
      if (this.hdmiAudioActive)
        throw new Error(
          "Display standby is suspended while HDMI is used for audio.",
        );
      this.applySnapshot({
        ...this.snapshot,
        state: "transitioning",
        testActive: "standby",
      });
      const snapshot = await this.options.api.testStandby();
      this.applySnapshot(snapshot);
      this.testWakeAt = this.now() + STANDBY_TEST_MILLISECONDS;
      this.schedule();
    }, true);
  }

  prepareForTransition(): Promise<void> {
    this.inhibited = true;
    return this.wake(true);
  }

  wake(propagateError = false): Promise<void> {
    this.lastActivityAt = this.now();
    this.testWakeAt = null;
    if (this.snapshot.state === "active" && !this.wakeRecoveryRequired) {
      this.schedule();
      return Promise.resolve();
    }
    return this.run(async () => {
      this.wakeRecoveryRequired = true;
      try {
        const snapshot = await this.options.api.wake();
        this.wakeRecoveryRequired = false;
        this.applySnapshot(snapshot);
        this.schedule();
      } catch (error) {
        this.applySnapshot({
          ...this.snapshot,
          state: "error",
          lastErrorCode: "wake-failed",
        });
        throw error;
      }
    }, propagateError);
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimer();
    this.removeListeners();
    this.overlay.remove();
    this.wakeShield.remove();
  }

  private readonly onActivity = (): void => {
    if (this.isWakeState()) {
      this.consumeWake();
      return;
    }
    this.lastActivityAt = this.now();
    this.schedule();
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (
      !event.isTrusted ||
      (event.movementX === 0 && event.movementY === 0) ||
      this.now() - this.lastMouseActivityAt < 200
    )
      return;
    this.lastMouseActivityAt = this.now();
    if (this.isWakeState()) {
      this.suppressClickUntil = this.now() + 500;
      void this.wake();
      return;
    }
    this.lastActivityAt = this.now();
    this.schedule();
  };

  private readonly onWakeInput = (event: Event): void => {
    if (!this.isWakeState()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressClickUntil = this.now() + 500;
    void this.wake();
  };

  private readonly onClickCapture = (event: Event): void => {
    if (this.now() <= this.suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.suppressClickUntil = 0;
      return;
    }
    if (!this.isWakeState()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.wake();
  };

  private addListeners(): void {
    for (const eventName of ["pointerdown", "keydown", "wheel"])
      this.document.addEventListener(eventName, this.onWakeInput, {
        capture: true,
        passive: false,
      });
    for (const eventName of ["pointerdown", "keydown", "wheel"])
      this.document.addEventListener(eventName, this.onActivity, {
        passive: true,
      });
    this.document.addEventListener("mousemove", this.onMouseMove, {
      passive: true,
    });
    this.document.addEventListener("click", this.onClickCapture, {
      capture: true,
    });
  }

  private removeListeners(): void {
    for (const eventName of ["pointerdown", "keydown", "wheel"]) {
      this.document.removeEventListener(eventName, this.onWakeInput, true);
      this.document.removeEventListener(eventName, this.onActivity);
    }
    this.document.removeEventListener("mousemove", this.onMouseMove);
    this.document.removeEventListener("click", this.onClickCapture, true);
  }

  private consumeWake(): void {
    void this.wake();
  }

  private isWakeState(): boolean {
    return (
      this.snapshot.state === "dimmed" ||
      this.snapshot.state === "standby" ||
      this.snapshot.state === "inhibited" ||
      this.snapshot.state === "transitioning" ||
      this.wakeRecoveryRequired
    );
  }

  private schedule(): void {
    this.clearTimer();
    if (this.destroyed || this.inhibited) return;
    const now = this.now();
    if (this.testWakeAt !== null) {
      this.timer = this.window.setTimeout(
        () => void this.wake(),
        Math.max(0, this.testWakeAt - now),
      );
      return;
    }
    if (this.playbackActive) {
      if (this.snapshot.nextTransitionAt !== null)
        this.applySnapshot({
          ...this.snapshot,
          nextTransitionAt: null,
        });
      return;
    }
    const deadline = nextDisplayIdleDeadline(
      now,
      this.lastActivityAt,
      this.preferences,
      this.snapshot.state,
      this.snapshot.standbyAvailable,
    );
    if (!deadline) return;
    this.timer = this.window.setTimeout(
      () => {
        this.transition(deadline.kind);
      },
      Math.max(0, deadline.at - now),
    );
    this.publishNextTransition(deadline.at);
  }

  private transition(kind: TransitionKind): void {
    this.timer = null;
    if (kind === "test-wake") {
      void this.wake();
      return;
    }
    if (kind === "standby" && this.hdmiAudioActive) {
      this.hdmiInhibitedVisualState =
        this.snapshot.state === "dimmed" ? "dimmed" : "active";
      this.applySnapshot({
        ...this.snapshot,
        state: "inhibited",
        standbyInhibitedReason: "hdmi-audio-active",
      });
      return;
    }
    void this.run(async () => {
      this.applySnapshot({
        ...this.snapshot,
        state: "transitioning",
      });
      const snapshot =
        kind === "dim"
          ? await this.options.api.dim(this.preferences.screenDimLevelPercent)
          : await this.options.api.standby();
      this.applySnapshot(snapshot);
      this.schedule();
    });
  }

  private run(
    operation: () => Promise<void>,
    propagateError = false,
  ): Promise<void> {
    const result = this.operation.then(operation, operation);
    this.operation = result.catch(async (error: unknown) => {
      try {
        this.applySnapshot(await this.options.api.state());
      } catch {
        // Preserve the last safe local snapshot if the backend is unavailable.
      }
      if (!propagateError)
        this.options.onError(
          error instanceof Error ? error.message : "Display control failed.",
        );
    });
    return propagateError ? result : this.operation;
  }

  private applySnapshot(snapshot: DisplaySnapshot): void {
    this.snapshot = snapshot;
    const dimmed =
      (snapshot.state === "dimmed" ||
        (snapshot.state === "inhibited" &&
          snapshot.standbyInhibitedReason === "hdmi-audio-active" &&
          this.hdmiInhibitedVisualState === "dimmed")) &&
      snapshot.dimMethod === "software";
    const fixtureStandby =
      snapshot.state === "standby" && snapshot.standbyMethod === "fixture";
    this.overlay.classList.toggle("display-dim-overlay--visible", dimmed);
    this.overlay.classList.toggle(
      "display-dim-overlay--fixture-standby",
      fixtureStandby,
    );
    this.overlay.style.setProperty(
      "--display-dim-opacity",
      String(1 - this.preferences.screenDimLevelPercent / 100),
    );
    this.wakeShield.hidden = !this.isWakeState();
    this.options.onSnapshot(snapshot);
  }

  private publishNextTransition(at: number): void {
    const wallClockAt = Date.now() + Math.max(0, at - this.now());
    this.snapshot = {
      ...this.snapshot,
      nextTransitionAt: new Date(wallClockAt).toISOString(),
    };
    this.options.onSnapshot(this.snapshot);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.window.clearTimeout(this.timer);
    this.timer = null;
  }

  private now(): number {
    return this.window.performance.now();
  }
}
