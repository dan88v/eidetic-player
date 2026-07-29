export interface PlayerRecoveryScheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultScheduler: PlayerRecoveryScheduler = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export const automaticPlayerRecoveryDelaysMilliseconds = [
  5_000, 15_000, 30_000,
] as const;

export class PlayerRecoveryService {
  private automaticAttempt = 0;
  private timer: unknown = null;
  private operation: Promise<boolean> | null = null;
  private closed = false;

  constructor(
    private readonly recover: () => Promise<boolean>,
    private readonly scheduler: PlayerRecoveryScheduler = defaultScheduler,
  ) {}

  startAutomaticRecovery(): void {
    if (this.closed || this.timer !== null || this.operation) return;
    this.scheduleNext();
  }

  retryNow(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return this.attempt();
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    const delay =
      automaticPlayerRecoveryDelaysMilliseconds[this.automaticAttempt];
    if (delay === undefined || this.closed) return;
    this.automaticAttempt += 1;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      void this.attempt().then((recovered) => {
        if (!recovered) this.scheduleNext();
      });
    }, delay);
  }

  private attempt(): Promise<boolean> {
    if (this.operation) return this.operation;
    const operation = this.recover()
      .catch(() => false)
      .then((recovered) => {
        if (recovered) {
          if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
          this.timer = null;
          this.automaticAttempt = 0;
        }
        return recovered;
      })
      .finally(() => {
        if (this.operation === operation) this.operation = null;
      });
    this.operation = operation;
    return operation;
  }
}
