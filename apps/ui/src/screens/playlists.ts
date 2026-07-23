/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type {
  PlaylistDetail,
  PlaylistItem,
  PlaylistSummary,
} from "../../../../packages/shared/src/library";
import type { LibraryApiClient } from "../api/library-api-client";
import { icon } from "../components/icons";
import { createPlaylistNameDialog } from "../components/playlist-name-dialog";
import type { ComponentView } from "../components/types";
import {
  createFavoriteTrackButton,
  type FavoriteTrackButton,
} from "../components/favorite-track-button";
import type { FavoriteTrackStore } from "../state/favorite-track-store";
import { t } from "../i18n";

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, "0")}`;
}

const PLAYLIST_DRAG_THRESHOLD = 8;
const PLAYLIST_AUTOSCROLL_EDGE = 64;
const PLAYLIST_AUTOSCROLL_MAX_STEP = 18;

export function playlistDropIndex(
  midpoints: readonly number[],
  pointerClientY: number,
): number {
  const index = midpoints.findIndex((midpoint) => pointerClientY < midpoint);
  return index < 0 ? midpoints.length : index;
}

export function shouldStartPlaylistDrag(
  deltaX: number,
  deltaY: number,
): boolean {
  return Math.hypot(deltaX, deltaY) >= PLAYLIST_DRAG_THRESHOLD;
}

export function playlistAutoScrollStep(
  pointerClientY: number,
  top: number,
  bottom: number,
): number {
  if (pointerClientY < top + PLAYLIST_AUTOSCROLL_EDGE) {
    const ratio = Math.min(
      1,
      (top + PLAYLIST_AUTOSCROLL_EDGE - pointerClientY) /
        PLAYLIST_AUTOSCROLL_EDGE,
    );
    return -Math.max(1, Math.round(PLAYLIST_AUTOSCROLL_MAX_STEP * ratio));
  }
  if (pointerClientY > bottom - PLAYLIST_AUTOSCROLL_EDGE) {
    const ratio = Math.min(
      1,
      (pointerClientY - (bottom - PLAYLIST_AUTOSCROLL_EDGE)) /
        PLAYLIST_AUTOSCROLL_EDGE,
    );
    return Math.max(1, Math.round(PLAYLIST_AUTOSCROLL_MAX_STEP * ratio));
  }
  return 0;
}

export function createPlaylistsScreen(options: {
  readonly api: LibraryApiClient;
  readonly setTitle: (title: string) => void;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
  readonly openPlaylistPicker: (
    trackIds: readonly string[],
    trigger?: HTMLElement,
  ) => void;
  readonly noteTrackCommand: () => void;
  readonly favorites: FavoriteTrackStore;
  readonly setHeaderActions: (
    back: (() => void) | null,
    more: ((trigger: HTMLButtonElement) => void) | null,
  ) => void;
}): ComponentView {
  const root = document.createElement("section");
  root.className = "screen playlists-screen";
  root.innerHTML = `<header class="screen-header playlists-header"><p class="screen-header__description">Create and organize your track collections.</p><button class="primary-action" type="button" data-action="new">${icon("plus")}<span>New Playlist</span></button></header><div class="playlists-content" aria-live="polite"></div><div class="folders-action-menu playlists-menu" role="menu" hidden></div>`;
  const content = root.querySelector<HTMLElement>(".playlists-content")!;
  const menu = root.querySelector<HTMLElement>(".playlists-menu")!;
  const nameDialog = createPlaylistNameDialog();
  root.append(nameDialog.backdrop, nameDialog.element);
  let detail: PlaylistDetail | null = null;
  let destroyed = false;
  const hearts = new Set<FavoriteTrackButton>();
  let cancelActiveReorder: (() => void) | null = null;

  const openNameDialog = (
    playlist?: PlaylistSummary,
    returnFocus?: HTMLElement,
  ): void => {
    nameDialog.open({
      title: playlist ? "Rename Playlist" : "Create New Playlist",
      confirmLabel: playlist ? "Save" : "Create",
      ...(playlist ? { initialName: playlist.name } : {}),
      ...(returnFocus ? { returnFocus } : {}),
      onSubmit: async (name) => {
        if (playlist) await options.api.renamePlaylist(playlist.id, name);
        else await options.api.createPlaylist(name);
        await loadList();
      },
    });
  };
  const openDeleteDialog = (
    playlist: PlaylistSummary,
    returnFocus?: HTMLElement,
  ): void => {
    nameDialog.open({
      title: `Delete "${playlist.name}"?`,
      confirmLabel: "Delete",
      description: "The tracks and media files will not be deleted.",
      danger: true,
      hideName: true,
      ...(returnFocus ? { returnFocus } : {}),
      onSubmit: async () => {
        await options.api.deletePlaylist(playlist.id);
        await loadList();
      },
    });
  };
  const run = (operation: Promise<unknown>): void => {
    void operation.catch((cause: unknown) => {
      options.showToast(
        cause instanceof Error ? cause.message : "The playlist action failed.",
      );
    });
  };

  const openMenu = (
    playlist: PlaylistSummary,
    trigger: HTMLButtonElement,
  ): void => {
    menu.replaceChildren();
    for (const [action, label] of [
      ["play", "Play"],
      ["queue", "Add to Queue"],
      ["rename", "Rename"],
      ["delete", "Delete"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "menuitem";
      button.dataset.action = action;
      button.textContent = label;
      button.addEventListener("click", () => {
        menu.hidden = true;
        if (action === "rename") openNameDialog(playlist, trigger);
        else if (action === "delete") openDeleteDialog(playlist, trigger);
        else if (action === "play") {
          options.noteTrackCommand();
          run(options.api.playPlaylist(playlist.id));
        } else run(options.api.queuePlaylist(playlist.id));
      });
      menu.append(button);
    }
    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${String(rect.bottom + 4)}px`;
    menu.style.left = `${String(Math.max(8, rect.right - 180))}px`;
    menu.hidden = false;
  };

  const renderList = (items: readonly PlaylistSummary[]): void => {
    cancelActiveReorder?.();
    detail = null;
    options.setTitle("Playlists");
    options.setHeaderActions(null, null);
    root.querySelector(".playlists-header")?.removeAttribute("hidden");
    content.replaceChildren();
    if (items.length === 0) {
      content.innerHTML = `<div class="playlists-empty"><strong>No playlists yet</strong><p>Create a playlist to organize your music.</p></div>`;
      return;
    }
    const list = document.createElement("div");
    list.className = "playlists-list";
    for (const playlist of items) {
      const row = document.createElement("article");
      row.className = "playlist-row";
      row.innerHTML = `<button class="playlist-row__open" type="button"><span class="playlist-row__art">${icon("list")}</span><span><strong></strong><small>${String(playlist.trackCount)} tracks - ${duration(playlist.totalDurationSeconds)} - Updated ${new Date(playlist.updatedAt).toLocaleDateString()}</small></span>${icon("chevronRight")}</button><button class="playlist-row__more" type="button" aria-label="Playlist actions">${icon("more")}</button>`;
      row.querySelector("strong")!.textContent = playlist.name;
      if (playlist.artworkTrackId) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = options.api.artworkUrl(playlist.artworkTrackId);
        row.querySelector(".playlist-row__art")!.replaceChildren(image);
      }
      row
        .querySelector<HTMLButtonElement>(".playlist-row__open")!
        .addEventListener("click", () => void loadDetail(playlist.id));
      row
        .querySelector<HTMLButtonElement>(".playlist-row__more")!
        .addEventListener("click", (event) => {
          openMenu(playlist, event.currentTarget as HTMLButtonElement);
        });
      list.append(row);
    }
    content.append(list);
  };
  const loadList = async (): Promise<void> => {
    content.textContent = "Loading...";
    const page = await options.api.playlists(null, 100);
    if (!destroyed) renderList(page.items);
  };

  const renderDetail = (playlist: PlaylistDetail): void => {
    cancelActiveReorder?.();
    detail = playlist;
    options.setTitle(`Playlists / ${playlist.name}`);
    options.setHeaderActions(
      () => void loadList(),
      (trigger) => {
        openMenu(playlist, trigger);
      },
    );
    root.querySelector(".playlists-header")?.setAttribute("hidden", "");
    content.replaceChildren();
    const toolbar = document.createElement("header");
    toolbar.className = "playlist-detail-toolbar";
    const totalDuration =
      playlist.totalDurationSeconds > 0
        ? ` · ${duration(playlist.totalDurationSeconds)}`
        : "";
    toolbar.innerHTML = `<p class="playlist-detail-toolbar__summary">${String(playlist.trackCount)} ${playlist.trackCount === 1 ? "Track" : "Tracks"}${totalDuration}</p><div class="playlist-detail-toolbar__actions"><button class="primary-action" type="button" data-action="play">${icon("play")}<span>Play all</span></button><button class="playlist-detail-toolbar__queue" type="button" data-action="queue">Add Playlist to Queue</button></div>`;
    const available = playlist.availableTrackCount > 0;
    toolbar
      .querySelectorAll<HTMLButtonElement>(
        '[data-action="play"],[data-action="queue"]',
      )
      .forEach((button) => {
        button.disabled = !available;
      });
    toolbar
      .querySelector<HTMLButtonElement>('[data-action="play"]')!
      .addEventListener("click", () => {
        options.noteTrackCommand();
        run(options.api.playPlaylist(playlist.id));
      });
    toolbar
      .querySelector<HTMLButtonElement>('[data-action="queue"]')!
      .addEventListener("click", () => {
        run(
          options.api.queuePlaylist(playlist.id).then((result) => {
            options.showToast(
              `${String(result.appendedCount)} ${result.appendedCount === 1 ? "track" : "tracks"} added to Queue.`,
              "success",
            );
          }),
        );
      });
    content.append(toolbar);
    if (playlist.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "playlists-empty";
      empty.innerHTML = `<strong>This playlist is empty</strong><p>Add tracks from Library, Search, Favorites or History.</p>`;
      content.append(empty);
      return;
    }
    const list = document.createElement("ol");
    list.className = "playlist-tracks";
    const renderItems = (items: readonly PlaylistItem[]): void => {
      for (const heart of hearts) heart.destroy();
      hearts.clear();
      list.replaceChildren();
      for (const item of items) {
        const row = document.createElement("li");
        row.className = "playlist-track";
        row.dataset.itemId = item.itemId;
        const available = item.availability !== "unavailable";
        row.classList.toggle("playlist-track--unavailable", !available);
        row.innerHTML = `<button class="playlist-track__handle" type="button" aria-label="Reorder track">::</button><button class="playlist-track__play" type="button"><span class="playlist-track__art"></span><span class="playlist-track__copy"><strong></strong><small class="playlist-track__artist"></small><small class="playlist-track__album"></small></span><time>${item.durationSeconds ? duration(item.durationSeconds) : "--:--"}</time></button><span class="playlist-track__heart"></span><button class="playlist-track__more" type="button" aria-label="Track actions">${icon("more")}</button>`;
        if (item.artworkTrackId) {
          const image = document.createElement("img");
          image.alt = "";
          image.src = options.api.artworkUrl(item.artworkTrackId);
          row.querySelector(".playlist-track__art")!.append(image);
        }
        row.querySelector("strong")!.textContent = item.title;
        row.querySelector(".playlist-track__artist")!.textContent =
          item.artist ?? "Unknown Artist";
        row.querySelector(".playlist-track__album")!.textContent =
          `${item.album ?? "Unknown Album"}${available ? "" : " · Unavailable"}`;
        row.querySelector<HTMLButtonElement>(
          ".playlist-track__play",
        )!.disabled = !available;
        row
          .querySelector<HTMLButtonElement>(".playlist-track__play")!
          .addEventListener("click", () => {
            options.noteTrackCommand();
            run(options.api.playPlaylist(playlist.id, item.itemId));
          });
        const heart = createFavoriteTrackButton({
          trackId: item.id,
          store: options.favorites,
          onError: (cause) => {
            options.showToast(
              cause instanceof Error
                ? cause.message
                : "Favorite could not be updated.",
            );
          },
        });
        hearts.add(heart);
        row.querySelector(".playlist-track__heart")!.replaceWith(heart.element);
        row
          .querySelector<HTMLButtonElement>(".playlist-track__more")!
          .addEventListener("click", (event) => {
            menu.replaceChildren();
            const actions = [
              ["play", "Play"],
              ["queue", "Add to Queue"],
              ["playlist", t("common.addToPlaylist")],
              ["remove", "Remove from playlist"],
            ] as const;
            for (const [action, label] of actions) {
              const b = document.createElement("button");
              b.type = "button";
              b.role = "menuitem";
              b.textContent = label;
              b.disabled = !available && action !== "remove";
              b.addEventListener("click", () => {
                menu.hidden = true;
                if (action === "play")
                  run(options.api.playPlaylist(playlist.id, item.itemId));
                else if (action === "queue")
                  run(options.api.queueTrack(item.id));
                else if (action === "playlist")
                  options.openPlaylistPicker(
                    [item.id],
                    event.currentTarget as HTMLElement,
                  );
                else
                  run(
                    options.api
                      .removePlaylistItem(playlist.id, item.itemId)
                      .then(() => loadDetail(playlist.id)),
                  );
              });
              menu.append(b);
            }
            const rect = (
              event.currentTarget as HTMLElement
            ).getBoundingClientRect();
            menu.style.top = `${String(rect.bottom)}px`;
            menu.style.left = `${String(Math.max(8, rect.right - 190))}px`;
            menu.hidden = false;
          });
        const handle = row.querySelector<HTMLButtonElement>(
          ".playlist-track__handle",
        )!;
        handle.addEventListener("pointerdown", (event) => {
          beginReorder(event, row, list, playlist);
        });
        list.append(row);
      }
    };
    renderItems(playlist.items);
    content.append(list);
  };
  const loadDetail = async (id: string): Promise<void> => {
    renderDetail(await options.api.playlist(id));
  };

  const beginReorder = (
    event: PointerEvent,
    row: HTMLLIElement,
    list: HTMLOListElement,
    playlist: PlaylistDetail,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    cancelActiveReorder?.();
    const handle = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let latestClientY = startY;
    let dragging = false;
    let placeholder: HTMLLIElement | null = null;
    let animationFrame = 0;
    let rowOffsetY = 0;
    const initial = [...list.children] as HTMLLIElement[];
    const initialItemIds = initial.map((item) => item.dataset.itemId ?? "");
    const scrollRegion = list.closest<HTMLElement>(".screen-region");
    const initialScrollTop = scrollRegion?.scrollTop ?? 0;

    handle.setPointerCapture(event.pointerId);

    const restoreInitialOrder = (): void => {
      for (const child of initial) list.append(child);
      if (scrollRegion) scrollRegion.scrollTop = initialScrollTop;
    };

    const resetRow = (): void => {
      row.classList.remove("playlist-track--dragging");
      row.style.removeProperty("top");
      row.style.removeProperty("left");
      row.style.removeProperty("width");
      row.style.removeProperty("height");
      placeholder?.remove();
      placeholder = null;
    };

    const positionPlaceholder = (): void => {
      if (!placeholder) return;
      const candidates = [
        ...list.querySelectorAll<HTMLLIElement>(
          ".playlist-track:not(.playlist-track--dragging):not(.playlist-track--placeholder)",
        ),
      ];
      const index = playlistDropIndex(
        candidates.map((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.top + rect.height / 2;
        }),
        latestClientY,
      );
      const target = candidates[index];
      if (target) list.insertBefore(placeholder, target);
      else list.append(placeholder);
    };

    const updateDraggedPosition = (): void => {
      row.style.top = `${String(latestClientY - rowOffsetY)}px`;
      positionPlaceholder();
    };

    const autoScroll = (): void => {
      if (!dragging || !scrollRegion) return;
      const bounds = scrollRegion.getBoundingClientRect();
      const step = playlistAutoScrollStep(
        latestClientY,
        bounds.top,
        bounds.bottom,
      );
      if (step !== 0) {
        const previous = scrollRegion.scrollTop;
        scrollRegion.scrollTop += step;
        if (scrollRegion.scrollTop !== previous) positionPlaceholder();
      }
      animationFrame = window.requestAnimationFrame(autoScroll);
    };

    const activate = (): void => {
      if (dragging) return;
      dragging = true;
      const rect = row.getBoundingClientRect();
      rowOffsetY = latestClientY - rect.top;
      placeholder = document.createElement("li");
      placeholder.className = "playlist-track playlist-track--placeholder";
      placeholder.style.height = `${String(rect.height)}px`;
      placeholder.setAttribute("aria-hidden", "true");
      row.after(placeholder);
      row.classList.add("playlist-track--dragging");
      row.style.top = `${String(rect.top)}px`;
      row.style.left = `${String(rect.left)}px`;
      row.style.width = `${String(rect.width)}px`;
      row.style.height = `${String(rect.height)}px`;
      animationFrame = window.requestAnimationFrame(autoScroll);
    };

    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      latestClientY = moveEvent.clientY;
      if (
        !dragging &&
        shouldStartPlaylistDrag(
          moveEvent.clientX - startX,
          moveEvent.clientY - startY,
        )
      ) {
        activate();
      }
      if (dragging) updateDraggedPosition();
    };

    const cleanup = (): void => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", cancel);
      if (handle.hasPointerCapture(pointerId))
        handle.releasePointerCapture(pointerId);
      cancelActiveReorder = null;
    };

    const end = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      if (!dragging || !placeholder) {
        resetRow();
        return;
      }
      list.insertBefore(row, placeholder);
      resetRow();
      const ids = [...list.querySelectorAll<HTMLElement>(".playlist-track")]
        .map((item) => item.dataset.itemId)
        .filter((itemId): itemId is string => Boolean(itemId));
      if (ids.every((itemId, index) => itemId === initialItemIds[index]))
        return;
      list.classList.add("playlist-tracks--persisting");
      run(
        options.api
          .reorderPlaylist(playlist.id, ids)
          .then((updated) => {
            detail = updated;
          })
          .catch((cause: unknown) => {
            restoreInitialOrder();
            throw cause;
          })
          .finally(() => {
            list.classList.remove("playlist-tracks--persisting");
          }),
      );
    };

    const cancel = (cancelEvent?: PointerEvent): void => {
      if (cancelEvent && cancelEvent.pointerId !== pointerId) return;
      cleanup();
      resetRow();
      restoreInitialOrder();
    };

    cancelActiveReorder = () => {
      cancel();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", cancel);
  };

  root
    .querySelector('[data-action="new"]')
    ?.addEventListener("click", (event) => {
      openNameDialog(undefined, event.currentTarget as HTMLElement);
    });
  void loadList().catch((cause: unknown) => {
    options.showToast(
      cause instanceof Error ? cause.message : "Playlists could not be loaded.",
    );
  });
  return {
    element: root,
    destroy() {
      destroyed = true;
      cancelActiveReorder?.();
      for (const heart of hearts) heart.destroy();
      hearts.clear();
      menu.remove();
      nameDialog.destroy();
      if (detail) options.setTitle("Playlists");
      options.setHeaderActions(null, null);
    },
  };
}
