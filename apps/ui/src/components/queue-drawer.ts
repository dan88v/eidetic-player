import type { PlayerState } from "../../../../packages/shared/src/player";
import { icon } from "./icons";
import { t } from "../i18n";
import { queueArtworkUrl } from "../api/player-api-client";
import {
  queueAutoScrollStep,
  queueDropIndex,
  shouldStartQueueDrag,
} from "../utils/queue-reorder";
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
  readonly handle: HTMLButtonElement;
  artworkRevision: string | null;
  isCurrent: boolean;
}

export function createQueueDrawer(options: {
  readonly onClose: () => void;
  readonly onPlay: (index: number) => void;
  readonly onClear: () => void;
  readonly onRemove: (queueItemId: string) => void;
  readonly onReorder: (queueItemId: string, toIndex: number) => Promise<void>;
  readonly onAddToPlaylist: (
    trackIds: readonly string[],
    trigger: HTMLElement,
  ) => void;
}): QueueDrawer {
  let returnFocus: HTMLElement | null = null;
  let isOpen = false;
  let queueRevision = -1;
  let queueSnapshot: PlayerState["queue"] | null = null;
  let queueIds: readonly string[] = [];
  let loadGeneration = 0;
  let activeLoads = 0;
  let confirmationOpen = false;
  let cancelActiveReorder: (() => void) | null = null;
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
        <button class="queue-list__playlist-button" type="button">${t("common.addToPlaylist")}</button>
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
  const playlistButton = element.querySelector<HTMLButtonElement>(
    ".queue-list__playlist-button",
  );
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
    !playlistButton ||
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
  playlistButton.addEventListener("click", () => {
    const trackIds = (queueSnapshot ?? []).flatMap((item) =>
      item.libraryTrackId ? [item.libraryTrackId] : [],
    );
    options.onAddToPlaylist(trackIds, playlistButton);
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
        cancelActiveReorder?.();
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
      playlistButton.disabled =
        state.queue.length === 0 ||
        state.queue.some((item) => !item.libraryTrackId);
      playlistButton.title =
        playlistButton.disabled && state.queue.length > 0
          ? "Every Queue track must be indexed in Library."
          : "Add the entire Queue to a playlist";
      clearRow.hidden = state.queue.length === 0;
      if (
        state.queueRevision === queueRevision &&
        state.queue === queueSnapshot
      )
        return;
      cancelActiveReorder?.();
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
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "queue-item__handle";
          handle.setAttribute("aria-label", "Reorder track");
          handle.textContent = "::";
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
          const beginReorder = (event: PointerEvent): void => {
            event.preventDefault();
            event.stopPropagation();
            cancelActiveReorder?.();
            const pointerId = event.pointerId;
            const startX = event.clientX;
            const startY = event.clientY;
            let latestClientY = startY;
            let dragging = false;
            let placeholder: HTMLLIElement | null = null;
            let animationFrame = 0;
            let rowOffsetY = 0;
            const initial = [...list.children] as HTMLLIElement[];
            const initialQueueIds = [
              ...list.querySelectorAll<HTMLLIElement>(".queue-item"),
            ].map((queueRow) => queueRow.dataset.queueItemId ?? "");
            const initialScrollTop = list.scrollTop;
            handle.setPointerCapture(pointerId);

            const restoreInitialOrder = (): void => {
              for (const child of initial) list.append(child);
              list.scrollTop = initialScrollTop;
            };

            const resetRow = (): void => {
              row.classList.remove("queue-item--dragging");
              row.style.removeProperty("top");
              row.style.removeProperty("left");
              row.style.removeProperty("width");
              row.style.removeProperty("height");
              placeholder?.remove();
              placeholder = null;
            };

            const positionPlaceholder = (): void => {
              if (!placeholder) return;
              const candidates = [
                ...list.querySelectorAll<HTMLLIElement>(
                  ".queue-item:not(.queue-item--dragging):not(.queue-item--placeholder)",
                ),
              ];
              const index = queueDropIndex(
                candidates.map((candidate) => {
                  const rect = candidate.getBoundingClientRect();
                  return rect.top + rect.height / 2;
                }),
                latestClientY,
              );
              const target = candidates[index];
              if (target) list.insertBefore(placeholder, target);
              else list.insertBefore(placeholder, clearRow);
            };

            const updateDraggedPosition = (): void => {
              row.style.top = `${String(latestClientY - rowOffsetY)}px`;
              positionPlaceholder();
            };

            const autoScroll = (): void => {
              if (!dragging) return;
              const bounds = list.getBoundingClientRect();
              const step = queueAutoScrollStep(
                latestClientY,
                bounds.top,
                bounds.bottom,
              );
              if (step !== 0) {
                const previous = list.scrollTop;
                list.scrollTop += step;
                if (list.scrollTop !== previous) positionPlaceholder();
              }
              animationFrame = window.requestAnimationFrame(autoScroll);
            };

            const activate = (): void => {
              if (dragging) return;
              dragging = true;
              const rect = row.getBoundingClientRect();
              rowOffsetY = latestClientY - rect.top;
              placeholder = document.createElement("li");
              placeholder.className = "queue-item queue-item--placeholder";
              placeholder.style.height = `${String(rect.height)}px`;
              placeholder.setAttribute("aria-hidden", "true");
              row.after(placeholder);
              row.classList.add("queue-item--dragging");
              row.style.top = `${String(rect.top)}px`;
              row.style.left = `${String(rect.left)}px`;
              row.style.width = `${String(rect.width)}px`;
              row.style.height = `${String(rect.height)}px`;
              animationFrame = window.requestAnimationFrame(autoScroll);
            };

            const move = (moveEvent: PointerEvent): void => {
              if (moveEvent.pointerId !== pointerId) return;
              latestClientY = moveEvent.clientY;
              if (
                !dragging &&
                shouldStartQueueDrag(
                  moveEvent.clientX - startX,
                  moveEvent.clientY - startY,
                )
              )
                activate();
              if (dragging) updateDraggedPosition();
            };

            const cleanup = (): void => {
              if (animationFrame) window.cancelAnimationFrame(animationFrame);
              animationFrame = 0;
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", drop);
              handle.removeEventListener("pointercancel", cancel);
              if (handle.hasPointerCapture(pointerId))
                handle.releasePointerCapture(pointerId);
              cancelActiveReorder = null;
            };

            const drop = (upEvent: PointerEvent): void => {
              if (upEvent.pointerId !== pointerId) return;
              cleanup();
              if (!dragging || !placeholder) {
                resetRow();
                return;
              }
              list.insertBefore(row, placeholder);
              resetRow();
              const rows = [
                ...list.querySelectorAll<HTMLLIElement>(".queue-item"),
              ];
              const toIndex = rows.indexOf(row);
              const nextQueueIds = rows.map(
                (queueRow) => queueRow.dataset.queueItemId ?? "",
              );
              if (
                toIndex < 0 ||
                nextQueueIds.every(
                  (queueItemId, index) =>
                    queueItemId === initialQueueIds[index],
                )
              )
                return;
              list.classList.add("queue-list--persisting");
              void options
                .onReorder(item.id, toIndex)
                .catch(() => {
                  restoreInitialOrder();
                })
                .finally(() => {
                  list.classList.remove("queue-list--persisting");
                });
            };

            const cancel = (cancelEvent?: PointerEvent): void => {
              if (cancelEvent && cancelEvent.pointerId !== pointerId) return;
              cleanup();
              resetRow();
              restoreInitialOrder();
            };

            cancelActiveReorder = () => {
              cancel();
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", drop);
            handle.addEventListener("pointercancel", cancel);
          };
          handle.addEventListener("pointerdown", beginReorder);
          row.append(handle, button, remove);
          view = {
            row,
            button,
            number,
            title,
            filename,
            remove,
            artwork,
            handle,
            artworkRevision: null,
            isCurrent: false,
          };
          rowViews.set(item.id, view);
        }
        view.row.dataset.queueIndex = String(item.index);
        view.row.dataset.queueItemId = item.id;
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
        view.button.disabled = item.available === false;
        view.row.classList.toggle(
          "queue-item--unavailable",
          item.available === false,
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
      cancelActiveReorder?.();
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
