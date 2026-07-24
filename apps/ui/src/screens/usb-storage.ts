import type {
  DirectoryQueueResponse,
  RemovableDevice,
  RemovableDeviceListResponse,
} from "../../../../packages/shared/src/library";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type { RemovableStorageApiClient } from "../api/removable-storage-api-client";
import type { ComponentView } from "../components/types";
import { icon } from "../components/icons";
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
  options.setTitle(`USB / ${options.device.displayName}`);
  usbStorageSession.openSource(options.device.id);
  let currentDevice = options.device;
  let returnFocus: HTMLElement | null = null;
  const backdrop = document.createElement("div");
  backdrop.className = "source-dialog-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const dialog = document.createElement("section");
  dialog.className = "source-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-hidden", "true");
  dialog.inert = true;
  dialog.innerHTML = `
    <h2>Safely remove USB storage?</h2>
    <p class="source-dialog__description"></p>
    <div class="source-dialog__actions">
      <button type="button" data-action="cancel">Cancel</button>
      <button class="source-dialog__confirm" type="button" data-action="confirm">Safely remove</button>
    </div>`;
  const description = dialog.querySelector<HTMLElement>(
    ".source-dialog__description",
  );
  const cancel = dialog.querySelector<HTMLButtonElement>(
    '[data-action="cancel"]',
  );
  const confirm = dialog.querySelector<HTMLButtonElement>(
    '[data-action="confirm"]',
  );
  if (!description || !cancel || !confirm)
    throw new Error("USB safe removal dialog is incomplete");
  const closeDialog = (): void => {
    dialog.classList.remove("source-dialog--open");
    backdrop.classList.remove("source-dialog-backdrop--open");
    dialog.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    dialog.inert = true;
    returnFocus?.focus();
    returnFocus = null;
  };
  const openSafeRemoveDialog = async (trigger: HTMLElement): Promise<void> => {
    returnFocus = trigger;
    try {
      const usage = await options.api.usage(currentDevice.id);
      description.textContent = [
        ...(usage.playbackWillStop ? ["Playback will stop."] : []),
        ...(usage.queueContainsItems
          ? ["USB items will remain in the Queue but become unavailable."]
          : []),
        ...(usage.scanWillCancel
          ? ["An active Library scan will be cancelled."]
          : []),
        "All mounted volumes on this device will be removed.",
      ].join(" ");
      dialog.inert = false;
      dialog.setAttribute("aria-hidden", "false");
      backdrop.setAttribute("aria-hidden", "false");
      dialog.classList.add("source-dialog--open");
      backdrop.classList.add("source-dialog-backdrop--open");
      queueMicrotask(() => {
        cancel.focus();
      });
    } catch (error) {
      options.showToast(
        error instanceof Error
          ? error.message
          : "Unable to safely remove USB storage.",
        "error",
      );
    }
  };
  cancel.addEventListener("click", closeDialog);
  backdrop.addEventListener("pointerup", closeDialog);
  confirm.addEventListener("click", () => {
    confirm.disabled = true;
    void options.api
      .safelyRemove(currentDevice.id, true)
      .catch((error: unknown) => {
        options.showToast(
          error instanceof Error
            ? error.message
            : "Unable to safely remove USB storage.",
          "error",
        );
      })
      .finally(() => {
        confirm.disabled = false;
        closeDialog();
      });
  });
  const browser = createFoldersScreen({
    api: options.api,
    session: usbStorageSession,
    rootBack: options.back,
    includeCurrentBreadcrumb: true,
    breadcrumbRootLabel: "Root",
    createDirectoryHeaderAction: (response) => {
      const group = document.createElement("div");
      group.className =
        "resource-directory-header-actions usb-directory-header-actions";
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
      group.append(button);
      if (currentDevice.capabilities.canSafelyRemove) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "usb-directory-safe-remove";
        more.innerHTML = icon("more");
        more.setAttribute("aria-label", "USB storage actions");
        more.setAttribute("aria-haspopup", "menu");
        const menu = document.createElement("div");
        menu.className = "folders-action-menu";
        menu.role = "menu";
        menu.hidden = true;
        const safeRemove = document.createElement("button");
        safeRemove.type = "button";
        safeRemove.role = "menuitem";
        safeRemove.textContent = currentDevice.operation.retryAvailable
          ? "Retry safe removal"
          : "Safely remove";
        safeRemove.addEventListener("click", () => {
          menu.hidden = true;
          void openSafeRemoveDialog(more);
        });
        more.addEventListener("click", () => {
          menu.hidden = !menu.hidden;
          const rect = more.getBoundingClientRect();
          menu.style.top = `${String(rect.bottom + 6)}px`;
          menu.style.left = `${String(Math.max(8, rect.right - 180))}px`;
          if (!menu.hidden) safeRemove.focus();
        });
        menu.append(safeRemove);
        group.append(more, menu);
      }
      return group;
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
  browser.element.classList.add(
    "resource-browser-screen",
    "usb-storage-screen",
  );
  browser.element.append(backdrop, dialog);
  const updateDevices = (snapshot: RemovableDeviceListResponse): void => {
    const device = snapshot.devices.find(
      (candidate) => candidate.id === options.device.id,
    );
    if (device) currentDevice = device;
    const operationState = device?.operation.state;
    const blocked =
      operationState !== undefined &&
      [
        "mounting",
        "preparing-removal",
        "unmounting",
        "ejecting",
        "safe-to-remove",
      ].includes(operationState);
    browser.setSourceAvailable(
      device?.readable === true && !blocked,
      operationState === "safe-to-remove"
        ? "Safe to remove."
        : blocked
          ? "USB storage operation in progress."
          : "USB storage disconnected.",
    );
    if (device) options.setTitle(`USB / ${device.displayName}`);
  };
  updateDevices(options.devices);
  return {
    element: browser.element,
    updatePlayerState: (state) => {
      browser.updatePlayerState?.(state);
    },
    updateRemovableDevices: updateDevices,
    destroy: () => {
      closeDialog();
      browser.destroy();
    },
  };
}
