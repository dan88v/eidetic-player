import type { VisualizerMode } from "../state/types";

export interface VisualizerSnapshot {
  readonly meter: readonly number[];
  readonly mono: readonly number[];
  readonly left: readonly number[];
  readonly right: readonly number[];
}

const snapshots = new Map<string, VisualizerSnapshot>();

export function visualizerSnapshotKey(
  queueItemId: string,
  trackTransitionId: number,
  mode: VisualizerMode,
): string {
  return `${String(trackTransitionId)}:${queueItemId}:${mode}`;
}

export function readVisualizerSnapshot(key: string): VisualizerSnapshot | null {
  return snapshots.get(key) ?? null;
}

export function saveVisualizerSnapshot(
  key: string,
  snapshot: VisualizerSnapshot,
): void {
  snapshots.set(key, snapshot);
  while (snapshots.size > 8) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
}
