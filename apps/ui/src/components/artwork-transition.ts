export function shouldRetainArtworkImage(
  currentRevision: string | null,
  nextRevision: string | null,
  hasDecodedImage: boolean,
): boolean {
  return (
    hasDecodedImage &&
    currentRevision !== null &&
    currentRevision === nextRevision
  );
}
