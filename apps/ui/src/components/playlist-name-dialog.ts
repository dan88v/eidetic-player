/* eslint-disable @typescript-eslint/no-non-null-assertion */
export interface PlaylistNameDialogOptions {
  readonly title: string;
  readonly confirmLabel: string;
  readonly initialName?: string;
  readonly description?: string;
  readonly danger?: boolean;
  readonly hideName?: boolean;
  readonly returnFocus?: HTMLElement;
  readonly onCancel?: () => void;
  readonly onSubmit: (name: string) => Promise<void>;
}

export interface PlaylistNameDialog {
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  open(options: PlaylistNameDialogOptions): void;
  close(): void;
  destroy(): void;
}

let playlistNameDialogId = 0;

export function createPlaylistNameDialog(): PlaylistNameDialog {
  playlistNameDialogId += 1;
  const titleId = `playlist-name-dialog-title-${String(playlistNameDialogId)}`;
  const backdrop = document.createElement("div");
  backdrop.className = "source-dialog-backdrop playlist-name-dialog-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const element = document.createElement("section");
  element.className = "source-dialog playlist-name-dialog";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("aria-labelledby", titleId);
  element.innerHTML = `<h2 id="${titleId}"></h2><p class="source-dialog__description" hidden></p><label class="source-dialog__field"><span>Name</span><input type="text" maxlength="80" autocomplete="off" data-onscreen-keyboard="text"></label><p class="playlist-name-error" role="alert"></p><div class="source-dialog__actions"><button type="button" data-action="cancel">Cancel</button><button class="source-dialog__confirm" type="button" data-action="confirm"></button></div>`;

  const title = element.querySelector<HTMLElement>(`#${titleId}`)!;
  const description = element.querySelector<HTMLElement>(
    ".source-dialog__description",
  )!;
  const field = element.querySelector<HTMLElement>(".source-dialog__field")!;
  const input = element.querySelector<HTMLInputElement>("input")!;
  const error = element.querySelector<HTMLElement>(".playlist-name-error")!;
  const cancel = element.querySelector<HTMLButtonElement>(
    '[data-action="cancel"]',
  )!;
  const confirm = element.querySelector<HTMLButtonElement>(
    '[data-action="confirm"]',
  )!;
  let current: PlaylistNameDialogOptions | null = null;
  let submitting = false;

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

  const cancelDialog = (): void => {
    const onCancel = current?.onCancel;
    close();
    onCancel?.();
  };

  const submit = async (): Promise<void> => {
    if (!current || submitting) return;
    submitting = true;
    confirm.disabled = true;
    error.textContent = "";
    try {
      await current.onSubmit(input.value);
      close();
    } catch (cause) {
      error.textContent =
        cause instanceof Error
          ? cause.message
          : "The playlist could not be saved.";
    } finally {
      submitting = false;
      confirm.disabled = false;
    }
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (!current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancelDialog();
      return;
    }
    if (event.key === "Enter" && document.activeElement === input) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [input, cancel, confirm].filter(
      (control) => !control.closest("[hidden]") && !control.disabled,
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  cancel.addEventListener("click", cancelDialog);
  confirm.addEventListener("click", () => void submit());
  backdrop.addEventListener("pointerup", cancelDialog);
  document.addEventListener("keydown", handleKeydown);
  element.inert = true;

  return {
    element,
    backdrop,
    open(options) {
      current = options;
      title.textContent = options.title;
      confirm.textContent = options.confirmLabel;
      confirm.classList.toggle(
        "source-dialog__confirm--danger",
        options.danger === true,
      );
      description.textContent = options.description ?? "";
      description.hidden = !options.description;
      field.hidden = options.hideName === true;
      input.value = options.initialName ?? "";
      error.textContent = "";
      element.inert = false;
      element.setAttribute("aria-hidden", "false");
      backdrop.setAttribute("aria-hidden", "false");
      element.classList.add("source-dialog--open");
      backdrop.classList.add("source-dialog-backdrop--open");
      queueMicrotask(() => {
        if (options.hideName) cancel.focus();
        else {
          input.focus();
          input.select();
        }
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
