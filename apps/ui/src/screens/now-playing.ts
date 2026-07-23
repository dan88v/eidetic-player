import type {
  PlayerState,
  RepeatMode,
} from "../../../../packages/shared/src/player";
import { createArtwork } from "../components/artwork";
import { icon } from "../components/icons";
import { createTimeline } from "../components/timeline";
import type { ComponentView } from "../components/types";
import { createVisualizer } from "../components/visualizer";
import { t } from "../i18n";
import type {
  TimelineStyle,
  TimelineTimeMode,
  VisualizerMode,
  MusicBrowsingVisibility,
} from "../state/types";
import { createTrackPresentationSnapshot } from "../state/track-transition-coordinator";
import { WaveformLoader } from "../timeline/waveform-loader";
import type { FavoriteTrackStore } from "../state/favorite-track-store";
import { createFavoriteTrackIndicator } from "../components/favorite-track-indicator";
import type { RemovableDeviceListResponse } from "../../../../packages/shared/src/library";

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
  readonly timelineTimeMode: TimelineTimeMode;
  readonly musicBrowsingVisibility: MusicBrowsingVisibility;
  readonly initialPlayerState: PlayerState;
  readonly actions: PlayerActions;
  readonly onVisualizerModeChange: (mode: VisualizerMode) => void;
  readonly onTimelineTimeModeChange: (mode: TimelineTimeMode) => void;
  readonly onOpenQueue: (trigger: HTMLButtonElement) => void;
  readonly onOpenLibrary: () => void;
  readonly onOpenFolders: () => void;
  readonly onOpenUsbStorage: (trigger?: HTMLElement) => void;
  readonly removableDevices: RemovableDeviceListResponse;
  readonly onToggleVolume: (trigger: HTMLButtonElement) => void;
  readonly favorites: FavoriteTrackStore;
}

function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}

export function createNowPlayingScreen(
  options: NowPlayingOptions,
): ComponentView {
  let playerState = options.initialPlayerState;
  let waveformQueueItemId: string | null = null;
  const waveformLoader = new WaveformLoader();
  const section = document.createElement("section");
  section.className = "screen now-playing";
  section.setAttribute("aria-labelledby", "screen-heading");
  section.innerHTML = `
    <h1 id="screen-heading" class="visually-hidden">${t("screen.nowPlaying.title")}</h1>
    <div class="now-playing__upper">
      <div class="now-playing__artwork"></div>
      <div class="now-playing__details">
        <div class="now-playing__title-row"><p class="now-playing__track"></p></div>
        <p class="now-playing__artist"></p>
        <p class="now-playing__album"></p>
        <div class="now-playing__technical"><span></span><span></span></div>
        <div class="now-playing__visualizer-slot"></div>
      </div>
    </div>
    <div class="now-playing__timeline-slot"></div>
    <div class="transport" aria-label="${t("nowPlaying.controls")}">
      <div class="transport__zone transport__zone--left">
        <button class="transport__button transport__button--small" type="button" data-control="library" aria-label="${t("nav.openLibrary")}">${icon("library")}<span>${t("screen.library.title")}</span></button>
        <button class="transport__button transport__button--small" type="button" data-control="folders" aria-label="${t("nav.openFolders")}">${icon("folder")}<span>${t("screen.folders.title")}</span></button>
        <button class="transport__button transport__button--small transport__button--usb-storage" type="button" data-control="usb-storage" aria-label="USB Storage">${icon("usbStorage")}<span>USB</span></button>
      </div>
      <div class="transport__zone transport__zone--center">
        <button class="transport__button transport__button--small transport__button--outer" type="button" data-control="shuffle" aria-pressed="false" aria-label="${t("nowPlaying.shuffle")}">${icon("shuffle")}<span>${t("nowPlaying.shuffle")}</span></button>
        <button class="transport__button transport__button--medium" type="button" data-control="previous" aria-label="${t("nowPlaying.previous")}">${icon("previous")}<span>${t("nowPlaying.previousLabel")}</span></button>
        <button class="transport__button transport__button--primary" type="button" data-control="play" aria-pressed="false" aria-label="${t("nowPlaying.play")}">${icon("play", "icon transport__play-icon")}</button>
        <button class="transport__button transport__button--medium" type="button" data-control="next" aria-label="${t("nowPlaying.next")}">${icon("next")}<span>${t("nowPlaying.nextLabel")}</span></button>
        <button class="transport__button transport__button--small transport__button--outer" type="button" data-control="repeat" aria-pressed="false" aria-label="${t("nowPlaying.repeatOff")}">${icon("repeat")}<span>${t("nowPlaying.repeat")}</span><b class="repeat-one" aria-hidden="true">1</b></button>
      </div>
      <div class="transport__zone transport__zone--right">
        <button class="transport__button transport__button--small" type="button" data-control="volume" aria-label="${t("volume.open")}" aria-expanded="false" aria-controls="volume-popover">${icon("volume")}<span>${t("volume.label")}</span></button>
        <button class="transport__button transport__button--small" type="button" data-control="queue" aria-haspopup="dialog" aria-controls="queue-drawer" aria-expanded="false" aria-label="${t("nowPlaying.queue")}">${icon("queue")}<span>${t("screen.queue.title")}</span></button>
      </div>
    </div>`;
  const libraryNavigation = section.querySelector<HTMLElement>(
    '[data-control="library"]',
  );
  const foldersNavigation = section.querySelector<HTMLElement>(
    '[data-control="folders"]',
  );
  const usbNavigation = section.querySelector<HTMLButtonElement>(
    '[data-control="usb-storage"]',
  );
  if (libraryNavigation)
    libraryNavigation.hidden = options.musicBrowsingVisibility === "folders";
  if (foldersNavigation)
    foldersNavigation.hidden = options.musicBrowsingVisibility === "library";
  const updateUsbButton = (snapshot: RemovableDeviceListResponse): void => {
    if (usbNavigation)
      usbNavigation.hidden = !snapshot.devices.some(
        (device) => device.readable,
      );
  };
  updateUsbButton(options.removableDevices);

  const visualizer = createVisualizer({
    mode: options.visualizerMode,
    onModeChange: options.onVisualizerModeChange,
  });
  const timeline = createTimeline({
    style: options.timelineStyle,
    durationSeconds: 0,
    initialProgress: 0,
    timeMode: options.timelineTimeMode,
    onSeek: options.actions.seek,
    onTimeModeChange: options.onTimelineTimeModeChange,
  });
  const artwork = createArtwork({
    className: "now-playing__artwork",
    decorative: false,
  });
  section.querySelector(".now-playing__artwork")?.replaceWith(artwork.element);
  section
    .querySelector(".now-playing__visualizer-slot")
    ?.append(visualizer.element);
  section
    .querySelector(".now-playing__timeline-slot")
    ?.append(timeline.element);
  const title = section.querySelector<HTMLElement>(".now-playing__track");
  const favoriteIndicator = createFavoriteTrackIndicator(options.favorites);
  section
    .querySelector(".now-playing__title-row")
    ?.append(favoriteIndicator.element);
  const artist = section.querySelector<HTMLElement>(".now-playing__artist");
  const album = section.querySelector<HTMLElement>(".now-playing__album");
  const technical = section.querySelectorAll<HTMLElement>(
    ".now-playing__technical span",
  );
  const technicalFormat = technical[0];
  const technicalSource = technical[1];
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
  const foldersButton = section.querySelector<HTMLButtonElement>(
    '[data-control="folders"]',
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
    !playButton ||
    !previousButton ||
    !nextButton ||
    !shuffleButton ||
    !repeatButton ||
    !queueButton ||
    !libraryButton ||
    !foldersButton ||
    !usbNavigation ||
    !volumeButton
  )
    throw new Error("Now Playing controls are missing");
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
  foldersButton.addEventListener("click", options.onOpenFolders);
  usbNavigation.addEventListener("click", () => {
    options.onOpenUsbStorage(usbNavigation);
  });
  volumeButton.addEventListener("click", () => {
    options.onToggleVolume(volumeButton);
  });
  queueButton.addEventListener("click", () => {
    queueButton.setAttribute("aria-expanded", "true");
    options.onOpenQueue(queueButton);
  });
  const setText = (element: HTMLElement, value: string): void => {
    if (element.textContent === value) return;
    if (element.childNodes.length === 1 && element.firstChild instanceof Text)
      element.firstChild.data = value;
    else element.textContent = value;
  };
  let playIconName = "";
  let volumeIconName = "";

  const update = (state: PlayerState): void => {
    playerState = state;
    const track = state.currentTrack;
    const presentation = createTrackPresentationSnapshot(state);
    const unavailable =
      state.status === "unavailable" ||
      (!state.mpvAvailable && state.status !== "loading");
    setText(
      title,
      presentation.title ??
        (unavailable ? t("nowPlaying.unavailableTitle") : ""),
    );
    setText(
      artist,
      presentation.artist ??
        (unavailable ? t("nowPlaying.unavailableDescription") : ""),
    );
    setText(album, presentation.album ?? "");
    setText(technicalFormat, presentation.technical);
    setText(technicalSource, "");
    const artworkAlt =
      track?.album && track.artist
        ? t("artwork.albumBy")
            .replace("{album}", track.album)
            .replace("{artist}", track.artist)
        : t("artwork.album");
    artwork.update(presentation.artwork, artworkAlt, presentation.generation);
    favoriteIndicator.setTrack(
      state.queue[state.currentQueueIndex]?.libraryTrackId ?? null,
    );
    visualizer.setTrack(
      state.playerSessionId,
      presentation.trackId,
      presentation.generation,
    );
    visualizer.setPlaybackState(
      presentation.positionSeconds,
      state.paused || state.status !== "playing",
      state.audioBufferSeconds,
    );
    const usable = Boolean(track) && state.status !== "loading";
    playButton.disabled = !usable;
    previousButton.disabled = !usable;
    nextButton.disabled = !usable;
    shuffleButton.disabled = !state.mpvAvailable;
    playButton.setAttribute("aria-pressed", String(usable && !state.paused));
    const nextPlayIcon = usable && !state.paused ? "pause" : "play";
    if (nextPlayIcon !== playIconName) {
      playIconName = nextPlayIcon;
      playButton.innerHTML = icon(nextPlayIcon, "icon transport__play-icon");
    }
    shuffleButton.setAttribute("aria-pressed", String(state.shuffleEnabled));
    const nextVolumeIcon =
      state.muted || state.volume === 0 ? "volumeMuted" : "volume";
    if (nextVolumeIcon !== volumeIconName) {
      volumeIconName = nextVolumeIcon;
      volumeButton.innerHTML = `${icon(nextVolumeIcon)}<span>${t("volume.label")}</span>`;
    }
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
    timeline.setPlayback(
      presentation.positionSeconds,
      presentation.durationSeconds,
    );
    timeline.setEnabled(usable);
    const queueItemId = state.queue[state.currentQueueIndex]?.id ?? null;
    if (queueItemId !== waveformQueueItemId) {
      waveformQueueItemId = queueItemId;
      timeline.setWaveform(null, presentation.generation);
      if (queueItemId && options.timelineStyle === "waveform")
        waveformLoader.load(
          queueItemId,
          presentation.generation,
          (points, generation) => {
            if (
              waveformQueueItemId === queueItemId &&
              playerState.trackTransitionId === generation
            )
              timeline.setWaveform(points, generation);
          },
        );
      else waveformLoader.cancel();
    }
    waveformLoader.preload(
      state.queue[state.currentQueueIndex + 1]?.id ?? null,
    );
  };
  update(playerState);
  return {
    element: section,
    updateRemovableDevices: updateUsbButton,
    updatePlayerState: update,
    destroy() {
      visualizer.destroy();
      timeline.destroy();
      artwork.destroy();
      waveformLoader.cancel();
      favoriteIndicator.destroy();
    },
  };
}
