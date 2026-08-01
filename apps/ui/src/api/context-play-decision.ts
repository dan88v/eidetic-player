import type { PlaybackContextQueueDecision } from "../../../../packages/shared/src/player";

export type ContextPlayDecisionProvider =
  () => Promise<PlaybackContextQueueDecision | null>;
