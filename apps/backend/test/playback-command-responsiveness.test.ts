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
}

interface PlayerHarness {
  state: PlayerState;
  controller: FakeController;
  originalQueue: string[];
  playlistItemIds: string[];
  transitionPending: boolean;
  handleMpvMessage(message: MpvResponse): void;
  refreshProperties(): Promise<void>;
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
