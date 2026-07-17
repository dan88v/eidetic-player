import { icon } from "./icons";
import { t } from "../i18n";

export interface TopBar {
  readonly element: HTMLElement;
  readonly menuButton: HTMLButtonElement;
  readonly homeButton: HTMLButtonElement;
  setTitle(title: string): void;
  setAudioDevice(device: string): void;
  destroy(): void;
}

function formatTime(): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function createTopBar(
  onMenuToggle: () => void,
  onHome: () => void,
): TopBar {
  const element = document.createElement("header");
  element.className = "top-bar";
  element.innerHTML = `
    <button class="top-bar__menu icon-button" type="button" aria-label="${t("nav.openMenu")}" aria-expanded="false" aria-controls="side-menu">${icon("menu")}</button>
    <button class="top-bar__home icon-button" type="button" aria-label="${t("nav.goToNowPlaying")}">${icon("home")}</button>
    <h1 class="top-bar__title"></h1>
    <div class="top-bar__info">
      <span class="top-bar__audio"></span>
      <time class="top-bar__clock" aria-label="${t("topBar.clockLabel")}"></time>
    </div>`;
  const menuButton = element.querySelector<HTMLButtonElement>(".top-bar__menu");
  const homeButton = element.querySelector<HTMLButtonElement>(".top-bar__home");
  const title = element.querySelector<HTMLHeadingElement>(".top-bar__title");
  const audio = element.querySelector<HTMLElement>(".top-bar__audio");
  const clock = element.querySelector<HTMLTimeElement>(".top-bar__clock");
  if (!menuButton || !homeButton || !title || !audio || !clock)
    throw new Error("Top bar is incomplete");
  const updateClock = (): void => {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = formatTime();
  };
  updateClock();
  const clockTimer = window.setInterval(updateClock, 60_000);
  menuButton.addEventListener("click", onMenuToggle);
  homeButton.addEventListener("click", onHome);
  return {
    element,
    menuButton,
    homeButton,
    setTitle(screenTitle) {
      title.textContent = screenTitle;
    },
    setAudioDevice(device) {
      audio.textContent = device;
    },
    destroy() {
      window.clearInterval(clockTimer);
    },
  };
}
