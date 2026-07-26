export type AudioOutputErrorCode =
  | "INVALID_AUDIO_OUTPUT"
  | "AUDIO_OUTPUT_NOT_AVAILABLE"
  | "AUDIO_OUTPUT_SWITCH_FAILED"
  | "AUDIO_OUTPUT_REFRESH_FAILED"
  | "MPV_NOT_AVAILABLE";

export class AudioOutputError extends Error {
  constructor(
    readonly code: AudioOutputErrorCode,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AudioOutputError";
  }
}
