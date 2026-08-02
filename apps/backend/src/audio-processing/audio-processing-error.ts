export type AudioProcessingErrorCode =
  | "INVALID_AUDIO_PROCESSING"
  | "FIXED_OUTPUT_CONFIRMATION_REQUIRED"
  | "POSITIVE_GAIN_CONFIRMATION_REQUIRED"
  | "FIXED_OUTPUT_LEVEL_LOCKED"
  | "FIXED_OUTPUT_POSITIVE_GAIN"
  | "AUDIO_PROCESSING_APPLY_FAILED";

export class AudioProcessingError extends Error {
  constructor(
    readonly code: AudioProcessingErrorCode,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AudioProcessingError";
  }
}
