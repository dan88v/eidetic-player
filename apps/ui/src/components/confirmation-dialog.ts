export interface ConfirmationDialogOptions {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly returnFocus?: HTMLElement;
  readonly onConfirm: () => void;
}

export interface ConfirmationDialog {
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  open(options: ConfirmationDialogOptions): void;
  close(): void;
  destroy(): void;
}

let confirmationDialogId = 0;

export function createConfirmationDialog(): ConfirmationDialog {
  confirmationDialogId += 1;
  const titleId = `confirmation-dialog-title-${String(confirmationDialogId)}`;
  const descriptionId = `confirmation-dialog-description-${String(confirmationDialogId)}`;
  const backdrop = document.createElement("div");
  backdrop.className = "source-dialog-backdrop confirmation-dialog-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const element = document.createElement("section");
  element.className = "source-dialog confirmation-dialog";
  element.setAttribute("role", "alertdialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("aria-labelledby", titleId);
  element.setAttribute("aria-describedby", descriptionId);
  element.innerHTML = `<h2 id="${titleId}"></h2><p id="${descriptionId}" class="source-dialog__description"></p><div class="source-dialog__actions"><button type="button" data-action="cancel">Cancel</button><button class="source-dialog__confirm" type="button" data-action="confirm"></button></div>`;
  const title = element.querySelector<HTMLElement>(`#${titleId}`);
  const description = element.querySelector<HTMLElement>(`#${descriptionId}`);
  const cancel = element.querySelector<HTMLButtonElement>(
    '[data-action="cancel"]',
  );
  const confirm = element.querySelector<HTMLButtonElement>(
    '[data-action="confirm"]',
  );
  if (!title || !description || !cancel || !confirm)
    throw new Error("Confirmation dialog could not be created");
  let current: ConfirmationDialogOptions | null = null;

  const close = (): void => {
    if (!current) return;
    const closing = current;
    current = null;
    element.classList.remove("source-dialog--open");
    backdrop.classList.remove("source-dialog-backdrop--open");
    element.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    element.inert = true;
    closing.returnFocus?.focus();
  };

  const confirmDialog = (): void => {
    const onConfirm = current?.onConfirm;
    close();
    onConfirm?.();
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (!current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const first = cancel;
    const last = confirm;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  cancel.addEventListener("click", close);
  confirm.addEventListener("click", confirmDialog);
  backdrop.addEventListener("pointerup", close);
  document.addEventListener("keydown", handleKeydown);
  element.inert = true;

  return {
    element,
    backdrop,
    open(options) {
      current = options;
      title.textContent = options.title;
      description.textContent = options.description;
      confirm.textContent = options.confirmLabel;
      element.inert = false;
      element.setAttribute("aria-hidden", "false");
      backdrop.setAttribute("aria-hidden", "false");
      element.classList.add("source-dialog--open");
      backdrop.classList.add("source-dialog-backdrop--open");
      queueMicrotask(() => {
        cancel.focus();
      });
    },
    close,
    destroy() {
      close();
      document.removeEventListener("keydown", handleKeydown);
      element.remove();
      backdrop.remove();
    },
  };
}
