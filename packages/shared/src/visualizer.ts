export interface VisualizerFrame {
  readonly trackId: string | null;
  readonly positionSeconds: number;
  readonly sequence: number;
  readonly meter: {
    readonly leftPeak: number;
    readonly leftRms: number;
    readonly rightPeak: number;
    readonly rightRms: number;
  };
  readonly monoBands: readonly number[];
  readonly leftBands: readonly number[];
  readonly rightBands: readonly number[];
  readonly source: "live" | "fallback";
}

export interface WaveformResponse {
  readonly queueItemId: string;
  readonly fingerprint: string;
  readonly points: readonly number[];
  readonly status: "ready" | "processing" | "unavailable";
  readonly source: "real" | "fallback";
}
