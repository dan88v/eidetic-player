export type LatestRequestResult = "applied" | "stale";

interface LatestRequestHandlers<T> {
  readonly success: (value: T) => void | Promise<void>;
  readonly failure: (error: unknown) => void | Promise<void>;
}

type RequestOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

/** Applies only the newest request's outcome, including failures. */
export class LatestRequestCoordinator {
  private revision = 0;

  invalidate(): void {
    this.revision += 1;
  }

  async run<T>(
    request: () => Promise<T>,
    handlers: LatestRequestHandlers<T>,
  ): Promise<LatestRequestResult> {
    const requestRevision = ++this.revision;
    let outcome: RequestOutcome<T>;
    try {
      outcome = { ok: true, value: await request() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    if (requestRevision !== this.revision) return "stale";
    if (outcome.ok) await handlers.success(outcome.value);
    else await handlers.failure(outcome.error);
    return "applied";
  }
}
