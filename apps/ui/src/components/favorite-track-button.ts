import { icon } from "./icons";
import { t } from "../i18n";
import type { FavoriteTrackStore } from "../state/favorite-track-store";

export interface FavoriteTrackButton {
  readonly element: HTMLButtonElement;
  destroy(): void;
}

export function createFavoriteTrackButton(options: {
  readonly trackId: string;
  readonly store: FavoriteTrackStore;
  readonly onError: (error: unknown) => void;
  readonly onChange?: (isFavorite: boolean) => void;
}): FavoriteTrackButton {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "favorite-track-button";
  element.innerHTML = icon("heart");
  let favorite = false;
  const render = (value: boolean | undefined): void => {
    favorite = value ?? false;
    element.classList.toggle("favorite-track-button--active", favorite);
    element.setAttribute("aria-pressed", String(favorite));
    element.setAttribute(
      "aria-label",
      t(favorite ? "favorites.remove" : "favorites.add"),
    );
  };
  const unsubscribe = options.store.subscribe(options.trackId, render);
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    if (element.disabled) return;
    const next = !favorite;
    element.disabled = true;
    void options.store
      .set(options.trackId, next)
      .then(() => options.onChange?.(next))
      .catch(options.onError)
      .finally(() => {
        element.disabled = false;
      });
  });
  return { element, destroy: unsubscribe };
}
