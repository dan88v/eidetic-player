import { icon } from "./icons";
import type { FavoriteTrackStore } from "../state/favorite-track-store";

export interface FavoriteTrackIndicator {
  readonly element: HTMLElement;
  setTrack(trackId: string | null): void;
  destroy(): void;
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
  let unsubscribe: (() => void) | null = null;

  return {
    element,
    setTrack(nextTrackId) {
      if (nextTrackId === trackId) return;
      unsubscribe?.();
      unsubscribe = null;
      trackId = nextTrackId;
      element.hidden = true;
      if (!nextTrackId) return;
      unsubscribe = store.subscribe(nextTrackId, (isFavorite) => {
        element.hidden = isFavorite !== true;
      });
    },
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      trackId = null;
    },
  };
}
