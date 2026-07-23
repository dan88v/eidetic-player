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
    createDirectoryHeaderAction: (response) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "folders-directory-library";
      button.textContent = "Add this folder to Library";
      button.disabled = true;
      const applyCoverage = (
        state: "none" | "exact" | "covered-by-parent" | "overlaps-child",
      ): void => {
        if (state === "none") {
          button.textContent = "Add this folder to Library";
          button.disabled = false;
          button.removeAttribute("title");
          return;
        }
        button.disabled = true;
        button.textContent = state === "exact" ? "In Library" : "Covered";
        button.title =
          state === "exact"
            ? "This folder is already in Library."
            : "This folder overlaps an existing USB Library folder.";
      };
      void options.api
        .libraryCoverage(response.source.id, response.current.relativePath)
        .then((coverage) => {
          if (button.isConnected) applyCoverage(coverage.state);
        })
        .catch((error: unknown) => {
          if (!button.isConnected) return;
          button.disabled = true;
          options.showToast(
            error instanceof Error
              ? error.message
              : "Unable to check this USB folder.",
            "error",
          );
        });
      button.addEventListener("click", () => {
        if (button.disabled) return;
        button.disabled = true;
        void options.api
          .addLibrarySource(response.source.id, response.current.relativePath)
          .then(() => {
            if (button.isConnected) applyCoverage("exact");
          })
          .catch((error: unknown) => {
            if (!button.isConnected) return;
            button.disabled = false;
            options.showToast(
              error instanceof Error
                ? error.message
                : "Unable to add this USB folder to Library.",
              "error",
            );
          });
      });
      return button;
    },
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
