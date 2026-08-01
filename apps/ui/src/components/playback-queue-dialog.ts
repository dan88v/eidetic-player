import type { PlaybackContextQueueDecision } from "../../../../packages/shared/src/player";
import { t } from "../i18n";

export interface PlaybackQueueDialog {
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  decide(
    queueRevision: number,
    returnFocus?: HTMLElement,
  ): Promise<PlaybackContextQueueDecision | null>;
  close(): void;
  destroy(): void;
}

let dialogId = 0;

export function createPlaybackQueueDialog(): PlaybackQueueDialog {
  dialogId += 1;
  const titleId = `playback-queue-dialog-title-${String(dialogId)}`;
  const descriptionId = `playback-queue-dialog-description-${String(dialogId)}`;
  const backdrop = document.createElement("div");
  backdrop.className = "source-dialog-backdrop playback-queue-dialog-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const element = document.createElement("section");
  element.className = "source-dialog playback-queue-dialog";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("aria-labelledby", titleId);
  element.setAttribute("aria-describedby", descriptionId);
  element.innerHTML = `<button class="playback-queue-dialog__close" type="button" data-action="close" aria-label="${t("queueDecision.close")}">×</button><h2 id="${titleId}">${t("queueDecision.title")}</h2><p id="${descriptionId}" class="source-dialog__description">${t("queueDecision.description")}</p><div class="source-dialog__actions"><button type="button" data-action="preserve">${t("queueDecision.preserve")}</button><button class="source-dialog__confirm" type="button" data-action="clear">${t("queueDecision.clear")}</button></div>`;
  const closeButton = element.querySelector<HTMLButtonElement>(
    '[data-action="close"]',
  );
  const preserveButton = element.querySelector<HTMLButtonElement>(
    '[data-action="preserve"]',
  );
  const clearButton = element.querySelector<HTMLButtonElement>(
    '[data-action="clear"]',
  );
  if (!closeButton || !preserveButton || !clearButton)
    throw new Error("Playback Queue dialog could not be created");

  let pending:
    | {
        readonly revision: number;
        readonly returnFocus?: HTMLElement;
        readonly resolve: (
          decision: PlaybackContextQueueDecision | null,
        ) => void;
      }
    | undefined;

  const finish = (decision: PlaybackContextQueueDecision | null): void => {
    const closing = pending;
    if (!closing) return;
    pending = undefined;
    element.classList.remove("source-dialog--open");
    backdrop.classList.remove("source-dialog-backdrop--open");
    element.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    element.inert = true;
    closing.resolve(decision);
    closing.returnFocus?.focus();
  };

  const choose = (policy: "preserve" | "clear"): void => {
    if (!pending) return;
    finish({
      explicitQueuePolicy: policy,
      expectedQueueRevision: pending.revision,
    });
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (!pending) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
      return;
    }
    if (event.key !== "Tab") return;
    event.stopImmediatePropagation();
    const controls = [closeButton, preserveButton, clearButton];
    const current = controls.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (event.shiftKey && current <= 0) {
      event.preventDefault();
      clearButton.focus();
    } else if (!event.shiftKey && current === controls.length - 1) {
      event.preventDefault();
      closeButton.focus();
    }
  };

  closeButton.addEventListener("click", () => {
    finish(null);
  });
  preserveButton.addEventListener("click", () => {
    choose("preserve");
  });
  clearButton.addEventListener("click", () => {
    choose("clear");
  });
  backdrop.addEventListener("pointerup", () => {
    finish(null);
  });
  document.addEventListener("keydown", handleKeydown);
  element.inert = true;

  return {
    element,
    backdrop,
    decide(queueRevision, returnFocus) {
      finish(null);
      return new Promise((resolve) => {
        pending = {
          revision: queueRevision,
          ...(returnFocus ? { returnFocus } : {}),
          resolve,
        };
        element.inert = false;
        element.setAttribute("aria-hidden", "false");
        backdrop.setAttribute("aria-hidden", "false");
        element.classList.add("source-dialog--open");
        backdrop.classList.add("source-dialog-backdrop--open");
        queueMicrotask(() => {
          preserveButton.focus();
        });
      });
    },
    close: () => {
      finish(null);
    },
    destroy() {
      finish(null);
      document.removeEventListener("keydown", handleKeydown);
      element.remove();
      backdrop.remove();
    },
  };
}
