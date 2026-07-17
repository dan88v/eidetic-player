import { createSegmentedControl } from "../components/segmented-control";
import type { ComponentView } from "../components/types";
import { config } from "../config";
import { t } from "../i18n";
import type { TimelineStyle, VisualizerMode } from "../state/types";

export interface SettingsScreenOptions {
  readonly animationsEnabled: boolean;
  readonly visualizerMode: VisualizerMode;
  readonly timelineStyle: TimelineStyle;
  readonly onAnimationsChange: (enabled: boolean) => void;
  readonly onVisualizerModeChange: (mode: VisualizerMode) => void;
  readonly onTimelineStyleChange: (style: TimelineStyle) => void;
}

export function createSettingsScreen(
  options: SettingsScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen settings-screen";
  section.setAttribute("aria-labelledby", "screen-heading");
  section.innerHTML = `
    <header class="screen-header screen-header--compact"><div>
      <p class="screen-header__eyebrow">${config.appName}</p>
      <h1 id="screen-heading">${t("screen.settings.title")}</h1>
      <p class="screen-header__description">${t("screen.settings.description")}</p>
    </div></header>
    <section class="settings-panel" aria-labelledby="interface-heading">
      <h2 id="interface-heading">${t("settings.interface")}</h2>
      <div class="setting-row">
        <div class="setting-row__copy"><span class="setting-row__label">${t("settings.animations")}</span><span class="setting-row__description">${t("settings.animationsDescription")}</span></div>
        <button class="switch" type="button" role="switch" aria-checked="${String(options.animationsEnabled)}"><span class="switch__label">${options.animationsEnabled ? t("common.on") : t("common.off")}</span><span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span></button>
      </div>
      <div class="setting-row" data-setting="visualizer"><div class="setting-row__copy"><span class="setting-row__label">${t("settings.visualizer")}</span><span class="setting-row__description">${t("settings.visualizerDescription")}</span></div></div>
      <div class="setting-row" data-setting="timeline"><div class="setting-row__copy"><span class="setting-row__label">${t("settings.timeline")}</span><span class="setting-row__description">${t("settings.timelineDescription")}</span></div></div>
    </section>`;

  const switchButton = section.querySelector<HTMLButtonElement>(".switch");
  const visualizerRow = section.querySelector<HTMLElement>(
    '[data-setting="visualizer"]',
  );
  const timelineRow = section.querySelector<HTMLElement>(
    '[data-setting="timeline"]',
  );
  if (!switchButton || !visualizerRow || !timelineRow)
    throw new Error("Settings controls are missing");
  switchButton.addEventListener("click", () => {
    const enabled = switchButton.getAttribute("aria-checked") !== "true";
    switchButton.setAttribute("aria-checked", String(enabled));
    const label = switchButton.querySelector(".switch__label");
    if (label) label.textContent = enabled ? t("common.on") : t("common.off");
    options.onAnimationsChange(enabled);
  });
  const visualizer = createSegmentedControl<VisualizerMode>({
    label: t("settings.visualizer"),
    value: options.visualizerMode,
    items: [
      { value: "meter", label: t("visualizer.meter") },
      { value: "spectrum", label: t("visualizer.spectrum") },
    ],
    onChange: options.onVisualizerModeChange,
  });
  const timeline = createSegmentedControl<TimelineStyle>({
    label: t("settings.timeline"),
    value: options.timelineStyle,
    items: [
      { value: "waveform", label: t("timeline.waveform") },
      { value: "line", label: t("timeline.line") },
    ],
    onChange: options.onTimelineStyleChange,
  });
  visualizerRow.append(visualizer.element);
  timelineRow.append(timeline.element);
  return {
    element: section,
    destroy() {
      // Settings owns no observers or document-level listeners.
    },
  };
}
