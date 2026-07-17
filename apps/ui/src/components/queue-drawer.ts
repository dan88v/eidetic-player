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
  update(state: PlayerState): void;
  destroy(): void;
}

export function createQueueDrawer(options: {
  readonly onClose: () => void;
  readonly onPlay: (index: number) => void;
}): QueueDrawer {
  let returnFocus: HTMLElement | null = null;
  let isOpen = false;
  let queueSignature = "";
  let loadGeneration = 0;
  let activeLoads = 0;
  const pendingLoads: {
    readonly id: string;
    readonly view: ArtworkView;
    readonly generation: number;
  }[] = [];
  const queuedIds = new Set<string>();
  const artworkViews = new Map<string, ArtworkView>();
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
    <ol class="queue-list"></ol>`;
  const closeButton = element.querySelector<HTMLButtonElement>(
    ".queue-drawer__close",
  );
  const list = element.querySelector<HTMLOListElement>(".queue-list");
  if (!closeButton || !list) throw new Error("Queue drawer is incomplete");
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
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const row = entry.target as HTMLElement;
        const id = row.dataset.queueArtworkId;
        const view = id ? artworkViews.get(id) : null;
        if (!id || !view || queuedIds.has(id)) continue;
        observer.unobserve(row);
        queuedIds.add(id);
        pendingLoads.push({ id, view, generation: loadGeneration });
      }
      runLoads();
    },
    { root: list, rootMargin: "120px 0px" },
  );
  const observeLazyRows = (): void => {
    if (!isOpen) return;
    for (const row of list.querySelectorAll<HTMLElement>(
      "[data-queue-artwork-id]",
    ))
      observer.observe(row);
  };
  closeButton.addEventListener("click", options.onClose);
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
        ...element.querySelectorAll<HTMLElement>(focusableSelector),
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
    update(state) {
      const signature = state.queue
        .map(
          (item) =>
            `${item.id}:${item.displayTitle}:${String(item.isCurrent)}:${item.artwork?.revision ?? ""}`,
        )
        .join("|");
      if (signature === queueSignature) return;
      queueSignature = signature;
      loadGeneration += 1;
      observer.disconnect();
      pendingLoads.length = 0;
      queuedIds.clear();
      for (const view of artworkViews.values()) view.destroy();
      artworkViews.clear();
      list.replaceChildren();
      if (state.queue.length === 0) {
        const empty = document.createElement("li");
        empty.className = "queue-list__empty";
        empty.textContent = t("queueDrawer.empty");
        list.append(empty);
        return;
      }
      for (const item of state.queue) {
        const row = document.createElement("li");
        row.className = `queue-item${item.isCurrent ? " queue-item--current" : ""}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "queue-item__button";
        button.setAttribute(
          "aria-label",
          `${t("queueDrawer.play")} ${item.displayTitle}`,
        );
        const number = document.createElement("span");
        number.className = "queue-item__index";
        number.innerHTML = item.isCurrent
          ? icon("nowPlaying")
          : String(item.index + 1);
        const artwork = createArtwork({
          className: "queue-item__artwork",
          decorative: true,
        });
        artworkViews.set(item.id, artwork);
        if (item.artwork) artwork.update(item.artwork, "");
        else row.dataset.queueArtworkId = item.id;
        const copy = document.createElement("span");
        copy.className = "queue-item__copy";
        const title = document.createElement("strong");
        title.textContent = item.displayTitle;
        const filename = document.createElement("span");
        filename.textContent = item.filename;
        copy.append(title, filename);
        button.append(number, artwork.element, copy);
        button.addEventListener("click", () => {
          options.onPlay(item.index);
        });
        row.append(button);
        list.append(row);
      }
      observeLazyRows();
    },
    destroy() {
      isOpen = false;
      loadGeneration += 1;
      observer.disconnect();
      pendingLoads.length = 0;
      queuedIds.clear();
      for (const view of artworkViews.values()) view.destroy();
      artworkViews.clear();
    },
  };
}
