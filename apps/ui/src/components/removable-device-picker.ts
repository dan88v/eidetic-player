import type { RemovableDevice } from "../../../../packages/shared/src/library";

export interface RemovableDevicePicker {
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  open(
    devices: readonly RemovableDevice[],
    onSelect: (device: RemovableDevice) => void,
    returnFocus?: HTMLElement,
  ): void;
  update(devices: readonly RemovableDevice[]): boolean;
  close(): void;
  destroy(): void;
}

function formatCapacity(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  return new Intl.NumberFormat("en", {
    style: "unit",
    unit: "gigabyte",
    maximumFractionDigits: 1,
  }).format(bytes / 1_000_000_000);
}

export function createRemovableDevicePicker(): RemovableDevicePicker {
  const backdrop = document.createElement("div");
  backdrop.className = "playlist-picker-backdrop";
  const element = document.createElement("section");
  element.className = "playlist-picker removable-device-picker";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-labelledby", "removable-device-picker-title");
  element.innerHTML = `<header><h2 id="removable-device-picker-title">USB Storage</h2><button type="button" data-action="close" aria-label="Close">&times;</button></header><div class="playlist-picker__body"></div>`;
  const body = element.querySelector<HTMLElement>(".playlist-picker__body");
  if (!body) throw new Error("USB device picker is incomplete");
  let isOpen = false;
  let devices: readonly RemovableDevice[] = [];
  let select: ((device: RemovableDevice) => void) | null = null;
  let returnFocus: HTMLElement | undefined;

  const render = (): void => {
    const fragment = document.createDocumentFragment();
    for (const device of devices) {
      const button = document.createElement("button");
      button.type = "button";
      const details = [
        device.readable ? "Ready" : "Unavailable",
        formatCapacity(device.capacityBytes),
        device.readOnly ? "Read-only" : "",
      ].filter(Boolean);
      const name = document.createElement("strong");
      name.textContent = device.displayName;
      const status = document.createElement("span");
      status.textContent = details.join(" · ");
      button.append(name, status);
      button.disabled = !device.readable;
      button.addEventListener("click", () => {
        const callback = select;
        close(false);
        callback?.(device);
      });
      fragment.append(button);
    }
    body.replaceChildren(fragment);
  };
  const close = (restore = true): void => {
    isOpen = false;
    element.classList.remove("playlist-picker--open");
    backdrop.classList.remove("playlist-picker-backdrop--open");
    element.inert = true;
    if (restore) returnFocus?.focus();
  };
  element
    .querySelector('[data-action="close"]')
    ?.addEventListener("click", () => {
      close();
    });
  backdrop.addEventListener("pointerup", () => {
    close();
  });
  const keydown = (event: KeyboardEvent): void => {
    if (!isOpen || event.key !== "Escape") return;
    event.preventDefault();
    close();
  };
  document.addEventListener("keydown", keydown);
  element.inert = true;
  return {
    element,
    backdrop,
    open(nextDevices, onSelect, trigger) {
      devices = nextDevices;
      select = onSelect;
      returnFocus = trigger;
      render();
      isOpen = true;
      element.inert = false;
      element.classList.add("playlist-picker--open");
      backdrop.classList.add("playlist-picker-backdrop--open");
      queueMicrotask(() => {
        body.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      });
    },
    update(nextDevices) {
      devices = nextDevices;
      if (!isOpen) return false;
      if (devices.length === 0) {
        close(false);
        return true;
      }
      render();
      return false;
    },
    close() {
      close();
    },
    destroy() {
      close(false);
      document.removeEventListener("keydown", keydown);
      element.remove();
      backdrop.remove();
    },
  };
}
