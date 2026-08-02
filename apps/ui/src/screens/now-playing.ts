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
import { SeamlessTrackPresentationCoordinator } from "../state/track-transition-coordinator";
import { WaveformLoader } from "../timeline/waveform-loader";
import {
  isSameWaveformRequest,
  type WaveformRequestIdentity,
} from "../timeline/waveform-request-identity";
import type { FavoriteTrackStore } from "../state/favorite-track-store";
import { createFavoriteTrackIndicator } from "../components/favorite-track-indicator";
import type { RemovableDeviceListResponse } from "../../../../packages/shared/src/library";
import type { PlaybackSourceSnapshot } from "../../../../packages/shared/src/playback-source";
import { defaultPlaybackSourceSnapshot } from "../../../../packages/shared/src/playback-source";
import { createActivePlaybackPresentation } from "../state/active-playback-presentation";
import { externalArtworkUrl } from "../api/player-api-client";

export interface PlayerActions {
  readonly openFiles: () => void;
  readonly retryMpv: () => Promise<void>;
  readonly playPause: () => void;
  readonly previous: () => void;
  readonly next: () => void;
  readonly seek: (positionSeconds: number) => void;
  readonly resumeLocalPlayback: () => void;
  readonly shuffle: (enabled: boolean) => void;
  readonly repeat: (mode: RepeatMode) => void;
}

export interface NowPlayingOptions {
  readonly visualizerMode: VisualizerMode;
  readonly timelineStyle: TimelineStyle;
  readonly timelineTimeMode: TimelineTimeMode;
  readonly musicBrowsingVisibility: MusicBrowsingVisibility;
  readonly initialPlayerState: PlayerState;
  readonly initialPlaybackSource?: PlaybackSourceSnapshot;
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
  let playbackSource =
    options.initialPlaybackSource ?? defaultPlaybackSourceSnapshot;
  let waveformRequest: WaveformRequestIdentity = {
    queueItemId: null,
    trackGeneration: -1,
  };
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
        <div class="now-playing__recovery" role="status" aria-live="polite" hidden>
          <p>${t("nowPlaying.recoveryDescription")}</p>
          <button class="primary-action now-playing__retry-mpv" type="button">${t("nowPlaying.retryMpv")}</button>
        </div>
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
        <button class="transport__button transport__button--small" type="button" data-control="resume-local" aria-label="Resume local playback" title="Resume local playback" hidden>${icon("nowPlaying")}<span>Resume local playback</span></button>
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
  const artworkButton = document.createElement("button");
  artworkButton.type = "button";
  artworkButton.className = "now-playing__artwork-button";
  artworkButton.setAttribute("aria-label", t("nav.openLibrary"));
  artworkButton.append(artwork.element);
  section.querySelector(".now-playing__artwork")?.replaceWith(artworkButton);
  const visualizerSlot = section.querySelector<HTMLElement>(
    ".now-playing__visualizer-slot",
  );
  visualizerSlot?.append(visualizer.element);
  section
    .querySelector(".now-playing__timeline-slot")
    ?.append(timeline.element);
  const title = section.querySelector<HTMLElement>(".now-playing__track");
  const favoriteIndicator = createFavoriteTrackIndicator(options.favorites);
  section
    .querySelector(".now-playing__title-row")
    ?.append(favoriteIndicator.element);
  const sourceIndicator = document.createElement("span");
  sourceIndicator.className =
    "favorite-track-indicator now-playing__source-indicator";
  sourceIndicator.hidden = true;
  section.querySelector(".now-playing__title-row")?.append(sourceIndicator);
  const artist = section.querySelector<HTMLElement>(".now-playing__artist");
  const album = section.querySelector<HTMLElement>(".now-playing__album");
  const technical = section.querySelectorAll<HTMLElement>(
    ".now-playing__technical span",
  );
  const technicalFormat = technical[0];
  const technicalSource = technical[1];
  const recovery = section.querySelector<HTMLElement>(".now-playing__recovery");
  const recoveryDescription = recovery?.querySelector("p");
  const retryMpvButton = recovery?.querySelector<HTMLButtonElement>(
    ".now-playing__retry-mpv",
  );
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
  const resumeLocal = section.querySelector<HTMLButtonElement>(
    '[data-control="resume-local"]',
  );
  if (
    !title ||
    !artist ||
    !album ||
    !technicalFormat ||
    !technicalSource ||
    !recovery ||
    !recoveryDescription ||
    !retryMpvButton ||
    !visualizerSlot ||
    !playButton ||
    !previousButton ||
    !nextButton ||
    !shuffleButton ||
    !repeatButton ||
    !queueButton ||
    !libraryButton ||
    !foldersButton ||
    !usbNavigation ||
    !volumeButton ||
    !resumeLocal
  )
    throw new Error("Now Playing controls are missing");
  let retryMpvBusy = false;
  playButton.addEventListener("click", options.actions.playPause);
  previousButton.addEventListener("click", options.actions.previous);
  nextButton.addEventListener("click", options.actions.next);
  shuffleButton.addEventListener("click", () => {
    options.actions.shuffle(!playerState.shuffleEnabled);
  });
  repeatButton.addEventListener("click", () => {
    options.actions.repeat(nextRepeat(playerState.repeatMode));
  });
  artworkButton.addEventListener("click", options.onOpenLibrary);
  libraryButton.addEventListener("click", options.onOpenLibrary);
  foldersButton.addEventListener("click", options.onOpenFolders);
  usbNavigation.addEventListener("click", () => {
    options.onOpenUsbStorage(usbNavigation);
  });
  volumeButton.addEventListener("click", () => {
    options.onToggleVolume(volumeButton);
  });
  resumeLocal.addEventListener("click", options.actions.resumeLocalPlayback);
  queueButton.addEventListener("click", () => {
    queueButton.setAttribute("aria-expanded", "true");
    options.onOpenQueue(queueButton);
  });
  retryMpvButton.addEventListener("click", () => {
    if (retryMpvBusy) return;
    retryMpvBusy = true;
    retryMpvButton.disabled = true;
    retryMpvButton.textContent = t("nowPlaying.startingMpv");
    recoveryDescription.textContent = t("nowPlaying.recoveryInProgress");
    void options.actions
      .retryMpv()
      .catch(() => {
        recoveryDescription.textContent = t("nowPlaying.recoveryFailed");
      })
      .finally(() => {
        retryMpvBusy = false;
        update(playerState);
      });
  });
  const setText = (element: HTMLElement, value: string): void => {
    if (element.textContent === value) return;
    if (element.childNodes.length === 1 && element.firstChild instanceof Text)
      element.firstChild.data = value;
    else element.textContent = value;
  };
  let playIconName = "";
  let volumeIconName = "";
  let showingExternalArtwork = false;
  let externalArtworkRevision: string | null = null;
  const localPresentationCoordinator =
    new SeamlessTrackPresentationCoordinator();

  const update = (state: PlayerState): void => {
    playerState = state;
    const presentation = localPresentationCoordinator.accept(state);
    const active = createActivePlaybackPresentation(
      state,
      playbackSource,
      presentation,
    );
    const external = active.external;
    const unavailable =
      state.status === "unavailable" ||
      (!state.mpvAvailable && state.status !== "loading");
    const starting = !state.mpvAvailable && state.status === "loading";
    setText(
      title,
      active.title ??
        (starting
          ? t("nowPlaying.startingTitle")
          : unavailable
            ? t("nowPlaying.unavailableTitle")
            : ""),
    );
    setText(
      artist,
      active.artist ??
        (starting
          ? t("nowPlaying.recoveryInProgress")
          : unavailable
            ? t("nowPlaying.unavailableDescription")
            : ""),
    );
    setText(album, active.album ?? "");
    setText(technicalFormat, external ? "" : presentation.technical);
    setText(technicalSource, "");
    recovery.hidden = state.mpvAvailable;
    visualizerSlot.hidden = !state.mpvAvailable;
    if (external) {
      recovery.hidden = true;
      visualizerSlot.hidden = true;
    }
    volumeButton.hidden = external || volumeButton.disabled;
    resumeLocal.hidden = !external;
    if (external) {
      sourceIndicator.hidden = false;
      sourceIndicator.innerHTML = icon(
        playbackSource.activeSource === "spotify" ? "spotify" : "airplay",
      );
      sourceIndicator.setAttribute("aria-label", `${active.sourceName} source`);
      sourceIndicator.setAttribute("title", active.sourceName);
      sourceIndicator.setAttribute("aria-hidden", "false");
    } else {
      sourceIndicator.hidden = true;
      sourceIndicator.removeAttribute("aria-label");
      sourceIndicator.removeAttribute("title");
    }
    favoriteIndicator.setSuppressed(external);
    if (!external && !state.mpvAvailable) {
      retryMpvButton.disabled = retryMpvBusy || starting;
      retryMpvButton.textContent =
        retryMpvBusy || starting
          ? t("nowPlaying.startingMpv")
          : t("nowPlaying.retryMpv");
      if (!retryMpvBusy)
        recoveryDescription.textContent = starting
          ? t("nowPlaying.recoveryInProgress")
          : t("nowPlaying.recoveryDescription");
    }
    const artworkAlt =
      active.album && active.artist
        ? t("artwork.albumBy")
            .replace("{album}", active.album)
            .replace("{artist}", active.artist)
        : t("artwork.album");
    if (external) {
      const externalArtwork = playbackSource.artwork;
      if (
        externalArtwork &&
        (!showingExternalArtwork ||
          externalArtworkRevision !== externalArtwork.revision)
      )
        void artwork.loadUrl(
          externalArtworkUrl(externalArtwork.id),
          externalArtwork.revision,
          artworkAlt,
        );
      else if (!externalArtwork && !showingExternalArtwork)
        artwork.update(null, artworkAlt, active.generation);
      showingExternalArtwork = true;
      externalArtworkRevision = externalArtwork?.revision ?? null;
      favoriteIndicator.setTrack(null);
    } else {
      showingExternalArtwork = false;
      externalArtworkRevision = null;
      artwork.update(presentation.artwork, artworkAlt, presentation.generation);
      favoriteIndicator.setTrack(
        state.currentPlayback?.item.libraryTrackId ??
          state.queue[state.currentQueueIndex]?.libraryTrackId ??
          null,
      );
    }
    visualizer.setTrack(
      state.playerSessionId,
      external ? null : presentation.trackId,
      active.generation,
    );
    visualizer.setPlaybackState(
      active.positionSeconds,
      active.paused,
      state.audioBufferSeconds,
    );
    const usable = external
      ? playbackSource.phase === "active"
      : state.mpvAvailable &&
        (state.currentPlayback !== undefined
          ? state.currentPlayback !== null ||
            (state.explicitQueue?.length ?? 0) > 0
          : state.queue.length > 0);
    playButton.disabled = !usable;
    previousButton.disabled =
      !usable || (external && !active.capabilities.previous);
    nextButton.disabled =
      !usable ||
      (external ? !active.capabilities.next : state.canGoNext === false);
    shuffleButton.disabled = external || !state.mpvAvailable;
    repeatButton.disabled = external;
    playButton.setAttribute("aria-pressed", String(usable && !active.paused));
    const nextPlayIcon = usable && !active.paused ? "pause" : "play";
    if (nextPlayIcon !== playIconName) {
      playIconName = nextPlayIcon;
      playButton.innerHTML = icon(nextPlayIcon, "icon transport__play-icon");
    }
    shuffleButton.setAttribute("aria-pressed", String(state.shuffleEnabled));
    const nextVolumeIcon =
      active.muted || active.volume === 0 ? "volumeMuted" : "volume";
    if (nextVolumeIcon !== volumeIconName) {
      volumeIconName = nextVolumeIcon;
      volumeButton.innerHTML = `${icon(nextVolumeIcon)}<span>${t("volume.label")}</span>`;
    }
    volumeButton.setAttribute(
      "aria-label",
      `${t("volume.open")} · ${
        active.muted
          ? t("volume.muted")
          : `${String(Math.round(active.volume))}%`
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
    timeline.setPlayback(active.positionSeconds, active.durationSeconds);
    timeline.setEnabled(usable && (!external || active.capabilities.seek));
    const queueItemId =
      state.currentPlayback?.playbackInstanceId ??
      state.queue[state.currentQueueIndex]?.id ??
      null;
    const nextWaveformRequest = {
      queueItemId,
      trackGeneration: active.generation,
    };
    if (external) {
      waveformLoader.cancel();
      waveformRequest = {
        queueItemId: null,
        trackGeneration: active.generation,
      };
      timeline.setWaveform(null, active.generation);
      return;
    }
    if (!isSameWaveformRequest(waveformRequest, nextWaveformRequest)) {
      waveformRequest = nextWaveformRequest;
      timeline.setWaveform(null, presentation.generation);
      if (queueItemId && options.timelineStyle === "waveform")
        waveformLoader.load(
          queueItemId,
          presentation.generation,
          (points, generation) => {
            if (
              isSameWaveformRequest(waveformRequest, {
                queueItemId,
                trackGeneration: generation,
              })
            )
              timeline.setWaveform(points, generation);
          },
        );
      else waveformLoader.cancel();
    }
    waveformLoader.preload(
      state.explicitQueue?.[0]?.playbackInstanceId ??
        state.queue[state.currentQueueIndex + 1]?.id ??
        null,
    );
  };
  update(playerState);
  return {
    element: section,
    updateRemovableDevices: updateUsbButton,
    updatePlayerState: update,
    updatePlaybackSource(snapshot) {
      playbackSource = snapshot;
      update(playerState);
    },
    destroy() {
      visualizer.destroy();
      timeline.destroy();
      artwork.destroy();
      waveformLoader.cancel();
      favoriteIndicator.destroy();
    },
  };
}
