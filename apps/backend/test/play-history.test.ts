import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PlayerState } from "../../../packages/shared/src/player.js";
import { LibraryDatabase } from "../src/library/library-database.js";
import { trackIdentity } from "../src/library/library-normalization.js";
import { LibraryRepository } from "../src/library/library-repository.js";
import {
  PlayHistoryTracker,
  type PlayHistorySink,
} from "../src/library/play-history-tracker.js";
import type { IndexedTrackInput } from "../src/library/library-types.js";
import { emptyMetadata } from "../src/metadata/metadata-service.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const nowIso = "2026-07-22T08:00:00.000Z";

async function repositoryFixture(): Promise<{
  readonly temporary: string;
  readonly database: LibraryDatabase;
  readonly repository: LibraryRepository;
  readonly tracks: readonly IndexedTrackInput[];
}> {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-history-"));
  const database = await LibraryDatabase.open(join(temporary, "library.db"));
  const repository = new LibraryRepository(database);
  repository.syncConfiguredSources([
    {
      id: sourceId,
      type: "local",
      displayName: "History fixture",
      nativeRoot: temporary,
      canonicalRoot: temporary,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ]);
  const run = repository.beginScan(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceId,
    nowIso,
  );
  const tracks = ["One", "Two", "Three"].map((title, index) => {
    const relativePath = `${title}.flac`;
    return {
      id: trackIdentity(sourceId, relativePath),
      sourceId,
      relativePath,
      filename: relativePath,
      extension: "flac",
      size: 1_000 + index,
      mtimeMs: 2_000 + index,
      generation: run.generation,
      seenAt: nowIso,
      metadata: { ...emptyMetadata, title, durationSeconds: 120 },
      metadataState: "parsed" as const,
      metadataErrorCode: null,
      artworkAvailable: false,
    } satisfies IndexedTrackInput;
  });
  repository.applyScanBatch(tracks, []);
  return { temporary, database, repository, tracks };
}

void test("play history groups only consecutive duplicates and pages newest first", async () => {
  const { temporary, database, repository, tracks } = await repositoryFixture();
  try {
    const [one, two] = tracks;
    assert.ok(one && two);
    const first = repository.recordPlayHistory(one.id, 30, false, 1_000);
    const consecutive = repository.recordPlayHistory(one.id, 40, true, 2_000);
    assert.equal(consecutive?.historyId, first?.historyId);
    assert.equal(consecutive?.created, false);
    const newestConsecutive = repository.recordPlayHistory(
      one.id,
      20,
      false,
      2_500,
    );
    assert.equal(newestConsecutive?.historyId, first?.historyId);
    assert.equal(repository.recentlyPlayed(null, 1).items[0]?.completed, false);
    repository.recordPlayHistory(two.id, 25, false, 3_000);
    repository.recordPlayHistory(one.id, 31, false, 4_000);
    const page = repository.recentlyPlayed(null, 2);
    assert.equal(page.total, 3);
    assert.equal(page.availableCount, 3);
    assert.deepEqual(
      page.items.map((item) => item.id),
      [one.id, two.id],
    );
    assert.ok(page.nextCursor);
    assert.equal(repository.recentlyPlayed(page.nextCursor, 2).items.length, 1);
    assert.equal(page.items[0]?.playedSeconds, 31);
    assert.equal(page.items[1]?.playedAt, 3_000);
    assert.doesNotMatch(JSON.stringify(page), /relativePath|sourceId|native/i);
    const plan = database.connection
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM play_history
         ORDER BY played_at DESC, id DESC LIMIT 48`,
      )
      .all()
      .map((row) => String((row as { detail: unknown }).detail))
      .join("\n");
    assert.match(plan, /play_history_played_idx/);
    assert.deepEqual(
      repository.playHistoryContextTracks().map((track) => track.id),
      [one.id, two.id],
    );
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("play history prunes 90 days and 500 events, preserves unavailable, and cascades", async () => {
  const { temporary, database, repository, tracks } = await repositoryFixture();
  try {
    const [one, two] = tracks;
    assert.ok(one && two);
    const current = Date.UTC(2026, 6, 22);
    repository.recordPlayHistory(one.id, 30, false, current - 91 * 86_400_000);
    for (let index = 0; index < 503; index += 1)
      repository.recordPlayHistory(
        index % 2 === 0 ? one.id : two.id,
        30,
        false,
        current + index,
      );
    assert.equal(repository.recentlyPlayed(null, 100).total, 500);
    database.connection
      .prepare("UPDATE tracks SET available = 0 WHERE track_id = ?")
      .run(one.id);
    const unavailable = repository.recentlyPlayed(null, 100);
    assert.ok(
      unavailable.items.some(
        (item) => item.id === one.id && item.availability === "unavailable",
      ),
    );
    assert.ok(unavailable.availableCount < unavailable.total);
    database.connection
      .prepare("DELETE FROM tracks WHERE track_id = ?")
      .run(one.id);
    assert.equal(
      repository
        .recentlyPlayed(null, 100)
        .items.some((item) => item.id === one.id),
      false,
    );
    const first = repository.recentlyPlayed(null, 1).items[0];
    assert.ok(first);
    assert.equal(
      repository.removePlayHistory(Number(first.historyId.slice(8))),
      1,
    );
    assert.ok(repository.clearPlayHistory() > 0);
    assert.equal(repository.recentlyPlayed(null, 10).total, 0);
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

interface RecordedEvent {
  historyId: string;
  trackId: string;
  playedSeconds: number;
  completed: boolean;
}

class Sink implements PlayHistorySink {
  readonly events: RecordedEvent[] = [];

  recordPlayHistory(
    trackId: string,
    playedSeconds: number,
    completed: boolean,
  ): { readonly historyId: string; readonly created: boolean } {
    const event = {
      historyId: `history-${String(this.events.length + 1)}`,
      trackId,
      playedSeconds,
      completed,
    };
    this.events.push(event);
    return { historyId: event.historyId, created: true };
  }

  updatePlayHistory(
    historyId: string,
    playedSeconds: number,
    completed: boolean,
  ): boolean {
    const event = this.events.find((item) => item.historyId === historyId);
    if (!event) return false;
    event.playedSeconds = playedSeconds;
    event.completed ||= completed;
    return true;
  }
}

function state(
  options: {
    readonly transition?: number;
    readonly trackId?: string | null;
    readonly position?: number;
    readonly duration?: number;
    readonly paused?: boolean;
  } = {},
): PlayerState {
  const trackId =
    options.trackId === undefined ? `track-${"1".repeat(32)}` : options.trackId;
  return {
    playerSessionId: "history-session",
    trackTransitionId: options.transition ?? 1,
    status: options.paused ? "paused" : "playing",
    mpvAvailable: true,
    mpvVersion: "fixture",
    currentTrack: null,
    positionSeconds: options.position ?? 0,
    durationSeconds: options.duration ?? 240,
    paused: options.paused ?? false,
    volume: 50,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    currentQueueIndex: 0,
    queue: [
      {
        id: "queue-history",
        index: 0,
        path: "fixture.flac",
        filename: "fixture.flac",
        displayTitle: "Fixture",
        artwork: null,
        isCurrent: true,
        ...(trackId ? { libraryTrackId: trackId } : {}),
      },
    ],
    queueRevision: 1,
    audioDevice: "fixture",
    error: null,
  };
}

function playSeconds(
  tracker: PlayHistoryTracker,
  seconds: number,
  duration: number,
  transition = 1,
): void {
  tracker.observe(state({ transition, duration, position: 0 }), 0);
  for (let second = 1; second <= seconds; second += 1)
    tracker.observe(
      state({ transition, duration, position: second }),
      second * 1_000,
    );
}

void test("tracker applies 30-second, 50-percent, and unknown-duration thresholds", () => {
  for (const [duration, seconds] of [
    [240, 30],
    [40, 20],
    [10, 5],
    [0, 30],
  ] as const) {
    const sink = new Sink();
    playSeconds(new PlayHistoryTracker(sink), seconds, duration);
    assert.equal(sink.events.length, 1);
    assert.equal(sink.events[0]?.playedSeconds, seconds);
  }
});

void test("tracker excludes pause, seek, anomalous deltas, and unindexed tracks", () => {
  const sink = new Sink();
  const tracker = new PlayHistoryTracker(sink);
  tracker.observe(state({ position: 0 }), 0);
  tracker.observe(state({ position: 120 }), 1_000);
  tracker.observe(state({ position: 121 }), 2_000);
  tracker.noteSeek(state({ position: 121 }), 2_100);
  tracker.observe(state({ position: 122 }), 3_000);
  tracker.observe(state({ position: 122, paused: true }), 4_000);
  tracker.observe(state({ position: 122, paused: true }), 5_000);
  tracker.observe(state({ position: 123 }), 6_000);
  tracker.observe(state({ position: 124 }), 20_000);
  tracker.observe(state({ position: 125, trackId: null }), 21_000);
  assert.equal(sink.events.length, 0);
});

void test("tracker creates one event per transition and updates completion", () => {
  const sink = new Sink();
  const tracker = new PlayHistoryTracker(sink);
  playSeconds(tracker, 30, 100);
  tracker.observe(state({ duration: 100, position: 90 }), 31_000);
  assert.equal(sink.events.length, 1);
  assert.equal(sink.events[0]?.completed, true);
  tracker.observe(state({ transition: 2, duration: 100, position: 0 }), 32_000);
  for (let second = 1; second <= 30; second += 1)
    tracker.observe(
      state({ transition: 2, duration: 100, position: second }),
      (32 + second) * 1_000,
    );
  tracker.observe(
    state({ transition: 2, duration: 100, position: 30 }),
    63_000,
    true,
  );
  assert.equal(sink.events.length, 2);
  assert.equal(sink.events[1]?.completed, true);
});
