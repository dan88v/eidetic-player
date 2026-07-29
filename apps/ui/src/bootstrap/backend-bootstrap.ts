import type { AppBootstrap } from "../api/player-api-client";

const REQUEST_TIMEOUT_MILLISECONDS = 5_000;
const RETRY_DELAYS_MILLISECONDS = [500, 1_000, 2_000, 5_000] as const;

interface AuthoritativeBootstrapOptions {
  readonly requestTimeoutMilliseconds?: number;
  readonly retryDelaysMilliseconds?: readonly number[];
  readonly onFailure?: (error: unknown, attempt: number) => void;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

export async function loadAuthoritativeBootstrap(
  request: (signal: AbortSignal) => Promise<AppBootstrap>,
  options: AuthoritativeBootstrapOptions = {},
): Promise<AppBootstrap> {
  const timeoutMilliseconds =
    options.requestTimeoutMilliseconds ?? REQUEST_TIMEOUT_MILLISECONDS;
  const retryDelays =
    options.retryDelaysMilliseconds ?? RETRY_DELAYS_MILLISECONDS;
  const wait = options.sleep ?? sleep;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => {
      controller.abort();
    }, timeoutMilliseconds);

    try {
      return await request(controller.signal);
    } catch (error) {
      options.onFailure?.(error, attempt);
    } finally {
      globalThis.clearTimeout(timeout);
    }

    const delay =
      retryDelays[Math.min(attempt - 1, Math.max(0, retryDelays.length - 1))] ??
      0;
    await wait(delay);
  }
}
