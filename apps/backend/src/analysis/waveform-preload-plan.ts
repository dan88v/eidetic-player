export interface WaveformPreloadState {
  readonly currentPlayback?: {
    readonly playbackInstanceId: string;
  } | null;
  readonly explicitQueue?: readonly {
    readonly playbackInstanceId: string;
  }[];
  readonly queue: readonly { readonly id: string }[];
  readonly currentQueueIndex: number;
}

export interface WaveformPreloadIds {
  readonly currentId: string | null;
  readonly nextId: string | null;
}

export function waveformPreloadIds(
  state: WaveformPreloadState,
): WaveformPreloadIds {
  const legacyCurrent = state.queue[state.currentQueueIndex];
  return {
    currentId:
      state.currentPlayback?.playbackInstanceId ?? legacyCurrent?.id ?? null,
    nextId:
      state.explicitQueue?.[0]?.playbackInstanceId ??
      state.queue[state.currentQueueIndex + 1]?.id ??
      null,
  };
}
