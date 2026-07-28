import { icon } from "../components/icons";
import { createConfirmationDialog } from "../components/confirmation-dialog";
import {
  createParametricEqEditor,
  type ParametricEqEditor,
} from "../components/parametric-eq-editor";
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
  CanonicalAudioOutput,
} from "../../../../packages/shared/src/audio-output";
import type { AudioOutputApiClient } from "../api/audio-output-api-client";
import {
  disconnectedAudioProcessingState,
  maximumSoftwareVolumeChoices,
  type AudioChannelMode,
  type AudioProcessingPatch,
  type AudioProcessingState,
  type EqualizerBand,
} from "../../../../packages/shared/src/audio-processing";
import {
  createNetworkSettingsPanel,
  networkSummary,
  type NetworkSettingsPanel,
} from "./network-settings-panel";
import type { UpdateApiClient } from "../api/update-api-client";
import type { SoftwareUpdateSnapshot } from "../../../../packages/shared/src/update";

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
  readonly updateApi: UpdateApiClient;
  readonly softwareUpdateState: SoftwareUpdateSnapshot;
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
  | "audio-output-routes"
  | "audio-output-advanced"
  | "audio-maximum-volume"
  | "audio-channels"
  | "audio-equalizer"
  | "audio-headroom"
  | "audio-advanced"
  | "keyboard"
  | "browsing"
  | "visualizer"
  | "inactivity"
  | "system"
  | "software-update"
  | "update-branch";

export function createSettingsScreen(
  options: SettingsScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen settings-screen";
  let page: SettingsPage = "root";
  let animations = options.animationsEnabled;
  let updateState = options.softwareUpdateState;
  let updateBusy = false;
  let visualizer = options.visualizerMode;
  let mainPlayer = options.mainPlayerMode;
  let browsing = options.musicBrowsingVisibility;
  let inactivity = options.returnToNowPlayingSeconds;
  let onScreenKeyboard = options.onScreenKeyboardMode;
  let networkSnapshot = options.networkSnapshot;
  let audioOutputState = options.audioOutputState;
  let audioProcessingState: AudioProcessingState =
    disconnectedAudioProcessingState;
  let selectedPhysicalOutput: CanonicalAudioOutput | null = null;
  let selectedEqualizerBand = 0;
  let audioProcessingBusy = false;
  let pendingAudioRouteId: string | null = null;
  let pendingPhysicalOutputId: string | null = null;
  let networkPanel: NetworkSettingsPanel | null = null;
  let parametricEqEditor: ParametricEqEditor | null = null;
  let audioSelectionBusy = false;
  let audioRefreshBusy = false;
  const confirmationDialog = createConfirmationDialog();

  const chevron = (): string =>
    `<span class="settings-chevron" aria-hidden="true">${icon("chevronRight")}</span>`;

  const resetSettingsScroll = (): void => {
    queueMicrotask(() => {
      const scrollRegion = section.closest<HTMLElement>(".screen-region");
      if (scrollRegion) scrollRegion.scrollTop = 0;
    });
  };

  const navigateBack = (): void => {
    if (
      page === "network" &&
      networkPanel?.requestLeave(() => {
        page = "root";
        render();
        resetSettingsScroll();
      })
    )
      return;
    if (
      page === "audio-output" ||
      page === "audio-maximum-volume" ||
      page === "audio-channels" ||
      page === "audio-equalizer" ||
      page === "audio-headroom" ||
      page === "audio-advanced"
    )
      page = "audio";
    else if (page === "audio-output-routes" || page === "audio-output-advanced")
      page = "audio-output";
    else if (page === "update-branch") page = "software-update";
    else if (page === "software-update") page = "system";
    else
      page =
        page === "interface" ||
        page === "network" ||
        page === "audio" ||
        page === "system"
          ? "root"
          : "interface";
    render();
    resetSettingsScroll();
  };

  const patchAudioProcessing = (
    patch: AudioProcessingPatch,
    successMessage?: string,
    returnPage?: SettingsPage,
  ): void => {
    if (audioProcessingBusy) return;
    audioProcessingBusy = true;
    render();
    void options.audioOutputApi
      .patchProcessing(patch)
      .then((result) => {
        audioProcessingState = result.state;
        window.dispatchEvent(
          new CustomEvent("eidetic-audio-processing", {
            detail: result.state,
          }),
        );
        if (successMessage) options.showToast(successMessage, "success");
        if (returnPage) {
          page = returnPage;
          resetSettingsScroll();
        }
      })
      .catch((error: unknown) => {
        options.showToast(
          error instanceof Error
            ? error.message
            : "Audio settings could not be changed.",
          "error",
        );
      })
      .finally(() => {
        audioProcessingBusy = false;
        render();
      });
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
      resetSettingsScroll();
    });
    return button;
  };

  const statePill = (
    label: string,
    tone: "active" | "pending" | "muted" = "muted",
  ): HTMLSpanElement => {
    const pill = document.createElement("span");
    pill.className = `settings-state-pill settings-state-pill--${tone}`;
    pill.textContent = label;
    return pill;
  };

  const selectAudioRoute = (
    device: AudioOutputDevice,
    physicalOutputId: string | null,
  ): void => {
    if (audioSelectionBusy) return;
    audioSelectionBusy = true;
    pendingAudioRouteId = device.id;
    pendingPhysicalOutputId = physicalOutputId;
    render();
    void options.audioOutputApi
      .select(device.id)
      .then(() => options.audioOutputApi.state())
      .then((state) => {
        audioOutputState = state;
        options.showToast(
          device.id === "auto"
            ? "Using System default."
            : "Audio output selected.",
          "success",
        );
      })
      .catch(() => {
        options.showToast("Audio output could not be changed.", "error");
      })
      .finally(() => {
        audioSelectionBusy = false;
        pendingAudioRouteId = null;
        pendingPhysicalOutputId = null;
        render();
      });
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
    const selected =
      pendingAudioRouteId === device.id ||
      (pendingAudioRouteId === null &&
        audioOutputState.preferredDevice.deviceId === device.id);
    if (pendingAudioRouteId === device.id)
      indicators.append(statePill("Activating", "pending"));
    else if (unavailable) indicators.append(statePill("Unavailable"));
    else if (audioOutputState.effectiveDeviceId === device.id)
      indicators.append(statePill("In use", "active"));
    else if (selected && audioOutputState.status === "pending-playback")
      indicators.append(statePill("On next playback", "pending"));
    const check = document.createElement("span");
    check.className = "setting-choice__check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = selected ? "✓" : "";
    indicators.append(check);
    row.append(copy, indicators);
    const disabled =
      unavailable ||
      !audioOutputState.mpvAvailable ||
      audioSelectionBusy ||
      audioOutputState.switching;
    row.disabled = disabled;
    row.setAttribute("aria-pressed", String(selected));
    if (!disabled) {
      row.addEventListener("click", () => {
        selectAudioRoute(device, selectedPhysicalOutput?.id ?? null);
      });
    }
    return row;
  };

  const navigationRow = (
    label: string,
    summary: string,
    target: SettingsPage,
  ): HTMLButtonElement => {
    const row = document.createElement("button");
    row.className = "settings-row-base setting-navigation";
    row.type = "button";
    const copy = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = label;
    const small = document.createElement("small");
    small.textContent = summary;
    copy.append(strong, small);
    row.innerHTML = "";
    row.append(copy);
    row.insertAdjacentHTML("beforeend", chevron());
    row.addEventListener("click", () => {
      page = target;
      render();
      resetSettingsScroll();
    });
    return row;
  };

  const channelModeLabel = (mode: AudioChannelMode): string => {
    const labels: Record<AudioChannelMode, string> = {
      stereo: "Stereo",
      mono: "Mono",
      "left-to-both": "Left to both",
      "right-to-both": "Right to both",
      swap: "Swap left / right",
    };
    return labels[mode];
  };

  const balanceLabel = (balance: number): string =>
    balance === 0
      ? "Center"
      : `${balance < 0 ? "L" : "R"} +${String(Math.abs(balance))}`;

  const segmentedSettingRow = <Value extends string>(optionsForRow: {
    readonly label: string;
    readonly description: string;
    readonly value: Value;
    readonly items: readonly {
      readonly value: Value;
      readonly label: string;
    }[];
    readonly bypassed?: boolean;
    readonly onChange: (
      value: Value,
      control: ReturnType<typeof createSegmentedControl<Value>>,
    ) => void;
  }): HTMLDivElement => {
    const row = document.createElement("div");
    row.className = "settings-row-base setting-row";
    row.classList.toggle(
      "setting-row--bypassed",
      optionsForRow.bypassed === true,
    );
    const copy = document.createElement("span");
    copy.className = "setting-row__copy";
    const label = document.createElement("span");
    label.className = "setting-row__label";
    label.textContent = optionsForRow.label;
    const description = document.createElement("span");
    description.className = "setting-row__description";
    description.textContent = optionsForRow.description;
    copy.append(label, description);
    const control = createSegmentedControl<Value>({
      label: optionsForRow.label,
      value: optionsForRow.value,
      items: optionsForRow.items,
      onChange: (value) => {
        optionsForRow.onChange(value, control);
      },
    });
    control.element.classList.add("segmented-control--compact");
    row.append(copy, control.element);
    return row;
  };

  const processingChoice = (
    label: string,
    selected: boolean,
    changes: AudioProcessingPatch["changes"],
    optionsForChoice: {
      confirmFixedOutput?: boolean;
      returnPage?: SettingsPage;
    } = {},
  ): HTMLButtonElement => {
    const row = document.createElement("button");
    row.className = "settings-row-base setting-choice";
    row.type = "button";
    row.disabled = audioProcessingBusy;
    row.innerHTML = `<span>${label}</span><span class="setting-choice__check" aria-hidden="true">${selected ? "✓" : ""}</span>`;
    row.addEventListener("click", () => {
      patchAudioProcessing(
        {
          changes,
          ...(optionsForChoice.confirmFixedOutput
            ? { confirmFixedOutput: true }
            : {}),
        },
        undefined,
        optionsForChoice.returnPage,
      );
    });
    return row;
  };

  function render(): void {
    networkPanel?.destroy();
    networkPanel = null;
    parametricEqEditor?.destroy();
    parametricEqEditor = null;
    confirmationDialog.close();
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
    const audioPageCopy: Partial<
      Record<SettingsPage, { title: string; description: string }>
    > = {
      audio: {
        title: "Audio",
        description: "Manage audio playback, output, and sound processing.",
      },
      "audio-output": {
        title: "Output Device",
        description: "Choose the physical audio output.",
      },
      "audio-output-routes": {
        title: "Output routes",
        description: "Choose an explicit route for this physical output.",
      },
      "audio-output-advanced": {
        title: "Advanced outputs",
        description:
          "Raw MPV output routes for diagnostics and manual selection.",
      },
      "audio-maximum-volume": {
        title: "Maximum Software Volume",
        description: "Limit the highest software-controlled listening level.",
      },
      "audio-channels": {
        title: "Channels",
        description: "Choose how the source channels reach the output.",
      },
      "audio-equalizer": {
        title: "Parametric EQ Bands",
        description: "Shape six touch-adjustable parametric bands.",
      },
      "audio-headroom": {
        title: "Headroom",
        description: "Control gain protection before the audio output.",
      },
      "audio-advanced": {
        title: "Advanced",
        description: "Inspect the effective audio signal path.",
      },
      "software-update": {
        title: "Software update",
        description:
          "Choose a branch, check its exact build, and install it safely.",
      },
      "update-branch": {
        title: "Update branch",
        description: "Choose from branches loaded from the installed source.",
      },
    };
    const audioCopy = audioPageCopy[page];
    const title =
      audioCopy?.title ??
      (page === "root"
        ? t("screen.settings.title")
        : page === "interface"
          ? t("settings.interface")
          : page === "system"
            ? "System"
            : page === "keyboard"
              ? t("settings.onScreenKeyboard")
              : page === "browsing"
                ? t("settings.musicBrowsing")
                : page === "visualizer"
                  ? t("settings.visualizer")
                  : t("settings.returnToNowPlaying"));
    const description =
      audioCopy?.description ??
      (page === "root"
        ? t("screen.settings.description")
        : page === "interface"
          ? t("settings.interfaceDescription")
          : page === "system"
            ? "Appliance maintenance and local recovery."
            : page === "keyboard"
              ? t("settings.onScreenKeyboardDescription")
              : page === "browsing"
                ? t("settings.musicBrowsingDescription")
                : page === "visualizer"
                  ? t("settings.visualizerDescription")
                  : t("settings.returnToNowPlayingDescription"));
    options.setScreenTitle(audioCopy?.title ?? t("screen.settings.title"));
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
        resetSettingsScroll();
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
        resetSettingsScroll();
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
        resetSettingsScroll();
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
          resetSettingsScroll();
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
      outputTitle.textContent = "Output Device";
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
        resetSettingsScroll();
      });
      const processing = audioProcessingState.preferences;
      const softwareVolume = segmentedSettingRow<"variable" | "fixed">({
        label: "Software Volume",
        description:
          processing.outputLevelMode === "fixed"
            ? "Locked at 100%. Control listening level with an external amplifier."
            : "Control listening level in Eidetic Player.",
        value: processing.outputLevelMode,
        items: [
          { value: "variable", label: "Variable" },
          { value: "fixed", label: "Fixed 100%" },
        ],
        onChange: (value, control) => {
          if (value === processing.outputLevelMode) return;
          if (value === "variable") {
            patchAudioProcessing(
              { changes: { outputLevelMode: "variable" } },
              "Variable software volume enabled.",
            );
            return;
          }
          control.setValue(processing.outputLevelMode);
          section.append(
            confirmationDialog.backdrop,
            confirmationDialog.element,
          );
          confirmationDialog.open({
            title: "Enable fixed output?",
            description:
              "Playback will pause. Software volume and mute will be disabled and output will be fixed at 100%. Control listening level with an external amplifier.",
            confirmLabel: "Enable Fixed",
            returnFocus:
              softwareVolume.querySelector<HTMLButtonElement>(
                '[data-value="fixed"]',
              ) ?? softwareVolume,
            onConfirm: () => {
              patchAudioProcessing(
                {
                  changes: { outputLevelMode: "fixed" },
                  confirmFixedOutput: true,
                },
                "Fixed output enabled. Playback remains paused.",
              );
            },
          });
        },
      });
      const channels = navigationRow(
        "Channels",
        channelModeLabel(processing.channelMode),
        "audio-channels",
      );
      if (!processing.audioProcessingEnabled)
        channels.classList.add("setting-row--bypassed");
      const balance = document.createElement("label");
      balance.className = "settings-row-base setting-row balance-setting";
      balance.classList.toggle(
        "setting-row--bypassed",
        processing.channelMode !== "stereo" ||
          !processing.audioProcessingEnabled,
      );
      const balanceCopy = document.createElement("span");
      balanceCopy.className = "setting-row__copy";
      const balanceTitle = document.createElement("span");
      balanceTitle.className = "setting-row__label";
      balanceTitle.textContent = "Balance";
      const balanceValue = document.createElement("span");
      balanceValue.className =
        "setting-row__description balance-setting__value";
      balanceValue.textContent =
        processing.channelMode === "stereo"
          ? balanceLabel(processing.balanceDb)
          : "Available in Stereo";
      balanceCopy.append(balanceTitle, balanceValue);
      const balanceSlider = document.createElement("span");
      balanceSlider.className = "balance-slider";
      const centerMark = document.createElement("span");
      centerMark.className = "balance-slider__center";
      centerMark.setAttribute("aria-hidden", "true");
      const balanceInput = document.createElement("input");
      balanceInput.type = "range";
      balanceInput.min = "-12";
      balanceInput.max = "12";
      balanceInput.step = "1";
      balanceInput.value = String(Math.round(processing.balanceDb));
      balanceInput.disabled =
        processing.channelMode !== "stereo" || audioProcessingBusy;
      balanceInput.setAttribute("aria-label", "Stereo balance");
      balanceInput.setAttribute(
        "aria-valuetext",
        balanceLabel(Number(balanceInput.value)),
      );
      balanceInput.addEventListener("input", () => {
        const label = balanceLabel(Number(balanceInput.value));
        balanceValue.textContent = label;
        balanceInput.setAttribute("aria-valuetext", label);
      });
      balanceInput.addEventListener("change", () => {
        patchAudioProcessing({
          changes: { balanceDb: Number(balanceInput.value) },
        });
      });
      balanceSlider.append(centerMark, balanceInput);
      balance.append(balanceCopy, balanceSlider);
      const soundProcessing = segmentedSettingRow<"on" | "bypass">({
        label: "Sound Processing",
        description: processing.audioProcessingEnabled
          ? "Eidetic channel, EQ, and headroom processing is active."
          : "Settings remain editable and will apply when processing is On.",
        value: processing.audioProcessingEnabled ? "on" : "bypass",
        items: [
          { value: "on", label: "On" },
          { value: "bypass", label: "Bypass" },
        ],
        onChange: (value) => {
          patchAudioProcessing({
            changes: { audioProcessingEnabled: value === "on" },
          });
        },
      });
      const parametricEq = segmentedSettingRow<"on" | "bypass">({
        label: "Parametric EQ",
        description: !processing.audioProcessingEnabled
          ? "Bypassed by Sound Processing; settings remain editable."
          : processing.equalizerEnabled
            ? "Six parametric bands are active."
            : "Bands remain editable and will apply when EQ is On.",
        value: processing.equalizerEnabled ? "on" : "bypass",
        items: [
          { value: "on", label: "On" },
          { value: "bypass", label: "Bypass" },
        ],
        bypassed: !processing.audioProcessingEnabled,
        onChange: (value) => {
          patchAudioProcessing({
            changes: { equalizerEnabled: value === "on" },
          });
        },
      });
      const eqBands = navigationRow(
        "Parametric EQ Bands",
        !processing.audioProcessingEnabled || !processing.equalizerEnabled
          ? "Six bands · currently bypassed"
          : audioProcessingState.signalPath.equalizer === "active"
            ? "Six bands · custom"
            : "Six bands · flat",
        "audio-equalizer",
      );
      if (!processing.audioProcessingEnabled || !processing.equalizerEnabled)
        eqBands.classList.add("setting-row--bypassed");
      const gainCompensation = segmentedSettingRow<"on" | "off">({
        label: "Gain Compensation",
        description:
          processing.headroomMode === "off"
            ? "Off. Positive EQ gain can clip."
            : processing.headroomMode === "manual"
              ? `Manual preamp · ${String(audioProcessingState.signalPath.preampDb)} dB`
              : `Automatic · ${String(audioProcessingState.signalPath.preampDb)} dB`,
        value: processing.headroomMode === "off" ? "off" : "on",
        items: [
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ],
        bypassed:
          !processing.audioProcessingEnabled || !processing.equalizerEnabled,
        onChange: (value) => {
          patchAudioProcessing({
            changes: { headroomMode: value === "on" ? "auto" : "off" },
          });
        },
      });
      const headroom = navigationRow(
        "Headroom",
        processing.headroomMode === "manual"
          ? `Manual · ${String(processing.manualPreampDb)} dB`
          : `${processing.headroomMode.charAt(0).toUpperCase()}${processing.headroomMode.slice(1)}`,
        "audio-headroom",
      );
      if (!processing.audioProcessingEnabled)
        headroom.classList.add("setting-row--bypassed");
      panel.append(outputButton, softwareVolume);
      if (processing.outputLevelMode === "variable")
        panel.append(
          navigationRow(
            "Maximum Software Volume",
            `${String(processing.maximumSoftwareVolume)}%`,
            "audio-maximum-volume",
          ),
        );
      panel.append(
        soundProcessing,
        channels,
        balance,
        parametricEq,
        eqBands,
        gainCompensation,
        headroom,
        navigationRow(
          "Advanced",
          "Signal path and diagnostics",
          "audio-advanced",
        ),
      );
      return;
    }

    if (page === "audio-output") {
      const devicesLabel = document.createElement("p");
      devicesLabel.className = "settings-section-label";
      devicesLabel.textContent = "Devices";
      panel.append(devicesLabel);
      for (const output of audioOutputState.canonicalOutputs) {
        const row = document.createElement("button");
        row.className = "settings-row-base audio-output-row";
        row.type = "button";
        const copy = document.createElement("span");
        copy.className = "audio-output-row__copy";
        const name = document.createElement("strong");
        name.textContent = output.description;
        const detail = document.createElement("small");
        detail.textContent =
          output.routes.length > 1
            ? `${String(output.routes.length)} available routes`
            : (output.routes[0]?.description ?? "Unavailable");
        copy.append(name, detail);
        const indicators = document.createElement("span");
        indicators.className = "audio-output-row__indicators";
        const selected =
          pendingPhysicalOutputId === output.id ||
          (pendingPhysicalOutputId === null &&
            output.id === audioOutputState.selectedPhysicalOutputId);
        if (pendingPhysicalOutputId === output.id)
          indicators.append(statePill("Activating", "pending"));
        else if (!output.available) indicators.append(statePill("Unavailable"));
        else if (
          output.routes.some(
            (route) => route.id === audioOutputState.effectiveDeviceId,
          )
        )
          indicators.append(statePill("In use", "active"));
        else if (selected && audioOutputState.status === "pending-playback")
          indicators.append(statePill("On next playback", "pending"));
        const check = document.createElement("span");
        check.className = "setting-choice__check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = selected ? "✓" : "";
        indicators.append(check);
        if (output.routes.length > 1) {
          const routeChevron = document.createElement("span");
          routeChevron.className = "settings-chevron";
          routeChevron.setAttribute("aria-hidden", "true");
          routeChevron.innerHTML = icon("chevronRight");
          indicators.append(routeChevron);
        }
        row.append(copy, indicators);
        row.setAttribute("aria-pressed", String(selected));
        row.disabled =
          !output.available || audioSelectionBusy || audioOutputState.switching;
        row.addEventListener("click", () => {
          selectedPhysicalOutput = output;
          const route = output.routes[0];
          if (output.routes.length === 1 && route)
            selectAudioRoute(
              {
                id: route.id,
                description: route.description,
                available: route.available,
              },
              output.id,
            );
          else {
            page = "audio-output-routes";
            render();
            resetSettingsScroll();
          }
        });
        panel.append(row);
      }
      const advancedLabel = document.createElement("p");
      advancedLabel.className =
        "settings-section-label settings-section-label--separated";
      advancedLabel.textContent = "Advanced";
      panel.append(
        advancedLabel,
        navigationRow(
          "Advanced Outputs",
          "View raw MPV routes",
          "audio-output-advanced",
        ),
      );
      return;
    }

    if (page === "audio-output-routes") {
      const output =
        selectedPhysicalOutput ??
        audioOutputState.canonicalOutputs.find(
          (candidate) =>
            candidate.id === audioOutputState.selectedPhysicalOutputId,
        );
      if (!output) {
        page = "audio-output";
        render();
        resetSettingsScroll();
        return;
      }
      selectedPhysicalOutput = output;
      for (const route of output.routes)
        panel.append(
          audioDeviceRow({
            id: route.id,
            description: route.description,
            available: route.available,
          }),
        );
      return;
    }

    if (page === "audio-output-advanced") {
      for (const device of audioOutputState.devices)
        panel.append(audioDeviceRow(device, !device.available));
      return;
    }

    if (page === "audio-maximum-volume") {
      const processing = audioProcessingState.preferences;
      for (const maximum of maximumSoftwareVolumeChoices)
        panel.append(
          processingChoice(
            `${String(maximum)}%`,
            processing.maximumSoftwareVolume === maximum,
            { maximumSoftwareVolume: maximum },
            { returnPage: "audio" },
          ),
        );
      return;
    }

    if (page === "audio-channels") {
      const processing = audioProcessingState.preferences;
      const modes: readonly [AudioChannelMode, string][] = [
        ["stereo", "Stereo"],
        ["mono", "Mono · normalized dual mono"],
        ["left-to-both", "Left to both"],
        ["right-to-both", "Right to both"],
        ["swap", "Swap left / right"],
      ];
      for (const [mode, label] of modes)
        panel.append(
          processingChoice(
            label,
            processing.channelMode === mode,
            {
              channelMode: mode,
            },
            { returnPage: "audio" },
          ),
        );
      return;
    }

    if (page === "audio-headroom") {
      const processing = audioProcessingState.preferences;
      for (const mode of ["auto", "manual", "off"] as const)
        panel.append(
          processingChoice(
            `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`,
            processing.headroomMode === mode,
            { headroomMode: mode },
            mode === "manual" ? {} : { returnPage: "audio" },
          ),
        );
      if (processing.headroomMode === "manual") {
        const manual = document.createElement("label");
        manual.className = "settings-row-base setting-row audio-range-row";
        manual.innerHTML = `<span class="setting-row__copy"><strong>Manual Gain</strong><small>${String(processing.manualPreampDb)} dB</small></span>`;
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "-12";
        slider.max = "0";
        slider.step = "0.5";
        slider.value = String(processing.manualPreampDb);
        slider.disabled = audioProcessingBusy;
        slider.addEventListener("change", () => {
          patchAudioProcessing({
            changes: { manualPreampDb: Number(slider.value) },
          });
        });
        manual.append(slider);
        panel.append(manual);
      }
      if (audioProcessingState.signalPath.warning === "positive-gain") {
        const warning = document.createElement("p");
        warning.className = "settings-warning";
        warning.textContent =
          "Headroom is Off while EQ has positive gain. Clipping is possible.";
        panel.append(warning);
      }
      return;
    }

    if (page === "audio-equalizer") {
      panel.remove();
      const processing = audioProcessingState.preferences;
      const updateBand = (
        bandIndex: number,
        changes: Partial<EqualizerBand>,
      ): void => {
        const bands = audioProcessingState.preferences.equalizerBands.map(
          (candidate, index) =>
            index === bandIndex ? { ...candidate, ...changes } : candidate,
        );
        patchAudioProcessing({ changes: { equalizerBands: bands } });
      };
      parametricEqEditor = createParametricEqEditor({
        bands: processing.equalizerBands,
        selectedBand: selectedEqualizerBand,
        bypassed:
          !processing.audioProcessingEnabled || !processing.equalizerEnabled,
        busy: audioProcessingBusy,
        compensationDb: audioProcessingState.signalPath.preampDb,
        headroomMode: processing.headroomMode,
        onSelectBand: (index) => {
          selectedEqualizerBand = index;
        },
        onUpdateBand: updateBand,
      });
      section.append(parametricEqEditor.element);
      return;
    }

    if (page === "audio-advanced") {
      const path = audioProcessingState.signalPath;
      const entries = [
        ["Output Device", audioOutputState.preferredDevice.description],
        ["Software Volume Mode", path.outputLevel],
        [
          "Software volume",
          path.outputLevel === "fixed"
            ? "100% · locked"
            : `${String(path.softwareVolume)}% / ${String(path.maximumSoftwareVolume)}%`,
        ],
        ["Eidetic processing", path.processing],
        ["Channels", path.channels],
        ["Balance", `${String(path.balanceDb)} dB`],
        ["Parametric EQ", path.equalizer],
        ["Headroom", `${path.headroomMode} · ${String(path.preampDb)} dB`],
        ["Projected peak gain", `${String(path.projectedPeakGainDb)} dB`],
        ["MPV filter label", path.filterLabel],
      ] as const;
      for (const [label, value] of entries) {
        const row = document.createElement("div");
        row.className = "settings-row-base setting-row";
        row.innerHTML = `<span class="setting-row__copy"><strong>${label}</strong><small></small></span>`;
        const small = row.querySelector("small");
        if (small) small.textContent = value;
        panel.append(row);
      }
      return;
    }

    if (page === "system") {
      const activeJob = [
        "queued",
        "running",
        "activating",
        "restarting",
        "verifying",
      ].includes(updateState.job.state);
      if (updateState.available) {
        const updateRow = document.createElement("button");
        updateRow.className = "settings-row-base setting-navigation";
        updateRow.type = "button";
        const updateSummary = activeJob
          ? `Updating · ${updateState.job.phase?.label ?? updateState.job.state}`
          : updateState.job.state === "failed"
            ? "Last update failed"
            : updateState.plan?.updateAvailable
              ? `Update available · ${updateState.plan.targetShortCommitSha}`
              : `Build ${updateState.currentShortCommitSha} · ${updateState.selectedBranch}`;
        updateRow.innerHTML = `<span><strong>Software update</strong><small>${updateSummary}</small></span>${chevron()}`;
        updateRow.addEventListener("click", () => {
          page = "software-update";
          render();
          resetSettingsScroll();
        });
        panel.append(updateRow);
      }
      const row = document.createElement("div");
      row.className = "settings-row-base setting-row";
      row.innerHTML =
        '<div class="setting-row__copy"><span class="setting-row__label">Maintenance mode</span><span class="setting-row__description">Stop playback and return to a local terminal for system maintenance.</span></div>';
      const action = document.createElement("button");
      action.className = "button button--secondary";
      action.type = "button";
      action.textContent = "Enter maintenance";
      action.disabled = activeJob;
      action.addEventListener("click", () => {
        section.append(confirmationDialog.backdrop, confirmationDialog.element);
        confirmationDialog.open({
          title: "Enter maintenance mode?",
          description:
            "Playback will stop and Eidetic Player will close. Use “Return to Eidetic Player” from the desktop when finished.",
          confirmLabel: "Continue",
          returnFocus: action,
          onConfirm: () => {
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
          },
        });
      });
      row.append(action);
      panel.append(row);
      return;
    }

    if (page === "update-branch") {
      const updateActive = [
        "queued",
        "running",
        "activating",
        "restarting",
        "verifying",
      ].includes(updateState.job.state);
      if (!updateState.branchesLoaded) {
        const unloaded = document.createElement("div");
        unloaded.className = "settings-row-base setting-row";
        unloaded.innerHTML =
          '<span class="setting-row__copy"><strong>Branches not loaded</strong><small>Use Refresh branches to load the remote branch list.</small></span>';
        panel.append(unloaded);
      } else {
        for (const branch of updateState.branches) {
          const row = document.createElement("button");
          row.className = "settings-row-base setting-choice";
          row.type = "button";
          const selected = branch.name === updateState.selectedBranch;
          row.disabled = updateActive;
          const copy = document.createElement("span");
          copy.className = "setting-row__copy";
          const name = document.createElement("strong");
          name.textContent = branch.name;
          const detail = document.createElement("small");
          detail.className = "update-branch__detail";
          detail.append(
            statePill(
              branch.channel === "stable" ? "Stable" : "Development",
              branch.channel === "stable" ? "active" : "muted",
            ),
            document.createTextNode(`Build ${branch.shortCommitSha}`),
          );
          copy.append(name, detail);
          const checkmark = document.createElement("span");
          checkmark.className = "setting-choice__check";
          checkmark.setAttribute("aria-hidden", "true");
          checkmark.textContent = selected ? "✓" : "";
          row.append(copy, checkmark);
          row.addEventListener("click", () => {
            if (selected || updateBusy) return;
            updateBusy = true;
            void options.updateApi
              .selectBranch(branch.name)
              .then((snapshot) => {
                updateState = snapshot;
                options.showToast(
                  `Update branch set to ${branch.name}.`,
                  "success",
                );
              })
              .catch((error: unknown) => {
                options.showToast(
                  error instanceof Error
                    ? error.message
                    : "The branch could not be selected.",
                  "error",
                );
              })
              .finally(() => {
                updateBusy = false;
                render();
              });
          });
          panel.append(row);
        }
      }
      const refresh = document.createElement("button");
      refresh.className = "settings-row-base setting-navigation";
      refresh.type = "button";
      refresh.disabled = updateBusy || updateActive;
      refresh.innerHTML =
        "<span><strong>Refresh branches</strong><small>Load remote branches on demand.</small></span>";
      refresh.addEventListener("click", () => {
        updateBusy = true;
        render();
        void options.updateApi
          .refreshBranches()
          .then((snapshot) => {
            updateState = snapshot;
          })
          .catch((error: unknown) => {
            options.showToast(
              error instanceof Error
                ? error.message
                : "Branches could not be refreshed.",
              "error",
            );
          })
          .finally(() => {
            updateBusy = false;
            render();
          });
      });
      panel.append(refresh);
      return;
    }

    if (page === "software-update") {
      const active = [
        "queued",
        "running",
        "activating",
        "restarting",
        "verifying",
      ].includes(updateState.job.state);
      const branch = navigationRow(
        "Update branch",
        updateState.selectedBranch,
        "update-branch",
      );
      branch.classList.toggle("setting-row--disabled", active);
      branch.disabled = active;
      const current = document.createElement("div");
      current.className = "settings-row-base setting-row";
      current.innerHTML = `<span class="setting-row__copy"><strong>Current build</strong><small>${updateState.currentShortCommitSha}</small></span>`;
      const target = document.createElement("div");
      target.className = "settings-row-base setting-row";
      target.innerHTML = `<span class="setting-row__copy"><strong>Target build</strong><small>${updateState.plan?.targetShortCommitSha ?? "Check required"}</small></span>`;
      const check = document.createElement("button");
      check.className = "settings-row-base setting-navigation";
      check.type = "button";
      check.disabled = updateBusy || active;
      check.innerHTML =
        "<span><strong>Check for updates</strong><small>Resolve the selected branch to an exact build.</small></span>";
      check.addEventListener("click", () => {
        updateBusy = true;
        render();
        void options.updateApi
          .check()
          .then((snapshot) => {
            updateState = snapshot;
            options.showToast(
              snapshot.plan?.updateAvailable
                ? "Update available."
                : `Eidetic Player is up to date. Build ${snapshot.currentShortCommitSha}.`,
              snapshot.plan?.updateAvailable ? "success" : "neutral",
            );
          })
          .catch((error: unknown) => {
            options.showToast(
              error instanceof Error ? error.message : "Update check failed.",
              "error",
            );
          })
          .finally(() => {
            updateBusy = false;
            render();
          });
      });
      const start = document.createElement("button");
      start.className = "settings-row-base setting-navigation";
      start.type = "button";
      start.disabled =
        updateBusy || active || updateState.plan?.updateAvailable !== true;
      start.innerHTML =
        "<span><strong>Start update</strong><small>The player remains available while the update is prepared.</small></span>";
      start.addEventListener("click", () => {
        const plan = updateState.plan;
        if (!plan) return;
        section.append(confirmationDialog.backdrop, confirmationDialog.element);
        confirmationDialog.open({
          title: "Install update?",
          description: `Branch: ${plan.branch}\nCurrent build: ${plan.currentShortCommitSha}\nTarget build: ${plan.targetShortCommitSha}\n\nEidetic Player will remain available while the update is prepared and will restart briefly during activation.`,
          confirmLabel: "Start update",
          returnFocus: start,
          onConfirm: () => {
            updateBusy = true;
            void options.updateApi
              .start(plan.id, plan.targetCommitSha)
              .then((snapshot) => {
                updateState = snapshot;
                render();
              })
              .catch((error: unknown) => {
                options.showToast(
                  error instanceof Error
                    ? error.message
                    : "The update could not be started.",
                  "error",
                );
              })
              .finally(() => {
                updateBusy = false;
              });
          },
        });
      });
      panel.append(branch, current, target, check, start);
      if (active || updateState.job.completedAt) {
        const status = document.createElement("div");
        status.className = "settings-row-base setting-row";
        status.innerHTML = `<span class="setting-row__copy"><strong>${active ? "Update in progress" : updateState.job.state === "succeeded" ? "Update completed" : "Last update failed"}</strong><small>${updateState.job.phase?.label ?? updateState.job.result ?? updateState.job.state}</small></span>`;
        panel.append(status);
      }
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

  void options.audioOutputApi
    .processingState()
    .then((state) => {
      audioProcessingState = state;
      if (page.startsWith("audio")) render();
    })
    .catch(() => {
      options.showToast("Audio processing status is unavailable.", "error");
    });
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
      if (page.startsWith("audio")) render();
    },
    updateSoftwareUpdateState(snapshot) {
      if (snapshot.revision < updateState.revision) return;
      updateState = snapshot;
      if (
        page === "root" ||
        page === "system" ||
        page === "software-update" ||
        page === "update-branch"
      )
        render();
    },
    requestLeave(leave) {
      return page === "network"
        ? (networkPanel?.requestLeave(leave) ?? false)
        : false;
    },
    destroy() {
      networkPanel?.destroy();
      parametricEqEditor?.destroy();
      confirmationDialog.destroy();
      options.setHeaderActions(null, null);
      section.replaceChildren();
    },
  };
}
