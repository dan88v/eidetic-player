export const CASSETTE_FRAME_URL =
  "/assets/main-player/cassette/cassette-frame.png";
export const CASSETTE_FRAME_WIDTH = 1_070;
export const CASSETTE_FRAME_HEIGHT = 710;

let framePromise: Promise<HTMLImageElement> | null = null;

export async function decodeCassetteFrame(
  image: HTMLImageElement,
): Promise<HTMLImageElement> {
  image.decoding = "async";
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.className = "cassette-player__frame";
  image.src = CASSETTE_FRAME_URL;
  await image.decode();
  if (
    image.naturalWidth !== CASSETTE_FRAME_WIDTH ||
    image.naturalHeight !== CASSETTE_FRAME_HEIGHT
  )
    throw new Error("Cassette frame geometry is invalid");
  return image;
}

export function loadCassetteFrame(): Promise<HTMLImageElement> {
  framePromise ??= decodeCassetteFrame(new Image());
  return framePromise;
}

export type CassetteRendererLevel = "premium" | "prototype" | "default";

export function nextCassetteFallback(
  current: CassetteRendererLevel,
): CassetteRendererLevel {
  return current === "premium"
    ? "prototype"
    : current === "prototype"
      ? "default"
      : "default";
}
