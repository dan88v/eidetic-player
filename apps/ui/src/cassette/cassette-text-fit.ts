export interface CassetteTextFitOptions {
  readonly maxWidth: number;
  readonly minFontSize: number;
  readonly maxFontSize: number;
  readonly iterations?: number;
}

export interface CassetteTextFitResult {
  readonly text: string;
  readonly fontSize: number;
  readonly truncated: boolean;
}

export type CassetteTextMeasure = (text: string, fontSize: number) => number;

export function normalizeCassetteMetadata(value: string | null): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function normalizeCassetteArtist(value: string | null): string {
  const artist = normalizeCassetteMetadata(value);
  return artist === "Unknown Artist" ? "" : artist;
}

export function normalizeCassetteAlbum(value: string | null): string {
  const album = normalizeCassetteMetadata(value);
  return album === "Unknown Album" ? "" : album;
}

export function resolveCassetteMetadataLine(
  artist: string | null,
  album: string | null,
): string {
  return [normalizeCassetteArtist(artist), normalizeCassetteAlbum(album)]
    .filter(Boolean)
    .join(" - ");
}

export function fitCassetteText(
  value: string,
  options: CassetteTextFitOptions,
  measure: CassetteTextMeasure,
): CassetteTextFitResult {
  const text = normalizeCassetteMetadata(value);
  const minFontSize = Math.max(1, options.minFontSize);
  const maxFontSize = Math.max(minFontSize, options.maxFontSize);
  const maxWidth = Math.max(0, options.maxWidth);
  if (!text) return { text: "", fontSize: maxFontSize, truncated: false };
  if (measure(text, maxFontSize) <= maxWidth)
    return { text, fontSize: maxFontSize, truncated: false };

  if (measure(text, minFontSize) <= maxWidth) {
    let low = minFontSize;
    let high = maxFontSize;
    const iterations = Math.max(1, Math.min(12, options.iterations ?? 9));
    for (let index = 0; index < iterations; index += 1) {
      const middle = (low + high) / 2;
      if (measure(text, middle) <= maxWidth) low = middle;
      else high = middle;
    }
    return {
      text,
      fontSize: Math.floor(low * 100) / 100,
      truncated: false,
    };
  }

  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join("").trimEnd()}…`;
    if (measure(candidate, minFontSize) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  const prefix = characters.slice(0, low).join("").trimEnd();
  const fittedText = prefix ? `${prefix}…` : "…";
  return {
    text: measure(fittedText, minFontSize) <= maxWidth ? fittedText : "",
    fontSize: minFontSize,
    truncated: true,
  };
}
