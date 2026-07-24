import { icon } from "./icons";
import { t } from "../i18n";
import type { NetworkSnapshot } from "../../../../packages/shared/src/network";
import type { SmbSnapshot } from "../../../../packages/shared/src/smb";

export interface TopBar {
  readonly element: HTMLElement;
  readonly menuButton: HTMLButtonElement;
  setTitle(title: string): void;
  setDetailActions(
    back: (() => void) | null,
    more: ((trigger: HTMLButtonElement) => void) | null,
  ): void;
  updateNetwork(snapshot: NetworkSnapshot): void;
  updateSmb(snapshot: SmbSnapshot): void;
  destroy(): void;
}

function formatTime(): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function createTopBar(onMenuToggle: () => void): TopBar {
  const element = document.createElement("header");
  element.className = "top-bar";
  element.innerHTML = `
    <button class="top-bar__menu icon-button" type="button" aria-label="${t("nav.openMenu")}" aria-expanded="false" aria-controls="side-menu">${icon("menu")}</button>
    <h1 class="top-bar__title"></h1>
    <div class="top-bar__info">
      <span class="top-bar__system-icons" aria-hidden="true">
        <span class="top-bar__system-icon" data-network-indicator="wired">${icon("ethernet")}</span>
        <span class="top-bar__system-icon" data-network-indicator="wifi">${icon("wifi")}</span>
        <span class="top-bar__system-icon">${icon("usb")}</span>
      </span>
      <button class="top-bar__smb" type="button" aria-label="SMB connection status" aria-expanded="false" hidden>${icon("sources")}</button>
      <div class="top-bar__smb-popover" role="status" hidden><strong></strong><span></span></div>
      <time class="top-bar__clock" aria-label="${t("topBar.clockLabel")}"></time>
    </div>`;
  const menuButton = element.querySelector<HTMLButtonElement>(".top-bar__menu");
  const title = element.querySelector<HTMLHeadingElement>(".top-bar__title");
  const clock = element.querySelector<HTMLTimeElement>(".top-bar__clock");
  const info = element.querySelector<HTMLElement>(".top-bar__info");
  const wiredIndicator = element.querySelector<HTMLElement>(
    '[data-network-indicator="wired"]',
  );
  const wifiIndicator = element.querySelector<HTMLElement>(
    '[data-network-indicator="wifi"]',
  );
  const smbButton = element.querySelector<HTMLButtonElement>(".top-bar__smb");
  const smbPopover = element.querySelector<HTMLElement>(
    ".top-bar__smb-popover",
  );
  const smbSummary = smbPopover?.querySelector<HTMLElement>("strong");
  const smbDetail = smbPopover?.querySelector<HTMLElement>("span");
  if (
    !menuButton ||
    !title ||
    !clock ||
    !info ||
    !wiredIndicator ||
    !wifiIndicator ||
    !smbButton ||
    !smbPopover ||
    !smbSummary ||
    !smbDetail
  )
    throw new Error("Top bar is incomplete");
  const moreButton = document.createElement("button");
  moreButton.className = "top-bar__more icon-button";
  moreButton.type = "button";
  moreButton.setAttribute("aria-label", "Playlist actions");
  moreButton.innerHTML = icon("more");
  moreButton.hidden = true;
  info.prepend(moreButton);
  let backAction: (() => void) | null = null;
  let moreAction: ((trigger: HTMLButtonElement) => void) | null = null;
  const updateClock = (): void => {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = formatTime();
  };
  updateClock();
  const clockTimer = window.setInterval(updateClock, 60_000);
  menuButton.addEventListener("click", () => {
    if (backAction) backAction();
    else onMenuToggle();
  });
  moreButton.addEventListener("click", () => moreAction?.(moreButton));
  const closeSmbPopover = (): void => {
    smbPopover.hidden = true;
    smbButton.setAttribute("aria-expanded", "false");
  };
  smbButton.addEventListener("click", () => {
    smbPopover.hidden = !smbPopover.hidden;
    smbButton.setAttribute("aria-expanded", String(!smbPopover.hidden));
  });
  const closeSmbOutside = (event: PointerEvent): void => {
    if (
      !smbPopover.hidden &&
      !smbPopover.contains(event.target as Node) &&
      !smbButton.contains(event.target as Node)
    )
      closeSmbPopover();
  };
  const closeSmbEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !smbPopover.hidden) {
      event.preventDefault();
      closeSmbPopover();
      smbButton.focus();
    }
  };
  document.addEventListener("pointerdown", closeSmbOutside);
  document.addEventListener("keydown", closeSmbEscape);
  return {
    element,
    menuButton,
    setTitle(screenTitle) {
      title.textContent = screenTitle;
      title.title = screenTitle;
    },
    setDetailActions(back, more) {
      backAction = back;
      moreAction = more;
      menuButton.innerHTML = icon(back ? "back" : "menu");
      menuButton.setAttribute("aria-label", back ? "Back" : t("nav.openMenu"));
      moreButton.hidden = more === null;
    },
    updateNetwork(snapshot) {
      wiredIndicator.classList.toggle(
        "top-bar__system-icon--active",
        snapshot.wiredAdapters.some((adapter) => adapter.connected),
      );
      wifiIndicator.classList.toggle(
        "top-bar__system-icon--active",
        snapshot.wifiAdapters.some((adapter) => adapter.connected),
      );
      wifiIndicator.classList.toggle(
        "top-bar__system-icon--connecting",
        snapshot.operationState === "connecting",
      );
    },
    updateSmb(snapshot) {
      smbButton.hidden = snapshot.configuredCount === 0;
      if (smbButton.hidden) {
        closeSmbPopover();
        return;
      }
      const hasError = snapshot.unavailableCount > 0;
      const allConnected =
        snapshot.configuredCount > 0 &&
        snapshot.connectedCount === snapshot.configuredCount;
      smbButton.dataset.state = hasError
        ? "error"
        : allConnected
          ? "connected"
          : "connecting";
      const unavailable = snapshot.connections.filter(
        (connection) =>
          !connection.readable && connection.state !== "connecting",
      );
      const authentication = unavailable.find(
        (connection) => connection.state === "authentication-required",
      );
      if (authentication) {
        smbSummary.textContent = "SMB · Authentication required";
        smbDetail.textContent = authentication.displayName;
      } else if (snapshot.unavailableCount > 0) {
        smbSummary.textContent = `SMB · ${String(snapshot.unavailableCount)} of ${String(snapshot.configuredCount)} unavailable`;
        smbDetail.textContent =
          snapshot.unavailableCount === 1
            ? `${unavailable[0]?.displayName ?? "Network share"} is offline`
            : "";
      } else if (snapshot.connectingCount > 0) {
        smbSummary.textContent = "SMB · Connecting…";
        smbDetail.textContent = "";
      } else {
        smbSummary.textContent = `SMB · ${String(snapshot.connectedCount)} connected`;
        smbDetail.textContent = "";
      }
      smbDetail.hidden = smbDetail.textContent === "";
    },
    destroy() {
      window.clearInterval(clockTimer);
      document.removeEventListener("pointerdown", closeSmbOutside);
      document.removeEventListener("keydown", closeSmbEscape);
    },
  };
}
