import type {
  AddLocalSourceResponse,
  IndexedLibrarySnapshot,
  LibrarySource,
  RemovableDevice,
  RemovableDeviceListResponse,
} from "../../../../packages/shared/src/library";
import type { FoldersApiClient } from "../api/folders-api-client";
import type { LibraryApiClient } from "../api/library-api-client";
import type { RemovableStorageApiClient } from "../api/removable-storage-api-client";
import { icon } from "../components/icons";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";

export interface SourcesScreenOptions {
  readonly api: FoldersApiClient;
  readonly removableApi: RemovableStorageApiClient;
  readonly libraryApi: LibraryApiClient;
  readonly initialLibrarySnapshot: IndexedLibrarySnapshot | null;
  readonly addFolder: () => Promise<AddLocalSourceResponse | null>;
  readonly openSource: (sourceId: string) => void;
  readonly onSourceRemoved: (sourceId: string) => void;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
  readonly removableDevices: RemovableDeviceListResponse;
  readonly openRemovableDevice: (device: RemovableDevice) => void;
}

export function createSourcesScreen(
  options: SourcesScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen sources-screen";
  section.setAttribute("aria-label", t("screen.sources.title"));
  section.innerHTML = `
    <header class="screen-header sources-header">
      <p class="screen-header__description">${t("screen.sources.description")}</p>
      <div class="sources-header__actions">
        <button class="sources-header__scan" type="button">${t("sources.rescanLibrary")}</button>
        <button class="primary-action sources-header__add" type="button">${icon("plus")}<span>${t("sources.addFolder")}</span></button>
      </div>
    </header>
    <section class="sources-section" aria-labelledby="local-folders-heading">
      <h2 id="local-folders-heading">${t("sources.localFolders")}</h2>
      <div class="sources-list sources-list--local" aria-live="polite"></div>
    </section>
    <section class="sources-section" aria-labelledby="usb-storage-heading">
      <h2 id="usb-storage-heading">${t("sources.usbStorage")}</h2>
      <div class="sources-list sources-list--usb" aria-live="polite"></div>
    </section>
    <section class="sources-section" aria-labelledby="usb-library-folders-heading">
      <h2 id="usb-library-folders-heading">USB Library Folders</h2>
      <div class="sources-list sources-list--removable-library" aria-live="polite"></div>
    </section>
    <section class="sources-section" aria-labelledby="future-sources-heading">
      <h2 id="future-sources-heading" class="visually-hidden">${t("sources.comingLater")}</h2>
      <div class="sources-list sources-list--placeholders">
        <article class="source-card source-card--placeholder">
          <span class="source-card__icon">${icon("ethernet")}</span>
          <div class="source-card__copy"><h3>${t("sources.networkShares")}</h3><p>${t("sources.notConfigured")} · ${t("sources.comingLater")}</p></div>
        </article>
      </div>
    </section>
    <div class="folders-action-menu" role="menu" hidden></div>
    <div class="source-dialog-backdrop" aria-hidden="true"></div>
    <section class="source-dialog" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="source-dialog-title">
      <h2 id="source-dialog-title"></h2>
      <p class="source-dialog__description"></p>
      <label class="source-dialog__field"><span>${t("sources.nameLabel")}</span><input type="text" maxlength="80" autocomplete="off" data-onscreen-keyboard="text"></label>
      <div class="source-dialog__actions"><button type="button" data-action="cancel">${t("sources.cancel")}</button><button class="source-dialog__confirm" type="button" data-action="confirm"></button></div>
    </section>`;
  const localList = section.querySelector<HTMLElement>(".sources-list--local");
  const usbList = section.querySelector<HTMLElement>(".sources-list--usb");
  const removableLibraryList = section.querySelector<HTMLElement>(
    ".sources-list--removable-library",
  );
  const addButton = section.querySelector<HTMLButtonElement>(
    ".sources-header__add",
  );
  const scanButton = section.querySelector<HTMLButtonElement>(
    ".sources-header__scan",
  );
  const dialog = section.querySelector<HTMLElement>(".source-dialog");
  const backdrop = section.querySelector<HTMLElement>(
    ".source-dialog-backdrop",
  );
  const dialogTitle = section.querySelector<HTMLElement>(
    "#source-dialog-title",
  );
  const dialogDescription = section.querySelector<HTMLElement>(
    ".source-dialog__description",
  );
  const dialogField = section.querySelector<HTMLElement>(
    ".source-dialog__field",
  );
  const dialogInput = section.querySelector<HTMLInputElement>(
    ".source-dialog input",
  );
  const dialogActions = section.querySelector<HTMLElement>(
    ".source-dialog__actions",
  );
  const cancelButton = section.querySelector<HTMLButtonElement>(
    '[data-action="cancel"]',
  );
  const confirmButton = section.querySelector<HTMLButtonElement>(
    '[data-action="confirm"]',
  );
  const actionMenu = section.querySelector<HTMLElement>(".folders-action-menu");
  if (
    !localList ||
    !usbList ||
    !removableLibraryList ||
    !addButton ||
    !scanButton ||
    !dialog ||
    !backdrop ||
    !dialogTitle ||
    !dialogDescription ||
    !dialogField ||
    !dialogInput ||
    !dialogActions ||
    !cancelButton ||
    !confirmButton ||
    !actionMenu
  )
    throw new Error("Sources screen is incomplete");

  let destroyed = false;
  let requestGeneration = 0;
  let dialogSource: LibrarySource | null = null;
  let dialogDevice: RemovableDevice | null = null;
  let dialogMode: "rename" | "remove" | "safe-remove" | null = null;
  let returnFocus: HTMLElement | null = null;
  let menuSource: LibrarySource | null = null;
  let menuDevice: RemovableDevice | null = null;
  let menuTrigger: HTMLButtonElement | null = null;
  let libraryScanBusy = false;
  let activeScanId: string | null = null;
  let scanPending = false;
  let librarySnapshot = options.initialLibrarySnapshot;

  const renderRemovableDevices = (
    snapshot: RemovableDeviceListResponse,
  ): void => {
    const fragment = document.createDocumentFragment();
    if (snapshot.devices.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sources-empty";
      empty.textContent = "No USB storage connected.";
      fragment.append(empty);
    }
    for (const device of snapshot.devices) {
      const card = document.createElement("article");
      card.className = "source-card source-card--removable";
      const iconSurface = document.createElement("span");
      iconSurface.className = "source-card__icon";
      iconSurface.innerHTML = icon("usbStorage");
      const copy = document.createElement("div");
      copy.className = "source-card__copy";
      const name = document.createElement("h3");
      name.textContent = device.displayName;
      const details = document.createElement("p");
      const capacity =
        device.capacityBytes === undefined
          ? ""
          : new Intl.NumberFormat("en", {
              style: "unit",
              unit: "gigabyte",
              maximumFractionDigits: 1,
            }).format(device.capacityBytes / 1_000_000_000);
      const operationLabel: Record<
        RemovableDevice["operation"]["state"],
        string
      > = {
        idle: "",
        mounting: "Mountingâ€¦",
        "preparing-removal": "Preparing safe removalâ€¦",
        unmounting: "Unmountingâ€¦",
        ejecting: "Safely removingâ€¦",
        "safe-to-remove": "Safe to remove",
        busy: "Device is busy",
        failed:
          device.operation.errorCode === "authorization-required"
            ? "Permission required"
            : "Safe removal failed",
      };
      details.textContent = [
        operationLabel[device.operation.state] ||
          (device.readable ? "Ready" : "Unavailable"),
        capacity,
        device.readOnly ? "Read-only" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      copy.append(name, details);
      const actions = document.createElement("div");
      actions.className = "source-card__actions";
      const operationBusy = [
        "mounting",
        "preparing-removal",
        "unmounting",
        "ejecting",
      ].includes(device.operation.state);
      if (
        device.operation.state !== "safe-to-remove" &&
        device.capabilities.canMount &&
        !device.readable
      ) {
        const mount = document.createElement("button");
        mount.type = "button";
        mount.textContent =
          device.operation.retryAvailable && !operationBusy ? "Retry" : "Mount";
        mount.disabled = operationBusy;
        mount.addEventListener("click", () => {
          void runDeviceOperation(device, "mount");
        });
        actions.append(mount);
      } else if (device.operation.state !== "safe-to-remove") {
        const browse = document.createElement("button");
        browse.type = "button";
        browse.textContent = "Browse";
        browse.disabled = !device.readable || operationBusy;
        browse.addEventListener("click", () => {
          options.openRemovableDevice(device);
        });
        actions.append(browse);
        if (device.capabilities.canSafelyRemove) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "source-card__more";
          more.innerHTML = icon("more");
          more.setAttribute("aria-label", `Actions for ${device.displayName}`);
          more.setAttribute("aria-haspopup", "menu");
          more.disabled = operationBusy;
          more.addEventListener("click", () => {
            closeMenu();
            menuDevice = device;
            menuTrigger = more;
            const safeRemove = document.createElement("button");
            safeRemove.type = "button";
            safeRemove.role = "menuitem";
            safeRemove.dataset.action = "safe-remove";
            safeRemove.textContent = device.operation.retryAvailable
              ? "Retry safe removal"
              : "Safely remove";
            actionMenu.replaceChildren(safeRemove);
            actionMenu.hidden = false;
            const rect = more.getBoundingClientRect();
            actionMenu.style.top = `${String(rect.bottom + 6)}px`;
            actionMenu.style.left = `${String(Math.max(8, rect.right - 180))}px`;
            safeRemove.focus();
          });
          actions.append(more);
        }
      }
      card.append(iconSurface, copy, actions);
      fragment.append(card);
    }
    usbList.replaceChildren(fragment);
  };

  const updateLibrarySnapshot = (snapshot: IndexedLibrarySnapshot): void => {
    librarySnapshot = snapshot;
    activeScanId = snapshot.status.activeScan?.scanId ?? null;
    libraryScanBusy =
      snapshot.status.activeScan !== null ||
      snapshot.status.queuedSourceIds.length > 0;
    scanButton.textContent = t(
      libraryScanBusy ? "library.cancel" : "sources.rescanLibrary",
    );
    scanButton.dataset.action = libraryScanBusy ? "cancel" : "rescan";
    scanButton.disabled =
      scanPending ||
      snapshot.summary.sourceCount === 0 ||
      (libraryScanBusy && activeScanId === null);
    const rescan = actionMenu.querySelector<HTMLButtonElement>(
      '[data-action="rescan"]',
    );
    if (rescan && menuSource) rescan.disabled = libraryScanBusy;
  };
  if (options.initialLibrarySnapshot)
    updateLibrarySnapshot(options.initialLibrarySnapshot);

  const closeMenu = (restoreFocus = false): void => {
    actionMenu.hidden = true;
    menuSource = null;
    menuDevice = null;
    if (restoreFocus) menuTrigger?.focus();
    menuTrigger = null;
  };

  const closeDialog = (): void => {
    dialog.classList.remove("source-dialog--open");
    backdrop.classList.remove("source-dialog-backdrop--open");
    dialog.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    dialog.inert = true;
    dialogMode = null;
    dialogSource = null;
    dialogDevice = null;
    returnFocus?.focus();
    returnFocus = null;
  };

  const openDialog = (
    source: LibrarySource,
    mode: "rename" | "remove",
    trigger: HTMLElement,
  ): void => {
    dialogSource = source;
    dialogMode = mode;
    returnFocus = trigger;
    const rename = mode === "rename";
    dialogTitle.textContent = rename
      ? t("sources.renameTitle")
      : `Remove “${source.displayName}”?`;
    dialogDescription.textContent = rename
      ? t("sources.localFolder")
      : t("sources.filesNotDeleted");
    if (rename) dialog.insertBefore(dialogField, dialogActions);
    else dialogField.remove();
    dialogInput.value = rename ? source.displayName : "";
    confirmButton.textContent = t(rename ? "sources.save" : "sources.remove");
    confirmButton.classList.toggle("source-dialog__confirm--danger", !rename);
    dialog.inert = false;
    dialog.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
    dialog.classList.add("source-dialog--open");
    backdrop.classList.add("source-dialog-backdrop--open");
    queueMicrotask(() => {
      if (rename) {
        dialogInput.focus();
        dialogInput.select();
      } else cancelButton.focus();
    });
  };

  const runDeviceOperation = async (
    device: RemovableDevice,
    operation: "mount" | "safe-remove",
    confirmed = false,
  ): Promise<void> => {
    try {
      if (operation === "mount") await options.removableApi.mount(device.id);
      else await options.removableApi.safelyRemove(device.id, confirmed);
    } catch (error) {
      options.showToast(
        error instanceof Error
          ? error.message
          : operation === "mount"
            ? "Unable to mount USB storage."
            : "Unable to safely remove USB storage.",
        "error",
      );
    }
  };

  const openSafeRemoveDialog = (
    device: RemovableDevice,
    usage: Awaited<ReturnType<RemovableStorageApiClient["usage"]>>,
    trigger: HTMLElement,
  ): void => {
    dialogDevice = device;
    dialogMode = "safe-remove";
    returnFocus = trigger;
    dialogTitle.textContent = "Safely remove USB storage?";
    const messages = [
      ...(usage.playbackWillStop ? ["Playback will stop."] : []),
      ...(usage.queueContainsItems
        ? ["USB items will remain in the Queue but become unavailable."]
        : []),
      ...(usage.scanWillCancel
        ? ["An active Library scan will be cancelled."]
        : []),
      ...(usage.mountedVolumeCount > 0
        ? ["All mounted volumes on this device will be removed."]
        : []),
    ];
    dialogDescription.textContent = messages.join(" ");
    dialogField.remove();
    confirmButton.textContent = "Safely remove";
    confirmButton.classList.remove("source-dialog__confirm--danger");
    dialog.inert = false;
    dialog.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
    dialog.classList.add("source-dialog--open");
    backdrop.classList.add("source-dialog-backdrop--open");
    queueMicrotask(() => {
      cancelButton.focus();
    });
  };

  const requestSafeRemoval = async (
    device: RemovableDevice,
    trigger: HTMLElement,
  ): Promise<void> => {
    try {
      const usage = await options.removableApi.usage(device.id);
      if (usage.inUse) openSafeRemoveDialog(device, usage, trigger);
      else await runDeviceOperation(device, "safe-remove");
    } catch (error) {
      options.showToast(
        error instanceof Error
          ? error.message
          : "Unable to safely remove USB storage.",
        "error",
      );
    }
  };

  const render = (sources: readonly LibrarySource[]): void => {
    const localFragment = document.createDocumentFragment();
    const removableFragment = document.createDocumentFragment();
    const localSources = sources.filter((source) => source.type === "local");
    const removableSources = sources.filter(
      (source) => source.type === "removable",
    );
    if (localSources.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sources-empty";
      empty.textContent = t("sources.noLocalFolders");
      localFragment.append(empty);
    }
    if (removableSources.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sources-empty";
      empty.textContent = "No USB Library folders.";
      removableFragment.append(empty);
    }
    for (const source of sources) {
      const card = document.createElement("article");
      card.className = "source-card";
      card.dataset.sourceId = source.id;
      card.innerHTML = `
        <span class="source-card__icon">${icon(source.type === "removable" ? "usbStorage" : "folder")}</span>
        <div class="source-card__copy"><h3></h3><p>${source.type === "removable" ? "USB Library folder" : t("sources.localFolder")}</p><span class="source-card__status"></span></div>
        <div class="source-card__actions">
          <button type="button" data-source-action="open">${t("sources.open")}</button>
          <button class="source-card__more" type="button" data-source-action="more" aria-label="${t("sources.actions")}" aria-haspopup="menu">${icon("more")}</button>
        </div>`;
      const heading = card.querySelector<HTMLElement>("h3");
      const status = card.querySelector<HTMLElement>(".source-card__status");
      const open = card.querySelector<HTMLButtonElement>(
        '[data-source-action="open"]',
      );
      const more = card.querySelector<HTMLButtonElement>(
        '[data-source-action="more"]',
      );
      if (!heading || !status || !open || !more) continue;
      heading.textContent = source.displayName;
      status.textContent = t(
        source.availability === "available"
          ? "sources.available"
          : source.availability === "checking"
            ? "sources.checking"
            : "sources.unavailable",
      );
      status.dataset.availability = source.availability;
      open.disabled = source.availability !== "available";
      open.addEventListener("click", () => {
        options.openSource(source.id);
      });
      more.addEventListener("click", () => {
        closeMenu();
        menuSource = source;
        menuTrigger = more;
        const actions: {
          readonly action: "rescan" | "retry" | "rename" | "remove";
          readonly label: string;
          readonly disabled?: boolean;
        }[] = [
          {
            action: "rescan",
            label: t("sources.rescanLibrary"),
            disabled: libraryScanBusy,
          },
          ...(source.availability === "unavailable"
            ? [{ action: "retry" as const, label: t("sources.retry") }]
            : []),
          { action: "rename", label: t("sources.rename") },
          { action: "remove", label: t("sources.remove") },
        ];
        actionMenu.replaceChildren(
          ...actions.map((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.role = "menuitem";
            button.dataset.action = item.action;
            button.textContent = item.label;
            button.disabled = item.disabled ?? false;
            return button;
          }),
        );
        actionMenu.hidden = false;
        const rect = more.getBoundingClientRect();
        actionMenu.style.top = `${String(rect.bottom + 6)}px`;
        actionMenu.style.left = `${String(Math.max(8, rect.right - 180))}px`;
        actionMenu
          .querySelector<HTMLButtonElement>(
            'button[role="menuitem"]:not([disabled])',
          )
          ?.focus();
      });
      (source.type === "removable" ? removableFragment : localFragment).append(
        card,
      );
    }
    localList.replaceChildren(localFragment);
    removableLibraryList.replaceChildren(removableFragment);
  };

  const load = async (): Promise<void> => {
    const generation = ++requestGeneration;
    localList.setAttribute("aria-busy", "true");
    removableLibraryList.setAttribute("aria-busy", "true");
    try {
      const response = await options.api.listSources();
      if (destroyed || generation !== requestGeneration) return;
      render(response.sources);
    } catch {
      if (!destroyed) options.showToast(t("sources.unableToRead"), "error");
    } finally {
      if (!destroyed && generation === requestGeneration)
        localList.removeAttribute("aria-busy");
      if (!destroyed && generation === requestGeneration)
        removableLibraryList.removeAttribute("aria-busy");
    }
  };

  addButton.addEventListener("click", () => {
    addButton.disabled = true;
    void options
      .addFolder()
      .then((result) => {
        if (!result) return;
        if (result.duplicate)
          options.showToast(t("sources.alreadyAdded"), "neutral");
        return load();
      })
      .catch(() => {
        options.showToast(t("sources.unableToRead"), "error");
      })
      .finally(() => {
        addButton.disabled = false;
      });
  });
  scanButton.addEventListener("click", () => {
    if (scanPending || scanButton.disabled) return;
    scanPending = true;
    scanButton.disabled = true;
    void (
      scanButton.dataset.action === "cancel"
        ? options.libraryApi.cancel(
            activeScanId ? { scanId: activeScanId } : {},
          )
        : options.libraryApi.scan()
    )
      .then(updateLibrarySnapshot)
      .catch((error: unknown) => {
        options.showToast(
          error instanceof Error ? error.message : t("library.actionFailed"),
          "error",
        );
      })
      .finally(() => {
        scanPending = false;
        if (librarySnapshot) updateLibrarySnapshot(librarySnapshot);
      });
  });
  cancelButton.addEventListener("click", closeDialog);
  backdrop.addEventListener("pointerup", closeDialog);
  confirmButton.addEventListener("click", () => {
    const source = dialogSource;
    const device = dialogDevice;
    const mode = dialogMode;
    if (!mode) return;
    if (mode === "safe-remove") {
      if (!device) return;
      confirmButton.disabled = true;
      void runDeviceOperation(device, "safe-remove", true).finally(() => {
        confirmButton.disabled = false;
        closeDialog();
      });
      return;
    }
    if (!source) return;
    const operation =
      mode === "rename"
        ? options.api.renameSource(source.id, dialogInput.value)
        : options.api.removeSource(source.id);
    confirmButton.disabled = true;
    void operation
      .then(() => {
        if (mode === "remove") options.onSourceRemoved(source.id);
        closeDialog();
        options.showToast(
          t(mode === "rename" ? "sources.renamed" : "sources.removed"),
          "success",
        );
        return load();
      })
      .catch(() => {
        options.showToast(
          t(
            mode === "rename" ? "sources.renameFailed" : "sources.removeFailed",
          ),
          "error",
        );
      })
      .finally(() => {
        confirmButton.disabled = false;
      });
  });
  actionMenu.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-action]",
    );
    const source = menuSource;
    const device = menuDevice;
    const trigger = menuTrigger;
    if (!button || !trigger || button.disabled) return;
    const action = button.dataset.action;
    closeMenu();
    if (action === "safe-remove") {
      if (device) void requestSafeRemoval(device, trigger);
      return;
    }
    if (!source) return;
    if (action === "rename" || action === "remove") {
      openDialog(source, action, trigger);
      return;
    }
    if (action === "retry") {
      void options.api
        .retrySource(source.id)
        .then(load)
        .catch(() => {
          options.showToast(t("sources.unableToRead"), "error");
        });
      return;
    }
    if (action === "rescan")
      void options.libraryApi.scan({ sourceId: source.id }).catch(() => {
        options.showToast(t("library.actionFailed"), "error");
      });
  });
  const handleDocumentPointer = (event: PointerEvent): void => {
    if (
      !actionMenu.hidden &&
      !actionMenu.contains(event.target as Node) &&
      event.target !== menuTrigger
    )
      closeMenu();
  };
  const handleKeydown = (event: KeyboardEvent): void => {
    if (!actionMenu.hidden && event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (!dialog.classList.contains("source-dialog--open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]):not([hidden])",
      ),
    ].filter((control) => !control.closest("[hidden]"));
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("pointerdown", handleDocumentPointer);
  dialog.inert = true;
  renderRemovableDevices(options.removableDevices);
  void load();
  return {
    element: section,
    updateRemovableDevices: renderRemovableDevices,
    updateLibrarySnapshot,
    destroy() {
      destroyed = true;
      requestGeneration += 1;
      closeMenu();
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("pointerdown", handleDocumentPointer);
    },
  };
}
