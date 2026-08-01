export interface WaveformRequestIdentity {
  readonly queueItemId: string | null;
  readonly trackGeneration: number;
}

export function isSameWaveformRequest(
  current: WaveformRequestIdentity,
  next: WaveformRequestIdentity,
): boolean {
  return (
    current.queueItemId === next.queueItemId &&
    current.trackGeneration === next.trackGeneration
  );
}
