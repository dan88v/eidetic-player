export interface CassetteQueueEntry {
  readonly id: string;
  readonly durationSeconds?: number;
}

export interface CassetteProgressInput {
  readonly queue: readonly CassetteQueueEntry[];
  readonly currentQueueIndex: number;
  readonly positionSeconds: number;
  readonly currentDurationSeconds: number;
  readonly previewPositionSeconds?: number | null;
}

export interface CassetteProgress {
  readonly value: number;
  readonly confidence: "exact" | "estimated";
}

const NEUTRAL_UNKNOWN_DURATION_SECONDS = 180;

const finitePositive = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export function deriveCassetteProgress(
  input: CassetteProgressInput,
): CassetteProgress {
  const queueLength = input.queue.length;
  if (queueLength === 0) return { value: 0, confidence: "estimated" };
  const requestedIndex = Number.isFinite(input.currentQueueIndex)
    ? Math.trunc(input.currentQueueIndex)
    : 0;
  const currentIndex = Math.max(0, Math.min(queueLength - 1, requestedIndex));
  const currentDuration = finitePositive(input.currentDurationSeconds)
    ? input.currentDurationSeconds
    : input.queue[currentIndex]?.durationSeconds;
  const resolvedDurations = input.queue.map((item, index) =>
    index === currentIndex && finitePositive(currentDuration)
      ? currentDuration
      : item.durationSeconds,
  );
  const knownDurations = resolvedDurations.filter(finitePositive);
  const position = Math.max(
    0,
    input.previewPositionSeconds ?? input.positionSeconds,
  );

  if (knownDurations.length === 0) {
    const trackProgress = finitePositive(currentDuration)
      ? clamp01(position / currentDuration)
      : 0;
    return {
      value: clamp01((currentIndex + trackProgress) / queueLength),
      confidence: "estimated",
    };
  }

  const fallbackDuration =
    median(knownDurations) ??
    (finitePositive(currentDuration)
      ? currentDuration
      : NEUTRAL_UNKNOWN_DURATION_SECONDS);
  let elapsed = 0;
  let total = 0;
  for (let index = 0; index < queueLength; index += 1) {
    const duration = finitePositive(resolvedDurations[index])
      ? (resolvedDurations[index] ?? fallbackDuration)
      : fallbackDuration;
    total += duration;
    if (index < currentIndex) elapsed += duration;
    else if (index === currentIndex) elapsed += Math.min(duration, position);
  }
  return {
    value: total > 0 ? clamp01(elapsed / total) : 0,
    confidence: knownDurations.length === queueLength ? "exact" : "estimated",
  };
}
