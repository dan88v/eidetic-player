import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import type {
  PlayerState,
  QueueItem,
} from "../../../packages/shared/src/player.js";
import {
  PlaybackPlanner,
  type PlaybackExecutionPlanEntry,
  type PlaybackItemOrigin,
  type PlaybackItemSeed,
  type PlaybackPlanSnapshot,
} from "../src/playback-plan/index.js";
import type { PersistedQueueOrigin } from "../src/player-session/player-session-types.js";
import type { MpvResponse } from "../src/player/mpv-transport.js";
import { PlayerService } from "../src/player/player-service.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

class FakeMpvController {
  readonly sets: { readonly name: string; readonly value: unknown }[] = [];
  readonly commands: unknown[][] = [];
  readonly appends: string[][] = [];
  readonly loads: {
    readonly paths: string[];
    readonly selectedIndex: number;
  }[] = [];
  paths: string[] = [];
  playlistPosition = 0;
  setPropertyHook: ((name: string, value: unknown) => Promise<unknown>) | null =
    null;
  loadPlaylistHook:
    | ((paths: readonly string[], selectedIndex: number) => Promise<void>)
    | null = null;

  async setProperty(name: string, value: unknown): Promise<unknown> {
    this.sets.push({ name, value });
    if (this.setPropertyHook) await this.setPropertyHook(name, value);
    if (name === "playlist-pos" && typeof value === "number")
      this.playlistPosition = Math.trunc(value);
    return undefined;
  }

  command(command: readonly unknown[]): Promise<unknown> {
    this.commands.push([...command]);
    if (command[0] === "playlist-remove") {
      const index = Number(command[1]);
      if (Number.isInteger(index) && index >= 0 && index < this.paths.length) {
        this.paths.splice(index, 1);
        if (index < this.playlistPosition) this.playlistPosition -= 1;
        else if (index === this.playlistPosition)
          this.playlistPosition = Math.max(
            0,
            Math.min(this.playlistPosition, this.paths.length - 1),
          );
      }
    } else if (command[0] === "playlist-clear") {
      this.paths = this.paths.slice(0, 1);
      this.playlistPosition = 0;
    } else if (command[0] === "stop") {
      this.playlistPosition = 0;
    }
    return Promise.resolve(undefined);
  }

  getProperty(name: string): Promise<unknown> {
    if (name === "playlist-pos") return Promise.resolve(this.playlistPosition);
    if (name === "playlist")
      return Promise.resolve(
        this.paths.map((filename, index) => ({
          filename,
          current: index === this.playlistPosition,
          playing: index === this.playlistPosition,
        })),
      );
    return Promise.resolve(undefined);
  }

  appendToPlaylist(paths: readonly string[]): Promise<void> {
    this.appends.push([...paths]);
    this.paths.push(...paths);
    return Promise.resolve();
  }

  async loadPlaylist(
    paths: readonly string[],
    selectedIndex = 0,
  ): Promise<void> {
    this.loads.push({ paths: [...paths], selectedIndex });
    if (this.loadPlaylistHook)
      await this.loadPlaylistHook(paths, selectedIndex);
    this.paths = [...paths];
    this.playlistPosition = selectedIndex;
  }

  seekWhenReady(positionSeconds: number): Promise<void> {
    this.commands.push(["seek-when-ready", positionSeconds]);
    return Promise.resolve();
  }

  clearCalls(): void {
    this.sets.length = 0;
    this.commands.length = 0;
    this.appends.length = 0;
    this.loads.length = 0;
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

interface PlayerHarness {
  state: PlayerState;
  controller: FakeMpvController;
  executable: string | null;
  readonly properties: Map<string, unknown>;
  readonly playbackPlanner: PlaybackPlanner;
  playbackPlanSnapshot: PlaybackPlanSnapshot;
  readonly queueOrigins: Map<string, PersistedQueueOrigin>;
  readonly executionOrigins: Map<string, PersistedQueueOrigin>;
  originalQueue: string[];
  playlistItemIds: string[];
  plannerNavigationPending: boolean;
  pendingTrackTargetId: string | null;
  plannerTransitionChain: Promise<void>;
  executionMutationChain: Promise<void>;
  transitionPending: boolean;
  enrichmentPathKey: string | null;
  deriveStateFromProperties(): void;
  refreshProperties(): Promise<void>;
  handleMpvMessage(message: MpvResponse): void;
  handleUnexpectedExit(): Promise<void>;
  startController(): Promise<void>;
  pathKey(path: string): string;
}

interface SeedOptions {
  readonly artist?: string;
  readonly libraryTrackId?: string;
  readonly primaryArtistId?: string;
  readonly origin?: PlaybackItemOrigin;
}

function item(title: string, options: SeedOptions = {}): PlaybackItemSeed {
  return {
    nativePath: `C:\\fixture\\${title}.flac`,
    filename: `${title}.flac`,
    title,
    artist: options.artist ?? "Fixture Artist",
    album: "Fixture Album",
    durationSeconds: 60,
    libraryTrackId: options.libraryTrackId ?? null,
    ...(options.primaryArtistId
      ? { primaryArtistId: options.primaryArtistId }
      : {}),
    origin: options.origin ?? { kind: "direct" },
  };
}

function createStoppedHarness(): {
  readonly player: PlayerService;
  readonly harness: PlayerHarness;
  readonly controller: FakeMpvController;
} {
  const player = new PlayerService();
  const harness = player as unknown as PlayerHarness;
  const controller = new FakeMpvController();
  harness.state = {
    ...player.getState(),
    status: "stopped",
    mpvAvailable: true,
    currentTrack: null,
    currentQueueIndex: -1,
    queue: [],
  };
  harness.controller = controller;
  harness.originalQueue = [];
  harness.playlistItemIds = [];
  harness.refreshProperties = () => Promise.resolve();
  return { player, harness, controller };
}

function queueItem(
  entry: PlaybackExecutionPlanEntry,
  index: number,
): QueueItem {
  return {
    id: entry.executionEntryId,
    index,
    path: entry.item.nativePath,
    filename: entry.item.filename,
    displayTitle: entry.item.title,
    ...(entry.item.durationSeconds === null
      ? {}
      : { durationSeconds: entry.item.durationSeconds }),
    artwork: null,
    isCurrent: index === 0,
    available: entry.item.availability !== "unavailable",
    ...(entry.item.libraryTrackId
      ? { libraryTrackId: entry.item.libraryTrackId }
      : {}),
  };
}

function createHarness(
  options: {
    readonly context?: readonly PlaybackItemSeed[];
    readonly explicit?: readonly PlaybackItemSeed[];
    readonly continuationArtistId?: string | null;
  } = {},
): {
  readonly player: PlayerService;
  readonly harness: PlayerHarness;
  readonly controller: FakeMpvController;
} {
  const context = options.context ?? [item("A"), item("B"), item("C")];
  const player = new PlayerService(undefined, undefined, {
    commandConfirmationTimeoutMilliseconds: 2_000,
  });
  const harness = player as unknown as PlayerHarness;
  const planner = harness.playbackPlanner;
  planner.startContext({
    kind: "album",
    title: "Fixture album",
    entityId: "fixture-album",
    continuationArtistId: options.continuationArtistId ?? null,
    source: { label: "Test" },
    items: context,
    selectedIndex: 0,
  });
  if (options.explicit?.length) planner.enqueueExplicit(options.explicit);
  harness.playbackPlanSnapshot = planner.snapshot();
  const projection = planner.projectExecutionPlan();
  assert.ok(projection.current);
  const entries = [projection.current, ...projection.future];
  const current = projection.current.item;
  harness.state = {
    ...player.getState(),
    status: "playing",
    mpvAvailable: true,
    currentTrack: {
      path: current.nativePath,
      filename: current.filename,
      title: current.title,
      artist: current.artist ?? "",
      album: current.album ?? "",
      artists: current.artist ? [current.artist] : [],
      albumArtist: current.artist,
      trackNumber: 1,
      trackTotal: context.length,
      discNumber: 1,
      discTotal: 1,
      year: 2026,
      genre: ["Test"],
      durationSeconds: current.durationSeconds ?? 60,
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
    positionSeconds: 0,
    durationSeconds: current.durationSeconds ?? 60,
    paused: false,
    currentQueueIndex: 0,
    queue: entries.map(queueItem),
  };
  const controller = new FakeMpvController();
  controller.paths = entries.map((entry) => entry.item.nativePath);
  harness.controller = controller;
  harness.originalQueue = [...controller.paths];
  harness.playlistItemIds = entries.map((entry) => entry.executionEntryId);
  harness.refreshProperties = () => Promise.resolve();
  return { player, harness, controller };
}

async function flushTransitions(harness: PlayerHarness): Promise<void> {
  await harness.plannerTransitionChain;
  await harness.executionMutationChain;
}

async function naturalEndToPlannedNext(
  harness: PlayerHarness,
  controller: FakeMpvController,
): Promise<void> {
  assert.ok(controller.paths[1]);
  controller.playlistPosition = 1;
  harness.handleMpvMessage({
    event: "end-file",
    reason: "eof",
  } as MpvResponse);
  await flushTransitions(harness);
  harness.handleMpvMessage({ event: "file-loaded" });
  await flushTransitions(harness);
}

void test("Explicit duplicate mutations preserve Current and reconcile one MPV without reload", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-duplicates-"));
  const duplicate = join(temporary, "Duplicate.flac");
  await writeFile(duplicate, "fixture");
  const { player, harness, controller } = createHarness();
  const initialCurrent = player.getPlaybackPlanSnapshot().current;
  assert.ok(initialCurrent);
  const controllerIdentity = harness.controller;
  const origins: readonly PersistedQueueOrigin[] = [
    {
      kind: "removable",
      deviceId: "device-a",
      relativePath: "Duplicate.flac",
      entryId: "entry-one",
    },
    {
      kind: "removable",
      deviceId: "device-a",
      relativePath: "Duplicate.flac",
      entryId: "entry-two",
    },
  ];

  try {
    assert.equal(await player.append([duplicate, duplicate], origins), 2);
    let plan = player.getPlaybackPlanSnapshot();
    assert.equal(plan.explicitQueue.length, 2);
    assert.equal(
      new Set(plan.explicitQueue.map((entry) => entry.explicitQueueEntryId))
        .size,
      2,
    );
    assert.equal(
      new Set(plan.explicitQueue.map((entry) => entry.executionEntryId)).size,
      2,
    );
    assert.deepEqual(
      plan.explicitQueue.map((entry) => entry.item.origin.entryId),
      ["entry-one", "entry-two"],
    );
    assert.equal(
      plan.current?.executionEntryId,
      initialCurrent.executionEntryId,
    );
    assert.equal(controller.loads.length, 0);
    assert.equal(harness.controller, controllerIdentity);

    const persistedDuplicates = player
      .getSessionSnapshot()
      .queue.filter((entry) => entry.filename === basename(duplicate));
    assert.deepEqual(
      persistedDuplicates.map((entry) =>
        entry.origin.kind === "removable" ? entry.origin.entryId : null,
      ),
      ["entry-one", "entry-two"],
    );

    const [first, second] = plan.explicitQueue;
    assert.ok(first && second);
    await player.reorderQueueItem(second.explicitQueueEntryId, 0);
    plan = player.getPlaybackPlanSnapshot();
    assert.deepEqual(
      plan.explicitQueue.map((entry) => entry.explicitQueueEntryId),
      [second.explicitQueueEntryId, first.explicitQueueEntryId],
    );
    await player.removeQueueItem(first.explicitQueueEntryId);
    assert.deepEqual(
      player
        .getPlaybackPlanSnapshot()
        .explicitQueue.map((entry) => entry.item.origin.entryId),
      ["entry-two"],
    );
    await player.clearQueue();
    plan = player.getPlaybackPlanSnapshot();
    assert.equal(plan.explicitQueue.length, 0);
    assert.equal(
      plan.current?.executionEntryId,
      initialCurrent.executionEntryId,
    );
    assert.equal(plan.context?.title, "Fixture album");
    assert.equal(controller.loads.length, 0);
    assert.equal(controller.paths[0], initialCurrent.item.nativePath);
    assert.equal(harness.controller, controllerIdentity);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("natural EOF advances exactly once to a planned item without reloading Current", async () => {
  const { player, harness, controller } = createHarness();
  const firstExecutionId =
    player.getPlaybackPlanSnapshot().current?.executionEntryId;
  controller.clearCalls();

  await naturalEndToPlannedNext(harness, controller);

  const plan = player.getPlaybackPlanSnapshot();
  assert.equal(plan.current?.item.title, "B");
  assert.ok(plan.current);
  assert.notEqual(plan.current.executionEntryId, firstExecutionId);
  assert.deepEqual(
    plan.history.entries.map((entry) => entry.item.title),
    ["A", "B"],
  );
  assert.equal(harness.plannerNavigationPending, false);
  assert.equal(controller.loads.length, 0);
  assert.equal(controller.paths[0], plan.current.item.nativePath);
  assert.equal(harness.playlistItemIds[0], plan.current.executionEntryId);
});

void test("natural EOF preserves the matching technical future and removes only the consumed item", async () => {
  const { harness, controller } = createHarness();
  const expectedRemainingPaths = controller.paths.slice(1);
  controller.clearCalls();

  await naturalEndToPlannedNext(harness, controller);

  assert.deepEqual(
    controller.commands.filter(([name]) => name === "playlist-remove"),
    [["playlist-remove", 0]],
  );
  assert.deepEqual(controller.appends, []);
  assert.deepEqual(controller.loads, []);
  assert.deepEqual(controller.paths, expectedRemainingPaths);
});

void test("implicit Context recovery realigns a stale technical ID before publishing Current", async () => {
  const context = ["A", "B", "C"].map((title) => ({
    ...item(title),
    nativePath: `C:/fixture/${title}.flac`,
  }));
  const { player, harness, controller } = createHarness({ context });
  const originalIds = [...harness.playlistItemIds];

  await player.next();
  const planned = player.getPlaybackPlanSnapshot().current;
  assert.equal(planned?.item.title, "B");
  assert.ok(planned);

  controller.paths = controller.paths.slice(1);
  controller.playlistPosition = 0;
  harness.playlistItemIds = originalIds;
  harness.transitionPending = false;
  harness.enrichmentPathKey = harness.pathKey(planned.item.nativePath);
  harness.properties.set("pause", false);
  harness.properties.set("idle-active", false);
  harness.properties.set("duration", 60);
  harness.properties.set("time-pos", 12);
  harness.properties.set("path", planned.item.nativePath);
  harness.properties.set("playlist-pos", 0);
  harness.properties.set("playlist", await controller.getProperty("playlist"));
  harness.deriveStateFromProperties();

  const published = player.getPublicState();
  const projected = harness.playbackPlanner.projectExecutionPlan();
  const projectedIds = projected.current
    ? [projected.current, ...projected.future].map(
        (entry) => entry.executionEntryId,
      )
    : [];
  assert.deepEqual(harness.playlistItemIds, projectedIds);
  assert.equal(new Set(harness.playlistItemIds).size, projectedIds.length);
  assert.equal(published.currentTrack?.title, "B");
  assert.equal(published.currentPlayback?.item.displayTitle, "B");
  assert.equal(published.positionSeconds, 12);
});

void test("implicit Context recovery rejects an observed track outside planned Current", async () => {
  const { player, harness, controller } = createHarness();
  const originalIds = [...harness.playlistItemIds];

  await player.next();
  const planned = player.getPlaybackPlanSnapshot().current;
  assert.equal(planned?.item.title, "B");

  controller.paths = ["C:/music/c.flac"];
  controller.playlistPosition = 0;
  const observedPath = controller.paths[0];
  assert.ok(observedPath);
  harness.playlistItemIds = originalIds;
  harness.transitionPending = false;
  harness.enrichmentPathKey = harness.pathKey(observedPath);
  harness.properties.set("pause", false);
  harness.properties.set("idle-active", false);
  harness.properties.set("duration", 60);
  harness.properties.set("time-pos", 12);
  harness.properties.set("path", observedPath);
  harness.properties.set("playlist-pos", 0);
  harness.properties.set("playlist", await controller.getProperty("playlist"));
  harness.deriveStateFromProperties();

  assert.deepEqual(harness.playlistItemIds, originalIds);
  assert.equal(player.getPublicState().currentTrack, null);
});

void test("implicit Context recovery uses the authoritative MPV playlist marker when playlist-pos is stale", async () => {
  const context = ["A", "B", "C"].map((title) => ({
    ...item(title),
    nativePath: `C:/fixture/${title}.flac`,
  }));
  const { player, harness, controller } = createHarness({ context });
  const originalIds = [...harness.playlistItemIds];

  await player.next();
  const planned = player.getPlaybackPlanSnapshot().current;
  assert.equal(planned?.item.title, "B");
  assert.ok(planned);

  controller.paths = controller.paths.slice(1);
  controller.playlistPosition = 0;
  harness.playlistItemIds = originalIds;
  harness.transitionPending = false;
  harness.enrichmentPathKey = harness.pathKey(planned.item.nativePath);
  harness.properties.set("pause", false);
  harness.properties.set("idle-active", false);
  harness.properties.set("duration", 60);
  harness.properties.set("time-pos", 12);
  harness.properties.set("path", planned.item.nativePath);
  harness.properties.set("playlist-pos", -1);
  harness.properties.set("playlist", await controller.getProperty("playlist"));
  harness.deriveStateFromProperties();

  const published = player.getPublicState();
  assert.equal(harness.state.currentQueueIndex, 0);
  assert.equal(published.currentTrack?.title, "B");
  assert.equal(published.currentPlayback?.item.displayTitle, "B");
  assert.equal(published.positionSeconds, 12);
});

void test("manual Next at the terminal Current is a no-op while natural EOF still stops", async () => {
  const artistId = `artist-${"7".repeat(32)}`;
  const currentTrackId = `track-${"8".repeat(32)}`;
  const { player, harness, controller } = createHarness({
    context: [
      item("Only", {
        libraryTrackId: currentTrackId,
        primaryArtistId: artistId,
      }),
    ],
  });
  await player.clearPlaybackContext();
  const before = player.getPlaybackPlanSnapshot();
  const currentId = before.current?.playbackInstanceId;
  assert.ok(currentId);
  assert.equal(player.getPublicState().canGoNext, false);
  controller.clearCalls();

  await player.next();

  assert.equal(
    player.getPlaybackPlanSnapshot().current?.playbackInstanceId,
    currentId,
  );
  assert.equal(
    player.getPublicState().currentPlayback?.item.displayTitle,
    "Only",
  );
  assert.deepEqual(controller.commands, []);
  assert.deepEqual(controller.sets, []);
  assert.deepEqual(controller.loads, []);

  player.setSameArtistResolver(() => Promise.resolve([]));
  await player.setContinuePlaybackMode("same-artist");
  assert.equal(player.getPublicState().canGoNext, true);
  controller.clearCalls();
  await player.next();
  assert.equal(
    player.getPlaybackPlanSnapshot().current?.playbackInstanceId,
    currentId,
  );
  assert.equal(
    player.getPublicState().currentPlayback?.item.displayTitle,
    "Only",
  );
  assert.equal(
    (controller.commands as unknown[][]).some(
      ([command]) => command === "stop",
    ),
    false,
  );

  controller.clearCalls();
  harness.handleMpvMessage({ event: "end-file", reason: "eof" } as MpvResponse);
  await flushTransitions(harness);
  assert.equal(player.getPlaybackPlanSnapshot().current, null);
  assert.equal(player.getPublicState().currentPlayback, null);
  assert.deepEqual(controller.commands, [["stop"], ["playlist-clear"]]);
});

void test("Previous keeps browser History and natural forward navigation reuses the planned execution", async () => {
  const { player, harness, controller } = createHarness();

  await player.next();
  harness.handleMpvMessage({ event: "file-loaded" });
  await flushTransitions(harness);
  await player.next();
  harness.handleMpvMessage({ event: "file-loaded" });
  await flushTransitions(harness);
  assert.deepEqual(
    player
      .getPlaybackPlanSnapshot()
      .history.entries.map((entry) => entry.item.title),
    ["A", "B", "C"],
  );

  harness.state = { ...harness.state, positionSeconds: 8 };
  controller.clearCalls();
  await player.previous();
  assert.deepEqual(controller.commands.at(-1), ["seek", 0, "absolute+exact"]);
  assert.equal(player.getPlaybackPlanSnapshot().current?.item.title, "C");

  harness.state = { ...harness.state, positionSeconds: 0 };
  controller.clearCalls();
  await player.previous();
  let plan = player.getPlaybackPlanSnapshot();
  assert.equal(plan.current?.item.title, "B");
  assert.equal(plan.history.cursor, 1);
  assert.equal(controller.loads.length, 1);
  const forwardExecutionId = plan.history.entries[2]?.executionEntryId;
  assert.equal(harness.playlistItemIds[1], forwardExecutionId);
  assert.deepEqual(
    player
      .getSessionSnapshot()
      .queue.slice(0, 2)
      .map((entry) => entry.displayTitle),
    ["B", "C"],
  );

  controller.clearCalls();
  await naturalEndToPlannedNext(harness, controller);
  plan = player.getPlaybackPlanSnapshot();
  assert.equal(plan.current?.item.title, "C");
  assert.ok(plan.current);
  assert.equal(plan.current.executionEntryId, forwardExecutionId);
  assert.equal(plan.history.cursor, 2);
  assert.equal(plan.history.entries.length, 3);
  assert.equal(controller.loads.length, 0);
});

void test("folder source loss and reconnect update every matching History occurrence", async () => {
  const sourceId = "source-offline";
  const folderItem = (
    title: string,
    itemSourceId: string,
  ): PlaybackItemSeed => ({
    ...item(title),
    origin: {
      kind: "folder",
      sourceId: itemSourceId,
      relativePath: `${title}.flac`,
    },
  });
  const { player, harness } = createHarness({
    context: [
      folderItem("Offline A", sourceId),
      folderItem("Offline B", sourceId),
      folderItem("Stable C", "source-stable"),
    ],
  });

  await player.next();
  harness.handleMpvMessage({ event: "file-loaded" });
  await flushTransitions(harness);
  await player.next();
  harness.handleMpvMessage({ event: "file-loaded" });
  await flushTransitions(harness);
  const historyIds = player
    .getPlaybackPlanSnapshot()
    .history.entries.map((entry) => entry.historyEntryId);

  await player.setFolderSourceAvailable(sourceId, false);
  let plan = player.getPlaybackPlanSnapshot();
  assert.deepEqual(
    plan.history.entries.map((entry) => entry.item.availability),
    ["unavailable", "unavailable", "available"],
  );
  assert.deepEqual(
    plan.history.entries.map((entry) => entry.historyEntryId),
    historyIds,
  );
  assert.equal(plan.current?.item.title, "Stable C");
  assert.equal(plan.current.item.availability, "available");

  await player.setFolderSourceAvailable(sourceId, true);
  plan = player.getPlaybackPlanSnapshot();
  assert.deepEqual(
    plan.history.entries.map((entry) => entry.item.availability),
    ["available", "available", "available"],
  );
  assert.deepEqual(
    plan.history.entries.map((entry) => entry.historyEntryId),
    historyIds,
  );
});

void test("source loss updates duplicate native paths by execution occurrence", async () => {
  const deviceId = "device-duplicate-origin";
  const removable = item("Shared path", {
    origin: {
      kind: "removable",
      sourceId: deviceId,
      relativePath: "Shared path.flac",
      entryId: "entry-removable",
    },
  });
  const direct = item("Shared path");
  const { player, harness, controller } = createHarness({
    context: [removable],
    explicit: [direct],
  });
  const planBefore = player.getPlaybackPlanSnapshot();
  const current = planBefore.current;
  const future = planBefore.explicitQueue[0];
  assert.ok(current);
  assert.ok(future);
  assert.equal(current.item.nativePath, future.item.nativePath);
  harness.executionOrigins.set(current.executionEntryId, {
    kind: "removable",
    deviceId,
    relativePath: "Shared path.flac",
    entryId: "entry-removable",
  });
  harness.executionOrigins.set(future.executionEntryId, {
    kind: "direct",
    nativePath: future.item.nativePath,
  });
  harness.queueOrigins.set(harness.pathKey(current.item.nativePath), {
    kind: "direct",
    nativePath: current.item.nativePath,
  });
  controller.clearCalls();

  assert.equal(await player.setRemovableDeviceAvailable(deviceId, false), true);

  const planAfter = player.getPlaybackPlanSnapshot();
  assert.equal(planAfter.current?.item.availability, "unavailable");
  assert.equal(planAfter.explicitQueue[0]?.item.availability, "available");
  assert.deepEqual(
    harness.state.queue.map((entry) => entry.available),
    [false, true],
  );
  assert.equal(harness.state.status, "stopped");
  assert.equal(harness.state.paused, true);
  assert.deepEqual(
    controller.commands.find(([name]) => name === "stop"),
    ["stop", "keep-playlist"],
  );
});

void test("Repeat One leaves every future source untouched and never enables MPV playlist looping", async () => {
  const { player, harness, controller } = createHarness({
    explicit: [item("X")],
  });
  await player.setRepeatMode("one");
  const before = player.getPlaybackPlanSnapshot();
  controller.clearCalls();

  harness.handleMpvMessage({
    event: "end-file",
    reason: "eof",
  } as MpvResponse);
  await flushTransitions(harness);
  harness.handleMpvMessage({ event: "file-loaded" });
  await flushTransitions(harness);

  const after = player.getPlaybackPlanSnapshot();
  assert.equal(
    after.current?.executionEntryId,
    before.current?.executionEntryId,
  );
  assert.deepEqual(after.explicitQueue, before.explicitQueue);
  assert.deepEqual(after.history, before.history);
  assert.equal(controller.loads.length, 0);
  assert.equal(
    controller.sets.some(
      (entry) => entry.name === "loop-playlist" && entry.value === "inf",
    ),
    false,
  );
});

void test("Repeat All consumes duplicate Explicit entries once and reloads only the Context boundary", async () => {
  const { player, harness, controller } = createHarness({
    context: [item("A"), item("B")],
    explicit: [item("X"), item("X")],
  });
  const duplicateInstances = player
    .getPlaybackPlanSnapshot()
    .explicitQueue.map((entry) => entry.playbackInstanceId);
  assert.equal(new Set(duplicateInstances).size, 2);
  await player.setRepeatMode("all");
  controller.clearCalls();

  await naturalEndToPlannedNext(harness, controller);
  assert.equal(player.getPlaybackPlanSnapshot().current?.item.title, "X");
  await naturalEndToPlannedNext(harness, controller);
  assert.equal(player.getPlaybackPlanSnapshot().current?.item.title, "X");
  await naturalEndToPlannedNext(harness, controller);
  assert.equal(player.getPlaybackPlanSnapshot().current?.item.title, "B");
  assert.equal(player.getPlaybackPlanSnapshot().explicitQueue.length, 0);
  assert.equal(controller.loads.length, 0);

  harness.handleMpvMessage({
    event: "end-file",
    reason: "eof",
  } as MpvResponse);
  await flushTransitions(harness);
  const plan = player.getPlaybackPlanSnapshot();
  assert.equal(plan.current?.item.title, "A");
  assert.equal(plan.context?.repeatCycle, 1);
  assert.equal(plan.explicitQueue.length, 0);
  assert.deepEqual(
    plan.history.entries.map((entry) => entry.item.title),
    ["A", "X", "X", "B", "A"],
  );
  assert.deepEqual(controller.loads.at(-1)?.paths, [
    item("A").nativePath,
    item("B").nativePath,
  ]);
  assert.equal(controller.loads.length, 1);
  assert.equal(
    controller.sets.some(
      (entry) => entry.name === "loop-playlist" && entry.value === "inf",
    ),
    false,
  );
});

void test("album continuation never labels a stable album-artist identity with the track artist", () => {
  const albumArtistId = `artist-${"c".repeat(32)}`;
  const { player } = createHarness({
    context: [item("Compilation track", { artist: "Guest Track Artist" })],
    continuationArtistId: albumArtistId,
  });

  const continuation = player.getPublicState().playbackContinuation;
  assert.ok(continuation);
  assert.equal(continuation.artistId, albumArtistId);
  assert.equal(continuation.artistName, null);
  assert.notEqual(continuation.artistName, "Guest Track Artist");
});

void test("artist-radio public continuation keeps the stable Library artist name", async () => {
  const artistId = `artist-${"a".repeat(32)}`;
  const currentTrackId = `track-${"1".repeat(32)}`;
  const candidateTrackId = `track-${"2".repeat(32)}`;
  const { player, controller } = createHarness({
    context: [
      item("Last", {
        artist: "Untrusted file tag",
        libraryTrackId: currentTrackId,
      }),
    ],
    continuationArtistId: artistId,
  });
  player.setSameArtistResolver(() =>
    Promise.resolve([
      {
        trackId: candidateTrackId,
        path: "C:\\fixture\\Radio.flac",
        artistName: "Stable Library Artist",
        origin: {
          kind: "folders",
          sourceId: "source-library",
          relativePath: "Radio.flac",
          libraryTrackId: candidateTrackId,
        },
      },
    ]),
  );
  await player.setContinuePlaybackMode("same-artist");
  controller.clearCalls();

  await player.next();

  const plan = player.getPlaybackPlanSnapshot();
  const publicState = player.getPublicState();
  assert.equal(plan.context?.kind, "artist-radio");
  assert.ok(plan.context);
  assert.equal(plan.context.title, "Stable Library Artist");
  assert.equal(publicState.playbackContinuation?.artistId, artistId);
  assert.ok(publicState.playbackContinuation);
  assert.equal(
    publicState.playbackContinuation.artistName,
    "Stable Library Artist",
  );
  assert.equal(publicState.playbackContinuation.active, true);
  assert.notEqual(publicState.playbackContinuation.artistName, "Same artist");
});

void test("an Add concurrent with Context loading is reconciled after load without racing MPV", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-open-add-"));
  const contextDirectory = join(temporary, "context");
  await mkdir(contextDirectory);
  const contextPaths = ["A1.wav", "A2.wav", "A3.wav", "A4.wav"].map(
    (filename) => join(contextDirectory, filename),
  );
  const queuedPath = join(temporary, "X.wav");
  await Promise.all(
    [...contextPaths, queuedPath].map((path) => writeFile(path, "fixture")),
  );
  const { player, harness, controller } = createHarness();
  const loadStarted = deferred<undefined>();
  const releaseLoad = deferred<undefined>();
  controller.loadPlaylistHook = async () => {
    loadStarted.resolve(undefined);
    await releaseLoad.promise;
  };

  try {
    const open = player.openResolvedQueue(
      contextPaths,
      1,
      undefined,
      undefined,
      {
        kind: "album",
        title: "Concurrent album",
        source: { label: "Test" },
      },
    );
    await loadStarted.promise;
    const add = player.append([queuedPath]);
    await add;
    assert.equal(
      controller.commands.some((command) => command[0] === "playlist-remove"),
      false,
    );
    releaseLoad.resolve(undefined);
    await open;
    await harness.executionMutationChain;

    const plan = player.getPlaybackPlanSnapshot();
    assert.equal(plan.current?.item.nativePath, contextPaths[1]);
    assert.deepEqual(
      plan.explicitQueue.map((entry) => entry.item.nativePath),
      [queuedPath],
    );
    assert.deepEqual(controller.paths, [
      contextPaths[1],
      queuedPath,
      contextPaths[2],
      contextPaths[3],
    ]);
    assert.equal(controller.loads.length, 1);
  } finally {
    releaseLoad.resolve(undefined);
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("an open invalidated while file validation is pending never mutates planner or MPV", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-stale-open-"));
  const path = join(temporary, "Stale.wav");
  await writeFile(path, "fixture");
  const { player, controller } = createHarness();
  const currentBefore = player.getPlaybackPlanSnapshot().current;
  const generation = player.reserveOpenRequest();

  try {
    const staleOpen = player.openResolvedQueue(
      [path],
      0,
      undefined,
      generation,
    );
    queueMicrotask(() => player.reserveOpenRequest());
    await staleOpen;
    assert.equal(
      player.getPlaybackPlanSnapshot().current?.executionEntryId,
      currentBefore?.executionEntryId,
    );
    assert.equal(controller.loads.length, 0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("a confirmed new Context atomically clears the matching Explicit Queue", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-clear-open-"));
  const replacement = [
    join(temporary, "Album A.wav"),
    join(temporary, "Album B.wav"),
  ];
  await Promise.all(replacement.map((path) => writeFile(path, "fixture")));
  const { player, harness, controller } = createHarness({
    explicit: [item("Old Up Next")],
  });
  const revision = player.getPlaybackPlanSnapshot().revisions.explicitQueue;

  try {
    await player.openResolvedQueue(
      replacement,
      0,
      undefined,
      undefined,
      {
        kind: "album",
        title: "Replacement album",
        source: { label: "Test" },
      },
      { explicitQueuePolicy: "clear", expectedQueueRevision: revision },
    );
    const plan = player.getPlaybackPlanSnapshot();
    assert.equal(plan.current?.item.nativePath, replacement[0]);
    assert.equal(plan.explicitQueue.length, 0);
    assert.deepEqual(
      harness.playbackPlanner
        .projectExecutionPlan()
        .future.map((entry) => entry.item.nativePath),
      [replacement[1]],
    );
    assert.equal(controller.loads.length, 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("a stale clear decision refuses playback without mutating Queue or MPV", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-stale-clear-"));
  const replacement = join(temporary, "Replacement.wav");
  await writeFile(replacement, "fixture");
  const { player, controller } = createHarness({
    explicit: [item("Old Up Next")],
  });
  const before = player.getPlaybackPlanSnapshot();

  try {
    await assert.rejects(
      player.openResolvedQueue(
        [replacement],
        0,
        undefined,
        undefined,
        undefined,
        {
          explicitQueuePolicy: "clear",
          expectedQueueRevision: before.revisions.explicitQueue + 1,
        },
      ),
      /Up Next changed/u,
    );
    const restored = player.getPlaybackPlanSnapshot();
    assert.equal(
      restored.current?.playbackInstanceId,
      before.current?.playbackInstanceId,
    );
    assert.deepEqual(restored.explicitQueue, before.explicitQueue);
    assert.equal(controller.loads.length, 0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("a failed Next never rolls back an Explicit Add completed while IPC was pending", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-next-add-"));
  const queuedPath = join(temporary, "Queued.wav");
  await writeFile(queuedPath, "fixture");
  const nextTrackId = `track-${"7".repeat(32)}`;
  const nextArtistId = `artist-${"8".repeat(32)}`;
  const { player, harness, controller } = createHarness({
    explicit: [
      item("Hydrated target", { libraryTrackId: nextTrackId }),
      item("Explicit after target"),
    ],
  });
  player.setPrimaryArtistResolver((trackId) =>
    trackId === nextTrackId ? nextArtistId : null,
  );
  const before = player.getPlaybackPlanSnapshot();
  assert.ok(before.current);
  const targetStarted = deferred<undefined>();
  const rejectTarget = deferred<unknown>();
  controller.setPropertyHook = async (name) => {
    if (name !== "playlist-pos") return;
    targetStarted.resolve(undefined);
    await rejectTarget.promise;
  };

  try {
    const next = player.next();
    const expectedFailure = assert.rejects(next, /fixture navigation failure/u);
    await targetStarted.promise;
    await player.append([queuedPath]);
    rejectTarget.reject(new Error("fixture navigation failure"));
    await expectedFailure;
    const restored = player.getPlaybackPlanSnapshot();
    assert.equal(
      restored.current?.playbackInstanceId,
      before.current.playbackInstanceId,
    );
    assert.deepEqual(restored.history.entries, before.history.entries);
    assert.equal(restored.history.cursor, before.history.cursor);
    assert.equal(restored.context?.resumeCursor, before.context?.resumeCursor);
    assert.deepEqual(
      restored.explicitQueue.map((entry) => entry.item.nativePath),
      [
        ...before.explicitQueue.map((entry) => entry.item.nativePath),
        queuedPath,
      ],
    );
    assert.equal(
      restored.current.item.primaryArtistId,
      before.current.item.primaryArtistId,
    );
    assert.equal(harness.playlistItemIds[0], before.current.executionEntryId);
    assert.equal(controller.paths[0], before.current.item.nativePath);
    assert.equal(harness.plannerNavigationPending, false);
    assert.equal(harness.pendingTrackTargetId, null);
  } finally {
    rejectTarget.resolve(undefined);
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("rollback reservation prevents a concurrent Add from overflowing Explicit Queue", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-capacity-"));
  const queuedPath = join(temporary, "Capacity.wav");
  await writeFile(queuedPath, "fixture");
  const explicit = Array.from({ length: 10_000 }, (_, index) =>
    item(`Capacity ${String(index)}`),
  );
  const { player, controller } = createHarness({ explicit });
  const targetStarted = deferred<undefined>();
  const rejectTarget = deferred<unknown>();
  controller.setPropertyHook = async (name) => {
    if (name !== "playlist-pos") return;
    targetStarted.resolve(undefined);
    await rejectTarget.promise;
  };

  try {
    const next = player.next();
    const expectedFailure = assert.rejects(next, /fixture navigation failure/u);
    await targetStarted.promise;
    await assert.rejects(player.append([queuedPath]), /bounded item limit/u);
    rejectTarget.reject(new Error("fixture navigation failure"));
    await expectedFailure;
    assert.equal(player.getPlaybackPlanSnapshot().explicitQueue.length, 10_000);
  } finally {
    rejectTarget.resolve(undefined);
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("a failed staged Play restores Explicit without leaving a technical Current", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-play-fail-"));
  const queuedPath = join(temporary, "Staged.wav");
  await writeFile(queuedPath, "fixture");
  const { player, harness, controller } = createStoppedHarness();

  try {
    await player.append([queuedPath]);
    const before = player.getPlaybackPlanSnapshot();
    const beforeIds = before.explicitQueue.map(
      (entry) => entry.explicitQueueEntryId,
    );
    controller.loadPlaylistHook = (paths) => {
      controller.paths = [...paths];
      return Promise.reject(new Error("fixture staged load failure"));
    };

    await assert.rejects(player.play(), /could not be opened/u);
    const restored = player.getPlaybackPlanSnapshot();
    assert.equal(restored.current, null);
    assert.deepEqual(
      restored.explicitQueue.map((entry) => entry.explicitQueueEntryId),
      beforeIds,
    );
    assert.deepEqual(harness.playlistItemIds, []);
    assert.equal(harness.state.status, "stopped");
    assert.deepEqual(
      controller.commands.slice(-2).map((command) => command[0]),
      ["stop", "playlist-clear"],
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("a failed Context load reconstructs the previous bounded MPV plan", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-open-fail-"));
  const replacement = [
    join(temporary, "Replacement A.wav"),
    join(temporary, "Replacement B.wav"),
  ];
  await Promise.all(replacement.map((path) => writeFile(path, "fixture")));
  const { player, harness, controller } = createHarness({
    explicit: [item("Explicit remains")],
  });
  const before = player.getPlaybackPlanSnapshot();
  const previousTechnicalPaths = [...controller.paths];
  let failed = false;
  controller.loadPlaylistHook = (paths) => {
    if (failed) return Promise.resolve();
    failed = true;
    controller.paths = [...paths];
    return Promise.reject(new Error("fixture Context load failure"));
  };

  try {
    await assert.rejects(
      player.openResolvedQueue(
        replacement,
        0,
        undefined,
        undefined,
        undefined,
        {
          explicitQueuePolicy: "clear",
          expectedQueueRevision: before.revisions.explicitQueue,
        },
      ),
      /could not be opened/u,
    );
    const restored = player.getPlaybackPlanSnapshot();
    assert.equal(
      restored.current?.playbackInstanceId,
      before.current?.playbackInstanceId,
    );
    assert.equal(restored.context?.contextId, before.context?.contextId);
    assert.deepEqual(restored.history, before.history);
    assert.deepEqual(restored.explicitQueue, before.explicitQueue);
    assert.equal(controller.loads.length, 2);
    assert.deepEqual(controller.loads[1]?.paths, previousTechnicalPaths);
    assert.deepEqual(controller.paths, previousTechnicalPaths);
    const execution = harness.playbackPlanner.projectExecutionPlan();
    assert.deepEqual(
      harness.playlistItemIds,
      [execution.current, ...execution.future]
        .filter((entry) => entry !== null)
        .map((entry) => entry.executionEntryId),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("a failed Same-artist load rolls back the nested radio decision", async () => {
  const artistId = `artist-${"a".repeat(32)}`;
  const currentTrackId = `track-${"b".repeat(32)}`;
  const radioTrackId = `track-${"c".repeat(32)}`;
  const { player, harness, controller } = createHarness({
    context: [
      item("Album boundary", {
        libraryTrackId: currentTrackId,
        primaryArtistId: artistId,
      }),
    ],
    continuationArtistId: artistId,
  });
  player.setSameArtistResolver(() =>
    Promise.resolve([
      {
        trackId: radioTrackId,
        path: "C:\\fixture\\Radio candidate.flac",
        artistName: "Stable Artist",
        origin: {
          kind: "folders",
          sourceId: "source-radio",
          relativePath: "Radio candidate.flac",
          libraryTrackId: radioTrackId,
        },
      },
    ]),
  );
  await player.setContinuePlaybackMode("same-artist");
  const before = player.getPlaybackPlanSnapshot();
  assert.ok(before.current);
  let failed = false;
  controller.loadPlaylistHook = () => {
    if (failed) return Promise.resolve();
    failed = true;
    return Promise.reject(new Error("fixture radio load failure"));
  };

  await assert.rejects(player.next(), /could not be opened/u);
  const restored = player.getPlaybackPlanSnapshot();
  assert.equal(
    restored.current?.playbackInstanceId,
    before.current.playbackInstanceId,
  );
  assert.equal(restored.context?.contextId, before.context?.contextId);
  assert.equal(restored.context?.kind, "album");
  assert.deepEqual(restored.history, before.history);
  assert.equal(restored.artistRadio, null);
  assert.equal(restored.pendingContinuation, null);
  assert.equal(restored.continuePlayback, "same-artist");
  assert.equal(harness.playlistItemIds[0], before.current.executionEntryId);
  assert.equal(harness.plannerNavigationPending, false);
  assert.equal(harness.pendingTrackTargetId, null);
});

void test("a failed Same-artist boundary preserves an Add completed during candidate resolution", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-plan-radio-add-"));
  const queuedPath = join(temporary, "Queued during radio.wav");
  await writeFile(queuedPath, "fixture");
  const artistId = `artist-${"4".repeat(32)}`;
  const currentTrackId = `track-${"5".repeat(32)}`;
  const radioTrackId = `track-${"6".repeat(32)}`;
  const { player, controller } = createHarness({
    context: [
      item("Radio boundary", {
        libraryTrackId: currentTrackId,
        primaryArtistId: artistId,
      }),
    ],
    continuationArtistId: artistId,
  });
  const resolverStarted = deferred<undefined>();
  const candidates = deferred<
    readonly {
      readonly trackId: string;
      readonly path: string;
      readonly artistName: string;
      readonly origin: PersistedQueueOrigin;
    }[]
  >();
  player.setSameArtistResolver(() => {
    resolverStarted.resolve(undefined);
    return candidates.promise;
  });
  await player.setContinuePlaybackMode("same-artist");
  const before = player.getPlaybackPlanSnapshot();
  assert.ok(before.current);
  let failed = false;
  controller.loadPlaylistHook = () => {
    if (failed) return Promise.resolve();
    failed = true;
    return Promise.reject(new Error("fixture nested Explicit load failure"));
  };

  try {
    const next = player.next();
    const expectedFailure = assert.rejects(next, /could not be opened/u);
    await resolverStarted.promise;
    await player.append([queuedPath]);
    const added = player.getPlaybackPlanSnapshot().explicitQueue[0];
    assert.ok(added);
    candidates.resolve([
      {
        trackId: radioTrackId,
        path: "C:\\fixture\\Unused radio candidate.flac",
        artistName: "Stable Artist",
        origin: {
          kind: "folders",
          sourceId: "source-radio",
          relativePath: "Unused radio candidate.flac",
          libraryTrackId: radioTrackId,
        },
      },
    ]);
    await expectedFailure;
    const restored = player.getPlaybackPlanSnapshot();
    assert.equal(
      restored.current?.playbackInstanceId,
      before.current.playbackInstanceId,
    );
    assert.equal(restored.context?.contextId, before.context?.contextId);
    assert.deepEqual(restored.history, before.history);
    assert.deepEqual(
      restored.explicitQueue.map((entry) => entry.explicitQueueEntryId),
      [added.explicitQueueEntryId],
    );
    assert.equal(restored.explicitQueue[0]?.item.nativePath, queuedPath);
  } finally {
    candidates.resolve([]);
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("rollback preserves a concurrent Same-artist Off policy change", async () => {
  const artistId = `artist-${"d".repeat(32)}`;
  const currentTrackId = `track-${"e".repeat(32)}`;
  const { player, harness, controller } = createHarness({
    context: [
      item("Radio source", {
        libraryTrackId: currentTrackId,
        primaryArtistId: artistId,
      }),
    ],
    continuationArtistId: artistId,
  });
  player.setSameArtistResolver(() =>
    Promise.resolve(
      ["One", "Two", "Three"].map((title, index) => {
        const trackId = `track-${String(index + 1).repeat(32)}`;
        return {
          trackId,
          path: `C:\\fixture\\Radio ${title}.flac`,
          artistName: "Stable Artist",
          origin: {
            kind: "folders" as const,
            sourceId: "source-radio",
            relativePath: `Radio ${title}.flac`,
            libraryTrackId: trackId,
          },
        };
      }),
    ),
  );
  await player.setContinuePlaybackMode("same-artist");
  await player.next();
  const before = player.getPlaybackPlanSnapshot();
  assert.ok(before.current);
  assert.equal(before.context?.kind, "artist-radio");
  const targetStarted = deferred<undefined>();
  const rejectTarget = deferred<unknown>();
  controller.setPropertyHook = async (name) => {
    if (name !== "playlist-pos") return;
    targetStarted.resolve(undefined);
    await rejectTarget.promise;
  };

  try {
    const next = player.next();
    const expectedFailure = assert.rejects(next, /fixture navigation failure/u);
    await targetStarted.promise;
    await player.setContinuePlaybackMode("off");
    rejectTarget.reject(new Error("fixture navigation failure"));
    await expectedFailure;
    const restored = player.getPlaybackPlanSnapshot();
    assert.equal(
      restored.current?.playbackInstanceId,
      before.current.playbackInstanceId,
    );
    assert.deepEqual(restored.history, before.history);
    assert.equal(restored.context, null);
    assert.equal(restored.artistRadio, null);
    assert.equal(restored.pendingContinuation, null);
    assert.equal(restored.continuePlayback, "off");
    assert.equal(harness.playlistItemIds[0], before.current.executionEntryId);
    assert.equal(harness.plannerNavigationPending, false);
    assert.equal(harness.pendingTrackTargetId, null);
  } finally {
    rejectTarget.resolve(undefined);
  }
});

void test("an explicit-only Current resolves its stable primary artist before Same artist", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "eidetic-plan-primary-artist-"),
  );
  const path = join(temporary, "Explicit.wav");
  await writeFile(path, "fixture");
  const trackId = `track-${"3".repeat(32)}`;
  const artistId = `artist-${"4".repeat(32)}`;
  const radioTrackId = `track-${"5".repeat(32)}`;
  const { player } = createStoppedHarness();
  const requestedArtistIds: string[] = [];
  player.setPrimaryArtistResolver((candidateTrackId) =>
    candidateTrackId === trackId ? artistId : null,
  );
  player.setSameArtistResolver((candidateArtistId) => {
    requestedArtistIds.push(candidateArtistId);
    return Promise.resolve([
      {
        trackId: radioTrackId,
        path: "C:\\fixture\\Resolved-radio.flac",
        artistName: "Resolved Artist",
        origin: {
          kind: "folders",
          sourceId: "source-radio",
          relativePath: "Resolved-radio.flac",
          libraryTrackId: radioTrackId,
        },
      },
    ]);
  });

  try {
    await player.setContinuePlaybackMode("same-artist");
    await player.append(
      [path],
      [
        {
          kind: "folders",
          sourceId: "source-explicit",
          relativePath: "Explicit.wav",
          libraryTrackId: trackId,
        },
      ],
    );
    await player.play();
    let plan = player.getPlaybackPlanSnapshot();
    assert.equal(plan.context, null);
    assert.equal(plan.current?.item.primaryArtistId, artistId);
    assert.equal(plan.history.entries[0]?.item.primaryArtistId, artistId);

    await player.next();
    plan = player.getPlaybackPlanSnapshot();
    assert.deepEqual(requestedArtistIds, [artistId]);
    assert.ok(plan.context);
    assert.equal(plan.context.kind, "artist-radio");
    assert.equal(plan.context.title, "Resolved Artist");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("generic shuffled Context uses the last started track identity and never a stale Context identity", () => {
  const staleContextArtistId = `artist-${"a".repeat(32)}`;
  const primaryArtistIds = [
    `artist-${"1".repeat(32)}`,
    `artist-${"2".repeat(32)}`,
    `artist-${"3".repeat(32)}`,
  ];
  const planner = new PlaybackPlanner({ random: () => 0 });
  planner.setShuffle(true);
  planner.setContinuePlayback("same-artist");
  let decision = planner.startContext({
    kind: "search",
    title: "Shuffled search",
    continuationArtistId: staleContextArtistId,
    source: { label: "Library search" },
    items: primaryArtistIds.map((primaryArtistId, index) =>
      item(`Search-${String(index)}`, {
        libraryTrackId: `track-${String(index + 1).repeat(32)}`,
        primaryArtistId,
      }),
    ),
  });
  const startedArtistIds: string[] = [];
  while (decision.kind === "start") {
    assert.ok(decision.current.item.primaryArtistId);
    startedArtistIds.push(decision.current.item.primaryArtistId);
    decision = planner.advance();
  }
  assert.equal(decision.kind, "continuation-needed");
  assert.equal(decision.request.artistId, startedArtistIds.at(-1));
  assert.notEqual(decision.request.artistId, staleContextArtistId);

  const noIdentity = new PlaybackPlanner();
  noIdentity.setContinuePlayback("same-artist");
  const started = noIdentity.startContext({
    kind: "search",
    title: "No identity",
    continuationArtistId: staleContextArtistId,
    source: { label: "Library search" },
    items: [item("Unindexed")],
  });
  assert.equal(started.kind, "start");
  assert.deepEqual(noIdentity.advance(), {
    kind: "stop",
    reason: "no-continuation-identity",
  });
});

void test("public Current ignores stale raw metadata and artwork from the previous execution", () => {
  const { player, harness } = createHarness();
  assert.ok(harness.state.currentTrack);
  harness.state = {
    ...harness.state,
    currentTrack: {
      ...harness.state.currentTrack,
      title: "Stale observed title",
      artwork: {
        id: "stale-artwork",
        mimeType: "image/png",
        sourceType: "folder",
        revision: "stale",
      },
    },
  };
  harness.playbackPlanner.startContext({
    kind: "album",
    title: "Replacement",
    source: { label: "Test" },
    items: [item("Fresh planner title")],
  });
  harness.playbackPlanSnapshot = harness.playbackPlanner.snapshot();

  const current = player.getPublicState().currentPlayback;
  assert.ok(current);
  assert.equal(current.item.displayTitle, "Fresh planner title");
  assert.equal(current.item.artwork, null);
});

void test("a 10000-item artist-radio bag remains bounded and preserves its resolved name", () => {
  const artistId = `artist-${"b".repeat(32)}`;
  const planner = new PlaybackPlanner({ random: () => 0.5 });
  planner.startContext({
    kind: "tracks",
    title: "Boundary",
    continuationArtistId: artistId,
    source: { label: "Test" },
    items: [
      item("Boundary", {
        libraryTrackId: `track-${"0".repeat(32)}`,
        primaryArtistId: artistId,
      }),
    ],
  });
  planner.setContinuePlayback("same-artist");
  const boundary = planner.advance();
  assert.equal(boundary.kind, "continuation-needed");
  const candidates = Array.from({ length: 10_000 }, (_, index) =>
    item(`Radio-${String(index)}`, {
      libraryTrackId: `track-${index.toString(16).padStart(32, "0")}`,
    }),
  );
  const startedAt = performance.now();
  const decision = planner.installArtistRadio(
    artistId,
    candidates,
    "Stable Library Artist",
  );
  const elapsed = performance.now() - startedAt;

  assert.equal(decision.kind, "start");
  assert.equal(planner.snapshot().context?.title, "Stable Library Artist");
  assert.equal(planner.snapshot().context?.originalItems.length, 10_000);
  const projectionStartedAt = performance.now();
  const projection = planner.projectExecutionPlan();
  const projectionElapsed = performance.now() - projectionStartedAt;
  assert.equal(projection.future.length, 128);
  assert.equal(projection.hiddenEntryCount, 9_870);
  assert.equal(projection.truncated, true);
  assert.ok(elapsed < 1_500, `artist-radio bag took ${String(elapsed)}ms`);
  assert.ok(
    projectionElapsed < 500,
    `bounded artist-radio projection took ${String(projectionElapsed)}ms`,
  );
});

void test("an unexpected MPV exit rebuilds the technical plan and restores playback state on one replacement controller", async () => {
  const { player, harness } = createHarness();
  const currentBefore = player.getPlaybackPlanSnapshot().current;
  assert.ok(currentBefore);
  harness.state = {
    ...harness.state,
    status: "playing",
    paused: false,
    positionSeconds: 17,
    volume: 43,
    muted: true,
  };
  const replacement = new FakeMpvController();
  let controllerStarts = 0;
  harness.executable = "fixture-mpv";
  harness.startController = () => {
    controllerStarts += 1;
    harness.controller = replacement;
    return Promise.resolve();
  };

  await harness.handleUnexpectedExit();

  const restored = player.getPlaybackPlanSnapshot();
  assert.equal(controllerStarts, 1);
  assert.equal(harness.controller, replacement);
  assert.equal(
    restored.current?.executionEntryId,
    currentBefore.executionEntryId,
  );
  const projection = harness.playbackPlanner.projectExecutionPlan();
  const expectedEntries = projection.current
    ? [projection.current, ...projection.future]
    : [];
  assert.equal(replacement.loads.length, 1);
  assert.deepEqual(
    replacement.loads[0]?.paths,
    expectedEntries.map((entry) => entry.item.nativePath),
  );
  assert.equal(replacement.paths[0], currentBefore.item.nativePath);
  assert.deepEqual(
    harness.playlistItemIds,
    expectedEntries.map((entry) => entry.executionEntryId),
  );
  assert.ok(
    replacement.sets.some(
      ({ name, value }) => name === "volume" && value === 43,
    ),
  );
  assert.ok(
    replacement.sets.some(
      ({ name, value }) => name === "mute" && value === true,
    ),
  );
  assert.ok(
    replacement.sets.some(
      ({ name, value }) => name === "pause" && value === false,
    ),
  );
  assert.deepEqual(
    replacement.commands.find(([name]) => name === "seek-when-ready"),
    ["seek-when-ready", 17],
  );
  assert.equal(harness.state.status, "playing");
  assert.equal(harness.state.paused, false);
  assert.equal(harness.state.positionSeconds, 17);
  assert.equal(harness.state.volume, 43);
  assert.equal(harness.state.muted, true);
});

void test("v3 restore keeps an Explicit-only stopped Queue staged until Play", async () => {
  const planner = new PlaybackPlanner();
  planner.enqueueExplicit([item("Staged")]);
  const staged = planner.snapshot();
  const { player, harness, controller } = createStoppedHarness();

  await player.restorePlaybackPlan(staged, {
    positionSeconds: 29,
    volume: 38,
    muted: true,
  });

  let restored = player.getPlaybackPlanSnapshot();
  assert.equal(restored.current, null);
  assert.equal(restored.explicitQueue.length, 1);
  assert.equal(controller.loads.length, 0);
  assert.equal(harness.state.status, "stopped");
  assert.equal(harness.state.paused, true);
  assert.equal(harness.state.positionSeconds, 0);
  assert.equal(harness.state.volume, 38);
  assert.equal(harness.state.muted, true);

  await player.play();
  restored = player.getPlaybackPlanSnapshot();
  assert.equal(restored.current?.item.title, "Staged");
  assert.equal(restored.explicitQueue.length, 0);
  assert.equal(controller.loads.length, 1);
});
