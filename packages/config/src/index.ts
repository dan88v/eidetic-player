export type AppEnvironment = "development" | "production";
export type AppPlatform = "windows" | "linux" | "darwin" | "unknown";

export interface AppConfig {
  readonly appName: string;
  readonly environment: AppEnvironment;
  readonly backendHost: string;
  readonly backendPort: number;
  readonly targetViewportWidth: number;
  readonly targetViewportHeight: number;
  readonly fullscreen: boolean;
  readonly platform: AppPlatform;
  readonly development: boolean;
}

export const APP_DEFAULTS = Object.freeze({
  appName: "Eidetic Player",
  backendHost: "127.0.0.1",
  backendPort: 4310,
  targetViewportWidth: 1280,
  targetViewportHeight: 800,
  fullscreen: false,
});

export interface RuntimeConfig {
  readonly environment: AppEnvironment;
  readonly backendHost?: string | undefined;
  readonly backendPort?: string | number | undefined;
  readonly fullscreen?: string | boolean | undefined;
  readonly platform?: string | undefined;
}

function parsePort(value: string | number | undefined): number {
  const port = Number(value ?? APP_DEFAULTS.backendPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid backend port: ${String(value)}`);
  }
  return port;
}

function parseBoolean(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (value === undefined) return APP_DEFAULTS.fullscreen;
  return value.toLowerCase() === "true";
}

function parsePlatform(value: string | undefined): AppPlatform {
  if (value === "win32" || value === "windows") return "windows";
  if (value === "linux" || value === "darwin") return value;
  return "unknown";
}

export function createAppConfig(runtime: RuntimeConfig): AppConfig {
  return Object.freeze({
    appName: APP_DEFAULTS.appName,
    environment: runtime.environment,
    backendHost: runtime.backendHost ?? APP_DEFAULTS.backendHost,
    backendPort: parsePort(runtime.backendPort),
    targetViewportWidth: APP_DEFAULTS.targetViewportWidth,
    targetViewportHeight: APP_DEFAULTS.targetViewportHeight,
    fullscreen: parseBoolean(runtime.fullscreen),
    platform: parsePlatform(runtime.platform),
    development: runtime.environment === "development",
  });
}
