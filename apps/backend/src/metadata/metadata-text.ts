export const METADATA_TEXT_MAX_LENGTH = 512;

const whitespace = /\s+/gu;
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

function replaceUnsafeControls(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    result +=
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
        ? " "
        : character;
  }
  return result;
}

export function normalizeMetadataText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = replaceUnsafeControls(value)
    .replace(whitespace, " ")
    .trim();
  if (!normalized) return null;
  return Array.from(
    graphemeSegmenter.segment(normalized),
    ({ segment }) => segment,
  )
    .slice(0, METADATA_TEXT_MAX_LENGTH)
    .join("");
}
