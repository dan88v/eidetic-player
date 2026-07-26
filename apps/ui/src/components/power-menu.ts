import type { SystemPowerAction } from "../../../../packages/shared/src/system";
import { icon } from "./icons";

const copy = {
  quit: {
    label: "Quit Eidetic Player",
    description: "Close the application.",
    title: "Quit Eidetic Player?",
    body: "Playback will stop and the current session will be saved.",
    confirm: "Quit",
    progress: "Closing Eidetic Player…",
  },
  "restart-app": {
    label: "Restart Eidetic Player",
    description: "Restart the player application and services.",
    title: "Restart Eidetic Player?",
    body: "Playback will stop briefly and the current session will be restored.",
    confirm: "Restart",
    progress: "Restarting Eidetic Player…",
  },
  maintenance: {
    label: "Maintenance",
    description: "Close the player and open maintenance tools.",
    title: "Enter maintenance mode?",
    body: "Playback will stop and the maintenance terminal will open.",
    confirm: "Continue",
    progress: "Entering maintenance mode…",
  },
  reboot: {
    label: "Restart device",
    description: "Restart the operating system.",
    title: "Restart this device?",
    body: "Playback will stop and the device will restart.",
    confirm: "Restart device",
    progress: "Restarting device…",
  },
  shutdown: {
    label: "Shut down device",
    description: "Safely power off the device.",
    title: "Shut down this device?",
    body: "Playback will stop and the device will power off.",
    confirm: "Shut down",
    progress: "Shutting down…",
  },
} satisfies Record<SystemPowerAction, Record<string, string>>;

const focusable =
  'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function createPowerMenu(options: {
  readonly actions: readonly SystemPowerAction[];
  readonly onAction: (action: SystemPowerAction) => Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const backdrop = document.createElement("div");
  backdrop.className = "power-backdrop";
  const element = document.createElement("section");
  element.className = "power-dialog";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-labelledby", "power-dialog-title");
  element.setAttribute("aria-describedby", "power-dialog-description");
  let trigger: HTMLElement | null = null;
  let state: "closed" | "menu" | "confirm" | "progress" | "error" = "closed";
  let selected: SystemPowerAction | null = null;

  const close = (): void => {
    if (state === "progress") return;
    state = "closed";
    backdrop.classList.remove("power-backdrop--open");
    element.classList.remove("power-dialog--open");
    element.inert = true;
    options.onOpenChange(false);
    trigger?.focus();
  };
  const renderMenu = (): void => {
    state = "menu";
    selected = null;
    element.innerHTML = `<header><h2 id="power-dialog-title">Power</h2><button class="icon-button power-dialog__close" type="button" aria-label="Close">${icon("close")}</button></header><p id="power-dialog-description" class="visually-hidden">Choose a power action.</p><div class="power-dialog__actions">${options.actions
      .map(
        (action) =>
          `<button class="power-action${action === "shutdown" ? " power-action--danger" : ""}" type="button" data-power-action="${action}">${icon(action === "shutdown" ? "power" : action === "maintenance" ? "settings" : "power")}<span><strong>${copy[action].label}</strong><small>${copy[action].description}</small></span></button>`,
      )
      .join("")}</div>`;
    element
      .querySelector(".power-dialog__close")
      ?.addEventListener("click", close);
    for (const button of element.querySelectorAll<HTMLButtonElement>(
      "[data-power-action]",
    ))
      button.addEventListener("click", () => {
        selected = button.dataset.powerAction as SystemPowerAction;
        renderConfirm(selected);
      });
    element.querySelector<HTMLButtonElement>("[data-power-action]")?.focus();
  };
  const renderConfirm = (action: SystemPowerAction): void => {
    state = "confirm";
    element.innerHTML = `<h2 id="power-dialog-title">${copy[action].title}</h2><p id="power-dialog-description">${copy[action].body}</p><div class="power-dialog__footer"><button class="button button--secondary" data-cancel type="button">Cancel</button><button class="button button--primary${action === "shutdown" ? " power-confirm--danger" : ""}" data-confirm type="button">${copy[action].confirm}</button></div>`;
    element
      .querySelector("[data-cancel]")
      ?.addEventListener("click", renderMenu);
    element.querySelector("[data-confirm]")?.addEventListener("click", () => {
      renderProgress(action);
      void options.onAction(action).catch((error: unknown) => {
        renderError(
          error instanceof Error ? error.message : "The system action failed.",
        );
      });
    });
    element.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
  };
  const renderProgress = (action: SystemPowerAction): void => {
    state = "progress";
    element.innerHTML = `<div class="power-progress" aria-live="assertive"><span class="power-spinner" aria-hidden="true"></span><h2 id="power-dialog-title">${copy[action].progress}</h2><p id="power-dialog-description">Please wait.</p></div>`;
  };
  const renderError = (message: string): void => {
    state = "error";
    element.innerHTML = `<h2 id="power-dialog-title">Power action failed</h2><p id="power-dialog-description"></p><div class="power-dialog__footer"><button class="button button--primary" data-close type="button">Close</button></div>`;
    const description = element.querySelector("#power-dialog-description");
    if (description) description.textContent = message;
    element.querySelector("[data-close]")?.addEventListener("click", close);
    element.querySelector<HTMLButtonElement>("[data-close]")?.focus();
  };
  backdrop.addEventListener("pointerup", close);
  element.addEventListener("pointerup", (event) => {
    event.stopPropagation();
  });
  element.inert = true;
  return {
    backdrop,
    element,
    open(returnFocus: HTMLElement) {
      trigger = returnFocus;
      backdrop.classList.add("power-backdrop--open");
      element.classList.add("power-dialog--open");
      element.inert = false;
      options.onOpenChange(true);
      renderMenu();
    },
    handleKeydown(event: KeyboardEvent) {
      if (state === "closed") return false;
      if (event.key === "Escape" && state !== "progress") {
        event.preventDefault();
        if (state === "confirm") renderMenu();
        else close();
        return true;
      }
      if (event.key === "Tab") {
        const controls = [...element.querySelectorAll<HTMLElement>(focusable)];
        const first = controls.at(0);
        const last = controls.at(-1);
        if (
          first &&
          last &&
          event.shiftKey &&
          document.activeElement === first
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          first &&
          last &&
          !event.shiftKey &&
          document.activeElement === last
        ) {
          event.preventDefault();
          first.focus();
        }
      }
      return true;
    },
    get isOpen() {
      return state !== "closed";
    },
  };
}
