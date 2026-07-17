export function isCurrentEnrichment(
  expectedGeneration: number,
  currentGeneration: number,
  expectedPathKey: string,
  currentPathKey: string | null,
): boolean {
  return (
    expectedGeneration === currentGeneration &&
    expectedPathKey === currentPathKey
  );
}
