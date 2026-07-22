import type {
  IndexedLibrarySnapshot,
  RecentlyPlayedItem,
} from "../../../../packages/shared/src/library";
import type { LibraryApiClient } from "../api/library-api-client";
import { createFavoriteTrackButton } from "../components/favorite-track-button";
import { icon } from "../components/icons";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";
import type { FavoriteTrackStore } from "../state/favorite-track-store";

const PAGE_SIZE = 48;
const MAX_RENDERED_ITEMS = 192;
let savedScrollTop = 0;

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

function localDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

export function historyGroupLabel(playedAt: number, now = Date.now()): string {
  const date = new Date(playedAt);
  const difference = Math.round(
    (localDay(new Date(now)) - localDay(date)) / 86_400_000,
  );
  if (difference === 0) return t("recentlyPlayed.today");
  if (difference === 1) return t("recentlyPlayed.yesterday");
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
  }).format(date);
}

function playedAtLabel(playedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(playedAt));
}

export function createRecentlyPlayedScreen(options: {
  readonly api: LibraryApiClient;
  readonly favorites: FavoriteTrackStore;
  readonly initialSnapshot: IndexedLibrarySnapshot | null;
  readonly noteTrackCommand: () => void;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
}): ComponentView {
  const section = document.createElement("section");
  section.className = "screen recently-played-screen";
  section.setAttribute("aria-label", t("screen.recentlyPlayed.title"));
  section.innerHTML = `
    <header class="recently-played-header">
      <span class="screen-header__description">${t("screen.recentlyPlayed.description")}</span>
    </header>
    <div class="recently-played-content" aria-live="polite"></div>
    <div class="folders-action-menu library-action-menu recently-played-menu" role="menu" hidden></div>
    <div class="queue-confirmation recently-played-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="recently-played-clear-title" aria-hidden="true">
      <div class="queue-confirmation__panel">
        <h3 id="recently-played-clear-title">${t("recentlyPlayed.clearTitle")}</h3>
        <p>${t("recentlyPlayed.clearDescription")}</p>
        <div><button class="recently-played-clear-cancel" type="button">${t("common.cancel")}</button><button class="queue-confirmation__clear recently-played-clear-confirm" type="button">${t("recentlyPlayed.clear")}</button></div>
      </div>
    </div>`;
  const content = section.querySelector<HTMLElement>(
    ".recently-played-content",
  );
  const menu = section.querySelector<HTMLElement>(".recently-played-menu");
  const confirmation = section.querySelector<HTMLElement>(
    ".recently-played-confirmation",
  );
  const cancelClear = section.querySelector<HTMLButtonElement>(
    ".recently-played-clear-cancel",
  );
  const confirmClear = section.querySelector<HTMLButtonElement>(
    ".recently-played-clear-confirm",
  );
  if (!content || !menu || !confirmation || !cancelClear || !confirmClear)
    throw new Error("Recently Played screen is incomplete");

  let items: RecentlyPlayedItem[] = [];
  let cursor: string | null = null;
  let loaded = false;
  let loading = false;
  let refreshPending = false;
  let destroyed = false;
  let generation = 0;
  let historyRevision = options.initialSnapshot?.historyRevision ?? 0;
  const hearts = new Set<{ destroy(): void }>();

  const errorToast = (error: unknown): void => {
    options.showToast(
      error instanceof Error ? error.message : t("library.actionFailed"),
      "error",
    );
  };
  const closeMenu = (): void => {
    menu.hidden = true;
    menu.replaceChildren();
  };
  const closeConfirmation = (): void => {
    confirmation.classList.remove("queue-confirmation--open");
    confirmation.setAttribute("aria-hidden", "true");
  };
  const showMenu = (
    trigger: HTMLButtonElement,
    actions: readonly {
      readonly label: string;
      readonly disabled?: boolean;
      readonly run: () => void;
    }[],
  ): void => {
    closeMenu();
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "menuitem";
      button.textContent = action.label;
      button.disabled = action.disabled ?? false;
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
  const artwork = (trackId: string | null): HTMLElement => {
    const surface = document.createElement("span");
    surface.className = "library-track-art library-artwork";
    if (!trackId) return surface;
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.draggable = false;
    image.src = options.api.artworkUrl(trackId);
    image.addEventListener(
      "load",
      () => {
        image.classList.add("library-artwork--ready");
      },
      { once: true },
    );
    surface.append(image);
    return surface;
  };
  const play = async (historyId: string): Promise<void> => {
    options.noteTrackCommand();
    try {
      await options.api.playRecentlyPlayed({ selectedHistoryId: historyId });
    } catch (error) {
      errorToast(error);
      void load(false);
    }
  };
  const remove = async (historyId: string): Promise<void> => {
    try {
      const result = await options.api.removeRecentlyPlayed(historyId);
      if (result.removedCount > 0) {
        items = items.filter((item) => item.historyId !== historyId);
        render();
        options.showToast(t("recentlyPlayed.removed"), "success");
      }
    } catch (error) {
      errorToast(error);
    }
  };
  const favoriteFromMenu = async (trackId: string): Promise<void> => {
    const next = !(options.favorites.get(trackId) ?? false);
    try {
      await options.favorites.set(trackId, next);
      options.showToast(
        t(next ? "favorites.added" : "favorites.removed"),
        "success",
      );
    } catch (error) {
      errorToast(error);
    }
  };

  const row = (item: RecentlyPlayedItem): HTMLElement => {
    const unavailable = item.availability === "unavailable";
    const element = document.createElement("article");
    element.className = `library-track-row recently-played-row${unavailable ? " library-item--unavailable" : ""}`;
    element.dataset.historyId = item.historyId;
    const main = document.createElement("button");
    main.type = "button";
    main.className = "library-track-row__main";
    main.disabled = unavailable;
    main.setAttribute("aria-label", `${t("library.play")} ${item.title}`);
    const copy = document.createElement("span");
    copy.className = "library-track-row__copy";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const metadata = document.createElement("small");
    metadata.textContent = [item.artist, item.album]
      .filter(Boolean)
      .join(" · ");
    copy.append(title, metadata);
    const listened = document.createElement("time");
    listened.className = "recently-played-row__time";
    listened.dateTime = new Date(item.playedAt).toISOString();
    listened.textContent = playedAtLabel(item.playedAt);
    const duration = document.createElement("time");
    duration.textContent = formatDuration(item.durationSeconds);
    main.append(artwork(item.artworkTrackId), copy, listened, duration);
    if (unavailable) {
      const label = document.createElement("span");
      label.className = "library-unavailable-label";
      label.textContent = t("library.unavailable");
      main.append(label);
    }
    main.addEventListener("click", () => void play(item.historyId));
    const heart = createFavoriteTrackButton({
      trackId: item.id,
      store: options.favorites,
      onError: errorToast,
    });
    hearts.add(heart);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "library-item-more";
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute(
      "aria-label",
      `${t("library.moreActions")} ${item.title}`,
    );
    more.innerHTML = icon("more");
    more.addEventListener("click", () => {
      showMenu(more, [
        {
          label: t("library.play"),
          disabled: unavailable,
          run: () => void play(item.historyId),
        },
        {
          label: t("folders.addToQueue"),
          disabled: unavailable,
          run: () =>
            void options.api
              .queueTrack(item.id)
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
          label: t(
            options.favorites.get(item.id)
              ? "favorites.remove"
              : "favorites.add",
          ),
          run: () => void favoriteFromMenu(item.id),
        },
        {
          label: t("recentlyPlayed.remove"),
          run: () => void remove(item.historyId),
        },
      ]);
    });
    element.append(main, heart.element, more);
    return element;
  };

  const render = (): void => {
    for (const heart of hearts) heart.destroy();
    hearts.clear();
    if (!loaded) {
      content.className = "recently-played-content library-browser-state";
      content.textContent = t("recentlyPlayed.loading");
      return;
    }
    content.className = "recently-played-content";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "recently-played-empty";
      const title = document.createElement("strong");
      title.textContent = t("recentlyPlayed.emptyTitle");
      const copy = document.createElement("p");
      copy.textContent = t("recentlyPlayed.emptyText");
      empty.append(title, copy);
      content.replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    let group = "";
    for (const item of items) {
      const label = historyGroupLabel(item.playedAt);
      if (label !== group) {
        group = label;
        const heading = document.createElement("h2");
        heading.className = "recently-played-group-title";
        heading.textContent = label;
        fragment.append(heading);
      }
      fragment.append(row(item));
    }
    const sentinel = document.createElement("button");
    sentinel.type = "button";
    sentinel.className = "library-page-sentinel";
    sentinel.hidden = cursor === null;
    sentinel.textContent = t("library.loadMore");
    sentinel.addEventListener("click", () => void load(true));
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "recently-played-clear";
    clear.textContent = t("recentlyPlayed.clear");
    clear.addEventListener("click", () => {
      confirmation.classList.add("queue-confirmation--open");
      confirmation.setAttribute("aria-hidden", "false");
      cancelClear.focus();
    });
    fragment.append(sentinel, clear);
    content.replaceChildren(fragment);
  };

  async function load(append: boolean): Promise<void> {
    if (loading) {
      if (!append) refreshPending = true;
      return;
    }
    loading = true;
    if (!append && !loaded) render();
    const currentGeneration = ++generation;
    try {
      const result = await options.api.recentlyPlayed(
        append ? cursor : null,
        PAGE_SIZE,
      );
      if (destroyed || currentGeneration !== generation) return;
      items = (append ? [...items, ...result.items] : [...result.items]).slice(
        0,
        MAX_RENDERED_ITEMS,
      );
      options.favorites.ensure(items.map((item) => item.id));
      cursor = items.length >= MAX_RENDERED_ITEMS ? null : result.nextCursor;
      loaded = true;
    } catch (error) {
      if (!destroyed && currentGeneration === generation) errorToast(error);
    } finally {
      loading = false;
      if (!destroyed && currentGeneration === generation) render();
      if (!destroyed && refreshPending) {
        refreshPending = false;
        void load(false);
      }
    }
  }

  cancelClear.addEventListener("click", closeConfirmation);
  confirmClear.addEventListener("click", () => {
    confirmClear.disabled = true;
    void options.api
      .clearRecentlyPlayed()
      .then(() => {
        items = [];
        cursor = null;
        loaded = true;
        closeConfirmation();
        render();
      })
      .catch(errorToast)
      .finally(() => {
        confirmClear.disabled = false;
      });
  });
  const outsideMenu = (event: PointerEvent): void => {
    if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu();
  };
  const handleEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (confirmation.getAttribute("aria-hidden") === "false")
      closeConfirmation();
    else closeMenu();
  };
  document.addEventListener("pointerdown", outsideMenu);
  document.addEventListener("keydown", handleEscape);
  render();
  void load(false).then(() => {
    if (section.parentElement) section.parentElement.scrollTop = savedScrollTop;
  });

  return {
    element: section,
    updateLibrarySnapshot(snapshot) {
      if (snapshot.historyRevision === historyRevision) return;
      historyRevision = snapshot.historyRevision;
      void load(false);
    },
    destroy() {
      destroyed = true;
      generation += 1;
      savedScrollTop = section.parentElement?.scrollTop ?? 0;
      document.removeEventListener("pointerdown", outsideMenu);
      document.removeEventListener("keydown", handleEscape);
      for (const heart of hearts) heart.destroy();
      hearts.clear();
    },
  };
}
