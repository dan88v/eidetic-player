import type {
  DirectoryBrowseResponse,
  DirectoryEntry,
  LibrarySource,
} from "../../../../packages/shared/src/library";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type { LibraryApiClient } from "../api/library-api-client";
import { createArtwork, type ArtworkView } from "../components/artwork";
import { icon } from "../components/icons";
import { formatTime } from "../components/timeline";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";
import { librarySession } from "../state/library-session";

export interface LibraryScreenOptions {
  readonly api: LibraryApiClient;
  readonly addFolder: () => Promise<unknown>;
  readonly openEntry: (sourceId: string, entryId: string) => Promise<void>;
  readonly initialPlayerState: PlayerState;
}

interface AudioRow {
  readonly entry: DirectoryEntry;
  readonly button: HTMLButtonElement;
  readonly title: HTMLElement;
  readonly artist: HTMLElement;
  readonly technical: HTMLElement;
  readonly duration: HTMLElement;
  readonly artwork: ArtworkView;
}

function sourceButton(source: LibrarySource): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "library-source";
  button.type = "button";
  button.disabled = source.availability !== "available";
  button.dataset.sourceId = source.id;
  button.innerHTML = `
    <span class="library-source__icon">${icon("folder")}</span>
    <span class="library-source__copy"><strong></strong><small></small></span>
    <span class="library-source__chevron" aria-hidden="true">›</span>`;
  const name = button.querySelector<HTMLElement>("strong");
  const status = button.querySelector<HTMLElement>("small");
  if (name) name.textContent = source.displayName;
  if (status)
    status.textContent = t(
      source.availability === "available"
        ? "sources.available"
        : "sources.unavailable",
    );
  return button;
}

export function createLibraryScreen(
  options: LibraryScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen library-screen";
  section.innerHTML = `
    <header class="library-header">
      <button class="library-back" type="button">${icon("previous")}<span>${t("library.back")}</span></button>
      <nav class="library-breadcrumbs" aria-label="${t("library.breadcrumb")}"></nav>
    </header>
    <p class="library-status" role="status" aria-live="polite"></p>
    <div class="library-content"></div>`;
  const back = section.querySelector<HTMLButtonElement>(".library-back");
  const breadcrumbs = section.querySelector<HTMLElement>(
    ".library-breadcrumbs",
  );
  const status = section.querySelector<HTMLElement>(".library-status");
  const content = section.querySelector<HTMLElement>(".library-content");
  if (!back || !breadcrumbs || !status || !content)
    throw new Error("Library screen is incomplete");

  let destroyed = false;
  let generation = 0;
  let playerState = options.initialPlayerState;
  let currentResponse: DirectoryBrowseResponse | null = null;
  let audioRows: AudioRow[] = [];
  let metadataController: AbortController | null = null;

  const scrollRegion = (): HTMLElement | null =>
    section.closest<HTMLElement>(".screen-region");

  const rememberScroll = (): void => {
    const location = librarySession.getLocation();
    const region = scrollRegion();
    if (location.sourceId && region)
      librarySession.saveScroll(
        location.sourceId,
        location.relativePath,
        region.scrollTop,
      );
  };

  const disposeRows = (): void => {
    metadataController?.abort();
    metadataController = null;
    for (const row of audioRows) row.artwork.destroy();
    audioRows = [];
  };

  const updateCurrentRows = (): void => {
    const currentFilename = playerState.currentTrack?.filename ?? null;
    for (const row of audioRows) {
      const isCurrent =
        row.entry.current ||
        (currentFilename !== null && row.entry.name === currentFilename);
      row.button.classList.toggle("library-audio--current", isCurrent);
      if (isCurrent) row.button.setAttribute("aria-current", "true");
      else row.button.removeAttribute("aria-current");
    }
  };

  const restoreScroll = (sourceId: string, relativePath: string): void => {
    const target = librarySession.scrollFor(sourceId, relativePath);
    requestAnimationFrame(() => {
      if (!destroyed) scrollRegion()?.scrollTo({ top: target });
    });
  };

  const showError = (message: string, retry: () => void): void => {
    disposeRows();
    content.replaceChildren();
    status.textContent = "";
    const panel = document.createElement("div");
    panel.className = "library-error";
    const copy = document.createElement("p");
    copy.textContent = message;
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = t("library.retry");
    retryButton.addEventListener("click", retry);
    panel.append(copy, retryButton);
    content.append(panel);
  };

  const loadMetadata = (
    sourceId: string,
    rows: readonly AudioRow[],
    requestGeneration: number,
  ): void => {
    metadataController?.abort();
    const controller = new AbortController();
    metadataController = controller;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        if (!row) return;
        try {
          const metadata = await options.api.metadata(
            sourceId,
            row.entry.id,
            controller.signal,
          );
          if (
            destroyed ||
            controller.signal.aborted ||
            requestGeneration !== generation
          )
            return;
          row.title.textContent = metadata.title || row.entry.name;
          row.artist.textContent = metadata.artist ?? "";
          row.technical.textContent =
            metadata.format ?? row.entry.extension?.toUpperCase() ?? "";
          row.duration.textContent =
            metadata.durationSeconds === null
              ? ""
              : formatTime(metadata.durationSeconds);
          row.artwork.update(metadata.artwork, "", requestGeneration);
        } catch {
          if (controller.signal.aborted) return;
        }
      }
    };
    void Promise.all([worker(), worker()]);
  };

  const navigateDirectory = (sourceId: string, relativePath: string): void => {
    rememberScroll();
    librarySession.setLocation(sourceId, relativePath);
    void loadDirectory(sourceId, relativePath);
  };

  const renderDirectory = (
    response: DirectoryBrowseResponse,
    requestGeneration: number,
  ): void => {
    disposeRows();
    currentResponse = response;
    const fragment = document.createDocumentFragment();
    const directories = response.entries.filter(
      (entry) => entry.type === "directory",
    );
    const files = response.entries.filter((entry) => entry.type === "audio");
    if (directories.length > 0) {
      const heading = document.createElement("h2");
      heading.className = "library-section-title";
      heading.textContent = t("library.folders");
      const grid = document.createElement("div");
      grid.className = "library-folder-grid";
      for (const entry of directories) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "library-folder";
        button.setAttribute(
          "aria-label",
          t("library.openFolder").replace("{name}", entry.name),
        );
        button.innerHTML = `<span>${icon("folder")}</span><strong></strong>`;
        const name = button.querySelector<HTMLElement>("strong");
        if (name) name.textContent = entry.name;
        button.addEventListener("click", () => {
          navigateDirectory(response.source.id, entry.relativePath);
        });
        grid.append(button);
      }
      fragment.append(heading, grid);
    }
    if (files.length > 0) {
      const heading = document.createElement("h2");
      heading.className = "library-section-title";
      heading.textContent = t("library.audioFiles");
      const list = document.createElement("div");
      list.className = "library-audio-list";
      for (const entry of files) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "library-audio";
        button.classList.toggle(
          "library-audio--selected",
          librarySession.getLocation().selectedEntryId === entry.id,
        );
        button.setAttribute(
          "aria-label",
          t("library.playFile").replace("{name}", entry.name),
        );
        const artwork = createArtwork({
          className: "library-audio__artwork",
          decorative: true,
        });
        const copy = document.createElement("span");
        copy.className = "library-audio__copy";
        const title = document.createElement("strong");
        title.textContent = entry.name.replace(/\.[^.]+$/, "");
        const artist = document.createElement("small");
        copy.append(title, artist);
        const technical = document.createElement("span");
        technical.className = "library-audio__technical";
        technical.textContent = entry.extension?.toUpperCase() ?? "";
        const duration = document.createElement("span");
        duration.className = "library-audio__duration";
        duration.setAttribute("aria-label", t("library.duration"));
        button.append(artwork.element, copy, technical, duration);
        button.addEventListener("click", () => {
          librarySession.setSelected(entry.id);
          rememberScroll();
          button.disabled = true;
          void options.openEntry(response.source.id, entry.id).catch(() => {
            if (!destroyed) {
              status.textContent = t("error.generic");
              button.disabled = false;
            }
          });
        });
        list.append(button);
        audioRows.push({
          entry,
          button,
          title,
          artist,
          technical,
          duration,
          artwork,
        });
      }
      fragment.append(heading, list);
    }
    if (directories.length === 0 && files.length === 0) {
      const empty = document.createElement("p");
      empty.className = "library-empty";
      empty.textContent = t("library.empty");
      fragment.append(empty);
    }
    content.replaceChildren(fragment);
    updateCurrentRows();
    loadMetadata(response.source.id, audioRows, requestGeneration);
  };

  const renderBreadcrumbs = (response: DirectoryBrowseResponse): void => {
    const list = document.createElement("ol");
    for (const [index, segment] of response.breadcrumbs.entries()) {
      const item = document.createElement("li");
      const middle = index > 0 && index < response.breadcrumbs.length - 1;
      item.classList.toggle("library-breadcrumb--middle", middle);
      if (index > 0) item.classList.add("library-breadcrumb--with-separator");
      if (index > 0) {
        const separator = document.createElement("span");
        separator.textContent = "/";
        separator.setAttribute("aria-hidden", "true");
        item.append(separator);
      }
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.textContent = segment.name;
      crumb.disabled = segment.current;
      crumb.addEventListener("click", () => {
        navigateDirectory(response.source.id, segment.relativePath);
      });
      item.append(crumb);
      list.append(item);
    }
    breadcrumbs.replaceChildren(list);
  };

  const loadDirectory = async (
    sourceId: string,
    relativePath: string,
  ): Promise<void> => {
    const requestGeneration = ++generation;
    status.textContent = t("library.loading");
    content.setAttribute("aria-busy", "true");
    try {
      const response = await options.api.browse(sourceId, relativePath);
      if (destroyed || requestGeneration !== generation) return;
      librarySession.setLocation(
        response.current.sourceId,
        response.current.relativePath,
      );
      renderBreadcrumbs(response);
      renderDirectory(response, requestGeneration);
      back.hidden = false;
      status.textContent = "";
      restoreScroll(response.current.sourceId, response.current.relativePath);
    } catch (error) {
      if (destroyed || requestGeneration !== generation) return;
      showError(
        error instanceof Error ? error.message : t("sources.unableToRead"),
        () => {
          void loadDirectory(sourceId, relativePath);
        },
      );
    } finally {
      if (!destroyed && requestGeneration === generation)
        content.removeAttribute("aria-busy");
    }
  };

  const showSourceChooser = async (): Promise<void> => {
    const requestGeneration = ++generation;
    disposeRows();
    currentResponse = null;
    librarySession.showSources();
    back.hidden = true;
    breadcrumbs.textContent = t("screen.library.title");
    status.textContent = t("library.loading");
    try {
      const response = await options.api.listSources();
      if (destroyed || requestGeneration !== generation) return;
      const fragment = document.createDocumentFragment();
      const heading = document.createElement("div");
      heading.className = "library-source-heading";
      heading.innerHTML = `<div><h1>${t("screen.library.title")}</h1><p>${t("screen.library.description")}</p></div>`;
      const add = document.createElement("button");
      add.type = "button";
      add.className = "primary-action";
      add.innerHTML = `${icon("plus")}<span>${t("sources.addFolder")}</span>`;
      add.addEventListener("click", () => {
        add.disabled = true;
        void options
          .addFolder()
          .then(() => showSourceChooser())
          .catch(() => {
            status.textContent = t("sources.unableToRead");
          })
          .finally(() => {
            add.disabled = false;
          });
      });
      heading.append(add);
      fragment.append(heading);
      const list = document.createElement("div");
      list.className = "library-source-list";
      for (const source of response.sources) {
        const button = sourceButton(source);
        button.addEventListener("click", () => {
          librarySession.openSource(source.id);
          void loadDirectory(source.id, "");
        });
        list.append(button);
      }
      if (response.sources.length === 0) {
        const empty = document.createElement("p");
        empty.className = "library-empty";
        empty.textContent = t("sources.noLocalFolders");
        list.append(empty);
      }
      fragment.append(list);
      content.replaceChildren(fragment);
      status.textContent = "";
    } catch {
      if (!destroyed)
        showError(t("sources.unableToRead"), () => {
          void showSourceChooser();
        });
    }
  };

  back.addEventListener("click", () => {
    if (currentResponse?.parent) {
      navigateDirectory(
        currentResponse.parent.sourceId,
        currentResponse.parent.relativePath,
      );
    } else {
      rememberScroll();
      void showSourceChooser();
    }
  });

  const initial = librarySession.getLocation();
  if (initial.sourceId)
    void loadDirectory(initial.sourceId, initial.relativePath);
  else void showSourceChooser();

  return {
    element: section,
    updatePlayerState(state) {
      playerState = state;
      updateCurrentRows();
    },
    destroy() {
      rememberScroll();
      destroyed = true;
      generation += 1;
      disposeRows();
    },
  };
}
