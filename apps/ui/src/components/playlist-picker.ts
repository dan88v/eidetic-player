/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { PlaylistSummary } from "../../../../packages/shared/src/library";
import type { LibraryApiClient } from "../api/library-api-client";
import { t } from "../i18n";
import {
  createPlaylistNameDialog,
  type PlaylistNameDialog,
} from "./playlist-name-dialog";

export interface PlaylistPicker {
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  readonly nameDialog: PlaylistNameDialog;
  open(trackIds: readonly string[], returnFocus?: HTMLElement): void;
  close(): void;
  destroy(): void;
}

export function createPlaylistPicker(options: {
  readonly api: LibraryApiClient;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
}): PlaylistPicker {
  const backdrop = document.createElement("div");
  backdrop.className = "playlist-picker-backdrop";
  const element = document.createElement("section");
  element.className = "playlist-picker";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-labelledby", "playlist-picker-title");
  element.innerHTML = `<header><h2 id="playlist-picker-title">${t("common.addToPlaylist")}</h2><button type="button" data-action="close" aria-label="Close">&times;</button></header><div class="playlist-picker__body"></div><p class="playlist-picker__error" role="alert"></p><footer><button type="button" data-action="create">Create New Playlist</button></footer>`;
  const body = element.querySelector<HTMLElement>(".playlist-picker__body")!;
  const error = element.querySelector<HTMLElement>(".playlist-picker__error")!;
  const nameDialog = createPlaylistNameDialog();
  let tracks: readonly string[] = [];
  let returnFocus: HTMLElement | undefined;
  let open = false;

  const setOpen = (value: boolean, restoreFocus = true): void => {
    open = value;
    element.classList.toggle("playlist-picker--open", value);
    backdrop.classList.toggle("playlist-picker-backdrop--open", value);
    element.inert = !value;
    if (!value && restoreFocus) returnFocus?.focus();
  };
  const close = (): void => {
    setOpen(false);
  };
  const confirmDuplicate = (): Promise<boolean> =>
    new Promise((resolve) => {
      body.innerHTML = `<div class="playlist-picker__duplicate"><strong>${tracks.length === 1 ? "This track is already in the playlist." : "Some tracks are already in the playlist."}</strong><div><button type="button" data-duplicate-action="cancel">Cancel</button><button type="button" data-duplicate-action="add">Add anyway</button></div></div>`;
      body.querySelector('[data-duplicate-action="cancel"]')?.addEventListener(
        "click",
        () => {
          resolve(false);
        },
        { once: true },
      );
      body.querySelector('[data-duplicate-action="add"]')?.addEventListener(
        "click",
        () => {
          resolve(true);
        },
        { once: true },
      );
    });
  const add = async (playlist: PlaylistSummary): Promise<void> => {
    error.textContent = "";
    let result = await options.api.addPlaylistTracks(playlist.id, tracks);
    if (result.duplicateTrackIds.length > 0) {
      if (!(await confirmDuplicate())) {
        await render();
        return;
      }
      result = await options.api.addPlaylistTracks(playlist.id, tracks, true);
    }
    close();
    options.showToast(
      `${String(result.addedCount)} track${result.addedCount === 1 ? "" : "s"} added to ${playlist.name}.`,
      "success",
    );
  };
  const render = async (): Promise<void> => {
    body.textContent = "Loading...";
    try {
      const page = await options.api.playlists(null, 100);
      const playlists = [...page.items].sort(
        (left, right) =>
          right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
      );
      body.replaceChildren();
      if (playlists.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "No playlists yet.";
        body.append(empty);
      }
      for (const playlist of playlists) {
        const button = document.createElement("button");
        button.type = "button";
        button.innerHTML = `<strong></strong><span>${String(playlist.trackCount)} tracks</span>`;
        button.querySelector("strong")!.textContent = playlist.name;
        button.addEventListener(
          "click",
          () => void add(playlist).catch(showError),
        );
        body.append(button);
      }
      body.querySelector<HTMLButtonElement>("button")?.focus();
    } catch (cause) {
      showError(cause);
    }
  };
  const showError = (cause: unknown): void => {
    error.textContent =
      cause instanceof Error
        ? cause.message
        : "The playlist could not be updated.";
  };
  element
    .querySelector('[data-action="close"]')
    ?.addEventListener("click", close);
  backdrop.addEventListener("pointerup", close);
  element
    .querySelector('[data-action="create"]')
    ?.addEventListener("click", () => {
      setOpen(false, false);
      nameDialog.open({
        title: "Create New Playlist",
        confirmLabel: "Create",
        onCancel: () => {
          setOpen(true, false);
          body.querySelector<HTMLButtonElement>("button")?.focus();
        },
        onSubmit: async (name) => {
          const playlist = await options.api.createPlaylist(name);
          await add(playlist);
        },
      });
    });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  element.inert = true;
  return {
    element,
    backdrop,
    nameDialog,
    open(trackIds, focus) {
      if (trackIds.length === 0) return;
      tracks = [...trackIds];
      returnFocus = focus;
      error.textContent = "";
      setOpen(true, false);
      void render();
    },
    close,
    destroy() {
      if (open) close();
      nameDialog.destroy();
      element.remove();
      backdrop.remove();
    },
  };
}
