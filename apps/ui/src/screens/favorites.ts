import type { FavoriteTrack } from "../../../../packages/shared/src/library";
import type { LibraryApiClient } from "../api/library-api-client";
import { createFavoriteTrackButton } from "../components/favorite-track-button";
import { icon } from "../components/icons";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";
import type { FavoriteTrackStore } from "../state/favorite-track-store";

const PAGE_SIZE = 48;
const MAX_RENDERED_ITEMS = 192;
let favoritesScrollTop = 0;

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes)}:${String(remainder).padStart(2, "0")}`;
}

export function createFavoritesScreen(options: {
  readonly api: LibraryApiClient;
  readonly favorites: FavoriteTrackStore;
  readonly noteTrackCommand: () => void;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
}): ComponentView {
  const section = document.createElement("section");
  section.className = "screen favorites-screen";
  section.setAttribute("aria-label", t("screen.favorites.title"));
  section.innerHTML = `
    <header class="favorites-header">
      <span class="screen-header__description">${t("screen.favorites.description")}</span>
      <button class="primary-action favorites-play-all" type="button" disabled>${icon("play")}<span>${t("favorites.playAll")}</span></button>
    </header>
    <div class="favorites-content" aria-live="polite"></div>
    <div class="folders-action-menu library-action-menu" role="menu" hidden></div>`;
  const content = section.querySelector<HTMLElement>(".favorites-content");
  const playAll = section.querySelector<HTMLButtonElement>(
    ".favorites-play-all",
  );
  const menu = section.querySelector<HTMLElement>(".library-action-menu");
  if (!content || !playAll || !menu)
    throw new Error("Favorites screen is incomplete");
  const favoritesContent = content;
  const playAllButton = playAll;

  let items: FavoriteTrack[] = [];
  let cursor: string | null = null;
  let total = 0;
  let availableCount = 0;
  let loading = false;
  let destroyed = false;
  let generation = 0;
  const heartViews = new Set<{ destroy(): void }>();

  const closeMenu = (): void => {
    menu.hidden = true;
    menu.replaceChildren();
  };
  const errorToast = (error: unknown): void => {
    options.showToast(
      error instanceof Error ? error.message : t("library.actionFailed"),
      "error",
    );
  };
  const removeVisible = (trackId: string): void => {
    const index = items.findIndex((item) => item.id === trackId);
    if (index < 0) return;
    const [removed] = items.splice(index, 1);
    total = Math.max(0, total - 1);
    if (removed?.availability === "available")
      availableCount = Math.max(0, availableCount - 1);
    section.querySelector(`[data-track-id="${CSS.escape(trackId)}"]`)?.remove();
    playAllButton.disabled = availableCount === 0;
    if (items.length === 0 && !cursor) render();
  };
  const setFromMenu = async (
    trackId: string,
    isFavorite: boolean,
  ): Promise<void> => {
    try {
      await options.favorites.set(trackId, isFavorite);
      if (!isFavorite) removeVisible(trackId);
      options.showToast(
        t(isFavorite ? "favorites.added" : "favorites.removed"),
        "success",
      );
    } catch (error) {
      errorToast(error);
    }
  };
  const play = async (selectedTrackId?: string): Promise<void> => {
    options.noteTrackCommand();
    try {
      await options.api.playFavorites(
        selectedTrackId ? { selectedTrackId } : {},
      );
    } catch (error) {
      errorToast(error);
      void load(false);
    }
  };

  const showMenu = (trigger: HTMLButtonElement, track: FavoriteTrack): void => {
    closeMenu();
    const actions = [
      {
        label: t("library.play"),
        disabled: track.availability === "unavailable",
        run: () => void play(track.id),
      },
      {
        label: t("folders.addToQueue"),
        disabled: track.availability === "unavailable",
        run: () =>
          void options.api
            .queueTrack(track.id)
            .then((result) => {
              options.showToast(
                result.appendedCount > 0
                  ? t("library.trackAdded")
                  : t("library.alreadyQueued"),
                "neutral",
              );
            })
            .catch(errorToast),
      },
      {
        label: t("favorites.remove"),
        disabled: false,
        run: () => void setFromMenu(track.id, false),
      },
    ];
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "menuitem";
      button.textContent = action.label;
      button.disabled = action.disabled;
      button.addEventListener("click", () => {
        closeMenu();
        action.run();
      });
      menu.append(button);
    }
    const bounds = trigger.getBoundingClientRect();
    menu.style.left = `${String(Math.max(12, bounds.right - 250))}px`;
    menu.style.top = `${String(Math.min(window.innerHeight - 90, bounds.bottom + 4))}px`;
    menu.hidden = false;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  };

  const createRow = (track: FavoriteTrack): HTMLElement => {
    const unavailable = track.availability === "unavailable";
    const row = document.createElement("article");
    row.className = `library-track-row${unavailable ? " library-item--unavailable" : ""}`;
    row.dataset.trackId = track.id;
    const main = document.createElement("button");
    main.type = "button";
    main.className = "library-track-row__main";
    main.disabled = unavailable;
    main.setAttribute("aria-label", `${t("library.play")} ${track.title}`);
    const art = document.createElement("span");
    art.className = "library-track-art library-artwork";
    if (track.artworkTrackId) {
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.draggable = false;
      image.src = options.api.artworkUrl(track.artworkTrackId);
      image.addEventListener(
        "load",
        () => {
          image.classList.add("library-artwork--ready");
        },
        { once: true },
      );
      art.append(image);
    }
    const copy = document.createElement("span");
    copy.className = "library-track-row__copy";
    const title = document.createElement("strong");
    title.textContent = track.title;
    const metadata = document.createElement("small");
    metadata.textContent = [track.artist, track.album]
      .filter(Boolean)
      .join(" · ");
    copy.append(title, metadata);
    const number = document.createElement("span");
    number.className = "library-track-row__number";
    number.textContent =
      track.trackNumber === null ? "" : String(track.trackNumber);
    const duration = document.createElement("time");
    duration.textContent = formatDuration(track.durationSeconds);
    main.append(art, number, copy, duration);
    if (unavailable) {
      const label = document.createElement("span");
      label.className = "library-unavailable-label";
      label.textContent = t("library.unavailable");
      main.append(label);
    }
    main.addEventListener("click", () => void play(track.id));
    const heart = createFavoriteTrackButton({
      trackId: track.id,
      store: options.favorites,
      onError: errorToast,
      onChange: (isFavorite) => {
        if (!isFavorite) removeVisible(track.id);
      },
    });
    heartViews.add(heart);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "library-item-more";
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute(
      "aria-label",
      `${t("library.moreActions")} ${track.title}`,
    );
    more.innerHTML = icon("more");
    more.addEventListener("click", () => {
      showMenu(more, track);
    });
    row.append(main, heart.element, more);
    return row;
  };

  function render(): void {
    for (const view of heartViews) view.destroy();
    heartViews.clear();
    playAllButton.disabled = availableCount === 0;
    if (items.length === 0) {
      const state = document.createElement("div");
      state.className = "favorites-empty";
      const title = document.createElement("strong");
      title.textContent = t("favorites.emptyTitle");
      const copy = document.createElement("p");
      copy.textContent = t("favorites.emptyText");
      state.append(title, copy);
      favoritesContent.replaceChildren(state);
      return;
    }
    const list = document.createElement("div");
    list.className = "library-track-list favorites-track-list";
    for (const item of items) list.append(createRow(item));
    const more = document.createElement("button");
    more.type = "button";
    more.className = "library-page-sentinel";
    more.hidden = cursor === null;
    more.disabled = loading;
    more.textContent = loading ? t("favorites.loading") : t("library.loadMore");
    more.addEventListener("click", () => void load(true));
    favoritesContent.replaceChildren(list, more);
  }

  async function load(append: boolean): Promise<void> {
    if (loading) return;
    loading = true;
    const currentGeneration = ++generation;
    if (!append && items.length === 0) {
      favoritesContent.textContent = t("favorites.loading");
      favoritesContent.className = "favorites-content library-browser-state";
    }
    try {
      const page = await options.api.favoriteTracks(
        append ? cursor : null,
        PAGE_SIZE,
      );
      if (destroyed || generation !== currentGeneration) return;
      items = (append ? [...items, ...page.items] : [...page.items]).slice(
        -MAX_RENDERED_ITEMS,
      );
      cursor = page.nextCursor;
      total = page.total;
      availableCount = page.availableCount;
      options.favorites.seed(
        items.map((item) => item.id),
        true,
      );
      favoritesContent.className = "favorites-content";
      render();
    } catch (error) {
      if (!destroyed && generation === currentGeneration) errorToast(error);
    } finally {
      loading = false;
    }
  }

  playAllButton.addEventListener("click", () => void play());
  const outsideMenu = (event: PointerEvent): void => {
    if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu();
  };
  document.addEventListener("pointerdown", outsideMenu);
  void load(false).then(() => {
    if (section.parentElement)
      section.parentElement.scrollTop = favoritesScrollTop;
  });

  return {
    element: section,
    destroy() {
      destroyed = true;
      generation += 1;
      favoritesScrollTop = section.parentElement?.scrollTop ?? 0;
      document.removeEventListener("pointerdown", outsideMenu);
      for (const view of heartViews) view.destroy();
      heartViews.clear();
    },
  };
}
