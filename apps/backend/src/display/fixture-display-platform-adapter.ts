import type { ScreenDimLevelPercent } from "../../../../packages/shared/src/display.js";
import type {
  DisplayPlatformAdapter,
  DisplayPlatformCapabilities,
} from "./display-platform-adapter.js";

export class FixtureDisplayPlatformAdapter implements DisplayPlatformAdapter {
  private standbyActive = false;
  private levelPercent: ScreenDimLevelPercent = 20;

  probe(): Promise<DisplayPlatformCapabilities> {
    return Promise.resolve({
      dimMethod: "software",
      standbyMethod: "fixture",
      standbyAvailable: true,
    });
  }

  dim(levelPercent: ScreenDimLevelPercent): Promise<void> {
    this.levelPercent = levelPercent;
    return Promise.resolve();
  }

  standby(): Promise<void> {
    this.standbyActive = true;
    return Promise.resolve();
  }

  wake(): Promise<void> {
    this.standbyActive = false;
    return Promise.resolve();
  }

  diagnostics(): {
    readonly standbyActive: boolean;
    readonly levelPercent: ScreenDimLevelPercent;
  } {
    return {
      standbyActive: this.standbyActive,
      levelPercent: this.levelPercent,
    };
  }
}
