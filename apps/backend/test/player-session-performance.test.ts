import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PlayerState } from "../../../packages/shared/src/player.js";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import type { SourceService } from "../src/filesystem/source-service.js";
import { PlaybackPlanner } from "../src/playback-plan/index.js";
import type {
  ExplicitQueueEntry,
  PlaybackContextItem,
  PlaybackHistoryEntry,
  PlaybackItemSnapshot,
  PlaybackPlanSnapshot,
} from "../src/playback-plan/playback-plan-types.js";
import { PlayerService } from "../src/player/player-service.js";
import {
  PlayerSessionRepository,
  playerSessionFromPlaybackPlan,
} from "../src/player-session/player-session-repository.js";
import { PlayerSessionService } from "../src/player-session/player-session-service.js";
import type { PlayerSessionSnapshot } from "../src/player-session/player-session-types.js";
import { remotePlayerState } from "../src/remote-access/remote-gateway.js";

const CONTEXT_COUNT = 2_000;
const EXPLICIT_COUNT = 2_000;
const HISTORY_COUNT = 100;
const PHYSICAL_TRACK_COUNT = 32;

function revisions(value = 1) {
  return {
    state: value,
    current: value,
    context: value,
    explicitQueue: value,
    history: value,
    execution: value,
    availability: value,
  };
}

function playerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    playerSessionId: "player-session-performance",
    trackTransitionId: 1,
    status: "stopped",
    mpvAvailable: true,
    mpvVersion: "test",
    currentTrack: null,
    positionSeconds: 123.5,
    durationSeconds: 240,
    paused: true,
    volume: 73,
    muted: false,
    shuffleEnabled: true,
    repeatMode: "all",
    currentQueueIndex: -1,
    queue: [],
    queueRevision: 1,
    audioDevice: "Default output",
    error: null,
    ...overrides,
  };
}

function playbackItem(label: string, nativePath: string): PlaybackItemSnapshot {
  return {
    nativePath,
    filename: `${label}.mp3`,
    title: label,
    artist: "Stress Artist",
    album: "Stress Album",
    durationSeconds: 240,
    libraryTrackId: null,
    availability: "available",
    origin: { kind: "direct" },
  };
}

function buildStressPlan(
  physicalPaths: readonly string[],
  missingPath: string,
): PlaybackPlanSnapshot {
  const contextItems: PlaybackContextItem[] = Array.from(
    { length: CONTEXT_COUNT },
    (_, index) => ({
      contextItemId: `context-item-stress-${String(index)}`,
      executionEntryId: `execution-context-stress-${String(index)}`,
      item: playbackItem(
        `Context ${String(index)}`,
        index > 0 && index % 257 === 0
          ? missingPath
          : (physicalPaths[index % physicalPaths.length] ?? missingPath),
      ),
    }),
  );
  const explicitQueue: ExplicitQueueEntry[] = Array.from(
    { length: EXPLICIT_COUNT },
    (_, index) => ({
      explicitQueueEntryId: `explicit-stress-${String(index)}`,
      playbackInstanceId: `playback-item-explicit-stress-${String(index)}`,
      executionEntryId: `execution-explicit-stress-${String(index)}`,
      item: playbackItem(
        `Explicit ${String(index)}`,
        index % 251 === 0
          ? missingPath
          : (physicalPaths[index % physicalPaths.length] ?? missingPath),
      ),
      addedSequence: CONTEXT_COUNT + index + 1,
    }),
  );
  const historyEntries: PlaybackHistoryEntry[] = Array.from(
    { length: HISTORY_COUNT },
    (_, index) => {
      if (index === HISTORY_COUNT - 1) {
        const currentContext = contextItems[0];
        assert.ok(currentContext);
        return {
          historyEntryId: `history-stress-${String(index)}`,
          playbackInstanceId: "playback-item-current-stress",
          executionEntryId: currentContext.executionEntryId,
          originalSource: "context",
          originalRelationId: currentContext.contextItemId,
          contextId: "context-stress",
          item: currentContext.item,
          startedSequence: CONTEXT_COUNT + EXPLICIT_COUNT + index + 1,
        };
      }
      return {
        historyEntryId: `history-stress-${String(index)}`,
        playbackInstanceId: `playback-item-history-stress-${String(index)}`,
        executionEntryId: `execution-history-stress-${String(index)}`,
        originalSource: "context",
        originalRelationId: `context-item-stress-${String(index)}`,
        contextId: "context-stress",
        item: playbackItem(
          `History ${String(index)}`,
          index % 37 === 0
            ? missingPath
            : (physicalPaths[index % physicalPaths.length] ?? missingPath),
        ),
        startedSequence: CONTEXT_COUNT + EXPLICIT_COUNT + index + 1,
      };
    },
  );
  const currentContext = contextItems[0];
  const currentHistory = historyEntries.at(-1);
  assert.ok(currentContext);
  assert.ok(currentHistory);
  return {
    schemaVersion: 1,
    current: {
      playbackInstanceId: currentHistory.playbackInstanceId,
      executionEntryId: currentContext.executionEntryId,
      source: "context",
      relationId: currentContext.contextItemId,
      contextId: "context-stress",
      historyEntryId: currentHistory.historyEntryId,
      item: currentContext.item,
      startedSequence: currentHistory.startedSequence,
    },
    context: {
      contextId: "context-stress",
      kind: "album",
      title: "Stress Album",
      entityId: "album-stress",
      continuationArtistId: "artist-stress",
      source: { label: "Stress Library" },
      originalItems: contextItems,
      playOrder: contextItems.map((entry) => entry.contextItemId),
      resumeCursor: 1,
      shuffleCycle: 3,
      repeatCycle: 2,
      availabilityRevision: 1,
    },
    explicitQueue,
    history: { entries: historyEntries, cursor: HISTORY_COUNT - 1 },
    artistRadio: null,
    pendingContinuation: null,
    shuffleEnabled: true,
    repeatMode: "all",
    continuePlayback: "same-artist",
    sequence: CONTEXT_COUNT + EXPLICIT_COUNT + HISTORY_COUNT,
    revisions: revisions(),
  };
}

class StressSessionPlayer {
  restoredPlayback: {
    readonly positionSeconds: number;
    readonly volume: number;
    readonly muted: boolean;
  } | null = null;

  constructor(
    private plan: PlaybackPlanSnapshot,
    private state = playerState(),
  ) {}

  getState(): PlayerState {
    return this.state;
  }

  getPlaybackPlanSnapshot(): PlaybackPlanSnapshot {
    return structuredClone(this.plan);
  }

  getSessionSnapshot(): PlayerSessionSnapshot {
    return {
      currentQueueItemId: null,
      queue: [],
      positionSeconds: this.state.positionSeconds,
      volume: this.state.volume,
      muted: this.state.muted,
      shuffleEnabled: this.plan.shuffleEnabled,
      repeatMode: this.plan.repeatMode,
    };
  }

  restorePlaybackPlan(
    snapshot: PlaybackPlanSnapshot,
    playback: {
      readonly positionSeconds: number;
      readonly volume: number;
      readonly muted: boolean;
    },
  ): Promise<void> {
    this.plan = structuredClone(snapshot);
    this.restoredPlayback = playback;
    this.state = {
      ...this.state,
      positionSeconds: playback.positionSeconds,
      volume: playback.volume,
      muted: playback.muted,
      shuffleEnabled: snapshot.shuffleEnabled,
      repeatMode: snapshot.repeatMode,
    };
    return Promise.resolve();
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

function assertMeasured(value: number): void {
  assert.equal(Number.isFinite(value), true);
  assert.ok(value >= 0);
}

void test("v3 persistence handles 2k Context, 2k duplicate Explicit entries and 100 History entries", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "eidetic-native-path-sentinel-session-stress-"),
  );
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  try {
    const physicalPaths = Array.from({ length: PHYSICAL_TRACK_COUNT }, (_, i) =>
      join(root, `physical-${String(i).padStart(2, "0")}.mp3`),
    );
    await Promise.all(physicalPaths.map((path) => writeFile(path, "")));
    const missingPath = join(root, "missing.mp3");

    const snapshotStart = performance.now();
    const plan = buildStressPlan(physicalPaths, missingPath);
    const session = playerSessionFromPlaybackPlan(plan, {
      positionSeconds: 123.5,
      volume: 73,
      muted: false,
    });
    const payload = JSON.stringify(session);
    const snapshotMilliseconds = performance.now() - snapshotStart;
    assert.match(payload, /eidetic-native-path-sentinel-session-stress/u);

    const writeStart = performance.now();
    await repository.writePlaybackSession(session, null);
    const writeMilliseconds = performance.now() - writeStart;
    const initialFileBytes = (await stat(repository.v3ConfigPath)).size;

    const readStart = performance.now();
    const read = await repository.readPlaybackSession();
    const readMilliseconds = performance.now() - readStart;
    assert.equal(read.status, "loaded");
    assert.equal(read.session.context?.originalItems.length, CONTEXT_COUNT);
    assert.equal(read.session.explicitQueue.length, EXPLICIT_COUNT);
    assert.equal(read.session.history.entries.length, HISTORY_COUNT);

    const fake = new StressSessionPlayer({
      ...plan,
      current: null,
      context: null,
      explicitQueue: [],
      history: { entries: [], cursor: -1 },
    });
    const provider = new LocalFilesystemProvider();
    const service = new PlayerSessionService(
      repository,
      provider,
      PathService.forCurrentPlatform(provider),
      {} as SourceService,
      fake as unknown as PlayerService,
    );
    const restoreStart = performance.now();
    const restore = await service.restore();
    const restoreMilliseconds = performance.now() - restoreStart;
    assert.equal(restore.status, "restored");
    assert.equal(restore.savedCount, 4_101);
    assert.equal(restore.restoredCount, 4_083);
    assert.equal(restore.discardedCount, 18);
    assert.deepEqual(fake.restoredPlayback, {
      positionSeconds: 123.5,
      volume: 73,
      muted: false,
    });

    const repaired = fake.getPlaybackPlanSnapshot();
    assert.ok(repaired.context);
    assert.equal(repaired.context.originalItems.length, 1_993);
    assert.equal(repaired.context.playOrder.length, 1_993);
    assert.equal(repaired.context.resumeCursor, 1);
    assert.equal(repaired.explicitQueue.length, 1_992);
    assert.equal(repaired.history.entries.length, 97);
    assert.equal(repaired.history.cursor, 96);
    assert.ok(
      repaired.explicitQueue.filter(
        (entry) => entry.item.nativePath === physicalPaths[1],
      ).length > 1,
    );
    assert.equal(
      repaired.explicitQueue.some(
        (entry) => entry.item.nativePath === missingPath,
      ),
      false,
    );

    const persistedAfterRepair = await repository.readPlaybackSession();
    assert.equal(persistedAfterRepair.status, "loaded");
    assert.equal(
      persistedAfterRepair.session.context?.originalItems.length,
      1_993,
    );
    assert.equal(persistedAfterRepair.session.explicitQueue.length, 1_992);
    assert.equal(persistedAfterRepair.session.history.entries.length, 97);

    const repairedFileBytes = (await stat(repository.v3ConfigPath)).size;
    const compatibilityFileBytes = (await stat(repository.configPath)).size;
    const metrics = {
      snapshotMilliseconds,
      compactPayloadBytes: Buffer.byteLength(payload),
      initialFileBytes,
      writeMilliseconds,
      readMilliseconds,
      restoreMilliseconds,
      verificationMilliseconds: restore.verificationMilliseconds,
      prepareMilliseconds: restore.prepareMilliseconds,
      repairedFileBytes,
      compatibilityFileBytes,
    };
    for (const value of Object.values(metrics)) assertMeasured(value);
    assert.ok(metrics.compactPayloadBytes > 0);
    assert.ok(metrics.initialFileBytes > 0);
    t.diagnostic(`Player Session stress metrics: ${JSON.stringify(metrics)}`);

    const publicPlayer = new PlayerService();
    const publicHarness = publicPlayer as unknown as {
      readonly playbackPlanner: PlaybackPlanner;
      playbackPlanSnapshot: PlaybackPlanSnapshot;
    };
    publicHarness.playbackPlanner.restore(repaired);
    publicHarness.playbackPlanSnapshot =
      publicHarness.playbackPlanner.snapshot();
    const publicPayload = JSON.stringify(publicPlayer.getPublicState());
    assert.doesNotMatch(publicPayload, /nativePath/u);
    assert.doesNotMatch(
      publicPayload,
      /eidetic-native-path-sentinel-session-stress/u,
    );
    const remotePayload = JSON.stringify(
      remotePlayerState(publicPlayer.getPublicState()),
    );
    assert.doesNotMatch(remotePayload, /nativePath/u);
    assert.doesNotMatch(
      remotePayload,
      /eidetic-native-path-sentinel-session-stress/u,
    );

    assert.match(
      await readFile(repository.v3ConfigPath, "utf8"),
      /eidetic-native-path-sentinel-session-stress/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
