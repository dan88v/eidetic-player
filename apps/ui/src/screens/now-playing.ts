import type {
  PlayerState,
  RepeatMode,
} from "../../../../packages/shared/src/player";
import { composeTechnicalDetails } from "../../../../packages/shared/src/metadata";
import { createArtwork } from "../components/artwork";
import { icon } from "../components/icons";
import { createTimeline } from "../components/timeline";
import type { ComponentView } from "../components/types";
import { createVisualizer } from "../components/visualizer";
import { t } from "../i18n";
import type { TimelineStyle, VisualizerMode } from "../state/types";

export interface PlayerActions {
  readonly openFiles: () => void;
  readonly playPause: () => void;
  readonly previous: () => void;
  readonly next: () => void;
  readonly seek: (positionSeconds: number) => void;
  readonly shuffle: (enabled: boolean) => void;
  readonly repeat: (mode: RepeatMode) => void;
}

export interface NowPlayingOptions {
  readonly visualizerMode: VisualizerMode;
  readonly timelineStyle: TimelineStyle;
  readonly initialPlayerState: PlayerState;
  readonly actions: PlayerActions;
  readonly onVisualizerModeChange: (mode: VisualizerMode) => void;
  readonly onOpenQueue: (trigger: HTMLButtonElement) => void;
  readonly onOpenLibrary: () => void;
  readonly onToggleVolume: (trigger: HTMLButtonElement) => void;
}

function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}

export function createNowPlayingScreen(
  options: NowPlayingOptions,
): ComponentView {
  let playerState = options.initialPlayerState;
  const section = document.createElement("section");
  section.className = "screen now-playing";
  section.setAttribute("aria-labelledby", "screen-heading");
  section.innerHTML = `
    <h1 id="screen-heading" class="visually-hidden">${t("screen.nowPlaying.title")}</h1>
    <div class="now-playing__upper">
      <div class="now-playing__artwork"></div>
      <div class="now-playing__details">
        <p class="now-playing__track"></p>
        <p class="now-playing__artist"></p>
        <p class="now-playing__album"></p>
        <div class="now-playing__technical"><span></span><span></span></div>
        <button class="now-playing__open primary-action" type="button">${t("common.openFiles")}</button>
        <div class="now-playing__visualizer-slot"></div>
      </div>
    </div>
    <div class="now-playing__timeline-slot"></div>
    <div class="transport" aria-label="${t("nowPlaying.controls")}">
      <div class="transport__zone transport__zone--left">
        <button class="transport__button transport__button--small" type="button" data-control="library" aria-label="${t("nav.openLibrary")}">${icon("library")}<span>${t("screen.library.title")}</span></button>
        <button class="transport__button transport__button--small" type="button" data-control="volume" aria-label="${t("volume.open")}" aria-expanded="false" aria-controls="volume-popover">${icon("volume")}<span>${t("volume.label")}</span></button>
      </div>
      <div class="transport__zone transport__zone--center">
        <button class="transport__button transport__button--small transport__button--outer" type="button" data-control="shuffle" aria-pressed="false" aria-label="${t("nowPlaying.shuffle")}">${icon("shuffle")}<span>${t("nowPlaying.shuffle")}</span></button>
        <button class="transport__button transport__button--medium" type="button" data-control="previous" aria-label="${t("nowPlaying.previous")}">${icon("previous")}<span>${t("nowPlaying.previousLabel")}</span></button>
        <button class="transport__button transport__button--primary" type="button" data-control="play" aria-pressed="false" aria-label="${t("nowPlaying.play")}">${icon("play", "icon transport__play-icon")}</button>
        <button class="transport__button transport__button--medium" type="button" data-control="next" aria-label="${t("nowPlaying.next")}">${icon("next")}<span>${t("nowPlaying.nextLabel")}</span></button>
        <button class="transport__button transport__button--small transport__button--outer" type="button" data-control="repeat" aria-pressed="false" aria-label="${t("nowPlaying.repeatOff")}">${icon("repeat")}<span>${t("nowPlaying.repeat")}</span><b class="repeat-one" aria-hidden="true">1</b></button>
      </div>
      <div class="transport__zone transport__zone--right">
        <button class="transport__button transport__button--small" type="button" data-control="queue" aria-haspopup="dialog" aria-controls="queue-drawer" aria-expanded="false" aria-label="${t("nowPlaying.queue")}">${icon("queue")}<span>${t("screen.queue.title")}</span></button>
      </div>
    </div>`;

  const visualizer = createVisualizer({
    mode: options.visualizerMode,
    onModeChange: options.onVisualizerModeChange,
  });
  const timeline = createTimeline({
    style: options.timelineStyle,
    durationSeconds: 0,
    initialProgress: 0,
    onSeek: options.actions.seek,
  });
  const artwork = createArtwork({
    className: "now-playing__artwork",
    decorative: false,
    placeholderLabel: t("nowPlaying.artwork"),
  });
  section.querySelector(".now-playing__artwork")?.replaceWith(artwork.element);
  section
    .querySelector(".now-playing__visualizer-slot")
    ?.append(visualizer.element);
  section
    .querySelector(".now-playing__timeline-slot")
    ?.append(timeline.element);
  const title = section.querySelector<HTMLElement>(".now-playing__track");
  const artist = section.querySelector<HTMLElement>(".now-playing__artist");
  const album = section.querySelector<HTMLElement>(".now-playing__album");
  const technical = section.querySelectorAll<HTMLElement>(
    ".now-playing__technical span",
  );
  const technicalFormat = technical[0];
  const technicalSource = technical[1];
  const openButton =
    section.querySelector<HTMLButtonElement>(".now-playing__open");
  const playButton = section.querySelector<HTMLButtonElement>(
    '[data-control="play"]',
  );
  const previousButton = section.querySelector<HTMLButtonElement>(
    '[data-control="previous"]',
  );
  const nextButton = section.querySelector<HTMLButtonElement>(
    '[data-control="next"]',
  );
  const shuffleButton = section.querySelector<HTMLButtonElement>(
    '[data-control="shuffle"]',
  );
  const repeatButton = section.querySelector<HTMLButtonElement>(
    '[data-control="repeat"]',
  );
  const queueButton = section.querySelector<HTMLButtonElement>(
    '[data-control="queue"]',
  );
  const libraryButton = section.querySelector<HTMLButtonElement>(
    '[data-control="library"]',
  );
  const volumeButton = section.querySelector<HTMLButtonElement>(
    '[data-control="volume"]',
  );
  if (
    !title ||
    !artist ||
    !album ||
    !technicalFormat ||
    !technicalSource ||
    !openButton ||
    !playButton ||
    !previousButton ||
    !nextButton ||
    !shuffleButton ||
    !repeatButton ||
    !queueButton ||
    !libraryButton ||
    !volumeButton
  )
    throw new Error("Now Playing controls are missing");
  openButton.addEventListener("click", options.actions.openFiles);
  playButton.addEventListener("click", options.actions.playPause);
  previousButton.addEventListener("click", options.actions.previous);
  nextButton.addEventListener("click", options.actions.next);
  shuffleButton.addEventListener("click", () => {
    options.actions.shuffle(!playerState.shuffleEnabled);
  });
  repeatButton.addEventListener("click", () => {
    options.actions.repeat(nextRepeat(playerState.repeatMode));
  });
  libraryButton.addEventListener("click", options.onOpenLibrary);
  volumeButton.addEventListener("click", () => {
    options.onToggleVolume(volumeButton);
  });
  queueButton.addEventListener("click", () => {
    queueButton.setAttribute("aria-expanded", "true");
    options.onOpenQueue(queueButton);
  });

  const update = (state: PlayerState): void => {
    playerState = state;
    const track = state.currentTrack;
    const unavailable =
      state.status === "unavailable" ||
      (!state.mpvAvailable && state.status !== "loading");
    title.textContent =
      track?.title ??
      t(unavailable ? "nowPlaying.unavailableTitle" : "nowPlaying.emptyTitle");
    artist.textContent =
      track?.artist ??
      t(
        unavailable
          ? "nowPlaying.unavailableDescription"
          : "nowPlaying.emptyDescription",
      );
    album.textContent = track?.album ?? "";
    technicalFormat.textContent = track
      ? composeTechnicalDetails(track).join(" · ")
      : "";
    technicalSource.textContent = "";
    const artworkAlt =
      track?.album && track.artist
        ? t("artwork.albumBy")
            .replace("{album}", track.album)
            .replace("{artist}", track.artist)
        : t("artwork.album");
    artwork.update(track?.artwork ?? null, artworkAlt);
    openButton.hidden = Boolean(track);
    openButton.textContent = unavailable
      ? t("common.openFilesMpvMissing")
      : t("common.openFiles");
    const usable = Boolean(track) && state.status !== "loading";
    playButton.disabled = !usable;
    previousButton.disabled = !usable;
    nextButton.disabled = !usable;
    shuffleButton.disabled = !state.mpvAvailable;
    playButton.setAttribute("aria-pressed", String(usable && !state.paused));
    playButton.innerHTML = icon(
      usable && !state.paused ? "pause" : "play",
      "icon transport__play-icon",
    );
    shuffleButton.setAttribute("aria-pressed", String(state.shuffleEnabled));
    volumeButton.innerHTML = `${icon(
      state.muted || state.volume === 0 ? "volumeMuted" : "volume",
    )}<span>${t("volume.label")}</span>`;
    volumeButton.setAttribute(
      "aria-label",
      `${t("volume.open")} · ${
        state.muted ? t("volume.muted") : `${String(Math.round(state.volume))}%`
      }`,
    );
    repeatButton.setAttribute(
      "aria-pressed",
      String(state.repeatMode !== "off"),
    );
    repeatButton.dataset.mode = state.repeatMode;
    repeatButton.setAttribute(
      "aria-label",
      t(
        state.repeatMode === "all"
          ? "nowPlaying.repeatAll"
          : state.repeatMode === "one"
            ? "nowPlaying.repeatOne"
            : "nowPlaying.repeatOff",
      ),
    );
    timeline.setPlayback(state.positionSeconds, state.durationSeconds);
    timeline.setEnabled(usable);
  };
  update(playerState);
  return {
    element: section,
    updatePlayerState: update,
    destroy() {
      visualizer.destroy();
      timeline.destroy();
      artwork.destroy();
    },
  };
}
