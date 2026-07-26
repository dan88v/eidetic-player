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
import type { NetworkSnapshot } from "../../../../packages/shared/src/network";
import type { NetworkApiClient } from "../api/network-api-client";
import type { SystemCapabilities } from "../../../../packages/shared/src/system";
import type {
  AudioOutputDevice,
  AudioOutputState,
} from "../../../../packages/shared/src/audio-output";
import type { AudioOutputApiClient } from "../api/audio-output-api-client";
import {
  createNetworkSettingsPanel,
  networkSummary,
  type NetworkSettingsPanel,
} from "./network-settings-panel";

export interface SettingsScreenOptions {
  readonly animationsEnabled: boolean;
  readonly visualizerMode: VisualizerMode;
  readonly mainPlayerMode: MainPlayerMode;
  readonly timelineStyle: TimelineStyle;
  readonly musicBrowsingVisibility: MusicBrowsingVisibility;
  readonly returnToNowPlayingSeconds: ReturnToNowPlayingSeconds;
  readonly onScreenKeyboardMode: OnScreenKeyboardMode;
  readonly systemCapabilities: SystemCapabilities;
  readonly enterMaintenanceMode: () => Promise<void>;
  readonly networkApi: NetworkApiClient;
  readonly networkSnapshot: NetworkSnapshot;
  readonly audioOutputApi: AudioOutputApiClient;
  readonly audioOutputState: AudioOutputState;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
  readonly openSystemNetworkSettings: () => Promise<void>;
  readonly setScreenTitle: (title: string) => void;
  readonly setHeaderActions: (back: (() => void) | null, more: null) => void;
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
  | "root"
  | "interface"
  | "network"
  | "audio"
  | "audio-output"
  | "keyboard"
  | "browsing"
  | "visualizer"
  | "inactivity"
  | "system";

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
  let networkSnapshot = options.networkSnapshot;
  let audioOutputState = options.audioOutputState;
  let networkPanel: NetworkSettingsPanel | null = null;
  let audioSelectionBusy = false;
  let audioRefreshBusy = false;

  const chevron = (): string =>
    `<span class="settings-chevron" aria-hidden="true">${icon("chevronRight")}</span>`;

  const navigateBack = (): void => {
    if (
      page === "network" &&
      networkPanel?.requestLeave(() => {
        page = "root";
        render();
      })
    )
      return;
    if (page === "audio-output") page = "audio";
    else
      page =
        page === "interface" ||
        page === "network" ||
        page === "audio" ||
        page === "system"
          ? "root"
          : "interface";
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

  const audioDeviceDescription = (deviceId: string): string =>
    audioOutputState.devices.find((device) => device.id === deviceId)
      ?.description ?? (deviceId === "auto" ? "System default" : deviceId);

  const audioStatusText = (): string => {
    switch (audioOutputState.status) {
      case "mpv-unavailable":
        return "MPV unavailable. Audio outputs cannot be changed.";
      case "preferred-unavailable":
        return "Preferred output unavailable. Using System default.";
      case "pending-playback":
        return audioOutputState.preferredDevice.deviceId ===
          audioOutputState.effectiveDeviceId
          ? "Will be used on next playback."
          : `Will be used on next playback. Using ${audioDeviceDescription(audioOutputState.effectiveDeviceId)}.`;
      case "switching":
        return "Changing audio output…";
      case "error":
        return "The preferred output could not be applied.";
      case "system-default":
        return "Using System default.";
      case "active":
        return `In use: ${audioDeviceDescription(audioOutputState.effectiveDeviceId)}.`;
    }
  };

  const audioDeviceRow = (
    device: AudioOutputDevice,
    unavailable = false,
  ): HTMLButtonElement => {
    const row = document.createElement("button");
    row.className = `settings-row-base setting-navigation audio-output-row${unavailable ? " audio-output-row--unavailable" : ""}`;
    row.type = "button";
    const copy = document.createElement("span");
    copy.className = "audio-output-row__copy";
    const description = document.createElement("strong");
    description.textContent = device.description || device.id;
    const identifier = document.createElement("small");
    identifier.textContent = device.id;
    copy.append(description, identifier);
    const indicators = document.createElement("span");
    indicators.className = "audio-output-row__indicators";
    if (audioOutputState.preferredDevice.deviceId === device.id) {
      const preferred = document.createElement("span");
      preferred.className = "audio-output-badge audio-output-badge--preferred";
      preferred.textContent = "✓ Preferred";
      indicators.append(preferred);
    }
    if (audioOutputState.effectiveDeviceId === device.id) {
      if (indicators.childElementCount > 0)
        indicators.append(document.createTextNode(" "));
      const effective = document.createElement("span");
      effective.className = "audio-output-badge";
      effective.textContent = "In use";
      indicators.append(effective);
    }
    if (unavailable) {
      if (indicators.childElementCount > 0)
        indicators.append(document.createTextNode(" "));
      const status = document.createElement("span");
      status.className = "audio-output-badge audio-output-badge--unavailable";
      status.textContent = "Unavailable";
      indicators.append(status);
    }
    row.append(copy, indicators);
    const disabled =
      unavailable ||
      !audioOutputState.mpvAvailable ||
      audioSelectionBusy ||
      audioOutputState.switching;
    row.disabled = disabled;
    row.setAttribute(
      "aria-pressed",
      String(audioOutputState.preferredDevice.deviceId === device.id),
    );
    if (!disabled) {
      row.addEventListener("click", () => {
        if (audioSelectionBusy) return;
        const selection = options.audioOutputApi.select(device.id);
        audioSelectionBusy = true;
        render();
        void selection
          .then((result) => {
            if (!result.changed) return;
            options.showToast(
              device.id === "auto"
                ? "Using System default."
                : "Audio output changed.",
              "success",
            );
          })
          .catch(() => {
            options.showToast("Audio output could not be changed.", "error");
          })
          .finally(() => {
            audioSelectionBusy = false;
            render();
          });
      });
    }
    return row;
  };

  function render(): void {
    networkPanel?.destroy();
    networkPanel = null;
    section.dataset.settingsPage = page;
    section.replaceChildren();
    if (page === "network") {
      options.setScreenTitle(t("screen.settings.title"));
      options.setHeaderActions(null, null);
      networkPanel = createNetworkSettingsPanel({
        api: options.networkApi,
        initialSnapshot: networkSnapshot,
        showToast: options.showToast,
        openSystemSettings: options.openSystemNetworkSettings,
      });
      const header = document.createElement("header");
      header.className =
        "screen-header screen-header--compact network-settings-header";
      header.setAttribute("aria-label", "Network");
      header.innerHTML =
        '<p class="screen-header__description">View network status and manage Wi-Fi.</p>';
      const back = document.createElement("button");
      back.className = "icon-button settings-back";
      back.type = "button";
      back.setAttribute("aria-label", t("common.back"));
      back.innerHTML = icon("back");
      back.addEventListener("click", navigateBack);
      header.prepend(back);
      header.append(networkPanel.selectorElement);
      section.append(header, networkPanel.element);
      return;
    }
    const header = document.createElement("header");
    header.className = "screen-header screen-header--compact";
    const title =
      page === "root"
        ? t("screen.settings.title")
        : page === "interface"
          ? t("settings.interface")
          : page === "audio"
            ? "Audio"
            : page === "audio-output"
              ? "Output"
              : page === "system"
                ? "System"
                : page === "keyboard"
                  ? t("settings.onScreenKeyboard")
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
          : page === "audio"
            ? "Manage audio playback and output."
            : page === "audio-output"
              ? "Choose where Eidetic Player plays audio."
              : page === "system"
                ? "Appliance maintenance and local recovery."
                : page === "keyboard"
                  ? t("settings.onScreenKeyboardDescription")
                  : page === "browsing"
                    ? t("settings.musicBrowsingDescription")
                    : page === "visualizer"
                      ? t("settings.visualizerDescription")
                      : t("settings.returnToNowPlayingDescription");
    options.setScreenTitle(
      page === "audio"
        ? "Audio"
        : page === "audio-output"
          ? "Output"
          : t("screen.settings.title"),
    );
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
    if (page === "audio-output") {
      const refresh = document.createElement("button");
      refresh.className = "icon-button icon-button--quiet audio-output-refresh";
      refresh.type = "button";
      refresh.setAttribute("aria-label", "Refresh audio outputs");
      refresh.setAttribute("aria-busy", String(audioRefreshBusy));
      refresh.innerHTML = icon("refresh");
      refresh.disabled =
        !audioOutputState.mpvAvailable ||
        audioRefreshBusy ||
        audioOutputState.switching;
      refresh.addEventListener("click", () => {
        if (audioRefreshBusy) return;
        const refreshRequest = options.audioOutputApi.refresh();
        audioRefreshBusy = true;
        render();
        void refreshRequest
          .then(() => {
            options.showToast("Audio outputs refreshed.", "success");
          })
          .catch(() => {
            options.showToast("Audio outputs could not be refreshed.", "error");
          })
          .finally(() => {
            audioRefreshBusy = false;
            render();
          });
      });
      header.append(refresh);
    }
    const panel = document.createElement("section");
    panel.className = "settings-panel";
    section.append(header, panel);

    if (page === "root") {
      const interfaceButton = document.createElement("button");
      interfaceButton.className = "settings-row-base setting-navigation";
      interfaceButton.type = "button";
      interfaceButton.innerHTML = `<span><strong>${t("settings.interface")}</strong><small>${t("settings.interfaceDescription")}</small></span>${chevron()}`;
      interfaceButton.addEventListener("click", () => {
        page = "interface";
        render();
      });
      const audioButton = document.createElement("button");
      audioButton.className =
        "settings-row-base setting-navigation audio-output-navigation";
      audioButton.type = "button";
      const audioCopy = document.createElement("span");
      const audioTitle = document.createElement("strong");
      audioTitle.textContent = "Audio";
      const audioDetails = document.createElement("small");
      audioDetails.textContent = "Playback and output settings";
      audioCopy.append(audioTitle, audioDetails);
      const audioChevron = document.createElement("span");
      audioChevron.className = "settings-chevron";
      audioChevron.setAttribute("aria-hidden", "true");
      audioChevron.innerHTML = icon("chevronRight");
      audioButton.append(audioCopy, audioChevron);
      audioButton.addEventListener("click", () => {
        page = "audio";
        render();
      });
      const networkButton = document.createElement("button");
      networkButton.className = "settings-row-base setting-navigation";
      networkButton.type = "button";
      networkButton.innerHTML = `<span><strong>Network</strong><small></small></span>${chevron()}`;
      const summary = networkButton.querySelector("small");
      if (summary) summary.textContent = networkSummary(networkSnapshot);
      networkButton.addEventListener("click", () => {
        page = "network";
        render();
      });
      panel.append(interfaceButton, audioButton, networkButton);
      if (options.systemCapabilities.maintenanceMode) {
        const systemButton = document.createElement("button");
        systemButton.className = "settings-row-base setting-navigation";
        systemButton.type = "button";
        systemButton.innerHTML = `<span><strong>System</strong><small>Appliance maintenance and recovery</small></span>${chevron()}`;
        systemButton.addEventListener("click", () => {
          page = "system";
          render();
        });
        panel.append(systemButton);
      }
      return;
    }

    if (page === "audio") {
      const outputButton = document.createElement("button");
      outputButton.className =
        "settings-row-base setting-navigation audio-output-navigation";
      outputButton.type = "button";
      const outputCopy = document.createElement("span");
      const outputTitle = document.createElement("strong");
      outputTitle.textContent = "Output";
      const outputDetails = document.createElement("small");
      outputDetails.className = "audio-output-navigation__summary";
      outputDetails.textContent =
        audioOutputState.status === "preferred-unavailable"
          ? `${audioOutputState.preferredDevice.description} · Unavailable`
          : audioOutputState.preferredDevice.description;
      outputCopy.append(outputTitle, outputDetails);
      const outputChevron = document.createElement("span");
      outputChevron.className = "settings-chevron";
      outputChevron.setAttribute("aria-hidden", "true");
      outputChevron.innerHTML = icon("chevronRight");
      outputButton.append(outputCopy, outputChevron);
      outputButton.addEventListener("click", () => {
        page = "audio-output";
        render();
      });
      panel.append(outputButton);
      return;
    }

    if (page === "audio-output") {
      const status = document.createElement("p");
      status.className = "screen-header__description audio-output-status";
      status.textContent = audioStatusText();
      panel.before(status);
      const orderedDevices = [
        audioOutputState.devices.find((device) => device.id === "auto") ?? {
          id: "auto",
          description: "System default",
          available: true,
          systemDefault: true,
        },
        ...audioOutputState.devices.filter((device) => device.id !== "auto"),
      ];
      for (const device of orderedDevices) panel.append(audioDeviceRow(device));
      const preferred = audioOutputState.preferredDevice;
      if (
        preferred.deviceId !== "auto" &&
        !orderedDevices.some((device) => device.id === preferred.deviceId)
      )
        panel.append(
          audioDeviceRow(
            {
              id: preferred.deviceId,
              description: preferred.description,
              available: false,
            },
            true,
          ),
        );
      return;
    }

    if (page === "system") {
      const row = document.createElement("div");
      row.className = "settings-row-base setting-row";
      row.innerHTML =
        '<div class="setting-row__copy"><span class="setting-row__label">Maintenance mode</span><span class="setting-row__description">Stop playback and return to a local terminal for system maintenance.</span></div>';
      const action = document.createElement("button");
      action.className = "button button--secondary";
      action.type = "button";
      action.textContent = "Enter maintenance";
      action.addEventListener("click", () => {
        const dialog = document.createElement("dialog");
        dialog.className = "confirmation-dialog";
        dialog.innerHTML =
          '<form method="dialog"><h2>Enter maintenance mode?</h2><p>Playback will stop and Eidetic Player will close. Use “Return to Eidetic Player” from the desktop when finished.</p><div class="confirmation-dialog__actions"><button class="button button--secondary" value="cancel">Cancel</button><button class="button button--primary" value="confirm">Continue</button></div></form>';
        dialog.addEventListener(
          "close",
          () => {
            if (dialog.returnValue === "confirm") {
              action.disabled = true;
              void options.enterMaintenanceMode().catch((error: unknown) => {
                action.disabled = false;
                options.showToast(
                  error instanceof Error
                    ? error.message
                    : "Maintenance mode is unavailable.",
                  "error",
                );
              });
            }
            dialog.remove();
          },
          { once: true },
        );
        section.append(dialog);
        dialog.showModal();
      });
      row.append(action);
      panel.append(row);
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

    if (page === "keyboard") {
      const values: readonly [OnScreenKeyboardMode, string][] = [
        ["auto", t("common.auto")],
        ["always", t("common.always")],
        ["off", t("common.off")],
      ];
      for (const [value, label] of values)
        panel.append(
          selectionRow(label, onScreenKeyboard === value, () => {
            if (!options.onScreenKeyboardModeChange(value)) return false;
            onScreenKeyboard = value;
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

    const keyboardRow = document.createElement("button");
    keyboardRow.className = "settings-row-base setting-navigation";
    keyboardRow.type = "button";
    keyboardRow.innerHTML = `<span><strong>${t("settings.onScreenKeyboard")}</strong><small>${t(`common.${onScreenKeyboard}`)}</small></span>${chevron()}`;
    keyboardRow.addEventListener("click", () => {
      page = "keyboard";
      render();
    });

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
    updateNetworkSnapshot(snapshot) {
      if (snapshot.revision < networkSnapshot.revision) return;
      networkSnapshot = snapshot;
      if (page === "network") networkPanel?.update(snapshot);
      else if (page === "root") render();
    },
    updateAudioOutputState(snapshot) {
      if (snapshot.revision < audioOutputState.revision) return;
      audioOutputState = snapshot;
      if (page === "audio" || page === "audio-output") render();
    },
    requestLeave(leave) {
      return page === "network"
        ? (networkPanel?.requestLeave(leave) ?? false)
        : false;
    },
    destroy() {
      networkPanel?.destroy();
      options.setHeaderActions(null, null);
      section.replaceChildren();
    },
  };
}
