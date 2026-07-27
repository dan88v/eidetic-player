import { icon } from "./icons";
import { config } from "../config";
import { t } from "../i18n";
import { navigationItems } from "../navigation/routes";
import type { ScreenId } from "../state/types";
import type { MusicBrowsingVisibility } from "../state/types";
import type { BuildInfo } from "../../../../packages/shared/src/system";
import { createReliableTouchScroller } from "../utils/reliable-touch-scroll";

export interface SideMenu {
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  setOpen(open: boolean): void;
  setActiveScreen(screen: ScreenId): void;
  focusInitialControl(): void;
  containFocus(event: KeyboardEvent): void;
  destroy(): void;
  setMusicBrowsingVisibility(value: MusicBrowsingVisibility): void;
  readonly powerButton: HTMLButtonElement | null;
}

export interface SideMenuOptions {
  readonly buildInfo: BuildInfo;
  readonly onClose: () => void;
  readonly onNavigate: (screen: ScreenId) => void;
  readonly onPower?: (trigger: HTMLButtonElement) => void;
  readonly showPower?: boolean;
}

const focusableSelector =
  'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function createSideMenu(options: SideMenuOptions): SideMenu {
  const backdrop = document.createElement("div");
  backdrop.className = "menu-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  const element = document.createElement("aside");
  element.id = "side-menu";
  element.className = "side-menu";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("aria-label", t("nav.label"));
  element.innerHTML = `
    <div class="side-menu__header">
      <span class="side-menu__brand">${config.appName}</span>
      <button class="icon-button side-menu__close" type="button" aria-label="${t("nav.closeMenu")}">${icon("close")}</button>
    </div>
    <nav class="side-menu__nav" aria-label="${t("nav.label")}">
      ${navigationItems
        .map(
          (item) => `
            <button class="nav-item" type="button" data-screen="${item.id}">
              <span class="nav-item__icon">${icon(item.icon)}</span>
              <span>${t(item.titleKey)}</span>
            </button>
          `,
        )
        .join("")}
    </nav>
    <div class="side-menu__footer"><span class="side-menu__build">Build ${options.buildInfo.shortCommitSha}</span>${
      options.showPower
        ? `<button class="icon-button side-menu__power" type="button" aria-label="Power" title="Power">${icon("power")}</button>`
        : ""
    }</div>
  `;

  const closeButton =
    element.querySelector<HTMLButtonElement>(".side-menu__close");
  const nav = element.querySelector<HTMLElement>(".side-menu__nav");
  if (!closeButton || !nav) throw new Error("Menu is incomplete");
  const touchScroller = createReliableTouchScroller(nav);
  closeButton.addEventListener("click", options.onClose);
  const powerButton =
    element.querySelector<HTMLButtonElement>(".side-menu__power");
  powerButton?.addEventListener("click", () => options.onPower?.(powerButton));
  backdrop.addEventListener("pointerup", options.onClose);

  for (const button of element.querySelectorAll<HTMLButtonElement>(
    ".nav-item",
  )) {
    button.addEventListener("click", () => {
      const screen = button.dataset.screen as ScreenId | undefined;
      if (screen) options.onNavigate(screen);
    });
  }

  return {
    element,
    backdrop,
    closeButton,
    powerButton,
    setOpen(open) {
      element.classList.toggle("side-menu--open", open);
      backdrop.classList.toggle("menu-backdrop--visible", open);
      element.setAttribute("aria-hidden", String(!open));
      element.inert = !open;
    },
    setActiveScreen(screen) {
      for (const button of element.querySelectorAll<HTMLButtonElement>(
        ".nav-item",
      )) {
        const active = button.dataset.screen === screen;
        button.classList.toggle("nav-item--active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    },
    focusInitialControl() {
      closeButton.focus();
    },
    containFocus(event) {
      if (event.key !== "Tab") return;
      const controls = [
        ...element.querySelectorAll<HTMLElement>(focusableSelector),
      ];
      const first = controls.at(0);
      const last = controls.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    destroy() {
      touchScroller.destroy();
    },
    setMusicBrowsingVisibility(value) {
      const folders = element.querySelector<HTMLElement>(
        '[data-screen="folders"]',
      );
      const library = element.querySelector<HTMLElement>(
        '[data-screen="library"]',
      );
      const favorites = element.querySelector<HTMLElement>(
        '[data-screen="favorites"]',
      );
      const recentlyPlayed = element.querySelector<HTMLElement>(
        '[data-screen="recentlyPlayed"]',
      );
      const playlists = element.querySelector<HTMLElement>(
        '[data-screen="playlists"]',
      );
      if (folders) folders.hidden = value === "library";
      if (library) library.hidden = value === "folders";
      if (favorites) favorites.hidden = value === "folders";
      if (recentlyPlayed) recentlyPlayed.hidden = value === "folders";
      if (playlists) playlists.hidden = value === "folders";
    },
  };
}
