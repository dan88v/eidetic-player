import { icon } from "./icons";
import type { FavoriteTrackStore } from "../state/favorite-track-store";

export interface FavoriteTrackIndicator {
  readonly element: HTMLElement;
  setTrack(trackId: string | null): void;
  setSuppressed(suppressed: boolean): void;
  destroy(): void;
}

export function favoriteTrackIndicatorHidden(
  isFavorite: boolean | undefined,
  suppressed: boolean,
): boolean {
  return suppressed || isFavorite !== true;
}

export function createFavoriteTrackIndicator(
  store: FavoriteTrackStore,
): FavoriteTrackIndicator {
  const element = document.createElement("span");
  element.className = "favorite-track-indicator";
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = icon("heart");
  let trackId: string | null = null;
  let isFavorite: boolean | undefined;
  let suppressed = false;
  let unsubscribe: (() => void) | null = null;
  const renderVisibility = (): void => {
    element.hidden = favoriteTrackIndicatorHidden(isFavorite, suppressed);
  };

  return {
    element,
    setTrack(nextTrackId) {
      if (nextTrackId === trackId) return;
      unsubscribe?.();
      unsubscribe = null;
      trackId = nextTrackId;
      isFavorite = undefined;
      renderVisibility();
      if (!nextTrackId) return;
      unsubscribe = store.subscribe(nextTrackId, (nextIsFavorite) => {
        isFavorite = nextIsFavorite;
        renderVisibility();
      });
    },
    setSuppressed(nextSuppressed) {
      if (nextSuppressed === suppressed) return;
      suppressed = nextSuppressed;
      renderVisibility();
    },
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      trackId = null;
      isFavorite = undefined;
      suppressed = true;
      renderVisibility();
    },
  };
}
