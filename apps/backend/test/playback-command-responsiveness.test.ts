import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import type {
  PlayerCommandState,
  PlayerState,
  QueueItem,
} from "../../../packages/shared/src/player.js";
import { CommandIntentCoordinator } from "../src/player/command-intent-coordinator.js";
import { PlayerService } from "../src/player/player-service.js";
import { PlaybackPlanner } from "../src/playback-plan/index.js";
import { createMpvEndpoint } from "../src/player/mpv-endpoint.js";
import { MpvTransport } from "../src/player/mpv-transport.js";
import type { MpvResponse } from "../src/player/mpv-transport.js";

const queue = Array.from({ length: 4 }, (_, index): QueueItem => ({
  id: `queue-00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  index,
  path: `C:\\fixture\\${String(index)}.flac`,
  filename: `${String(index)}.flac`,
  displayTitle: `Track ${String(index)}`,
  artwork: null,
  isCurrent: index === 0,
}));

interface FakeController {
  readonly sets: { readonly name: string; readonly value: unknown }[];
  readonly commands: readonly unknown[][];
  setProperty(name: string, value: unknown): Promise<unknown>;
  command(command: readonly unknown[]): Promise<unknown>;
  getProperty(name: string): Promise<unknown>;
  appendToPlaylist(paths: readonly string[]): Promise<void>;
}

interface PlayerHarness {
  state: PlayerState;
  controller: FakeController;
  originalQueue: string[];
  playlistItemIds: string[];
  readonly properties: Map<string, unknown>;
  transitionPending: boolean;
  transitionRecoveryRefresh: Promise<void> | null;
  enrichmentPathKey: string | null;
  handleMpvMessage(message: MpvResponse): void;
  refreshProperties(): Promise<void>;
  queueExecutionReconciliation(): Promise<void>;
  pathKey(path: string): string;
  playbackPlanSnapshot: ReturnType<PlaybackPlanner["snapshot"]>;
}

function createHarness(
  options: {
    readonly timeout?: number;
    readonly setProperty?: (name: string, value: unknown) => Promise<unknown>;
  } = {},
): {
  readonly player: PlayerService;
  readonly harness: PlayerHarness;
  readonly controller: FakeController;
} {
  const sets: { name: string; value: unknown }[] = [];
  const commands: unknown[][] = [];
  const controller: FakeController = {
    sets,
    commands,
    setProperty(name, value) {
      sets.push({ name, value });
      return options.setProperty?.(name, value) ?? Promise.resolve(undefined);
    },
    command(command) {
      commands.push([...command]);
      return Promise.resolve(undefined);
    },
    getProperty() {
      return Promise.resolve(undefined);
    },
    appendToPlaylist() {
      return Promise.resolve();
    },
  };
  const player = new PlayerService(undefined, undefined, {
    commandConfirmationTimeoutMilliseconds: options.timeout ?? 2_000,
    commandDiagnostics: true,
  });
  const harness = player as unknown as PlayerHarness;
  const planner = (
    player as unknown as { readonly playbackPlanner: PlaybackPlanner }
  ).playbackPlanner;
  planner.startContext({
    kind: "tracks",
    title: "Responsiveness fixture",
    source: { label: "Test" },
    items: queue.map((item) => ({
      nativePath: item.path,
      filename: item.filename,
      title: item.displayTitle,
      origin: { kind: "direct" },
    })),
    selectedIndex: 0,
  });
  harness.playbackPlanSnapshot = planner.snapshot();
  const execution = planner.projectExecutionPlan();
  const executionEntries = execution.current
    ? [execution.current, ...execution.future]
    : [];
  const technicalQueue = queue.map((item, index) => ({
    ...item,
    id: executionEntries[index]?.executionEntryId ?? item.id,
  }));
  harness.state = {
    ...player.getState(),
    status: "loading",
    mpvAvailable: true,
    currentTrack: {
      path: queue[0]?.path ?? "",
      filename: "0.flac",
      title: "Track 0",
      artist: "",
      album: "",
      artists: [],
      albumArtist: null,
      trackNumber: null,
      trackTotal: null,
      discNumber: null,
      discTotal: null,
      year: null,
      genre: [],
      durationSeconds: 60,
      format: "FLAC",
      codec: "flac",
      sampleRate: 44_100,
      bitDepth: 16,
      bitrate: null,
      lossless: true,
      container: "FLAC",
      artwork: null,
      source: "Local File",
    },
    positionSeconds: 0,
    durationSeconds: 60,
    paused: false,
    volume: 80,
    muted: false,
    currentQueueIndex: 0,
    queue: technicalQueue,
  };
  harness.controller = controller;
  harness.originalQueue = queue.map((item) => item.path);
  harness.playlistItemIds = technicalQueue.map((item) => item.id);
  return { player, harness, controller };
}

function commandState(
  state: PlayerState,
): NonNullable<PlayerState["commands"]> {
  assert.ok(state.commands);
  return state.commands;
}

void test("level intents suppress stale telemetry, use tolerance, and latest wins", () => {
  const snapshots: PlayerCommandState[] = [];
  const coordinator = new CommandIntentCoordinator(
    { volume: 80, muted: false, paused: false },
    (snapshot) => snapshots.push(snapshot),
    500,
    true,
  );
  const first = coordinator.beginVolume(63, {
    intentId: 1,
    requestedAtMilliseconds: 10,
  });
  coordinator.acknowledge("volume", first.generation);
  assert.equal(coordinator.observeVolume(0), 63);
  const second = coordinator.beginVolume(71, {
    intentId: 2,
    requestedAtMilliseconds: 11,
  });
  coordinator.acknowledge("volume", first.generation);
  assert.equal(coordinator.observeVolume(63), 71);
  coordinator.acknowledge("volume", second.generation);
  assert.equal(coordinator.observeVolume(70.6), 71);
  assert.equal(coordinator.snapshot().volume.phase, "confirmed");
  assert.equal(coordinator.snapshot().volume.clientIntentId, 2);
  assert.ok(
    coordinator
      .diagnosticSnapshot()
      .some((entry) => entry.stage === "superseded"),
  );
  assert.ok(snapshots.length >= 4);
  coordinator.dispose();
});

void test("acknowledged level intent times out once and rolls back confirmed", async () => {
  const coordinator = new CommandIntentCoordinator(
    { volume: 80, muted: false, paused: false },
    () => undefined,
    20,
    true,
  );
  const intent = coordinator.beginVolume(20);
  coordinator.acknowledge("volume", intent.generation);
  await new Promise((resolve) => setTimeout(resolve, 45));
  const state = coordinator.snapshot();
  assert.equal(state.volume.phase, "failed");
  assert.equal(state.volume.target, 80);
  assert.equal(state.failureRevision, 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(coordinator.snapshot().failureRevision, 1);
  coordinator.dispose();
});

void test("mute and transport ignore stale confirmations", () => {
  const coordinator = new CommandIntentCoordinator(
    { volume: 80, muted: false, paused: false },
    () => undefined,
    500,
    true,
  );
  const mute = coordinator.beginMute(true, {
    intentId: 4,
    requestedAtMilliseconds: 1,
  });
  coordinator.acknowledge("mute", mute.generation);
  const unmute = coordinator.beginMute(false, {
    intentId: 5,
    requestedAtMilliseconds: 2,
  });
  assert.equal(coordinator.observeMute(true), false);
  coordinator.acknowledge("mute", unmute.generation);
  assert.equal(coordinator.observeMute(false), false);
  const pause = coordinator.beginTransport(true);
  coordinator.acknowledge("transport", pause.generation);
  const play = coordinator.beginTransport(false);
  assert.equal(coordinator.observePaused(true), false);
  coordinator.acknowledge("transport", play.generation);
  assert.equal(coordinator.observePaused(false), false);
  assert.equal(coordinator.snapshot().transport.phase, "confirmed");
  coordinator.dispose();
});

void test("property confirmation arriving before IPC ack never regresses", () => {
  const coordinator = new CommandIntentCoordinator(
    { volume: 80, muted: false, paused: false },
    () => undefined,
    500,
    true,
  );
  const intent = coordinator.beginVolume(63);
  coordinator.observeVolume(63);
  assert.equal(coordinator.snapshot().volume.phase, "confirmed");
  coordinator.acknowledge("volume", intent.generation);
  assert.equal(coordinator.snapshot().volume.phase, "confirmed");
  coordinator.dispose();
});

void test("older client intent is discarded before IPC ownership changes", () => {
  const coordinator = new CommandIntentCoordinator(
    { volume: 80, muted: false, paused: false },
    () => undefined,
    500,
    true,
  );
  assert.equal(
    coordinator.beginVolume(70, {
      intentId: 9,
      requestedAtMilliseconds: 2,
    }).accepted,
    true,
  );
  assert.equal(
    coordinator.beginVolume(20, {
      intentId: 8,
      requestedAtMilliseconds: 1,
    }).accepted,
    false,
  );
  assert.equal(coordinator.snapshot().volume.target, 70);
  coordinator.dispose();
});

void test("PlayerService publishes volume intent during loading and rejects stale zero", async () => {
  const { player, harness, controller } = createHarness();
  const operation = player.setVolume(63, {
    intentId: 1,
    requestedAtMilliseconds: 1,
  });
  assert.equal(player.getState().volume, 63);
  await operation;
  assert.deepEqual(controller.sets.at(-1), { name: "volume", value: 63 });
  harness.handleMpvMessage({
    event: "property-change",
    name: "volume",
    data: 0,
  });
  assert.equal(player.getState().volume, 63);
  harness.handleMpvMessage({
    event: "property-change",
    name: "volume",
    data: 62.999,
  });
  assert.equal(commandState(player.getState()).volume.phase, "confirmed");
});

void test("pending level intent survives and is reapplied after audio-output change", async () => {
  const { player, harness, controller } = createHarness();
  await player.setVolume(63, {
    intentId: 1,
    requestedAtMilliseconds: 1,
  });
  harness.handleMpvMessage({
    event: "property-change",
    name: "audio-device",
    data: "fixture-output",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    controller.sets.filter(
      (entry) => entry.name === "volume" && entry.value === 63,
    ).length,
    2,
  );
  assert.equal(player.getState().volume, 63);
  harness.handleMpvMessage({
    event: "property-change",
    name: "volume",
    data: 63,
  });
  assert.equal(commandState(player.getState()).volume.phase, "confirmed");
});

void test("refresh from an older transition generation cannot clear the newer transition", async () => {
  const { player, harness, controller } = createHarness();
  const resolvers: ((value: unknown) => void)[] = [];
  controller.getProperty = () =>
    new Promise((resolve) => {
      resolvers.push(resolve);
    });
  harness.handleMpvMessage({ event: "start-file" });
  const refresh = harness.refreshProperties();
  harness.handleMpvMessage({ event: "start-file" });
  for (const resolve of resolvers) resolve(undefined);
  await refresh;
  assert.equal(harness.transitionPending, true);
  assert.ok(
    player
      .getCommandDiagnostics()
      .some((entry) => entry.stage === "stale-discarded"),
  );
});

void test("a later MPV property event recovers a transition whose refresh was discarded", async () => {
  const { harness, controller } = createHarness();
  const current = queue[0];
  assert.ok(current);
  harness.enrichmentPathKey = harness.pathKey(current.path);
  harness.queueExecutionReconciliation = () => Promise.resolve();
  const staleResolvers: ((value: unknown) => void)[] = [];
  controller.getProperty = () =>
    new Promise((resolve) => {
      staleResolvers.push(resolve);
    });
  harness.handleMpvMessage({ event: "start-file" });
  const staleRefresh = harness.refreshProperties();
  harness.handleMpvMessage({ event: "start-file" });
  for (const resolve of staleResolvers) resolve(undefined);
  await staleRefresh;
  assert.equal(harness.transitionPending, true);

  const playlist = queue.map((item, index) => ({
    filename: item.path,
    current: index === 0,
    playing: index === 0,
  }));
  const settledValues = new Map<string, unknown>([
    ["pause", false],
    ["time-pos", 17],
    ["duration", 180],
    ["playlist", playlist],
    ["playlist-pos", 0],
    ["playlist-playing-pos", 0],
    ["media-title", current.displayTitle],
    ["metadata", { title: current.displayTitle }],
    ["path", current.path],
    ["audio-params", { samplerate: 44_100 }],
    ["audio-codec-name", "flac"],
    ["audio-buffer", 0.2],
    ["idle-active", false],
  ]);
  controller.getProperty = (name) => Promise.resolve(settledValues.get(name));
  harness.enrichmentPathKey = harness.pathKey(current.path);
  harness.handleMpvMessage({
    event: "property-change",
    name: "time-pos",
    data: 17,
  });
  const recovery = harness.transitionRecoveryRefresh;
  assert.ok(recovery);
  await recovery;

  assert.equal(harness.transitionPending, false);
  assert.equal(harness.state.currentQueueIndex, 0);
  assert.equal(harness.state.currentTrack?.path, current.path);
  assert.equal(harness.state.positionSeconds, 17);
});

void test("a failed critical read keeps the transition pending and preserves the last good snapshot", async () => {
  const { harness, controller } = createHarness();
  const previousPlaylist = [{ filename: queue[0]?.path, current: true }];
  harness.properties.set("playlist", previousPlaylist);
  controller.getProperty = (name) =>
    name === "playlist"
      ? Promise.reject(new Error("transient playlist read failure"))
      : Promise.resolve(undefined);
  harness.handleMpvMessage({ event: "start-file" });
  await harness.refreshProperties();
  assert.equal(harness.transitionPending, true);
  assert.equal(harness.properties.get("playlist"), previousPlaylist);
});

void test("a critical event during one refresh coalesces exactly one coherent follow-up pass", async () => {
  const { harness, controller } = createHarness();
  const current = queue[0];
  assert.ok(current);
  harness.enrichmentPathKey = harness.pathKey(current.path);
  harness.queueExecutionReconciliation = () => Promise.resolve();
  const coherentPlaylist = [
    { id: 101, filename: current.path, current: true, playing: true },
  ];
  const coherentValues = new Map<string, unknown>([
    ["pause", false],
    ["time-pos", 9],
    ["duration", 180],
    ["playlist", coherentPlaylist],
    ["playlist-pos", 0],
    ["playlist-playing-pos", 0],
    ["media-title", current.displayTitle],
    ["metadata", { title: current.displayTitle }],
    ["path", current.path],
    ["audio-params", { samplerate: 44_100 }],
    ["audio-codec-name", "flac"],
    ["audio-buffer", 0.2],
    ["idle-active", false],
  ]);
  let readCount = 0;
  let releaseFirstPath!: (value: unknown) => void;
  controller.getProperty = (name) => {
    const pass = Math.floor(readCount / coherentValues.size);
    readCount += 1;
    if (pass === 0 && name === "path")
      return new Promise((resolve) => {
        releaseFirstPath = resolve;
      });
    if (pass === 0 && name === "playlist") return Promise.resolve([]);
    return Promise.resolve(coherentValues.get(name));
  };

  harness.handleMpvMessage({ event: "start-file", playlist_entry_id: 101 });
  harness.enrichmentPathKey = harness.pathKey(current.path);
  const first = harness.refreshProperties();
  harness.handleMpvMessage({
    event: "property-change",
    name: "time-pos",
    data: 9,
  });
  releaseFirstPath(current.path);
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  const recovery = harness.transitionRecoveryRefresh;
  if (recovery) await recovery;

  assert.equal(readCount, coherentValues.size * 2);
  assert.equal(harness.transitionPending, false);
  assert.equal(harness.state.currentTrack?.path, current.path);
  assert.equal(harness.state.positionSeconds, 9);
});

void test("128 randomized property races always settle one Current transition", async () => {
  const { harness, controller } = createHarness();
  const current = queue[0];
  assert.ok(current);
  harness.enrichmentPathKey = harness.pathKey(current.path);
  let randomState = 0x5eeda11;
  const random = (): number => {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState;
  };
  const shuffle = <T>(values: readonly T[]): T[] => {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = random() % (index + 1);
      [shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex] as T,
        shuffled[index] as T,
      ];
    }
    return shuffled;
  };

  for (let iteration = 0; iteration < 128; iteration += 1) {
    const playlist = [
      {
        filename: current.path,
        current: true,
        playing: true,
      },
    ];
    const propertyValues = new Map<string, unknown>([
      ["pause", false],
      ["time-pos", iteration + 1],
      ["duration", 180],
      ["playlist", playlist],
      ["playlist-pos", 0],
      ["playlist-playing-pos", 0],
      ["media-title", current.displayTitle],
      ["metadata", { title: current.displayTitle }],
      ["path", current.path],
      ["audio-params", { samplerate: 44_100 }],
      ["audio-codec-name", "flac"],
      ["audio-buffer", 0.2],
      ["idle-active", false],
    ]);
    const pendingReads: {
      readonly name: string;
      readonly resolve: (value: unknown) => void;
    }[] = [];
    controller.getProperty = (name) =>
      new Promise((resolve) => {
        pendingReads.push({ name, resolve });
      });
    const noise = shuffle<MpvResponse>([
      { event: "property-change", name: "playlist-pos", data: -1 },
      { event: "property-change", name: "path", data: null },
      { event: "property-change", name: "playlist", data: [] },
    ]);

    harness.handleMpvMessage({ event: "start-file" });
    harness.enrichmentPathKey = harness.pathKey(current.path);
    if ((random() & 1) === 0) {
      const firstNoise = noise.shift();
      if (firstNoise) harness.handleMpvMessage(firstNoise);
    }
    const refresh = harness.refreshProperties();
    for (const message of noise) harness.handleMpvMessage(message);
    harness.handleMpvMessage({
      event: "property-change",
      name: "path",
      data: current.path,
    });
    harness.handleMpvMessage({
      event: "property-change",
      name: "playlist",
      data: playlist,
    });
    harness.handleMpvMessage({
      event: "property-change",
      name: "playlist-pos",
      data: iteration % 3 === 0 ? 0 : -1,
    });
    harness.handleMpvMessage({
      event: "property-change",
      name: "playlist-playing-pos",
      data: 0,
    });
    for (const pending of pendingReads)
      pending.resolve(propertyValues.get(pending.name));
    await refresh;

    assert.equal(
      harness.transitionPending,
      false,
      `iteration ${String(iteration)}`,
    );
    assert.equal(
      harness.state.currentQueueIndex,
      0,
      `iteration ${String(iteration)}`,
    );
    assert.equal(
      harness.state.currentTrack?.path,
      current.path,
      `iteration ${String(iteration)}`,
    );
    assert.equal(
      harness.state.positionSeconds,
      iteration + 1,
      `iteration ${String(iteration)}`,
    );
  }
});

void test("Play/Pause sends explicit latest targets during start-file", async () => {
  const { player, harness, controller } = createHarness();
  harness.handleMpvMessage({ event: "start-file" });
  await player.pause({
    intentId: 1,
    requestedAtMilliseconds: 1,
  });
  await player.play({
    intentId: 2,
    requestedAtMilliseconds: 2,
  });
  assert.deepEqual(
    controller.sets.filter((entry) => entry.name === "pause"),
    [
      { name: "pause", value: true },
      { name: "pause", value: false },
    ],
  );
  assert.equal(
    controller.commands.some((command) => command[0] === "cycle"),
    false,
  );
  harness.handleMpvMessage({
    event: "property-change",
    name: "pause",
    data: true,
  });
  assert.equal(player.getState().paused, false);
  harness.handleMpvMessage({
    event: "property-change",
    name: "pause",
    data: false,
  });
  assert.equal(commandState(player.getState()).transport.phase, "confirmed");
});

void test("Next commands remain immediate during loading and accumulate targets", async () => {
  const { player, controller } = createHarness();
  player.setBeforePlaybackHook(() => new Promise(() => undefined));
  await Promise.race([
    Promise.all([
      player.next({
        intentId: 1,
        requestedAtMilliseconds: 1,
      }),
      player.next({
        intentId: 2,
        requestedAtMilliseconds: 2,
      }),
    ]),
    new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error("navigation was blocked"));
      }, 100),
    ),
  ]);
  assert.deepEqual(
    controller.sets.filter((entry) => entry.name === "playlist-pos"),
    [
      { name: "playlist-pos", value: 1 },
      { name: "playlist-pos", value: 2 },
    ],
  );
});

void test("planner navigation keeps reordered HTTP arrival latest-wins", async () => {
  const { player, controller } = createHarness();
  const latest = {
    clientSessionId: "123e4567-e89b-42d3-a456-426614174000",
    intentId: 3,
    requestedAtMilliseconds: 3,
  };
  await player.previous(latest);
  await player.next({ ...latest, intentId: 1 });
  await player.next({ ...latest, intentId: 2 });
  assert.deepEqual(
    controller.sets.filter((entry) => entry.name === "playlist-pos"),
    [],
  );
  assert.equal(
    commandState(player.getState()).navigation.clientIntentId,
    latest.intentId,
  );
});

void test("Previous preserves the three-second restart rule", async () => {
  const { player, harness, controller } = createHarness();
  harness.state = {
    ...harness.state,
    currentQueueIndex: 2,
    positionSeconds: 8,
    queue: queue.map((item, index) => ({
      ...item,
      isCurrent: index === 2,
    })),
  };
  await player.previous();
  assert.deepEqual(controller.commands.at(-1), ["seek", 0, "absolute+exact"]);
});

void test("interactive IPC overtakes queued background refresh reads", async () => {
  const endpoint = await createMpvEndpoint();
  const received: unknown[][] = [];
  const server = createServer((socket) => {
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) break;
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        const request = JSON.parse(line) as {
          readonly command: unknown[];
          readonly request_id: number;
        };
        received.push(request.command);
        socket.write(
          `${JSON.stringify({
            request_id: request.request_id,
            error: "success",
            data: null,
          })}\n`,
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint.path, resolve);
  });
  const transport = await MpvTransport.connect(endpoint.path);
  try {
    const background = [0, 1, 2, 3].map((index) =>
      transport.request(
        ["get_property", `fixture-${String(index)}`],
        500,
        "background",
      ),
    );
    const interactive = transport.request(
      ["set_property", "volume", 63],
      500,
      "interactive",
    );
    await Promise.all([...background, interactive]);
    assert.deepEqual(
      received.slice(0, 3).map((command) => command[0]),
      ["get_property", "get_property", "set_property"],
    );
  } finally {
    transport.close();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
    await endpoint.cleanup();
  }
});
