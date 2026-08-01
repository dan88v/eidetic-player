import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PlayerState } from "../../../packages/shared/src/player.js";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import type { SourceService } from "../src/filesystem/source-service.js";
import type {
  ExplicitQueueEntry,
  PlaybackContextItem,
  PlaybackHistoryEntry,
  PlaybackItemSnapshot,
  PlaybackPlanSnapshot,
} from "../src/playback-plan/playback-plan-types.js";
import type { PlayerService } from "../src/player/player-service.js";
import {
  PlayerSessionRepository,
  playerSessionFromPlaybackPlan,
} from "../src/player-session/player-session-repository.js";
import { PlayerSessionService } from "../src/player-session/player-session-service.js";
import type { PlayerSessionSnapshot } from "../src/player-session/player-session-types.js";

function revisions(value = 0) {
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

function emptyPlan(): PlaybackPlanSnapshot {
  return {
    schemaVersion: 1,
    current: null,
    context: null,
    explicitQueue: [],
    history: { entries: [], cursor: -1 },
    artistRadio: null,
    pendingContinuation: null,
    shuffleEnabled: false,
    repeatMode: "off",
    continuePlayback: "off",
    sequence: 0,
    revisions: revisions(),
  };
}

function state(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    playerSessionId: "player-session-test",
    trackTransitionId: 0,
    status: "stopped",
    mpvAvailable: true,
    mpvVersion: "test",
    currentTrack: null,
    positionSeconds: 0,
    durationSeconds: 0,
    paused: true,
    volume: 100,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    currentQueueIndex: -1,
    queue: [],
    queueRevision: 0,
    audioDevice: "Default output",
    error: null,
    ...overrides,
  };
}

function item(name: string, nativePath: string): PlaybackItemSnapshot {
  return {
    nativePath,
    filename: `${name}.mp3`,
    title: name,
    artist: null,
    album: null,
    durationSeconds: null,
    libraryTrackId: null,
    availability: "available",
    origin: { kind: "direct" },
  };
}

function contextEntry(id: string, nativePath: string): PlaybackContextItem {
  return {
    contextItemId: `context-item-${id}`,
    executionEntryId: `execution-context-${id}`,
    item: item(`Context ${id}`, nativePath),
  };
}

function explicitEntry(id: string, nativePath: string): ExplicitQueueEntry {
  return {
    explicitQueueEntryId: `explicit-${id}`,
    playbackInstanceId: `playback-item-explicit-${id}`,
    executionEntryId: `execution-explicit-${id}`,
    item: item(`Explicit ${id}`, nativePath),
    addedSequence: Number(id.replace(/\D/gu, "")) || 1,
  };
}

function historyEntry(id: string, nativePath: string): PlaybackHistoryEntry {
  return {
    historyEntryId: `history-${id}`,
    playbackInstanceId: `playback-item-history-${id}`,
    executionEntryId: `execution-history-${id}`,
    originalSource: "context",
    originalRelationId: `context-item-${id}`,
    contextId: "context-main",
    item: item(`History ${id}`, nativePath),
    startedSequence: Number(id.replace(/\D/gu, "")) || 1,
  };
}

class FakeSessionPlayer {
  private readonly listeners = new Set<(state: PlayerState) => void>();
  restoreCalls = 0;
  restoredPlayback: {
    readonly positionSeconds: number;
    readonly volume: number;
    readonly muted: boolean;
  } | null = null;

  constructor(plan: PlaybackPlanSnapshot, playerState = state()) {
    this.plan = structuredClone(plan);
    this.playerState = playerState;
  }

  private plan: PlaybackPlanSnapshot;
  private playerState: PlayerState;

  getState(): PlayerState {
    return this.playerState;
  }

  getPlaybackPlanSnapshot(): PlaybackPlanSnapshot {
    return structuredClone(this.plan);
  }

  getSessionSnapshot(): PlayerSessionSnapshot {
    return {
      currentQueueItemId: null,
      queue: [],
      positionSeconds: this.playerState.positionSeconds,
      volume: this.playerState.volume,
      muted: this.playerState.muted,
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
    this.restoreCalls += 1;
    this.plan = structuredClone(snapshot);
    this.restoredPlayback = playback;
    this.playerState = {
      ...this.playerState,
      positionSeconds: playback.positionSeconds,
      volume: playback.volume,
      muted: playback.muted,
      shuffleEnabled: snapshot.shuffleEnabled,
      repeatMode: snapshot.repeatMode,
    };
    return Promise.resolve();
  }

  subscribe(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setPlan(plan: PlaybackPlanSnapshot): void {
    this.plan = structuredClone(plan);
  }

  emit(patch: Partial<PlayerState>): void {
    this.playerState = { ...this.playerState, ...patch };
    for (const listener of this.listeners) listener(this.playerState);
  }
}

function serviceFixture(
  repository: PlayerSessionRepository,
  fake: FakeSessionPlayer,
): PlayerSessionService {
  const provider = new LocalFilesystemProvider();
  return new PlayerSessionService(
    repository,
    provider,
    PathService.forCurrentPlatform(provider),
    {} as SourceService,
    fake as unknown as PlayerService,
  );
}

void test("v3 restore repairs sections independently and selects available forward History safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-service-v3-"));
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  try {
    const missing = join(root, "missing.mp3");
    const contextPath = join(root, "context.mp3");
    const explicitPath = join(root, "explicit.mp3");
    const historyPath = join(root, "history.mp3");
    await Promise.all([
      writeFile(contextPath, ""),
      writeFile(explicitPath, ""),
      writeFile(historyPath, ""),
    ]);
    const missingContext = contextEntry("missing", missing);
    const availableContext = contextEntry("available", contextPath);
    const missingHistory = historyEntry("missing", missing);
    const availableHistory = historyEntry("available", historyPath);
    const plan: PlaybackPlanSnapshot = {
      ...emptyPlan(),
      current: {
        playbackInstanceId: "playback-item-current-missing",
        executionEntryId: missingContext.executionEntryId,
        source: "context",
        relationId: missingContext.contextItemId,
        contextId: "context-main",
        historyEntryId: missingHistory.historyEntryId,
        item: missingContext.item,
        startedSequence: 1,
      },
      context: {
        contextId: "context-main",
        kind: "album",
        title: "Album",
        entityId: "album-main",
        continuationArtistId: null,
        source: { label: "Album" },
        originalItems: [missingContext, availableContext],
        playOrder: [
          missingContext.contextItemId,
          availableContext.contextItemId,
        ],
        resumeCursor: 1,
        shuffleCycle: 0,
        repeatCycle: 0,
        availabilityRevision: 0,
      },
      explicitQueue: [
        explicitEntry("missing", missing),
        explicitEntry("available", explicitPath),
      ],
      history: {
        entries: [missingHistory, availableHistory],
        cursor: 0,
      },
      sequence: 5,
      revisions: revisions(5),
    };
    await repository.writePlaybackSession(
      playerSessionFromPlaybackPlan(plan, {
        positionSeconds: 81,
        volume: 62,
        muted: true,
      }),
    );
    const fake = new FakeSessionPlayer(emptyPlan());
    const service = serviceFixture(repository, fake);

    const result = await service.restore();

    assert.equal(result.status, "restored");
    assert.ok(result.discardedCount > 0);
    assert.deepEqual(fake.restoredPlayback, {
      positionSeconds: 0,
      volume: 62,
      muted: true,
    });
    const restored = fake.getPlaybackPlanSnapshot();
    assert.equal(restored.current?.source, "history");
    assert.equal(restored.current.item.nativePath, historyPath);
    assert.equal(restored.context?.originalItems.length, 1);
    assert.equal(restored.context.resumeCursor, 0);
    assert.equal(restored.explicitQueue.length, 1);
    assert.equal(restored.explicitQueue[0]?.item.nativePath, explicitPath);
    assert.equal(restored.history.entries.length, 1);
    assert.equal(restored.history.cursor, 0);

    const persisted = await repository.readPlaybackSession();
    assert.equal(persisted.status, "loaded");
    assert.equal(persisted.session.current?.source, "history");
    assert.equal(persisted.session.context?.originalItems.length, 1);
    assert.equal(persisted.session.explicitQueue.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("MPV recovery restores an explicit-only v3 session without consuming its staged queue", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-recovery-v3-"));
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  let service: PlayerSessionService | null = null;
  try {
    const firstPath = join(root, "first.mp3");
    const secondPath = join(root, "second.mp3");
    await Promise.all([writeFile(firstPath, ""), writeFile(secondPath, "")]);
    const first = explicitEntry("1", firstPath);
    const second = explicitEntry("2", secondPath);
    const stagedPlan: PlaybackPlanSnapshot = {
      ...emptyPlan(),
      explicitQueue: [first, second],
      sequence: 2,
      revisions: {
        ...revisions(2),
        current: 0,
        context: 0,
        history: 0,
        availability: 0,
      },
    };
    await repository.writePlaybackSession(
      playerSessionFromPlaybackPlan(stagedPlan, {
        positionSeconds: 47,
        volume: 64,
        muted: true,
      }),
    );
    const beforeRecovery = await readFile(repository.v3ConfigPath, "utf8");
    const fake = new FakeSessionPlayer(
      emptyPlan(),
      state({ status: "unavailable", mpvAvailable: false }),
    );
    service = serviceFixture(repository, fake);

    const deferred = await service.restore();

    assert.deepEqual(deferred, {
      status: "empty",
      savedCount: 0,
      restoredCount: 0,
      discardedCount: 0,
      readMilliseconds: 0,
      verificationMilliseconds: 0,
      prepareMilliseconds: 0,
    });
    assert.equal(fake.restoreCalls, 0);
    assert.equal(
      await readFile(repository.v3ConfigPath, "utf8"),
      beforeRecovery,
    );

    service.start();
    await service.flush();
    assert.equal(service.diagnostics().writes, 0);
    assert.equal(
      await readFile(repository.v3ConfigPath, "utf8"),
      beforeRecovery,
    );

    fake.emit({ status: "idle", mpvAvailable: true });
    const recovered = await service.restore();

    assert.equal(recovered.status, "restored");
    assert.equal(recovered.savedCount, 2);
    assert.equal(recovered.restoredCount, 2);
    assert.equal(recovered.discardedCount, 0);
    assert.equal(fake.restoreCalls, 1);
    assert.deepEqual(fake.restoredPlayback, {
      positionSeconds: 0,
      volume: 64,
      muted: true,
    });
    const restored = fake.getPlaybackPlanSnapshot();
    assert.equal(restored.current, null);
    assert.equal(restored.context, null);
    assert.deepEqual(restored.history, { entries: [], cursor: -1 });
    assert.deepEqual(
      restored.explicitQueue.map((entry) => ({
        explicitQueueEntryId: entry.explicitQueueEntryId,
        playbackInstanceId: entry.playbackInstanceId,
        executionEntryId: entry.executionEntryId,
        nativePath: entry.item.nativePath,
      })),
      [first, second].map((entry) => ({
        explicitQueueEntryId: entry.explicitQueueEntryId,
        playbackInstanceId: entry.playbackInstanceId,
        executionEntryId: entry.executionEntryId,
        nativePath: entry.item.nativePath,
      })),
    );

    const persisted = await repository.readPlaybackSession();
    assert.equal(persisted.status, "loaded");
    assert.equal(persisted.session.current, null);
    assert.equal(persisted.session.positionSeconds, 0);
    assert.equal(persisted.session.volume, 64);
    assert.equal(persisted.session.muted, true);
    assert.deepEqual(
      persisted.session.explicitQueue.map((entry) => ({
        explicitQueueEntryId: entry.explicitQueueEntryId,
        playbackInstanceId: entry.playbackInstanceId,
        executionEntryId: entry.executionEntryId,
      })),
      [first, second].map((entry) => ({
        explicitQueueEntryId: entry.explicitQueueEntryId,
        playbackInstanceId: entry.playbackInstanceId,
        executionEntryId: entry.executionEntryId,
      })),
    );
    assert.equal(service.diagnostics().writes, 1);
  } finally {
    service?.stop();
    await rm(root, { recursive: true, force: true });
  }
});

void test("explicit-only stopped state persists while position ticks do not schedule writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-service-save-"));
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  try {
    const path = join(root, "explicit.mp3");
    await writeFile(path, "");
    const first = explicitEntry("1", path);
    const initial: PlaybackPlanSnapshot = {
      ...emptyPlan(),
      explicitQueue: [first],
      sequence: 1,
      revisions: {
        ...revisions(1),
        current: 0,
        context: 0,
        history: 0,
        availability: 0,
      },
    };
    const fake = new FakeSessionPlayer(initial);
    const service = serviceFixture(repository, fake);
    service.start();

    await service.flush();
    assert.equal(service.diagnostics().writes, 1);
    let persisted = await repository.readPlaybackSession();
    assert.equal(persisted.status, "loaded");
    assert.equal(persisted.session.current, null);
    assert.equal(persisted.session.explicitQueue.length, 1);

    fake.emit({ positionSeconds: 12 });
    assert.equal(service.diagnostics().timerActive, false);
    assert.equal(service.diagnostics().writes, 1);

    const second = explicitEntry("2", path);
    fake.setPlan({
      ...initial,
      explicitQueue: [first, second],
      sequence: 2,
      revisions: {
        ...initial.revisions,
        state: 2,
        explicitQueue: 2,
        execution: 2,
      },
    });
    fake.emit({});
    assert.equal(service.diagnostics().timerActive, true);
    await service.flush();
    assert.equal(service.diagnostics().writes, 2);
    persisted = await repository.readPlaybackSession();
    assert.equal(persisted.status, "loaded");
    assert.equal(persisted.session.explicitQueue.length, 2);
    assert.equal(persisted.session.positionSeconds, 12);

    fake.emit({ volume: 55 });
    assert.equal(service.diagnostics().timerActive, true);
    await service.flush();
    persisted = await repository.readPlaybackSession();
    assert.equal(persisted.status, "loaded");
    assert.equal(persisted.session.volume, 55);
    assert.equal(service.diagnostics().writes, 3);
    service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("an entirely unavailable v3 session is retained until a real planner mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-service-hold-"));
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  try {
    const missing = join(root, "missing.mp3");
    const context = contextEntry("missing", missing);
    const history = historyEntry("missing", missing);
    const plan: PlaybackPlanSnapshot = {
      ...emptyPlan(),
      current: {
        playbackInstanceId: history.playbackInstanceId,
        executionEntryId: context.executionEntryId,
        source: "context",
        relationId: context.contextItemId,
        contextId: "context-main",
        historyEntryId: history.historyEntryId,
        item: context.item,
        startedSequence: 1,
      },
      context: {
        contextId: "context-main",
        kind: "album",
        title: "Album",
        entityId: "album-main",
        continuationArtistId: null,
        source: { label: "Album" },
        originalItems: [context],
        playOrder: [context.contextItemId],
        resumeCursor: 1,
        shuffleCycle: 0,
        repeatCycle: 0,
        availabilityRevision: 0,
      },
      history: { entries: [history], cursor: 0 },
      sequence: 1,
      revisions: revisions(1),
    };
    await repository.writePlaybackSession(
      playerSessionFromPlaybackPlan(plan, {
        positionSeconds: 20,
        volume: 80,
        muted: false,
      }),
    );
    const before = await readFile(repository.v3ConfigPath, "utf8");
    const fake = new FakeSessionPlayer(emptyPlan());
    const service = serviceFixture(repository, fake);

    const result = await service.restore();
    service.start();
    await service.flush();

    assert.equal(result.status, "empty");
    assert.equal(service.diagnostics().writes, 0);
    assert.equal(await readFile(repository.v3ConfigPath, "utf8"), before);
    service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("future v3 state keeps the service read-only even if the player mutates", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-service-future-"));
  const repository = new PlayerSessionRepository(
    join(root, "player-session.json"),
  );
  const futureText = '{"version":99,"future":"preserve"}\n';
  try {
    await writeFile(repository.v3ConfigPath, futureText, "utf8");
    const fake = new FakeSessionPlayer(emptyPlan());
    const service = serviceFixture(repository, fake);

    const result = await service.restore();
    service.start();
    fake.setPlan({
      ...emptyPlan(),
      pendingContinuation: {
        requestId: "continuation-new",
        artistId: "artist-new",
        previousLibraryTrackId: "track-new",
        recentLibraryTrackIds: [],
      },
      revisions: revisions(1),
    });
    fake.emit({});
    await service.flush();

    assert.equal(result.status, "empty");
    assert.equal(service.diagnostics().readOnly, true);
    assert.equal(service.diagnostics().writes, 0);
    assert.equal(await readFile(repository.v3ConfigPath, "utf8"), futureText);
    service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
