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
import type { SmbApiClient } from "../api/smb-api-client";
import type {
  AddSmbConnectionRequest,
  SmbConnection,
  SmbSnapshot,
} from "../../../../packages/shared/src/smb";
import { icon } from "../components/icons";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";

export interface SourcesScreenOptions {
  readonly api: FoldersApiClient;
  readonly removableApi: RemovableStorageApiClient;
  readonly smbApi: SmbApiClient;
  readonly smbSnapshot: SmbSnapshot;
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
  readonly openSmbConnection: (connection: SmbConnection) => void;
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
    <section class="sources-section sources-section--smb" aria-labelledby="network-shares-heading">
      <div class="sources-section__heading">
        <h2 id="network-shares-heading">${t("sources.networkShares")}</h2>
        <button class="sources-smb-add" type="button">${icon("plus")}<span>Add Share</span></button>
      </div>
      <div class="sources-list sources-list--smb" aria-live="polite"></div>
    </section>
    <div class="folders-action-menu" role="menu" hidden></div>
    <div class="source-dialog-backdrop" aria-hidden="true"></div>
    <section class="source-dialog" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="source-dialog-title">
      <h2 id="source-dialog-title"></h2>
      <p class="source-dialog__description"></p>
      <label class="source-dialog__field"><span>${t("sources.nameLabel")}</span><input type="text" maxlength="80" autocomplete="off" data-onscreen-keyboard="text"></label>
      <div class="source-dialog__actions"><button type="button" data-action="cancel">${t("sources.cancel")}</button><button class="source-dialog__confirm" type="button" data-action="confirm"></button></div>
    </section>
    <div class="source-dialog-backdrop smb-dialog-backdrop" aria-hidden="true"></div>
    <section class="source-dialog smb-dialog" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="smb-dialog-title">
      <h2 id="smb-dialog-title">Add Network Share</h2>
      <p class="source-dialog__description smb-dialog__error" role="alert"></p>
      <div class="smb-dialog__fields">
        <label><span>Name</span><input name="displayName" type="text" maxlength="80" autocomplete="off" data-onscreen-keyboard="text"></label>
        <label><span>Server</span><input name="server" type="text" maxlength="253" autocomplete="off" data-onscreen-keyboard="text"></label>
        <label><span>Share</span><input name="share" type="text" maxlength="255" autocomplete="off" data-onscreen-keyboard="text"></label>
        <fieldset class="smb-dialog__auth"><legend>Authentication</legend><div class="segmented-control">
          <button type="button" data-smb-auth="account" aria-pressed="true">Account</button>
          <button type="button" data-smb-auth="guest" aria-pressed="false">Guest</button>
        </div></fieldset>
        <label data-account-field><span>Username</span><input name="username" type="text" maxlength="255" autocomplete="username" data-onscreen-keyboard="text"></label>
        <label data-account-field><span>Password</span><span class="smb-password-field"><input name="password" type="password" maxlength="1024" autocomplete="current-password" data-onscreen-keyboard="password"><button type="button" data-smb-action="toggle-password">Show</button></span></label>
        <label data-account-field><span>Domain / Workgroup <small>Optional</small></span><input name="domain" type="text" maxlength="255" autocomplete="off" data-onscreen-keyboard="text"></label>
      </div>
      <div class="source-dialog__actions"><button type="button" data-smb-action="cancel">Cancel</button><button class="source-dialog__confirm" type="button" data-smb-action="confirm">Connect</button></div>
    </section>`;
  const localList = section.querySelector<HTMLElement>(".sources-list--local");
  const usbList = section.querySelector<HTMLElement>(".sources-list--usb");
  const removableLibraryList = section.querySelector<HTMLElement>(
    ".sources-list--removable-library",
  );
  const smbList = section.querySelector<HTMLElement>(".sources-list--smb");
  const smbAdd = section.querySelector<HTMLButtonElement>(".sources-smb-add");
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
  const smbDialog = section.querySelector<HTMLElement>(".smb-dialog");
  const smbBackdrop = section.querySelector<HTMLElement>(
    ".smb-dialog-backdrop",
  );
  const smbDialogTitle =
    section.querySelector<HTMLElement>("#smb-dialog-title");
  const smbError = section.querySelector<HTMLElement>(".smb-dialog__error");
  const smbConfirm = section.querySelector<HTMLButtonElement>(
    '[data-smb-action="confirm"]',
  );
  const smbCancel = section.querySelector<HTMLButtonElement>(
    '[data-smb-action="cancel"]',
  );
  const smbTogglePassword = section.querySelector<HTMLButtonElement>(
    '[data-smb-action="toggle-password"]',
  );
  const smbName = section.querySelector<HTMLInputElement>(
    '.smb-dialog input[name="displayName"]',
  );
  const smbServer = section.querySelector<HTMLInputElement>(
    '.smb-dialog input[name="server"]',
  );
  const smbShare = section.querySelector<HTMLInputElement>(
    '.smb-dialog input[name="share"]',
  );
  const smbUsername = section.querySelector<HTMLInputElement>(
    '.smb-dialog input[name="username"]',
  );
  const smbPassword = section.querySelector<HTMLInputElement>(
    '.smb-dialog input[name="password"]',
  );
  const smbDomain = section.querySelector<HTMLInputElement>(
    '.smb-dialog input[name="domain"]',
  );
  if (
    !localList ||
    !usbList ||
    !removableLibraryList ||
    !smbList ||
    !smbAdd ||
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
    !actionMenu ||
    !smbDialog ||
    !smbBackdrop ||
    !smbDialogTitle ||
    !smbError ||
    !smbConfirm ||
    !smbCancel ||
    !smbTogglePassword ||
    !smbName ||
    !smbServer ||
    !smbShare ||
    !smbUsername ||
    !smbPassword ||
    !smbDomain
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
  let menuSmb: SmbConnection | null = null;
  let menuTrigger: HTMLButtonElement | null = null;
  let libraryScanBusy = false;
  let activeScanId: string | null = null;
  let scanPending = false;
  let librarySnapshot = options.initialLibrarySnapshot;
  let currentSmbSnapshot = options.smbSnapshot;
  let smbDialogMode: "add" | "edit" | "remove" | null = null;
  let smbDialogConnection: SmbConnection | null = null;
  let smbAuthMode: "account" | "guest" = "account";
  let smbReturnFocus: HTMLElement | null = null;

  const setSmbAuthMode = (mode: "account" | "guest"): void => {
    smbAuthMode = mode;
    section
      .querySelectorAll<HTMLButtonElement>("[data-smb-auth]")
      .forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.smbAuth === mode),
        );
      });
    section
      .querySelectorAll<HTMLElement>("[data-account-field]")
      .forEach((field) => {
        field.hidden = mode === "guest";
      });
  };

  const closeSmbDialog = (): void => {
    smbDialog.classList.remove("source-dialog--open");
    smbBackdrop.classList.remove("source-dialog-backdrop--open");
    smbDialog.setAttribute("aria-hidden", "true");
    smbBackdrop.setAttribute("aria-hidden", "true");
    smbDialog.inert = true;
    smbDialogMode = null;
    smbDialogConnection = null;
    smbPassword.value = "";
    smbError.textContent = "";
    smbReturnFocus?.focus();
    smbReturnFocus = null;
  };

  const openSmbDialog = (
    mode: "add" | "edit" | "remove",
    connection: SmbConnection | null,
    trigger: HTMLElement,
  ): void => {
    smbDialogMode = mode;
    smbDialogConnection = connection;
    smbReturnFocus = trigger;
    smbError.textContent = "";
    smbName.value = connection?.displayName ?? "";
    smbServer.value = connection?.server ?? "";
    smbShare.value = connection?.share ?? "";
    smbUsername.value = connection?.username ?? "";
    smbPassword.value = "";
    smbDomain.value = connection?.domain ?? "";
    smbServer.readOnly = mode === "edit";
    smbShare.readOnly = mode === "edit";
    setSmbAuthMode(connection?.authMode ?? "account");
    const fields = smbDialog.querySelector<HTMLElement>(".smb-dialog__fields");
    if (fields) fields.hidden = mode === "remove";
    smbDialogTitle.textContent =
      mode === "add"
        ? "Add Network Share"
        : mode === "edit"
          ? "Edit Network Share"
          : `Remove “${connection?.displayName ?? ""}”?`;
    smbError.textContent =
      mode === "remove"
        ? "The saved connection and its Eidetic credential will be removed. Files on the NAS are not changed."
        : "";
    smbConfirm.textContent =
      mode === "add" ? "Connect" : mode === "edit" ? "Save" : "Remove";
    smbConfirm.classList.toggle(
      "source-dialog__confirm--danger",
      mode === "remove",
    );
    smbDialog.inert = false;
    smbDialog.setAttribute("aria-hidden", "false");
    smbBackdrop.setAttribute("aria-hidden", "false");
    smbDialog.classList.add("source-dialog--open");
    smbBackdrop.classList.add("source-dialog-backdrop--open");
    queueMicrotask(() => {
      (mode === "remove" ? smbCancel : smbName).focus();
      if (mode !== "remove") smbName.select();
    });
  };

  const smbRequest = (): AddSmbConnectionRequest => ({
    displayName: smbName.value,
    server: smbServer.value,
    share: smbShare.value,
    authMode: smbAuthMode,
    ...(smbAuthMode === "account"
      ? {
          username: smbUsername.value,
          password: smbPassword.value,
          domain: smbDomain.value,
        }
      : {}),
  });

  const positionActionMenu = (trigger: HTMLElement): void => {
    const rect = trigger.getBoundingClientRect();
    const contentBottom =
      document
        .querySelector<HTMLElement>(".mini-player")
        ?.getBoundingClientRect().top ?? window.innerHeight;
    const below = rect.bottom + 6;
    const top =
      below + actionMenu.offsetHeight <= contentBottom - 8
        ? below
        : Math.max(8, rect.top - actionMenu.offsetHeight - 6);
    actionMenu.style.top = `${String(top)}px`;
    actionMenu.style.left = `${String(Math.max(8, rect.right - 180))}px`;
  };

  const renderSmb = (snapshot: SmbSnapshot): void => {
    currentSmbSnapshot = snapshot;
    const fragment = document.createDocumentFragment();
    if (snapshot.connections.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sources-empty";
      empty.textContent = "No network shares configured.";
      fragment.append(empty);
    }
    for (const connection of snapshot.connections) {
      const card = document.createElement("article");
      card.className = "source-card source-card--smb";
      card.dataset.smbId = connection.id;
      card.innerHTML = `
        <span class="source-card__icon">${icon("ethernet")}</span>
        <div class="source-card__copy"><h3></h3><p></p><span class="source-card__status"></span></div>
        <div class="source-card__actions">
          <button type="button" data-smb-card-action="browse">Browse</button>
          <button class="source-card__more" type="button" data-smb-card-action="more" aria-label="Network share actions" aria-haspopup="menu">${icon("more")}</button>
        </div>`;
      const heading = card.querySelector<HTMLElement>("h3");
      const details = card.querySelector<HTMLElement>("p");
      const status = card.querySelector<HTMLElement>(".source-card__status");
      const browse = card.querySelector<HTMLButtonElement>(
        '[data-smb-card-action="browse"]',
      );
      const more = card.querySelector<HTMLButtonElement>(
        '[data-smb-card-action="more"]',
      );
      if (!heading || !details || !status || !browse || !more) continue;
      heading.textContent = connection.displayName;
      details.textContent = `${connection.server} / ${connection.share}`;
      status.textContent = connection.state.replaceAll("-", " ");
      status.dataset.availability = connection.readable
        ? "available"
        : connection.state === "connecting"
          ? "checking"
          : "unavailable";
      browse.disabled = !connection.readable;
      browse.addEventListener("click", () => {
        options.openSmbConnection(connection);
      });
      more.addEventListener("click", () => {
        closeMenu();
        menuSmb = connection;
        menuTrigger = more;
        const actions = [
          ...(connection.readable
            ? [{ action: "smb-browse", label: "Browse" }]
            : []),
          ...(connection.retryable
            ? [{ action: "smb-retry", label: "Retry" }]
            : []),
          { action: "smb-edit", label: "Edit" },
          { action: "smb-remove", label: "Remove" },
        ];
        actionMenu.replaceChildren(
          ...actions.map((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.role = "menuitem";
            button.dataset.action = item.action;
            button.textContent = item.label;
            return button;
          }),
        );
        actionMenu.hidden = false;
        positionActionMenu(more);
        actionMenu.querySelector<HTMLButtonElement>("button")?.focus();
      });
      fragment.append(card);
    }
    smbList.replaceChildren(fragment);
  };
  renderSmb(currentSmbSnapshot);

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
            positionActionMenu(more);
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
    menuSmb = null;
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
        positionActionMenu(more);
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
  smbAdd.addEventListener("click", () => {
    openSmbDialog("add", null, smbAdd);
  });
  smbCancel.addEventListener("click", closeSmbDialog);
  smbBackdrop.addEventListener("pointerup", closeSmbDialog);
  section
    .querySelectorAll<HTMLButtonElement>("[data-smb-auth]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        setSmbAuthMode(
          button.dataset.smbAuth === "guest" ? "guest" : "account",
        );
      });
    });
  smbTogglePassword.addEventListener("click", () => {
    const showing = smbPassword.type === "text";
    smbPassword.type = showing ? "password" : "text";
    smbTogglePassword.textContent = showing ? "Show" : "Hide";
    smbPassword.focus();
  });
  smbConfirm.addEventListener("click", () => {
    const mode = smbDialogMode;
    const connection = smbDialogConnection;
    if (!mode) return;
    smbError.textContent = "";
    if (mode !== "remove") {
      if (!smbName.value.trim()) {
        smbError.textContent = "Name is required.";
        smbName.focus();
        return;
      }
      if (
        mode === "add" &&
        (!smbServer.value.trim() || !smbShare.value.trim())
      ) {
        smbError.textContent = "Server and Share are required.";
        (!smbServer.value.trim() ? smbServer : smbShare).focus();
        return;
      }
      if (
        mode === "add" &&
        (/[\\/]/u.test(smbServer.value) ||
          /[\\/:\0]/u.test(smbShare.value) ||
          ["", ".", ".."].includes(smbShare.value.trim()))
      ) {
        smbError.textContent =
          "Enter a server without slashes and only the share name.";
        (/[\\/]/u.test(smbServer.value) ? smbServer : smbShare).focus();
        return;
      }
      if (
        smbAuthMode === "account" &&
        (!smbUsername.value.trim() || (mode === "add" && !smbPassword.value))
      ) {
        smbError.textContent =
          "Username and Password are required for Account authentication.";
        (!smbUsername.value.trim() ? smbUsername : smbPassword).focus();
        return;
      }
    }
    smbConfirm.disabled = true;
    const operation =
      mode === "add"
        ? options.smbApi.add(smbRequest())
        : mode === "edit" && connection
          ? options.smbApi.edit(connection.id, {
              displayName: smbName.value,
              authMode: smbAuthMode,
              ...(smbAuthMode === "account"
                ? {
                    username: smbUsername.value,
                    ...(smbPassword.value
                      ? { password: smbPassword.value }
                      : {}),
                    domain: smbDomain.value,
                  }
                : {}),
            })
          : connection
            ? options.smbApi.remove(connection.id)
            : Promise.reject(new Error("Network share not found."));
    void operation
      .then(() => {
        closeSmbDialog();
        options.showToast(
          mode === "add"
            ? "Network share connected."
            : mode === "edit"
              ? "Network share updated."
              : "Network share removed.",
          "success",
        );
      })
      .catch((error: unknown) => {
        smbError.textContent =
          error instanceof Error
            ? error.message
            : "Unable to update this network share.";
      })
      .finally(() => {
        if (!destroyed) smbConfirm.disabled = false;
      });
  });
  actionMenu.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-action]",
    );
    const source = menuSource;
    const device = menuDevice;
    const smbConnection = menuSmb;
    const trigger = menuTrigger;
    if (!button || !trigger || button.disabled) return;
    const action = button.dataset.action;
    closeMenu();
    if (action === "safe-remove") {
      if (device) void requestSafeRemoval(device, trigger);
      return;
    }
    if (action === "smb-browse" && smbConnection) {
      options.openSmbConnection(smbConnection);
      return;
    }
    if (action === "smb-retry" && smbConnection) {
      void options.smbApi.retry(smbConnection.id).catch((error: unknown) => {
        options.showToast(
          error instanceof Error ? error.message : "Retry failed.",
          "error",
        );
      });
      return;
    }
    if ((action === "smb-edit" || action === "smb-remove") && smbConnection) {
      openSmbDialog(
        action === "smb-edit" ? "edit" : "remove",
        smbConnection,
        trigger,
      );
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
    const activeDialog = smbDialog.classList.contains("source-dialog--open")
      ? smbDialog
      : dialog.classList.contains("source-dialog--open")
        ? dialog
        : null;
    if (!activeDialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (activeDialog === smbDialog) closeSmbDialog();
      else closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...activeDialog.querySelectorAll<HTMLElement>(
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
  smbDialog.inert = true;
  renderRemovableDevices(options.removableDevices);
  void load();
  return {
    element: section,
    updateRemovableDevices: renderRemovableDevices,
    updateSmbSnapshot: renderSmb,
    updateLibrarySnapshot,
    destroy() {
      destroyed = true;
      requestGeneration += 1;
      closeMenu();
      closeSmbDialog();
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("pointerdown", handleDocumentPointer);
    },
  };
}
