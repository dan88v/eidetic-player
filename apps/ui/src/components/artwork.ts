import type { ArtworkRef } from "../../../../packages/shared/src/player";
import { artworkUrl } from "../api/player-api-client";

const warned = new Set<string>();

interface CachedArtwork {
  readonly promise: Promise<HTMLImageElement>;
  image: HTMLImageElement | null;
}

class ArtworkDecodeCache {
  private readonly entries = new Map<string, CachedArtwork>();

  prepare(artwork: ArtworkRef): Promise<HTMLImageElement> {
    const existing = this.entries.get(artwork.revision);
    if (existing) {
      this.entries.delete(artwork.revision);
      this.entries.set(artwork.revision, existing);
      return existing.promise;
    }
    const url = artworkUrl(artwork);
    const image = new Image();
    image.decoding = "async";
    const entry: CachedArtwork = {
      image: null,
      promise: new Promise<HTMLImageElement>((resolve, reject) => {
        image.addEventListener(
          "error",
          () => {
            this.entries.delete(artwork.revision);
            reject(new Error("Artwork could not be loaded"));
          },
          { once: true },
        );
        image.addEventListener(
          "load",
          () => {
            void image
              .decode()
              .then(() => {
                entry.image = image;
                resolve(image);
              })
              .catch(reject);
          },
          { once: true },
        );
      }),
    };
    this.entries.set(artwork.revision, entry);
    image.src = url;
    while (this.entries.size > 4) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    return entry.promise;
  }

  ready(revision: string): HTMLImageElement | null {
    return this.entries.get(revision)?.image ?? null;
  }
}

const decodeCache = new ArtworkDecodeCache();

export interface ArtworkView {
  readonly element: HTMLElement;
  update(artwork: ArtworkRef | null, alt: string, generation?: number): void;
  loadUrl(url: string, revision: string, alt?: string): Promise<void>;
  destroy(): void;
}

export function createArtwork(options: {
  readonly className: string;
  readonly decorative: boolean;
}): ArtworkView {
  const element = document.createElement("span");
  element.className = `artwork ${options.className}`;
  const placeholder = document.createElement("span");
  placeholder.className = "artwork__placeholder";
  element.append(placeholder);

  let nonce = 0;
  let currentRevision: string | null = null;
  let currentGeneration = -1;
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

  const commit = async (
    template: HTMLImageElement,
    revision: string,
    alt: string,
    requestNonce: number,
  ): Promise<void> => {
    if (requestNonce !== nonce || currentRevision !== revision) return;
    const next = new Image();
    next.className = "artwork__image";
    next.alt = options.decorative ? "" : alt;
    next.decoding = "async";
    next.draggable = false;
    const loaded = new Promise<boolean>((resolve) => {
      next.addEventListener(
        "load",
        () => {
          resolve(true);
        },
        { once: true },
      );
      next.addEventListener(
        "error",
        () => {
          resolve(false);
        },
        { once: true },
      );
    });
    next.src = template.currentSrc || template.src;
    if (!(await loaded)) throw new Error("Artwork clone could not be loaded");
    await next.decode();
    if (requestNonce !== nonce || currentRevision !== revision) return;
    image?.remove();
    image = next;
    element.append(next);
    const animate =
      element.closest<HTMLElement>(".app-root")?.dataset.animations !==
        "false" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate) {
      element.classList.add("artwork--loaded");
      placeholder.setAttribute("aria-hidden", "true");
      if (import.meta.env.DEV)
        console.debug("[artwork]", {
          phase: "committed",
          revision,
          generation: currentGeneration,
          target: options.className,
          opacity: 1,
        });
      return;
    }
    revealFrame = requestAnimationFrame(() => {
      revealFrame = null;
      if (requestNonce !== nonce) return;
      element.classList.add("artwork--loaded");
      placeholder.setAttribute("aria-hidden", "true");
      if (import.meta.env.DEV)
        console.debug("[artwork]", {
          phase: "committed",
          revision,
          generation: currentGeneration,
          target: options.className,
          opacity: 1,
        });
    });
  };

  const loadUrl = (url: string, revision: string, alt = ""): Promise<void> => {
    nonce += 1;
    const requestNonce = nonce;
    clear();
    currentRevision = revision;
    const next = new Image();
    next.decoding = "async";
    return new Promise<void>((resolve) => {
      const failed = (): void => {
        if (requestNonce === nonce) clear();
        resolve();
      };
      next.addEventListener("error", failed, { once: true });
      next.addEventListener(
        "load",
        () => {
          void next
            .decode()
            .then(() => {
              void commit(next, revision, alt, requestNonce).then(
                resolve,
                failed,
              );
            })
            .catch(failed);
        },
        { once: true },
      );
      next.src = url;
    });
  };

  return {
    element,
    update(artwork, alt, generation = currentGeneration + 1) {
      if (
        generation === currentGeneration &&
        currentRevision === (artwork?.revision ?? null)
      ) {
        if (image && !options.decorative) image.alt = alt;
        return;
      }
      currentGeneration = generation;
      nonce += 1;
      const requestNonce = nonce;
      if (!artwork) {
        clear();
        return;
      }
      currentRevision = artwork.revision;
      const ready = decodeCache.ready(artwork.revision);
      if (ready) {
        clear();
        currentRevision = artwork.revision;
        if (import.meta.env.DEV)
          console.debug("[artwork]", {
            phase: "cache-hit",
            revision: artwork.revision,
            generation,
            target: options.className,
          });
        void commit(ready, artwork.revision, alt, requestNonce).catch(() => {
          if (requestNonce === nonce) clear();
        });
        return;
      }
      clear();
      currentRevision = artwork.revision;
      void decodeCache
        .prepare(artwork)
        .then((template) => {
          if (import.meta.env.DEV)
            console.debug("[artwork]", {
              phase: "cache-miss",
              revision: artwork.revision,
              generation,
              target: options.className,
            });
          return commit(template, artwork.revision, alt, requestNonce);
        })
        .catch(() => {
          if (requestNonce !== nonce) return;
          void decodeCache
            .prepare(artwork)
            .then((template) =>
              commit(template, artwork.revision, alt, requestNonce),
            )
            .catch(() => {
              if (requestNonce !== nonce) return;
              clear();
              if (!warned.has(artwork.revision)) {
                warned.add(artwork.revision);
                console.warn("[artwork] image could not be loaded");
              }
            });
        });
    },
    loadUrl,
    destroy() {
      nonce += 1;
      clear();
    },
  };
}

export class ArtworkPreloader {
  private generation = 0;
  private signature = "";

  preload(artworks: ArtworkRef | readonly (ArtworkRef | null)[] | null): void {
    const list: readonly (ArtworkRef | null)[] =
      artworks === null ? [] : "revision" in artworks ? [artworks] : artworks;
    const signature = list.map((artwork) => artwork?.revision ?? "").join(":");
    if (signature === this.signature) return;
    this.signature = signature;
    this.generation += 1;
    const generation = this.generation;
    for (const artwork of list) {
      if (!artwork) continue;
      void decodeCache.prepare(artwork).catch(() => {
        if (generation !== this.generation) return;
      });
    }
  }

  destroy(): void {
    this.generation += 1;
    this.signature = "";
  }
}
