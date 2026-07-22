import type { PlayerState } from "../../../../packages/shared/src/player.js";

export interface PlayHistorySink {
  recordPlayHistory(
    trackId: string,
    playedSeconds: number,
    completed: boolean,
    playedAt?: number,
  ): { readonly historyId: string; readonly created: boolean } | null;
  updatePlayHistory(
    historyId: string,
    playedSeconds: number,
    completed: boolean,
    playedAt?: number,
  ): boolean;
  recordQualifiedPlay(
    trackId: string,
    playedSeconds: number,
    completed: boolean,
    playedAt?: number,
  ): boolean;
  updateQualifiedPlay(
    trackId: string,
    playedSecondsDelta: number,
    completedIncrement: boolean,
    playedAt?: number,
  ): boolean;
}

interface Candidate {
  readonly identity: string;
  readonly trackId: string;
  durationSeconds: number | null;
  playedSeconds: number;
  lastPositionSeconds: number;
  lastObservedMilliseconds: number;
  wasPlaying: boolean;
  historyId: string | null;
  completed: boolean;
  lastPersistedPlayedSeconds: number;
  lastPersistedCompleted: boolean;
  ignoreNextAdvance: boolean;
  statsQualified: boolean;
  statsLastPersistedPlayedSeconds: number;
  statsCompletionPersisted: boolean;
}

const MAX_NATURAL_DELTA_SECONDS = 2.5;
const POSITION_DELTA_TOLERANCE_SECONDS = 0.75;

export class PlayHistoryTracker {
  private candidate: Candidate | null = null;

  constructor(
    private readonly sink: PlayHistorySink,
    private readonly wallClock: () => number = Date.now,
  ) {}

  observe(
    state: PlayerState,
    monotonicMilliseconds: number,
    naturalEnd = false,
  ): void {
    const item = state.queue[state.currentQueueIndex];
    const trackId = item?.libraryTrackId;
    const identity = trackId
      ? `${state.playerSessionId}:${String(state.trackTransitionId)}:${trackId}`
      : null;
    if (!identity || !trackId) {
      this.finalize();
      this.candidate = null;
      return;
    }
    if (this.candidate?.identity !== identity) {
      this.finalize();
      this.candidate = {
        identity,
        trackId,
        durationSeconds: this.duration(state.durationSeconds),
        playedSeconds: 0,
        lastPositionSeconds: this.position(state.positionSeconds),
        lastObservedMilliseconds: monotonicMilliseconds,
        wasPlaying: this.isPlaying(state),
        historyId: null,
        completed: false,
        lastPersistedPlayedSeconds: 0,
        lastPersistedCompleted: false,
        ignoreNextAdvance: false,
        statsQualified: false,
        statsLastPersistedPlayedSeconds: 0,
        statsCompletionPersisted: false,
      };
      return;
    }

    const candidate = this.candidate;
    const position = this.position(state.positionSeconds);
    const positionDelta = position - candidate.lastPositionSeconds;
    const wallDelta = Math.max(
      0,
      (monotonicMilliseconds - candidate.lastObservedMilliseconds) / 1_000,
    );
    if (
      !candidate.ignoreNextAdvance &&
      candidate.wasPlaying &&
      wallDelta > 0 &&
      wallDelta <= MAX_NATURAL_DELTA_SECONDS &&
      positionDelta > 0 &&
      positionDelta <= MAX_NATURAL_DELTA_SECONDS &&
      positionDelta <= wallDelta + POSITION_DELTA_TOLERANCE_SECONDS
    )
      candidate.playedSeconds += positionDelta;
    candidate.ignoreNextAdvance = false;

    candidate.durationSeconds =
      this.duration(state.durationSeconds) ?? candidate.durationSeconds;
    candidate.lastPositionSeconds = position;
    candidate.lastObservedMilliseconds = monotonicMilliseconds;
    candidate.wasPlaying = this.isPlaying(state);
    const completed =
      naturalEnd ||
      (candidate.durationSeconds !== null &&
        position >= candidate.durationSeconds * 0.9);
    candidate.completed ||= completed;

    if (
      candidate.historyId === null &&
      candidate.playedSeconds >= this.threshold(candidate.durationSeconds)
    ) {
      const event = this.sink.recordPlayHistory(
        candidate.trackId,
        candidate.playedSeconds,
        candidate.completed,
        this.wallClock(),
      );
      if (event) {
        candidate.historyId = event.historyId;
        candidate.lastPersistedPlayedSeconds = candidate.playedSeconds;
        candidate.lastPersistedCompleted = candidate.completed;
        candidate.statsQualified = this.sink.recordQualifiedPlay(
          candidate.trackId,
          candidate.playedSeconds,
          candidate.completed,
          this.wallClock(),
        );
        if (candidate.statsQualified) {
          candidate.statsLastPersistedPlayedSeconds = candidate.playedSeconds;
          candidate.statsCompletionPersisted = candidate.completed;
        }
      }
      return;
    }
    if (
      candidate.historyId !== null &&
      candidate.completed &&
      !candidate.lastPersistedCompleted
    ) {
      this.persist(candidate);
    }
  }

  stop(): void {
    this.finalize();
    this.candidate = null;
  }

  noteSeek(state: PlayerState, monotonicMilliseconds: number): void {
    const candidate = this.candidate;
    const item = state.queue[state.currentQueueIndex];
    if (!candidate || item?.libraryTrackId !== candidate.trackId) return;
    candidate.lastPositionSeconds = this.position(state.positionSeconds);
    candidate.lastObservedMilliseconds = monotonicMilliseconds;
    candidate.wasPlaying = this.isPlaying(state);
    candidate.ignoreNextAdvance = true;
  }

  private finalize(): void {
    const candidate = this.candidate;
    if (
      candidate?.historyId &&
      (candidate.playedSeconds !== candidate.lastPersistedPlayedSeconds ||
        candidate.completed !== candidate.lastPersistedCompleted)
    )
      this.persist(candidate);
  }

  private persist(candidate: Candidate): void {
    if (!candidate.historyId) return;
    const updated = this.sink.updatePlayHistory(
      candidate.historyId,
      candidate.playedSeconds,
      candidate.completed,
      this.wallClock(),
    );
    if (updated) {
      candidate.lastPersistedPlayedSeconds = candidate.playedSeconds;
      candidate.lastPersistedCompleted = candidate.completed;
    }
    if (candidate.statsQualified) {
      const playedSecondsDelta = Math.max(
        0,
        candidate.playedSeconds - candidate.statsLastPersistedPlayedSeconds,
      );
      const completedIncrement =
        candidate.completed && !candidate.statsCompletionPersisted;
      if (
        (playedSecondsDelta > 0 || completedIncrement) &&
        this.sink.updateQualifiedPlay(
          candidate.trackId,
          playedSecondsDelta,
          completedIncrement,
          this.wallClock(),
        )
      ) {
        candidate.statsLastPersistedPlayedSeconds = candidate.playedSeconds;
        candidate.statsCompletionPersisted ||= completedIncrement;
      }
    }
  }

  private threshold(durationSeconds: number | null): number {
    return durationSeconds === null ? 30 : Math.min(30, durationSeconds * 0.5);
  }

  private duration(value: number): number | null {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private position(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  private isPlaying(state: PlayerState): boolean {
    return state.status === "playing" && !state.paused;
  }
}
