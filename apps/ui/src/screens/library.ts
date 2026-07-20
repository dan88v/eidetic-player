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

const PAGE_SIZE = 48;
const MAX_RENDERED_ITEMS = 192;

function emptyPage<T>(): PageState<T> {
  return {
    items: [],
    cursor: null,
    loaded: false,
    loading: false,
    error: null,
  };
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
        <p class="screen-header__description">${t("screen.library.description")}</p>
        <button class="primary-action library-scan-action library-header__action" type="button">${t("library.rescan")}</button>
      </header>
      <div class="library-summary" aria-label="${t("library.summary")}">
        <article class="library-counter"><span>${t("library.tracks")}</span><strong data-library-count="tracks">0</strong></article>
        <article class="library-counter"><span>${t("library.albums")}</span><strong data-library-count="albums">0</strong></article>
        <article class="library-counter"><span>${t("library.artists")}</span><strong data-library-count="artists">0</strong></article>
        <article class="library-counter"><span>${t("library.unavailable")}</span><strong data-library-count="unavailable">0</strong></article>
      </div>
      <section class="library-scan-compact library-scan-panel" aria-live="polite">
        <div><strong data-library-field="source">${t("library.idle")}</strong><span data-library-field="status">${t("library.idle")}</span></div>
        <progress class="library-progress" aria-label="${t("library.progress")}"></progress>
        <span class="library-last-scan"></span>
      </section>
      <div class="library-browser-toolbar">
        <div class="library-segments"></div>
        <div class="library-view-controls"></div>
      </div>
      <div class="library-browser-content"></div>
    </div>
    <div class="library-detail" hidden></div>
    <div class="folders-action-menu library-action-menu" role="menu" hidden></div>`;
  const root = section.querySelector<HTMLElement>(".library-root");
  const detail = section.querySelector<HTMLElement>(".library-detail");
  const browser = section.querySelector<HTMLElement>(
    ".library-browser-content",
  );
  const viewControls = section.querySelector<HTMLElement>(
    ".library-view-controls",
  );
  const segmentsHost = section.querySelector<HTMLElement>(".library-segments");
  const menu = section.querySelector<HTMLElement>(".library-action-menu");
  const scanAction = section.querySelector<HTMLButtonElement>(
    ".library-scan-action",
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
    !detail ||
    !browser ||
    !viewControls ||
    !segmentsHost ||
    !menu ||
    !scanAction ||
    !progress ||
    !source ||
    !status ||
    !lastScan
  )
    throw new Error("Library screen is incomplete");
  const rootRegion = root;
  const detailRegion = detail;

  const counts = new Map(
    [...section.querySelectorAll<HTMLElement>("[data-library-count]")].map(
      (element) => [element.dataset.libraryCount ?? "", element],
    ),
  );
  const pages = {
    albums: emptyPage<LibraryAlbum>(),
    artists: emptyPage<LibraryArtist>(),
    tracks: emptyPage<LibraryTrack>(),
  };
  let segment: LibrarySegment = loadLibrarySegment();
  let albumView: LibraryAlbumViewMode = loadLibraryAlbumViewMode();
  let route: LibraryRoute = { kind: "root" };
  let destroyed = false;
  let requestGeneration = 0;
  let scanPending = false;
  let activeScan: LibraryScanProgress | null = null;
  let snapshot: IndexedLibrarySnapshot | null = null;
  let completedGeneration = "";
  let restoreFocus: HTMLElement | null = null;
  let activeArtistDetail: LibraryArtistDetail | null = null;
  let rootScrollTop = 0;
  let artistScrollTop = 0;

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
    context: LibraryContextRequest,
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
      void play({ ...context, selectedTrackId: track.id });
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

  const renderRoot = (): void => {
    root.hidden = false;
    detail.hidden = true;
    options.setTitle(t("screen.library.title"));
    section.dataset.librarySegment = segment;
    section.dataset.albumView = albumView;
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
        list.append(trackRow(item, { context: "tracks" }));
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
        if (section.parentElement)
          section.parentElement.scrollTop = fromArtist
            ? artistScrollTop
            : rootScrollTop;
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
      list.append(trackRow(track, { context: "album", id: album.id }));
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
      tracks.append(trackRow(track, { context: "artist", id: artist.id }));
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
    rootRegion.hidden = true;
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
    scanAction.textContent = t(busy ? "library.cancel" : "library.rescan");
    scanAction.dataset.action = busy ? "cancel" : "rescan";
    scanAction.disabled =
      scanPending || next.summary.sourceCount === 0 || queued;
    source.textContent = scan?.sourceName ?? t("library.idle");
    status.textContent = queued
      ? t("library.status.queued")
      : scan
        ? scanStatusLabel(scan.status)
        : t("library.idle");
    if (scan?.totalFiles) {
      progress.max = Math.max(1, scan.totalFiles);
      progress.value = Math.min(scan.filesProcessed, progress.max);
    } else progress.removeAttribute("value");
    lastScan.textContent = next.summary.lastSuccessfulScan
      ? `${t("library.lastScan")} ${new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(next.summary.lastSuccessfulScan))}`
      : "";
    completedGeneration =
      next.status.latestScan?.status === "completed"
        ? `${next.status.latestScan.sourceId}:${String(next.status.latestScan.generation)}`
        : previousCompletion;
    if (previousCompletion && completedGeneration !== previousCompletion) {
      pages.albums = emptyPage();
      pages.artists = emptyPage();
      pages.tracks = emptyPage();
      void renderRoute();
    }
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

  scanAction.addEventListener("click", () => {
    if (scanPending) return;
    scanPending = true;
    scanAction.disabled = true;
    void (
      scanAction.dataset.action === "cancel"
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
  });
  const handleOutsideMenu = (event: PointerEvent): void => {
    if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu();
  };
  document.addEventListener("pointerdown", handleOutsideMenu);
  section.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      closeMenu(true);
    }
  });

  const unsubscribe = options.api.subscribe(renderSnapshot, () => {
    // EventSource reconnects automatically; committed browsing state remains.
  });
  void options.api
    .snapshot()
    .then(renderSnapshot)
    .catch(() => {
      options.showToast(t("library.unavailableState"), "error");
    });
  renderRoot();

  return {
    element: section,
    destroy() {
      destroyed = true;
      requestGeneration += 1;
      unsubscribe();
      document.removeEventListener("pointerdown", handleOutsideMenu);
      closeMenu();
      options.setTitle(t("screen.library.title"));
    },
  };
}
