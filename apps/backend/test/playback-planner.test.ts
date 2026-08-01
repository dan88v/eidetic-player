import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  MAX_PLAYBACK_HISTORY_ITEMS,
  PlaybackPlanError,
  PlaybackPlanner,
  isPlaybackPlanSnapshot,
  type CurrentPlaybackItem,
  type PlaybackContextKind,
  type PlaybackContextSeed,
  type PlaybackDecision,
  type PlaybackItemSeed,
} from "../src/playback-plan/index.js";

function track(
  id: string,
  overrides: Partial<PlaybackItemSeed> = {},
): PlaybackItemSeed {
  return {
    nativePath: `/music/${id}.flac`,
    filename: `${id}.flac`,
    title: id,
    artist: "Artist",
    album: "Album",
    durationSeconds: 180,
    libraryTrackId: `track-${id}`,
    origin: {
      kind: "library",
      sourceId: "source-library",
      relativePath: `${id}.flac`,
    },
    ...overrides,
  };
}

function context(
  ids: readonly string[],
  options: {
    readonly selectedIndex?: number;
    readonly kind?: Exclude<PlaybackContextKind, "artist-radio">;
    readonly continuationArtistId?: string | null;
  } = {},
): PlaybackContextSeed {
  return {
    kind: options.kind ?? "album",
    title: "Test context",
    entityId: "context-entity",
    continuationArtistId: options.continuationArtistId ?? null,
    source: { label: "Test source", sourceId: "source-library" },
    items: ids.map((id) => track(id)),
    selectedIndex: options.selectedIndex ?? 0,
  };
}

function planner(randomValues: readonly number[] = [0.5]): PlaybackPlanner {
  let identifier = 0;
  let randomIndex = 0;
  return new PlaybackPlanner({
    idFactory: (prefix) => `${prefix}-test-${String(++identifier)}`,
    random: () => {
      const value = randomValues[randomIndex % randomValues.length];
      randomIndex += 1;
      return value ?? 0;
    },
  });
}

function started(decision: PlaybackDecision): CurrentPlaybackItem {
  assert.equal(decision.kind, "start");
  return decision.current;
}

function currentTitle(playbackPlanner: PlaybackPlanner): string | null {
  return playbackPlanner.snapshot().current?.item.title ?? null;
}

void test("Current is separate from Context and a selected context resumes in order", () => {
  const playbackPlanner = planner();

  const first = started(
    playbackPlanner.startContext(
      context(["a", "b", "c"], { selectedIndex: 1 }),
    ),
  );

  assert.equal(first.item.title, "b");
  assert.equal(first.source, "context");
  assert.match(first.playbackInstanceId, /^playback-item-/);
  assert.match(first.relationId, /^context-item-/);
  assert.match(first.historyEntryId ?? "", /^history-/);
  assert.equal(playbackPlanner.snapshot().context?.resumeCursor, 2);
  assert.deepEqual(playbackPlanner.snapshot().explicitQueue, []);
  assert.equal(playbackPlanner.canAdvance(), true);
  assert.equal(started(playbackPlanner.next()).item.title, "c");
  assert.equal(playbackPlanner.canAdvance(), false);
  assert.deepEqual(playbackPlanner.next(), {
    kind: "stop",
    reason: "no-future-item",
  });
});

void test("Explicit Queue is FIFO, permits true duplicates, and has priority over Context", () => {
  const playbackPlanner = planner();
  started(playbackPlanner.startContext(context(["a", "b", "c"])));
  const added = playbackPlanner.enqueueExplicit([
    track("duplicate"),
    track("duplicate"),
    track("queued"),
  ]);

  assert.equal(
    new Set(added.map((entry) => entry.explicitQueueEntryId)).size,
    3,
  );
  assert.equal(new Set(added.map((entry) => entry.playbackInstanceId)).size, 3);
  assert.equal(new Set(added.map((entry) => entry.executionEntryId)).size, 3);
  assert.equal(playbackPlanner.snapshot().current?.item.title, "a");
  assert.deepEqual(
    playbackPlanner
      .projectExecutionPlan()
      .future.map((entry) => entry.item.title),
    ["duplicate", "duplicate", "queued", "b", "c"],
  );

  assert.equal(started(playbackPlanner.next()).item.title, "duplicate");
  assert.equal(started(playbackPlanner.next()).item.title, "duplicate");
  assert.equal(started(playbackPlanner.next()).item.title, "queued");
  assert.equal(started(playbackPlanner.next()).item.title, "b");
});

void test("an explicit-only staged queue starts without manufacturing a context", () => {
  const playbackPlanner = planner();
  playbackPlanner.enqueueExplicit([track("one"), track("two")]);

  assert.equal(playbackPlanner.snapshot().current, null);
  assert.equal(playbackPlanner.snapshot().context, null);
  assert.equal(started(playbackPlanner.start()).item.title, "one");
  assert.equal(playbackPlanner.snapshot().context, null);
  assert.deepEqual(
    playbackPlanner.snapshot().explicitQueue.map((entry) => entry.item.title),
    ["two"],
  );
});

void test("new context preserves Explicit Queue and truncates forward History", () => {
  const playbackPlanner = planner();
  started(playbackPlanner.startContext(context(["a", "b"])));
  playbackPlanner.enqueueExplicit([track("queued-1"), track("queued-2")]);
  assert.equal(started(playbackPlanner.next()).item.title, "queued-1");
  assert.equal(started(playbackPlanner.previous(0)).item.title, "a");

  assert.equal(
    started(playbackPlanner.startContext(context(["new-a", "new-b"]))).item
      .title,
    "new-a",
  );
  const snapshot = playbackPlanner.snapshot();
  assert.deepEqual(
    snapshot.explicitQueue.map((entry) => entry.item.title),
    ["queued-2"],
  );
  assert.deepEqual(
    snapshot.history.entries.map((entry) => entry.item.title),
    ["a", "new-a"],
  );
  assert.equal(started(playbackPlanner.next()).item.title, "queued-2");
  assert.equal(started(playbackPlanner.next()).item.title, "new-b");
});

void test("selecting an explicit entry consumes earlier entries without adding them to History", () => {
  const playbackPlanner = planner();
  started(
    playbackPlanner.startContext(context(["context-current", "context-next"])),
  );
  const entries = playbackPlanner.enqueueExplicit([
    track("skip-1"),
    track("skip-2"),
    track("selected"),
    track("after"),
  ]);
  const selectedId = entries[2]?.explicitQueueEntryId;
  assert.ok(selectedId);

  assert.equal(
    started(playbackPlanner.selectExplicit(selectedId)).item.title,
    "selected",
  );
  const snapshot = playbackPlanner.snapshot();
  assert.deepEqual(
    snapshot.explicitQueue.map((entry) => entry.item.title),
    ["after"],
  );
  assert.deepEqual(
    snapshot.history.entries.map((entry) => entry.item.title),
    ["context-current", "selected"],
  );
});

void test("remove, reorder, and clear affect future explicit instances only", () => {
  const playbackPlanner = planner();
  const entries = playbackPlanner.enqueueExplicit([
    track("first"),
    track("second"),
    track("third"),
  ]);
  const firstId = entries[0]?.explicitQueueEntryId;
  const secondId = entries[1]?.explicitQueueEntryId;
  const thirdId = entries[2]?.explicitQueueEntryId;
  assert.ok(firstId && secondId && thirdId);

  assert.equal(playbackPlanner.reorderExplicit(thirdId, 0), true);
  assert.equal(playbackPlanner.removeExplicit(secondId), true);
  assert.equal(started(playbackPlanner.start()).item.title, "third");
  assert.equal(playbackPlanner.clearExplicitQueue(), 1);
  assert.equal(currentTitle(playbackPlanner), "third");
  assert.equal(playbackPlanner.removeExplicit(firstId), false);
  assert.deepEqual(playbackPlanner.snapshot().explicitQueue, []);
});

void test("clearing Context preserves Current and Explicit Queue", () => {
  const playbackPlanner = planner();
  started(playbackPlanner.startContext(context(["current", "context-next"])));
  playbackPlanner.enqueueExplicit([track("explicit-next")]);

  assert.equal(playbackPlanner.clearContext(), true);
  const snapshot = playbackPlanner.snapshot();
  assert.equal(snapshot.current?.item.title, "current");
  assert.equal(snapshot.context, null);
  assert.deepEqual(
    snapshot.explicitQueue.map((entry) => entry.item.title),
    ["explicit-next"],
  );
  assert.deepEqual(
    playbackPlanner
      .projectExecutionPlan()
      .future.map((entry) => entry.item.title),
    ["explicit-next"],
  );
  assert.equal(playbackPlanner.clearContext(), false);
});

void test("manual Next capability becomes false when Current has no known successor", () => {
  const playbackPlanner = planner();
  started(playbackPlanner.startContext(context(["current", "context-next"])));
  assert.equal(playbackPlanner.canAdvance(), true);

  assert.equal(playbackPlanner.clearContext(), true);
  assert.equal(playbackPlanner.canAdvance(), false);
  assert.equal(currentTitle(playbackPlanner), "current");

  playbackPlanner.enqueueExplicit([track("explicit-next")]);
  assert.equal(playbackPlanner.canAdvance(), true);
  playbackPlanner.clearExplicitQueue();
  assert.equal(playbackPlanner.canAdvance(), false);
  assert.equal(currentTitle(playbackPlanner), "current");
});

void test("Previous restarts after three seconds and otherwise moves through bounded History", () => {
  const playbackPlanner = planner();
  started(playbackPlanner.startContext(context(["a", "b", "c"])));
  started(playbackPlanner.next());
  const c = started(playbackPlanner.next());

  assert.deepEqual(playbackPlanner.previous(3.01), {
    kind: "restart-current",
    playbackInstanceId: c.playbackInstanceId,
  });
  assert.equal(started(playbackPlanner.previous(3)).item.title, "b");
  assert.equal(started(playbackPlanner.previous(0)).item.title, "a");
  assert.equal(started(playbackPlanner.next()).item.title, "b");
  assert.equal(started(playbackPlanner.next()).item.title, "c");
  assert.deepEqual(playbackPlanner.next(), {
    kind: "stop",
    reason: "no-future-item",
  });
});

void test("History availability is occurrence-scoped and stays coherent with Current", () => {
  const playbackPlanner = planner();
  started(
    playbackPlanner.startContext({
      ...context(["duplicate-a", "duplicate-b", "tail"]),
      items: [track("duplicate"), track("duplicate"), track("tail")],
    }),
  );
  started(playbackPlanner.next());
  started(playbackPlanner.next());
  const before = playbackPlanner.snapshot();
  const [firstDuplicate, secondDuplicate, currentEntry] =
    before.history.entries;
  assert.ok(firstDuplicate && secondDuplicate && currentEntry);

  assert.equal(
    playbackPlanner.setHistoryAvailability(
      firstDuplicate.historyEntryId,
      "unavailable",
    ),
    true,
  );
  let snapshot = playbackPlanner.snapshot();
  assert.deepEqual(
    snapshot.history.entries.map((entry) => entry.item.availability),
    ["unavailable", "available", "available"],
  );
  assert.equal(snapshot.current?.item.availability, "available");

  assert.equal(
    playbackPlanner.setHistoryAvailability(
      currentEntry.historyEntryId,
      "unavailable",
    ),
    true,
  );
  snapshot = playbackPlanner.snapshot();
  assert.equal(snapshot.history.entries[2]?.item.availability, "unavailable");
  assert.equal(snapshot.current?.item.availability, "unavailable");

  assert.equal(
    playbackPlanner.setHistoryAvailability(
      firstDuplicate.historyEntryId,
      "available",
    ),
    true,
  );
  assert.deepEqual(
    playbackPlanner
      .snapshot()
      .history.entries.map((entry) => entry.item.availability),
    ["available", "available", "unavailable"],
  );
  assert.equal(
    playbackPlanner.setHistoryAvailability("history-missing", "available"),
    false,
  );
});

void test("Previous skips unavailable History entries and terminates at the bounded start", () => {
  const playbackPlanner = planner();
  started(playbackPlanner.startContext(context(["a", "b", "c", "d", "e"])));
  for (let index = 1; index < 5; index += 1) started(playbackPlanner.next());
  const entries = playbackPlanner.snapshot().history.entries;
  for (const entry of entries.slice(1, 4))
    playbackPlanner.setHistoryAvailability(entry.historyEntryId, "unavailable");

  assert.equal(started(playbackPlanner.previous(0)).item.title, "a");
  const atStart = playbackPlanner.snapshot();
  assert.equal(atStart.history.cursor, 0);
  assert.deepEqual(playbackPlanner.previous(0), {
    kind: "none",
    reason: "history-start",
  });
  assert.deepEqual(playbackPlanner.snapshot().current, atStart.current);

  const boundedPlanner = planner();
  const ids = Array.from(
    { length: MAX_PLAYBACK_HISTORY_ITEMS },
    (_, index) => `bounded-${String(index)}`,
  );
  started(boundedPlanner.startContext(context(ids)));
  for (let index = 1; index < ids.length; index += 1)
    started(boundedPlanner.next());
  const boundedHistory = boundedPlanner.snapshot().history;
  for (const entry of boundedHistory.entries.slice(0, -1))
    boundedPlanner.setHistoryAvailability(entry.historyEntryId, "unavailable");
  assert.deepEqual(boundedPlanner.previous(0), {
    kind: "none",
    reason: "history-start",
  });
  assert.equal(
    boundedPlanner.snapshot().history.cursor,
    MAX_PLAYBACK_HISTORY_ITEMS - 1,
  );
});

void test("manual and natural forward History skip unavailable occurrences without looping", () => {
  const manualPlanner = planner();
  started(manualPlanner.startContext(context(["a", "b", "c", "d"])));
  started(manualPlanner.next());
  started(manualPlanner.next());
  started(manualPlanner.next());
  started(manualPlanner.previous(0));
  assert.equal(started(manualPlanner.previous(0)).item.title, "b");
  const manualHistory = manualPlanner.snapshot().history.entries;
  const unavailableForward = manualHistory[2];
  assert.ok(unavailableForward);
  manualPlanner.setHistoryAvailability(
    unavailableForward.historyEntryId,
    "unavailable",
  );
  const manualForward = manualPlanner.next();
  assert.equal(manualForward.kind, "start");
  assert.equal(manualForward.reason, "history-forward");
  assert.equal(manualForward.current.item.title, "d");

  const naturalPlanner = planner();
  started(naturalPlanner.startContext(context(["context-a", "context-b"])));
  naturalPlanner.enqueueExplicit([track("explicit-a"), track("explicit-b")]);
  started(naturalPlanner.advance());
  started(naturalPlanner.advance());
  assert.equal(started(naturalPlanner.previous(0)).item.title, "explicit-a");
  const naturalForward = naturalPlanner.snapshot().history.entries[2];
  assert.ok(naturalForward);
  naturalPlanner.setHistoryAvailability(
    naturalForward.historyEntryId,
    "unavailable",
  );
  const naturalAdvance = naturalPlanner.advance();
  assert.equal(naturalAdvance.kind, "start");
  assert.equal(naturalAdvance.reason, "context-resume");
  assert.equal(naturalAdvance.current.item.title, "context-b");
  assert.deepEqual(
    naturalPlanner.snapshot().history.entries.map((entry) => entry.item.title),
    ["context-a", "explicit-a", "context-b"],
  );
});

void test("repeat-one precedes every future source and repeat-all regenerates Context only", () => {
  const playbackPlanner = planner();
  const original = started(
    playbackPlanner.startContext(context(["context-a", "context-b"])),
  );
  playbackPlanner.enqueueExplicit([track("explicit")]);
  playbackPlanner.setRepeatMode("one");

  const historyLength = playbackPlanner.snapshot().history.entries.length;
  assert.deepEqual(playbackPlanner.next(), {
    kind: "restart-current",
    playbackInstanceId: original.playbackInstanceId,
  });
  assert.equal(
    playbackPlanner.snapshot().history.entries.length,
    historyLength,
  );
  assert.deepEqual(
    playbackPlanner.snapshot().explicitQueue.map((entry) => entry.item.title),
    ["explicit"],
  );

  playbackPlanner.setRepeatMode("off");
  assert.equal(started(playbackPlanner.next()).item.title, "explicit");
  assert.equal(started(playbackPlanner.next()).item.title, "context-b");
  playbackPlanner.setRepeatMode("all");
  const cycle = started(playbackPlanner.next());
  assert.equal(cycle.item.title, "context-a");
  assert.equal(playbackPlanner.snapshot().context?.repeatCycle, 1);
  assert.deepEqual(playbackPlanner.snapshot().explicitQueue, []);
});

void test("shuffle changes only the unconsumed Context remainder and never Explicit Queue order", () => {
  const playbackPlanner = planner([0, 0.75, 0.25, 0.5]);
  started(playbackPlanner.startContext(context(["a", "b", "c", "d"])));
  playbackPlanner.enqueueExplicit([track("x"), track("y")]);
  const explicitIds = playbackPlanner
    .snapshot()
    .explicitQueue.map((entry) => entry.explicitQueueEntryId);

  playbackPlanner.setShuffle(true);
  const snapshot = playbackPlanner.snapshot();
  assert.deepEqual(
    snapshot.explicitQueue.map((entry) => entry.explicitQueueEntryId),
    explicitIds,
  );
  assert.equal(snapshot.context?.resumeCursor, 1);
  assert.ok(snapshot.context);
  assert.ok(snapshot.current);
  assert.equal(snapshot.context.playOrder[0], snapshot.current.relationId);
  assert.equal(started(playbackPlanner.next()).item.title, "x");
  assert.equal(started(playbackPlanner.next()).item.title, "y");

  const remaining = new Set<string>();
  remaining.add(started(playbackPlanner.next()).item.title);
  remaining.add(started(playbackPlanner.next()).item.title);
  remaining.add(started(playbackPlanner.next()).item.title);
  assert.deepEqual(remaining, new Set(["b", "c", "d"]));
});

void test("same-artist continuation is signalled only with stable identities", () => {
  const playbackPlanner = planner();
  playbackPlanner.setContinuePlayback("same-artist");
  started(
    playbackPlanner.startContext(
      context(["last"], { continuationArtistId: "artist-stable" }),
    ),
  );

  const boundary = playbackPlanner.next();
  assert.equal(boundary.kind, "continuation-needed");
  assert.equal(boundary.request.artistId, "artist-stable");
  assert.equal(boundary.request.previousLibraryTrackId, "track-last");
  assert.equal(playbackPlanner.snapshot().current, null);

  const noArtist = planner();
  noArtist.setContinuePlayback("same-artist");
  started(noArtist.startContext(context(["last"])));
  assert.deepEqual(noArtist.next(), {
    kind: "stop",
    reason: "no-continuation-identity",
  });

  const noTrackIdentity = planner();
  noTrackIdentity.setContinuePlayback("same-artist");
  started(
    noTrackIdentity.startContext({
      ...context(["last"], { continuationArtistId: "artist-stable" }),
      items: [track("last", { libraryTrackId: null })],
    }),
  );
  assert.deepEqual(noTrackIdentity.next(), {
    kind: "stop",
    reason: "no-continuation-identity",
  });
});

void test("artist radio is a duplicate-free random bag and Explicit Queue keeps priority", () => {
  const playbackPlanner = planner([0, 0, 0.5, 0.25]);
  playbackPlanner.setContinuePlayback("same-artist");
  started(
    playbackPlanner.startContext(
      context(["seed"], { continuationArtistId: "artist-stable" }),
    ),
  );
  assert.equal(playbackPlanner.next().kind, "continuation-needed");
  playbackPlanner.enqueueExplicit([track("explicit")]);

  assert.equal(
    started(
      playbackPlanner.installArtistRadio("artist-stable", [
        track("seed"),
        track("radio-a"),
        track("radio-b"),
        track("radio-a"),
      ]),
    ).item.title,
    "explicit",
  );
  const firstRadio = started(playbackPlanner.next());
  const secondRadio = started(playbackPlanner.next());
  assert.deepEqual(
    new Set([firstRadio.item.title, secondRadio.item.title]),
    new Set(["radio-a", "radio-b"]),
  );
  assert.notEqual(firstRadio.item.title, "seed");
  assert.notEqual(secondRadio.item.title, firstRadio.item.title);

  const nextCycle = started(playbackPlanner.next());
  assert.notEqual(
    nextCycle.item.libraryTrackId,
    secondRadio.item.libraryTrackId,
  );
  assert.equal(playbackPlanner.snapshot().artistRadio?.bagCycle, 2);
});

void test("turning same-artist off drops radio future while preserving Current and Explicit Queue", () => {
  const playbackPlanner = planner();
  playbackPlanner.setContinuePlayback("same-artist");
  started(
    playbackPlanner.startContext(
      context(["seed"], { continuationArtistId: "artist-stable" }),
    ),
  );
  playbackPlanner.next();
  started(
    playbackPlanner.installArtistRadio("artist-stable", [
      track("radio-a"),
      track("radio-b"),
    ]),
  );
  playbackPlanner.enqueueExplicit([track("explicit")]);
  const currentBefore = playbackPlanner.snapshot().current;

  playbackPlanner.setContinuePlayback("off");
  const snapshot = playbackPlanner.snapshot();
  assert.deepEqual(snapshot.current, currentBefore);
  assert.equal(snapshot.context, null);
  assert.equal(snapshot.artistRadio, null);
  assert.deepEqual(
    snapshot.explicitQueue.map((entry) => entry.item.title),
    ["explicit"],
  );
});

void test("unavailable entries are skipped with bounded progress and can reconnect before consumption", () => {
  const playbackPlanner = planner();
  const entries = playbackPlanner.enqueueExplicit([
    track("unavailable", { availability: "unavailable" }),
    track("reconnected", { availability: "unavailable" }),
    track("available"),
  ]);
  const reconnectId = entries[1]?.explicitQueueEntryId;
  assert.ok(reconnectId);
  assert.equal(
    playbackPlanner.setExplicitAvailability(reconnectId, "available"),
    true,
  );
  assert.equal(started(playbackPlanner.start()).item.title, "reconnected");
  assert.equal(started(playbackPlanner.next()).item.title, "available");

  const contextPlanner = planner();
  assert.equal(
    started(
      contextPlanner.startContext({
        ...context(["offline", "online"]),
        items: [
          track("offline", { availability: "unavailable" }),
          track("online"),
        ],
      }),
    ).item.title,
    "online",
  );
  assert.equal(contextPlanner.snapshot().context?.resumeCursor, 2);
});

void test("snapshots round-trip origin identity and malformed snapshots are rejected", () => {
  const playbackPlanner = planner();
  playbackPlanner.enqueueExplicit([
    track("usb", {
      origin: {
        kind: "removable",
        sourceId: "device-id",
        relativePath: "folder/usb.flac",
        entryId: "entry-id",
        removable: true,
        smb: false,
      },
    }),
  ]);
  const serialized = playbackPlanner.serialize();
  assert.equal(isPlaybackPlanSnapshot(serialized), true);
  const restored = PlaybackPlanner.fromSnapshot(serialized, {
    idFactory: (prefix) => `${prefix}-restored`,
  });
  assert.deepEqual(restored.snapshot(), serialized);
  assert.deepEqual(restored.snapshot().explicitQueue[0]?.item.origin, {
    kind: "removable",
    sourceId: "device-id",
    relativePath: "folder/usb.flac",
    entryId: "entry-id",
    removable: true,
    smb: false,
  });

  const malformed = { ...serialized, schemaVersion: 999 };
  assert.equal(isPlaybackPlanSnapshot(malformed), false);
  assert.throws(
    () => {
      restored.restore(malformed);
    },
    (error: unknown) =>
      error instanceof PlaybackPlanError &&
      error.code === "INVALID_PLAYBACK_PLAN_SNAPSHOT",
  );
});

void test("History is capped at 100 entries", () => {
  const playbackPlanner = planner();
  const ids = Array.from(
    { length: 105 },
    (_, index) => `track-${String(index)}`,
  );
  started(playbackPlanner.startContext(context(ids)));
  for (let index = 1; index < ids.length; index += 1)
    started(playbackPlanner.next());

  const history = playbackPlanner.snapshot().history;
  assert.equal(history.entries.length, MAX_PLAYBACK_HISTORY_ITEMS);
  assert.equal(history.cursor, MAX_PLAYBACK_HISTORY_ITEMS - 1);
  assert.equal(history.entries[0]?.item.title, "track-5");
  assert.equal(history.entries.at(-1)?.item.title, "track-104");
});

void test("a 2000-item Context keeps its public execution projection bounded", () => {
  const playbackPlanner = planner([0.5]);
  const ids = Array.from(
    { length: 2_000 },
    (_, index) => `large-${String(index)}`,
  );
  const startedAt = performance.now();
  started(playbackPlanner.startContext(context(ids)));
  const projection = playbackPlanner.projectExecutionPlan();
  const serialized = JSON.stringify(playbackPlanner.serialize());
  const elapsedMilliseconds = performance.now() - startedAt;

  assert.equal(projection.future.length, 128);
  assert.equal(projection.hiddenEntryCount, 1_871);
  assert.equal(projection.truncated, true);
  assert.ok(serialized.length > 0);
  assert.ok(
    elapsedMilliseconds < 2_500,
    `2000-item planning took ${elapsedMilliseconds.toFixed(1)} ms`,
  );
});
