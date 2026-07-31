import type {
  RemoteAccessDevice,
  RemoteAccessState,
} from "../../../../packages/shared/src/remote-access";
import type { RemoteAccessApiClient } from "../api/remote-access-api-client";
import { createConfirmationDialog } from "../components/confirmation-dialog";
import { createSegmentedControl } from "../components/segmented-control";
import { completedPairingDevice } from "./remote-access-pairing-completion";

export interface RemoteAccessSettingsPanel {
  readonly element: HTMLElement;
  refresh(): Promise<void>;
  destroy(): void;
}

function statusLabel(state: RemoteAccessState): string {
  if (state.status === "listening") return "Listening";
  if (state.status === "starting") return "Starting";
  if (state.status === "disabled") return "Off";
  if (state.status === "unavailable") return "Unavailable";
  return state.reasonCode === "port-unavailable"
    ? "Port 8080 unavailable"
    : "Error";
}

function deviceRow(
  device: RemoteAccessDevice,
  revoke: (device: RemoteAccessDevice, trigger: HTMLButtonElement) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row-base setting-row remote-access-device";
  const copy = document.createElement("span");
  copy.className = "setting-row__copy";
  const name = document.createElement("strong");
  name.textContent = device.name;
  const detail = document.createElement("small");
  detail.textContent = `Last seen ${new Date(device.lastSeenAt).toLocaleDateString()}`;
  copy.append(name, detail);
  const action = document.createElement("button");
  action.type = "button";
  action.className =
    "button button--secondary remote-access-action remote-access-revoke";
  action.textContent = "Revoke";
  action.addEventListener("click", () => {
    revoke(device, action);
  });
  row.append(copy, action);
  return row;
}

export function createRemoteAccessSettingsPanel(options: {
  readonly api: RemoteAccessApiClient;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
}): RemoteAccessSettingsPanel {
  const element = document.createElement("div");
  element.className = "remote-access-settings";
  const confirmation = createConfirmationDialog();
  let state: RemoteAccessState | null = null;
  let destroyed = false;
  let busy = false;
  let countdown: number | null = null;
  let pairingBaselineDeviceIds: Set<string> | null = null;

  const stopCountdown = (): void => {
    if (countdown !== null) window.clearInterval(countdown);
    countdown = null;
  };

  const run = (
    operation: () => Promise<RemoteAccessState>,
    success?: string,
  ): void => {
    if (busy) return;
    busy = true;
    render();
    void operation()
      .then((next) => {
        if (destroyed) return;
        state = next;
        if (success) options.showToast(success, "success");
      })
      .catch((error: unknown) => {
        if (!destroyed)
          options.showToast(
            error instanceof Error
              ? error.message
              : "Remote access action failed.",
            "error",
          );
      })
      .finally(() => {
        if (destroyed) return;
        busy = false;
        render();
      });
  };

  const confirmRevoke = (
    device: RemoteAccessDevice,
    trigger: HTMLButtonElement,
  ): void => {
    element.append(confirmation.backdrop, confirmation.element);
    confirmation.open({
      title: `Revoke ${device.name}?`,
      description:
        "This device will be disconnected immediately and must pair again.",
      confirmLabel: "Revoke",
      returnFocus: trigger,
      onConfirm: () => {
        run(() => options.api.revokeDevice(device.id), "Device revoked.");
      },
    });
  };

  const render = (): void => {
    stopCountdown();
    element.replaceChildren();
    if (!state) {
      const loading = document.createElement("p");
      loading.className = "remote-access-loading";
      loading.textContent = "Loading Remote access…";
      element.append(loading);
      return;
    }
    const panel = document.createElement("section");
    panel.className = "settings-panel remote-access-panel";
    if (!state.available) {
      const unavailableRow = document.createElement("div");
      unavailableRow.className =
        "settings-row-base setting-row remote-access-unavailable";
      const unavailableCopy = document.createElement("span");
      unavailableCopy.className = "setting-row__copy";
      const unavailableTitle = document.createElement("strong");
      unavailableTitle.textContent = "Remote access unavailable";
      const unavailableDetail = document.createElement("small");
      unavailableDetail.textContent =
        "This build cannot start the LAN listener. On Windows, restart development with EIDETIC_REMOTE_ACCESS_FIXTURE=1 to test it.";
      unavailableCopy.append(unavailableTitle, unavailableDetail);
      const unavailablePill = document.createElement("span");
      unavailablePill.className =
        "settings-state-pill settings-state-pill--muted remote-access-status";
      unavailablePill.textContent = "Unavailable";
      unavailableRow.append(unavailableCopy, unavailablePill);
      panel.append(unavailableRow);

      const unavailableNote = document.createElement("p");
      unavailableNote.className = "remote-access-unavailable-note";
      unavailableNote.textContent =
        "Remote access is Off. No LAN listener is running and no phone can connect.";
      const pageActions = document.createElement("div");
      pageActions.className =
        "settings-page-actions settings-page-actions--single";
      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.className = "settings-page-action";
      refreshButton.textContent = "Refresh";
      refreshButton.disabled = busy;
      refreshButton.addEventListener("click", () => {
        void refresh();
      });
      pageActions.append(refreshButton);
      element.append(panel, unavailableNote, pageActions);
      return;
    }
    const enabledRow = document.createElement("div");
    enabledRow.className = "settings-row-base setting-row";
    const enabledCopy = document.createElement("span");
    enabledCopy.className = "setting-row__copy";
    enabledCopy.innerHTML =
      "<strong>Remote access</strong><small>Allow paired devices on this local network.</small>";
    const enabled = createSegmentedControl<"on" | "off">({
      label: "Remote access",
      value: state.enabled ? "on" : "off",
      items: [
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ],
      onChange(value) {
        run(
          value === "on"
            ? () => options.api.enable()
            : () => options.api.disable(),
          value === "on" ? "Remote access enabled." : "Remote access disabled.",
        );
      },
    });
    const enabledControlDisabled = busy || state.readOnly;
    enabled.element
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((control) => {
        control.disabled = enabledControlDisabled;
      });
    enabledRow.append(enabledCopy, enabled.element);
    const statusRow = document.createElement("div");
    statusRow.className = "settings-row-base setting-row";
    const statusCopy = document.createElement("span");
    statusCopy.className = "setting-row__copy";
    statusCopy.innerHTML = "<strong>Status</strong><small></small>";
    const statusDetail = statusCopy.querySelector("small");
    if (statusDetail) statusDetail.textContent = statusLabel(state);
    const pill = document.createElement("span");
    pill.className = `settings-state-pill remote-access-status${
      state.status === "listening"
        ? " settings-state-pill--active"
        : state.status === "starting"
          ? " settings-state-pill--pending"
          : " settings-state-pill--muted"
    }`;
    pill.textContent = statusLabel(state);
    statusRow.append(statusCopy, pill);
    panel.append(enabledRow, statusRow);

    for (const address of state.addresses) {
      const addressRow = document.createElement("div");
      addressRow.className =
        "settings-row-base setting-row remote-access-address";
      const addressCopy = document.createElement("span");
      addressCopy.className = "setting-row__copy";
      const title = document.createElement("strong");
      title.textContent = "Address";
      const detail = document.createElement("small");
      detail.textContent = address;
      addressCopy.append(title, detail);
      addressRow.append(addressCopy);
      panel.append(addressRow);
    }

    if (state.status === "error" && state.enabled) {
      const retryRow = document.createElement("div");
      retryRow.className = "settings-row-base setting-row";
      const copy = document.createElement("span");
      copy.className = "setting-row__copy";
      copy.innerHTML =
        "<strong>Listener error</strong><small>Retry after freeing port 8080.</small>";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "button button--secondary remote-access-action";
      retry.textContent = "Retry";
      retry.disabled = busy;
      retry.addEventListener("click", () => {
        run(() => options.api.retry());
      });
      retryRow.append(copy, retry);
      panel.append(retryRow);
    }

    const primaryActions = document.createElement("div");
    primaryActions.className =
      "settings-page-actions remote-access-primary-actions";
    const pair = document.createElement("button");
    pair.type = "button";
    pair.className =
      "settings-page-action settings-page-action--primary remote-access-primary-action";
    pair.textContent = state.pairing ? "New pairing code" : "Pair new device";
    pair.disabled =
      busy ||
      state.status !== "listening" ||
      state.devices.length >= 8 ||
      state.readOnly;
    pair.addEventListener("click", () => {
      run(() => options.api.createPairingCode());
    });
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className =
      "settings-page-action remote-access-primary-action";
    refreshButton.textContent = "Refresh";
    refreshButton.disabled = busy;
    refreshButton.addEventListener("click", () => {
      void refresh();
    });
    primaryActions.append(pair, refreshButton);

    let pairingPanel: HTMLElement | null = null;
    if (state.pairing) {
      pairingPanel = document.createElement("section");
      pairingPanel.className = "settings-panel remote-access-pairing-panel";
      const pairing = document.createElement("div");
      pairing.className = "remote-access-pairing";
      const label = document.createElement("span");
      label.textContent = "Pairing code";
      const code = document.createElement("strong");
      code.textContent = state.pairing.displayCode;
      const expiry = document.createElement("small");
      const updateExpiry = (): void => {
        const remaining = Math.max(
          0,
          Date.parse(state?.pairing?.expiresAt ?? "") - Date.now(),
        );
        expiry.textContent =
          remaining > 0
            ? `Expires in ${String(Math.ceil(remaining / 1000))} seconds · ${String(state?.pairing?.attemptsRemaining ?? 0)} attempts remaining`
            : "Expired";
        if (remaining <= 0) stopCountdown();
      };
      updateExpiry();
      countdown = window.setInterval(updateExpiry, 1_000);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "button button--secondary remote-access-action";
      cancel.textContent = "Cancel pairing";
      cancel.disabled = busy;
      cancel.addEventListener("click", () => {
        run(() => options.api.cancelPairingCode());
      });
      pairing.append(label, code, expiry, cancel);
      pairingPanel.append(pairing);
    }

    const devicesPanel = document.createElement("section");
    devicesPanel.className = "settings-panel remote-access-devices-panel";
    const devicesHeading = document.createElement("div");
    devicesHeading.className =
      "settings-row-base setting-row remote-access-devices-heading";
    const devicesCopy = document.createElement("span");
    devicesCopy.className = "setting-row__copy";
    const devicesTitle = document.createElement("strong");
    devicesTitle.textContent = "Paired devices";
    const devicesDetail = document.createElement("small");
    devicesDetail.textContent =
      state.devices.length === 0
        ? "No paired devices."
        : `${String(state.devices.length)} of 8 devices paired.`;
    devicesCopy.append(devicesTitle, devicesDetail);
    devicesHeading.append(devicesCopy);
    devicesPanel.append(devicesHeading);
    for (const device of state.devices)
      devicesPanel.append(deviceRow(device, confirmRevoke));

    const destructiveActions = document.createElement("div");
    destructiveActions.className =
      "settings-page-actions settings-page-actions--single remote-access-destructive-actions";
    const revokeAll = document.createElement("button");
    revokeAll.type = "button";
    revokeAll.className = "settings-page-action remote-access-revoke-all";
    revokeAll.textContent = "Revoke all";
    revokeAll.disabled = busy || state.readOnly || state.devices.length === 0;
    revokeAll.addEventListener("click", () => {
      element.append(confirmation.backdrop, confirmation.element);
      confirmation.open({
        title: "Revoke all devices?",
        description:
          "Every paired device will be disconnected immediately and must pair again.",
        confirmLabel: "Revoke all",
        returnFocus: revokeAll,
        onConfirm: () => {
          run(() => options.api.revokeAll(), "All devices revoked.");
        },
      });
    });
    destructiveActions.append(revokeAll);
    element.append(panel, primaryActions);
    if (pairingPanel) element.append(pairingPanel);
    element.append(devicesPanel, destructiveActions);
  };

  const refresh = async (): Promise<void> => {
    try {
      state = await options.api.state();
      if (!destroyed) render();
    } catch (error) {
      if (!destroyed) {
        options.showToast(
          error instanceof Error
            ? error.message
            : "Remote access status is unavailable.",
          "error",
        );
        element.replaceChildren();
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "button button--secondary remote-access-action";
        retry.textContent = "Refresh";
        retry.addEventListener("click", () => {
          void refresh();
        });
        element.append(retry);
      }
    }
  };

  const unsubscribe = options.api.subscribe((next) => {
    if (destroyed) return;
    const previous = state;
    if (next.pairing && pairingBaselineDeviceIds === null) {
      pairingBaselineDeviceIds = new Set(
        (previous?.pairing ? previous.devices : next.devices).map(
          (device) => device.id,
        ),
      );
    }
    const pairedDevice =
      (!next.pairing && pairingBaselineDeviceIds
        ? next.devices.find(
            (device) => !pairingBaselineDeviceIds?.has(device.id),
          )
        : null) ?? completedPairingDevice(previous, next);
    if (!next.pairing) pairingBaselineDeviceIds = null;
    state = next;
    render();
    if (pairedDevice)
      options.showToast(
        `Pairing completed. ${pairedDevice.name} is now connected.`,
        "success",
      );
  });

  render();
  void refresh();
  return {
    element,
    refresh,
    destroy() {
      destroyed = true;
      unsubscribe();
      stopCountdown();
      confirmation.destroy();
      element.replaceChildren();
    },
  };
}
