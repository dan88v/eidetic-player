import type { DirectoryQueueResponse } from "../../../../packages/shared/src/library";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type {
  SmbConnection,
  SmbSnapshot,
} from "../../../../packages/shared/src/smb";
import type { SmbApiClient } from "../api/smb-api-client";
import type { ComponentView } from "../components/types";
import { icon } from "../components/icons";
import { smbSession } from "../state/folders-session";
import { createFoldersScreen } from "./folders";

export function createSmbBrowseScreen(options: {
  readonly api: SmbApiClient;
  readonly connection: SmbConnection;
  readonly snapshot: SmbSnapshot;
  readonly initialPlayerState: PlayerState;
  readonly back: () => void;
  readonly setTitle: (title: string) => void;
  readonly noteTrackCommand: () => void;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
}): ComponentView {
  options.setTitle(`SMB / ${options.connection.displayName}`);
  smbSession.openSource(options.connection.id);
  const browser = createFoldersScreen({
    api: options.api,
    session: smbSession,
    rootBack: options.back,
    includeCurrentBreadcrumb: true,
    breadcrumbRootLabel: "Root",
    createDirectoryHeaderAction: (response) => {
      const group = document.createElement("div");
      group.className = "resource-directory-header-actions";
      const more = document.createElement("button");
      more.type = "button";
      more.className = "resource-directory-more";
      more.innerHTML = icon("more");
      more.setAttribute("aria-label", "Network share folder actions");
      more.setAttribute("aria-haspopup", "menu");
      const menu = document.createElement("div");
      menu.className = "folders-action-menu";
      menu.role = "menu";
      menu.hidden = true;
      const addToQueue = document.createElement("button");
      addToQueue.type = "button";
      addToQueue.role = "menuitem";
      addToQueue.textContent = "Add folder to Queue";
      addToQueue.addEventListener("click", () => {
        menu.hidden = true;
        addToQueue.disabled = true;
        void options.api
          .addDirectoryToQueue(
            response.source.id,
            response.current.relativePath,
          )
          .then(() => {
            options.showToast("Folder added to Queue.", "success");
          })
          .catch((error: unknown) => {
            options.showToast(
              error instanceof Error
                ? error.message
                : "Unable to add this folder to Queue.",
              "error",
            );
          })
          .finally(() => {
            addToQueue.disabled = false;
          });
      });
      more.addEventListener("click", () => {
        menu.hidden = !menu.hidden;
        const rect = more.getBoundingClientRect();
        menu.style.top = `${String(rect.bottom + 6)}px`;
        menu.style.left = `${String(Math.max(8, rect.right - 180))}px`;
        if (!menu.hidden) addToQueue.focus();
      });
      menu.append(addToQueue);
      group.append(more, menu);
      return group;
    },
    openSources: options.back,
    openEntry: async (connectionId, entryId) => {
      options.noteTrackCommand();
      await options.api.openEntry(connectionId, entryId);
    },
    playDirectory: async (
      connectionId,
      relativePath,
    ): Promise<DirectoryQueueResponse> => {
      options.noteTrackCommand();
      return options.api.playDirectory(connectionId, relativePath);
    },
    initialPlayerState: options.initialPlayerState,
    showToast: options.showToast,
  });
  browser.element.classList.add("resource-browser-screen", "smb-browse-screen");
  const update = (snapshot: SmbSnapshot): void => {
    const connection = snapshot.connections.find(
      (candidate) => candidate.id === options.connection.id,
    );
    browser.setSourceAvailable(
      connection?.readable === true,
      connection?.state === "connecting"
        ? "Connecting to network share…"
        : "Network share disconnected.",
    );
    if (connection) options.setTitle(`SMB / ${connection.displayName}`);
  };
  update(options.snapshot);
  return {
    element: browser.element,
    updatePlayerState: (state) => browser.updatePlayerState?.(state),
    updateSmbSnapshot: update,
    destroy: () => {
      browser.destroy();
    },
  };
}
