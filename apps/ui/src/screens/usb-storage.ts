import type {
  DirectoryQueueResponse,
  RemovableDevice,
  RemovableDeviceListResponse,
} from "../../../../packages/shared/src/library";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type { RemovableStorageApiClient } from "../api/removable-storage-api-client";
import type { ComponentView } from "../components/types";
import { usbStorageSession } from "../state/folders-session";
import { createFoldersScreen } from "./folders";

export function createUsbStorageScreen(options: {
  readonly api: RemovableStorageApiClient;
  readonly device: RemovableDevice;
  readonly devices: RemovableDeviceListResponse;
  readonly initialPlayerState: PlayerState;
  readonly back: () => void;
  readonly setTitle: (title: string) => void;
  readonly noteTrackCommand: () => void;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
}): ComponentView {
  options.setTitle(options.device.displayName);
  usbStorageSession.openSource(options.device.id);
  const browser = createFoldersScreen({
    api: options.api,
    session: usbStorageSession,
    rootBack: options.back,
    hideRootTitle: true,
    openSources: options.back,
    openEntry: async (deviceId, entryId) => {
      options.noteTrackCommand();
      await options.api.openEntry(deviceId, entryId);
    },
    playDirectory: async (
      deviceId,
      relativePath,
    ): Promise<DirectoryQueueResponse> => {
      options.noteTrackCommand();
      return options.api.playDirectory(deviceId, relativePath);
    },
    initialPlayerState: options.initialPlayerState,
    showToast: options.showToast,
  });
  const updateDevices = (snapshot: RemovableDeviceListResponse): void => {
    const device = snapshot.devices.find(
      (candidate) => candidate.id === options.device.id,
    );
    browser.setSourceAvailable(device?.readable === true);
    if (device) options.setTitle(device.displayName);
  };
  updateDevices(options.devices);
  return {
    element: browser.element,
    updatePlayerState: (state) => {
      browser.updatePlayerState?.(state);
    },
    updateRemovableDevices: updateDevices,
    destroy: () => {
      browser.destroy();
    },
  };
}
