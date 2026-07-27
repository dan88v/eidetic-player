import {
  type PreferencesPatch,
  type PreferencesSnapshot,
  type UiPreferences,
  uiPreferenceKeys,
} from "../../../../packages/shared/src/preferences";

export type PreferencesSaveState =
  "idle" | "pending" | "saving" | "saved" | "degraded";

export interface PreferencesControllerOptions {
  readonly debounceMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly onWarning: () => void;
}

export interface PreferencesTransport {
  get(): Promise<PreferencesSnapshot>;
  patch(patch: PreferencesPatch): Promise<PreferencesSnapshot>;
}

function isRevisionConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "PREFERENCES_REVISION_CONFLICT"
  );
}

export class PreferencesController {
  private preferences: UiPreferences;
  private revision: number;
  private dirty: Partial<UiPreferences> = {};
  private timer: number | null = null;
  private saveState: PreferencesSaveState = "idle";
  private saveOperation: Promise<void> = Promise.resolve();
  private warningActive = false;
  private destroyed = false;
  private readonly debounceMs: number;
  private readonly retryDelaysMs: readonly number[];

  constructor(
    snapshot: PreferencesSnapshot,
    private readonly api: PreferencesTransport,
    private readonly options: PreferencesControllerOptions,
  ) {
    this.preferences = Object.freeze({ ...snapshot.preferences });
    this.revision = snapshot.revision;
    this.debounceMs = options.debounceMs ?? 300;
    this.retryDelaysMs = options.retryDelaysMs ?? [150, 300, 600];
    if (snapshot.persistence === "degraded") this.saveState = "degraded";
  }

  getPreferences(): UiPreferences {
    return this.preferences;
  }

  getSaveState(): PreferencesSaveState {
    return this.saveState;
  }

  update(changes: Partial<UiPreferences>): void {
    if (this.destroyed) return;
    const effective: Partial<UiPreferences> = {};
    for (const key of uiPreferenceKeys) {
      if (key in changes && !Object.is(changes[key], this.preferences[key]))
        Object.assign(effective, { [key]: changes[key] });
    }
    if (Object.keys(effective).length === 0) return;
    this.preferences = Object.freeze({ ...this.preferences, ...effective });
    this.dirty = { ...this.dirty, ...effective };
    this.saveState = "pending";
    this.schedule();
  }

  async flush(timeoutMs = 1_500): Promise<boolean> {
    if (this.destroyed && Object.keys(this.dirty).length === 0) return true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.enqueueSave();
    let timeout: number | undefined;
    const bounded = new Promise<boolean>((resolve) => {
      timeout = window.setTimeout(() => {
        resolve(false);
      }, timeoutMs);
    });
    const completed = this.saveOperation.then(
      () => Object.keys(this.dirty).length === 0,
      () => false,
    );
    const result = await Promise.race([bounded, completed]);
    if (timeout !== undefined) window.clearTimeout(timeout);
    if (!result) this.warnOnce();
    return result;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.enqueueSave();
    }, this.debounceMs);
  }

  private enqueueSave(): void {
    if (Object.keys(this.dirty).length === 0) return;
    this.saveOperation = this.saveOperation
      .catch(() => undefined)
      .then(() => this.saveDirty());
  }

  private async saveDirty(): Promise<void> {
    if (Object.keys(this.dirty).length === 0) return;
    const sending = this.dirty;
    this.dirty = {};
    this.saveState = "saving";
    for (let attempt = 0; ; attempt += 1) {
      try {
        const snapshot = await this.api.patch({
          expectedRevision: this.revision,
          changes: sending,
        });
        this.revision = snapshot.revision;
        this.preferences = Object.freeze({
          ...snapshot.preferences,
          ...this.dirty,
        });
        this.saveState =
          Object.keys(this.dirty).length > 0 ? "pending" : "saved";
        this.warningActive = false;
        if (Object.keys(this.dirty).length > 0) this.schedule();
        return;
      } catch (error) {
        if (isRevisionConflict(error)) {
          try {
            const latest = await this.api.get();
            this.revision = latest.revision;
          } catch {
            // The bounded retry below handles a failed conflict refresh.
          }
        }
        if (attempt >= this.retryDelaysMs.length) {
          this.dirty = { ...sending, ...this.dirty };
          this.saveState = "degraded";
          this.warnOnce();
          return;
        }
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, this.retryDelaysMs[attempt]);
        });
      }
    }
  }

  private warnOnce(): void {
    if (this.warningActive) return;
    this.warningActive = true;
    this.options.onWarning();
  }
}
