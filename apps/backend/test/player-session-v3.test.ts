import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ArtworkRef } from "../../../packages/shared/src/player.js";
import { emptyMetadata } from "../src/metadata/metadata-service.js";
import {
  MAX_EXPLICIT_QUEUE_ITEMS,
  MAX_PLAYBACK_CONTEXT_ITEMS,
  MAX_PLAYBACK_HISTORY_ITEMS,
  type PlaybackContextItem,
  type PlaybackHistoryEntry,
  type PlaybackItemOrigin,
  type PlaybackItemSnapshot,
} from "../src/playback-plan/playback-plan-types.js";
import { isPlaybackPlanSnapshot } from "../src/playback-plan/playback-planner.js";
import { PlayerService } from "../src/player/player-service.js";
import {
  PlayerSessionRepository,
  migrateLegacyPlayerSession,
  playbackPlanFromPlayerSession,
  playerSessionFromPlaybackPlan,
  projectPlayerSessionV2,
} from "../src/player-session/player-session-repository.js";
import type {
  PersistedPlayerSession,
  PersistedPlayerSessionV3,
} from "../src/player-session/player-session-types.js";

const legacyCurrentId = "queue-11111111-1111-4111-8111-111111111111";
const legacySecondaryId = "queue-22222222-2222-4222-8222-222222222222";
const legacyThirdId = "queue-33333333-3333-4333-8333-333333333333";
const duplicatePath = "/music/duplicate.flac";
const opaqueUuid =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}";

function playbackItem(
  name: string,
  nativePath = duplicatePath,
  origin: PlaybackItemOrigin = { kind: "direct" },
): PlaybackItemSnapshot {
  return {
    nativePath,
    filename: `${name}.flac`,
    title: name,
    artist: "Artist",
    album: "Album",
    durationSeconds: 180,
    libraryTrackId: `track-${name.padEnd(32, "0").slice(0, 32)}`,
    primaryArtistId: `artist-${"1".repeat(32)}`,
    availability: "available",
    origin,
  };
}

function contextItem(index: number): PlaybackContextItem {
  return {
    contextItemId: `context-item-${String(index)}`,
    executionEntryId: `execution-context-${String(index)}`,
    item: playbackItem(`Context ${String(index)}`),
  };
}

function historyEntry(index: number): PlaybackHistoryEntry {
  return {
    historyEntryId: `history-${String(index)}`,
    playbackInstanceId: `playback-item-history-${String(index)}`,
    executionEntryId: `execution-history-${String(index)}`,
    originalSource: "context",
    originalRelationId: `context-item-history-${String(index)}`,
    contextId: "context-main",
    item: playbackItem(`History ${String(index)}`),
    startedSequence: index,
  };
}

function sessionFixture(): PersistedPlayerSessionV3 {
  const context = contextItem(1);
  const currentHistory = historyEntry(1);
  return {
    version: 3,
    planSchemaVersion: 1,
    current: {
      playbackInstanceId: currentHistory.playbackInstanceId,
      executionEntryId: context.executionEntryId,
      source: "context",
      relationId: context.contextItemId,
      contextId: "context-main",
      historyEntryId: currentHistory.historyEntryId,
      item: context.item,
      startedSequence: 1,
    },
    context: {
      contextId: "context-main",
      kind: "album",
      title: "Album",
      entityId: "album-main",
      continuationArtistId: "artist-main",
      source: { label: "Album", sourceId: "album-main" },
      originalItems: [context],
      playOrder: [context.contextItemId],
      resumeCursor: 1,
      shuffleCycle: 2,
      repeatCycle: 3,
      availabilityRevision: 4,
    },
    explicitQueue: [
      {
        explicitQueueEntryId: "explicit-1",
        playbackInstanceId: "playback-item-explicit-1",
        executionEntryId: "execution-explicit-1",
        item: playbackItem("Explicit duplicate one"),
        addedSequence: 2,
      },
      {
        explicitQueueEntryId: "explicit-2",
        playbackInstanceId: "playback-item-explicit-2",
        executionEntryId: "execution-explicit-2",
        item: playbackItem("Explicit duplicate two"),
        addedSequence: 3,
      },
    ],
    history: { entries: [currentHistory], cursor: 0 },
    artistRadio: null,
    pendingContinuation: {
      requestId: "continuation-main",
      artistId: "artist-main",
      previousLibraryTrackId: "track-previous",
      recentLibraryTrackIds: ["track-recent"],
    },
    positionSeconds: 42.5,
    volume: 73,
    muted: true,
    shuffleEnabled: true,
    repeatMode: "all",
    continuePlayback: "same-artist",
    sequence: 12,
    revisions: {
      state: 12,
      current: 3,
      context: 4,
      explicitQueue: 5,
      history: 6,
      execution: 7,
      availability: 8,
    },
  };
}

function legacyFixture(version: 1 | 2 = 2): Record<string, unknown> {
  return {
    version,
    currentQueueItemId: legacySecondaryId,
    queue: [
      {
        id: legacyCurrentId,
        origin: { kind: "direct", nativePath: duplicatePath },
        filename: "duplicate.flac",
        displayTitle: "First occurrence",
      },
      {
        id: legacySecondaryId,
        origin: { kind: "direct", nativePath: duplicatePath },
        filename: "duplicate.flac",
        displayTitle: "Second occurrence",
      },
    ],
    ...(version === 2
      ? {
          positionSeconds: 91,
          volume: 64,
          muted: true,
          shuffleEnabled: true,
          repeatMode: "one",
        }
      : {}),
  };
}

void test("legacy v2 migrates to an implicit context without deleting the rollback file", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-v3-legacy-"));
  const legacyPath = join(root, "player-session.json");
  const repository = new PlayerSessionRepository(legacyPath);
  const legacyText = `${JSON.stringify(legacyFixture(), null, 2)}\n`;
  try {
    await writeFile(legacyPath, legacyText, "utf8");

    const result = await repository.readPlaybackSession();

    assert.equal(result.status, "migrated");
    assert.equal(result.source, "legacy-v2");
    assert.equal(result.recoveredFromInvalidV3, false);
    assert.equal(result.session.context?.kind, "legacy-session");
    assert.equal(result.session.context.originalItems.length, 2);
    assert.deepEqual(
      result.session.context.originalItems.map(
        (entry) => entry.item.nativePath,
      ),
      [duplicatePath, duplicatePath],
    );
    assert.equal(result.session.context.resumeCursor, 2);
    const migratedCurrent = result.session.current;
    assert.ok(migratedCurrent);
    assert.match(
      migratedCurrent.playbackInstanceId,
      new RegExp(`^playback-item-${opaqueUuid}$`, "u"),
    );
    assert.match(
      migratedCurrent.executionEntryId,
      new RegExp(`^execution-${opaqueUuid}$`, "u"),
    );
    assert.match(
      migratedCurrent.relationId,
      new RegExp(`^context-item-${opaqueUuid}$`, "u"),
    );
    assert.match(
      migratedCurrent.historyEntryId ?? "",
      new RegExp(`^history-${opaqueUuid}$`, "u"),
    );
    assert.doesNotMatch(
      JSON.stringify(migratedCurrent),
      /playback-item-queue/u,
    );
    assert.equal(result.session.explicitQueue.length, 0);
    assert.equal(result.session.history.entries.length, 1);
    assert.equal(result.session.history.cursor, 0);
    assert.equal(result.session.positionSeconds, 91);
    assert.equal(result.session.volume, 64);
    assert.equal(result.session.muted, true);
    assert.equal(result.session.shuffleEnabled, true);
    assert.equal(result.session.repeatMode, "one");
    assert.equal(result.session.continuePlayback, "off");
    assert.equal(
      isPlaybackPlanSnapshot(playbackPlanFromPlayerSession(result.session)),
      true,
    );
    assert.equal(await readFile(legacyPath, "utf8"), legacyText);
    await assert.rejects(
      readFile(join(root, "player-session-v3.json")),
      /ENOENT/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("legacy v1 receives bounded playback defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-v3-v1-"));
  const legacyPath = join(root, "player-session.json");
  const repository = new PlayerSessionRepository(legacyPath);
  try {
    await writeFile(legacyPath, JSON.stringify(legacyFixture(1)), "utf8");
    const result = await repository.readPlaybackSession();
    assert.equal(result.status, "migrated");
    assert.equal(result.source, "legacy-v1");
    assert.equal(result.session.positionSeconds, 0);
    assert.equal(result.session.volume, 100);
    assert.equal(result.session.muted, false);
    assert.equal(result.session.shuffleEnabled, false);
    assert.equal(result.session.repeatMode, "off");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("legacy migration emits deterministic collision-free IDs accepted by artwork and waveform lookups", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-v3-legacy-ids-"));
  const legacyPath = join(root, "player-session.json");
  const repository = new PlayerSessionRepository(legacyPath);
  try {
    await writeFile(legacyPath, JSON.stringify(legacyFixture()), "utf8");

    const first = await repository.readPlaybackSession();
    const repeated = await repository.readPlaybackSession();
    assert.equal(first.status, "migrated");
    assert.equal(repeated.status, "migrated");

    const generatedIds = (session: PersistedPlayerSessionV3): string[] => {
      const context = session.context;
      const current = session.current;
      assert.ok(context);
      assert.ok(current);
      assert.ok(current.historyEntryId);
      return [
        context.contextId,
        ...context.originalItems.map((entry) => entry.contextItemId),
        ...context.originalItems.map((entry) => entry.executionEntryId),
        current.playbackInstanceId,
        current.historyEntryId,
      ];
    };
    const firstIds = generatedIds(first.session);
    assert.deepEqual(firstIds, generatedIds(repeated.session));
    assert.equal(new Set(firstIds).size, firstIds.length);
    const generatedIdPattern = new RegExp(
      `^(?:context|context-item|execution|playback-item|history)-${opaqueUuid}$`,
      "u",
    );
    for (const id of firstIds) assert.match(id, generatedIdPattern);
    const context = first.session.context;
    const current = first.session.current;
    assert.ok(context);
    assert.ok(current);
    assert.equal(
      new Set(context.originalItems.map((entry) => entry.contextItemId)).size,
      context.originalItems.length,
    );
    assert.equal(
      new Set(context.originalItems.map((entry) => entry.executionEntryId))
        .size,
      context.originalItems.length,
    );

    const artwork: ArtworkRef = {
      id: "artwork-legacy-id-contract",
      mimeType: "image/png",
      sourceType: "folder",
      revision: "legacy-id-contract",
    };
    const enrichedPaths: string[] = [];
    const metadataService = {
      readForArtwork(path: string) {
        enrichedPaths.push(path);
        return Promise.resolve({
          cacheKey: `legacy:${path}`,
          metadata: emptyMetadata,
          pictures: [],
          artwork,
          hasEmbeddedArtwork: false,
          errorCode: null,
          fromCache: false,
        });
      },
      rememberArtwork: () => undefined,
    } as unknown as ConstructorParameters<typeof PlayerService>[0];
    const artworkService = {
      getResource: () => Promise.resolve(null),
    } as unknown as ConstructorParameters<typeof PlayerService>[1];
    const player = new PlayerService(metadataService, artworkService);
    (
      player as unknown as {
        playbackPlanSnapshot: ReturnType<typeof playbackPlanFromPlayerSession>;
      }
    ).playbackPlanSnapshot = playbackPlanFromPlayerSession(first.session);

    assert.equal(
      player.getQueueItemPath(current.playbackInstanceId),
      duplicatePath,
    );
    assert.equal(
      player.getQueueItemPath(current.executionEntryId),
      duplicatePath,
    );
    assert.deepEqual(
      context.originalItems.map((entry) =>
        player.getQueueItemPath(entry.executionEntryId),
      ),
      [duplicatePath, duplicatePath],
    );
    assert.deepEqual(
      await player.resolveQueueArtwork(current.playbackInstanceId),
      artwork,
    );
    assert.deepEqual(enrichedPaths, [duplicatePath]);
    assert.equal(
      player.getQueueItemPath(`playback-item-${legacySecondaryId}`),
      null,
    );
    assert.equal(
      await player.resolveQueueArtwork(`playback-item-${legacySecondaryId}`),
      null,
    );
    assert.deepEqual(enrichedPaths, [duplicatePath]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("v3 round-trips independent sections and atomically refreshes a valid v2 projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-v3-roundtrip-"));
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  const session = sessionFixture();
  try {
    await repository.writePlaybackSession(session);

    const result = await repository.readPlaybackSession();
    assert.equal(result.status, "loaded");
    assert.deepEqual(result.session, session);
    assert.deepEqual(
      result.session.explicitQueue.map((entry) => entry.item.nativePath),
      [duplicatePath, duplicatePath],
    );
    assert.equal(
      isPlaybackPlanSnapshot(playbackPlanFromPlayerSession(result.session)),
      true,
    );
    assert.deepEqual(
      playerSessionFromPlaybackPlan(playbackPlanFromPlayerSession(session), {
        positionSeconds: session.positionSeconds,
        volume: session.volume,
        muted: session.muted,
      }),
      session,
    );

    const rollback = await repository.read();
    assert.ok(rollback);
    assert.equal(rollback.queue.length, 3);
    assert.equal(new Set(rollback.queue.map((item) => item.id)).size, 3);
    assert.deepEqual(
      rollback.queue.map((item) =>
        item.origin.kind === "direct" ? item.origin.nativePath : null,
      ),
      [duplicatePath, duplicatePath, duplicatePath],
    );
    assert.equal(
      (await readdir(root)).some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("v3 parsing drops malformed items locally, clamps cursors, and bounds all collections", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-v3-repair-"));
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  const session = sessionFixture();
  const contexts = Array.from(
    { length: MAX_PLAYBACK_CONTEXT_ITEMS + 5 },
    (_, index) => contextItem(index),
  );
  const explicitQueue = Array.from(
    { length: MAX_EXPLICIT_QUEUE_ITEMS + 5 },
    (_, index) => ({
      explicitQueueEntryId: `explicit-${String(index)}`,
      playbackInstanceId: `playback-item-explicit-${String(index)}`,
      executionEntryId: `execution-explicit-${String(index)}`,
      item: playbackItem(`Explicit ${String(index)}`),
      addedSequence: index,
    }),
  );
  const history = Array.from(
    { length: MAX_PLAYBACK_HISTORY_ITEMS + 5 },
    (_, index) => ({
      ...historyEntry(index),
      // Repeat All may replay a Context item with the same technical entry.
      executionEntryId: "execution-history-repeated-context-item",
    }),
  );
  const raw: Record<string, unknown> = {
    ...session,
    context: {
      ...session.context,
      originalItems: [...contexts, { malformed: true }],
      playOrder: [
        "missing-context-item",
        contexts[0]?.contextItemId,
        contexts[0]?.contextItemId,
      ],
      resumeCursor: 999_999,
    },
    explicitQueue: [
      ...explicitQueue,
      { malformed: true },
      { ...explicitQueue[0], item: playbackItem("Duplicate ID") },
    ],
    history: { entries: [...history, { malformed: true }], cursor: 999_999 },
    pendingContinuation: {
      ...session.pendingContinuation,
      recentLibraryTrackIds: ["track-one", "", "track-one", "track-two"],
    },
  };
  try {
    await writeFile(
      repository.v3ConfigPath,
      `${JSON.stringify(raw, null, 2)}\n`,
      "utf8",
    );

    const result = await repository.readPlaybackSession();

    assert.equal(result.status, "loaded");
    assert.equal(
      result.session.context?.originalItems.length,
      MAX_PLAYBACK_CONTEXT_ITEMS,
    );
    assert.equal(
      result.session.context.playOrder.length,
      MAX_PLAYBACK_CONTEXT_ITEMS,
    );
    assert.equal(
      result.session.context.resumeCursor,
      MAX_PLAYBACK_CONTEXT_ITEMS,
    );
    assert.equal(result.session.explicitQueue.length, MAX_EXPLICIT_QUEUE_ITEMS);
    assert.equal(
      result.session.history.entries.length,
      MAX_PLAYBACK_HISTORY_ITEMS,
    );
    assert.equal(
      result.session.history.entries[0]?.historyEntryId,
      "history-5",
    );
    assert.equal(result.session.history.cursor, MAX_PLAYBACK_HISTORY_ITEMS - 1);
    assert.deepEqual(
      result.session.pendingContinuation?.recentLibraryTrackIds,
      ["track-one", "track-two"],
    );
    assert.equal(
      isPlaybackPlanSnapshot(playbackPlanFromPlayerSession(result.session)),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("an invalid Context does not discard Current, Explicit Queue, or History", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-v3-section-"));
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  const session = sessionFixture();
  const raw = {
    ...session,
    context: {
      ...session.context,
      title: "",
      originalItems: [{ broken: true }],
    },
    artistRadio: {
      contextId: "context-missing",
      artistId: "artist-main",
      bagCycle: 1,
    },
    explicitQueue: [session.explicitQueue[0], { broken: true }],
  };
  try {
    await writeFile(repository.v3ConfigPath, JSON.stringify(raw), "utf8");
    const result = await repository.readPlaybackSession();
    assert.equal(result.status, "loaded");
    assert.equal(result.session.context, null);
    assert.equal(result.session.artistRadio, null);
    assert.ok(result.session.current);
    assert.equal(result.session.explicitQueue.length, 1);
    assert.equal(result.session.history.entries.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("a future v3 session remains byte-for-byte untouched and enters read-only mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-v3-future-"));
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  const futureText = '{"version":99,"future":"preserve"}\n';
  try {
    await writeFile(repository.v3ConfigPath, futureText, "utf8");
    const result = await repository.readPlaybackSession();
    assert.deepEqual(result, { status: "future", source: "v3", version: 99 });
    await assert.rejects(
      repository.writePlaybackSession(sessionFixture()),
      /read-only/u,
    );
    await assert.rejects(repository.clearPlaybackSession(), /read-only/u);
    assert.equal(await readFile(repository.v3ConfigPath, "utf8"), futureText);
    assert.equal(
      (await readdir(root)).some((name) => name.includes(".corrupt-")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("a future canonical session is not mistaken for corruption or deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-legacy-future-"));
  const legacyPath = join(root, "player-session.json");
  const repository = new PlayerSessionRepository(legacyPath);
  const futureText = '{"version":77,"future":"preserve"}\n';
  try {
    await writeFile(legacyPath, futureText, "utf8");
    const result = await repository.readPlaybackSession();
    assert.deepEqual(result, {
      status: "future",
      source: "legacy",
      version: 77,
    });
    const projection = projectPlayerSessionV2(sessionFixture());
    assert.ok(projection);
    await assert.rejects(repository.write(projection), /read-only/u);
    await assert.rejects(repository.clear(), /read-only/u);
    assert.equal(await readFile(legacyPath, "utf8"), futureText);
    assert.equal(
      (await readdir(root)).some((name) => name.includes(".corrupt-")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("a corrupt v3 sidecar is preserved while a valid legacy session remains migratable", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-v3-corrupt-"));
  const legacyPath = join(root, "player-session.json");
  const repository = new PlayerSessionRepository(legacyPath);
  const corruptText = "{corrupt-v3";
  try {
    await writeFile(repository.v3ConfigPath, corruptText, "utf8");
    await writeFile(legacyPath, JSON.stringify(legacyFixture()), "utf8");

    const result = await repository.readPlaybackSession();

    assert.equal(result.status, "migrated");
    assert.equal(result.recoveredFromInvalidV3, true);
    assert.equal(await readFile(repository.v3ConfigPath, "utf8"), corruptText);
    const names = await readdir(root);
    assert.equal(
      names.some((name) => name.startsWith("player-session-v3.json.corrupt-")),
      true,
    );
    assert.equal(names.includes("player-session.json"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("rich removable and SMB legacy origins survive migration and v2 projection", () => {
  const legacy: PersistedPlayerSession = {
    version: 2,
    currentQueueItemId: legacyCurrentId,
    queue: [
      {
        id: legacyCurrentId,
        origin: {
          kind: "removable",
          deviceId: `usb-${"1".repeat(32)}`,
          relativePath: "Music/One.flac",
          entryId: `entry-${"2".repeat(32)}`,
        },
        filename: "One.flac",
        displayTitle: "One",
      },
      {
        id: legacySecondaryId,
        origin: {
          kind: "smb",
          connectionId: `smb-${"3".repeat(32)}`,
          relativePath: "Music/Two.flac",
          entryId: `entry-${"4".repeat(32)}`,
        },
        filename: "Two.flac",
        displayTitle: "Two",
      },
      {
        id: legacyThirdId,
        origin: {
          kind: "folders",
          sourceId: "55555555-5555-4555-8555-555555555555",
          relativePath: "Music/Three.flac",
          libraryTrackId: `track-${"6".repeat(32)}`,
          smb: true,
        },
        filename: "Three.flac",
        displayTitle: "Three",
      },
    ],
    positionSeconds: 0,
    volume: 100,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
  };

  const migrated = migrateLegacyPlayerSession(
    legacy,
    new Map([
      [legacyCurrentId, "/media/usb/Music/One.flac"],
      [legacySecondaryId, "/media/smb/Music/Two.flac"],
      [legacyThirdId, "/library/Music/Three.flac"],
    ]),
  );
  const projected = projectPlayerSessionV2(migrated);

  assert.ok(projected);
  assert.deepEqual(
    migrated.context?.originalItems.map((entry) => entry.item.nativePath),
    [
      "/media/usb/Music/One.flac",
      "/media/smb/Music/Two.flac",
      "/library/Music/Three.flac",
    ],
  );
  assert.deepEqual(projected.queue[0]?.origin, legacy.queue[0]?.origin);
  assert.deepEqual(projected.queue[1]?.origin, legacy.queue[1]?.origin);
  assert.deepEqual(projected.queue[2]?.origin, legacy.queue[2]?.origin);
});

void test("the rollback projection retains forward History ahead of Explicit Queue", () => {
  const session = sessionFixture();
  const forward = historyEntry(2);
  const projected = projectPlayerSessionV2({
    ...session,
    history: { entries: [...session.history.entries, forward], cursor: 0 },
  });

  assert.ok(projected);
  assert.deepEqual(
    projected.queue.map((entry) => entry.displayTitle),
    [
      "Context 1",
      "History 2",
      "Explicit duplicate one",
      "Explicit duplicate two",
    ],
  );
});
