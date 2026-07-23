import { icon } from "./icons";
import { t } from "../i18n";

export interface TopBar {
  readonly element: HTMLElement;
  readonly menuButton: HTMLButtonElement;
  setTitle(title: string): void;
  setDetailActions(
    back: (() => void) | null,
    more: ((trigger: HTMLButtonElement) => void) | null,
  ): void;
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
      <!-- Placeholder system indicators; real status binding belongs to a future step. -->
      <span class="top-bar__system-icons" aria-hidden="true">
        <span class="top-bar__system-icon">${icon("ethernet")}</span>
        <span class="top-bar__system-icon">${icon("wifi")}</span>
        <span class="top-bar__system-icon">${icon("usb")}</span>
      </span>
      <time class="top-bar__clock" aria-label="${t("topBar.clockLabel")}"></time>
    </div>`;
  const menuButton = element.querySelector<HTMLButtonElement>(".top-bar__menu");
  const title = element.querySelector<HTMLHeadingElement>(".top-bar__title");
  const clock = element.querySelector<HTMLTimeElement>(".top-bar__clock");
  const info = element.querySelector<HTMLElement>(".top-bar__info");
  if (!menuButton || !title || !clock || !info)
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
    destroy() {
      window.clearInterval(clockTimer);
    },
  };
}
