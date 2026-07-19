import type { PlayerState } from "../../../../packages/shared/src/player";
import { icon } from "./icons";
import { t } from "../i18n";
import { createArtwork } from "./artwork";
import { createTrackPresentationSnapshot } from "../state/track-transition-coordinator";

export interface MiniPlayer {
  readonly element: HTMLElement;
  update(state: PlayerState): void;
  destroy(): void;
}

export function createMiniPlayer(
  onOpenNowPlaying: () => void,
  onPlayPause: () => void,
  onPrevious: () => void,
  onNext: () => void,
  onSeek: (positionSeconds: number) => void,
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
      <span class="mini-player__transport">
        <button class="icon-button" data-control="previous" type="button" aria-label="${t("nowPlaying.previous")}">${icon("previous")}</button>
        <button class="icon-button icon-button--primary" data-control="play" type="button" aria-label="${t("miniPlayer.play")}">${icon("play")}</button>
        <button class="icon-button" data-control="next" type="button" aria-label="${t("nowPlaying.next")}">${icon("next")}</button>
      </span>
      <button class="icon-button mini-player__home" data-control="home" type="button" aria-label="${t("nav.goToNowPlaying")}">${icon("home")}</button>
    </div>
    <div class="mini-player__timeline" role="slider" aria-label="${t("timeline.label")}" aria-valuemin="0" aria-valuemax="100" tabindex="-1">
      <span class="mini-player__timeline-rail"><span class="mini-player__timeline-fill"></span><span class="mini-player__timeline-thumb"></span></span>
    </div>`;
  const summary = player.querySelector<HTMLButtonElement>(
    ".mini-player__summary",
  );
  const playButton = player.querySelector<HTMLButtonElement>(
    '[data-control="play"]',
  );
  const previousButton = player.querySelector<HTMLButtonElement>(
    '[data-control="previous"]',
  );
  const nextButton = player.querySelector<HTMLButtonElement>(
    '[data-control="next"]',
  );
  const openButton = player.querySelector<HTMLButtonElement>(
    '[data-control="home"]',
  );
  const title = player.querySelector<HTMLElement>(".mini-player__copy strong");
  const artist = player.querySelector<HTMLElement>(".mini-player__copy span");
  const timeline = player.querySelector<HTMLElement>(".mini-player__timeline");
  const fill = player.querySelector<HTMLElement>(".mini-player__timeline-fill");
  const thumb = player.querySelector<HTMLElement>(
    ".mini-player__timeline-thumb",
  );
  if (
    !summary ||
    !previousButton ||
    !playButton ||
    !nextButton ||
    !openButton ||
    !title ||
    !artist ||
    !timeline ||
    !fill ||
    !thumb
  )
    throw new Error("Mini player controls are missing");
  let duration = 0;
  let progress = 0;
  let dragging = false;
  const setProgress = (value: number): void => {
    progress = Math.max(0, Math.min(1, value));
    const percentage = progress * 100;
    fill.style.width = `${String(percentage)}%`;
    thumb.style.left = `${String(percentage)}%`;
    timeline.setAttribute("aria-valuenow", String(Math.round(percentage)));
  };
  const updatePointer = (event: PointerEvent): void => {
    const bounds = timeline.getBoundingClientRect();
    setProgress((event.clientX - bounds.left) / bounds.width);
  };
  timeline.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (!duration) return;
    dragging = true;
    timeline.classList.add("mini-player__timeline--dragging");
    timeline.setPointerCapture(event.pointerId);
    updatePointer(event);
  });
  timeline.addEventListener("pointermove", (event) => {
    event.stopPropagation();
    if (timeline.hasPointerCapture(event.pointerId)) updatePointer(event);
  });
  timeline.addEventListener("pointerup", (event) => {
    event.stopPropagation();
    if (!timeline.hasPointerCapture(event.pointerId)) return;
    updatePointer(event);
    timeline.releasePointerCapture(event.pointerId);
    dragging = false;
    timeline.classList.remove("mini-player__timeline--dragging");
    onSeek(duration * progress);
  });
  timeline.addEventListener("pointercancel", (event) => {
    event.stopPropagation();
    if (timeline.hasPointerCapture(event.pointerId))
      timeline.releasePointerCapture(event.pointerId);
    dragging = false;
    timeline.classList.remove("mini-player__timeline--dragging");
  });
  timeline.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  timeline.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (!duration) return;
    const delta =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -0.01
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? 0.01
          : null;
    if (delta !== null) setProgress(progress + delta);
    else if (event.key === "Home") setProgress(0);
    else if (event.key === "End") setProgress(1);
    else return;
    event.preventDefault();
    onSeek(duration * progress);
  });
  const artwork = createArtwork({
    className: "mini-player__artwork",
    decorative: true,
  });
  player.querySelector(".mini-player__artwork")?.replaceWith(artwork.element);
  summary.addEventListener("click", onOpenNowPlaying);
  const bindAction = (button: HTMLButtonElement, action: () => void): void => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      action();
    });
  };
  bindAction(previousButton, onPrevious);
  bindAction(playButton, onPlayPause);
  bindAction(nextButton, onNext);
  bindAction(openButton, onOpenNowPlaying);
  const setText = (element: HTMLElement, value: string): void => {
    if (element.textContent === value) return;
    if (element.childNodes.length === 1 && element.firstChild instanceof Text)
      element.firstChild.data = value;
    else element.textContent = value;
  };
  let playIconName = "";
  return {
    element: player,
    update(state) {
      const presentation = createTrackPresentationSnapshot(state);
      duration = presentation.durationSeconds;
      timeline.tabIndex = duration > 0 ? 0 : -1;
      timeline.setAttribute("aria-disabled", String(duration <= 0));
      if (!dragging)
        setProgress(duration ? presentation.positionSeconds / duration : 0);
      setText(title, presentation.title ?? "");
      setText(artist, presentation.artist ?? "");
      artwork.update(presentation.artwork, "", presentation.generation);
      const disabled = !state.currentTrack || state.status === "loading";
      previousButton.disabled = disabled;
      playButton.disabled = disabled;
      nextButton.disabled = disabled;
      const nextPlayIcon = state.paused ? "play" : "pause";
      if (nextPlayIcon !== playIconName) {
        playIconName = nextPlayIcon;
        playButton.innerHTML = icon(nextPlayIcon);
      }
      playButton.setAttribute(
        "aria-pressed",
        String(!disabled && !state.paused),
      );
    },
    destroy() {
      artwork.destroy();
    },
  };
}
