import type {
  PlaybackContextQueueDecision,
  PlayerCommandRequestMetadata,
  RepeatMode,
} from "../../../../packages/shared/src/player.js";
import { PlayerError } from "../player/player-error.js";

interface CommandMetadata {
  readonly metadata?: PlayerCommandRequestMetadata;
}

export type PlayerCommand =
  | {
      readonly type: "open";
      readonly paths: readonly string[];
      readonly queueDecision?: PlaybackContextQueueDecision;
    }
  | ({
      readonly type: "seek";
      readonly positionSeconds: number;
    } & CommandMetadata)
  | ({ readonly type: "volume"; readonly volume: number } & CommandMetadata)
  | ({ readonly type: "mute"; readonly muted: boolean } & CommandMetadata)
  | { readonly type: "shuffle"; readonly enabled: boolean }
  | { readonly type: "repeat"; readonly mode: RepeatMode }
  | ({
      readonly type: "queue-play";
      readonly index: number;
      readonly queueItemId?: string;
    } & CommandMetadata)
  | { readonly type: "queue-append"; readonly paths: readonly string[] }
  | { readonly type: "queue-remove"; readonly queueItemId: string }
  | {
      readonly type: "queue-reorder";
      readonly queueItemId: string;
      readonly toIndex: number;
      readonly expectedQueueRevision?: number;
    }
  | ({
      readonly type: "play-pause" | "play" | "pause";
    } & CommandMetadata)
  | ({
      readonly type: "previous" | "next";
      readonly targetQueueItemId?: string | null;
    } & CommandMetadata)
  | { readonly type: "empty" };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PlayerError("INVALID_BODY", "A JSON object is required.");
  return value as Record<string, unknown>;
}

const queueEntryIdPattern =
  /^(?:explicit|queue)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function metadata(
  value: Record<string, unknown>,
): PlayerCommandRequestMetadata | undefined {
  if (
    value.intentId === undefined &&
    value.requestedAtMilliseconds === undefined
  )
    return undefined;
  if (
    (value.clientSessionId !== undefined &&
      (typeof value.clientSessionId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value.clientSessionId,
        ))) ||
    typeof value.intentId !== "number" ||
    !Number.isSafeInteger(value.intentId) ||
    value.intentId <= 0 ||
    typeof value.requestedAtMilliseconds !== "number" ||
    !Number.isFinite(value.requestedAtMilliseconds) ||
    value.requestedAtMilliseconds < 0
  )
    throw new PlayerError(
      "INVALID_COMMAND_INTENT",
      "Command intent metadata is invalid.",
    );
  return {
    ...(typeof value.clientSessionId === "string"
      ? { clientSessionId: value.clientSessionId }
      : {}),
    intentId: value.intentId,
    requestedAtMilliseconds: value.requestedAtMilliseconds,
  };
}

function optionalQueueItemId(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !queueEntryIdPattern.test(value))
    throw new PlayerError(
      "INVALID_QUEUE_ITEM",
      `${field} must be an opaque Queue item ID or null.`,
    );
  return value;
}

export function playbackContextQueueDecision(
  value: Record<string, unknown>,
): PlaybackContextQueueDecision | undefined {
  const policy = value.explicitQueuePolicy;
  const revision = value.expectedQueueRevision;
  if (policy === undefined && revision === undefined) return undefined;
  if (
    (policy !== "preserve" && policy !== "clear") ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    throw new PlayerError(
      "INVALID_QUEUE_POLICY",
      "A valid Explicit Queue policy and revision are required.",
    );
  return {
    explicitQueuePolicy: policy,
    expectedQueueRevision: revision,
  };
}

export function validateCommandBody(
  type: PlayerCommand["type"],
  body: unknown,
): PlayerCommand {
  const value = record(body);
  switch (type) {
    case "open":
    case "queue-append": {
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
      if (type === "open") {
        const queueDecision = playbackContextQueueDecision(value);
        return {
          type,
          paths: value.paths,
          ...(queueDecision ? { queueDecision } : {}),
        };
      }
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
      {
        const commandMetadata = metadata(value);
        return {
          type,
          positionSeconds: value.positionSeconds,
          ...(commandMetadata ? { metadata: commandMetadata } : {}),
        };
      }
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
      {
        const commandMetadata = metadata(value);
        return {
          type,
          volume: value.volume,
          ...(commandMetadata ? { metadata: commandMetadata } : {}),
        };
      }
    case "mute":
      if (typeof value.muted !== "boolean")
        throw new PlayerError("INVALID_MUTE", "muted must be a boolean.");
      {
        const commandMetadata = metadata(value);
        return {
          type,
          muted: value.muted,
          ...(commandMetadata ? { metadata: commandMetadata } : {}),
        };
      }
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
      if (
        value.queueItemId !== undefined &&
        (typeof value.queueItemId !== "string" ||
          !queueEntryIdPattern.test(value.queueItemId))
      )
        throw new PlayerError(
          "INVALID_QUEUE_ITEM",
          "queueItemId must be an opaque Queue item ID.",
        );
      {
        const commandMetadata = metadata(value);
        return {
          type,
          index: value.index,
          ...(typeof value.queueItemId === "string"
            ? { queueItemId: value.queueItemId }
            : {}),
          ...(commandMetadata ? { metadata: commandMetadata } : {}),
        };
      }
    case "queue-remove":
    case "queue-reorder":
      if (
        typeof value.queueItemId !== "string" ||
        !queueEntryIdPattern.test(value.queueItemId)
      )
        throw new PlayerError(
          "INVALID_QUEUE_ITEM",
          "queueItemId must be an opaque Queue item ID.",
        );
      if (type === "queue-reorder") {
        if (
          typeof value.toIndex !== "number" ||
          !Number.isInteger(value.toIndex) ||
          value.toIndex < 0
        )
          throw new PlayerError(
            "INVALID_QUEUE_INDEX",
            "toIndex must be a non-negative integer.",
          );
        if (
          value.expectedQueueRevision !== undefined &&
          (typeof value.expectedQueueRevision !== "number" ||
            !Number.isSafeInteger(value.expectedQueueRevision) ||
            value.expectedQueueRevision < 0)
        )
          throw new PlayerError(
            "INVALID_QUEUE_REVISION",
            "expectedQueueRevision must be a non-negative integer.",
          );
        return {
          type,
          queueItemId: value.queueItemId,
          toIndex: value.toIndex,
          ...(typeof value.expectedQueueRevision === "number"
            ? { expectedQueueRevision: value.expectedQueueRevision }
            : {}),
        };
      }
      return { type, queueItemId: value.queueItemId };
    case "empty":
      return { type };
    case "play-pause":
    case "play":
    case "pause": {
      const commandMetadata = metadata(value);
      return {
        type,
        ...(commandMetadata ? { metadata: commandMetadata } : {}),
      };
    }
    case "previous":
    case "next": {
      const commandMetadata = metadata(value);
      const targetQueueItemId = optionalQueueItemId(
        value.targetQueueItemId,
        "targetQueueItemId",
      );
      return {
        type,
        ...(targetQueueItemId !== undefined ? { targetQueueItemId } : {}),
        ...(commandMetadata ? { metadata: commandMetadata } : {}),
      };
    }
  }
}
