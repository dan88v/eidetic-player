export type PlayerStatus =
  | "unavailable"
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "stopped"
  | "error";

export type RepeatMode = "off" | "all" | "one";

export interface ArtworkRef {
  readonly id: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly sourceType: "embedded" | "folder";
  readonly revision: string;
}

export interface PlayerTrack {
  readonly path: string;
  readonly filename: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly artists: readonly string[];
  readonly albumArtist: string | null;
  readonly trackNumber: number | null;
  readonly trackTotal: number | null;
  readonly discNumber: number | null;
  readonly discTotal: number | null;
  readonly year: number | null;
  readonly genre: readonly string[];
  readonly durationSeconds: number;
  readonly format: string;
  readonly codec: string | null;
  readonly sampleRate: number | null;
  readonly bitDepth: number | null;
  readonly bitrate: number | null;
  readonly lossless: boolean | null;
  readonly container: string | null;
  readonly artwork: ArtworkRef | null;
  readonly source: "Local File";
}

export interface QueueItem {
  readonly id: string;
  readonly index: number;
  readonly path: string;
  readonly filename: string;
  readonly displayTitle: string;
  readonly artwork: ArtworkRef | null;
  readonly isCurrent: boolean;
}

export interface PlayerErrorState {
  readonly code: string;
  readonly message: string;
}

export interface PlayerState {
  readonly status: PlayerStatus;
  readonly mpvAvailable: boolean;
  readonly mpvVersion: string | null;
  readonly currentTrack: PlayerTrack | null;
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly paused: boolean;
  readonly volume: number;
  readonly muted: boolean;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: RepeatMode;
  readonly currentQueueIndex: number;
  readonly queue: readonly QueueItem[];
  readonly queueRevision: number;
  readonly audioDevice: string;
  readonly error: PlayerErrorState | null;
}

export interface ApiSuccess<T = undefined> {
  readonly ok: true;
  readonly data?: T;
}

export interface ApiFailure {
  readonly ok: false;
  readonly error: PlayerErrorState;
}

export type ApiResponse<T = undefined> = ApiSuccess<T> | ApiFailure;
