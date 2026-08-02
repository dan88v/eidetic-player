import assert from "node:assert/strict";
import test from "node:test";
import type {
  PlayerState,
  QueueItem,
} from "../../../packages/shared/src/player.js";
import { PlaybackPlanner } from "../src/playback-plan/index.js";
import { playerAnalysisTrackId } from "../src/analysis/audio-analyzer-service.js";
import { PlayerError } from "../src/player/player-error.js";
import { PlayerService } from "../src/player/player-service.js";

interface PlayerHarness {
  state: PlayerState;
  playbackPlanSnapshot: ReturnType<PlaybackPlanner["snapshot"]>;
  syncPlaybackPlan(): void;
}

function technicalQueueItem(
  entry: ReturnType<PlaybackPlanner["projectExecutionPlan"]>["future"][number],
  index: number,
  current: boolean,
): QueueItem {
  return {
    id: entry.executionEntryId,
    ...(entry.playbackInstanceId
      ? { playbackInstanceId: entry.playbackInstanceId }
      : {}),
    index,
    path: entry.item.nativePath,
    filename: entry.item.filename,
    displayTitle: entry.item.title,
    ...(typeof entry.item.durationSeconds === "number"
      ? { durationSeconds: entry.item.durationSeconds }
      : {}),
    artwork: null,
    isCurrent: current,
    available: entry.item.availability !== "unavailable",
    ...(entry.item.libraryTrackId
      ? { libraryTrackId: entry.item.libraryTrackId }
      : {}),
  };
}

function playerFixture(): {
  readonly player: PlayerService;
  readonly harness: PlayerHarness;
  readonly explicitIds: readonly string[];
} {
  const player = new PlayerService();
  const harness = player as unknown as PlayerHarness;
  const planner = (
    player as unknown as { readonly playbackPlanner: PlaybackPlanner }
  ).playbackPlanner;
  planner.startContext({
    kind: "album",
    title: "Public contract album",
    entityId: "album-public-contract",
    source: { label: "Library" },
    selectedIndex: 0,
    items: [
      {
        nativePath: "C:/do-not-expose-source-root/context-current.flac",
        filename: "context-current.flac",
        title: "Context current",
        artist: "Fixture Artist",
        album: "Fixture Album",
        durationSeconds: 180,
        origin: { kind: "direct" },
      },
      {
        nativePath: "C:/do-not-expose-source-root/context-next.flac",
        filename: "context-next.flac",
        title: "Context next",
        artist: "Fixture Artist",
        album: "Fixture Album",
        durationSeconds: 181,
        origin: { kind: "direct" },
      },
    ],
  });
  const explicit = planner.enqueueExplicit([
    {
      nativePath: "C:/do-not-expose-source-root/explicit-a.flac",
      filename: "explicit-a.flac",
      title: "Explicit A",
      artist: "Fixture Artist",
      album: "Fixture Album",
      durationSeconds: 182,
      origin: { kind: "direct" },
    },
    {
      nativePath: "C:/do-not-expose-source-root/explicit-b.flac",
      filename: "explicit-b.flac",
      title: "Explicit B",
      artist: "Fixture Artist",
      album: "Fixture Album",
      durationSeconds: 183,
      origin: { kind: "direct" },
    },
  ]);
  harness.playbackPlanSnapshot = planner.snapshot();

  const execution = planner.projectExecutionPlan();
  assert.ok(execution.current);
  const entries = [execution.current, ...execution.future];
  harness.state = {
    ...player.getState(),
    status: "playing",
    mpvAvailable: true,
    currentTrack: {
      path: execution.current.item.nativePath,
      filename: execution.current.item.filename,
      title: execution.current.item.title,
      artist: "Fixture Artist",
      album: "Fixture Album",
      artists: ["Fixture Artist"],
      albumArtist: "Fixture Artist",
      trackNumber: 1,
      trackTotal: 2,
      discNumber: 1,
      discTotal: 1,
      year: 2026,
      genre: ["Test"],
      durationSeconds: 180,
      format: "FLAC",
      codec: "flac",
      sampleRate: 44_100,
      bitDepth: 16,
      bitrate: 800_000,
      lossless: true,
      container: "FLAC",
      artwork: null,
      source: "Local File",
    },
    durationSeconds: 180,
    currentQueueIndex: 0,
    queue: entries.map((entry, index) =>
      technicalQueueItem(entry, index, index === 0),
    ),
  };

  return {
    player,
    harness,
    explicitIds: explicit.map((entry) => entry.explicitQueueEntryId),
  };
}

void test("getPublicState exposes Current separately and aliases only the Explicit Queue", () => {
  const { player, harness, explicitIds } = playerFixture();
  const publicState = player.getPublicState();
  const publicExplicitIds =
    publicState.explicitQueue?.map((entry) => entry.explicitQueueEntryId) ?? [];

  assert.deepEqual(publicExplicitIds, explicitIds);
  assert.deepEqual(
    publicState.queue.map((entry) => entry.id),
    explicitIds,
  );
  assert.equal(publicState.queue.length, 2);
  assert.ok(harness.state.queue.length > publicState.queue.length);
  assert.equal(publicState.currentQueueIndex, -1);
  assert.ok(publicState.currentPlayback);
  assert.equal(publicState.currentPlayback.source, "context");
  assert.equal(
    publicState.queue.some(
      (entry) =>
        entry.id === publicState.currentPlayback?.playbackInstanceId ||
        entry.isCurrent,
    ),
    false,
  );
  assert.ok(
    publicState.queue.every((entry) =>
      entry.path.startsWith("queue-entry://explicit-"),
    ),
  );
  assert.equal(
    publicState.queue.some((entry) =>
      harness.state.queue.some((technical) => technical.id === entry.id),
    ),
    false,
  );

  const nestedContract = JSON.stringify({
    currentPlayback: publicState.currentPlayback,
    explicitQueue: publicState.explicitQueue,
    playbackContext: publicState.playbackContext,
    playbackHistory: publicState.playbackHistory,
    playbackContinuation: publicState.playbackContinuation,
  });
  assert.doesNotMatch(
    nestedContract,
    /nativePath|do-not-expose-source-root|executionEntryId|contextItemId/u,
  );
  assert.doesNotMatch(
    JSON.stringify(publicState),
    /do-not-expose-source-root|"(?:originalItems|playOrder|executionEntryId|contextItemId)"/u,
  );
});

void test("analyzer and public Current share playback occurrence identity", () => {
  const { player, harness } = playerFixture();
  const publicState = player.getPublicState();
  const current = harness.state.queue[harness.state.currentQueueIndex];
  assert.ok(current);
  assert.equal(
    playerAnalysisTrackId(harness.state),
    publicState.currentPlayback?.playbackInstanceId,
  );
  assert.notEqual(playerAnalysisTrackId(harness.state), current.id);
});

void test("duration-only Explicit enrichment invalidates public presentation without position churn", () => {
  const { player, harness } = playerFixture();
  const explicit = harness.playbackPlanSnapshot.explicitQueue[0];
  assert.ok(explicit);
  harness.playbackPlanSnapshot = {
    ...harness.playbackPlanSnapshot,
    explicitQueue: [
      {
        ...explicit,
        item: { ...explicit.item, durationSeconds: null },
      },
      ...harness.playbackPlanSnapshot.explicitQueue.slice(1),
    ],
  };
  harness.state = {
    ...harness.state,
    queue: harness.state.queue.map((item) =>
      item.id === explicit.executionEntryId
        ? { ...item, durationSeconds: undefined }
        : item,
    ),
  };
  const initial = player.getPublicState();
  assert.equal(initial.explicitQueue?.[0]?.item.durationSeconds, undefined);

  harness.state = {
    ...harness.state,
    queue: harness.state.queue.map((item) =>
      item.id === explicit.executionEntryId
        ? { ...item, durationSeconds: 55 }
        : item,
    ),
  };
  const enriched = player.getPublicState();
  assert.equal(enriched.queueRevision, initial.queueRevision);
  assert.notEqual(enriched.explicitQueue, initial.explicitQueue);
  assert.equal(enriched.explicitQueue?.[0]?.item.durationSeconds, 55);

  harness.state = { ...harness.state, positionSeconds: 12 };
  assert.equal(player.getPublicState().explicitQueue, enriched.explicitQueue);
});

void test("same-path technical occurrences advance the observed track generation", () => {
  const { harness } = playerFixture();
  const technical = harness as PlayerHarness & {
    readonly properties: Map<string, unknown>;
    playlistItemIds: string[];
    readonly mpvExecutionIds: Map<number, string>;
    enrichmentPathKey: string | null;
    trackTransitionId: number;
    pathKey(path: string): string;
    deriveStateFromProperties(): void;
  };
  const first = harness.state.queue[0];
  assert.ok(first);
  const planned = technical.playbackPlanSnapshot.current;
  assert.ok(planned);
  const secondId = "execution-22222222-2222-4222-8222-222222222222";
  technical.playbackPlanSnapshot = {
    ...technical.playbackPlanSnapshot,
    current: { ...planned, executionEntryId: secondId },
  };
  harness.state = {
    ...harness.state,
    trackTransitionId: 9,
    currentQueueIndex: 0,
    queue: [
      { ...first, index: 0, isCurrent: true },
      { ...first, id: secondId, index: 1, isCurrent: false },
    ],
  };
  technical.trackTransitionId = 9;
  technical.playlistItemIds = [first.id, secondId];
  technical.mpvExecutionIds.set(101, first.id);
  technical.mpvExecutionIds.set(102, secondId);
  technical.enrichmentPathKey = technical.pathKey(first.path);
  technical.properties.set("path", first.path);
  technical.properties.set("playlist-pos", 1);
  technical.properties.set("playlist-playing-pos", 1);
  technical.properties.set("duration", 180);
  technical.properties.set("time-pos", 0);
  technical.properties.set("pause", false);
  technical.properties.set("idle-active", false);
  technical.properties.set("playlist", [
    { id: 101, filename: first.path },
    { id: 102, filename: first.path, playing: true },
  ]);

  technical.deriveStateFromProperties();

  assert.equal(harness.state.currentQueueIndex, 1);
  assert.equal(harness.state.currentTrack?.path, first.path);
  assert.equal(harness.state.trackTransitionId, 10);
});

void test("technical Queue rebuild never inherits artwork from a different path at the same index", () => {
  const player = new PlayerService();
  const staleArtwork = {
    id: "artwork-current",
    mimeType: "image/jpeg" as const,
    sourceType: "embedded" as const,
    revision: "current-revision",
  };
  const technical = player as unknown as {
    state: PlayerState;
    playlistItemIds: string[];
    createQueue(
      value: unknown,
      currentIndex: number,
      currentDurationSeconds: number,
    ): QueueItem[];
  };
  technical.state = {
    ...player.getState(),
    currentQueueIndex: 0,
    queue: [
      {
        id: "execution-old",
        index: 0,
        path: "C:/music/current.flac",
        filename: "current.flac",
        displayTitle: "Current",
        durationSeconds: 180,
        artwork: staleArtwork,
        isCurrent: true,
      },
    ],
  };
  technical.playlistItemIds = ["execution-new"];

  const rebuilt = technical.createQueue(
    [{ filename: "C:/music/explicit.flac", title: "Explicit" }],
    0,
    181,
  );
  const rebuiltItem = rebuilt[0];
  assert.ok(rebuiltItem);

  assert.equal(rebuiltItem.artwork, null);
  assert.equal(rebuiltItem.durationSeconds, 181);
});

void test("PlayerService rejects stale explicit index and Queue revision assertions", async () => {
  const { player, explicitIds } = playerFixture();
  const [firstId, secondId] = explicitIds;
  assert.ok(firstId);
  assert.ok(secondId);

  await assert.rejects(
    player.playQueueIndex(0, undefined, secondId),
    (error: unknown) => {
      assert.ok(error instanceof PlayerError);
      assert.equal(error.code, "STALE_QUEUE_INDEX");
      assert.equal(error.statusCode, 409);
      return true;
    },
  );

  const revision = player.getPublicState().queueRevision;
  await assert.rejects(
    player.reorderQueueItem(firstId, 1, revision + 1),
    (error: unknown) => {
      assert.ok(error instanceof PlayerError);
      assert.equal(error.code, "STALE_QUEUE_REVISION");
      assert.equal(error.statusCode, 409);
      return true;
    },
  );
});

void test("a planner transition freezes the old coherent Current until MPV confirms the new one", () => {
  const { player, harness } = playerFixture();
  const planner = (
    player as unknown as { readonly playbackPlanner: PlaybackPlanner }
  ).playbackPlanner;
  const observed = harness.state.currentTrack;
  assert.ok(observed);
  harness.state = {
    ...harness.state,
    currentTrack: {
      ...observed,
      title: "Stale observed title",
      artwork: {
        id: "stale-artwork",
        mimeType: "image/jpeg",
        sourceType: "embedded",
        revision: "1",
      },
    },
  };

  const decision = planner.next();
  assert.equal(decision.kind, "start");
  const previousTransitionId = harness.state.trackTransitionId;
  const previousPlanRevision = player.getPublicState().playbackPlanRevision;
  harness.syncPlaybackPlan();

  const publicState = player.getPublicState();
  const transitioning = publicState.currentPlayback;
  assert.ok(transitioning);
  assert.equal(
    player.getPlaybackPlanSnapshot().current?.item.title,
    "Explicit A",
  );
  assert.equal(publicState.trackTransitionId, previousTransitionId);
  assert.equal(publicState.playbackPlanRevision, previousPlanRevision);
  assert.equal(publicState.currentTrack?.title, "Stale observed title");
  assert.equal(publicState.positionSeconds, 0);
  assert.equal(publicState.durationSeconds, 180);
  assert.equal(transitioning.source, "context");
  assert.equal(transitioning.item.displayTitle, "Stale observed title");
  assert.equal(transitioning.item.artwork?.id, "stale-artwork");
  assert.notEqual(transitioning.item.displayTitle, "Explicit A");
});

void test("getSessionSnapshot orders forward History before Explicit Queue and remaining Context without collisions", () => {
  const player = new PlayerService();
  const harness = player as unknown as PlayerHarness;
  const planner = (
    player as unknown as { readonly playbackPlanner: PlaybackPlanner }
  ).playbackPlanner;
  planner.startContext({
    kind: "album",
    title: "Rollback context",
    source: { label: "Library" },
    selectedIndex: 0,
    items: [
      {
        nativePath: "C:/rollback/context-current.flac",
        filename: "context-current.flac",
        title: "Context current",
        origin: { kind: "direct" },
      },
      {
        nativePath: "C:/rollback/context-next.flac",
        filename: "context-next.flac",
        title: "Context next",
        origin: { kind: "direct" },
      },
    ],
  });
  planner.enqueueExplicit([
    {
      nativePath: "C:/rollback/forward-history.flac",
      filename: "forward-history.flac",
      title: "Forward history",
      origin: { kind: "direct" },
    },
    {
      nativePath: "C:/rollback/explicit.flac",
      filename: "explicit.flac",
      title: "Explicit future",
      origin: { kind: "direct" },
    },
  ]);
  assert.equal(planner.next().kind, "start");
  assert.equal(planner.previous(0).kind, "start");
  harness.playbackPlanSnapshot = planner.snapshot();

  const plan = harness.playbackPlanSnapshot;
  assert.equal(plan.history.entries.length, 2);
  assert.equal(plan.history.cursor, 0);
  assert.equal(plan.explicitQueue.length, 1);
  assert.equal(
    (plan.context?.playOrder.length ?? 0) - (plan.context?.resumeCursor ?? 0),
    1,
  );

  const snapshot = player.getSessionSnapshot();
  assert.deepEqual(
    snapshot.queue.map((entry) => entry.displayTitle),
    ["Context current", "Forward history", "Explicit future", "Context next"],
  );
  assert.equal(snapshot.currentQueueItemId, snapshot.queue[0]?.id);
  assert.equal(new Set(snapshot.queue.map((entry) => entry.id)).size, 4);
  for (const entry of snapshot.queue)
    assert.match(
      entry.id,
      /^queue-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
  assert.deepEqual(
    snapshot.queue.map((entry) =>
      entry.origin.kind === "direct" ? entry.origin.nativePath : null,
    ),
    [
      "C:/rollback/context-current.flac",
      "C:/rollback/forward-history.flac",
      "C:/rollback/explicit.flac",
      "C:/rollback/context-next.flac",
    ],
  );
});
