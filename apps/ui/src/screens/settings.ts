import { icon } from "../components/icons";
import { createConfirmationDialog } from "../components/confirmation-dialog";
import { displaySettingsPresentationChanged } from "../display/display-settings-snapshot";
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
import type { RemoteAccessApiClient } from "../api/remote-access-api-client";
import type { SystemCapabilities } from "../../../../packages/shared/src/system";
import type {
  AudioOutputDevice,
  AudioOutputState,
  CanonicalAudioOutput,
} from "../../../../packages/shared/src/audio-output";
import type { AudioOutputApiClient } from "../api/audio-output-api-client";
import { PlayerApiError } from "../api/player-api-client";
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
import {
  createRemoteAccessSettingsPanel,
  type RemoteAccessSettingsPanel,
} from "./remote-access-settings-panel";
import type { UpdateApiClient } from "../api/update-api-client";
import type { SoftwareUpdateSnapshot } from "../../../../packages/shared/src/update";
import {
  displayTimeoutsAreCompatible,
  screenDimLevelChoices,
  screenDimTimeoutChoices,
  screenStandbyTimeoutChoices,
  type DisplaySnapshot,
  type ScreenDimLevelPercent,
  type ScreenDimTimeoutSeconds,
  type ScreenStandbyTimeoutSeconds,
} from "../../../../packages/shared/src/display";
import type {
  ContinuePlaybackMode,
  ExternalPlaybackEndPolicy,
} from "../../../../packages/shared/src/preferences";

export interface SettingsScreenOptions {
  readonly animationsEnabled: boolean;
  readonly visualizerMode: VisualizerMode;
  readonly mainPlayerMode: MainPlayerMode;
  readonly timelineStyle: TimelineStyle;
  readonly musicBrowsingVisibility: MusicBrowsingVisibility;
  readonly returnToNowPlayingSeconds: ReturnToNowPlayingSeconds;
  readonly onScreenKeyboardMode: OnScreenKeyboardMode;
  readonly continuePlaybackMode: ContinuePlaybackMode;
  readonly externalPlaybackEndPolicy: ExternalPlaybackEndPolicy;
  readonly systemCapabilities: SystemCapabilities;
  readonly enterMaintenanceMode: () => Promise<void>;
  readonly updateApi: UpdateApiClient;
  readonly softwareUpdateState: SoftwareUpdateSnapshot;
  readonly displaySnapshot: DisplaySnapshot;
  readonly screenDimTimeoutSeconds: ScreenDimTimeoutSeconds;
  readonly screenDimLevelPercent: ScreenDimLevelPercent;
  readonly screenStandbyTimeoutSeconds: ScreenStandbyTimeoutSeconds;
  readonly setDisplayPreferences: (changes: {
    readonly screenDimTimeoutSeconds?: ScreenDimTimeoutSeconds;
    readonly screenDimLevelPercent?: ScreenDimLevelPercent;
    readonly screenStandbyTimeoutSeconds?: ScreenStandbyTimeoutSeconds;
  }) => boolean;
  readonly testDisplayDim: () => Promise<void>;
  readonly testDisplayStandby: () => Promise<void>;
  readonly networkApi: NetworkApiClient;
  readonly remoteAccessApi: RemoteAccessApiClient;
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
  readonly onContinuePlaybackModeChange: (
    value: ContinuePlaybackMode,
  ) => boolean;
  readonly onExternalPlaybackEndPolicyChange: (
    value: ExternalPlaybackEndPolicy,
  ) => boolean;
}

type SettingsPage =
  | "root"
  | "interface"
  | "network"
  | "remote-access"
  | "audio"
  | "audio-output"
  | "audio-output-routes"
  | "audio-output-advanced"
  | "audio-maximum-volume"
  | "audio-channels"
  | "audio-equalizer"
  | "audio-headroom"
  | "audio-advanced"
  | "playback"
  | "playback-continue"
  | "playback-external-end"
  | "keyboard"
  | "browsing"
  | "visualizer"
  | "inactivity"
  | "system"
  | "software-update"
  | "update-branch"
  | "display"
  | "display-dim-timeout"
  | "display-dim-level"
  | "display-standby-timeout";

type UpdateBusyAction = "branch" | "refresh" | "check" | "start";

function formatDisplayTimeout(seconds: number): string {
  if (seconds === 0) return "Off";
  if (seconds < 60) return `${String(seconds)} seconds`;
  const minutes = seconds / 60;
  return `${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
}

function formatCompactDisplayTimeout(seconds: number): string {
  if (seconds === 0) return "Off";
  if (seconds < 60) return `${String(seconds)} sec`;
  return `${String(seconds / 60)} min`;
}

function displaySummary(
  dimTimeout: ScreenDimTimeoutSeconds,
  standbyTimeout: ScreenStandbyTimeoutSeconds,
  snapshot: DisplaySnapshot,
): string {
  if (snapshot.standbyInhibitedReason === "hdmi-audio-active")
    return "Standby suspended by HDMI audio";
  if (dimTimeout === 0 && standbyTimeout === 0)
    return snapshot.standbyAvailable
      ? "Always on"
      : "Always on · Standby unavailable";
  if (!snapshot.standbyAvailable)
    return dimTimeout === 0
      ? "Standby unavailable"
      : `Dim after ${formatCompactDisplayTimeout(dimTimeout)} · Standby unavailable`;
  if (dimTimeout > 0 && standbyTimeout > 0)
    return `Dim ${formatCompactDisplayTimeout(dimTimeout)} · Off ${formatCompactDisplayTimeout(standbyTimeout)}`;
  if (dimTimeout > 0)
    return `Dim after ${formatCompactDisplayTimeout(dimTimeout)}`;
  return `Off after ${formatCompactDisplayTimeout(standbyTimeout)}`;
}

function displayCapabilitySummary(snapshot: DisplaySnapshot): string {
  const dim =
    snapshot.dimMethod === "hardware-backlight"
      ? "Dimming: Hardware backlight"
      : "Dimming: Software fallback";
  const standby: Record<DisplaySnapshot["standbyMethod"], string> = {
    "wayland-output": "Standby: Wayland output power",
    "backlight-off": "Standby: Backlight off",
    fixture: "Standby: Simulated fixture",
    none: "Standby: Unavailable",
  };
  return `${dim} · ${standby[snapshot.standbyMethod]}`;
}

function formatUpdateBuildDate(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatUpdateLogTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function updateJobLabel(state: SoftwareUpdateSnapshot["job"]["state"]): string {
  const labels: Record<SoftwareUpdateSnapshot["job"]["state"], string> = {
    idle: "Idle",
    queued: "Queued",
    running: "Running",
    activating: "Activating",
    restarting: "Restarting",
    verifying: "Verifying",
    succeeded: "Completed",
    failed: "Failed",
    "rolled-back": "Rolled back",
    interrupted: "Interrupted",
    "recovery-required": "Recovery required",
  };
  return labels[state];
}

export function createSettingsScreen(
  options: SettingsScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen settings-screen";
  let page: SettingsPage = "root";
  let animations = options.animationsEnabled;
  let updateState = options.softwareUpdateState;
  let displayState = options.displaySnapshot;
  let dimTimeout = options.screenDimTimeoutSeconds;
  let dimLevel = options.screenDimLevelPercent;
  let standbyTimeout = options.screenStandbyTimeoutSeconds;
  let displayBusy = false;
  let updateBusy = false;
  let updateBusyAction: UpdateBusyAction | null = null;
  let updatePageRefresh: (() => void) | null = null;
  let visualizer = options.visualizerMode;
  let mainPlayer = options.mainPlayerMode;
  let browsing = options.musicBrowsingVisibility;
  let inactivity = options.returnToNowPlayingSeconds;
  let onScreenKeyboard = options.onScreenKeyboardMode;
  let continuePlayback = options.continuePlaybackMode;
  let externalPlaybackEndPolicy = options.externalPlaybackEndPolicy;
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
  let remoteAccessPanel: RemoteAccessSettingsPanel | null = null;
  let parametricEqEditor: ParametricEqEditor | null = null;
  let audioSelectionBusy = false;
  let audioRefreshBusy = false;
  const confirmationDialog = createConfirmationDialog();

  const chevron = (): string =>
    `<span class="settings-chevron" aria-hidden="true">${icon("chevronRight")}</span>`;

  const resetSettingsScroll = (): void => {
    queueMicrotask(() => {
      const scrollRegion = section.closest<HTMLElement>(".screen-region");
      if (scrollRegion) {
        scrollRegion.scrollTop = 0;
        scrollRegion.scrollLeft = 0;
      }
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
    else if (
      page === "display-dim-timeout" ||
      page === "display-dim-level" ||
      page === "display-standby-timeout"
    )
      page = "display";
    else if (page === "display") page = "system";
    else if (page === "playback-continue" || page === "playback-external-end")
      page = "playback";
    else if (page === "remote-access") page = "root";
    else
      page =
        page === "interface" ||
        page === "network" ||
        page === "audio" ||
        page === "playback" ||
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
    let positiveGainConfirmationRequired = false;
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
        if (
          error instanceof PlayerApiError &&
          error.code === "POSITIVE_GAIN_CONFIRMATION_REQUIRED"
        ) {
          positiveGainConfirmationRequired = true;
          return;
        }
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
        if (!positiveGainConfirmationRequired) return;
        const activation = patch.changes.audioProcessingEnabled
          ? "sound-processing"
          : patch.changes.equalizerEnabled
            ? "parametric-eq"
            : null;
        const returnFocus = activation
          ? (section.querySelector<HTMLButtonElement>(
              `[data-audio-setting="${activation}"] [data-value="on"]`,
            ) ?? undefined)
          : undefined;
        section.append(confirmationDialog.backdrop, confirmationDialog.element);
        confirmationDialog.open({
          title: "Enable with possible clipping?",
          description:
            "The current EQ and headroom settings can add positive gain. Audio may clip.",
          confirmLabel: "Enable anyway",
          ...(returnFocus ? { returnFocus } : {}),
          onConfirm: () => {
            patchAudioProcessing(
              { ...patch, confirmPositiveGain: true },
              successMessage,
              returnPage,
            );
          },
        });
      });
  };

  const selectionRow = (
    label: string,
    selected: boolean,
    commit: () => boolean,
    returnPage: SettingsPage = "interface",
    description?: string,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = "settings-row-base setting-choice";
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    if (description) {
      const copy = document.createElement("span");
      copy.className = "setting-row__copy";
      const title = document.createElement("span");
      title.className = "setting-row__label";
      title.textContent = label;
      const detail = document.createElement("span");
      detail.className = "setting-row__description";
      detail.textContent = description;
      copy.append(title, detail);
      const check = document.createElement("span");
      check.className = "setting-choice__check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = selected ? "✓" : "";
      button.append(copy, check);
    } else {
      button.innerHTML = `<span>${label}</span><span class="setting-choice__check" aria-hidden="true">${selected ? "✓" : ""}</span>`;
    }
    button.addEventListener("click", () => {
      if (!commit()) return;
      render();
      page = returnPage;
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

  const createRemoteAccessNavigation = (): HTMLButtonElement => {
    const remoteRow = document.createElement("button");
    remoteRow.className =
      "settings-row-base setting-navigation remote-access-navigation";
    remoteRow.type = "button";
    const remoteCopy = document.createElement("span");
    const remoteTitle = document.createElement("strong");
    remoteTitle.textContent = "Remote access";
    const remoteDetail = document.createElement("small");
    remoteDetail.textContent = "Checking availability…";
    remoteCopy.append(remoteTitle, remoteDetail);
    const remoteIndicators = document.createElement("span");
    remoteIndicators.className = "remote-access-navigation__indicators";
    const remoteStatus = statePill("Checking", "pending");
    remoteIndicators.append(remoteStatus);
    remoteIndicators.insertAdjacentHTML("beforeend", chevron());
    remoteRow.append(remoteCopy, remoteIndicators);
    remoteRow.addEventListener("click", () => {
      page = "remote-access";
      render();
      resetSettingsScroll();
    });
    void options.remoteAccessApi
      .state()
      .catch(() => options.remoteAccessApi.state())
      .then((remoteState) => {
        if (!remoteRow.isConnected) return;
        if (!remoteState.available) {
          remoteDetail.textContent = "Unavailable in this build.";
          remoteStatus.textContent = "Unavailable";
          remoteStatus.className =
            "settings-state-pill settings-state-pill--muted";
          return;
        }
        remoteDetail.textContent =
          remoteState.status === "listening"
            ? "Available to paired devices on this local network."
            : remoteState.status === "starting"
              ? "Starting the LAN listener…"
              : remoteState.status === "error"
                ? "The LAN listener could not start."
                : "Available, currently Off.";
        remoteStatus.textContent =
          remoteState.status === "listening"
            ? "On"
            : remoteState.status === "starting"
              ? "Starting"
              : remoteState.status === "error"
                ? "Error"
                : "Off";
        remoteStatus.className = `settings-state-pill settings-state-pill--${
          remoteState.status === "listening"
            ? "active"
            : remoteState.status === "starting"
              ? "pending"
              : "muted"
        }`;
      })
      .catch(() => {
        if (!remoteRow.isConnected) return;
        remoteDetail.textContent = "Status could not be loaded.";
        remoteStatus.textContent = "Unknown";
        remoteStatus.className =
          "settings-state-pill settings-state-pill--muted";
      });
    return remoteRow;
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
    updatePageRefresh = null;
    networkPanel?.destroy();
    networkPanel = null;
    remoteAccessPanel?.destroy();
    remoteAccessPanel = null;
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
    if (page === "remote-access") {
      options.setScreenTitle(t("screen.settings.title"));
      options.setHeaderActions(null, null);
      const remoteHeader = document.createElement("header");
      remoteHeader.className = "screen-header screen-header--compact";
      remoteHeader.setAttribute("aria-label", "Remote access");
      remoteHeader.innerHTML =
        '<p class="screen-header__description">Pair trusted devices for player control on the local network.</p>';
      const back = document.createElement("button");
      back.className = "icon-button settings-back";
      back.type = "button";
      back.setAttribute("aria-label", t("common.back"));
      back.innerHTML = icon("back");
      back.addEventListener("click", navigateBack);
      remoteHeader.prepend(back);
      remoteAccessPanel = createRemoteAccessSettingsPanel({
        api: options.remoteAccessApi,
        showToast: options.showToast,
      });
      section.append(remoteHeader, remoteAccessPanel.element);
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
      playback: {
        title: "Playback",
        description: "Queue and playback continuation.",
      },
      "playback-continue": {
        title: "Continue playback",
        description:
          "Choose what plays after the current context and queue end.",
      },
      "playback-external-end": {
        title: "After external playback ends",
        description:
          "Choose what happens to interrupted local playback after AirPlay or Spotify Connect ends.",
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
      display: {
        title: "Display",
        description:
          "Dim or enter real standby after inactivity while playback is paused or stopped.",
      },
      "display-dim-timeout": {
        title: "Dim after",
        description:
          "Choose when the screen dims after local inactivity outside playback.",
      },
      "display-dim-level": {
        title: "Dim level",
        description: "Choose the screen brightness retained while dimmed.",
      },
      "display-standby-timeout": {
        title: "Standby after",
        description:
          "Choose when standby starts after local inactivity outside playback.",
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
            ? "Display, appliance maintenance, and local recovery."
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
      const playbackButton = document.createElement("button");
      playbackButton.className = "settings-row-base setting-navigation";
      playbackButton.type = "button";
      playbackButton.innerHTML = `<span><strong>Playback</strong><small>Queue and playback continuation.</small></span>${chevron()}`;
      playbackButton.addEventListener("click", () => {
        page = "playback";
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
      const remoteAccessButton = createRemoteAccessNavigation();
      panel.append(
        interfaceButton,
        audioButton,
        playbackButton,
        networkButton,
        remoteAccessButton,
      );
      const systemButton = document.createElement("button");
      systemButton.className = "settings-row-base setting-navigation";
      systemButton.type = "button";
      systemButton.innerHTML = `<span><strong>System</strong><small>Display, appliance maintenance, and recovery</small></span>${chevron()}`;
      systemButton.addEventListener("click", () => {
        page = "system";
        render();
        resetSettingsScroll();
      });
      panel.append(systemButton);
      return;
    }

    if (page === "playback") {
      const continuePlaybackButton = document.createElement("button");
      continuePlaybackButton.className = "settings-row-base setting-navigation";
      continuePlaybackButton.type = "button";
      continuePlaybackButton.innerHTML = `<span><strong>Continue playback</strong><small>${continuePlayback === "off" ? "Off" : "Same artist"}</small></span>${chevron()}`;
      continuePlaybackButton.addEventListener("click", () => {
        page = "playback-continue";
        render();
        resetSettingsScroll();
      });
      const externalPlaybackButton = document.createElement("button");
      externalPlaybackButton.className = "settings-row-base setting-navigation";
      externalPlaybackButton.type = "button";
      externalPlaybackButton.innerHTML = `<span><strong>After external playback ends</strong><small>${externalPlaybackEndPolicy === "keep-paused" ? "Keep paused" : "Resume interrupted playback"}</small></span>${chevron()}`;
      externalPlaybackButton.addEventListener("click", () => {
        page = "playback-external-end";
        render();
        resetSettingsScroll();
      });
      panel.append(continuePlaybackButton, externalPlaybackButton);
      return;
    }

    if (page === "playback-continue") {
      const choices: readonly [ContinuePlaybackMode, string, string][] = [
        ["off", "Off", "Stop when the current context and queue end."],
        [
          "same-artist",
          "Same artist",
          "Continue with random tracks by the same artist after the current context and queue end.",
        ],
      ];
      for (const [value, label, description] of choices)
        panel.append(
          selectionRow(
            label,
            continuePlayback === value,
            () => {
              if (!options.onContinuePlaybackModeChange(value)) return false;
              continuePlayback = value;
              return true;
            },
            "playback",
            description,
          ),
        );
      return;
    }

    if (page === "playback-external-end") {
      const choices: readonly [ExternalPlaybackEndPolicy, string, string][] = [
        [
          "keep-paused",
          "Keep local playback paused",
          "Return to Eidetic Player without automatically resuming the interrupted local track.",
        ],
        [
          "resume-interrupted",
          "Resume interrupted playback",
          "Resume local playback only when it was playing before the external source started.",
        ],
      ];
      for (const [value, label, description] of choices)
        panel.append(
          selectionRow(
            label,
            externalPlaybackEndPolicy === value,
            () => {
              if (!options.onExternalPlaybackEndPolicyChange(value))
                return false;
              externalPlaybackEndPolicy = value;
              return true;
            },
            "playback",
            description,
          ),
        );
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
      soundProcessing.dataset.audioSetting = "sound-processing";
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
      parametricEq.dataset.audioSetting = "parametric-eq";
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
            ? "Off. Processing remains available; positive EQ gain can clip."
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
          "Projected gain is positive. Processing remains available, but clipping is possible.";
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
      panel.append(
        navigationRow(
          "Display",
          displaySummary(dimTimeout, standbyTimeout, displayState),
          "display",
        ),
      );
      if (!options.systemCapabilities.maintenanceMode) return;
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

    if (page === "display") {
      panel.append(
        navigationRow(
          "Dim screen after",
          formatDisplayTimeout(dimTimeout),
          "display-dim-timeout",
        ),
        navigationRow(
          "Dim level",
          `${String(dimLevel)}% brightness`,
          "display-dim-level",
        ),
        navigationRow(
          "Turn display off after",
          formatDisplayTimeout(standbyTimeout),
          "display-standby-timeout",
        ),
      );
      const capability = document.createElement("div");
      capability.className = "settings-row-base setting-row";
      const capabilityCopy = document.createElement("span");
      capabilityCopy.className = "setting-row__copy";
      const capabilityTitle = document.createElement("strong");
      capabilityTitle.textContent = "Display capability";
      const capabilityDetail = document.createElement("small");
      capabilityDetail.textContent = displayCapabilitySummary(displayState);
      capabilityCopy.append(capabilityTitle, capabilityDetail);
      capability.append(
        capabilityCopy,
        statePill(
          displayState.standbyAvailable ? "Standby ready" : "Dim only",
          displayState.standbyAvailable ? "active" : "muted",
        ),
      );
      panel.append(capability);
      if (displayState.standbyInhibitedReason === "hdmi-audio-active") {
        const inhibited = document.createElement("p");
        inhibited.className = "settings-inline-note";
        inhibited.textContent =
          "Display standby suspended — HDMI is currently used for audio. A new full countdown starts when HDMI audio is released.";
        panel.append(inhibited);
      }
      const actions = document.createElement("div");
      actions.className = "settings-page-actions";
      const testDim = document.createElement("button");
      testDim.className = "settings-page-action";
      testDim.type = "button";
      testDim.disabled = displayBusy || displayState.state === "inhibited";
      testDim.innerHTML =
        "<span><strong>Test dim</strong><small>Restore automatically after 10 seconds or on input.</small></span>";
      testDim.addEventListener("click", () => {
        displayBusy = true;
        render();
        void options
          .testDisplayDim()
          .catch((error: unknown) => {
            options.showToast(
              error instanceof Error ? error.message : "Dim test failed.",
              "error",
            );
          })
          .finally(() => {
            displayBusy = false;
            render();
          });
      });
      const testStandby = document.createElement("button");
      testStandby.className =
        "settings-page-action settings-page-action--primary";
      testStandby.type = "button";
      testStandby.disabled =
        displayBusy ||
        displayState.state === "inhibited" ||
        !displayState.standbyAvailable ||
        displayState.standbyInhibitedReason === "hdmi-audio-active";
      testStandby.innerHTML =
        "<span><strong>Test standby</strong><small>Restore automatically after 15 seconds or on input.</small></span>";
      testStandby.addEventListener("click", () => {
        section.append(confirmationDialog.backdrop, confirmationDialog.element);
        confirmationDialog.open({
          title: "Test display standby?",
          description:
            "The display will turn off temporarily. Touch the screen, move the mouse, or press a key to wake it.",
          confirmLabel: "Start test",
          returnFocus: testStandby,
          onConfirm: () => {
            displayBusy = true;
            render();
            void options
              .testDisplayStandby()
              .catch((error: unknown) => {
                options.showToast(
                  error instanceof Error
                    ? error.message
                    : "Standby test failed.",
                  "error",
                );
              })
              .finally(() => {
                displayBusy = false;
                render();
              });
          },
        });
      });
      actions.append(testDim, testStandby);
      section.append(actions);
      return;
    }

    if (page === "display-dim-timeout") {
      for (const value of screenDimTimeoutChoices) {
        const compatible = displayTimeoutsAreCompatible(value, standbyTimeout);
        const row = selectionRow(
          formatDisplayTimeout(value),
          dimTimeout === value,
          () => {
            if (!compatible) return false;
            if (
              !options.setDisplayPreferences({ screenDimTimeoutSeconds: value })
            )
              return false;
            dimTimeout = value;
            return true;
          },
          "display",
        );
        row.disabled = !compatible;
        if (!compatible) row.title = "Dim must occur before display standby.";
        panel.append(row);
      }
      return;
    }

    if (page === "display-dim-level") {
      for (const value of screenDimLevelChoices)
        panel.append(
          selectionRow(
            `${String(value)}% brightness`,
            dimLevel === value,
            () => {
              if (
                !options.setDisplayPreferences({ screenDimLevelPercent: value })
              )
                return false;
              dimLevel = value;
              return true;
            },
            "display",
          ),
        );
      return;
    }

    if (page === "display-standby-timeout") {
      for (const value of screenStandbyTimeoutChoices) {
        const compatible = displayTimeoutsAreCompatible(dimTimeout, value);
        const available = value === 0 || displayState.standbyAvailable;
        const row = selectionRow(
          formatDisplayTimeout(value),
          standbyTimeout === value,
          () => {
            if (!compatible || !available) return false;
            if (
              !options.setDisplayPreferences({
                screenStandbyTimeoutSeconds: value,
              })
            )
              return false;
            standbyTimeout = value;
            return true;
          },
          "display",
        );
        row.disabled = !compatible || !available;
        if (!compatible) row.title = "Standby must be later than dim.";
        else if (!available)
          row.title = "Real display standby is unavailable on this system.";
        panel.append(row);
      }
      if (
        screenStandbyTimeoutChoices.some(
          (value) =>
            value !== 0 && !displayTimeoutsAreCompatible(dimTimeout, value),
        )
      ) {
        const note = document.createElement("p");
        note.className = "settings-inline-note";
        note.textContent = "Standby must be later than dim.";
        panel.append(note);
      }
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
            updateBusyAction = "branch";
            render();
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
                updateBusyAction = null;
                render();
              });
          });
          panel.append(row);
        }
      }
      const refresh = document.createElement("button");
      refresh.className = "settings-page-action";
      refresh.type = "button";
      refresh.disabled = updateBusy || updateActive;
      refresh.setAttribute("aria-busy", String(updateBusyAction === "refresh"));
      refresh.innerHTML =
        updateBusyAction === "refresh"
          ? "<span><strong>Refreshing branches...</strong><small>Loading the remote branch list.</small></span>"
          : "<span><strong>Refresh branches</strong><small>Load remote branches on demand.</small></span>";
      refresh.addEventListener("click", () => {
        updateBusy = true;
        updateBusyAction = "refresh";
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
            updateBusyAction = null;
            render();
          });
      });
      const refreshActions = document.createElement("div");
      refreshActions.className =
        "settings-page-actions settings-page-actions--single";
      refreshActions.append(refresh);
      section.append(refreshActions);
      return;
    }

    if (page === "software-update") {
      const branch = navigationRow(
        "Update branch",
        updateState.selectedBranch,
        "update-branch",
      );
      const current = document.createElement("div");
      current.className = "settings-row-base setting-row";
      const currentCopy = document.createElement("span");
      currentCopy.className = "setting-row__copy";
      const currentTitle = document.createElement("strong");
      currentTitle.textContent = "Current build";
      const currentDetail = document.createElement("small");
      currentCopy.append(currentTitle, currentDetail);
      current.append(currentCopy);
      const target = document.createElement("div");
      target.className = "settings-row-base setting-row";
      const targetCopy = document.createElement("span");
      targetCopy.className = "setting-row__copy";
      const targetTitle = document.createElement("strong");
      targetTitle.textContent = "Target build";
      const targetDetail = document.createElement("small");
      targetCopy.append(targetTitle, targetDetail);
      target.append(targetCopy);
      const check = document.createElement("button");
      check.className = "settings-page-action";
      check.type = "button";
      check.setAttribute("aria-busy", String(updateBusyAction === "check"));
      check.innerHTML =
        updateBusyAction === "check"
          ? "<span><strong>Checking for updates...</strong><small>Resolving the selected branch.</small></span>"
          : "<span><strong>Check for updates</strong><small>Resolve the selected branch to an exact build.</small></span>";
      check.addEventListener("click", () => {
        updateBusy = true;
        updateBusyAction = "check";
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
            updateBusyAction = null;
            render();
          });
      });
      const start = document.createElement("button");
      start.className = "settings-page-action settings-page-action--primary";
      start.type = "button";
      start.setAttribute("aria-busy", String(updateBusyAction === "start"));
      start.innerHTML =
        updateBusyAction === "start"
          ? "<span><strong>Starting update...</strong><small>Authorizing and scheduling the updater.</small></span>"
          : "<span><strong>Start update</strong><small>The player remains available while the update is prepared.</small></span>";
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
            updateBusyAction = "start";
            render();
            void options.updateApi
              .start(plan.id, plan.targetCommitSha)
              .then((snapshot) => {
                updateState = snapshot;
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
                updateBusyAction = null;
                render();
              });
          },
        });
      });
      const status = document.createElement("div");
      status.className = "settings-row-base setting-row update-status";
      status.setAttribute("role", "status");
      const statusCopy = document.createElement("span");
      statusCopy.className = "setting-row__copy";
      const statusTitle = document.createElement("strong");
      const statusDetail = document.createElement("small");
      statusCopy.append(statusTitle, statusDetail);
      const logHeading = document.createElement("h2");
      logHeading.textContent = "Update log";
      const logRegion = document.createElement("div");
      logRegion.className = "update-log";
      logRegion.setAttribute("role", "log");
      logRegion.setAttribute("aria-live", "polite");
      logRegion.setAttribute("aria-label", "Software update log");
      const logList = document.createElement("ol");
      logList.className = "update-log__list";
      logRegion.append(logList);
      panel.append(branch, current, target, status, logHeading, logRegion);
      const updateActions = document.createElement("div");
      updateActions.className = "settings-page-actions";
      updateActions.append(check, start);
      section.append(updateActions);
      let renderedLogKey = "";
      updatePageRefresh = () => {
        const active = [
          "queued",
          "running",
          "activating",
          "restarting",
          "verifying",
        ].includes(updateState.job.state);
        branch.classList.toggle("setting-row--disabled", active);
        branch.disabled = active;
        currentDetail.textContent = [
          updateState.currentShortCommitSha,
          formatUpdateBuildDate(updateState.currentBuiltAt),
        ]
          .filter(Boolean)
          .join(" - ");
        targetDetail.textContent = [
          updateState.plan?.targetShortCommitSha ?? "Check required",
          formatUpdateBuildDate(updateState.plan?.targetCommitAt),
        ]
          .filter(Boolean)
          .join(" - ");
        check.disabled = updateBusy || active;
        start.disabled =
          updateBusy || active || updateState.plan?.updateAvailable !== true;
        statusTitle.textContent =
          updateState.job.state === "idle"
            ? "Updater ready"
            : active
              ? "Update in progress"
              : updateState.job.state === "succeeded"
                ? "Update completed"
                : "Last update did not complete";
        const phase = updateState.job.phase;
        statusDetail.textContent = phase
          ? `${String(phase.index)}/${String(phase.total)} - ${phase.label}${phase.substep ? ` - ${phase.substep}` : ""}`
          : (updateState.job.result ??
            (updateState.job.state === "queued"
              ? "Waiting for the updater service."
              : updateState.job.state));
        status.replaceChildren(
          statusCopy,
          statePill(
            updateJobLabel(updateState.job.state),
            active
              ? "pending"
              : updateState.job.state === "succeeded"
                ? "active"
                : "muted",
          ),
        );
        const nextLogKey = `${updateState.job.jobId ?? "idle"}:${String(updateState.job.revision)}:${String(updateState.job.log.length)}`;
        if (nextLogKey === renderedLogKey) return;
        renderedLogKey = nextLogKey;
        const previousScrollTop = logRegion.scrollTop;
        const stickToEnd =
          logRegion.scrollHeight -
            logRegion.scrollTop -
            logRegion.clientHeight <
          24;
        const rows = updateState.job.log.map((entry) => {
          const row = document.createElement("li");
          row.className = `update-log__entry update-log__entry--${entry.level}`;
          const timestamp = document.createElement("time");
          timestamp.dateTime = entry.at;
          timestamp.textContent = formatUpdateLogTime(entry.at);
          const message = document.createElement("span");
          message.textContent = entry.message;
          row.append(timestamp, message);
          return row;
        });
        if (rows.length === 0) {
          const empty = document.createElement("li");
          empty.className = "update-log__empty";
          empty.textContent = "No update activity recorded.";
          rows.push(empty);
        }
        logList.replaceChildren(...rows);
        queueMicrotask(() => {
          logRegion.scrollTop = stickToEnd
            ? logRegion.scrollHeight
            : previousScrollTop;
        });
      };
      updatePageRefresh();
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
      updateState = snapshot;
      if (page === "software-update" && updatePageRefresh) {
        updatePageRefresh();
      } else if (
        page === "root" ||
        page === "system" ||
        page === "update-branch"
      ) {
        render();
      }
    },
    updateDisplayState(snapshot) {
      if (snapshot.revision < displayState.revision) return;
      const presentationChanged = displaySettingsPresentationChanged(
        displayState,
        snapshot,
      );
      displayState = snapshot;
      if (
        presentationChanged &&
        (page === "display" ||
          page === "display-standby-timeout" ||
          page === "system")
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
      remoteAccessPanel?.destroy();
      parametricEqEditor?.destroy();
      confirmationDialog.destroy();
      updatePageRefresh = null;
      options.setHeaderActions(null, null);
      section.replaceChildren();
    },
  };
}
