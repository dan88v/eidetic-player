import type {
  Ipv4Draft,
  NetworkAdapterSnapshot,
  NetworkSnapshot,
  WifiNetwork,
  WifiSecurity,
} from "../../../../packages/shared/src/network";
import {
  ipv4ConfigurationOf,
  validateIpv4Draft,
} from "../../../../packages/shared/src/network";
import type { NetworkApiClient } from "../api/network-api-client";
import { createSegmentedControl } from "../components/segmented-control";

export interface NetworkSettingsPanel {
  readonly element: HTMLElement;
  readonly selectorElement: HTMLElement;
  update(snapshot: NetworkSnapshot): void;
  requestLeave(leave: () => void): boolean;
  destroy(): void;
}

type View = "wired" | "wifi";

function value(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "—";
}
function securityLabel(security: WifiSecurity): string {
  if (security === "open") return "Open";
  if (security === "wpa2-personal") return "WPA2 Personal";
  if (security === "wpa3-personal") return "WPA3 Personal";
  return "Unsupported";
}
function connectivityLabel(snapshot: NetworkSnapshot): string {
  if (snapshot.connectivity === "internet") return "Internet";
  if (snapshot.connectivity === "local-network") return "Local network";
  if (snapshot.connectivity === "disconnected") return "Disconnected";
  return "Unknown";
}
function details(
  adapter: NetworkAdapterSnapshot,
  connectivity: string,
): HTMLElement {
  const list = document.createElement("dl");
  list.className = "network-details";
  const rows: readonly (readonly [string, string])[] = [
    [
      "Status",
      adapter.connected
        ? "Connected"
        : adapter.enabled
          ? "Disconnected"
          : "Disabled",
    ],
    ...(adapter.linkSpeed
      ? ([["Link speed", adapter.linkSpeed]] as const)
      : []),
    [
      "IPv4 configuration",
      adapter.ipv4Method === "dhcp"
        ? "DHCP"
        : adapter.ipv4Method === "manual"
          ? "Manual"
          : "Unknown",
    ],
    ["IP address", value(adapter.ipv4Address)],
    ["Subnet mask", value(adapter.subnetMask)],
    ["Gateway", value(adapter.gateway)],
    ["DNS 1", value(adapter.dnsServers[0])],
    ["DNS 2", value(adapter.dnsServers[1])],
    ["Connectivity", connectivity],
  ];
  for (const [label, rowValue] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = rowValue;
    list.append(term, description);
  }
  return list;
}

export function networkSummary(snapshot: NetworkSnapshot): string {
  const wired = snapshot.wiredAdapters.find((adapter) => adapter.connected);
  if (wired) return "Wired connected";
  const wifi = snapshot.wifi.currentNetwork;
  if (wifi) return `Wi-Fi · ${wifi.ssid}`;
  if (snapshot.connectivity === "local-network") return "Local network";
  if (snapshot.connectivity === "disconnected") return "Disconnected";
  return snapshot.permissionState === "unsupported"
    ? "Network unavailable"
    : "Checking network";
}

export function createNetworkSettingsPanel(options: {
  readonly api: NetworkApiClient;
  readonly initialSnapshot: NetworkSnapshot;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
  readonly openSystemSettings: () => Promise<void>;
}): NetworkSettingsPanel {
  const element = document.createElement("div");
  element.className = "network-settings";
  let snapshot = options.initialSnapshot;
  let view: View =
    snapshot.activeRouteType === "wifi" &&
    !snapshot.wiredAdapters.some((item) => item.connected)
      ? "wifi"
      : snapshot.wiredAdapters.length === 0
        ? "wifi"
        : "wired";
  let selectedWiredId = snapshot.wiredAdapters[0]?.id ?? "";
  let selectedWifiId = snapshot.wifiAdapters[0]?.id ?? "";
  let initialScanRequested = false;
  const drafts = new Map<string, Ipv4Draft>();
  let dialogCleanup = (): void => undefined;
  const viewControl = createSegmentedControl<View>({
    label: "Network interface",
    value: view,
    items: [
      { value: "wired", label: "Wired" },
      { value: "wifi", label: "Wi-Fi" },
    ],
    onChange(value) {
      if (value === view) return;
      const previous = view;
      if (
        requestDiscard(() => {
          view = value;
          viewControl.setValue(value);
          render();
        })
      ) {
        viewControl.setValue(previous);
        return;
      }
      view = value;
      render();
    },
  });

  const run = (operation: Promise<void>): void => {
    void operation.catch((error: unknown) => {
      options.showToast(
        error instanceof Error ? error.message : "Network action failed.",
        "error",
      );
    });
  };

  const closeDialog = (): void => {
    dialogCleanup();
    dialogCleanup = () => undefined;
    element.querySelector(".network-dialog-backdrop")?.remove();
    element.querySelector(".network-dialog")?.remove();
  };

  const openDialog = (
    title: string,
    content: HTMLElement,
    confirmLabel: string,
    submit: () => Promise<void>,
    dismissible = true,
    cancelLabel = "Cancel",
    closeOnSuccess = true,
  ): void => {
    closeDialog();
    const backdrop = document.createElement("div");
    backdrop.className =
      "source-dialog-backdrop source-dialog-backdrop--open network-dialog-backdrop";
    const dialog = document.createElement("section");
    dialog.className = "source-dialog source-dialog--open network-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2");
    heading.textContent = title;
    const actions = document.createElement("div");
    actions.className = "source-dialog__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = cancelLabel;
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "source-dialog__confirm";
    confirm.textContent = confirmLabel;
    if (dismissible) actions.append(cancel);
    actions.append(confirm);
    dialog.append(heading, content, actions);
    element.append(backdrop, dialog);
    const dismiss = (): void => {
      closeDialog();
    };
    if (dismissible) {
      cancel.addEventListener("click", dismiss);
      backdrop.addEventListener("click", dismiss);
    }
    confirm.addEventListener("click", () => {
      confirm.disabled = true;
      if (dismissible) cancel.disabled = true;
      void submit()
        .then(() => {
          if (closeOnSuccess || !snapshot.configurationTransaction)
            closeDialog();
        })
        .catch((error: unknown) => {
          confirm.disabled = false;
          if (dismissible) cancel.disabled = false;
          options.showToast(
            error instanceof Error ? error.message : "Network action failed.",
            "error",
          );
        });
    });
    const escape = (event: KeyboardEvent): void => {
      if (dismissible && event.key === "Escape") closeDialog();
    };
    document.addEventListener("keydown", escape);
    dialogCleanup = () => {
      document.removeEventListener("keydown", escape);
    };
    queueMicrotask(() => {
      (dialog.querySelector("input") ?? confirm).focus();
    });
  };

  const adapterForView = (): NetworkAdapterSnapshot | undefined =>
    view === "wired"
      ? (snapshot.wiredAdapters.find(
          (adapter) => adapter.id === selectedWiredId,
        ) ?? snapshot.wiredAdapters[0])
      : (snapshot.wifiAdapters.find(
          (adapter) => adapter.id === selectedWifiId,
        ) ?? snapshot.wifiAdapters[0]);

  const draftFor = (adapter: NetworkAdapterSnapshot): Ipv4Draft => {
    const existing = drafts.get(adapter.id);
    if (existing) return existing;
    const created = ipv4ConfigurationOf(adapter);
    drafts.set(adapter.id, created);
    return created;
  };

  const isDirty = (adapter = adapterForView()): boolean => {
    if (!adapter) return false;
    const draft = draftFor(adapter);
    const current = ipv4ConfigurationOf(adapter);
    return draft.method === "dhcp"
      ? current.method !== "dhcp"
      : JSON.stringify(draft) !== JSON.stringify(current);
  };

  const requestDiscard = (leave: () => void): boolean => {
    if (!isDirty()) return false;
    const content = document.createElement("p");
    content.className = "source-dialog__description";
    content.textContent = "Your IPv4 changes have not been applied.";
    openDialog(
      "Discard network changes?",
      content,
      "Discard",
      () => {
        const adapter = adapterForView();
        if (adapter) drafts.set(adapter.id, ipv4ConfigurationOf(adapter));
        leave();
        return Promise.resolve();
      },
      true,
      "Continue editing",
    );
    return true;
  };

  const ipv4Editor = (adapter: NetworkAdapterSnapshot): HTMLElement => {
    const section = document.createElement("section");
    section.className = "network-ipv4";
    const heading = document.createElement("div");
    heading.className = "network-ipv4__header";
    const title = document.createElement("h2");
    title.textContent = "IPv4 configuration";
    const draft = draftFor(adapter);
    const mode = createSegmentedControl<"dhcp" | "manual">({
      label: "IPv4 configuration method",
      value: draft.method,
      items: [
        { value: "dhcp", label: "DHCP" },
        { value: "manual", label: "Manual" },
      ],
      onChange(method) {
        drafts.set(adapter.id, { ...draftFor(adapter), method });
        render();
      },
    });
    heading.append(title, mode.element);
    section.append(heading);
    if (draft.method === "manual") {
      const fields = document.createElement("div");
      fields.className = "network-ipv4__fields";
      const fieldDefinitions: readonly [
        Exclude<keyof Ipv4Draft, "method">,
        string,
        boolean,
      ][] = [
        ["address", "IP address", true],
        ["subnetMask", "Subnet mask", true],
        ["gateway", "Gateway", false],
        ["dns1", "DNS 1", false],
        ["dns2", "DNS 2", false],
      ];
      const validation = validateIpv4Draft(draft);
      for (const [key, labelText, required] of fieldDefinitions) {
        const label = document.createElement("label");
        label.className = "network-ipv4__field";
        const labelCopy = document.createElement("span");
        labelCopy.textContent = labelText;
        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "decimal";
        input.autocomplete = "off";
        input.maxLength = 15;
        input.required = required;
        input.value = draft[key];
        input.dataset.onscreenKeyboard = "ipv4";
        const error = document.createElement("small");
        error.className = "network-ipv4__error";
        error.textContent = validation.errors[key] ?? "";
        input.setAttribute(
          "aria-invalid",
          String(validation.errors[key] !== undefined),
        );
        input.addEventListener("input", () => {
          drafts.set(adapter.id, {
            ...draftFor(adapter),
            [key]: input.value,
          });
          const next = validateIpv4Draft(draftFor(adapter));
          error.textContent = next.errors[key] ?? "";
          input.setAttribute(
            "aria-invalid",
            String(next.errors[key] !== undefined),
          );
          actions.hidden = !isDirty(adapter);
          apply.disabled = !next.valid || !isDirty(adapter);
        });
        label.append(labelCopy, input, error);
        fields.append(label);
      }
      section.append(fields);
    }
    const actions = document.createElement("div");
    actions.className = "network-ipv4__actions";
    actions.hidden = !isDirty(adapter);
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "source-dialog__confirm";
    apply.textContent = "Apply network settings";
    apply.disabled = !validateIpv4Draft(draft).valid || !isDirty(adapter);
    apply.addEventListener("click", () => {
      (document.activeElement as HTMLElement | null)?.blur();
      const next = validateIpv4Draft(draftFor(adapter)).normalized;
      const content = document.createElement("div");
      content.className = "network-dialog__content";
      const summary =
        next.method === "dhcp"
          ? `${adapter.type === "wired" ? "Wired" : "Wi-Fi"} · DHCP`
          : `${adapter.type === "wired" ? "Wired" : "Wi-Fi"} · IP ${next.address} · Mask ${next.subnetMask} · Gateway ${next.gateway || "None"} · DNS ${[next.dns1, next.dns2].filter(Boolean).join(", ") || "None"}`;
      const copy = document.createElement("p");
      copy.className = "source-dialog__description";
      copy.textContent = summary;
      const warning = document.createElement("p");
      warning.className = "source-dialog__description";
      warning.textContent =
        "The network connection may be interrupted temporarily.";
      content.append(copy, warning);
      openDialog(
        "Apply network settings?",
        content,
        "Apply",
        async () => {
          const backendValidation = await options.api.validateIpv4(next);
          if (!backendValidation.valid)
            throw new Error("Review the invalid IPv4 fields.");
          await options.api.applyIpv4(adapter.id, backendValidation.normalized);
        },
        true,
        "Cancel",
        false,
      );
    });
    actions.append(apply);
    section.append(actions);
    return section;
  };

  const showTransactionDialog = (): void => {
    const transaction = snapshot.configurationTransaction;
    if (!transaction) return;
    closeDialog();
    const content = document.createElement("div");
    content.className = "network-dialog__content";
    const description = document.createElement("p");
    description.className = "source-dialog__description";
    if (transaction.state === "awaiting-confirmation") {
      description.textContent = `Keep these network settings? They will be reverted in ${String(transaction.secondsRemaining ?? 0)} seconds.`;
      content.append(description);
      const backdrop = document.createElement("div");
      backdrop.className =
        "source-dialog-backdrop source-dialog-backdrop--open network-dialog-backdrop";
      const dialog = document.createElement("section");
      dialog.className = "source-dialog source-dialog--open network-dialog";
      dialog.setAttribute("role", "alertdialog");
      dialog.setAttribute("aria-modal", "true");
      const title = document.createElement("h2");
      title.textContent = "Network settings applied";
      const actions = document.createElement("div");
      actions.className = "source-dialog__actions";
      const revert = document.createElement("button");
      revert.type = "button";
      revert.textContent = "Revert";
      const keep = document.createElement("button");
      keep.type = "button";
      keep.className = "source-dialog__confirm";
      keep.textContent = "Keep settings";
      revert.addEventListener("click", () => {
        revert.disabled = true;
        keep.disabled = true;
        run(options.api.rollbackIpv4());
      });
      keep.addEventListener("click", () => {
        revert.disabled = true;
        keep.disabled = true;
        run(options.api.confirmIpv4());
      });
      actions.append(revert, keep);
      dialog.append(title, content, actions);
      element.append(backdrop, dialog);
      element.querySelector(".network-panel")?.toggleAttribute("inert", true);
      viewControl.element.toggleAttribute("inert", true);
      queueMicrotask(() => {
        keep.focus();
      });
      return;
    }
    description.textContent =
      transaction.message ??
      (transaction.state === "recovery-required"
        ? "Network recovery requires attention."
        : "Updating network settings…");
    content.append(description);
    const backdrop = document.createElement("div");
    backdrop.className =
      "source-dialog-backdrop source-dialog-backdrop--open network-dialog-backdrop";
    const dialog = document.createElement("section");
    dialog.className = "source-dialog source-dialog--open network-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.textContent =
      transaction.state === "recovery-required"
        ? "Network recovery required"
        : "Updating network";
    dialog.append(title, content);
    if (transaction.state === "recovery-required") {
      const actions = document.createElement("div");
      actions.className = "source-dialog__actions";
      const system = document.createElement("button");
      system.type = "button";
      system.textContent = "Open system settings";
      system.addEventListener("click", () => {
        run(options.openSystemSettings());
      });
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "source-dialog__confirm";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => {
        run(options.api.retryIpv4Recovery());
      });
      actions.append(system, retry);
      dialog.append(actions);
    }
    element.append(backdrop, dialog);
    element.querySelector(".network-panel")?.toggleAttribute("inert", true);
    viewControl.element.toggleAttribute("inert", true);
  };

  const passwordContent = (
    network: WifiNetwork,
  ): {
    readonly element: HTMLElement;
    readonly password: HTMLInputElement | null;
  } => {
    const content = document.createElement("div");
    content.className = "network-dialog__content";
    const description = document.createElement("p");
    description.className = "source-dialog__description";
    description.textContent = `${network.ssid} · ${securityLabel(network.security)}`;
    content.append(description);
    if (network.security === "open")
      return { element: content, password: null };
    const label = document.createElement("label");
    label.className = "source-dialog__field";
    label.innerHTML =
      '<span>Password</span><input type="password" autocomplete="current-password" maxlength="128" data-onscreen-keyboard="password">';
    const password = label.querySelector<HTMLInputElement>("input");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "network-password-toggle";
    toggle.textContent = "Show password";
    toggle.addEventListener("click", () => {
      if (!password) return;
      const show = password.type === "password";
      password.type = show ? "text" : "password";
      toggle.textContent = show ? "Hide password" : "Show password";
    });
    content.append(label, toggle);
    return { element: content, password };
  };

  const connectNetwork = (network: WifiNetwork): void => {
    if (!network.supported || !selectedWifiId) return;
    const form = passwordContent(network);
    openDialog("Connect to Wi-Fi", form.element, "Connect", async () => {
      const password = form.password?.value;
      if (form.password) form.password.value = "";
      await options.api.connect(selectedWifiId, network.id, password);
    });
  };

  const hiddenNetwork = (): void => {
    if (!selectedWifiId) return;
    const content = document.createElement("div");
    content.className = "network-dialog__content";
    content.innerHTML = `
      <label class="source-dialog__field"><span>Network name (SSID)</span><input type="text" maxlength="32" autocomplete="off" data-onscreen-keyboard="text"></label>
      <label class="source-dialog__field"><span>Security</span><select><option value="open">Open</option><option value="wpa2-personal">WPA2 Personal</option><option value="wpa3-personal">WPA3 Personal</option></select></label>
      <label class="source-dialog__field" data-password-field hidden><span>Password</span><input type="password" maxlength="128" autocomplete="new-password" data-onscreen-keyboard="password"></label>`;
    const ssid = content.querySelector<HTMLInputElement>('input[type="text"]');
    const security = content.querySelector<HTMLSelectElement>("select");
    const passwordField = content.querySelector<HTMLElement>(
      "[data-password-field]",
    );
    const password = passwordField?.querySelector<HTMLInputElement>("input");
    let passwordToggle: HTMLButtonElement | null = null;
    const updatePasswordVisibility = (): void => {
      const required = security?.value !== "open";
      if (passwordField) passwordField.hidden = !required;
      if (passwordToggle) passwordToggle.hidden = !required;
    };
    security?.addEventListener("change", updatePasswordVisibility);
    if (password) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "network-password-toggle";
      toggle.textContent = "Show password";
      toggle.addEventListener("click", () => {
        const show = password.type === "password";
        password.type = show ? "text" : "password";
        toggle.textContent = show ? "Hide password" : "Show password";
      });
      content.append(toggle);
      passwordToggle = toggle;
    }
    updatePasswordVisibility();
    openDialog("Other network", content, "Connect", async () => {
      const name = ssid?.value.trim() ?? "";
      if (!name) throw new Error("Enter a network name.");
      const securityValue = (security?.value ?? "open") as Exclude<
        WifiSecurity,
        "unsupported"
      >;
      const secret = password?.value;
      if (password) password.value = "";
      const request = {
        adapterId: selectedWifiId,
        ssid: name,
        security: securityValue,
        ...(securityValue === "open" || secret === undefined
          ? {}
          : { password: secret }),
      };
      await options.api.connectHidden(request);
    });
  };

  const confirmAction = (
    title: string,
    message: string,
    label: string,
    action: () => Promise<void>,
  ): void => {
    const content = document.createElement("p");
    content.className = "source-dialog__description";
    content.textContent = message;
    openDialog(title, content, label, action);
  };

  function render(): void {
    closeDialog();
    viewControl.element.toggleAttribute("inert", false);
    element.replaceChildren();
    if (view === "wired") {
      renderWired();
    } else {
      renderWifi();
      if (
        !initialScanRequested &&
        snapshot.wifi.softwareRadio === "on" &&
        snapshot.permissionState === "granted" &&
        selectedWifiId
      ) {
        initialScanRequested = true;
        run(options.api.scan(selectedWifiId));
      }
    }
    showTransactionDialog();
  }

  function adapterPicker(
    adapters: readonly NetworkAdapterSnapshot[],
    selected: string,
    onSelect: (id: string) => void,
  ): HTMLSelectElement | null {
    if (adapters.length < 2) return null;
    const select = document.createElement("select");
    select.className = "network-adapter-select";
    select.setAttribute("aria-label", "Network adapter");
    for (const adapter of adapters) {
      const option = document.createElement("option");
      option.value = adapter.id;
      option.textContent = adapter.displayName;
      option.selected = adapter.id === selected;
      select.append(option);
    }
    select.addEventListener("change", () => {
      const next = select.value;
      if (
        requestDiscard(() => {
          onSelect(next);
          render();
        })
      ) {
        select.value = selected;
        return;
      }
      onSelect(next);
      render();
    });
    return select;
  }

  function renderWired(): void {
    const panel = document.createElement("section");
    panel.className = "network-panel";
    const picker = adapterPicker(
      snapshot.wiredAdapters,
      selectedWiredId,
      (id) => {
        selectedWiredId = id;
      },
    );
    if (picker) panel.append(picker);
    const adapter =
      snapshot.wiredAdapters.find((item) => item.id === selectedWiredId) ??
      snapshot.wiredAdapters[0];
    if (!adapter) {
      panel.innerHTML =
        '<p class="network-empty">No wired adapter available.</p>';
    } else {
      selectedWiredId = adapter.id;
      panel.append(
        details(adapter, connectivityLabel(snapshot)),
        ipv4Editor(adapter),
      );
    }
    element.append(panel);
  }

  function renderWifi(): void {
    const panel = document.createElement("section");
    panel.className = "network-panel";
    const adapter =
      snapshot.wifiAdapters.find((item) => item.id === selectedWifiId) ??
      snapshot.wifiAdapters[0];
    if (adapter) selectedWifiId = adapter.id;
    const picker = adapterPicker(
      snapshot.wifiAdapters,
      selectedWifiId,
      (id) => {
        selectedWifiId = id;
        initialScanRequested = false;
      },
    );
    if (picker) panel.append(picker);
    if (!adapter) {
      if (snapshot.permissionState === "permission-required") {
        panel.innerHTML =
          '<div class="network-status-message"><p>Windows location permission is required to access Wi-Fi networks.</p></div>';
        const settings = document.createElement("button");
        settings.type = "button";
        settings.textContent = "Open settings";
        settings.addEventListener("click", () => {
          run(options.openSystemSettings());
        });
        panel.querySelector(".network-status-message")?.append(settings);
      } else
        panel.innerHTML =
          '<p class="network-empty">No Wi-Fi adapter available.</p>';
      element.append(panel);
      return;
    }
    const radioRow = document.createElement("div");
    radioRow.className = "network-radio-row";
    const radioLabel = document.createElement("strong");
    radioLabel.textContent = "Wi-Fi";
    const radioControl = createSegmentedControl<"on" | "off">({
      label: "Wi-Fi radio",
      value: snapshot.wifi.softwareRadio === "off" ? "off" : "on",
      items: [
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ],
      onChange(next) {
        const enabled = next === "on";
        if (
          !enabled &&
          snapshot.wifiAdapters.some((candidate) => candidate.connected)
        ) {
          confirmAction(
            "Turn off Wi-Fi?",
            "The Wi-Fi connection will be interrupted. Wired will not be changed.",
            "Turn off",
            () =>
              options.api.setRadio({ adapterId: adapter.id, enabled: false }),
          );
        } else run(options.api.setRadio({ adapterId: adapter.id, enabled }));
      },
    });
    radioControl.element.toggleAttribute(
      "inert",
      snapshot.wifi.hardwareRadio === "off" ||
        snapshot.operationState !== "idle",
    );
    radioRow.append(radioLabel, radioControl.element);
    panel.append(radioRow);
    if (snapshot.wifi.hardwareRadio === "off") {
      const hardware = document.createElement("p");
      hardware.className = "network-status-message";
      hardware.textContent = "Wi-Fi is disabled by a hardware control.";
      panel.append(hardware);
    }
    if (snapshot.permissionState === "permission-required") {
      const permission = document.createElement("div");
      permission.className = "network-status-message";
      permission.innerHTML =
        "<p>Windows location permission is required to scan Wi-Fi networks.</p>";
      const settings = document.createElement("button");
      settings.type = "button";
      settings.textContent = "Open settings";
      settings.addEventListener("click", () => {
        run(options.openSystemSettings());
      });
      permission.append(settings);
      panel.append(permission);
    }
    const current = snapshot.wifi.currentNetwork;
    const currentSection = document.createElement("section");
    currentSection.className = "network-current";
    const currentTitle = document.createElement("h2");
    currentTitle.textContent = "Current network";
    currentSection.append(currentTitle);
    if (current) {
      const summary = document.createElement("p");
      summary.textContent = `${current.ssid} · ${snapshot.operationState === "connecting" ? "Connecting" : "Connected"} · ${String(current.signalPercent)}% · ${securityLabel(current.security)} · ${snapshot.wifi.managedByEidetic ? "Managed by Eidetic" : "Managed by system"}`;
      currentSection.append(
        summary,
        details(adapter, connectivityLabel(snapshot)),
      );
      const actions = document.createElement("div");
      actions.className = "network-inline-actions";
      const disconnect = document.createElement("button");
      disconnect.type = "button";
      disconnect.textContent = "Disconnect";
      disconnect.addEventListener("click", () => {
        run(options.api.disconnect(adapter.id));
      });
      actions.append(disconnect);
      if (snapshot.wifi.managedByEidetic) {
        const forget = document.createElement("button");
        forget.type = "button";
        forget.textContent = "Forget";
        forget.addEventListener("click", () => {
          confirmAction(
            "Forget this network?",
            "Only the Eidetic Player Wi-Fi profile will be removed.",
            "Forget",
            () => options.api.forget(adapter.id),
          );
        });
        actions.append(forget);
      }
      currentSection.append(actions);
    } else {
      const disconnected = document.createElement("p");
      disconnected.textContent =
        snapshot.operationState === "connecting"
          ? "Connecting…"
          : "Disconnected";
      currentSection.append(disconnected);
    }
    panel.append(currentSection);
    panel.append(ipv4Editor(adapter));
    const listHeader = document.createElement("div");
    listHeader.className = "network-list-header";
    listHeader.innerHTML = "<h2>Available networks</h2>";
    const rescan = document.createElement("button");
    rescan.type = "button";
    rescan.textContent =
      snapshot.wifi.scanState === "scanning" ? "Scanning…" : "Rescan";
    rescan.disabled =
      snapshot.wifi.scanState === "scanning" ||
      snapshot.wifi.softwareRadio !== "on" ||
      snapshot.permissionState !== "granted";
    rescan.addEventListener("click", () => {
      run(options.api.scan(adapter.id));
    });
    listHeader.append(rescan);
    panel.append(listHeader);
    const list = document.createElement("div");
    list.className = "network-list";
    for (const network of snapshot.wifi.availableNetworks) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "network-list-row";
      button.disabled = !network.supported || network.connected;
      button.innerHTML = `<span><strong></strong><small></small></span><span>${String(network.signalPercent)}%</span>`;
      const strong = button.querySelector("strong");
      const small = button.querySelector("small");
      if (strong) strong.textContent = network.ssid;
      if (small)
        small.textContent = `${securityLabel(network.security)}${network.connected ? " · Connected" : ""}`;
      button.addEventListener("click", () => {
        connectNetwork(network);
      });
      list.append(button);
    }
    if (
      snapshot.wifi.scanState === "no-networks" &&
      snapshot.wifi.availableNetworks.length === 0
    ) {
      const empty = document.createElement("p");
      empty.className = "network-empty";
      empty.textContent = "No networks found.";
      list.append(empty);
    }
    const other = document.createElement("button");
    other.type = "button";
    other.className = "network-list-row network-list-row--other";
    other.textContent = "Other network…";
    other.disabled = snapshot.wifi.softwareRadio !== "on";
    other.addEventListener("click", hiddenNetwork);
    list.append(other);
    panel.append(list);
    element.append(panel);
  }

  render();
  return {
    element,
    selectorElement: viewControl.element,
    update(next) {
      if (next.revision < snapshot.revision) return;
      const transactionFinished =
        snapshot.configurationTransaction !== null &&
        next.configurationTransaction === null;
      snapshot = next;
      if (transactionFinished) drafts.clear();
      if (
        element.querySelector(".network-dialog") &&
        !next.configurationTransaction
      )
        return;
      render();
    },
    requestLeave(leave) {
      if (snapshot.configurationTransaction) return true;
      return requestDiscard(leave);
    },
    destroy() {
      closeDialog();
      element.replaceChildren();
    },
  };
}
