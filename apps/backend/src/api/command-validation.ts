import type { RepeatMode } from "../../../../packages/shared/src/player.js";
import { PlayerError } from "../player/player-error.js";

export type PlayerCommand =
  | { readonly type: "open"; readonly paths: readonly string[] }
  | { readonly type: "seek"; readonly positionSeconds: number }
  | { readonly type: "volume"; readonly volume: number }
  | { readonly type: "mute"; readonly muted: boolean }
  | { readonly type: "shuffle"; readonly enabled: boolean }
  | { readonly type: "repeat"; readonly mode: RepeatMode }
  | { readonly type: "queue-play"; readonly index: number }
  | { readonly type: "empty" };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PlayerError("INVALID_BODY", "A JSON object is required.");
  return value as Record<string, unknown>;
}

export function validateCommandBody(
  type: PlayerCommand["type"],
  body: unknown,
): PlayerCommand {
  const value = record(body);
  switch (type) {
    case "open": {
      if (
        !Array.isArray(value.paths) ||
        value.paths.length === 0 ||
        value.paths.length > 500 ||
        !value.paths.every(
          (path) =>
            typeof path === "string" &&
            path.trim().length > 0 &&
            path.length <= 32_768,
        )
      )
        throw new PlayerError(
          "INVALID_PATHS",
          "paths must be a non-empty array of local file paths.",
        );
      return { type, paths: value.paths };
    }
    case "seek":
      if (
        typeof value.positionSeconds !== "number" ||
        !Number.isFinite(value.positionSeconds) ||
        value.positionSeconds < 0
      )
        throw new PlayerError(
          "INVALID_POSITION",
          "positionSeconds must be a finite non-negative number.",
        );
      return { type, positionSeconds: value.positionSeconds };
    case "volume":
      if (
        typeof value.volume !== "number" ||
        !Number.isFinite(value.volume) ||
        value.volume < 0 ||
        value.volume > 100
      )
        throw new PlayerError(
          "INVALID_VOLUME",
          "volume must be between 0 and 100.",
        );
      return { type, volume: value.volume };
    case "mute":
      if (typeof value.muted !== "boolean")
        throw new PlayerError("INVALID_MUTE", "muted must be a boolean.");
      return { type, muted: value.muted };
    case "shuffle":
      if (typeof value.enabled !== "boolean")
        throw new PlayerError("INVALID_SHUFFLE", "enabled must be a boolean.");
      return { type, enabled: value.enabled };
    case "repeat":
      if (value.mode !== "off" && value.mode !== "all" && value.mode !== "one")
        throw new PlayerError(
          "INVALID_REPEAT",
          "mode must be off, all, or one.",
        );
      return { type, mode: value.mode };
    case "queue-play":
      if (
        typeof value.index !== "number" ||
        !Number.isInteger(value.index) ||
        value.index < 0
      )
        throw new PlayerError(
          "INVALID_QUEUE_INDEX",
          "index must be a non-negative integer.",
        );
      return { type, index: value.index };
    case "empty":
      return { type };
  }
}
