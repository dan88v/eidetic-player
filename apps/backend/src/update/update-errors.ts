import type { UpdateReasonCode } from "../../../../packages/shared/src/update.js";

export class UpdateError extends Error {
  constructor(
    readonly code: UpdateReasonCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "UpdateError";
  }
}
