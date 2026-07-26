import type { AudioOutputInitialEnumerationStatus } from "../../../../packages/shared/src/audio-output.js";

export type AudioOutputInstallationMode =
  "development" | "standard" | "appliance";

export interface BootstrapAudioOutputService {
  initialize(): Promise<void>;
  waitForInitialEnumeration(
    enabled: boolean,
  ): Promise<AudioOutputInitialEnumerationStatus>;
  applyInitialPreference(): Promise<void>;
}

export function shouldWaitForInitialAudioEnumeration(
  platform: NodeJS.Platform,
  installationMode: AudioOutputInstallationMode,
): boolean {
  return platform === "linux" && installationMode === "appliance";
}

export async function prepareAudioOutputForSessionRestore(
  service: BootstrapAudioOutputService,
  platform: NodeJS.Platform,
  installationMode: AudioOutputInstallationMode,
): Promise<AudioOutputInitialEnumerationStatus> {
  await service.initialize();
  const status = await service.waitForInitialEnumeration(
    shouldWaitForInitialAudioEnumeration(platform, installationMode),
  );
  await service.applyInitialPreference();
  return status;
}
