import type {
  IndexedLibrarySnapshot,
  LibraryAlbum,
  LibraryAlbumDetail,
  LibraryArtist,
  LibraryArtistDetail,
  LibraryContextRequest,
  LibraryPage,
  LibraryScanProgress,
  LibraryTrack,
  LibraryGroupedSearchResults,
  LibrarySearchAlbum,
  LibrarySearchCategory,
} from "../../../../packages/shared/src/library";
import type { LibraryApiClient } from "../api/library-api-client";
import { icon } from "../components/icons";
import { createSegmentedControl } from "../components/segmented-control";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";
import type { LibraryAlbumViewMode, LibrarySegment } from "../state/types";
import {
  loadLibraryAlbumViewMode,
  loadLibrarySegment,
  saveLibraryAlbumViewMode,
  saveLibrarySegment,
} from "../utils/storage";

export interface LibraryScreenOptions {
  readonly api: LibraryApiClient;
  readonly initialSnapshot: IndexedLibrarySnapshot | null;
  readonly openSources: () => void;
  readonly noteTrackCommand: () => void;
  readonly setTitle: (title: string) => void;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
}

type LibraryRoute =
  | { readonly kind: "root" }
  | { readonly kind: "manage" }
  | {
      readonly kind: "album";
      readonly id: string;
      readonly fromArtist?: string;
    }
  | { readonly kind: "artist"; readonly id: string };

interface PageState<T> {
  items: T[];
  cursor: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

interface SearchCategoryState<T> extends PageState<T> {
  total: number;
}

interface PreviousLibraryState {
  readonly segment: LibrarySegment;
  readonly albumView: LibraryAlbumViewMode;
  readonly scrollTop: number;
}

interface LibrarySearchState {
  active: boolean;
  query: string;
  normalizedQuery: string;
  loading: boolean;
  error: string | null;
  groupedResults: LibraryGroupedSearchResults | null;
  activeCategoryView: LibrarySearchCategory | null;
  categoryPages: {
    artists: SearchCategoryState<LibraryArtist>;
    albums: SearchCategoryState<LibrarySearchAlbum>;
    tracks: SearchCategoryState<LibraryTrack>;
  };
  requestSequence: number;
  scrollPositions: {
    grouped: number;
    artists: number;
    albums: number;
    tracks: number;
  };
  previousLibraryState: PreviousLibraryState | null;
}

interface LibrarySearchSessionSnapshot {
  readonly query: string;
  readonly normalizedQuery: string;
  readonly groupedResults: LibraryGroupedSearchResults | null;
  readonly activeCategoryView: LibrarySearchCategory | null;
  readonly categoryPages: LibrarySearchState["categoryPages"];
  readonly scrollPositions: LibrarySearchState["scrollPositions"];
}

const PAGE_SIZE = 48;
const MAX_RENDERED_ITEMS = 192;
const SEARCH_DEBOUNCE_MILLISECONDS = 250;
let librarySearchSession: LibrarySearchSessionSnapshot | null = null;

function emptyPage<T>(): PageState<T> {
  return {
    items: [],
    cursor: null,
    loaded: false,
    loading: false,
    error: null,
  };
}

function emptySearchPage<T>(): SearchCategoryState<T> {
  return { ...emptyPage<T>(), total: 0 };
}

function normalizedInputLength(value: string): number {
  return Array.from(value.trim().replace(/\s+/gu, " ")).length;
}

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

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function message(
  key: string,
  values: Readonly<Record<string, string>> = {},
): string {
  let result = t(key);
  for (const [name, value] of Object.entries(values))
    result = result.replaceAll(`{${name}}`, value);
  return result;
}

function scanStatusLabel(status: LibraryScanProgress["status"]): string {
  return t(`library.status.${status}`);
}

function availabilityText(total: number, available: number): string {
  return available === total
    ? message("library.availableCount", { count: String(total) })
    : message("library.availableOfCount", {
        available: String(available),
        count: String(total),
      });
}

function artwork(
  api: LibraryApiClient,
  trackId: string | null,
  className: string,
): HTMLElement {
  const surface = document.createElement("span");
  surface.className = `${className} library-artwork`;
  if (!trackId) return surface;
  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  image.src = api.artworkUrl(trackId);
  image.addEventListener(
    "load",
    () => {
      void image
        .decode()
        .catch(() => undefined)
        .then(() => {
          if (image.isConnected) image.classList.add("library-artwork--ready");
        });
    },
    { once: true },
  );
  surface.append(image);
  return surface;
}

export function createLibraryScreen(
  options: LibraryScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen library-screen";
  section.setAttribute("aria-label", t("screen.library.title"));
  section.innerHTML = `
    <div class="library-root">
      <header class="screen-header library-header">
        <button class="folders-back library-search-close" type="button" aria-label="${t("library.searchClose")}" hidden>${icon("back")}<span>${t("common.back")}</span></button>
        <div class="library-search-field" hidden>
          <label class="visually-hidden" for="library-search-input">${t("library.searchLabel")}</label>
          <input id="library-search-input" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="${t("library.searchPlaceholder")}" />
          <button class="library-search-clear" type="button" aria-label="${t("library.searchClear")}" hidden>${icon("close")}</button>
        </div>
      </header>
      <div class="library-browser-toolbar">
        <div class="library-segments"></div>
        <div class="library-toolbar-actions">
          <button class="library-search-action" type="button">${icon("search")}<span>${t("library.search")}</span></button>
          <button class="library-manage-action" type="button" aria-label="${t("library.manage")}">${t("library.manage")}</button>
          <div class="library-view-controls"></div>
        </div>
      </div>
      <div class="library-browser-content"></div>
      <div class="library-search-status visually-hidden" role="status" aria-live="polite"></div>
    </div>
    <div class="library-manage" hidden>
      <header class="library-detail-header library-manage__header">
        <button class="folders-back library-manage-back" type="button">${icon("back")}<span>${t("common.back")}</span></button>
        <span class="library-detail-header__spacer" aria-hidden="true"></span>
      </header>
      <section class="library-manage__section" aria-labelledby="library-summary-heading">
        <h2 id="library-summary-heading">${t("library.summary")}</h2>
        <div class="library-summary" aria-label="${t("library.summary")}">
          <article class="library-counter"><span>${t("library.tracks")}</span><strong data-library-count="tracks">0</strong></article>
          <article class="library-counter"><span>${t("library.albums")}</span><strong data-library-count="albums">0</strong></article>
          <article class="library-counter"><span>${t("library.artists")}</span><strong data-library-count="artists">0</strong></article>
          <article class="library-counter"><span>${t("library.unavailable")}</span><strong data-library-count="unavailable">0</strong></article>
        </div>
      </section>
      <section class="library-manage__section library-scan-panel" aria-labelledby="library-scan-heading">
        <div class="library-scan-panel__heading">
          <div><h2 id="library-scan-heading">${t("library.scan")}</h2><span data-library-field="status" role="status" aria-live="polite">${t("library.idle")}</span></div>
          <button class="primary-action library-manage-scan-action" type="button">${t("library.rescan")}</button>
        </div>
        <strong data-library-field="source">${t("library.idle")}</strong>
        <progress class="library-progress" aria-label="${t("library.progress")}"></progress>
        <dl class="library-scan-stats">
          <div><dt>${t("library.found")}</dt><dd data-library-stat="discovered">0</dd></div>
          <div><dt>${t("library.processed")}</dt><dd data-library-stat="processed">0</dd></div>
          <div><dt>${t("library.new")}</dt><dd data-library-stat="new">0</dd></div>
          <div><dt>${t("library.modified")}</dt><dd data-library-stat="modified">0</dd></div>
          <div><dt>${t("library.unchanged")}</dt><dd data-library-stat="unchanged">0</dd></div>
          <div><dt>${t("library.unavailable")}</dt><dd data-library-stat="unavailable">0</dd></div>
          <div><dt>${t("library.errors")}</dt><dd data-library-stat="errors">0</dd></div>
          <div><dt>${t("library.elapsed")}</dt><dd data-library-stat="elapsed">0:00</dd></div>
        </dl>
        <span class="library-last-scan"></span>
      </section>
      <section class="library-manage__section" aria-labelledby="library-sources-heading">
        <h2 id="library-sources-heading">${t("library.sources")}</h2>
        <div class="library-sources-overview"></div>
        <button class="library-open-sources" type="button">${t("library.openSources")}</button>
      </section>
    </div>
    <div class="library-detail" hidden></div>
    <div class="folders-action-menu library-action-menu" role="menu" hidden></div>`;
  const root = section.querySelector<HTMLElement>(".library-root");
  const manageRegion = section.querySelector<HTMLElement>(".library-manage");
  const detail = section.querySelector<HTMLElement>(".library-detail");
  const browser = section.querySelector<HTMLElement>(
    ".library-browser-content",
  );
  const viewControls = section.querySelector<HTMLElement>(
    ".library-view-controls",
  );
  const segmentsHost = section.querySelector<HTMLElement>(".library-segments");
  const browserToolbar = section.querySelector<HTMLElement>(
    ".library-browser-toolbar",
  );
  const libraryHeader = section.querySelector<HTMLElement>(".library-header");
  const menu = section.querySelector<HTMLElement>(".library-action-menu");
  const manageAction = section.querySelector<HTMLButtonElement>(
    ".library-manage-action",
  );
  const searchAction = section.querySelector<HTMLButtonElement>(
    ".library-search-action",
  );
  const searchClose = section.querySelector<HTMLButtonElement>(
    ".library-search-close",
  );
  const searchField = section.querySelector<HTMLElement>(
    ".library-search-field",
  );
  const searchInput = section.querySelector<HTMLInputElement>(
    ".library-search-field input",
  );
  const searchClear = section.querySelector<HTMLButtonElement>(
    ".library-search-clear",
  );
  const searchStatus = section.querySelector<HTMLElement>(
    ".library-search-status",
  );
  const manageScanAction = section.querySelector<HTMLButtonElement>(
    ".library-manage-scan-action",
  );
  const manageBack = section.querySelector<HTMLButtonElement>(
    ".library-manage-back",
  );
  const sourcesOverview = section.querySelector<HTMLElement>(
    ".library-sources-overview",
  );
  const openSources = section.querySelector<HTMLButtonElement>(
    ".library-open-sources",
  );
  const progress =
    section.querySelector<HTMLProgressElement>(".library-progress");
  const source = section.querySelector<HTMLElement>(
    '[data-library-field="source"]',
  );
  const status = section.querySelector<HTMLElement>(
    '[data-library-field="status"]',
  );
  const lastScan = section.querySelector<HTMLElement>(".library-last-scan");
  if (
    !root ||
    !manageRegion ||
    !detail ||
    !browser ||
    !viewControls ||
    !segmentsHost ||
    !browserToolbar ||
    !libraryHeader ||
    !menu ||
    !manageAction ||
    !searchAction ||
    !searchClose ||
    !searchField ||
    !searchInput ||
    !searchClear ||
    !searchStatus ||
    !manageScanAction ||
    !manageBack ||
    !sourcesOverview ||
    !openSources ||
    !progress ||
    !source ||
    !status ||
    !lastScan
  )
    throw new Error("Library screen is incomplete");
  const rootRegion = root;
  const manage = manageRegion;
  const detailRegion = detail;

  const counts = new Map(
    [...section.querySelectorAll<HTMLElement>("[data-library-count]")].map(
      (element) => [element.dataset.libraryCount ?? "", element],
    ),
  );
  const scanStats = new Map(
    [...section.querySelectorAll<HTMLElement>("[data-library-stat]")].map(
      (element) => [element.dataset.libraryStat ?? "", element],
    ),
  );
  const pages = {
    albums: emptyPage<LibraryAlbum>(),
    artists: emptyPage<LibraryArtist>(),
    tracks: emptyPage<LibraryTrack>(),
  };
  let segment: LibrarySegment = loadLibrarySegment();
  let albumView: LibraryAlbumViewMode = loadLibraryAlbumViewMode();
  const restoredSearch = librarySearchSession;
  const search: LibrarySearchState = {
    active: restoredSearch !== null,
    query: restoredSearch?.query ?? "",
    normalizedQuery: restoredSearch?.normalizedQuery ?? "",
    loading: false,
    error: null,
    groupedResults: restoredSearch?.groupedResults ?? null,
    activeCategoryView: restoredSearch?.activeCategoryView ?? null,
    categoryPages: restoredSearch
      ? {
          artists: {
            ...restoredSearch.categoryPages.artists,
            items: [...restoredSearch.categoryPages.artists.items],
            loading: false,
          },
          albums: {
            ...restoredSearch.categoryPages.albums,
            items: [...restoredSearch.categoryPages.albums.items],
            loading: false,
          },
          tracks: {
            ...restoredSearch.categoryPages.tracks,
            items: [...restoredSearch.categoryPages.tracks.items],
            loading: false,
          },
        }
      : {
          artists: emptySearchPage(),
          albums: emptySearchPage(),
          tracks: emptySearchPage(),
        },
    requestSequence: 0,
    scrollPositions: restoredSearch
      ? { ...restoredSearch.scrollPositions }
      : { grouped: 0, artists: 0, albums: 0, tracks: 0 },
    previousLibraryState: restoredSearch
      ? { segment, albumView, scrollTop: 0 }
      : null,
  };
  let route: LibraryRoute = { kind: "root" };
  let destroyed = false;
  let requestGeneration = 0;
  let scanPending = false;
  let activeScan: LibraryScanProgress | null = null;
  let snapshot: IndexedLibrarySnapshot | null = options.initialSnapshot;
  let completedGeneration = "";
  let snapshotInitialized = false;
  let restoreFocus: HTMLElement | null = null;
  let activeArtistDetail: LibraryArtistDetail | null = null;
  let rootScrollTop = 0;
  let artistScrollTop = 0;
  let manageScrollTop = 0;
  let manageReturnRoute: LibraryRoute = { kind: "root" };
  let manageReturnScrollTop = 0;
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  let groupedSearchController: AbortController | null = null;
  let categorySearchController: AbortController | null = null;

  const closeMenu = (focus = false): void => {
    const triggerId = menu.dataset.triggerId;
    menu.hidden = true;
    menu.replaceChildren();
    if (focus && triggerId)
      section.querySelector<HTMLElement>(`#${CSS.escape(triggerId)}`)?.focus();
    delete menu.dataset.triggerId;
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
    if (!trigger.id) trigger.id = `library-menu-${crypto.randomUUID()}`;
    menu.dataset.triggerId = trigger.id;
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

  const queueContext = async (
    request: LibraryContextRequest,
    label: string,
  ): Promise<void> => {
    try {
      const result = await options.api.queue(request);
      options.showToast(
        result.appendedCount > 0 ? label : t("library.alreadyQueued"),
        "neutral",
      );
    } catch (error) {
      options.showToast(
        error instanceof Error ? error.message : t("library.actionFailed"),
        "error",
      );
    }
  };

  const queueTrack = async (trackId: string): Promise<void> => {
    try {
      const result = await options.api.queueTrack(trackId);
      options.showToast(
        result.appendedCount > 0
          ? t("library.trackAdded")
          : t("library.alreadyQueued"),
        "neutral",
      );
    } catch (error) {
      options.showToast(
        error instanceof Error ? error.message : t("library.actionFailed"),
        "error",
      );
    }
  };

  const play = async (request: LibraryContextRequest): Promise<void> => {
    options.noteTrackCommand();
    try {
      await options.api.play(request);
    } catch (error) {
      options.showToast(
        error instanceof Error ? error.message : t("library.actionFailed"),
        "error",
      );
    }
  };

  const playSearchTrack = async (trackId: string): Promise<void> => {
    options.noteTrackCommand();
    try {
      await options.api.play({ context: "track", id: trackId });
    } catch (error) {
      options.showToast(
        error instanceof Error ? error.message : t("library.actionFailed"),
        "error",
      );
      if (!destroyed && search.active) {
        const category = search.activeCategoryView;
        if (category) void loadSearchCategory(category, false);
        else void executeGroupedSearch();
      }
    }
  };

  const moreButton = (
    hasMore: boolean,
    loading: boolean,
    load: () => void,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = "library-page-sentinel";
    button.type = "button";
    button.hidden = !hasMore;
    button.disabled = loading;
    button.textContent = loading ? t("library.loading") : t("library.loadMore");
    button.addEventListener("click", load);
    return button;
  };

  const trackRow = (
    track: LibraryTrack,
    playTrack: () => void,
    includePlayAction = false,
  ): HTMLElement => {
    const row = document.createElement("article");
    const unavailable = track.availability === "unavailable";
    row.className = `library-track-row${unavailable ? " library-item--unavailable" : ""}`;
    row.dataset.trackId = track.id;
    const main = document.createElement("button");
    main.className = "library-track-row__main";
    main.type = "button";
    main.disabled = unavailable;
    main.setAttribute(
      "aria-label",
      unavailable
        ? `${track.title}, ${t("library.unavailable")}`
        : message("library.playTrack", { title: track.title }),
    );
    main.append(
      artwork(options.api, track.artworkTrackId, "library-track-art"),
    );
    const copy = document.createElement("span");
    copy.className = "library-track-row__copy";
    const title = document.createElement("strong");
    title.textContent = track.title;
    const secondary = document.createElement("small");
    secondary.textContent = [track.artist, track.album]
      .filter(Boolean)
      .join(" · ");
    copy.append(title, secondary);
    const number = document.createElement("span");
    number.className = "library-track-row__number";
    number.textContent =
      track.trackNumber === null ? "" : String(track.trackNumber);
    const duration = document.createElement("time");
    duration.textContent = formatDuration(track.durationSeconds);
    main.append(number, copy, duration);
    if (unavailable) {
      const badge = document.createElement("span");
      badge.className = "library-unavailable-label";
      badge.textContent = t("library.unavailable");
      main.append(badge);
    }
    main.addEventListener("click", () => {
      playTrack();
    });
    const more = document.createElement("button");
    more.className = "library-item-more";
    more.type = "button";
    more.disabled = unavailable;
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute(
      "aria-label",
      message("library.trackActions", { title: track.title }),
    );
    more.innerHTML = icon("more");
    more.addEventListener("click", () => {
      showMenu(more, [
        ...(includePlayAction
          ? [
              {
                label: t("library.play"),
                disabled: unavailable,
                run: playTrack,
              },
            ]
          : []),
        {
          label: t("folders.addToQueue"),
          disabled: unavailable,
          run: () => void queueTrack(track.id),
        },
      ]);
    });
    row.append(main, more);
    return row;
  };

  const albumItem = (album: LibraryAlbum, fromArtist?: string): HTMLElement => {
    const card = document.createElement("article");
    card.className = `library-album-card${album.availability === "unavailable" ? " library-item--unavailable" : ""}`;
    card.dataset.albumId = album.id;
    const open = document.createElement("button");
    open.className = "library-album-card__open";
    open.type = "button";
    open.setAttribute(
      "aria-label",
      message("library.openAlbum", { title: album.title }),
    );
    open.append(
      artwork(options.api, album.artworkTrackId, "library-album-art"),
    );
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = album.title;
    const artist = document.createElement("small");
    artist.textContent = [album.albumArtist, album.year]
      .filter((value) => value !== null && value !== "")
      .join(" · ");
    const count = document.createElement("small");
    count.textContent = availabilityText(
      album.trackCount,
      album.availableTrackCount,
    );
    copy.append(title, artist, count);
    open.append(copy);
    open.addEventListener("click", () => {
      restoreFocus = open;
      if (fromArtist) artistScrollTop = section.parentElement?.scrollTop ?? 0;
      else rootScrollTop = section.parentElement?.scrollTop ?? 0;
      route = {
        kind: "album",
        id: album.id,
        ...(fromArtist ? { fromArtist } : {}),
      };
      void renderRoute();
    });
    const more = document.createElement("button");
    more.className = "library-item-more";
    more.type = "button";
    more.disabled = album.availableTrackCount === 0;
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute(
      "aria-label",
      message("library.albumActions", { title: album.title }),
    );
    more.innerHTML = icon("more");
    more.addEventListener("click", () => {
      showMenu(more, [
        {
          label: t("library.addAlbum"),
          run: () =>
            void queueContext(
              { context: "album", id: album.id },
              t("library.albumAdded"),
            ),
        },
      ]);
    });
    card.append(open, more);
    return card;
  };

  const renderError = (message: string, retry: () => void): void => {
    const state = document.createElement("div");
    state.className = "library-browser-state";
    const copy = document.createElement("p");
    copy.textContent = message;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t("folders.retry");
    button.addEventListener("click", retry);
    state.append(copy, button);
    browser.replaceChildren(state);
  };

  const renderSourcesOverview = (): void => {
    const current = snapshot;
    const fragment = document.createDocumentFragment();
    if (!current || current.sources.length === 0) {
      const empty = document.createElement("p");
      empty.className = "library-sources-empty";
      empty.textContent = t(
        current ? "library.noSources" : "library.unavailableState",
      );
      fragment.append(empty);
      if (!current) {
        const retry = document.createElement("button");
        retry.className = "library-sources-retry";
        retry.type = "button";
        retry.textContent = t("folders.retry");
        retry.addEventListener("click", () => {
          retry.disabled = true;
          void options.api
            .snapshot()
            .then(renderSnapshot)
            .catch((error: unknown) => {
              options.showToast(
                error instanceof Error
                  ? error.message
                  : t("library.unavailableState"),
                "error",
              );
            })
            .finally(() => {
              retry.disabled = false;
            });
        });
        fragment.append(retry);
      }
    }
    const scanBusy =
      current !== null &&
      (current.status.activeScan !== null ||
        current.status.queuedSourceIds.length > 0);
    for (const item of current?.sources ?? []) {
      const row = document.createElement("article");
      row.className = "library-source-overview";
      row.dataset.sourceId = item.sourceId;
      const copy = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = item.displayName;
      const availability = document.createElement("span");
      availability.dataset.availability = item.availability;
      availability.textContent = t(
        item.availability === "available"
          ? "sources.available"
          : "sources.unavailable",
      );
      const counts = document.createElement("span");
      counts.textContent = `${String(item.fileCount)} ${t("library.tracks")}${
        item.unavailableCount > 0
          ? ` · ${String(item.unavailableCount)} ${t("library.unavailable").toLocaleLowerCase()}`
          : ""
      }`;
      const scanState = document.createElement("span");
      scanState.textContent = `${scanStatusLabel(item.scanStatus)} · ${t("library.lastScan")} ${formatDate(item.lastSuccessfulScan)}`;
      copy.append(name, availability, counts, scanState);
      const more = document.createElement("button");
      more.className = "library-item-more";
      more.type = "button";
      more.disabled = scanBusy;
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute(
        "aria-label",
        message("library.sourceActions", { name: item.displayName }),
      );
      more.innerHTML = icon("more");
      more.addEventListener("click", () => {
        const retry = ["failed", "source-unavailable", "interrupted"].includes(
          item.scanStatus,
        );
        showMenu(more, [
          {
            label: t(retry ? "sources.retry" : "library.rescan"),
            disabled: scanBusy,
            run: () => {
              void options.api
                .scan({ sourceId: item.sourceId })
                .catch((error: unknown) => {
                  options.showToast(
                    error instanceof Error
                      ? error.message
                      : t("library.actionFailed"),
                    "error",
                  );
                });
            },
          },
        ]);
      });
      row.append(copy, more);
      fragment.append(row);
    }
    sourcesOverview.replaceChildren(fragment);
  };

  const renderManage = (): void => {
    rootRegion.hidden = true;
    detailRegion.hidden = true;
    manage.hidden = false;
    options.setTitle(t("library.manage"));
    renderSourcesOverview();
  };

  const persistSearchSession = (): void => {
    if (!search.active) {
      librarySearchSession = null;
      return;
    }
    librarySearchSession = {
      query: search.query,
      normalizedQuery: search.normalizedQuery,
      groupedResults: search.groupedResults,
      activeCategoryView: search.activeCategoryView,
      categoryPages: {
        artists: {
          ...search.categoryPages.artists,
          items: [...search.categoryPages.artists.items],
          loading: false,
        },
        albums: {
          ...search.categoryPages.albums,
          items: [...search.categoryPages.albums.items],
          loading: false,
        },
        tracks: {
          ...search.categoryPages.tracks,
          items: [...search.categoryPages.tracks.items],
          loading: false,
        },
      },
      scrollPositions: { ...search.scrollPositions },
    };
  };

  const cancelSearchRequests = (): void => {
    if (searchDebounce !== null) {
      clearTimeout(searchDebounce);
      searchDebounce = null;
    }
    groupedSearchController?.abort();
    categorySearchController?.abort();
    groupedSearchController = null;
    categorySearchController = null;
    search.requestSequence += 1;
  };

  const setSearchHeader = (): void => {
    libraryHeader.hidden = !search.active || search.activeCategoryView !== null;
    searchClose.hidden = !search.active;
    searchField.hidden = !search.active;
    browserToolbar.hidden = search.active;
    if (search.active && searchInput.value !== search.query)
      searchInput.value = search.query;
    searchClear.hidden = !search.active || search.query.length === 0;
  };

  const searchSectionHeader = (
    category: LibrarySearchCategory,
    total: number,
    visibleCount: number,
  ): HTMLElement => {
    const header = document.createElement("header");
    header.className = "library-search-section__header";
    const copy = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = t(`library.${category}`);
    const count = document.createElement("span");
    count.textContent = message("library.searchCount", {
      count: String(total),
    });
    copy.append(title, count);
    header.append(copy);
    if (total > visibleCount) {
      const viewAll = document.createElement("button");
      viewAll.type = "button";
      viewAll.textContent = t("library.searchViewAll");
      viewAll.addEventListener("click", () => {
        search.scrollPositions.grouped = section.parentElement?.scrollTop ?? 0;
        search.activeCategoryView = category;
        persistSearchSession();
        if (section.parentElement) section.parentElement.scrollTop = 0;
        void loadSearchCategory(category, false);
      });
      header.append(viewAll);
    }
    return header;
  };

  const searchArtistRow = (artist: LibraryArtist): HTMLElement => {
    const row = document.createElement("article");
    const unavailable = artist.availableTrackCount === 0;
    row.className = `library-search-result${unavailable ? " library-item--unavailable" : ""}`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "library-search-result__main";
    open.setAttribute(
      "aria-label",
      unavailable ? `${artist.name}, ${t("library.unavailable")}` : artist.name,
    );
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = artist.name;
    const counts = document.createElement("small");
    counts.textContent = `${String(artist.albumCount)} ${t("library.albums").toLocaleLowerCase()} · ${availabilityText(artist.trackCount, artist.availableTrackCount)}`;
    copy.append(name, counts);
    if (unavailable) {
      const label = document.createElement("span");
      label.className = "library-unavailable-label";
      label.textContent = t("library.unavailable");
      copy.append(label);
    }
    open.append(copy);
    open.insertAdjacentHTML("beforeend", icon("chevronRight"));
    open.addEventListener("click", () => {
      const category = search.activeCategoryView;
      search.scrollPositions[category ?? "grouped"] =
        section.parentElement?.scrollTop ?? 0;
      restoreFocus = open;
      route = { kind: "artist", id: artist.id };
      void renderRoute();
    });
    const more = document.createElement("button");
    more.type = "button";
    more.className = "library-item-more";
    more.disabled = unavailable;
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute(
      "aria-label",
      message("library.moreActions", { name: artist.name }),
    );
    more.innerHTML = icon("more");
    more.addEventListener("click", () => {
      showMenu(more, [
        {
          label: t("library.playArtist"),
          disabled: unavailable,
          run: () => void play({ context: "artist", id: artist.id }),
        },
        {
          label: t("library.addArtist"),
          disabled: unavailable,
          run: () =>
            void queueContext(
              { context: "artist", id: artist.id },
              t("library.artistAdded"),
            ),
        },
      ]);
    });
    row.append(open, more);
    return row;
  };

  const searchAlbumRow = (album: LibrarySearchAlbum): HTMLElement => {
    const row = document.createElement("article");
    const unavailable = album.availableTrackCount === 0;
    row.className = `library-search-result${unavailable ? " library-item--unavailable" : ""}`;
    const open = document.createElement("button");
    open.type = "button";
    open.className =
      "library-search-result__main library-search-result__main--album";
    open.setAttribute(
      "aria-label",
      message("library.openAlbum", { title: album.title }),
    );
    open.append(
      artwork(options.api, album.artworkTrackId, "library-search-art"),
    );
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = album.title;
    const metadata = document.createElement("small");
    metadata.textContent = [album.albumArtist, album.year]
      .filter((value) => value !== null && value !== "")
      .join(" · ");
    const count = document.createElement("small");
    count.textContent = availabilityText(
      album.trackCount,
      album.availableTrackCount,
    );
    copy.append(title, metadata, count);
    if (unavailable) {
      const label = document.createElement("span");
      label.className = "library-unavailable-label";
      label.textContent = t("library.unavailable");
      copy.append(label);
    }
    open.append(copy);
    open.insertAdjacentHTML("beforeend", icon("chevronRight"));
    open.addEventListener("click", () => {
      const category = search.activeCategoryView;
      search.scrollPositions[category ?? "grouped"] =
        section.parentElement?.scrollTop ?? 0;
      restoreFocus = open;
      route = { kind: "album", id: album.id };
      void renderRoute();
    });
    const more = document.createElement("button");
    more.type = "button";
    more.className = "library-item-more";
    more.disabled = unavailable;
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute(
      "aria-label",
      message("library.albumActions", { title: album.title }),
    );
    more.innerHTML = icon("more");
    more.addEventListener("click", () => {
      showMenu(more, [
        {
          label: t("library.playAlbum"),
          disabled: unavailable,
          run: () => void play({ context: "album", id: album.id }),
        },
        {
          label: t("library.addAlbum"),
          disabled: unavailable,
          run: () =>
            void queueContext(
              { context: "album", id: album.id },
              t("library.albumAdded"),
            ),
        },
      ]);
    });
    row.append(open, more);
    return row;
  };

  const renderSearchMessage = (text: string, retry?: () => void): void => {
    const state = document.createElement("div");
    state.className = "library-browser-state library-search-state";
    const copy = document.createElement("p");
    copy.textContent = text;
    state.append(copy);
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t("library.searchRetry");
      button.addEventListener("click", retry);
      state.append(button);
    }
    browser.replaceChildren(state);
  };

  const renderSearch = (): void => {
    setSearchHeader();
    section.dataset.searchActive = "true";
    if (normalizedInputLength(search.query) === 0) {
      renderSearchMessage(t("library.searchInitial"));
      return;
    }
    if (normalizedInputLength(search.query) < 2) {
      renderSearchMessage(t("library.searchMinimum"));
      return;
    }
    if (search.error) {
      renderSearchMessage(search.error, () => {
        if (search.activeCategoryView)
          void loadSearchCategory(search.activeCategoryView, false);
        else void executeGroupedSearch();
      });
      return;
    }
    if (search.activeCategoryView) {
      const category = search.activeCategoryView;
      const page = search.categoryPages[category];
      if (!page.loaded && page.loading) {
        renderSearchMessage(t("library.loading"));
        return;
      }
      const fragment = document.createDocumentFragment();
      const header = document.createElement("header");
      header.className = "library-search-category-header";
      const back = document.createElement("button");
      back.type = "button";
      back.className = "folders-back";
      back.innerHTML = `${icon("back")}<span>${t("common.back")}</span>`;
      back.addEventListener("click", () => {
        search.scrollPositions[category] =
          section.parentElement?.scrollTop ?? 0;
        search.activeCategoryView = null;
        persistSearchSession();
        renderSearch();
        if (section.parentElement)
          section.parentElement.scrollTop = search.scrollPositions.grouped;
      });
      const title = document.createElement("h2");
      title.textContent = t(
        category === "artists"
          ? "library.searchAllArtists"
          : category === "albums"
            ? "library.searchAllAlbums"
            : "library.searchAllTracks",
      );
      const count = document.createElement("span");
      count.textContent = message("library.searchCount", {
        count: String(page.total),
      });
      header.append(back, title, count);
      fragment.append(header);
      const list = document.createElement("div");
      list.className = "library-search-list";
      if (category === "artists")
        for (const artist of search.categoryPages.artists.items)
          list.append(searchArtistRow(artist));
      else if (category === "albums")
        for (const album of search.categoryPages.albums.items)
          list.append(searchAlbumRow(album));
      else
        for (const track of search.categoryPages.tracks.items)
          list.append(
            trackRow(track, () => void playSearchTrack(track.id), true),
          );
      fragment.append(list);
      fragment.append(
        moreButton(Boolean(page.cursor), page.loading, () => {
          void loadSearchCategory(category, true);
        }),
      );
      browser.replaceChildren(fragment);
      return;
    }
    const results = search.groupedResults;
    if (!results) {
      renderSearchMessage(t("library.loading"));
      return;
    }
    const total =
      results.artists.total + results.albums.total + results.tracks.total;
    if (total === 0) {
      renderSearchMessage(
        message("library.searchNoResults", { query: search.query.trim() }),
      );
      return;
    }
    const fragment = document.createDocumentFragment();
    const appendGroup = (
      category: LibrarySearchCategory,
      total: number,
      nodes: readonly HTMLElement[],
    ): void => {
      if (total === 0) return;
      const group = document.createElement("section");
      group.className = "library-search-section";
      group.append(
        searchSectionHeader(category, total, nodes.length),
        ...nodes,
      );
      fragment.append(group);
    };
    appendGroup(
      "artists",
      results.artists.total,
      results.artists.items.map(searchArtistRow),
    );
    appendGroup(
      "albums",
      results.albums.total,
      results.albums.items.map(searchAlbumRow),
    );
    appendGroup(
      "tracks",
      results.tracks.total,
      results.tracks.items.map((track) =>
        trackRow(track, () => void playSearchTrack(track.id), true),
      ),
    );
    browser.replaceChildren(fragment);
  };

  const executeGroupedSearch = async (): Promise<void> => {
    const query = search.query.trim().replace(/\s+/gu, " ");
    if (normalizedInputLength(query) < 2) return;
    groupedSearchController?.abort();
    const controller = new AbortController();
    groupedSearchController = controller;
    const sequence = ++search.requestSequence;
    search.loading = true;
    search.error = null;
    renderSearch();
    try {
      const results = await options.api.search(query, controller.signal);
      if (destroyed || sequence !== search.requestSequence) return;
      search.groupedResults = results;
      search.normalizedQuery = results.normalizedQuery;
      search.activeCategoryView = null;
      search.categoryPages = {
        artists: emptySearchPage(),
        albums: emptySearchPage(),
        tracks: emptySearchPage(),
      };
      searchStatus.textContent =
        results.artists.total + results.albums.total + results.tracks.total > 0
          ? t("library.searchResults")
          : message("library.searchNoResults", { query: search.query.trim() });
      persistSearchSession();
    } catch (error) {
      if (
        destroyed ||
        sequence !== search.requestSequence ||
        (error instanceof Error && error.name === "AbortError")
      )
        return;
      search.error =
        error instanceof Error ? error.message : t("library.unavailableState");
      searchStatus.textContent = search.error;
    } finally {
      if (sequence === search.requestSequence) {
        search.loading = false;
        groupedSearchController = null;
        if (!destroyed && search.active) renderSearch();
      }
    }
  };

  const loadSearchCategory = async (
    category: LibrarySearchCategory,
    append: boolean,
  ): Promise<void> => {
    const page = search.categoryPages[category];
    if (page.loading || !search.normalizedQuery) return;
    categorySearchController?.abort();
    const controller = new AbortController();
    categorySearchController = controller;
    const sequence = ++search.requestSequence;
    page.loading = true;
    page.error = null;
    search.error = null;
    if (!append) {
      page.items = [];
      page.cursor = null;
      page.loaded = false;
    }
    renderSearch();
    try {
      const result = await options.api.searchCategory(
        category,
        search.normalizedQuery,
        append ? page.cursor : null,
        PAGE_SIZE,
        controller.signal,
      );
      if (destroyed || sequence !== search.requestSequence) return;
      const nextItems = append
        ? [...page.items, ...result.page.items]
        : [...result.page.items];
      const boundedItems = nextItems.slice(-MAX_RENDERED_ITEMS);
      if (category === "artists")
        search.categoryPages.artists.items = boundedItems as LibraryArtist[];
      else if (category === "albums")
        search.categoryPages.albums.items =
          boundedItems as LibrarySearchAlbum[];
      else search.categoryPages.tracks.items = boundedItems as LibraryTrack[];
      page.cursor = result.page.nextCursor;
      page.total = result.page.total;
      page.loaded = true;
      if (search.groupedResults)
        search.groupedResults = {
          ...search.groupedResults,
          normalizedQuery: result.normalizedQuery,
          catalogFingerprint: result.catalogFingerprint,
        };
      persistSearchSession();
    } catch (error) {
      if (
        destroyed ||
        sequence !== search.requestSequence ||
        (error instanceof Error && error.name === "AbortError")
      )
        return;
      search.error =
        error instanceof Error ? error.message : t("library.unavailableState");
      searchStatus.textContent = search.error;
    } finally {
      if (sequence === search.requestSequence) {
        page.loading = false;
        categorySearchController = null;
        if (!destroyed && search.active) renderSearch();
      }
    }
  };

  const openSearch = (): void => {
    if (search.active) return;
    search.previousLibraryState = {
      segment,
      albumView,
      scrollTop: section.parentElement?.scrollTop ?? 0,
    };
    search.active = true;
    search.query = "";
    search.normalizedQuery = "";
    search.error = null;
    search.groupedResults = null;
    search.activeCategoryView = null;
    persistSearchSession();
    renderRoot();
    queueMicrotask(() => {
      searchInput.focus();
    });
  };

  const closeSearch = (): void => {
    const previous = search.previousLibraryState;
    cancelSearchRequests();
    search.active = false;
    search.query = "";
    search.normalizedQuery = "";
    search.groupedResults = null;
    search.activeCategoryView = null;
    search.error = null;
    librarySearchSession = null;
    if (previous) {
      segment = previous.segment;
      albumView = previous.albumView;
    }
    renderRoot();
    if (previous && section.parentElement)
      section.parentElement.scrollTop = previous.scrollTop;
    searchAction.focus();
  };

  const clearSearch = (): void => {
    cancelSearchRequests();
    search.query = "";
    search.normalizedQuery = "";
    search.loading = false;
    search.error = null;
    search.groupedResults = null;
    search.activeCategoryView = null;
    search.categoryPages = {
      artists: emptySearchPage(),
      albums: emptySearchPage(),
      tracks: emptySearchPage(),
    };
    searchInput.value = "";
    searchStatus.textContent = "";
    persistSearchSession();
    renderSearch();
    searchInput.focus();
  };

  const scheduleSearch = (): void => {
    if (searchDebounce !== null) clearTimeout(searchDebounce);
    groupedSearchController?.abort();
    search.requestSequence += 1;
    search.query = searchInput.value;
    search.error = null;
    search.activeCategoryView = null;
    searchClear.hidden = search.query.length === 0;
    if (normalizedInputLength(search.query) < 2) {
      search.groupedResults = null;
      search.loading = false;
      persistSearchSession();
      renderSearch();
      return;
    }
    searchDebounce = setTimeout(() => {
      searchDebounce = null;
      void executeGroupedSearch();
    }, SEARCH_DEBOUNCE_MILLISECONDS);
  };

  const renderRoot = (): void => {
    root.hidden = false;
    manage.hidden = true;
    detail.hidden = true;
    options.setTitle(t("screen.library.title"));
    section.dataset.librarySegment = segment;
    section.dataset.albumView = albumView;
    setSearchHeader();
    if (search.active) {
      renderSearch();
      return;
    }
    delete section.dataset.searchActive;
    viewControls.replaceChildren();
    const noSources = snapshot?.summary.sourceCount === 0;
    const noAudio =
      !noSources &&
      snapshot?.summary.trackCount === 0 &&
      snapshot.sources.some((item) => item.firstScanCompleted);
    if (noSources || noAudio) {
      const state = document.createElement("div");
      state.className = "library-browser-state";
      const copy = document.createElement("p");
      copy.textContent = t(noSources ? "library.noSources" : "library.noAudio");
      state.append(copy);
      if (noSources) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = t("library.openSources");
        button.addEventListener("click", options.openSources);
        state.append(button);
      }
      browser.replaceChildren(state);
      return;
    }
    if (segment === "albums") {
      const group = document.createElement("div");
      group.className = "folders-view-controls";
      group.setAttribute("aria-label", t("library.albumView"));
      for (const mode of ["list", "grid"] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.classList.toggle("is-active", albumView === mode);
        button.setAttribute("aria-pressed", String(albumView === mode));
        button.setAttribute(
          "aria-label",
          t(mode === "list" ? "folders.listView" : "folders.gridView"),
        );
        button.innerHTML = icon(mode);
        button.addEventListener("click", () => {
          albumView = mode;
          saveLibraryAlbumViewMode(mode);
          renderRoot();
        });
        group.append(button);
      }
      viewControls.append(group);
    }
    const page = pages[segment];
    if (!page.loaded && !page.loading) {
      void loadPage(segment, false);
      const loading = document.createElement("p");
      loading.className = "library-browser-state";
      loading.textContent = t("library.loading");
      browser.replaceChildren(loading);
      return;
    }
    if (page.error) {
      renderError(page.error, () => void loadPage(segment, false));
      return;
    }
    const fragment = document.createDocumentFragment();
    if (page.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "library-browser-state";
      empty.textContent = t(`library.empty.${segment}`);
      fragment.append(empty);
    } else if (segment === "albums") {
      const collection = document.createElement("div");
      collection.className = "library-album-collection";
      for (const item of pages.albums.items) collection.append(albumItem(item));
      fragment.append(collection);
    } else if (segment === "artists") {
      const list = document.createElement("div");
      list.className = "library-artist-list";
      for (const item of pages.artists.items) {
        const button = document.createElement("button");
        button.className = `library-artist-row${item.availability === "unavailable" ? " library-item--unavailable" : ""}`;
        button.type = "button";
        const copy = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = item.name;
        const counts = document.createElement("small");
        counts.textContent = `${String(item.albumCount)} ${t("library.albums").toLocaleLowerCase()} · ${availabilityText(item.trackCount, item.availableTrackCount)}`;
        copy.append(name, counts);
        button.append(copy);
        button.insertAdjacentHTML("beforeend", icon("chevronRight"));
        button.addEventListener("click", () => {
          restoreFocus = button;
          rootScrollTop = section.parentElement?.scrollTop ?? 0;
          route = { kind: "artist", id: item.id };
          void renderRoute();
        });
        list.append(button);
      }
      fragment.append(list);
    } else {
      const list = document.createElement("div");
      list.className = "library-track-list";
      for (const item of pages.tracks.items)
        list.append(
          trackRow(
            item,
            () => void play({ context: "tracks", selectedTrackId: item.id }),
          ),
        );
      fragment.append(list);
    }
    fragment.append(
      moreButton(Boolean(page.cursor), page.loading, () => {
        void loadPage(segment, true);
      }),
    );
    browser.replaceChildren(fragment);
  };

  const loadPage = async (
    target: LibrarySegment,
    append: boolean,
  ): Promise<void> => {
    const page = pages[target];
    if (page.loading) return;
    page.loading = true;
    page.error = null;
    const generation = ++requestGeneration;
    try {
      const result: LibraryPage<LibraryAlbum | LibraryArtist | LibraryTrack> =
        target === "albums"
          ? await options.api.albums(append ? page.cursor : null, PAGE_SIZE)
          : target === "artists"
            ? await options.api.artists(append ? page.cursor : null, PAGE_SIZE)
            : await options.api.tracks(append ? page.cursor : null, PAGE_SIZE);
      if (destroyed || generation !== requestGeneration) return;
      const items = append
        ? [...page.items, ...result.items]
        : [...result.items];
      const bounded = items.slice(-MAX_RENDERED_ITEMS);
      if (target === "albums") pages.albums.items = bounded as LibraryAlbum[];
      else if (target === "artists")
        pages.artists.items = bounded as LibraryArtist[];
      else pages.tracks.items = bounded as LibraryTrack[];
      page.cursor = result.nextCursor;
      page.loaded = true;
    } catch (error) {
      if (destroyed || generation !== requestGeneration) return;
      page.error =
        error instanceof Error ? error.message : t("library.unavailableState");
    } finally {
      page.loading = false;
      if (!destroyed && route.kind === "root" && target === segment)
        renderRoot();
    }
  };

  const detailHeader = (
    title: string,
    playLabel: string,
    playAction: () => void,
    menuAction: (trigger: HTMLButtonElement) => void,
    playable: boolean,
  ): HTMLElement => {
    const header = document.createElement("header");
    header.className = "library-detail-header";
    header.setAttribute("aria-label", title);
    const back = document.createElement("button");
    back.className = "folders-back";
    back.type = "button";
    back.innerHTML = `${icon("back")}<span>${t("common.back")}</span>`;
    back.addEventListener("click", () => {
      const fromArtist = route.kind === "album" ? route.fromArtist : undefined;
      if (fromArtist) route = { kind: "artist", id: fromArtist };
      else route = { kind: "root" };
      void renderRoute().then(() => {
        if (section.parentElement) {
          const searchScroll = search.active
            ? search.scrollPositions[search.activeCategoryView ?? "grouped"]
            : rootScrollTop;
          section.parentElement.scrollTop = fromArtist
            ? artistScrollTop
            : searchScroll;
        }
        restoreFocus?.focus();
      });
    });
    const spacer = document.createElement("span");
    spacer.className = "library-detail-header__spacer";
    spacer.setAttribute("aria-hidden", "true");
    const actions = document.createElement("div");
    actions.className = "library-detail-actions";
    const playButton = document.createElement("button");
    playButton.className = "primary-action";
    playButton.type = "button";
    playButton.disabled = !playable;
    playButton.innerHTML = `${icon("play")}<span>${playLabel}</span>`;
    playButton.addEventListener("click", playAction);
    const more = document.createElement("button");
    more.className = "library-item-more";
    more.type = "button";
    more.disabled = !playable;
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-label", t("library.moreActions"));
    more.innerHTML = icon("more");
    more.addEventListener("click", () => {
      menuAction(more);
    });
    actions.append(playButton, more);
    header.append(back, spacer, actions);
    return header;
  };

  const renderAlbumDetail = (album: LibraryAlbumDetail): void => {
    options.setTitle(album.title);
    const content = document.createDocumentFragment();
    content.append(
      detailHeader(
        album.title,
        t("library.play"),
        () => void play({ context: "album", id: album.id }),
        (trigger) => {
          showMenu(trigger, [
            {
              label: t("library.addAlbum"),
              run: () =>
                void queueContext(
                  { context: "album", id: album.id },
                  t("library.albumAdded"),
                ),
            },
          ]);
        },
        album.availableTrackCount > 0,
      ),
    );
    const hero = document.createElement("section");
    hero.className = "library-album-detail-hero";
    hero.append(
      artwork(options.api, album.artworkTrackId, "library-detail-art"),
    );
    const metadata = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = album.title;
    const artist = document.createElement("span");
    artist.textContent = album.albumArtist ?? t("library.unknownArtist");
    const facts = document.createElement("span");
    facts.textContent = [
      album.year,
      availabilityText(album.trackCount, album.availableTrackCount),
      formatDuration(album.totalDurationSeconds),
    ]
      .filter((value) => value !== null)
      .join(" · ");
    metadata.append(title, artist, facts);
    hero.append(metadata);
    content.append(hero);
    const list = document.createElement("div");
    list.className = "library-track-list";
    const discs = new Set(
      album.tracks.flatMap((track) =>
        track.discNumber === null ? [] : [track.discNumber],
      ),
    );
    let lastDisc: number | null = null;
    for (const track of album.tracks) {
      if (discs.size > 1 && track.discNumber !== lastDisc) {
        const heading = document.createElement("h2");
        heading.className = "library-disc-heading";
        heading.textContent = message("library.disc", {
          number: String(track.discNumber ?? 1),
        });
        list.append(heading);
        lastDisc = track.discNumber;
      }
      list.append(
        trackRow(
          track,
          () =>
            void play({
              context: "album",
              id: album.id,
              selectedTrackId: track.id,
            }),
        ),
      );
    }
    content.append(list);
    detail.replaceChildren(content);
  };

  const renderArtistDetail = (artist: LibraryArtistDetail): void => {
    activeArtistDetail = artist;
    options.setTitle(artist.name);
    const content = document.createDocumentFragment();
    content.append(
      detailHeader(
        artist.name,
        t("library.playAll"),
        () => void play({ context: "artist", id: artist.id }),
        (trigger) => {
          showMenu(trigger, [
            {
              label: t("library.addArtist"),
              run: () =>
                void queueContext(
                  { context: "artist", id: artist.id },
                  t("library.artistAdded"),
                ),
            },
          ]);
        },
        artist.availableTrackCount > 0,
      ),
    );
    const summary = document.createElement("p");
    summary.className = "library-artist-summary";
    summary.textContent = `${String(artist.albumCount)} ${t("library.albums").toLocaleLowerCase()} · ${availabilityText(artist.trackCount, artist.availableTrackCount)}`;
    content.append(summary);
    if (artist.albums.length > 0) {
      const heading = document.createElement("h2");
      heading.className = "library-section-heading";
      heading.textContent = t("library.albums");
      const albums = document.createElement("div");
      albums.className =
        "library-album-collection library-album-collection--artist";
      for (const album of artist.albums)
        albums.append(albumItem(album, artist.id));
      content.append(heading, albums);
    }
    const tracksHeading = document.createElement("h2");
    tracksHeading.className = "library-section-heading";
    tracksHeading.textContent = t("library.tracks");
    const tracks = document.createElement("div");
    tracks.className = "library-track-list";
    for (const track of artist.tracks.items)
      tracks.append(
        trackRow(
          track,
          () =>
            void play({
              context: "artist",
              id: artist.id,
              selectedTrackId: track.id,
            }),
        ),
      );
    content.append(tracksHeading, tracks);
    content.append(
      moreButton(Boolean(artist.tracks.nextCursor), false, () => {
        const current = activeArtistDetail;
        if (!current?.tracks.nextCursor) return;
        void options.api
          .artist(current.id, current.tracks.nextCursor, 100)
          .then((next) => {
            if (destroyed || route.kind !== "artist" || route.id !== current.id)
              return;
            renderArtistDetail({
              ...current,
              tracks: {
                items: [...current.tracks.items, ...next.tracks.items].slice(
                  -MAX_RENDERED_ITEMS,
                ),
                nextCursor: next.tracks.nextCursor,
              },
            });
          })
          .catch((error: unknown) => {
            options.showToast(
              error instanceof Error
                ? error.message
                : t("library.unavailableState"),
              "error",
            );
          });
      }),
    );
    detail.replaceChildren(content);
  };

  async function renderRoute(): Promise<void> {
    closeMenu();
    if (route.kind === "root") {
      renderRoot();
      return;
    }
    if (route.kind === "manage") {
      renderManage();
      return;
    }
    rootRegion.hidden = true;
    manage.hidden = true;
    detailRegion.hidden = false;
    if (section.parentElement) section.parentElement.scrollTop = 0;
    detailRegion.setAttribute("aria-busy", "true");
    const generation = ++requestGeneration;
    try {
      if (route.kind === "album") {
        const album = await options.api.album(route.id);
        if (destroyed || generation !== requestGeneration) return;
        renderAlbumDetail(album);
      } else {
        const artist = await options.api.artist(route.id, null, 100);
        if (destroyed || generation !== requestGeneration) return;
        renderArtistDetail(artist);
      }
    } catch (error) {
      if (destroyed || generation !== requestGeneration) return;
      options.showToast(
        error instanceof Error ? error.message : t("library.unavailableState"),
        "error",
      );
      route = { kind: "root" };
      renderRoot();
    } finally {
      detailRegion.removeAttribute("aria-busy");
    }
  }

  const renderSnapshot = (next: IndexedLibrarySnapshot): void => {
    if (destroyed) return;
    const previousCompletion = completedGeneration;
    snapshot = next;
    activeScan = next.status.activeScan;
    const values = {
      tracks: next.summary.trackCount,
      albums: next.summary.albumCount,
      artists: next.summary.artistCount,
      unavailable: next.summary.unavailableTrackCount,
    };
    for (const [key, value] of Object.entries(values)) {
      const element = counts.get(key);
      if (element && element.textContent !== String(value))
        element.textContent = String(value);
    }
    const queued =
      activeScan === null && next.status.queuedSourceIds.length > 0;
    const scan = activeScan ?? next.status.latestScan;
    const busy =
      queued || scan?.status === "scanning" || scan?.status === "cancelling";
    for (const button of [manageScanAction]) {
      button.textContent = t(busy ? "library.cancel" : "library.rescan");
      button.dataset.action = busy ? "cancel" : "rescan";
      button.disabled = scanPending || next.summary.sourceCount === 0 || queued;
    }
    const displayScan = queued ? null : scan;
    const queuedSource = queued
      ? next.sources.find(
          (item) => item.sourceId === next.status.queuedSourceIds[0],
        )
      : null;
    source.textContent =
      queuedSource?.displayName ?? displayScan?.sourceName ?? t("library.idle");
    status.textContent = queued
      ? t("library.status.queued")
      : scan
        ? scanStatusLabel(scan.status)
        : t("library.idle");
    if (displayScan?.totalFiles) {
      progress.max = Math.max(1, displayScan.totalFiles);
      progress.value = Math.min(displayScan.filesProcessed, progress.max);
    } else progress.removeAttribute("value");
    const statValues = {
      discovered: displayScan?.filesDiscovered ?? 0,
      processed: displayScan?.filesProcessed ?? 0,
      new: displayScan?.filesNew ?? 0,
      modified: displayScan?.filesModified ?? 0,
      unchanged: displayScan?.filesUnchanged ?? 0,
      unavailable: displayScan?.filesUnavailable ?? 0,
      errors: displayScan?.filesFailed ?? 0,
      elapsed: formatElapsed(displayScan?.elapsedMilliseconds ?? 0),
    };
    for (const [key, value] of Object.entries(statValues)) {
      const element = scanStats.get(key);
      if (element && element.textContent !== String(value))
        element.textContent = String(value);
    }
    lastScan.textContent = next.summary.lastSuccessfulScan
      ? `${t("library.lastScan")} ${formatDate(next.summary.lastSuccessfulScan)}`
      : `${t("library.lastScan")} —`;
    renderSourcesOverview();
    completedGeneration =
      next.status.latestScan?.status === "completed"
        ? `${next.status.latestScan.sourceId}:${String(next.status.latestScan.generation)}`
        : previousCompletion;
    if (
      snapshotInitialized &&
      completedGeneration !== "" &&
      completedGeneration !== previousCompletion
    ) {
      pages.albums = emptyPage();
      pages.artists = emptyPage();
      pages.tracks = emptyPage();
      if (search.active && normalizedInputLength(search.query) >= 2) {
        const category = search.activeCategoryView;
        void executeGroupedSearch().then(() => {
          if (destroyed || !search.active || !category) return;
          search.activeCategoryView = category;
          void loadSearchCategory(category, false);
        });
      } else void renderRoute();
    }
    snapshotInitialized = true;
  };

  const segments = createSegmentedControl<LibrarySegment>({
    label: t("library.browse"),
    value: segment,
    items: [
      { value: "albums", label: t("library.albums") },
      { value: "artists", label: t("library.artists") },
      { value: "tracks", label: t("library.tracks") },
    ],
    onChange(value) {
      segment = value;
      saveLibrarySegment(value);
      requestGeneration += 1;
      renderRoot();
    },
  });
  segmentsHost.append(segments.element);

  const runScanAction = (action: HTMLButtonElement): void => {
    if (scanPending) return;
    scanPending = true;
    manageScanAction.disabled = true;
    void (
      action.dataset.action === "cancel"
        ? options.api.cancel(activeScan ? { scanId: activeScan.scanId } : {})
        : options.api.scan()
    )
      .then(renderSnapshot)
      .catch((error: unknown) => {
        options.showToast(
          error instanceof Error ? error.message : t("library.actionFailed"),
          "error",
        );
      })
      .finally(() => {
        scanPending = false;
        if (snapshot) renderSnapshot(snapshot);
      });
  };
  manageScanAction.addEventListener("click", () => {
    runScanAction(manageScanAction);
  });
  manageAction.addEventListener("click", () => {
    rootScrollTop = section.parentElement?.scrollTop ?? 0;
    manageReturnRoute = { kind: "root" };
    manageReturnScrollTop = rootScrollTop;
    route = { kind: "manage" };
    if (section.parentElement)
      section.parentElement.scrollTop = manageScrollTop;
    void renderRoute();
  });
  manageBack.addEventListener("click", () => {
    manageScrollTop = section.parentElement?.scrollTop ?? 0;
    route = manageReturnRoute;
    void renderRoute().then(() => {
      if (section.parentElement)
        section.parentElement.scrollTop = manageReturnScrollTop;
      if (route.kind === "root") manageAction.focus();
    });
  });
  openSources.addEventListener("click", options.openSources);
  searchAction.addEventListener("click", openSearch);
  searchClose.addEventListener("click", closeSearch);
  searchClear.addEventListener("click", clearSearch);
  searchInput.addEventListener("input", scheduleSearch);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (searchDebounce !== null) {
        clearTimeout(searchDebounce);
        searchDebounce = null;
      }
      if (normalizedInputLength(search.query) >= 2) void executeGroupedSearch();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  });
  const handleOutsideMenu = (event: PointerEvent): void => {
    if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu();
  };
  document.addEventListener("pointerdown", handleOutsideMenu);
  section.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      closeMenu(true);
    } else if (
      event.key === "Escape" &&
      search.active &&
      event.target !== searchInput
    ) {
      event.preventDefault();
      closeSearch();
    }
  });

  if (snapshot) renderSnapshot(snapshot);
  void renderRoute();

  return {
    element: section,
    updateLibrarySnapshot: renderSnapshot,
    destroy() {
      destroyed = true;
      requestGeneration += 1;
      persistSearchSession();
      cancelSearchRequests();
      document.removeEventListener("pointerdown", handleOutsideMenu);
      closeMenu();
      options.setTitle(t("screen.library.title"));
    },
  };
}
