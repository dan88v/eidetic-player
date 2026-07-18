import { isSupportedAudioPath } from "../../../../packages/shared/src/audio.js";
import type { PlatformBridge } from "./platform-bridge.js";

export async function selectSingleAudioFile(
  platform: PlatformBridge,
): Promise<string[]> {
  const paths = await platform.openAudioFiles({ multiple: false });
  const selected = paths.find(isSupportedAudioPath);
  return selected ? [selected] : [];
}

export async function runSingleAudioFileSelection(
  platform: PlatformBridge,
  onSelected: (paths: readonly string[]) => void | Promise<void>,
): Promise<void> {
  const paths = await selectSingleAudioFile(platform);
  await onSelected(paths);
}
