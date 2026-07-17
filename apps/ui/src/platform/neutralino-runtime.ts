export type NeutralinoListener = (event: { readonly detail?: unknown }) => void;

export interface NeutralinoRuntime {
  init(): void | Promise<void>;
  readonly os: {
    showOpenDialog(
      title?: string,
      options?: {
        readonly multiSelections?: boolean;
        readonly filters?: readonly {
          readonly name: string;
          readonly extensions: readonly string[];
        }[];
      },
    ): Promise<unknown>;
  };
  readonly events: {
    on(name: string, listener: NeutralinoListener): unknown;
    off(name: string, listener: NeutralinoListener): unknown;
  };
}

export interface NeutralinoRuntimeScope {
  readonly Neutralino?: unknown;
  readonly NL_MODE?: unknown;
  readonly NL_PORT?: unknown;
  readonly NL_TOKEN?: unknown;
}

export interface PlatformDiagnostics {
  readonly platformBridge: "neutralino" | "browser";
  readonly nlMode: string | null;
  readonly neutralinoAvailable: boolean;
  readonly openDialogAvailable: boolean;
  readonly namespacePresent: boolean;
  readonly globalsAvailable: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function getNeutralinoDiagnostics(
  scope: NeutralinoRuntimeScope,
): PlatformDiagnostics {
  const namespace = scope.Neutralino;
  const namespacePresent = isObject(namespace);
  const os = namespacePresent && isObject(namespace.os) ? namespace.os : null;
  const events =
    namespacePresent && isObject(namespace.events) ? namespace.events : null;
  const openDialogAvailable = typeof os?.showOpenDialog === "function";
  const neutralinoAvailable =
    namespacePresent &&
    typeof namespace.init === "function" &&
    openDialogAvailable &&
    typeof events?.on === "function" &&
    typeof events.off === "function";
  const globalsAvailable =
    typeof scope.NL_MODE === "string" &&
    typeof scope.NL_PORT === "number" &&
    typeof scope.NL_TOKEN === "string" &&
    scope.NL_TOKEN.length > 0;
  return {
    platformBridge:
      neutralinoAvailable && globalsAvailable ? "neutralino" : "browser",
    nlMode: typeof scope.NL_MODE === "string" ? scope.NL_MODE : null,
    neutralinoAvailable,
    openDialogAvailable,
    namespacePresent,
    globalsAvailable,
  };
}

export function isNeutralinoRuntime(scope: NeutralinoRuntimeScope): boolean {
  const diagnostics = getNeutralinoDiagnostics(scope);
  return diagnostics.neutralinoAvailable && diagnostics.globalsAvailable;
}

const initializationByRuntime = new WeakMap<object, Promise<void>>();

export function initializeNeutralinoRuntime(
  runtime: NeutralinoRuntime,
  timeoutMilliseconds: number,
): Promise<void> {
  const cached = initializationByRuntime.get(runtime);
  if (cached) return cached;

  const initialization = new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const readyListener: NeutralinoListener = (): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void Promise.resolve(runtime.events.off("ready", readyListener));
      resolve();
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void Promise.resolve(runtime.events.off("ready", readyListener));
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    Promise.resolve(runtime.events.on("ready", readyListener))
      .then(async () => {
        timer = setTimeout(() => {
          fail(new Error("Neutralino ready event timed out."));
        }, timeoutMilliseconds);
        await runtime.init();
      })
      .catch(fail);
  });
  initializationByRuntime.set(runtime, initialization);
  return initialization;
}
