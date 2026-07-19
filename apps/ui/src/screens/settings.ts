import { createSegmentedControl } from "../components/segmented-control";
import type { ComponentView } from "../components/types";
import { icon } from "../components/icons";
import { t } from "../i18n";
import type {
  MusicBrowsingVisibility,
  ReturnToNowPlayingSeconds,
  TimelineStyle,
  VisualizerMode,
} from "../state/types";

export interface SettingsScreenOptions {
  readonly animationsEnabled: boolean;
  readonly visualizerMode: VisualizerMode;
  readonly timelineStyle: TimelineStyle;
  readonly musicBrowsingVisibility: MusicBrowsingVisibility;
  readonly returnToNowPlayingSeconds: ReturnToNowPlayingSeconds;
  readonly onAnimationsChange: (enabled: boolean) => void;
  readonly onVisualizerModeChange: (mode: VisualizerMode) => void;
  readonly onTimelineStyleChange: (style: TimelineStyle) => void;
  readonly onMusicBrowsingVisibilityChange: (
    value: MusicBrowsingVisibility,
  ) => void;
  readonly onReturnToNowPlayingSecondsChange: (
    value: ReturnToNowPlayingSeconds,
  ) => void;
}

export function createSettingsScreen(
  options: SettingsScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen settings-screen";
  let page: "root" | "interface" | "browsing" | "visualizer" | "inactivity" =
    "root";
  let animations = options.animationsEnabled;
  let visualizer = options.visualizerMode;
  let browsing = options.musicBrowsingVisibility;
  let inactivity = options.returnToNowPlayingSeconds;

  const selectionRow = (
    value: string,
    label: string,
    selected: boolean,
    onClick: () => void,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = "setting-choice";
    button.type = "button";
    button.innerHTML = `<span>${label}</span><span aria-hidden="true">${selected ? "✓" : ""}</span>`;
    button.addEventListener("click", onClick);
    return button;
  };

  const render = (): void => {
    section.dataset.settingsSubscreen = String(
      page === "browsing" || page === "visualizer" || page === "inactivity",
    );
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
    header.innerHTML = `<div><h1 id="screen-heading">${title}</h1></div>`;
    if (page !== "root") {
      const back = document.createElement("button");
      back.className = "icon-button settings-back";
      back.type = "button";
      back.setAttribute("aria-label", t("common.back"));
      back.innerHTML = icon("back");
      back.addEventListener("click", () => {
        page = page === "interface" ? "root" : "interface";
        render();
      });
      header.prepend(back);
    }
    const panel = document.createElement("section");
    panel.className = "settings-panel";
    section.append(header, panel);
    if (page === "root") {
      const button = document.createElement("button");
      button.className = "setting-navigation";
      button.type = "button";
      button.innerHTML = `<span><strong>${t("settings.interface")}</strong><small>${t("settings.interfaceDescription")}</small></span><span aria-hidden="true">›</span>`;
      button.addEventListener("click", () => {
        page = "interface";
        render();
      });
      panel.append(button);
      return;
    }
    if (page === "visualizer") {
      const modes: readonly [VisualizerMode, string][] = [
        ["meter", t("visualizer.meter")],
        ["spectrumMono", t("visualizer.spectrumMono")],
        ["spectrumStereo", t("visualizer.spectrumStereo")],
        ["none", t("visualizer.none")],
      ];
      for (const [value, label] of modes)
        panel.append(
          selectionRow(value, label, visualizer === value, () => {
            visualizer = value;
            options.onVisualizerModeChange(value);
            render();
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
          selectionRow(value, label, browsing === value, () => {
            browsing = value;
            options.onMusicBrowsingVisibilityChange(value);
            render();
          }),
        );
      return;
    }
    if (page === "inactivity") {
      const values: readonly ReturnToNowPlayingSeconds[] = [0, 10, 30, 60, 120];
      for (const value of values)
        panel.append(
          selectionRow(
            String(value),
            value === 0
              ? t("common.never")
              : `${String(value)} ${t("settings.seconds")}`,
            inactivity === value,
            () => {
              inactivity = value;
              options.onReturnToNowPlayingSecondsChange(value);
              render();
            },
          ),
        );
      return;
    }
    const toggle = document.createElement("button");
    toggle.className = "setting-navigation";
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(animations));
    toggle.innerHTML = `<span><strong>${t("settings.animations")}</strong><small>${t("settings.animationsDescription")}</small></span><span>${animations ? t("common.on") : t("common.off")}</span>`;
    toggle.addEventListener("click", () => {
      animations = !animations;
      options.onAnimationsChange(animations);
      render();
    });
    const browsingRow = document.createElement("button");
    browsingRow.className = "setting-navigation";
    browsingRow.type = "button";
    browsingRow.innerHTML = `<span><strong>${t("settings.musicBrowsing")}</strong><small>${browsing === "both" ? t("settings.both") : t(`screen.${browsing}.title`)}</small></span><span aria-hidden="true">›</span>`;
    browsingRow.addEventListener("click", () => {
      page = "browsing";
      render();
    });
    const visualizerRow = document.createElement("button");
    visualizerRow.className = "setting-navigation";
    visualizerRow.type = "button";
    visualizerRow.innerHTML = `<span><strong>${t("settings.visualizer")}</strong><small>${t(`visualizer.${visualizer}`)}</small></span><span aria-hidden="true">›</span>`;
    visualizerRow.addEventListener("click", () => {
      page = "visualizer";
      render();
    });
    const timelineRow = document.createElement("div");
    timelineRow.className = "setting-row";
    timelineRow.innerHTML = `<div class="setting-row__copy"><span class="setting-row__label">${t("settings.timeline")}</span></div>`;
    timelineRow.append(
      createSegmentedControl<TimelineStyle>({
        label: t("settings.timeline"),
        value: options.timelineStyle,
        items: [
          { value: "waveform", label: t("timeline.waveform") },
          { value: "line", label: t("timeline.line") },
        ],
        onChange: options.onTimelineStyleChange,
      }).element,
    );
    const inactivityRow = document.createElement("button");
    inactivityRow.className = "setting-navigation";
    inactivityRow.type = "button";
    inactivityRow.innerHTML = `<span><strong>${t("settings.returnToNowPlaying")}</strong><small>${inactivity === 0 ? t("common.never") : `${String(inactivity)} ${t("settings.seconds")}`}</small></span><span aria-hidden="true">›</span>`;
    inactivityRow.addEventListener("click", () => {
      page = "inactivity";
      render();
    });
    panel.append(
      toggle,
      browsingRow,
      visualizerRow,
      timelineRow,
      inactivityRow,
    );
  };
  render();
  return {
    element: section,
    destroy() {
      section.replaceChildren();
    },
  };
}
