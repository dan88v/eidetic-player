import type { PlatformBridge } from "./platform-bridge";

export class BrowserPlatformBridge implements PlatformBridge {
  openAudioFiles(): Promise<string[]> {
    return Promise.reject(
      new Error("Open Files requires the Eidetic Player native shell."),
    );
  }
  openFolder(): Promise<string | null> {
    return Promise.reject(
      new Error("Add Folder requires the Eidetic Player native shell."),
    );
  }
  subscribeToDroppedFiles(): () => void {
    return () => {
      // Browser pages do not expose trusted absolute file paths.
    };
  }
}
