import type { AudioOutputState } from "../../../../packages/shared/src/audio-output.js";
import {
  defaultDisplaySnapshot,
  type DisplaySnapshot,
  type ScreenDimLevelPercent,
} from "../../../../packages/shared/src/display.js";
import { DisplayPowerError } from "./display-errors.js";
import type { DisplayPlatformAdapter } from "./display-platform-adapter.js";

export const DISPLAY_DIM_TEST_MILLISECONDS = 10_000;
export const DISPLAY_STANDBY_TEST_MILLISECONDS = 15_000;

export interface DisplayScheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
  sleep(milliseconds: number): Promise<void>;
}

const defaultScheduler: DisplayScheduler = {
  setTimeout: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    timer.unref();
    return timer;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  sleep: (milliseconds) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      timer.unref();
    }),
};

export class DisplayPowerService {
  private state: DisplaySnapshot = defaultDisplaySnapshot;
  private operation: Promise<void> = Promise.resolve();
  private testTimer: unknown = null;
  private hdmiAudioActive = false;
  private initialized = false;

  constructor(
    private readonly adapter: DisplayPlatformAdapter,
    private readonly scheduler: DisplayScheduler = defaultScheduler,
  ) {}

  snapshot(): DisplaySnapshot {
    return this.state;
  }

  async initialize(): Promise<DisplaySnapshot> {
    try {
      const capabilities = await this.adapter.probe();
      this.update({
        ...capabilities,
        state: "transitioning",
        lastErrorCode: null,
      });
      await this.wakeWithRetry();
      this.update({ state: "active", testActive: null, lastErrorCode: null });
    } catch {
      this.update({
        state: "error",
        testActive: null,
        lastErrorCode: "capability-failed",
      });
    } finally {
      this.initialized = true;
    }
    return this.snapshot();
  }

  setAudioOutputState(audioOutput: AudioOutputState): void {
    const active = audioOutput.selectedPhysicalOutputId === "hdmi";
    if (active === this.hdmiAudioActive) return;
    this.hdmiAudioActive = active;
    if (active) {
      if (this.state.state === "standby") {
        void this.wake()
          .then(() => {
            this.update({
              state: "inhibited",
              standbyInhibitedReason: "hdmi-audio-active",
            });
          })
          .catch(() => undefined);
      } else {
        this.update({ standbyInhibitedReason: "hdmi-audio-active" });
      }
    } else {
      this.update({
        state: this.state.state === "inhibited" ? "active" : this.state.state,
        standbyInhibitedReason: null,
      });
    }
  }

  dim(
    levelPercent: ScreenDimLevelPercent,
    test = false,
  ): Promise<DisplaySnapshot> {
    return this.serialize(async () => {
      this.assertReady();
      this.beginOperation();
      try {
        await this.adapter.dim(levelPercent);
        this.update({
          state: "dimmed",
          dimLevelPercent: levelPercent,
          testActive: test ? "dim" : null,
          lastErrorCode: null,
        });
        if (test) this.scheduleTestWake(DISPLAY_DIM_TEST_MILLISECONDS);
        return this.snapshot();
      } catch {
        this.update({ state: "active", lastErrorCode: "dim-failed" });
        throw new DisplayPowerError(
          "DISPLAY_DIM_FAILED",
          "The display could not be dimmed.",
          503,
        );
      }
    });
  }

  standby(test = false): Promise<DisplaySnapshot> {
    return this.serialize(async () => {
      this.assertReady();
      if (!this.state.standbyAvailable)
        throw new DisplayPowerError(
          "DISPLAY_STANDBY_UNAVAILABLE",
          "Display standby is unavailable on this system.",
          409,
        );
      if (this.hdmiAudioActive) {
        this.update({
          state: "inhibited",
          standbyInhibitedReason: "hdmi-audio-active",
        });
        throw new DisplayPowerError(
          "DISPLAY_STANDBY_INHIBITED",
          "Display standby is suspended while HDMI is used for audio.",
          409,
        );
      }
      this.beginOperation();
      try {
        await this.adapter.standby();
        this.update({
          state: "standby",
          testActive: test ? "standby" : null,
          lastErrorCode: null,
        });
        if (test) this.scheduleTestWake(DISPLAY_STANDBY_TEST_MILLISECONDS);
        return this.snapshot();
      } catch {
        this.update({ state: "dimmed", lastErrorCode: "standby-failed" });
        throw new DisplayPowerError(
          "DISPLAY_STANDBY_FAILED",
          "The display could not enter standby.",
          503,
        );
      }
    });
  }

  wake(): Promise<DisplaySnapshot> {
    return this.serialize(async () => {
      this.assertReady();
      this.cancelTestTimer();
      this.update({ state: "transitioning", testActive: null });
      try {
        await this.wakeWithRetry();
        this.update({
          state: "active",
          testActive: null,
          lastErrorCode: null,
        });
        return this.snapshot();
      } catch {
        this.update({
          state: "error",
          testActive: null,
          lastErrorCode: "wake-failed",
        });
        throw new DisplayPowerError(
          "DISPLAY_WAKE_FAILED",
          "The display could not be restored.",
          503,
        );
      }
    });
  }

  async close(): Promise<void> {
    this.cancelTestTimer();
    if (!this.initialized) return;
    await this.wake().then(
      () => undefined,
      () => undefined,
    );
  }

  private beginOperation(): void {
    if (this.state.state === "transitioning" || this.state.testActive !== null)
      throw new DisplayPowerError(
        "DISPLAY_OPERATION_IN_PROGRESS",
        "A display operation is already in progress.",
        409,
      );
    this.cancelTestTimer();
    this.update({ state: "transitioning", testActive: null });
  }

  private scheduleTestWake(milliseconds: number): void {
    this.cancelTestTimer();
    this.testTimer = this.scheduler.setTimeout(() => {
      this.testTimer = null;
      void this.wake().catch(() => undefined);
    }, milliseconds);
  }

  private cancelTestTimer(): void {
    if (this.testTimer !== null) this.scheduler.clearTimeout(this.testTimer);
    this.testTimer = null;
  }

  private async wakeWithRetry(): Promise<void> {
    const delays = [0, 150, 500] as const;
    let lastError: unknown;
    for (const delay of delays) {
      if (delay > 0) await this.scheduler.sleep(delay);
      try {
        await this.adapter.wake();
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("wake failed");
  }

  private update(patch: Partial<DisplaySnapshot>): void {
    this.state = {
      ...this.state,
      ...patch,
      nextTransitionAt: null,
      revision: this.state.revision + 1,
    };
  }

  private assertReady(): void {
    if (!this.initialized)
      throw new DisplayPowerError(
        "DISPLAY_OPERATION_IN_PROGRESS",
        "Display control is starting.",
        503,
      );
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
