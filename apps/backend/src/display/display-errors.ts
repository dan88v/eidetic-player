export class DisplayPowerError extends Error {
  constructor(
    readonly code:
      | "INVALID_DISPLAY_REQUEST"
      | "DISPLAY_OPERATION_IN_PROGRESS"
      | "DISPLAY_STANDBY_UNAVAILABLE"
      | "DISPLAY_STANDBY_INHIBITED"
      | "DISPLAY_DIM_FAILED"
      | "DISPLAY_STANDBY_FAILED"
      | "DISPLAY_WAKE_FAILED",
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "DisplayPowerError";
  }
}
