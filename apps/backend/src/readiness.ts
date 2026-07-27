import type { ReadinessResponse } from "../../../packages/shared/src/health.js";
import {
  unknownBuildInfo,
  type BuildInfo,
} from "../../../packages/shared/src/system.js";

export type BootstrapReadiness = "starting" | "ready" | "degraded";

export interface ReadinessContext {
  readonly bootstrapStatus: BootstrapReadiness;
  readonly playerStatus: string;
  readonly mpvAvailable: boolean;
  readonly playerErrorCode: string | null;
  readonly bootstrapErrorCode: string | null;
  readonly buildInfo?: BuildInfo;
}

export function buildReadinessResponse(
  context: ReadinessContext,
): ReadinessResponse {
  const buildInfo = context.buildInfo ?? unknownBuildInfo;
  if (context.bootstrapStatus === "starting") {
    return {
      status: "starting",
      playerStatus: context.playerStatus,
      mpvAvailable: context.mpvAvailable,
      buildInfo,
    };
  }

  const errorCode = context.bootstrapErrorCode ?? context.playerErrorCode;
  if (errorCode) {
    return {
      status: "degraded",
      playerStatus: context.playerStatus,
      mpvAvailable: context.mpvAvailable,
      errorCode,
      buildInfo,
    };
  }

  return {
    status: "ready",
    playerStatus: context.playerStatus,
    mpvAvailable: context.mpvAvailable,
    errorCode: null,
    buildInfo,
  };
}
