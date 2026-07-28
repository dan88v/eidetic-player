import { icon } from "./icons";
import { t } from "../i18n";
import type { NetworkSnapshot } from "../../../../packages/shared/src/network";
import type { SmbSnapshot } from "../../../../packages/shared/src/smb";
import type { AudioOutputState } from "../../../../packages/shared/src/audio-output";
import type { SoftwareUpdateSnapshot } from "../../../../packages/shared/src/update";

export interface TopBar {
  readonly element: HTMLElement;
  readonly menuButton: HTMLButtonElement;
  setTitle(title: string): void;
  setDetailActions(
    back: (() => void) | null,
    more: ((trigger: HTMLButtonElement) => void) | null,
  ): void;
  updateNetwork(snapshot: NetworkSnapshot): void;
  updateAudioOutput(snapshot: AudioOutputState): void;
  updateSmb(snapshot: SmbSnapshot): void;
  updateSoftwareUpdate(snapshot: SoftwareUpdateSnapshot): void;
  destroy(): void;
}

interface StatusCopy {
  readonly summary: string;
  readonly detail: string;
}

type StatusKind = "wifi" | "audio" | "smb" | "update";

function formatTime(): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function wifiStatusCopy(snapshot: NetworkSnapshot): StatusCopy {
  const network = snapshot.wifi.currentNetwork;
  const adapter = snapshot.wifiAdapters.find(
    (candidate) => candidate.connected,
  );
  if (!network || !adapter)
    return {
      summary: "Wi-Fi · Disconnected",
      detail:
        snapshot.operationState === "connecting"
          ? "Connecting…"
          : "Not connected to a network",
    };
  return {
    summary: `Wi-Fi · ${network.ssid}`,
    detail: `${adapter.ipv4Address ?? "No IPv4 address"} · Signal ${String(network.signalPercent)}%`,
  };
}

export function audioOutputStatusCopy(snapshot: AudioOutputState): StatusCopy {
  const output =
    snapshot.canonicalOutputs.find((candidate) =>
      candidate.routes.some((route) => route.id === snapshot.effectiveDeviceId),
    ) ??
    snapshot.canonicalOutputs.find(
      (candidate) => candidate.id === snapshot.selectedPhysicalOutputId,
    );
  const route = output?.routes.find(
    (candidate) => candidate.id === snapshot.effectiveDeviceId,
  );
  const description =
    output?.description ?? snapshot.preferredDevice.description;
  let detail = "System-selected output";
  if (!snapshot.mpvAvailable) detail = "Audio engine unavailable";
  else if (snapshot.switching) detail = "Switching output…";
  else if (route && route.kind !== "system") {
    const interfaceName =
      route.kind === "other"
        ? (route.id.split("/", 1)[0] ?? "audio").toUpperCase()
        : route.kind.toUpperCase();
    detail = `${interfaceName} · ${route.description}`;
  } else if (snapshot.diagnostics.currentAo)
    detail = `Interface · ${snapshot.diagnostics.currentAo.toUpperCase()}`;
  return {
    summary: `Audio · ${description}`,
    detail,
  };
}

export function createTopBar(onMenuToggle: () => void): TopBar {
  const element = document.createElement("header");
  element.className = "top-bar";
  element.innerHTML = `
    <button class="top-bar__menu icon-button" type="button" aria-label="${t("nav.openMenu")}" aria-expanded="false" aria-controls="side-menu">${icon("menu")}</button>
    <h1 class="top-bar__title"></h1>
    <div class="top-bar__info">
      <span class="top-bar__system-icons">
        <span class="top-bar__system-icon" data-network-indicator="wired" aria-hidden="true" hidden>${icon("ethernet")}</span>
        <button class="top-bar__system-icon top-bar__system-button" data-status-trigger="wifi" type="button" aria-label="Wi-Fi status" aria-expanded="false" aria-controls="top-bar-status-popover">${icon("wifi")}</button>
        <button class="top-bar__system-icon top-bar__system-button top-bar__system-icon--active" data-status-trigger="audio" type="button" aria-label="Audio output status" aria-expanded="false" aria-controls="top-bar-status-popover">${icon("usb")}</button>
        <button class="top-bar__system-icon top-bar__system-button top-bar__smb" data-status-trigger="smb" type="button" aria-label="SMB connection status" aria-expanded="false" aria-controls="top-bar-status-popover" hidden>${icon("sources")}</button>
        <button class="top-bar__system-icon top-bar__system-button top-bar__update" data-status-trigger="update" data-visible="false" type="button" aria-label="Software update status" aria-expanded="false" aria-controls="top-bar-status-popover" aria-hidden="true" tabindex="-1"><span role="status">${icon("refresh")}</span></button>
      </span>
      <div class="top-bar__status-popover" id="top-bar-status-popover" role="status" hidden><strong></strong><span></span></div>
      <time class="top-bar__clock" aria-label="${t("topBar.clockLabel")}"></time>
    </div>`;
  const menuButton = element.querySelector<HTMLButtonElement>(".top-bar__menu");
  const title = element.querySelector<HTMLHeadingElement>(".top-bar__title");
  const clock = element.querySelector<HTMLTimeElement>(".top-bar__clock");
  const info = element.querySelector<HTMLElement>(".top-bar__info");
  const wiredIndicator = element.querySelector<HTMLElement>(
    '[data-network-indicator="wired"]',
  );
  const wifiButton = element.querySelector<HTMLButtonElement>(
    '[data-status-trigger="wifi"]',
  );
  const audioButton = element.querySelector<HTMLButtonElement>(
    '[data-status-trigger="audio"]',
  );
  const smbButton = element.querySelector<HTMLButtonElement>(".top-bar__smb");
  const updateButton =
    element.querySelector<HTMLButtonElement>(".top-bar__update");
  const statusPopover = element.querySelector<HTMLElement>(
    ".top-bar__status-popover",
  );
  const statusSummary = statusPopover?.querySelector<HTMLElement>("strong");
  const statusDetail = statusPopover?.querySelector<HTMLElement>("span");
  if (
    !menuButton ||
    !title ||
    !clock ||
    !info ||
    !wiredIndicator ||
    !wifiButton ||
    !audioButton ||
    !smbButton ||
    !updateButton ||
    !statusPopover ||
    !statusSummary ||
    !statusDetail
  )
    throw new Error("Top bar is incomplete");
  const moreButton = document.createElement("button");
  moreButton.className = "top-bar__more icon-button";
  moreButton.type = "button";
  moreButton.setAttribute("aria-label", "Playlist actions");
  moreButton.innerHTML = icon("more");
  moreButton.hidden = true;
  info.prepend(moreButton);
  let backAction: (() => void) | null = null;
  let moreAction: ((trigger: HTMLButtonElement) => void) | null = null;
  const updateClock = (): void => {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = formatTime();
  };
  updateClock();
  const clockTimer = window.setInterval(updateClock, 60_000);
  menuButton.addEventListener("click", () => {
    if (backAction) backAction();
    else onMenuToggle();
  });
  moreButton.addEventListener("click", () => moreAction?.(moreButton));

  let activeStatus: StatusKind | null = null;
  const statusCopy: Record<StatusKind, StatusCopy> = {
    wifi: {
      summary: "Wi-Fi · Disconnected",
      detail: "Not connected to a network",
    },
    audio: {
      summary: "Audio · System default",
      detail: "System-selected output",
    },
    smb: { summary: "SMB", detail: "" },
    update: { summary: "Software update", detail: "" },
  };
  let updateSnapshot: SoftwareUpdateSnapshot | null = null;
  let updateElapsedTimer: number | null = null;
  let updatePointerFocus = false;
  const refreshUpdateCopy = (): void => {
    if (!updateSnapshot) return;
    const job = updateSnapshot.job;
    const active = [
      "queued",
      "running",
      "activating",
      "restarting",
      "verifying",
    ].includes(job.state);
    const startedAt = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;
    const elapsedMs =
      active && Number.isFinite(startedAt)
        ? Math.max(job.elapsedMs, Date.now() - startedAt)
        : job.elapsedMs;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    statusCopy.update = {
      summary: `Update · ${job.branch} · ${job.targetCommitSha?.slice(0, 7) ?? "checking"}`,
      detail: `${job.phase?.label ?? job.state}${job.phase?.substep ? ` · ${job.phase.substep}` : ""} · ${String(Math.floor(elapsedSeconds / 60))}:${String(elapsedSeconds % 60).padStart(2, "0")}${job.warningCount > 0 ? ` · ${String(job.warningCount)} warning` : ""}`,
    };
  };
  const renderStatusPopover = (): void => {
    if (!activeStatus) return;
    if (activeStatus === "update") refreshUpdateCopy();
    const copy = statusCopy[activeStatus];
    statusSummary.textContent = copy.summary;
    statusDetail.textContent = copy.detail;
    statusDetail.hidden = copy.detail === "";
  };
  const closeStatusPopover = (): void => {
    if (updateElapsedTimer !== null) {
      window.clearInterval(updateElapsedTimer);
      updateElapsedTimer = null;
    }
    statusPopover.hidden = true;
    activeStatus = null;
    for (const trigger of [wifiButton, audioButton, smbButton, updateButton])
      trigger.setAttribute("aria-expanded", "false");
  };
  const openStatusPopover = (
    kind: StatusKind,
    trigger: HTMLButtonElement,
  ): void => {
    activeStatus = kind;
    renderStatusPopover();
    statusPopover.hidden = false;
    if (kind === "update" && updateElapsedTimer === null)
      updateElapsedTimer = window.setInterval(() => {
        if (activeStatus === "update") renderStatusPopover();
      }, 1_000);
    for (const candidate of [wifiButton, audioButton, smbButton, updateButton])
      candidate.setAttribute("aria-expanded", String(candidate === trigger));
  };
  const toggleStatusPopover = (
    kind: StatusKind,
    trigger: HTMLButtonElement,
  ): void => {
    if (activeStatus === kind && !statusPopover.hidden) {
      closeStatusPopover();
      return;
    }
    openStatusPopover(kind, trigger);
  };
  for (const trigger of [wifiButton, audioButton, smbButton, updateButton])
    trigger.addEventListener("click", () => {
      toggleStatusPopover(trigger.dataset.statusTrigger as StatusKind, trigger);
    });
  updateButton.addEventListener("pointerenter", (event) => {
    if (
      event.pointerType === "mouse" &&
      updateButton.dataset.visible === "true"
    )
      openStatusPopover("update", updateButton);
  });
  updateButton.addEventListener("pointerdown", () => {
    updatePointerFocus = true;
  });
  updateButton.addEventListener("click", () => {
    updatePointerFocus = false;
  });
  updateButton.addEventListener("pointerleave", (event) => {
    if (
      event.pointerType === "mouse" &&
      event.relatedTarget !== statusPopover &&
      document.activeElement !== updateButton
    )
      closeStatusPopover();
  });
  updateButton.addEventListener("focus", () => {
    if (!updatePointerFocus && updateButton.dataset.visible === "true")
      openStatusPopover("update", updateButton);
  });
  updateButton.addEventListener("blur", (event) => {
    if (event.relatedTarget !== statusPopover) closeStatusPopover();
  });
  statusPopover.addEventListener("pointerleave", (event) => {
    if (
      activeStatus === "update" &&
      event.pointerType === "mouse" &&
      event.relatedTarget !== updateButton
    )
      closeStatusPopover();
  });
  const closeStatusOutside = (event: PointerEvent): void => {
    if (
      !statusPopover.hidden &&
      !statusPopover.contains(event.target as Node) &&
      ![wifiButton, audioButton, smbButton, updateButton].some((trigger) =>
        trigger.contains(event.target as Node),
      )
    )
      closeStatusPopover();
  };
  const closeStatusEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !statusPopover.hidden) {
      event.preventDefault();
      const trigger =
        activeStatus === "wifi"
          ? wifiButton
          : activeStatus === "audio"
            ? audioButton
            : activeStatus === "smb"
              ? smbButton
              : updateButton;
      closeStatusPopover();
      trigger.focus();
    }
  };
  document.addEventListener("pointerdown", closeStatusOutside);
  document.addEventListener("keydown", closeStatusEscape);

  return {
    element,
    menuButton,
    setTitle(screenTitle) {
      title.textContent = screenTitle;
      title.title = screenTitle;
    },
    setDetailActions(back, more) {
      backAction = back;
      moreAction = more;
      menuButton.innerHTML = icon(back ? "back" : "menu");
      menuButton.setAttribute("aria-label", back ? "Back" : t("nav.openMenu"));
      moreButton.hidden = more === null;
    },
    updateNetwork(snapshot) {
      const wiredConnected = snapshot.wiredAdapters.some(
        (adapter) => adapter.connected,
      );
      wiredIndicator.hidden = !wiredConnected;
      wiredIndicator.classList.toggle(
        "top-bar__system-icon--active",
        wiredConnected,
      );
      wifiButton.classList.toggle(
        "top-bar__system-icon--active",
        snapshot.wifiAdapters.some((adapter) => adapter.connected),
      );
      wifiButton.classList.toggle(
        "top-bar__system-icon--connecting",
        snapshot.operationState === "connecting",
      );
      statusCopy.wifi = wifiStatusCopy(snapshot);
      if (activeStatus === "wifi") renderStatusPopover();
    },
    updateAudioOutput(snapshot) {
      statusCopy.audio = audioOutputStatusCopy(snapshot);
      if (activeStatus === "audio") renderStatusPopover();
    },
    updateSmb(snapshot) {
      smbButton.hidden = snapshot.configuredCount === 0;
      if (smbButton.hidden) {
        if (activeStatus === "smb") closeStatusPopover();
        return;
      }
      const hasError = snapshot.unavailableCount > 0;
      const allConnected =
        snapshot.configuredCount > 0 &&
        snapshot.connectedCount === snapshot.configuredCount;
      smbButton.dataset.state = hasError
        ? "error"
        : allConnected
          ? "connected"
          : "connecting";
      const unavailable = snapshot.connections.filter(
        (connection) =>
          !connection.readable && connection.state !== "connecting",
      );
      const authentication = unavailable.find(
        (connection) => connection.state === "authentication-required",
      );
      if (authentication) {
        statusCopy.smb = {
          summary: "SMB · Authentication required",
          detail: authentication.displayName,
        };
      } else if (snapshot.unavailableCount > 0) {
        statusCopy.smb = {
          summary: `SMB · ${String(snapshot.unavailableCount)} of ${String(snapshot.configuredCount)} unavailable`,
          detail:
            snapshot.unavailableCount === 1
              ? `${unavailable[0]?.displayName ?? "Network share"} is offline`
              : "",
        };
      } else if (snapshot.connectingCount > 0) {
        statusCopy.smb = { summary: "SMB · Connecting…", detail: "" };
      } else {
        statusCopy.smb = {
          summary: `SMB · ${String(snapshot.connectedCount)} connected`,
          detail: "",
        };
      }
      if (activeStatus === "smb") renderStatusPopover();
    },
    updateSoftwareUpdate(snapshot) {
      updateSnapshot = snapshot;
      const active = [
        "queued",
        "running",
        "activating",
        "restarting",
        "verifying",
      ].includes(snapshot.job.state);
      updateButton.dataset.visible = String(active);
      updateButton.setAttribute("aria-hidden", String(!active));
      updateButton.tabIndex = active ? 0 : -1;
      updateButton.classList.toggle("top-bar__update--active", active);
      updateButton.setAttribute(
        "aria-label",
        active
          ? `Software update: ${snapshot.job.phase?.label ?? snapshot.job.state}`
          : "Software update status",
      );
      if (!active && activeStatus === "update") closeStatusPopover();
      refreshUpdateCopy();
      if (activeStatus === "update") renderStatusPopover();
    },
    destroy() {
      window.clearInterval(clockTimer);
      if (updateElapsedTimer !== null) window.clearInterval(updateElapsedTimer);
      document.removeEventListener("pointerdown", closeStatusOutside);
      document.removeEventListener("keydown", closeStatusEscape);
    },
  };
}
