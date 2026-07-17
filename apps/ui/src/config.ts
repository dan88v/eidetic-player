import { createAppConfig } from "../../../packages/config/src/index";

interface ViteRuntimeEnvironment {
  readonly DEV: boolean;
  readonly VITE_BACKEND_HOST?: string;
  readonly VITE_BACKEND_PORT?: string;
  readonly VITE_EIDETIC_FULLSCREEN?: string;
}

const env = import.meta.env as unknown as ViteRuntimeEnvironment;

export const config = createAppConfig({
  environment: env.DEV ? "development" : "production",
  backendHost: env.VITE_BACKEND_HOST,
  backendPort: env.VITE_BACKEND_PORT,
  fullscreen: env.VITE_EIDETIC_FULLSCREEN,
  platform: navigator.platform.toLowerCase().includes("win")
    ? "windows"
    : navigator.platform,
});
