import type { PlayerState } from "../../../../packages/shared/src/player";
import { icon } from "../components/icons";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";

export function createSourcesScreen(
  initialState: PlayerState,
  onOpenFiles: () => void,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen sources-screen";
  section.innerHTML = `
    <header class="screen-header"><span class="screen-header__icon">${icon("sources")}</span><div><p class="screen-header__eyebrow">${t("app.theme")}</p><h1>${t("screen.sources.title")}</h1><p class="screen-header__description">${t("screen.sources.description")}</p></div></header>
    <article class="source-card"><span class="source-card__icon">${icon("library")}</span><div class="source-card__copy"><h2>${t("sources.localFiles")}</h2><p>${t("sources.localDescription")}</p><span class="source-card__status"></span></div><button class="primary-action" type="button">${t("common.openFiles")}</button></article>`;
  const button = section.querySelector<HTMLButtonElement>("button");
  const status = section.querySelector<HTMLElement>(".source-card__status");
  if (!button || !status) throw new Error("Sources screen is incomplete");
  button.addEventListener("click", onOpenFiles);
  const update = (state: PlayerState): void => {
    status.textContent = t(
      state.mpvAvailable ? "sources.mpvReady" : "sources.mpvUnavailable",
    );
    status.dataset.available = String(state.mpvAvailable);
  };
  update(initialState);
  return {
    element: section,
    updatePlayerState: update,
    destroy() {
      // The screen owns no external resources.
    },
  };
}
