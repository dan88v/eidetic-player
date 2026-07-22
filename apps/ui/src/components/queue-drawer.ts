import type { PlayerState } from "../../../../packages/shared/src/player";
import { icon } from "./icons";
import { t } from "../i18n";
import { queueArtworkUrl } from "../api/player-api-client";
import { createArtwork, type ArtworkView } from "./artwork";

const focusableSelector =
  'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export interface QueueDrawer {
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  setOpen(open: boolean): void;
  setReturnFocus(element: HTMLElement): void;
  containFocus(event: KeyboardEvent): void;
  dismissConfirmation(): boolean;
  update(state: PlayerState): void;
  destroy(): void;
}

interface QueueRowView {
  readonly row: HTMLLIElement;
  readonly button: HTMLButtonElement;
  readonly number: HTMLSpanElement;
  readonly title: HTMLElement;
  readonly filename: HTMLElement;
  readonly remove: HTMLButtonElement;
  readonly artwork: ArtworkView;
  artworkRevision: string | null;
  isCurrent: boolean;
}

export function createQueueDrawer(options: {
  readonly onClose: () => void;
  readonly onPlay: (index: number) => void;
  readonly onClear: () => void;
  readonly onRemove: (queueItemId: string) => void;
}): QueueDrawer {
  let returnFocus: HTMLElement | null = null;
  let isOpen = false;
  let queueRevision = -1;
  let queueSnapshot: PlayerState["queue"] | null = null;
  let queueIds: readonly string[] = [];
  let loadGeneration = 0;
  let activeLoads = 0;
  let confirmationOpen = false;
  const pendingLoads: {
    readonly id: string;
    readonly view: ArtworkView;
    readonly generation: number;
  }[] = [];
  const queuedIds = new Set<string>();
  const rowViews = new Map<string, QueueRowView>();
  const backdrop = document.createElement("div");
  backdrop.className = "queue-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const element = document.createElement("aside");
  element.className = "queue-drawer";
  element.id = "queue-drawer";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-label", t("queueDrawer.label"));
  element.innerHTML = `
    <header class="queue-drawer__header">
      <div><h2>${t("queueDrawer.title")}</h2><p>${t("queueDrawer.description")}</p></div>
      <button class="icon-button queue-drawer__close" type="button" aria-label="${t("queueDrawer.close")}">${icon("close")}</button>
    </header>
    <div class="queue-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="queue-confirmation-title" aria-hidden="true">
      <div class="queue-confirmation__panel">
        <h3 id="queue-confirmation-title">${t("queueDrawer.clearTitle")}</h3>
        <p>${t("queueDrawer.clearDescription")}</p>
        <div><button class="queue-confirmation__cancel" type="button">${t("common.cancel")}</button><button class="queue-confirmation__clear" type="button">${t("queueDrawer.clear")}</button></div>
      </div>
    </div>
    <ol class="queue-list">
      <li class="queue-list__clear" hidden>
        <button class="queue-list__clear-button" type="button">${t("queueDrawer.clear")}</button>
      </li>
    </ol>`;
  const closeButton = element.querySelector<HTMLButtonElement>(
    ".queue-drawer__close",
  );
  const list = element.querySelector<HTMLOListElement>(".queue-list");
  const clearButton = element.querySelector<HTMLButtonElement>(
    ".queue-list__clear-button",
  );
  const clearRow = element.querySelector<HTMLLIElement>(".queue-list__clear");
  const confirmation = element.querySelector<HTMLElement>(
    ".queue-confirmation",
  );
  const cancelClear = element.querySelector<HTMLButtonElement>(
    ".queue-confirmation__cancel",
  );
  const confirmClear = element.querySelector<HTMLButtonElement>(
    ".queue-confirmation__clear",
  );
  if (
    !closeButton ||
    !list ||
    !clearButton ||
    !clearRow ||
    !confirmation ||
    !cancelClear ||
    !confirmClear
  )
    throw new Error("Queue drawer is incomplete");
  const setConfirmationOpen = (open: boolean): void => {
    confirmationOpen = open;
    confirmation.classList.toggle("queue-confirmation--open", open);
    confirmation.setAttribute("aria-hidden", String(!open));
    if (open) cancelClear.focus();
    else clearButton.focus();
  };
  const runLoads = (): void => {
    while (isOpen && activeLoads < 2) {
      const pending = pendingLoads.shift();
      if (!pending) break;
      queuedIds.delete(pending.id);
      if (pending.generation !== loadGeneration) continue;
      activeLoads += 1;
      void pending.view
        .loadUrl(
          queueArtworkUrl(pending.id),
          `queue:${pending.id}:${String(pending.generation)}`,
        )
        .finally(() => {
          activeLoads = Math.max(0, activeLoads - 1);
          runLoads();
        });
    }
  };
  const createObserver = (): IntersectionObserver =>
    new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const row = entry.target as HTMLElement;
          const id = row.dataset.queueArtworkId;
          const view = id ? rowViews.get(id)?.artwork : null;
          if (!id || !view || queuedIds.has(id)) continue;
          observer.unobserve(row);
          queuedIds.add(id);
          pendingLoads.push({ id, view, generation: loadGeneration });
        }
        runLoads();
      },
      { root: list, rootMargin: "120px 0px" },
    );
  let observer = createObserver();
  const observeLazyRows = (): void => {
    if (!isOpen) return;
    for (const row of list.querySelectorAll<HTMLElement>(
      "[data-queue-artwork-id]",
    ))
      observer.observe(row);
  };
  closeButton.addEventListener("click", options.onClose);
  clearButton.addEventListener("click", () => {
    setConfirmationOpen(true);
  });
  cancelClear.addEventListener("click", () => {
    setConfirmationOpen(false);
  });
  confirmClear.addEventListener("click", () => {
    setConfirmationOpen(false);
    options.onClear();
  });
  backdrop.addEventListener("pointerup", options.onClose);
  return {
    element,
    backdrop,
    setReturnFocus(next) {
      returnFocus = next;
    },
    setOpen(open) {
      isOpen = open;
      element.classList.toggle("queue-drawer--open", open);
      backdrop.classList.toggle("queue-backdrop--visible", open);
      element.setAttribute("aria-hidden", String(!open));
      element.inert = !open;
      if (open) {
        observeLazyRows();
        closeButton.focus();
      } else {
        confirmationOpen = false;
        confirmation.classList.remove("queue-confirmation--open");
        confirmation.setAttribute("aria-hidden", "true");
        observer.disconnect();
        pendingLoads.length = 0;
        queuedIds.clear();
        returnFocus?.setAttribute("aria-expanded", "false");
        returnFocus?.focus();
      }
    },
    containFocus(event) {
      if (event.key !== "Tab") return;
      const controls = [
        ...(confirmationOpen
          ? confirmation
          : element
        ).querySelectorAll<HTMLElement>(focusableSelector),
      ];
      const first = controls.at(0);
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    dismissConfirmation() {
      if (!confirmationOpen) return false;
      setConfirmationOpen(false);
      return true;
    },
    update(state) {
      clearButton.disabled = state.queue.length === 0;
      clearRow.hidden = state.queue.length === 0;
      if (
        state.queueRevision === queueRevision &&
        state.queue === queueSnapshot
      )
        return;
      queueRevision = state.queueRevision;
      queueSnapshot = state.queue;
      const nextIds = state.queue.map((item) => item.id);
      const structureChanged =
        nextIds.length !== queueIds.length ||
        nextIds.some((id, index) => id !== queueIds[index]);
      if (import.meta.env.DEV) {
        list.dataset.reconciliations = String(
          Number(list.dataset.reconciliations ?? "0") + 1,
        );
        if (structureChanged)
          list.dataset.structuralUpdates = String(
            Number(list.dataset.structuralUpdates ?? "0") + 1,
          );
      }
      if (structureChanged) {
        loadGeneration += 1;
        observer.disconnect();
        observer = createObserver();
        pendingLoads.length = 0;
        queuedIds.clear();
        const retained = new Set(nextIds);
        for (const [id, view] of rowViews) {
          if (retained.has(id)) continue;
          view.artwork.destroy();
          view.row.remove();
          rowViews.delete(id);
        }
        queueIds = nextIds;
      }
      if (state.queue.length === 0) {
        let empty = list.querySelector<HTMLLIElement>(".queue-list__empty");
        if (!empty) {
          empty = document.createElement("li");
          empty.className = "queue-list__empty";
          empty.textContent = t("queueDrawer.empty");
          list.append(empty);
        }
        return;
      }
      list.querySelector(".queue-list__empty")?.remove();
      for (const item of state.queue) {
        let view = rowViews.get(item.id);
        if (!view) {
          const row = document.createElement("li");
          row.className = "queue-item";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "queue-item__button";
          const number = document.createElement("span");
          number.className = "queue-item__index";
          const artwork = createArtwork({
            className: "queue-item__artwork",
            decorative: true,
          });
          const copy = document.createElement("span");
          copy.className = "queue-item__copy";
          const title = document.createElement("strong");
          const filename = document.createElement("span");
          copy.append(title, filename);
          button.append(number, artwork.element, copy);
          button.addEventListener("click", () => {
            const index = Number(row.dataset.queueIndex);
            if (Number.isInteger(index)) options.onPlay(index);
          });
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "queue-item__remove";
          remove.innerHTML = icon("close");
          remove.addEventListener("click", (event) => {
            event.stopPropagation();
            options.onRemove(item.id);
          });
          row.append(button, remove);
          view = {
            row,
            button,
            number,
            title,
            filename,
            remove,
            artwork,
            artworkRevision: null,
            isCurrent: false,
          };
          rowViews.set(item.id, view);
        }
        view.row.dataset.queueIndex = String(item.index);
        if (view.isCurrent !== item.isCurrent) {
          view.isCurrent = item.isCurrent;
          view.row.classList.toggle("queue-item--current", item.isCurrent);
          if (item.isCurrent) view.button.setAttribute("aria-current", "true");
          else view.button.removeAttribute("aria-current");
          const numberText = item.isCurrent ? "●" : String(item.index + 1);
          if (view.number.textContent !== numberText)
            if (view.number.firstChild instanceof Text)
              view.number.firstChild.data = numberText;
            else view.number.textContent = numberText;
        } else if (!item.isCurrent) {
          const numberText = String(item.index + 1);
          if (view.number.textContent !== numberText)
            if (view.number.firstChild instanceof Text)
              view.number.firstChild.data = numberText;
            else view.number.textContent = numberText;
        }
        view.button.setAttribute(
          "aria-label",
          `${t("queueDrawer.play")} ${item.displayTitle}`,
        );
        view.remove.setAttribute(
          "aria-label",
          `${t("queueDrawer.remove")} ${item.displayTitle}`,
        );
        if (view.title.textContent !== item.displayTitle)
          if (view.title.firstChild instanceof Text)
            view.title.firstChild.data = item.displayTitle;
          else view.title.textContent = item.displayTitle;
        if (view.filename.textContent !== item.filename)
          if (view.filename.firstChild instanceof Text)
            view.filename.firstChild.data = item.filename;
          else view.filename.textContent = item.filename;
        const revision = item.artwork?.revision ?? null;
        if (revision !== view.artworkRevision) {
          view.artworkRevision = revision;
          view.artwork.update(item.artwork, "");
        }
        if (item.artwork) delete view.row.dataset.queueArtworkId;
        else view.row.dataset.queueArtworkId = item.id;
        if (structureChanged) list.insertBefore(view.row, clearRow);
      }
      observeLazyRows();
    },
    destroy() {
      isOpen = false;
      loadGeneration += 1;
      observer.disconnect();
      pendingLoads.length = 0;
      queuedIds.clear();
      for (const view of rowViews.values()) {
        view.artwork.destroy();
      }
      rowViews.clear();
    },
  };
}
