import type { PlayerState } from "../../../../packages/shared/src/player";
import { icon } from "../components/icons";
import { t } from "../i18n";
import type { MusicBrowsingVisibility } from "../state/types";

export interface CassetteUtilityControls {
  readonly element: HTMLElement;
  update(state: PlayerState): void;
}

export function resolveCassetteBrowsingControls(
  visibility: MusicBrowsingVisibility,
): { readonly library: boolean; readonly folders: boolean } {
  return {
    library: visibility !== "folders",
    folders: visibility !== "library",
  };
}

export function createCassetteUtilityControls(options: {
  readonly musicBrowsingVisibility: MusicBrowsingVisibility;
  readonly onOpenLibrary: () => void;
  readonly onOpenFolders: () => void;
  readonly onToggleVolume: (trigger: HTMLButtonElement) => void;
  readonly onOpenQueue: (trigger: HTMLButtonElement) => void;
}): CassetteUtilityControls {
  const element = document.createElement("div");
  element.className = "cassette-player__utility-row";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-label", t("nowPlaying.controls"));
  element.innerHTML = `
    <div class="cassette-player__utility-group cassette-player__utility-group--browsing">
      <button class="cassette-player__utility-button" type="button" data-control="library" aria-label="${t("nav.openLibrary")}">${icon("library")}<span>${t("screen.library.title")}</span></button>
      <button class="cassette-player__utility-button" type="button" data-control="folders" aria-label="${t("nav.openFolders")}">${icon("folder")}<span>${t("screen.folders.title")}</span></button>
    </div>
    <div class="cassette-player__utility-group cassette-player__utility-group--playback">
      <button class="cassette-player__utility-button" type="button" data-control="volume" aria-label="${t("volume.open")}" aria-expanded="false" aria-controls="volume-popover">${icon("volume")}<span>${t("volume.label")}</span></button>
      <button class="cassette-player__utility-button" type="button" data-control="queue" aria-haspopup="dialog" aria-controls="queue-drawer" aria-expanded="false" aria-label="${t("nowPlaying.queue")}">${icon("queue")}<span>${t("screen.queue.title")}</span></button>
    </div>`;
  const libraryButton = element.querySelector<HTMLButtonElement>(
    '[data-control="library"]',
  );
  const foldersButton = element.querySelector<HTMLButtonElement>(
    '[data-control="folders"]',
  );
  const volumeButton = element.querySelector<HTMLButtonElement>(
    '[data-control="volume"]',
  );
  const queueButton = element.querySelector<HTMLButtonElement>(
    '[data-control="queue"]',
  );
  if (!libraryButton || !foldersButton || !volumeButton || !queueButton)
    throw new Error("Cassette utility controls are missing");
  const browsingControls = resolveCassetteBrowsingControls(
    options.musicBrowsingVisibility,
  );
  libraryButton.hidden = !browsingControls.library;
  foldersButton.hidden = !browsingControls.folders;
  libraryButton.addEventListener("click", options.onOpenLibrary);
  foldersButton.addEventListener("click", options.onOpenFolders);
  volumeButton.addEventListener("click", () => {
    options.onToggleVolume(volumeButton);
  });
  queueButton.addEventListener("click", () => {
    queueButton.setAttribute("aria-expanded", "true");
    options.onOpenQueue(queueButton);
  });
  let volumeIconName = "";
  return {
    element,
    update(state) {
      const nextVolumeIcon =
        state.muted || state.volume === 0 ? "volumeMuted" : "volume";
      if (nextVolumeIcon !== volumeIconName) {
        volumeIconName = nextVolumeIcon;
        volumeButton.innerHTML = `${icon(nextVolumeIcon)}<span>${t("volume.label")}</span>`;
      }
      volumeButton.setAttribute(
        "aria-label",
        `${t("volume.open")} · ${
          state.muted
            ? t("volume.muted")
            : `${String(Math.round(state.volume))}%`
        }`,
      );
    },
  };
}
