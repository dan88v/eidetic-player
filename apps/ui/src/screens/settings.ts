import { icon } from "../components/icons";
import { createSegmentedControl } from "../components/segmented-control";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";
import type {
  MusicBrowsingVisibility,
  ReturnToNowPlayingSeconds,
  TimelineStyle,
  VisualizerMode,
  MainPlayerMode,
  OnScreenKeyboardMode,
} from "../state/types";

export interface SettingsScreenOptions {
  readonly animationsEnabled: boolean;
  readonly visualizerMode: VisualizerMode;
  readonly mainPlayerMode: MainPlayerMode;
  readonly timelineStyle: TimelineStyle;
  readonly musicBrowsingVisibility: MusicBrowsingVisibility;
  readonly returnToNowPlayingSeconds: ReturnToNowPlayingSeconds;
  readonly onScreenKeyboardMode: OnScreenKeyboardMode;
  readonly onAnimationsChange: (enabled: boolean) => boolean;
  readonly onVisualizerModeChange: (mode: VisualizerMode) => boolean;
  readonly onMainPlayerModeChange: (mode: MainPlayerMode) => boolean;
  readonly onTimelineStyleChange: (style: TimelineStyle) => boolean;
  readonly onMusicBrowsingVisibilityChange: (
    value: MusicBrowsingVisibility,
  ) => boolean;
  readonly onReturnToNowPlayingSecondsChange: (
    value: ReturnToNowPlayingSeconds,
  ) => boolean;
  readonly onScreenKeyboardModeChange: (value: OnScreenKeyboardMode) => boolean;
}

type SettingsPage =
  "root" | "interface" | "browsing" | "visualizer" | "inactivity";

export function createSettingsScreen(
  options: SettingsScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen settings-screen";
  let page: SettingsPage = "root";
  let animations = options.animationsEnabled;
  let visualizer = options.visualizerMode;
  let mainPlayer = options.mainPlayerMode;
  let browsing = options.musicBrowsingVisibility;
  let inactivity = options.returnToNowPlayingSeconds;
  let onScreenKeyboard = options.onScreenKeyboardMode;

  const chevron = (): string =>
    `<span class="settings-chevron" aria-hidden="true">${icon("chevronRight")}</span>`;

  const navigateBack = (): void => {
    page = page === "interface" ? "root" : "interface";
    render();
  };

  const selectionRow = (
    label: string,
    selected: boolean,
    commit: () => boolean,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = "settings-row-base setting-choice";
    button.type = "button";
    button.innerHTML = `<span>${label}</span><span class="setting-choice__check" aria-hidden="true">${selected ? "✓" : ""}</span>`;
    button.addEventListener("click", () => {
      if (!commit()) return;
      render();
      page = "interface";
      render();
    });
    return button;
  };

  function render(): void {
    section.dataset.settingsPage = page;
    section.replaceChildren();
    const header = document.createElement("header");
    header.className = "screen-header screen-header--compact";
    const title =
      page === "root"
        ? t("screen.settings.title")
        : page === "interface"
          ? t("settings.interface")
          : page === "browsing"
            ? t("settings.musicBrowsing")
            : page === "visualizer"
              ? t("settings.visualizer")
              : t("settings.returnToNowPlaying");
    const description =
      page === "root"
        ? t("screen.settings.description")
        : page === "interface"
          ? t("settings.interfaceDescription")
          : page === "browsing"
            ? t("settings.musicBrowsingDescription")
            : page === "visualizer"
              ? t("settings.visualizerDescription")
              : t("settings.returnToNowPlayingDescription");
    header.setAttribute("aria-label", title);
    header.innerHTML = `<p class="screen-header__description">${description}</p>`;
    if (page !== "root") {
      const back = document.createElement("button");
      back.className = "icon-button settings-back";
      back.type = "button";
      back.setAttribute("aria-label", t("common.back"));
      back.innerHTML = icon("back");
      back.addEventListener("click", navigateBack);
      header.prepend(back);
    }
    const panel = document.createElement("section");
    panel.className = "settings-panel";
    section.append(header, panel);

    if (page === "root") {
      const button = document.createElement("button");
      button.className = "settings-row-base setting-navigation";
      button.type = "button";
      button.innerHTML = `<span><strong>${t("settings.interface")}</strong><small>${t("settings.interfaceDescription")}</small></span>${chevron()}`;
      button.addEventListener("click", () => {
        page = "interface";
        render();
      });
      panel.append(button);
      return;
    }

    if (page === "visualizer") {
      const modes: readonly [VisualizerMode, string][] = [
        ["spectrumMono", t("visualizer.spectrumMono")],
        ["spectrumStereo", t("visualizer.spectrumStereo")],
        ["meter", t("visualizer.meter")],
        ["technical", t("visualizer.technical")],
        ["none", t("visualizer.none")],
      ];
      for (const [value, label] of modes)
        panel.append(
          selectionRow(label, visualizer === value, () => {
            if (!options.onVisualizerModeChange(value)) return false;
            visualizer = value;
            return true;
          }),
        );
      return;
    }

    if (page === "browsing") {
      const values: readonly [MusicBrowsingVisibility, string][] = [
        ["folders", t("screen.folders.title")],
        ["library", t("screen.library.title")],
        ["both", t("settings.both")],
      ];
      for (const [value, label] of values)
        panel.append(
          selectionRow(label, browsing === value, () => {
            if (!options.onMusicBrowsingVisibilityChange(value)) return false;
            browsing = value;
            return true;
          }),
        );
      return;
    }

    if (page === "inactivity") {
      const values: readonly ReturnToNowPlayingSeconds[] = [0, 10, 30, 60, 120];
      for (const value of values)
        panel.append(
          selectionRow(
            value === 0
              ? t("common.never")
              : `${String(value)} ${t("settings.seconds")}`,
            inactivity === value,
            () => {
              if (!options.onReturnToNowPlayingSecondsChange(value))
                return false;
              inactivity = value;
              return true;
            },
          ),
        );
      return;
    }

    const animationsRow = document.createElement("div");
    animationsRow.className = "settings-row-base setting-row";
    animationsRow.innerHTML = `<div class="setting-row__copy"><span class="setting-row__label">${t("settings.animations")}</span><span class="setting-row__description">${t("settings.animationsDescription")}</span></div>`;
    const animationControl = createSegmentedControl<"on" | "off">({
      label: t("settings.animations"),
      value: animations ? "on" : "off",
      items: [
        { value: "on", label: t("common.on") },
        { value: "off", label: t("common.off") },
      ],
      onChange(value) {
        const next = value === "on";
        if (!options.onAnimationsChange(next)) {
          animationControl.setValue(animations ? "on" : "off");
          return;
        }
        animations = next;
      },
    });
    animationsRow.append(animationControl.element);

    const keyboardRow = document.createElement("div");
    keyboardRow.className = "settings-row-base setting-row";
    keyboardRow.innerHTML = `<div class="setting-row__copy"><span class="setting-row__label">${t("settings.onScreenKeyboard")}</span><span class="setting-row__description">${t("settings.onScreenKeyboardDescription")}</span></div>`;
    const keyboardControl = createSegmentedControl<OnScreenKeyboardMode>({
      label: t("settings.onScreenKeyboard"),
      value: onScreenKeyboard,
      items: [
        { value: "auto", label: t("common.auto") },
        { value: "off", label: t("common.off") },
      ],
      onChange(value) {
        if (!options.onScreenKeyboardModeChange(value)) {
          keyboardControl.setValue(onScreenKeyboard);
          return;
        }
        onScreenKeyboard = value;
      },
    });
    keyboardRow.append(keyboardControl.element);

    const mainPlayerRow = document.createElement("div");
    mainPlayerRow.className = "settings-row-base setting-row";
    mainPlayerRow.innerHTML = `<div class="setting-row__copy"><span class="setting-row__label">${t("settings.mainPlayer")}</span><span class="setting-row__description">${t("settings.mainPlayerDescription")}</span></div>`;
    const mainPlayerControl = createSegmentedControl<MainPlayerMode>({
      label: t("settings.mainPlayer"),
      value: mainPlayer,
      items: [
        { value: "default", label: t("mainPlayer.default") },
        { value: "cassette", label: t("mainPlayer.cassette") },
      ],
      onChange(value) {
        if (!options.onMainPlayerModeChange(value)) {
          mainPlayerControl.setValue(mainPlayer);
          return;
        }
        mainPlayer = value;
      },
    });
    mainPlayerRow.append(mainPlayerControl.element);

    const browsingRow = document.createElement("button");
    browsingRow.className = "settings-row-base setting-navigation";
    browsingRow.type = "button";
    browsingRow.innerHTML = `<span><strong>${t("settings.musicBrowsing")}</strong><small>${browsing === "both" ? t("settings.both") : t(`screen.${browsing}.title`)}</small></span>${chevron()}`;
    browsingRow.addEventListener("click", () => {
      page = "browsing";
      render();
    });

    const visualizerRow = document.createElement("button");
    visualizerRow.className = "settings-row-base setting-navigation";
    visualizerRow.type = "button";
    visualizerRow.innerHTML = `<span><strong>${t("settings.visualizer")}</strong><small>${t(`visualizer.${visualizer}`)}</small></span>${chevron()}`;
    visualizerRow.addEventListener("click", () => {
      page = "visualizer";
      render();
    });

    const timelineRow = document.createElement("div");
    timelineRow.className = "settings-row-base setting-row";
    timelineRow.innerHTML = `<div class="setting-row__copy"><span class="setting-row__label">${t("settings.timeline")}</span></div>`;
    let timeline = options.timelineStyle;
    const timelineControl = createSegmentedControl<TimelineStyle>({
      label: t("settings.timeline"),
      value: timeline,
      items: [
        { value: "waveform", label: t("timeline.waveform") },
        { value: "line", label: t("timeline.line") },
      ],
      onChange(value) {
        if (!options.onTimelineStyleChange(value)) {
          timelineControl.setValue(timeline);
          return;
        }
        timeline = value;
      },
    });
    timelineRow.append(timelineControl.element);

    const inactivityRow = document.createElement("button");
    inactivityRow.className = "settings-row-base setting-navigation";
    inactivityRow.type = "button";
    inactivityRow.innerHTML = `<span><strong>${t("settings.returnToNowPlaying")}</strong><small>${inactivity === 0 ? t("common.never") : `${String(inactivity)} ${t("settings.seconds")}`}</small></span>${chevron()}`;
    inactivityRow.addEventListener("click", () => {
      page = "inactivity";
      render();
    });
    panel.append(
      animationsRow,
      keyboardRow,
      mainPlayerRow,
      browsingRow,
      visualizerRow,
      timelineRow,
      inactivityRow,
    );
  }

  render();
  return {
    element: section,
    destroy() {
      section.replaceChildren();
    },
  };
}
