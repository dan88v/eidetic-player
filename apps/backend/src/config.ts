import { createAppConfig } from "../../../packages/config/src/index.js";

const environment =
  process.env.NODE_ENV === "production" ? "production" : "development";

export const config = createAppConfig({
  environment,
  backendHost: process.env.BACKEND_HOST,
  backendPort: process.env.BACKEND_PORT,
  fullscreen: process.env.EIDETIC_FULLSCREEN,
  platform: process.platform,
});
