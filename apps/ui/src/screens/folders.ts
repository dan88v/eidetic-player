import type {
  DirectoryBrowseResponse,
  DirectoryEntry,
  DirectoryQueueResponse,
  FolderArtworkPreview,
} from "../../../../packages/shared/src/library";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type { FoldersApiClient } from "../api/folders-api-client";
import { createArtwork, type ArtworkView } from "../components/artwork";
import { icon } from "../components/icons";
import { t } from "../i18n";
import { formatTime } from "../components/timeline";
import type { ComponentView } from "../components/types";
import { foldersSession } from "../state/folders-session";
import type { FolderSortMode, FolderViewMode } from "../state/types";
import {
  loadFolderSortMode,
  loadFolderViewMode,
  saveFolderSortMode,
  saveFolderViewMode,
} from "../utils/storage";
import { formatAudioQuality } from "../utils/audio-quality";

export interface FoldersScreenOptions {
  readonly api: FoldersApiClient;
  readonly openSources: () => void;
  readonly openEntry: (sourceId: string, entryId: string) => Promise<void>;
  readonly playDirectory: (
    sourceId: string,
    relativePath: string,
  ) => Promise<DirectoryQueueResponse>;
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

interface FolderTarget {
  readonly kind: "folder";
  readonly sourceId: string;
  readonly relativePath: string;
  readonly name: string;
  readonly available: boolean;
}

interface AudioTarget {
  readonly kind: "audio";
  readonly sourceId: string;
  readonly entryId: string;
  readonly name: string;
}

type ActionTarget = FolderTarget | AudioTarget;

const folderNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

const previewCache = new Map<string, FolderArtworkPreview>();

function rememberPreview(key: string, preview: FolderArtworkPreview): void {
  previewCache.delete(key);
  previewCache.set(key, preview);
  while (previewCache.size > 32) {
    const oldest = previewCache.keys().next().value;
    if (typeof oldest !== "string") break;
    previewCache.delete(oldest);
  }
}

export function createFoldersScreen(
  options: FoldersScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen folders-screen";
  section.innerHTML = `
    <header class="folders-directory-header" hidden>
      <div class="folders-directory-header__primary">
        <button class="folders-back" type="button">${icon("back")}<span>${t("common.back")}</span></button>
        <h1 class="folders-directory-title"></h1>
        <div class="folders-directory-actions"></div>
      </div>
      <nav class="folders-breadcrumbs" aria-label="${t("folders.breadcrumb")}"></nav>
    </header>
    <div class="folders-root-toolbar" hidden>
      <div class="folders-root-sort"></div>
      <div class="folders-root-actions"></div>
    </div>
    <p class="folders-status" role="status" aria-live="polite"></p>
    <div class="folders-content"></div>
    <div class="folders-action-menu" role="menu" hidden></div>`;
  const directoryHeader = section.querySelector<HTMLElement>(
    ".folders-directory-header",
  );
  const rootToolbar = section.querySelector<HTMLElement>(
    ".folders-root-toolbar",
  );
  const title = section.querySelector<HTMLElement>(".folders-directory-title");
  const back = section.querySelector<HTMLButtonElement>(".folders-back");
  const breadcrumbs = section.querySelector<HTMLElement>(
    ".folders-breadcrumbs",
  );
  const directoryActions = section.querySelector<HTMLElement>(
    ".folders-directory-actions",
  );
  const rootSort = section.querySelector<HTMLElement>(".folders-root-sort");
  const rootActions = section.querySelector<HTMLElement>(
    ".folders-root-actions",
  );
  const status = section.querySelector<HTMLElement>(".folders-status");
  const content = section.querySelector<HTMLElement>(".folders-content");
  const menu = section.querySelector<HTMLElement>(".folders-action-menu");
  if (
    !directoryHeader ||
    !rootToolbar ||
    !title ||
    !back ||
    !breadcrumbs ||
    !directoryActions ||
    !rootSort ||
    !rootActions ||
    !status ||
    !content ||
    !menu
  )
    throw new Error("Folders screen is incomplete");
  const stableStatus = status;
  const stableContent = content;

  let destroyed = false;
  let generation = 0;
  let playerState = options.initialPlayerState;
  let currentResponse: DirectoryBrowseResponse | null = null;
  let audioRows: AudioRow[] = [];
  let metadataController: AbortController | null = null;
  let previewController: AbortController | null = null;
  let viewMode: FolderViewMode = loadFolderViewMode();
  let sortMode: FolderSortMode = loadFolderSortMode();
  let menuTarget: ActionTarget | null = null;
  let menuTrigger: HTMLButtonElement | null = null;
  const previewViews = new Set<ArtworkView>();

  const observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              observer?.unobserve(entry.target);
              void loadFolderPreview(entry.target as HTMLElement);
            }
          },
          { rootMargin: "240px" },
        )
      : null;

  const scrollRegion = (): HTMLElement | null =>
    section.closest<HTMLElement>(".screen-region");

  const rememberScroll = (): void => {
    const location = foldersSession.getLocation();
    const region = scrollRegion();
    if (location.sourceId && region)
      foldersSession.saveScroll(
        location.sourceId,
        location.relativePath,
        region.scrollTop,
      );
  };

  const closeMenu = (restoreFocus = true): void => {
    menu.hidden = true;
    menuTarget = null;
    if (restoreFocus) menuTrigger?.focus();
    menuTrigger = null;
  };

  const closeSortMenus = (): void => {
    for (const sortMenu of section.querySelectorAll<HTMLElement>(
      ".folders-sort-menu:not([hidden])",
    )) {
      sortMenu.hidden = true;
      sortMenu.parentElement
        ?.querySelector<HTMLElement>(".folders-sort-trigger")
        ?.setAttribute("aria-expanded", "false");
    }
  };

  const disposeContent = (): void => {
    metadataController?.abort();
    previewController?.abort();
    metadataController = null;
    previewController = null;
    observer?.disconnect();
    for (const row of audioRows) row.artwork.destroy();
    for (const artwork of previewViews) artwork.destroy();
    audioRows = [];
    previewViews.clear();
    closeMenu(false);
    closeSortMenus();
  };

  const setViewMode = (mode: FolderViewMode): void => {
    viewMode = mode;
    saveFolderViewMode(mode);
    section.dataset.folderView = mode;
    section
      .querySelectorAll<HTMLButtonElement>("[data-view-mode]")
      .forEach((button) => {
        const active = button.dataset.viewMode === mode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
  };

  const sortFolderCards = (): void => {
    for (const collection of section.querySelectorAll<HTMLElement>(
      ".folders-folder-collection",
    )) {
      const cards = [
        ...collection.querySelectorAll<HTMLElement>(
          ":scope > [data-folder-card]",
        ),
      ];
      cards.sort((left, right) => {
        const nameOrder = folderNameCollator.compare(
          left.dataset.folderName ?? "",
          right.dataset.folderName ?? "",
        );
        const leftCount = Number(left.dataset.fileCount ?? "-1");
        const rightCount = Number(right.dataset.fileCount ?? "-1");
        if (sortMode === "name-desc") return -nameOrder;
        if (sortMode === "files-desc")
          return rightCount - leftCount || nameOrder;
        if (sortMode === "files-asc")
          return leftCount - rightCount || nameOrder;
        return nameOrder;
      });
      collection.append(...cards);
    }
  };

  const sortControls = (): HTMLElement => {
    const control = document.createElement("div");
    control.className = "folders-sort-control";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "folders-sort-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "folders-sort-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    const choices: readonly [FolderSortMode, string][] = [
      ["name-asc", t("folders.nameAscending")],
      ["name-desc", t("folders.nameDescending")],
      ["files-desc", t("folders.mostFiles")],
      ["files-asc", t("folders.fewestFiles")],
    ];
    for (const [value, copy] of choices) {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", String(value === sortMode));
      option.textContent = copy;
      option.addEventListener("click", () => {
        sortMode = value;
        saveFolderSortMode(sortMode);
        sortFolderCards();
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        updateLabel();
      });
      menu.append(option);
    }
    const updateLabel = (): void => {
      trigger.textContent = `${t("folders.sort")}: ${choices.find(([value]) => value === sortMode)?.[1] ?? ""}`;
    };
    trigger.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      trigger.setAttribute("aria-expanded", String(!menu.hidden));
    });
    updateLabel();
    control.append(trigger, menu);
    return control;
  };

  const viewControls = (): HTMLElement => {
    const group = document.createElement("div");
    group.className = "folders-view-controls";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", t("folders.folderView"));
    for (const mode of ["list", "grid"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.viewMode = mode;
      button.innerHTML = icon(mode);
      button.setAttribute(
        "aria-label",
        t(mode === "list" ? "folders.listView" : "folders.gridView"),
      );
      button.addEventListener("click", () => {
        setViewMode(mode);
      });
      group.append(button);
    }
    return group;
  };

  const navigateDirectory = (sourceId: string, relativePath: string): void => {
    rememberScroll();
    foldersSession.setLocation(sourceId, relativePath);
    void loadDirectory(sourceId, relativePath);
  };

  const runFolderAction = async (
    target: FolderTarget,
    action: "open" | "play" | "queue",
    trigger?: HTMLButtonElement,
  ): Promise<void> => {
    if (!target.available) return;
    if (action === "open") {
      navigateDirectory(target.sourceId, target.relativePath);
      return;
    }
    if (trigger) trigger.disabled = true;
    status.textContent =
      action === "play"
        ? t("folders.startingFolder")
        : t("folders.addingFolder");
    try {
      if (action === "play") {
        const result = await options.playDirectory(
          target.sourceId,
          target.relativePath,
        );
        if (result.queueLength === 0)
          status.textContent = t("folders.noSupported");
      } else {
        const result = await options.api.addDirectoryToQueue(
          target.sourceId,
          target.relativePath,
        );
        status.textContent =
          result.appendedCount > 0
            ? `${String(result.appendedCount)} track${result.appendedCount === 1 ? "" : "s"} added to Queue.`
            : t("folders.noNewTracks");
      }
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message
          : t("folders.folderActionFailed");
    } finally {
      if (trigger && !destroyed) trigger.disabled = false;
    }
  };

  const runAudioAction = async (
    target: AudioTarget,
    action: "play" | "queue",
    trigger?: HTMLButtonElement,
  ): Promise<void> => {
    if (trigger) trigger.disabled = true;
    status.textContent =
      action === "play" ? t("folders.startingTrack") : t("folders.addingTrack");
    try {
      if (action === "play")
        await options.openEntry(target.sourceId, target.entryId);
      else {
        const result = await options.api.addEntryToQueue(
          target.sourceId,
          target.entryId,
        );
        status.textContent =
          result.appendedCount > 0
            ? t("folders.trackAdded")
            : t("folders.trackAlreadyQueued");
      }
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : t("folders.trackActionFailed");
    } finally {
      if (trigger && !destroyed) trigger.disabled = false;
    }
  };

  const openMenu = (trigger: HTMLButtonElement, target: ActionTarget): void => {
    menuTarget = target;
    menuTrigger = trigger;
    const actions =
      target.kind === "folder"
        ? ([
            ["open", t("folders.open")],
            ["play", t("folders.playNow")],
            ["queue", t("folders.addToQueue")],
          ] as const)
        : ([
            ["play", t("folders.playNow")],
            ["queue", t("folders.addToQueue")],
          ] as const);
    menu.replaceChildren(
      ...actions.map(([action, copy]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.dataset.action = action;
        button.textContent = copy;
        return button;
      }),
    );
    menu.hidden = false;
    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${String(rect.bottom + 6)}px`;
    menu.style.left = `${String(Math.max(8, rect.right - 180))}px`;
    if (target.kind === "folder")
      menu
        .querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
        .forEach((item) => {
          item.disabled = !target.available;
        });
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  };

  menu.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-action]",
    );
    const target = menuTarget;
    if (!button || !target) return;
    const action = button.dataset.action as "open" | "play" | "queue";
    closeMenu(false);
    if (target.kind === "folder") void runFolderAction(target, action, button);
    else if (action !== "open") void runAudioAction(target, action, button);
  });
  section.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!menu.hidden) closeMenu();
    closeSortMenus();
    event.preventDefault();
  });
  const handleOutsidePointer = (event: PointerEvent): void => {
    if (
      !menu.hidden &&
      !menu.contains(event.target as Node) &&
      event.target !== menuTrigger
    )
      closeMenu(false);
    const openSortMenu = section.querySelector<HTMLElement>(
      ".folders-sort-menu:not([hidden])",
    );
    if (
      openSortMenu &&
      !openSortMenu.parentElement?.contains(event.target as Node)
    )
      closeSortMenus();
  };
  document.addEventListener("pointerdown", handleOutsidePointer);

  const paintPreview = (
    surface: HTMLElement,
    preview: FolderArtworkPreview,
  ): void => {
    surface.classList.toggle(
      "folders-folder-art--mosaic",
      preview.mode === "mosaic",
    );
    surface.replaceChildren();
    if (preview.artwork.length === 0) {
      surface.innerHTML = icon("folder");
      return;
    }
    for (const ref of preview.artwork) {
      const artwork = createArtwork({
        className: "folders-folder-art__image",
        decorative: true,
      });
      artwork.update(ref, "", generation);
      previewViews.add(artwork);
      surface.append(artwork.element);
    }
  };

  const commitFolderPreview = (
    surface: HTMLElement,
    preview: FolderArtworkPreview,
  ): void => {
    paintPreview(surface, preview);
    const card = surface.closest<HTMLElement>(".folders-folder-card");
    if (!card) return;
    card.dataset.fileCount = String(preview.playableFileCount);
    const count = card.querySelector<HTMLElement>("[data-file-count]");
    if (count)
      count.textContent = `${String(preview.playableFileCount)} file${
        preview.playableFileCount === 1 ? "" : "s"
      }`;
    if (sortMode === "files-asc" || sortMode === "files-desc")
      sortFolderCards();
  };

  const loadFolderPreview = async (surface: HTMLElement): Promise<void> => {
    const sourceId = surface.dataset.sourceId;
    const relativePath = surface.dataset.relativePath;
    if (!sourceId || relativePath === undefined) return;
    const key = `${sourceId}\0${relativePath}`;
    const cached = previewCache.get(key);
    if (cached) {
      commitFolderPreview(surface, cached);
      return;
    }
    try {
      const preview = await options.api.folderArtwork(
        sourceId,
        relativePath,
        previewController?.signal,
      );
      if (destroyed || !surface.isConnected) return;
      rememberPreview(key, preview);
      commitFolderPreview(surface, preview);
    } catch {
      // The folder fallback remains usable if artwork cannot be resolved.
    }
  };

  const folderCard = (target: FolderTarget): HTMLElement => {
    const card = document.createElement("article");
    card.className = "folders-folder-card";
    card.dataset.folderCard = "";
    card.dataset.folderName = target.name;
    card.dataset.fileCount = "-1";
    const artButton = document.createElement("button");
    artButton.type = "button";
    artButton.className = "folders-folder-card__art-button";
    artButton.disabled = !target.available;
    artButton.setAttribute("aria-label", `Open folder ${target.name}`);
    const art = document.createElement("div");
    art.className = "folders-folder-art";
    art.dataset.sourceId = target.sourceId;
    art.dataset.relativePath = target.relativePath;
    art.innerHTML = icon("folder");
    artButton.append(art);
    artButton.addEventListener("click", () => {
      void runFolderAction(target, "open");
    });
    const body = document.createElement("button");
    body.type = "button";
    body.className = "folders-folder-card__body";
    body.disabled = !target.available;
    body.setAttribute("aria-label", `Open folder ${target.name}`);
    const name = document.createElement("strong");
    name.textContent = target.name;
    const detail = document.createElement("small");
    detail.dataset.fileCount = "";
    detail.textContent = target.available
      ? t("folders.countingFiles")
      : t("folders.unavailable");
    body.append(name, detail);
    body.addEventListener("click", () => {
      void runFolderAction(target, "open");
    });
    const actions = document.createElement("div");
    actions.className = "folders-folder-card__actions";
    const more = document.createElement("button");
    more.type = "button";
    more.innerHTML = icon("more");
    more.setAttribute("aria-label", `More actions for ${target.name}`);
    more.setAttribute("aria-haspopup", "menu");
    more.disabled = !target.available;
    more.addEventListener("click", () => {
      openMenu(more, target);
    });
    actions.append(more);
    card.append(artButton, body, actions);
    if (target.available) {
      if (observer) observer.observe(art);
      else void loadFolderPreview(art);
    }
    return card;
  };

  const updateCurrentRows = (): void => {
    const currentFilename = playerState.currentTrack?.filename ?? null;
    for (const row of audioRows) {
      const current =
        row.entry.current ||
        (currentFilename !== null && row.entry.name === currentFilename);
      row.button
        .closest(".folders-audio")
        ?.classList.toggle("folders-audio--current", current);
      if (current) row.button.setAttribute("aria-current", "true");
      else row.button.removeAttribute("aria-current");
    }
  };

  const restoreScroll = (sourceId: string, relativePath: string): void => {
    const target = foldersSession.scrollFor(sourceId, relativePath);
    requestAnimationFrame(() => {
      if (!destroyed) scrollRegion()?.scrollTo({ top: target });
    });
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
          if (destroyed || requestGeneration !== generation) return;
          row.title.textContent = metadata.title || row.entry.name;
          row.artist.textContent = metadata.artist ?? "";
          row.technical.textContent = formatAudioQuality(
            metadata,
            row.entry.extension ?? "",
          );
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

  const renderBreadcrumbs = (response: DirectoryBrowseResponse): void => {
    const list = document.createElement("ol");
    for (const segment of response.breadcrumbs.filter(
      (candidate) => !candidate.current,
    )) {
      const item = document.createElement("li");
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.textContent = segment.name;
      crumb.addEventListener("click", () => {
        navigateDirectory(response.source.id, segment.relativePath);
      });
      item.append(crumb);
      list.append(item);
    }
    breadcrumbs.replaceChildren(list);
    breadcrumbs.hidden = list.childElementCount === 0;
  };

  const renderDirectory = (
    response: DirectoryBrowseResponse,
    requestGeneration: number,
  ): void => {
    disposeContent();
    previewController = new AbortController();
    currentResponse = response;
    directoryHeader.hidden = false;
    rootToolbar.hidden = true;
    title.textContent =
      response.breadcrumbs.at(-1)?.name ?? response.source.displayName;
    directoryActions.replaceChildren();
    breadcrumbs.hidden = true;
    const play = document.createElement("button");
    play.type = "button";
    play.className = "folders-directory-play";
    play.innerHTML = `${icon("play")}<span>Play</span>`;
    play.disabled = !response.entries.some((entry) => entry.type === "audio");
    play.addEventListener("click", () => {
      void runFolderAction(
        {
          kind: "folder",
          sourceId: response.source.id,
          relativePath: response.current.relativePath,
          name: title.textContent,
          available: true,
        },
        "play",
        play,
      );
    });
    directoryActions.append(play);
    renderBreadcrumbs(response);

    const fragment = document.createDocumentFragment();
    const directories = response.entries.filter(
      (entry) => entry.type === "directory",
    );
    const files = response.entries.filter((entry) => entry.type === "audio");
    if (directories.length) {
      const heading = document.createElement("h2");
      heading.className = "folders-section-title";
      heading.textContent = t("folders.folders");
      const folders = document.createElement("div");
      folders.className = "folders-folder-collection";
      for (const entry of directories)
        folders.append(
          folderCard({
            kind: "folder",
            sourceId: response.source.id,
            relativePath: entry.relativePath,
            name: entry.name,
            available: true,
          }),
        );
      fragment.append(heading, folders);
    }
    if (files.length) {
      const heading = document.createElement("h2");
      heading.className = "folders-section-title";
      heading.textContent = t("folders.audioFiles");
      const list = document.createElement("div");
      list.className = "folders-audio-list";
      for (const entry of files) {
        const row = document.createElement("article");
        row.className = "folders-audio";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "folders-audio__main";
        button.setAttribute("aria-label", `Play ${entry.name}`);
        const artwork = createArtwork({
          className: "folders-audio__artwork",
          decorative: true,
        });
        const copy = document.createElement("span");
        copy.className = "folders-audio__copy";
        const rowTitle = document.createElement("strong");
        rowTitle.textContent = entry.name.replace(/\.[^.]+$/, "");
        const artist = document.createElement("small");
        copy.append(rowTitle, artist);
        const technical = document.createElement("span");
        technical.className = "folders-audio__technical";
        technical.textContent = entry.extension?.toUpperCase() ?? "";
        const duration = document.createElement("span");
        duration.className = "folders-audio__duration";
        button.append(artwork.element, copy, technical, duration);
        button.addEventListener("click", () => {
          foldersSession.setSelected(entry.id);
          rememberScroll();
          button.disabled = true;
          void options
            .openEntry(response.source.id, entry.id)
            .catch((error: unknown) => {
              status.textContent =
                error instanceof Error
                  ? error.message
                  : t("folders.trackActionFailed");
              button.disabled = false;
            });
        });
        const more = document.createElement("button");
        more.type = "button";
        more.className = "folders-audio__more";
        more.innerHTML = icon("more");
        more.setAttribute("aria-label", `More actions for ${entry.name}`);
        more.setAttribute("aria-haspopup", "menu");
        more.addEventListener("click", () => {
          openMenu(more, {
            kind: "audio",
            sourceId: response.source.id,
            entryId: entry.id,
            name: entry.name,
          });
        });
        row.append(button, more);
        list.append(row);
        audioRows.push({
          entry,
          button,
          title: rowTitle,
          artist,
          technical,
          duration,
          artwork,
        });
      }
      fragment.append(heading, list);
    }
    if (!directories.length && !files.length) {
      const empty = document.createElement("div");
      empty.className = "folders-empty";
      empty.textContent = response.containsUnsupportedFiles
        ? t("folders.noSupported")
        : t("folders.empty");
      fragment.append(empty);
    }
    content.replaceChildren(fragment);
    setViewMode(viewMode);
    sortFolderCards();
    updateCurrentRows();
    loadMetadata(response.source.id, audioRows, requestGeneration);
  };

  async function loadDirectory(
    sourceId: string,
    relativePath: string,
  ): Promise<void> {
    const requestGeneration = ++generation;
    stableStatus.textContent = t("folders.loadingFolder");
    stableContent.setAttribute("aria-busy", "true");
    try {
      const response = await options.api.browse(sourceId, relativePath);
      if (destroyed || requestGeneration !== generation) return;
      foldersSession.setLocation(sourceId, response.current.relativePath);
      renderDirectory(response, requestGeneration);
      stableStatus.textContent = "";
      restoreScroll(sourceId, relativePath);
    } catch (error) {
      if (destroyed || requestGeneration !== generation) return;
      stableContent.textContent =
        error instanceof Error ? error.message : t("folders.unableRead");
      stableStatus.textContent = "";
    } finally {
      if (!destroyed && requestGeneration === generation)
        stableContent.removeAttribute("aria-busy");
    }
  }

  const showSourceChooser = async (): Promise<void> => {
    const requestGeneration = ++generation;
    disposeContent();
    currentResponse = null;
    foldersSession.showSources();
    directoryHeader.hidden = true;
    rootToolbar.hidden = false;
    rootSort.replaceChildren(sortControls());
    rootActions.replaceChildren(viewControls());
    status.textContent = t("folders.loadingRoot");
    try {
      const response = await options.api.listSources();
      if (destroyed || requestGeneration !== generation) return;
      previewController = new AbortController();
      const list = document.createElement("div");
      list.className = "folders-folder-collection folders-source-collection";
      for (const source of response.sources)
        list.append(
          folderCard({
            kind: "folder",
            sourceId: source.id,
            relativePath: "",
            name: source.displayName,
            available: source.availability === "available",
          }),
        );
      if (!response.sources.length) {
        const empty = document.createElement("div");
        empty.className = "folders-empty folders-empty--root";
        const copy = document.createElement("p");
        copy.textContent = t("folders.noSources");
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = t("folders.openSources");
        open.addEventListener("click", options.openSources);
        empty.append(copy, open);
        list.append(empty);
      }
      content.replaceChildren(list);
      setViewMode(viewMode);
      sortFolderCards();
      status.textContent = "";
    } catch {
      status.textContent = "";
      content.textContent = t("folders.unableSources");
    }
  };

  back.addEventListener("click", () => {
    if (currentResponse?.parent)
      navigateDirectory(
        currentResponse.parent.sourceId,
        currentResponse.parent.relativePath,
      );
    else {
      rememberScroll();
      void showSourceChooser();
    }
  });

  const initial = foldersSession.getLocation();
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
      disposeContent();
      observer?.disconnect();
      document.removeEventListener("pointerdown", handleOutsidePointer);
    },
  };
}
