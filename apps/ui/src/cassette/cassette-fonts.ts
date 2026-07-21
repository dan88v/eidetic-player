export const CASSETTE_METADATA_FONT_FAMILY = "Eidetic Nothing You Could Do";
export const CASSETTE_TIME_FONT_FAMILY = "Eidetic Bitcount Single";

let fontLoadPromise: Promise<boolean> | null = null;

export function loadCassetteFonts(): Promise<boolean> {
  if (fontLoadPromise) return fontLoadPromise;
  fontLoadPromise = Promise.all([
    document.fonts.load(`16px "${CASSETTE_METADATA_FONT_FAMILY}"`),
    document.fonts.load(`16px "${CASSETTE_TIME_FONT_FAMILY}"`),
  ])
    .then(([metadataFaces, timeFaces]) =>
      Boolean(metadataFaces.length && timeFaces.length),
    )
    .catch(() => false);
  return fontLoadPromise;
}
