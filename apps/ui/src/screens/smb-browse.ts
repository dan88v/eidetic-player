import type { DirectoryQueueResponse } from "../../../../packages/shared/src/library";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type {
  SmbConnection,
  SmbSnapshot,
} from "../../../../packages/shared/src/smb";
import type { SmbApiClient } from "../api/smb-api-client";
import type { ComponentView } from "../components/types";
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
  browser.element.classList.add("smb-browse-screen");
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
