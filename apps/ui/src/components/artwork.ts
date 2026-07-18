import type { ArtworkRef } from "../../../../packages/shared/src/player";
import { artworkUrl } from "../api/player-api-client";
import { icon } from "./icons";

const warned = new Set<string>();

export interface ArtworkView {
  readonly element: HTMLElement;
  update(artwork: ArtworkRef | null, alt: string): void;
  loadUrl(url: string, revision: string, alt?: string): Promise<void>;
  destroy(): void;
}

export function createArtwork(options: {
  readonly className: string;
  readonly decorative: boolean;
  readonly placeholderLabel?: string;
}): ArtworkView {
  const element = document.createElement("span");
  element.className = `artwork ${options.className}`;
  const placeholder = document.createElement("span");
  placeholder.className = "artwork__placeholder";
  placeholder.innerHTML = icon("album", "icon artwork__placeholder-icon");
  if (options.placeholderLabel) {
    const label = document.createElement("span");
    label.textContent = options.placeholderLabel;
    placeholder.append(label);
  }
  element.append(placeholder);

  let generation = 0;
  let currentRevision: string | null = null;
  let image: HTMLImageElement | null = null;
  let revealFrame: number | null = null;

  const clear = (): void => {
    if (revealFrame !== null) cancelAnimationFrame(revealFrame);
    revealFrame = null;
    image?.remove();
    image = null;
    currentRevision = null;
    element.classList.remove("artwork--loaded");
    placeholder.setAttribute("aria-hidden", "false");
  };

  const loadUrl = (url: string, revision: string, alt = ""): Promise<void> => {
    generation += 1;
    const requestGeneration = generation;
    clear();
    currentRevision = revision;
    const next = new Image();
    next.className = "artwork__image";
    next.alt = options.decorative ? "" : alt;
    next.decoding = "async";
    next.draggable = false;
    return new Promise<void>((resolve) => {
      const failed = (): void => {
        if (requestGeneration === generation) {
          clear();
          if (!warned.has(revision)) {
            warned.add(revision);
            console.warn("[artwork] image could not be loaded");
          }
        }
        resolve();
      };
      next.addEventListener("error", failed, { once: true });
      next.addEventListener(
        "load",
        () => {
          void next
            .decode()
            .catch(() => {
              // A completed load is still usable when decode() is unsupported.
            })
            .then(() => {
              if (
                requestGeneration !== generation ||
                currentRevision !== revision
              ) {
                resolve();
                return;
              }
              image = next;
              element.append(next);
              revealFrame = requestAnimationFrame(() => {
                revealFrame = null;
                if (requestGeneration === generation) {
                  element.classList.add("artwork--loaded");
                  placeholder.setAttribute("aria-hidden", "true");
                }
              });
              resolve();
            });
        },
        { once: true },
      );
      next.src = url;
    });
  };

  return {
    element,
    update(artwork, alt) {
      if (!artwork) {
        generation += 1;
        clear();
        return;
      }
      if (currentRevision === artwork.revision) {
        if (image && !options.decorative) image.alt = alt;
        return;
      }
      void loadUrl(artworkUrl(artwork), artwork.revision, alt);
    },
    loadUrl,
    destroy() {
      generation += 1;
      clear();
    },
  };
}

export class ArtworkPreloader {
  private generation = 0;
  private image: HTMLImageElement | null = null;
  private revision: string | null = null;

  preload(artwork: ArtworkRef | null): void {
    if ((artwork?.revision ?? null) === this.revision) return;
    this.generation += 1;
    this.image = null;
    this.revision = artwork?.revision ?? null;
    if (!artwork) return;
    const generation = this.generation;
    const image = new Image();
    image.decoding = "async";
    image.src = artworkUrl(artwork);
    image.addEventListener(
      "load",
      () => {
        if (generation === this.generation) this.image = image;
      },
      { once: true },
    );
  }

  destroy(): void {
    this.generation += 1;
    this.image = null;
    this.revision = null;
  }
}
