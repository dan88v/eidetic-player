import {
  CASSETTE_METADATA_LABEL_AREA,
  CASSETTE_VIEWBOX_HEIGHT,
  CASSETTE_VIEWBOX_WIDTH,
} from "./cassette-geometry";
import { loadCassetteFonts } from "./cassette-fonts";
import {
  fitCassetteText,
  normalizeCassetteAlbum,
  normalizeCassetteArtist,
  resolveCassetteMetadataLine,
} from "./cassette-text-fit";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export interface CassetteMetadataSnapshot {
  readonly queueItemId: string | null;
  readonly trackTransitionId: number;
  readonly artist: string | null;
  readonly album: string | null;
}

export interface CassetteMetadataLayer {
  readonly element: SVGSVGElement;
  readonly artist: string;
  readonly album: string;
  update(snapshot: CassetteMetadataSnapshot): boolean;
  destroy(): void;
}

const createText = (className: string): SVGTextElement => {
  const text = document.createElementNS(SVG_NAMESPACE, "text");
  text.classList.add("cassette-player__metadata-text", className);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  return text;
};

export function createCassetteMetadataLayer(): CassetteMetadataLayer {
  let destroyed = false;
  let currentArtist = "";
  let currentAlbum = "";
  let currentKey = "";
  const element = document.createElementNS(SVG_NAMESPACE, "svg");
  element.classList.add("cassette-player__metadata-layer");
  element.setAttribute(
    "viewBox",
    `0 0 ${String(CASSETTE_VIEWBOX_WIDTH)} ${String(CASSETTE_VIEWBOX_HEIGHT)}`,
  );
  element.setAttribute("preserveAspectRatio", "xMidYMid meet");
  element.setAttribute("aria-hidden", "true");
  element.dataset.fontReady = "false";
  const metadataText = createText("cassette-player__metadata-line");
  element.append(metadataText);

  const renderText = (
    target: SVGTextElement,
    value: string,
    y: number,
    minFontSize: number,
    maxFontSize: number,
  ): void => {
    if (!value) {
      target.textContent = "";
      return;
    }
    const fit = fitCassetteText(
      value,
      {
        maxWidth:
          CASSETTE_METADATA_LABEL_AREA.width -
          CASSETTE_METADATA_LABEL_AREA.padding * 2,
        minFontSize,
        maxFontSize,
      },
      (candidate, fontSize) => {
        target.textContent = candidate;
        target.style.fontSize = `${String(fontSize)}px`;
        return target.getComputedTextLength();
      },
    );
    target.textContent = fit.text;
    target.style.fontSize = `${String(fit.fontSize)}px`;
    target.setAttribute(
      "x",
      String(
        CASSETTE_METADATA_LABEL_AREA.x + CASSETTE_METADATA_LABEL_AREA.width / 2,
      ),
    );
    target.setAttribute("y", String(y));
    target.dataset.truncated = String(fit.truncated);
  };

  const render = (): void => {
    const centerY =
      CASSETTE_METADATA_LABEL_AREA.y + CASSETTE_METADATA_LABEL_AREA.height / 2;
    renderText(
      metadataText,
      resolveCassetteMetadataLine(currentArtist, currentAlbum),
      centerY,
      14,
      40,
    );
  };

  void loadCassetteFonts().then(() => {
    if (destroyed) return;
    element.dataset.fontReady = "true";
    render();
  });

  return {
    element,
    get artist() {
      return currentArtist;
    },
    get album() {
      return currentAlbum;
    },
    update(snapshot) {
      const artist = normalizeCassetteArtist(snapshot.artist);
      const album = normalizeCassetteAlbum(snapshot.album);
      const key = [
        snapshot.queueItemId ?? "",
        String(snapshot.trackTransitionId),
        artist,
        album,
      ].join("\u0000");
      if (key === currentKey) return false;
      currentKey = key;
      currentArtist = artist;
      currentAlbum = album;
      render();
      return true;
    },
    destroy() {
      destroyed = true;
    },
  };
}
