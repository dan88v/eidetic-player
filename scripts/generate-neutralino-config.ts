import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  APP_DEFAULTS,
  type AppEnvironment,
} from "../packages/config/src/index.js";

const requestedEnvironment = process.argv[2];
if (
  requestedEnvironment !== "development" &&
  requestedEnvironment !== "production"
) {
  throw new Error("Expected environment argument: development or production");
}
const environment: AppEnvironment = requestedEnvironment;

// Initial outer dimensions include a conservative Windows frame allowance.
// The UI measures and corrects the inner viewport exactly once after startup.
const config = {
  applicationId: "dev.eidetic.player",
  version: "0.1.0",
  defaultMode: "window",
  port: 0,
  documentRoot: "/dist/ui/",
  url: environment === "development" ? "http://127.0.0.1:5173/" : "/",
  enableServer: true,
  enableNativeAPI: true,
  enableExtensions: false,
  nativeAllowList: ["os.showOpenDialog", "os.showFolderDialog"],
  globalVariables: {},
  modes: {
    window: {
      title: APP_DEFAULTS.appName,
      width: APP_DEFAULTS.targetViewportWidth + 16,
      height: APP_DEFAULTS.targetViewportHeight + 39,
      minWidth: 480,
      minHeight: 320,
      center: true,
      fullScreen: APP_DEFAULTS.fullscreen,
      alwaysOnTop: false,
      enableInspector: environment === "development",
      borderless: false,
      maximize: false,
      hidden: false,
      resizable: true,
      exitProcessOnClose: true,
      openInspectorOnStartup: false,
      useSavedState: false,
      useLogicalPixels: true,
      injectClientLibrary: true,
      emitDropEvents: true,
    },
  },
  cli: {
    binaryName: "eidetic-player-${OS}_${ARCH}",
    resourcesPath: "/dist/ui/",
    clientLibrary: "/node_modules/@neutralinojs/lib/dist/neutralino.js",
    binaryVersion: "6.8.0",
    clientVersion: "6.8.0",
  },
};

await writeFile(
  resolve(import.meta.dirname, "../neutralino.config.json"),
  `${JSON.stringify(config, null, 2)}\n`,
  "utf8",
);
console.log(`[shell] generated ${environment} Neutralino configuration`);
