import type { ReadinessResponse } from "../../../packages/shared/src/health.js";

export type BootstrapReadiness = "starting" | "ready" | "degraded";

export interface ReadinessContext {
  readonly bootstrapStatus: BootstrapReadiness;
  readonly playerStatus: string;
  readonly mpvAvailable: boolean;
  readonly playerErrorCode: string | null;
  readonly bootstrapErrorCode: string | null;
}

export function buildReadinessResponse(
  context: ReadinessContext,
): ReadinessResponse {
  if (context.bootstrapStatus === "starting") {
    return {
      status: "starting",
      playerStatus: context.playerStatus,
      mpvAvailable: context.mpvAvailable,
    };
  }

  const errorCode = context.bootstrapErrorCode ?? context.playerErrorCode;
  if (errorCode) {
    return {
      status: "degraded",
      playerStatus: context.playerStatus,
      mpvAvailable: context.mpvAvailable,
      errorCode,
    };
  }

  return {
    status: "ready",
    playerStatus: context.playerStatus,
    mpvAvailable: context.mpvAvailable,
    errorCode: null,
  };
}
