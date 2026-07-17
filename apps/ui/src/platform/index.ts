import { BrowserPlatformBridge } from "./browser-platform-bridge";
import { NeutralinoPlatformBridge } from "./neutralino-platform-bridge";
import {
  getNeutralinoDiagnostics,
  initializeNeutralinoRuntime,
  isNeutralinoRuntime,
  type NeutralinoRuntime,
  type NeutralinoRuntimeScope,
  type PlatformDiagnostics,
} from "./neutralino-runtime";
import type { PlatformBridge } from "./platform-bridge";

export class NativeShellInitializationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NativeShellInitializationError";
  }
}

export interface InitializedPlatform {
  readonly bridge: PlatformBridge;
  readonly diagnostics: PlatformDiagnostics;
}

export async function initializePlatform(
  scope: NeutralinoRuntimeScope = globalThis as NeutralinoRuntimeScope,
  readyTimeoutMilliseconds = 5_000,
): Promise<InitializedPlatform> {
  const diagnostics = getNeutralinoDiagnostics(scope);
  if (!diagnostics.namespacePresent) {
    return {
      bridge: new BrowserPlatformBridge(),
      diagnostics: { ...diagnostics, platformBridge: "browser" },
    };
  }
  if (!isNeutralinoRuntime(scope)) {
    throw new NativeShellInitializationError(
      "The Neutralino client library is present but incomplete. Check injectGlobals and injectClientLibrary.",
    );
  }

  const runtime = scope.Neutralino as NeutralinoRuntime;
  try {
    await initializeNeutralinoRuntime(runtime, readyTimeoutMilliseconds);
  } catch (error) {
    throw new NativeShellInitializationError(
      "The Eidetic Player native shell could not be initialized.",
      { cause: error },
    );
  }
  return {
    bridge: new NeutralinoPlatformBridge(runtime),
    diagnostics: { ...diagnostics, platformBridge: "neutralino" },
  };
}

export type { PlatformBridge } from "./platform-bridge";
export { isNeutralinoRuntime } from "./neutralino-runtime";
