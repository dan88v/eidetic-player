import type {
  FavoriteAlbum,
  FavoriteArtist,
  FavoriteTrack,
  LibraryContextRequest,
} from "../../../../packages/shared/src/library";
import type { LibraryApiClient } from "../api/library-api-client";
import { createSegmentedControl } from "../components/segmented-control";
import {
  createFavoriteEntityButton,
  createFavoriteTrackButton,
} from "../components/favorite-track-button";
import { icon } from "../components/icons";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";
import type {
  FavoriteAlbumStore,
  FavoriteArtistStore,
  FavoriteEntityStore,
  FavoriteTrackStore,
} from "../state/favorite-track-store";
import type { FavoriteSegment, LibraryAlbumViewMode } from "../state/types";
import {
  loadFavoriteAlbumViewMode,
  loadFavoriteSegment,
  saveFavoriteAlbumViewMode,
  saveFavoriteSegment,
} from "../utils/storage";

const PAGE_SIZE = 48;
const MAX_RENDERED_ITEMS = 192;
const scrollBySegment: Record<FavoriteSegment, number> = {
  tracks: 0,
  albums: 0,
  artists: 0,
};

interface PageState<T> {
  items: T[];
  cursor: string | null;
  total: number;
  availableCount: number;
  loaded: boolean;
  loading: boolean;
}

function emptyPage<T>(): PageState<T> {
  return {
    items: [],
    cursor: null,
    total: 0,
    availableCount: 0,
    loaded: false,
    loading: false,
  };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

function availabilityText(total: number, available: number): string {
  return available === total
    ? `${String(total)} tracks`
    : `${String(available)} of ${String(total)} tracks available`;
}

export function createFavoritesScreen(options: {
  readonly api: LibraryApiClient;
  readonly favorites: FavoriteTrackStore;
  readonly favoriteAlbums: FavoriteAlbumStore;
  readonly favoriteArtists: FavoriteArtistStore;
  readonly noteTrackCommand: () => void;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
  readonly openPlaylistPicker: (
    trackIds: readonly string[],
    trigger?: HTMLElement,
  ) => void;
  readonly openLibraryEntity: (kind: "album" | "artist", id: string) => void;
}): ComponentView {
  const section = document.createElement("section");
  section.className = "screen favorites-screen";
  section.setAttribute("aria-label", t("screen.favorites.title"));
  section.innerHTML = `
    <header class="favorites-header">
      <span class="screen-header__description">${t("screen.favorites.description")}</span>
      <div class="favorites-header__actions">
        <div class="favorites-segments"></div>
        <button class="primary-action favorites-play-all" type="button" disabled>${icon("play")}<span>${t("favorites.playAll")}</span></button>
      </div>
    </header>
    <div class="favorites-category-toolbar">
      <div class="favorites-view-controls"></div>
    </div>
    <div class="favorites-content" aria-live="polite"></div>
    <div class="folders-action-menu library-action-menu" role="menu" hidden></div>`;
  const content = section.querySelector<HTMLElement>(".favorites-content");
  const segmentHost = section.querySelector<HTMLElement>(".favorites-segments");
  const viewControls = section.querySelector<HTMLElement>(
    ".favorites-view-controls",
  );
  const playAll = section.querySelector<HTMLButtonElement>(
    ".favorites-play-all",
  );
  const menu = section.querySelector<HTMLElement>(".library-action-menu");
  if (!content || !segmentHost || !viewControls || !playAll || !menu)
    throw new Error("Favorites screen is incomplete");
  const favoritesContent = content;
  const playAllButton = playAll;

  const pages = {
    tracks: emptyPage<FavoriteTrack>(),
    albums: emptyPage<FavoriteAlbum>(),
    artists: emptyPage<FavoriteArtist>(),
  };
  let segment = loadFavoriteSegment();
  let albumView: LibraryAlbumViewMode = loadFavoriteAlbumViewMode();
  let destroyed = false;
  let generation = 0;
  const heartViews = new Set<{ destroy(): void }>();

  const errorToast = (error: unknown): void => {
    options.showToast(
      error instanceof Error ? error.message : t("library.actionFailed"),
      "error",
    );
  };
  const clearHearts = (): void => {
    for (const heart of heartViews) heart.destroy();
    heartViews.clear();
  };
  const closeMenu = (): void => {
    menu.hidden = true;
    menu.replaceChildren();
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
  const artwork = (trackId: string | null, className: string): HTMLElement => {
    const surface = document.createElement("span");
    surface.className = `${className} library-artwork`;
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
  const removeVisible = (target: FavoriteSegment, id: string): void => {
    const page = pages[target];
    const index = page.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    const [removed] = page.items.splice(index, 1);
    page.total = Math.max(0, page.total - 1);
    const removedWasAvailable =
      removed !== undefined &&
      (target === "tracks"
        ? (removed as FavoriteTrack).availability === "available"
        : (removed as FavoriteAlbum | FavoriteArtist).availableTrackCount > 0);
    if (removedWasAvailable)
      page.availableCount = Math.max(0, page.availableCount - 1);
    if (target === segment) render();
  };
  const setEntityFromMenu = async (
    target: "albums" | "artists",
    store: FavoriteEntityStore,
    id: string,
    isFavorite: boolean,
  ): Promise<void> => {
    try {
      await store.set(id, isFavorite);
      if (!isFavorite) removeVisible(target, id);
      options.showToast(
        t(isFavorite ? "favorites.added" : "favorites.removed"),
        "success",
      );
    } catch (error) {
      errorToast(error);
    }
  };
  const playContext = async (request: LibraryContextRequest): Promise<void> => {
    options.noteTrackCommand();
    try {
      await options.api.play(request);
    } catch (error) {
      errorToast(error);
    }
  };
  const queueContext = async (
    request: LibraryContextRequest,
    success: string,
  ): Promise<void> => {
    try {
      const result = await options.api.queue(request);
      options.showToast(
        result.appendedCount > 0 ? success : t("library.alreadyQueued"),
        "neutral",
      );
    } catch (error) {
      errorToast(error);
    }
  };
  const playTrackFavorites = async (
    selectedTrackId?: string,
  ): Promise<void> => {
    options.noteTrackCommand();
    try {
      await options.api.playFavorites(
        selectedTrackId ? { selectedTrackId } : {},
      );
    } catch (error) {
      errorToast(error);
      void load("tracks", false);
    }
  };
  const playAllCategory = async (): Promise<void> => {
    options.noteTrackCommand();
    try {
      if (segment === "tracks") await options.api.playFavorites();
      else if (segment === "albums") await options.api.playFavoriteAlbums();
      else await options.api.playFavoriteArtists();
    } catch (error) {
      errorToast(error);
      void load(segment, false);
    }
  };

  const trackRow = (track: FavoriteTrack): HTMLElement => {
    const unavailable = track.availability === "unavailable";
    const row = document.createElement("article");
    row.className = `library-track-row${unavailable ? " library-item--unavailable" : ""}`;
    row.dataset.trackId = track.id;
    const main = document.createElement("button");
    main.type = "button";
    main.className = "library-track-row__main";
    main.disabled = unavailable;
    main.setAttribute("aria-label", `${t("library.play")} ${track.title}`);
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
    const art = artwork(track.artworkTrackId, "library-track-art");
    main.append(art, number, copy, duration);
    if (unavailable) {
      const label = document.createElement("span");
      label.className = "library-unavailable-label";
      label.textContent = t("library.unavailable");
      main.append(label);
    }
    main.addEventListener("click", () => void playTrackFavorites(track.id));
    const heart = createFavoriteTrackButton({
      trackId: track.id,
      store: options.favorites,
      onError: errorToast,
      onChange: (isFavorite) => {
        if (!isFavorite) removeVisible("tracks", track.id);
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
      showMenu(more, [
        {
          label: t("library.play"),
          disabled: unavailable,
          run: () => void playTrackFavorites(track.id),
        },
        {
          label: t("folders.addToQueue"),
          disabled: unavailable,
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
          label: t("common.addToPlaylist"),
          run: () => {
            options.openPlaylistPicker([track.id], more);
          },
        },
        {
          label: t("favorites.remove"),
          run: () =>
            void options.favorites
              .set(track.id, false)
              .then(() => {
                removeVisible("tracks", track.id);
                options.showToast(t("favorites.removed"), "success");
              })
              .catch(errorToast),
        },
      ]);
    });
    row.append(main, heart.element, more);
    return row;
  };

  const albumItem = (album: FavoriteAlbum): HTMLElement => {
    const unavailable = album.availableTrackCount === 0;
    const card = document.createElement("article");
    card.className = `library-album-card${unavailable ? " library-item--unavailable" : ""}`;
    card.dataset.albumId = album.id;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "library-album-card__open";
    open.setAttribute("aria-label", `${t("library.openAlbum")} ${album.title}`);
    open.append(artwork(album.artworkTrackId, "library-album-art"));
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
    open.addEventListener("click", () => {
      options.openLibraryEntity("album", album.id);
    });
    const heart = createFavoriteEntityButton({
      entityId: album.id,
      store: options.favoriteAlbums,
      onError: errorToast,
      onChange: (isFavorite) => {
        if (!isFavorite) removeVisible("albums", album.id);
      },
    });
    heartViews.add(heart);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "library-item-more";
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute(
      "aria-label",
      `${t("library.moreActions")} ${album.title}`,
    );
    more.innerHTML = icon("more");
    more.addEventListener("click", () => {
      showMenu(more, [
        {
          label: t("library.playAlbum"),
          disabled: unavailable,
          run: () => void playContext({ context: "album", id: album.id }),
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
        {
          label: t("favorites.removeAlbum"),
          run: () =>
            void setEntityFromMenu(
              "albums",
              options.favoriteAlbums,
              album.id,
              false,
            ),
        },
      ]);
    });
    card.append(open, heart.element, more);
    return card;
  };

  const artistRow = (artist: FavoriteArtist): HTMLElement => {
    const unavailable = artist.availableTrackCount === 0;
    const row = document.createElement("article");
    row.className = `library-artist-row${unavailable ? " library-item--unavailable" : ""}`;
    row.dataset.artistId = artist.id;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "library-artist-row__main";
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = artist.name;
    const counts = document.createElement("small");
    counts.textContent = `${String(artist.albumCount)} albums · ${availabilityText(artist.trackCount, artist.availableTrackCount)}`;
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
      options.openLibraryEntity("artist", artist.id);
    });
    const heart = createFavoriteEntityButton({
      entityId: artist.id,
      store: options.favoriteArtists,
      onError: errorToast,
      onChange: (isFavorite) => {
        if (!isFavorite) removeVisible("artists", artist.id);
      },
    });
    heartViews.add(heart);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "library-item-more";
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute(
      "aria-label",
      `${t("library.moreActions")} ${artist.name}`,
    );
    more.innerHTML = icon("more");
    more.addEventListener("click", () => {
      showMenu(more, [
        {
          label: t("library.playArtist"),
          disabled: unavailable,
          run: () => void playContext({ context: "artist", id: artist.id }),
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
        {
          label: t("favorites.removeArtist"),
          run: () =>
            void setEntityFromMenu(
              "artists",
              options.favoriteArtists,
              artist.id,
              false,
            ),
        },
      ]);
    });
    row.append(open, heart.element, more);
    return row;
  };

  const renderViewControls = (): void => {
    viewControls.replaceChildren();
    if (segment !== "albums") return;
    const group = document.createElement("div");
    group.className = "folders-view-controls";
    group.setAttribute("aria-label", t("favorites.albumView"));
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
        saveFavoriteAlbumViewMode(mode);
        render();
      });
      group.append(button);
    }
    viewControls.append(group);
  };

  function render(): void {
    clearHearts();
    closeMenu();
    section.dataset.albumView = albumView;
    renderViewControls();
    const page = pages[segment];
    playAllButton.disabled = page.availableCount === 0;
    playAllButton.setAttribute(
      "aria-label",
      t(
        segment === "tracks"
          ? "favorites.playAllTracks"
          : segment === "albums"
            ? "favorites.playAllAlbums"
            : "favorites.playAllArtists",
      ),
    );
    if (!page.loaded || page.loading) {
      favoritesContent.className = "favorites-content library-browser-state";
      favoritesContent.textContent = t("favorites.loading");
      return;
    }
    favoritesContent.className = "favorites-content";
    if (page.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "favorites-empty";
      const title = document.createElement("strong");
      title.textContent = t(
        segment === "tracks"
          ? "favorites.emptyTitle"
          : segment === "albums"
            ? "favorites.emptyAlbums"
            : "favorites.emptyArtists",
      );
      empty.append(title);
      if (segment === "tracks") {
        const copy = document.createElement("p");
        copy.textContent = t("favorites.emptyText");
        empty.append(copy);
      }
      favoritesContent.replaceChildren(empty);
      return;
    }
    const collection = document.createElement("div");
    collection.className =
      segment === "tracks"
        ? "library-track-list favorites-track-list"
        : segment === "albums"
          ? "library-album-collection favorites-album-collection"
          : "library-artist-list favorites-artist-list";
    if (segment === "tracks")
      for (const item of pages.tracks.items) collection.append(trackRow(item));
    else if (segment === "albums")
      for (const item of pages.albums.items) collection.append(albumItem(item));
    else
      for (const item of pages.artists.items)
        collection.append(artistRow(item));
    const more = document.createElement("button");
    more.type = "button";
    more.className = "library-page-sentinel";
    more.hidden = page.cursor === null;
    more.textContent = t("library.loadMore");
    more.addEventListener("click", () => void load(segment, true));
    favoritesContent.replaceChildren(collection, more);
  }

  async function load(target: FavoriteSegment, append: boolean): Promise<void> {
    const page = pages[target];
    if (page.loading) return;
    page.loading = true;
    if (target === segment) render();
    const currentGeneration = ++generation;
    try {
      const result =
        target === "tracks"
          ? await options.api.favoriteTracks(
              append ? page.cursor : null,
              PAGE_SIZE,
            )
          : target === "albums"
            ? await options.api.favoriteAlbums(
                append ? page.cursor : null,
                PAGE_SIZE,
              )
            : await options.api.favoriteArtists(
                append ? page.cursor : null,
                PAGE_SIZE,
              );
      if (destroyed || generation !== currentGeneration) return;
      if (target === "tracks") {
        pages.tracks.items = (
          append ? [...pages.tracks.items, ...result.items] : [...result.items]
        ).slice(-MAX_RENDERED_ITEMS) as FavoriteTrack[];
        options.favorites.seed(
          pages.tracks.items.map((item) => item.id),
          true,
        );
      } else if (target === "albums") {
        pages.albums.items = (
          append ? [...pages.albums.items, ...result.items] : [...result.items]
        ).slice(-MAX_RENDERED_ITEMS) as FavoriteAlbum[];
        options.favoriteAlbums.seed(
          pages.albums.items.map((item) => item.id),
          true,
        );
      } else {
        pages.artists.items = (
          append ? [...pages.artists.items, ...result.items] : [...result.items]
        ).slice(-MAX_RENDERED_ITEMS) as FavoriteArtist[];
        options.favoriteArtists.seed(
          pages.artists.items.map((item) => item.id),
          true,
        );
      }
      page.cursor = result.nextCursor;
      page.total = result.total;
      page.availableCount = result.availableCount;
      page.loaded = true;
    } catch (error) {
      if (!destroyed && generation === currentGeneration) errorToast(error);
    } finally {
      page.loading = false;
      if (!destroyed && target === segment) render();
    }
  }

  const segmented = createSegmentedControl<FavoriteSegment>({
    label: t("favorites.segmentLabel"),
    value: segment,
    items: [
      { value: "tracks", label: t("favorites.tracks") },
      { value: "albums", label: t("favorites.albums") },
      { value: "artists", label: t("favorites.artists") },
    ],
    onChange: (value) => {
      scrollBySegment[segment] = section.parentElement?.scrollTop ?? 0;
      segment = value;
      saveFavoriteSegment(value);
      render();
      const restore = (): void => {
        if (section.parentElement)
          section.parentElement.scrollTop = scrollBySegment[value];
      };
      if (!pages[value].loaded) void load(value, false).then(restore);
      else queueMicrotask(restore);
    },
  });
  segmentHost.append(segmented.element);
  playAllButton.addEventListener("click", () => void playAllCategory());
  const outsideMenu = (event: PointerEvent): void => {
    if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu();
  };
  const escapeMenu = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !menu.hidden) closeMenu();
  };
  document.addEventListener("pointerdown", outsideMenu);
  document.addEventListener("keydown", escapeMenu);
  render();
  void load(segment, false).then(() => {
    if (section.parentElement)
      section.parentElement.scrollTop = scrollBySegment[segment];
  });

  return {
    element: section,
    destroy() {
      destroyed = true;
      generation += 1;
      scrollBySegment[segment] = section.parentElement?.scrollTop ?? 0;
      document.removeEventListener("pointerdown", outsideMenu);
      document.removeEventListener("keydown", escapeMenu);
      clearHearts();
    },
  };
}
