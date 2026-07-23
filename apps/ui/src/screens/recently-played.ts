import type {
  IndexedLibrarySnapshot,
  ListeningStats,
  MostPlayedItem,
  RecentlyPlayedItem,
} from "../../../../packages/shared/src/library";
import type { LibraryApiClient } from "../api/library-api-client";
import { createFavoriteTrackButton } from "../components/favorite-track-button";
import { icon } from "../components/icons";
import { createSegmentedControl } from "../components/segmented-control";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";
import type { FavoriteTrackStore } from "../state/favorite-track-store";

const PAGE_SIZE = 48;
const MAX_RENDERED_ITEMS = 192;
type HistorySegment = "recent" | "most" | "stats";
let savedSegment: HistorySegment = "recent";
const savedScrollTop: Record<HistorySegment, number> = {
  recent: 0,
  most: 0,
  stats: 0,
};

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

function formatListeningTime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0
    ? t("history.stats.hoursMinutes")
        .replace("{hours}", String(hours))
        .replace("{minutes}", String(remainder))
    : t("history.stats.minutes").replace("{minutes}", String(minutes));
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
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date);
}

function dateLabel(value: number | null): string {
  return value === null
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
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
  readonly openPlaylistPicker: (
    trackIds: readonly string[],
    trigger?: HTMLElement,
  ) => void;
}): ComponentView {
  const section = document.createElement("section");
  section.className = "screen recently-played-screen";
  section.setAttribute("aria-label", t("screen.recentlyPlayed.title"));
  section.innerHTML = `
    <header class="recently-played-header">
      <span class="screen-header__description">${t("screen.recentlyPlayed.description")}</span>
      <div class="recently-played-segments"></div>
    </header>
    <div class="recently-played-content" aria-live="polite"></div>
    <div class="folders-action-menu library-action-menu recently-played-menu" role="menu" hidden></div>
    <div class="queue-confirmation recently-played-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="history-confirmation-title" aria-hidden="true">
      <div class="queue-confirmation__panel">
        <h3 id="history-confirmation-title"></h3><p></p>
        <div><button class="recently-played-clear-cancel" type="button">${t("common.cancel")}</button><button class="queue-confirmation__clear recently-played-clear-confirm" type="button"></button></div>
      </div>
    </div>`;
  const content = section.querySelector<HTMLElement>(
    ".recently-played-content",
  );
  const segmentHost = section.querySelector<HTMLElement>(
    ".recently-played-segments",
  );
  const menu = section.querySelector<HTMLElement>(".recently-played-menu");
  const confirmation = section.querySelector<HTMLElement>(
    ".recently-played-confirmation",
  );
  const confirmationTitle = confirmation?.querySelector<HTMLElement>("h3");
  const confirmationCopy = confirmation?.querySelector<HTMLElement>("p");
  const cancel = section.querySelector<HTMLButtonElement>(
    ".recently-played-clear-cancel",
  );
  const confirm = section.querySelector<HTMLButtonElement>(
    ".recently-played-clear-confirm",
  );
  if (
    !content ||
    !segmentHost ||
    !menu ||
    !confirmation ||
    !confirmationTitle ||
    !confirmationCopy ||
    !cancel ||
    !confirm
  )
    throw new Error("History screen is incomplete");

  let active = savedSegment;
  let recent: RecentlyPlayedItem[] = [];
  let most: MostPlayedItem[] = [];
  let stats: ListeningStats | null = null;
  let recentCursor: string | null = null;
  let mostCursor: string | null = null;
  const loaded: Record<HistorySegment, boolean> = {
    recent: false,
    most: false,
    stats: false,
  };
  let loading = false;
  let refreshPending = false;
  let destroyed = false;
  let generation = 0;
  let historyRevision = options.initialSnapshot?.historyRevision ?? 0;
  let statsRevision = options.initialSnapshot?.statsRevision ?? 0;
  let confirmationAction: (() => Promise<void>) | null = null;
  const hearts = new Set<{ destroy(): void }>();

  const errorToast = (error: unknown): void => {
    options.showToast(
      error instanceof Error ? error.message : t("library.actionFailed"),
      "error",
    );
  };
  const parent = (): HTMLElement | null => section.parentElement;
  const closeMenu = (): void => {
    menu.hidden = true;
    menu.replaceChildren();
  };
  const closeConfirmation = (): void => {
    confirmation.classList.remove("queue-confirmation--open");
    confirmation.setAttribute("aria-hidden", "true");
  };
  const ask = (
    title: string,
    copy: string,
    label: string,
    action: () => Promise<void>,
  ): void => {
    confirmationTitle.textContent = title;
    confirmationCopy.textContent = copy;
    confirm.textContent = label;
    confirmationAction = action;
    confirmation.classList.add("queue-confirmation--open");
    confirmation.setAttribute("aria-hidden", "false");
    cancel.focus();
  };
  const artwork = (trackId: string | null): HTMLElement => {
    const surface = document.createElement("span");
    surface.className = "library-track-art library-artwork";
    if (trackId) {
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
    }
    return surface;
  };
  const showMenu = (
    trigger: HTMLButtonElement,
    actions: readonly { label: string; disabled?: boolean; run: () => void }[],
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
  const favorite = async (trackId: string): Promise<void> => {
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
  const queue = (trackId: string): void => {
    void options.api
      .queueTrack(trackId)
      .then((result) => {
        options.showToast(
          t(
            result.appendedCount > 0
              ? "library.trackAdded"
              : "library.alreadyQueued",
          ),
          "neutral",
        );
      })
      .catch(errorToast);
  };
  const playRecent = (item: RecentlyPlayedItem): void => {
    options.noteTrackCommand();
    void options.api
      .playRecentlyPlayed({ selectedHistoryId: item.historyId })
      .catch((error: unknown) => {
        errorToast(error);
        void load(false);
      });
  };
  const playMost = (item: MostPlayedItem): void => {
    options.noteTrackCommand();
    void options.api
      .playMostPlayed({ selectedTrackId: item.id })
      .catch((error: unknown) => {
        errorToast(error);
        void load(false);
      });
  };
  const trackRow = (item: RecentlyPlayedItem | MostPlayedItem): HTMLElement => {
    const isRecent = "historyId" in item;
    const unavailable = item.availability === "unavailable";
    const element = document.createElement("article");
    element.className = `library-track-row recently-played-row${unavailable ? " library-item--unavailable" : ""}`;
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
    const detail = document.createElement("span");
    detail.className = "recently-played-row__time";
    detail.textContent = isRecent
      ? dateLabel(item.playedAt)
      : `${t("history.most.playCount").replace("{count}", String(item.playCount))} · ${dateLabel(item.lastPlayedAt)}`;
    const duration = document.createElement("time");
    duration.textContent = formatDuration(item.durationSeconds);
    main.append(artwork(item.artworkTrackId), copy, detail, duration);
    const runPlay = (): void => {
      if (isRecent) playRecent(item);
      else playMost(item);
    };
    main.addEventListener("click", runPlay);
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
        { label: t("library.play"), disabled: unavailable, run: runPlay },
        {
          label: t("common.addToPlaylist"),
          run: () => {
            options.openPlaylistPicker([item.id], more);
          },
        },
        {
          label: t("folders.addToQueue"),
          disabled: unavailable,
          run: () => {
            queue(item.id);
          },
        },
        {
          label: t(
            options.favorites.get(item.id)
              ? "favorites.remove"
              : "favorites.add",
          ),
          run: () => void favorite(item.id),
        },
        ...(isRecent
          ? [
              {
                label: t("recentlyPlayed.remove"),
                run: () => void removeRecent(item.historyId),
              },
            ]
          : []),
      ]);
    });
    element.append(main, heart.element, more);
    return element;
  };
  const removeRecent = async (historyId: string): Promise<void> => {
    try {
      const result = await options.api.removeRecentlyPlayed(historyId);
      if (result.removedCount > 0) {
        recent = recent.filter((item) => item.historyId !== historyId);
        render();
        options.showToast(t("recentlyPlayed.removed"), "success");
      }
    } catch (error) {
      errorToast(error);
    }
  };
  const empty = (titleKey: string, textKey: string): HTMLElement => {
    const element = document.createElement("div");
    element.className = "recently-played-empty";
    const title = document.createElement("strong");
    title.textContent = t(titleKey);
    const text = document.createElement("p");
    text.textContent = t(textKey);
    element.append(title, text);
    return element;
  };
  const renderStats = (): void => {
    if (!stats) return;
    const values = [
      [
        "history.stats.listeningTime",
        formatListeningTime(stats.listeningSeconds),
      ],
      ["history.stats.qualifiedPlays", String(stats.qualifiedPlays)],
      ["history.stats.completedPlays", String(stats.completedPlays)],
      ["history.stats.uniqueTracks", String(stats.uniqueTracks)],
      ["history.stats.trackingSince", dateLabel(stats.trackingSince)],
      ["history.stats.lastListened", dateLabel(stats.lastListened)],
    ] as const;
    const grid = document.createElement("div");
    grid.className = "history-stats-grid";
    for (const [labelKey, value] of values) {
      const card = document.createElement("article");
      card.className = "history-stats-card";
      const label = document.createElement("span");
      label.textContent = t(labelKey);
      const strong = document.createElement("strong");
      strong.textContent = value;
      card.append(label, strong);
      grid.append(card);
    }
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "recently-played-clear";
    reset.textContent = t("history.stats.reset");
    reset.hidden = stats.qualifiedPlays === 0;
    reset.addEventListener("click", () => {
      ask(
        t("history.stats.resetTitle"),
        t("history.stats.resetDescription"),
        t("history.stats.reset"),
        async () => {
          await options.api.resetListeningStats();
          stats = await options.api.listeningStats();
          loaded.stats = true;
        },
      );
    });
    content.replaceChildren(grid, reset);
  };
  const render = (): void => {
    for (const heart of hearts) heart.destroy();
    hearts.clear();
    if (!loaded[active]) {
      content.className = "recently-played-content library-browser-state";
      content.textContent = t("recentlyPlayed.loading");
      return;
    }
    content.className = "recently-played-content";
    if (active === "stats") {
      renderStats();
      return;
    }
    const items = active === "recent" ? recent : most;
    if (items.length === 0) {
      content.replaceChildren(
        empty(
          active === "recent"
            ? "recentlyPlayed.emptyTitle"
            : "history.most.emptyTitle",
          active === "recent"
            ? "recentlyPlayed.emptyText"
            : "history.most.emptyText",
        ),
      );
      return;
    }
    const fragment = document.createDocumentFragment();
    let group = "";
    for (const item of items) {
      if (active === "recent") {
        const label = historyGroupLabel((item as RecentlyPlayedItem).playedAt);
        if (label !== group) {
          group = label;
          const heading = document.createElement("h2");
          heading.className = "recently-played-group-title";
          heading.textContent = label;
          fragment.append(heading);
        }
      }
      fragment.append(trackRow(item));
    }
    const sentinel = document.createElement("button");
    sentinel.type = "button";
    sentinel.className = "library-page-sentinel";
    sentinel.hidden =
      (active === "recent" ? recentCursor : mostCursor) === null;
    sentinel.textContent = t("library.loadMore");
    sentinel.addEventListener("click", () => void load(true));
    fragment.append(sentinel);
    if (active === "recent") {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "recently-played-clear";
      clear.textContent = t("recentlyPlayed.clear");
      clear.addEventListener("click", () => {
        ask(
          t("recentlyPlayed.clearTitle"),
          t("recentlyPlayed.clearDescription"),
          t("recentlyPlayed.clear"),
          async () => {
            await options.api.clearRecentlyPlayed();
            recent = [];
            recentCursor = null;
            loaded.recent = true;
          },
        );
      });
      fragment.append(clear);
    }
    content.replaceChildren(fragment);
  };
  async function load(append: boolean): Promise<void> {
    if (loading) {
      if (!append) refreshPending = true;
      return;
    }
    loading = true;
    const segment = active;
    const currentGeneration = ++generation;
    if (!append && !loaded[segment]) render();
    try {
      if (segment === "recent") {
        const result = await options.api.recentlyPlayed(
          append ? recentCursor : null,
          PAGE_SIZE,
        );
        recent = (
          append ? [...recent, ...result.items] : [...result.items]
        ).slice(0, MAX_RENDERED_ITEMS);
        recentCursor =
          recent.length >= MAX_RENDERED_ITEMS ? null : result.nextCursor;
        options.favorites.ensure(recent.map((item) => item.id));
      } else if (segment === "most") {
        const result = await options.api.mostPlayed(
          append ? mostCursor : null,
          PAGE_SIZE,
        );
        most = (append ? [...most, ...result.items] : [...result.items]).slice(
          0,
          MAX_RENDERED_ITEMS,
        );
        mostCursor =
          most.length >= MAX_RENDERED_ITEMS ? null : result.nextCursor;
        options.favorites.ensure(most.map((item) => item.id));
      } else stats = await options.api.listeningStats();
      if (!destroyed && currentGeneration === generation)
        loaded[segment] = true;
    } catch (error) {
      if (!destroyed && currentGeneration === generation) errorToast(error);
    } finally {
      loading = false;
      if (!destroyed && currentGeneration === generation && active === segment)
        render();
      if (!destroyed && refreshPending) {
        refreshPending = false;
        void load(false);
      }
    }
  }
  const segmented = createSegmentedControl<HistorySegment>({
    label: t("history.segments.label"),
    value: active,
    items: [
      { value: "recent", label: t("history.segments.recent") },
      { value: "most", label: t("history.segments.most") },
      { value: "stats", label: t("history.segments.stats") },
    ],
    onChange(value) {
      savedScrollTop[active] = parent()?.scrollTop ?? 0;
      active = value;
      savedSegment = value;
      closeMenu();
      render();
      if (!loaded[value])
        void load(false).then(() => {
          const scrollParent = parent();
          if (scrollParent) scrollParent.scrollTop = savedScrollTop[value];
        });
      else {
        const scrollParent = parent();
        if (scrollParent) scrollParent.scrollTop = savedScrollTop[value];
      }
    },
  });
  segmentHost.append(segmented.element);
  cancel.addEventListener("click", closeConfirmation);
  confirm.addEventListener("click", () => {
    if (!confirmationAction) return;
    confirm.disabled = true;
    void confirmationAction()
      .then(() => {
        closeConfirmation();
        render();
      })
      .catch(errorToast)
      .finally(() => {
        confirm.disabled = false;
      });
  });
  const outsideMenu = (event: PointerEvent): void => {
    if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu();
  };
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (confirmation.getAttribute("aria-hidden") === "false")
      closeConfirmation();
    else closeMenu();
  };
  document.addEventListener("pointerdown", outsideMenu);
  document.addEventListener("keydown", escape);
  render();
  void load(false).then(() => {
    const scrollParent = parent();
    if (scrollParent) scrollParent.scrollTop = savedScrollTop[active];
  });
  return {
    element: section,
    updateLibrarySnapshot(snapshot) {
      if (snapshot.historyRevision !== historyRevision) {
        historyRevision = snapshot.historyRevision;
        if (active === "recent") void load(false);
        else loaded.recent = false;
      }
      if (snapshot.statsRevision !== statsRevision) {
        statsRevision = snapshot.statsRevision;
        if (active === "most") {
          loaded.stats = false;
          void load(false);
        } else if (active === "stats") {
          loaded.most = false;
          void load(false);
        } else {
          loaded.most = false;
          loaded.stats = false;
        }
      }
    },
    destroy() {
      destroyed = true;
      generation += 1;
      savedScrollTop[active] = parent()?.scrollTop ?? 0;
      document.removeEventListener("pointerdown", outsideMenu);
      document.removeEventListener("keydown", escape);
      for (const heart of hearts) heart.destroy();
      hearts.clear();
    },
  };
}
