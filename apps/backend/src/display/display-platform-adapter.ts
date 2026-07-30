import type {
  DisplayDimMethod,
  DisplayStandbyMethod,
  ScreenDimLevelPercent,
} from "../../../../packages/shared/src/display.js";
import { FixtureDisplayPlatformAdapter } from "./fixture-display-platform-adapter.js";
import { LinuxDisplayPlatformAdapter } from "./linux-display-platform-adapter.js";

export interface DisplayPlatformCapabilities {
  readonly dimMethod: DisplayDimMethod;
  readonly standbyMethod: DisplayStandbyMethod;
  readonly standbyAvailable: boolean;
}

export interface DisplayPlatformAdapter {
  probe(): Promise<DisplayPlatformCapabilities>;
  dim(levelPercent: ScreenDimLevelPercent): Promise<void>;
  standby(): Promise<void>;
  wake(): Promise<void>;
}

export class SoftwareOnlyDisplayPlatformAdapter implements DisplayPlatformAdapter {
  probe(): Promise<DisplayPlatformCapabilities> {
    return Promise.resolve({
      dimMethod: "software",
      standbyMethod: "none",
      standbyAvailable: false,
    });
  }

  dim(): Promise<void> {
    return Promise.resolve();
  }

  standby(): Promise<void> {
    return Promise.reject(new Error("display standby unavailable"));
  }

  wake(): Promise<void> {
    return Promise.resolve();
  }
}

export function createPlatformDisplayAdapter(
  platform: NodeJS.Platform,
  installationMode: "development" | "standard" | "appliance",
  environment: NodeJS.ProcessEnv = process.env,
): DisplayPlatformAdapter {
  if (platform === "win32" || environment.EIDETIC_APPLIANCE_FIXTURE === "1")
    return new FixtureDisplayPlatformAdapter();
  if (
    platform === "linux" &&
    installationMode === "appliance" &&
    environment.EIDETIC_DISABLE_BLANKING === "1"
  )
    return new LinuxDisplayPlatformAdapter();
  return new SoftwareOnlyDisplayPlatformAdapter();
}
