import type { PlayerState } from "../../../../packages/shared/src/player";
import { icon } from "./icons";
import { t } from "../i18n";
import { createArtwork } from "./artwork";

export interface MiniPlayer {
  readonly element: HTMLElement;
  update(state: PlayerState): void;
  destroy(): void;
}

export function createMiniPlayer(
  onOpenNowPlaying: () => void,
  onPlayPause: () => void,
): MiniPlayer {
  const player = document.createElement("aside");
  player.className = "mini-player";
  player.setAttribute("aria-label", t("miniPlayer.label"));
  player.innerHTML = `
    <button class="mini-player__summary" type="button" aria-label="${t("miniPlayer.openNowPlaying")}">
      <span class="mini-player__artwork"></span>
      <span class="mini-player__copy"><strong></strong><span></span></span>
    </button>
    <div class="mini-player__actions">
      <button class="icon-button icon-button--quiet" type="button" aria-label="${t("miniPlayer.play")}">${icon("play")}</button>
      <button class="icon-button icon-button--primary" type="button" aria-label="${t("miniPlayer.openNowPlaying")}">${icon("back")}</button>
    </div>`;
  const summary = player.querySelector<HTMLButtonElement>(
    ".mini-player__summary",
  );
  const playButton = player.querySelector<HTMLButtonElement>(
    ".mini-player__actions button:first-child",
  );
  const openButton = player.querySelector<HTMLButtonElement>(
    ".mini-player__actions button:last-child",
  );
  const title = player.querySelector<HTMLElement>(".mini-player__copy strong");
  const artist = player.querySelector<HTMLElement>(".mini-player__copy span");
  if (!summary || !playButton || !openButton || !title || !artist)
    throw new Error("Mini player controls are missing");
  const artwork = createArtwork({
    className: "mini-player__artwork",
    decorative: true,
  });
  player.querySelector(".mini-player__artwork")?.replaceWith(artwork.element);
  summary.addEventListener("click", onOpenNowPlaying);
  openButton.addEventListener("click", onOpenNowPlaying);
  playButton.addEventListener("click", onPlayPause);
  return {
    element: player,
    update(state) {
      title.textContent =
        state.currentTrack?.title ?? t("nowPlaying.emptyTitle");
      artist.textContent =
        state.currentTrack?.artist ?? t("nowPlaying.emptyDescription");
      artwork.update(state.currentTrack?.artwork ?? null, "");
      playButton.disabled = !state.currentTrack || state.status === "loading";
      playButton.innerHTML = icon(state.paused ? "play" : "pause");
    },
    destroy() {
      artwork.destroy();
    },
  };
}
