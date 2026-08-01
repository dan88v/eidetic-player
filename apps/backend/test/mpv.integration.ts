import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverMpv } from "../src/player/mpv-discovery.js";
import { MpvController } from "../src/player/mpv-controller.js";
import { PlayerService } from "../src/player/player-service.js";
import { MetadataService } from "../src/metadata/metadata-service.js";
import { ArtworkService } from "../src/artwork/artwork-service.js";
import { runSingleAudioFileSelection } from "../../ui/src/platform/audio-file-selection.js";
import type { PlatformBridge } from "../../ui/src/platform/platform-bridge.js";
import type { PlayerState } from "../../../packages/shared/src/player.js";
import type { MpvResponse } from "../src/player/mpv-transport.js";

function silentWav(seconds = 2): Buffer {
  const sampleRate = 8_000;
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMilliseconds = 3_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    try {
      lastValue = await read();
      if (predicate(lastValue)) return lastValue;
    } catch {
      // Some properties are unavailable until MPV emits file-loaded.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`MPV state did not become ready: ${String(lastValue)}`);
}

void test("MPV headless IPC integration", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), "eidetic-mpv-test-"));
  const controller = new MpvController();
  try {
    const first = join(folder, "one.wav");
    const second = join(folder, "two.wav");
    await writeFile(first, silentWav());
    await writeFile(second, silentWav());
    await controller.start({
      executable: discovery.executable,
      extraArguments: ["--ao=null"],
    });
    await controller.loadPlaylist([first, second]);
    const playlist = await waitFor(
      () => controller.getProperty("playlist"),
      (value) => Array.isArray(value) && value.length === 2,
    );
    assert.equal((playlist as unknown[]).length, 2);
    await waitFor(
      () => controller.getProperty("duration"),
      (value) => typeof value === "number" && value > 0,
    );
    await controller.setProperty("pause", true);
    assert.equal(await controller.getProperty("pause"), true);
    await controller.seekWhenReady(0.5);
    await controller.command(["playlist-next", "force"]);
    assert.equal(
      await waitFor(
        () => controller.getProperty("playlist-pos"),
        (value) => value === 1,
      ),
      1,
    );
  } finally {
    await controller.stop().catch(() => {
      // Cleanup continues with the temporary directory.
    });
    await rm(folder, { recursive: true, force: true });
  }
});

void test("MPV loads the selected fifth item without flashing the first", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), "eidetic-mpv-selected-"));
  const controller = new MpvController();
  try {
    const paths = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const path = join(folder, `${String(index + 1).padStart(2, "0")}.wav`);
        await writeFile(path, silentWav(5));
        return path;
      }),
    );
    await controller.start({
      executable: discovery.executable,
      extraArguments: ["--ao=null"],
    });
    const observedPaths: string[] = [];
    const unsubscribe = controller.subscribe((message) => {
      if (
        message.event === "property-change" &&
        message.name === "path" &&
        typeof message.data === "string"
      )
        observedPaths.push(message.data);
    });
    await controller.loadPlaylist(paths, 4);
    assert.equal(await controller.getProperty("playlist-pos"), 4);
    assert.equal(await controller.getProperty("path"), paths[4]);
    const playlist = await controller.getProperty("playlist");
    assert.deepEqual(
      (playlist as { readonly filename: string }[]).map(
        (item) => item.filename,
      ),
      paths,
    );
    assert.equal(observedPaths.includes(paths[0] ?? ""), false);
    await controller.command(["playlist-prev", "force"]);
    assert.equal(
      await waitFor(
        () => controller.getProperty("playlist-pos"),
        (value) => value === 3,
      ),
      3,
    );
    await controller.command(["playlist-next", "force"]);
    assert.equal(
      await waitFor(
        () => controller.getProperty("playlist-pos"),
        (value) => value === 4,
      ),
      4,
    );
    await controller.command(["playlist-next", "force"]);
    assert.equal(
      await waitFor(
        () => controller.getProperty("playlist-pos"),
        (value) => value === 5,
      ),
      5,
    );
    unsubscribe();
  } finally {
    await controller.stop().catch(() => {
      // Cleanup continues with the temporary directory.
    });
    await rm(folder, { recursive: true, force: true });
  }
});

void test("MPV moves a Queue item both downward to the end and upward", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), "eidetic-mpv-reorder-"));
  const controller = new MpvController();
  try {
    const paths = await Promise.all(
      Array.from({ length: 4 }, async (_, index) => {
        const path = join(folder, `${String(index + 1)}.wav`);
        await writeFile(path, silentWav());
        return path;
      }),
    );
    await controller.start({
      executable: discovery.executable,
      extraArguments: ["--ao=null"],
    });
    await controller.loadPlaylist(paths);
    await controller.command(["playlist-move", 0, paths.length]);
    const downward = (await controller.getProperty("playlist")) as {
      readonly filename: string;
    }[];
    assert.deepEqual(
      downward.map((item) => item.filename),
      [paths[1], paths[2], paths[3], paths[0]],
    );

    await controller.command(["playlist-move", paths.length - 1, 0]);
    const upward = (await controller.getProperty("playlist")) as {
      readonly filename: string;
    }[];
    assert.deepEqual(
      upward.map((item) => item.filename),
      paths,
    );
  } finally {
    await controller.stop().catch(() => {
      // Cleanup continues with the temporary directory.
    });
    await rm(folder, { recursive: true, force: true });
  }
});

void test("PlayerService disables Shuffle without losing current identity or position", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), "eidetic-mpv-unshuffle-"));
  const player = new PlayerService();
  try {
    const paths = await Promise.all(
      ["01 First.wav", "02 Current.wav", "03 Last.wav"].map(
        async (filename) => {
          const path = join(folder, filename);
          await writeFile(path, silentWav(20));
          return path;
        },
      ),
    );
    await player.initialize();
    await player.openResolvedQueue(paths, 1);
    await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentTrack?.path === paths[1] && state.durationSeconds > 3,
      5_000,
    );
    await player.setShuffle(true);
    await player.setShuffle(false);
    assert.equal(player.getState().shuffleEnabled, false);

    await player.setShuffle(true);
    await player.seek(3);
    const before = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) => state.positionSeconds > 2.5,
      5_000,
    );
    await player.pause();
    await waitFor(
      () => Promise.resolve(player.getState().paused),
      (paused) => paused,
    );
    const currentPath = before.currentTrack?.path;
    const currentId = before.queue[before.currentQueueIndex]?.id;

    await player.setShuffle(false);
    const restored = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        !state.shuffleEnabled &&
        state.currentTrack?.path === currentPath &&
        state.positionSeconds > 2.5,
      5_000,
    );
    assert.equal(restored.queue[restored.currentQueueIndex]?.id, currentId);
    assert.ok(
      Math.abs(restored.positionSeconds - before.positionSeconds) < 0.5,
    );
    assert.equal(restored.paused, true);
  } finally {
    await player.shutdown();
    await rm(folder, { recursive: true, force: true });
  }
});

void test("one persistent MPV reconciles Context and duplicate Explicit Queue without reloading Current", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), "eidetic-mpv-plan-"));
  const player = new PlayerService();
  const controller = new MpvController();
  const harness = player as unknown as {
    state: PlayerState;
    controller: MpvController | null;
    unsubscribeMpv: (() => void) | null;
    handleMpvMessage(message: MpvResponse): void;
  };
  try {
    const contextPaths = await Promise.all(
      ["A1.wav", "A2.wav", "A3.wav", "A4.wav"].map(async (filename) => {
        const path = join(folder, filename);
        await writeFile(path, silentWav(20));
        return path;
      }),
    );
    const explicitX = join(folder, "X.wav");
    const explicitY = join(folder, "Y.wav");
    await Promise.all([
      writeFile(explicitX, silentWav(20)),
      writeFile(explicitY, silentWav(20)),
    ]);
    await controller.start({
      executable: discovery.executable,
      extraArguments: ["--ao=null"],
    });
    harness.state = {
      ...player.getState(),
      status: "idle",
      mpvAvailable: true,
      mpvVersion: discovery.version,
    };
    harness.controller = controller;
    harness.unsubscribeMpv = controller.subscribe((message) => {
      harness.handleMpvMessage(message);
    });

    await player.openResolvedQueue(contextPaths, 1, undefined, undefined, {
      kind: "album",
      title: "MPV fixture album",
      source: { label: "Integration fixture" },
    });
    await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentTrack?.path === contextPaths[1] &&
        state.durationSeconds > 3,
      5_000,
    );
    await player.pause();
    await waitFor(
      () => Promise.resolve(player.getState().paused),
      (paused) => paused,
    );
    await player.seek(3);
    const beforeMutation = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) => state.positionSeconds > 2.5 && state.paused,
      5_000,
    );
    const currentBefore = player.getPlaybackPlanSnapshot().current;
    assert.ok(currentBefore);
    const controllerIdentity = harness.controller;

    assert.equal(await player.append([explicitX, explicitY, explicitX]), 3);
    let plan = player.getPlaybackPlanSnapshot();
    assert.deepEqual(
      plan.explicitQueue.map((entry) => entry.item.nativePath),
      [explicitX, explicitY, explicitX],
    );
    assert.equal(
      new Set(plan.explicitQueue.map((entry) => entry.explicitQueueEntryId))
        .size,
      3,
    );
    assert.deepEqual(
      player.getPublicState().queue.map((entry) => entry.id),
      plan.explicitQueue.map((entry) => entry.explicitQueueEntryId),
    );
    const reconciled = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) => state.queue.length === 6,
      5_000,
    );
    assert.deepEqual(
      reconciled.queue.map((entry) => entry.path),
      [
        contextPaths[1],
        explicitX,
        explicitY,
        explicitX,
        contextPaths[2],
        contextPaths[3],
      ],
    );
    assert.equal(
      plan.current?.executionEntryId,
      currentBefore.executionEntryId,
    );
    assert.equal(reconciled.currentTrack?.path, contextPaths[1]);
    assert.equal(
      reconciled.queue[reconciled.currentQueueIndex]?.playbackInstanceId,
      player.getPublicState().currentPlayback?.playbackInstanceId,
    );
    assert.ok(
      Math.abs(reconciled.positionSeconds - beforeMutation.positionSeconds) <
        0.5,
    );
    assert.equal(harness.controller, controllerIdentity);

    const third = plan.explicitQueue[2];
    assert.ok(third);
    await player.reorderQueueItem(third.explicitQueueEntryId, 0);
    plan = player.getPlaybackPlanSnapshot();
    assert.deepEqual(
      plan.explicitQueue.map((entry) => entry.item.nativePath),
      [explicitX, explicitX, explicitY],
    );
    assert.equal(
      plan.current?.executionEntryId,
      currentBefore.executionEntryId,
    );
    assert.ok(player.getState().positionSeconds > 2.5);

    await player.clearQueue();
    plan = player.getPlaybackPlanSnapshot();
    assert.equal(plan.explicitQueue.length, 0);
    assert.equal(
      plan.current?.executionEntryId,
      currentBefore.executionEntryId,
    );
    assert.equal(player.getState().currentTrack?.path, contextPaths[1]);
    assert.ok(player.getState().positionSeconds > 2.5);
    assert.equal(harness.controller, controllerIdentity);

    await player.append([explicitX, explicitY, explicitX]);
    plan = player.getPlaybackPlanSnapshot();
    const selected = plan.explicitQueue[2];
    assert.ok(selected);
    await player.playQueueIndex(2, undefined, selected.explicitQueueEntryId);
    await waitFor(
      () => Promise.resolve(player.getState()),
      (state) => state.currentTrack?.path === explicitX,
      5_000,
    );
    plan = player.getPlaybackPlanSnapshot();
    assert.equal(plan.current?.item.nativePath, explicitX);
    assert.equal(plan.explicitQueue.length, 0);
    assert.deepEqual(
      plan.history.entries.map((entry) => entry.item.nativePath),
      [contextPaths[1], explicitX],
    );

    await player.next();
    await waitFor(
      () => Promise.resolve(player.getState()),
      (state) => state.currentTrack?.path === contextPaths[2],
      5_000,
    );
    plan = player.getPlaybackPlanSnapshot();
    assert.equal(plan.current?.item.nativePath, contextPaths[2]);
    assert.deepEqual(
      plan.history.entries.map((entry) => entry.item.nativePath),
      [contextPaths[1], explicitX, contextPaths[2]],
    );
    assert.equal(harness.controller, controllerIdentity);
  } finally {
    await player.shutdown();
    await rm(folder, { recursive: true, force: true });
  }
});

void test("MPV replaces every item from an existing Queue", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), "eidetic-mpv-replace-"));
  const controller = new MpvController();
  try {
    const oldQueue = await Promise.all(
      ["old-one.wav", "old-two.wav", "old-three.wav"].map(async (name) => {
        const path = join(folder, name);
        await writeFile(path, silentWav(5));
        return path;
      }),
    );
    const usbQueue = await Promise.all(
      ["01 USB.wav", "02 USB.wav"].map(async (name) => {
        const path = join(folder, name);
        await writeFile(path, silentWav(5));
        return path;
      }),
    );
    await controller.start({
      executable: discovery.executable,
      extraArguments: ["--ao=null"],
    });
    await controller.loadPlaylist(oldQueue, 1);
    await controller.loadPlaylist(usbQueue, 1);
    const playlist = await controller.getProperty("playlist");
    assert.deepEqual(
      (playlist as { readonly filename: string }[]).map(
        (item) => item.filename,
      ),
      usbQueue,
    );
    assert.equal(await controller.getProperty("playlist-pos"), 1);
    assert.equal(await controller.getProperty("path"), usbQueue[1]);
  } finally {
    await controller.stop().catch(() => {
      // Cleanup continues with the temporary directory.
    });
    await rm(folder, { recursive: true, force: true });
  }
});

void test("PlayerService replaces the Queue and opens the selected ninth item", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "eidetic-player-ninth-"));
  const firstFolder = join(root, "first");
  const secondFolder = join(root, "second");
  await mkdir(firstFolder);
  await mkdir(secondFolder);
  const makeAlbum = async (folder: string): Promise<string[]> => {
    const paths: string[] = [];
    for (let index = 1; index <= 10; index += 1) {
      const path = join(folder, `${String(index).padStart(2, "0")} Track.wav`);
      await writeFile(path, silentWav(10));
      paths.push(path);
    }
    await writeFile(
      join(folder, "cover.png"),
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    return paths;
  };
  const first = await makeAlbum(firstFolder);
  const second = await makeAlbum(secondFolder);
  const player = new PlayerService();
  const transitions: string[] = [];
  const unsubscribe = player.subscribe((state) => {
    const path = state.currentTrack?.path;
    if (path && transitions.at(-1) !== path) transitions.push(path);
  });
  try {
    await player.initialize();
    const platform: PlatformBridge = {
      quit() {
        return Promise.resolve();
      },
      openFolder() {
        return Promise.resolve(null);
      },
      openAudioFiles(options) {
        assert.equal(options.multiple, false);
        return Promise.resolve([(first[8] ?? "").replaceAll("\\", "/")]);
      },
      subscribeToDroppedFiles() {
        return () => undefined;
      },
    };
    await runSingleAudioFileSelection(platform, (paths) => player.open(paths));
    const firstState = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentQueueIndex === 0 && state.currentTrack?.path === first[8],
      5_000,
    );
    assert.equal(firstState.currentTrack?.path, first[8]);
    assert.deepEqual(
      firstState.queue.map((item) => item.path),
      first.slice(8),
    );
    assert.equal(player.getPublicState().playbackContext?.totalCount, 10);
    assert.equal(player.getPublicState().playbackContext?.remainingCount, 1);
    assert.equal(player.getPublicState().queue.length, 0);
    assert.equal(transitions.includes(first[0] ?? ""), false);
    const oldIds = new Set(firstState.queue.map((item) => item.id));
    const oldNinth = firstState.queue[0];
    assert.ok(oldNinth);
    assert.equal(
      (await player.resolveQueueArtwork(oldNinth.id))?.sourceType,
      "folder",
    );

    transitions.length = 0;
    await player.open([second[8] ?? ""]);
    const secondState = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentQueueIndex === 0 && state.currentTrack?.path === second[8],
      5_000,
    );
    assert.deepEqual(
      secondState.queue.map((item) => item.path),
      second.slice(8),
    );
    assert.equal(player.getPublicState().playbackContext?.totalCount, 10);
    assert.equal(player.getPublicState().playbackContext?.remainingCount, 1);
    assert.equal(transitions.includes(second[0] ?? ""), false);
    assert.equal(
      secondState.queue.some((item) => oldIds.has(item.id)),
      false,
    );
    assert.equal(player.getQueueItemPath(oldNinth.id), first[8]);
    assert.equal(
      (await player.resolveQueueArtwork(oldNinth.id))?.sourceType,
      "folder",
    );
    assert.ok(
      player
        .getPlaybackPlanSnapshot()
        .history.entries.some(
          (entry) => entry.executionEntryId === oldNinth.id,
        ),
    );
    const newNinth = secondState.queue[0];
    assert.ok(newNinth);
    assert.equal(
      (await player.resolveQueueArtwork(newNinth.id))?.sourceType,
      "folder",
    );
  } finally {
    unsubscribe();
    await player.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

void test("PlayerService enriches a silent real file and cleans artwork", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), "eidetic-player-metadata-"));
  const first = join(folder, "01 First.wav");
  const second = join(folder, "02 Second.wav");
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await writeFile(first, silentWav());
  await writeFile(second, silentWav());
  await writeFile(join(folder, "Cover.PNG"), png);
  const artwork = new ArtworkService();
  const player = new PlayerService(new MetadataService(), artwork);
  try {
    await player.initialize();
    assert.equal(player.getState().queue.length, 0);
    await player.open([second]);
    const enriched = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentTrack?.artwork?.sourceType === "folder" &&
        state.currentTrack.sampleRate === 8_000,
      5_000,
    );
    const track = enriched.currentTrack;
    assert.ok(track);
    assert.equal(track.title, "02 Second");
    assert.equal(track.bitDepth, 16);
    assert.equal(enriched.queue.length, 1);
    assert.equal(enriched.currentQueueIndex, 0);
    assert.equal(player.getPublicState().playbackContext?.totalCount, 2);
    assert.equal(player.getPublicState().queue.length, 0);
    const ref = track.artwork;
    assert.ok(ref);
    assert.equal(
      (await player.getArtworkResource(ref.id))?.mimeType,
      "image/png",
    );
    await player.previous();
    assert.equal(player.getState().currentTrack?.path, second);
    await player.append([first, second]);
    assert.equal(player.getPublicState().queue.length, 2);
    assert.equal(player.getState().queue.length, 3);
    const firstItem = player.getPublicState().queue[0];
    assert.ok(firstItem);
    await player.removeQueueItem(firstItem.id);
    await waitFor(
      () => Promise.resolve(player.getPublicState().queue.length),
      (length) => length === 1,
    );
    const secondItem = player.getPublicState().queue[0];
    assert.ok(secondItem);
    assert.equal(
      (await player.resolveQueueArtwork(secondItem.id))?.sourceType,
      "folder",
    );
    await player.clearQueue();
    assert.equal(player.getPublicState().queue.length, 0);
    assert.equal(player.getState().queue.length, 1);
    assert.equal(player.getState().currentTrack?.path, second);
    await player.next();
    await waitFor(
      () => Promise.resolve(player.getState()),
      (state) => state.currentTrack === null && state.queue.length === 0,
    );
    const transitionBeforeAppend = player.getState().trackTransitionId;
    const revisionBeforeAppend = player.getPublicState().queueRevision;
    const appended = await player.append([first, second]);
    assert.equal(appended, 2);
    assert.equal(player.getState().queue.length, 0);
    assert.equal(player.getPublicState().queue.length, 2);
    assert.equal(player.getState().currentTrack, null);
    assert.equal(player.getState().trackTransitionId, transitionBeforeAppend);
    assert.equal(
      player.getPublicState().queueRevision,
      revisionBeforeAppend + 1,
    );
    await player.clearQueue();
  } finally {
    await player.shutdown();
    await rm(folder, { recursive: true, force: true });
  }
  await assert.rejects(access(artwork.tempDirectory));
});

void test("USB disconnect stops without clearing or advancing and reconnect never autoplays", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "eidetic-player-usb-stop-"));
  const paths = await Promise.all(
    ["01 First.wav", "02 Selected.wav", "03 Last.wav"].map(async (filename) => {
      const path = join(root, filename);
      await writeFile(path, silentWav(10));
      return path;
    }),
  );
  const deviceId = `usb-${"a".repeat(32)}`;
  const origins = paths.map((path, index) => ({
    kind: "removable" as const,
    deviceId,
    relativePath: path.slice(root.length + 1).replaceAll("\\", "/"),
    entryId: `entry-${String(index + 1).repeat(32)}`,
  }));
  const player = new PlayerService();
  try {
    await player.initialize();
    await player.openResolvedQueue(paths, 1, origins);
    const playing = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentQueueIndex === 0 &&
        state.currentTrack?.path === paths[1] &&
        !state.paused,
      5_000,
    );
    const ids = playing.queue.map((item) => item.id);
    const currentPlaybackId =
      player.getPlaybackPlanSnapshot().current?.playbackInstanceId;
    const revision = player.getPublicState().queueRevision;
    const transition = playing.trackTransitionId;

    assert.equal(
      await player.setRemovableDeviceAvailable(deviceId, false),
      true,
    );
    const disconnected = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) => state.status === "stopped",
    );
    assert.equal(disconnected.queue[0]?.id, ids[0]);
    assert.equal(disconnected.currentQueueIndex, 0);
    assert.equal(player.getPublicState().queueRevision, revision);
    assert.equal(disconnected.trackTransitionId, transition);
    assert.equal(
      disconnected.queue.every((item) => item.available === false),
      true,
    );
    const publicState = player.getPublicState();
    assert.equal(JSON.stringify(publicState).includes(root), false);
    assert.match(publicState.currentTrack?.path ?? "", /^removable:\/\/usb-/);
    assert.equal(publicState.currentPlayback?.item.available, false);
    assert.equal(publicState.queue.length, 0);

    assert.equal(
      await player.setRemovableDeviceAvailable(deviceId, true),
      false,
    );
    assert.equal(player.getState().status, "stopped");
    assert.equal(player.getState().paused, true);
    assert.equal(player.getPublicState().queueRevision, revision);

    await player.play();
    const replayed = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentQueueIndex === 0 &&
        state.currentTrack?.path === paths[1] &&
        !state.paused,
      5_000,
    );
    assert.deepEqual(
      replayed.queue.map((item) => item.id),
      ids,
    );
    assert.equal(
      player.getPlaybackPlanSnapshot().current?.playbackInstanceId,
      currentPlaybackId,
    );
  } finally {
    await player.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

void test("removable Library disconnect preserves a mixed Queue and stops only its current item", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "eidetic-player-usb-library-"));
  const localPath = join(root, "Local.wav");
  const usbPath = join(root, "USB.wav");
  await Promise.all([
    writeFile(localPath, silentWav(10)),
    writeFile(usbPath, silentWav(10)),
  ]);
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const origins = [
    {
      kind: "folders" as const,
      sourceId: "22222222-2222-4222-8222-222222222222",
      relativePath: "Local.wav",
      libraryTrackId: `track-${"1".repeat(32)}`,
    },
    {
      kind: "folders" as const,
      sourceId,
      relativePath: "USB.wav",
      libraryTrackId: `track-${"2".repeat(32)}`,
      removable: true as const,
    },
  ];
  const player = new PlayerService();
  try {
    await player.initialize();
    await player.openResolvedQueue([localPath, usbPath], 0, origins);
    const playingLocal = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) => state.currentQueueIndex === 0 && !state.paused,
      5_000,
    );
    const ids = playingLocal.queue.map((item) => item.id);
    const usbExecutionId = ids[1];
    assert.ok(usbExecutionId);
    const revision = player.getPublicState().queueRevision;
    assert.equal(await player.setFolderSourceAvailable(sourceId, false), false);
    assert.equal(player.getState().status, "playing");
    assert.equal(player.getState().queue[0]?.available, true);
    assert.equal(player.getState().queue.length, 1);
    const unavailableUsb = player
      .getPlaybackPlanSnapshot()
      .context?.originalItems.find(
        (item) => item.item.origin.sourceId === sourceId,
      );
    assert.equal(unavailableUsb?.item.availability, "unavailable");
    assert.equal(player.getPublicState().queueRevision, revision);
    assert.match(
      player.getPublicState().currentTrack?.path ?? "",
      /^library-source:\/\/22222222-2222-4222-8222-222222222222\/Local\.wav$/u,
    );
    assert.equal(player.getPublicState().queue.length, 0);
    assert.equal(
      player.getPublicState().playbackContext?.nextItem?.available,
      false,
    );

    await player.setFolderSourceAvailable(sourceId, true);
    await waitFor(
      () => Promise.resolve(player.getState().queue.map((item) => item.id)),
      (queueIds) => queueIds.length === 2 && queueIds[1] === usbExecutionId,
    );
    await player.next();
    await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentQueueIndex === 0 &&
        state.currentTrack?.path === usbPath &&
        !state.paused,
      5_000,
    );
    assert.equal(player.getState().currentTrack?.source, "USB Storage");
    assert.equal(await player.setFolderSourceAvailable(sourceId, false), true);
    assert.equal(player.getState().status, "stopped");
    assert.equal(player.getState().currentQueueIndex, 0);
    assert.equal(player.getState().queue[0]?.id, usbExecutionId);
    assert.equal(
      player.getPlaybackPlanSnapshot().current?.item.availability,
      "unavailable",
    );
    assert.equal(player.getPublicState().queueRevision, revision);
  } finally {
    await player.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

void test("persistent MPV accepts rapid transport and level commands through one transition", async (context) => {
  const discovery = await discoverMpv();
  if (!discovery) {
    context.skip("MPV is not installed; integration test skipped.");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "eidetic-player-commands-"));
  const paths = await Promise.all(
    Array.from({ length: 4 }, async (_, index) => {
      const path = join(root, `${String(index + 1)}.wav`);
      await writeFile(path, silentWav(10));
      return path;
    }),
  );
  const player = new PlayerService(undefined, undefined, {
    commandDiagnostics: true,
  });
  const clientSessionId = "123e4567-e89b-42d3-a456-426614174000";
  const metadata = (intentId: number) => ({
    clientSessionId,
    intentId,
    requestedAtMilliseconds: performance.now(),
  });
  try {
    await player.initialize();
    await player.openResolvedQueue(paths, 0);
    await waitFor(
      () => Promise.resolve(player.getState()),
      (state) => state.currentQueueIndex === 0 && !state.paused,
      5_000,
    );
    const contextId = player.getPlaybackPlanSnapshot().context?.contextId;
    assert.ok(contextId);
    const explicitRevision = player.getPublicState().queueRevision;

    await Promise.all([
      player.next(metadata(1)),
      player.setVolume(63, metadata(2)),
      player.pause(metadata(3)),
      player.play(metadata(4)),
    ]);
    await Promise.all([
      player.next(metadata(5)),
      player.previous(metadata(6)),
      player.setMuted(true, metadata(7)),
      player.setMuted(false, metadata(8)),
    ]);

    const settled = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentQueueIndex === 0 &&
        state.currentTrack?.path === paths[1] &&
        Math.abs(state.volume - 63) < 0.55 &&
        !state.muted &&
        !state.paused &&
        state.commands?.volume.phase === "confirmed" &&
        state.commands.mute.phase === "confirmed" &&
        state.commands.transport.phase === "confirmed",
      5_000,
    );
    assert.deepEqual(
      settled.queue.map((item) => item.path),
      paths.slice(1),
    );
    assert.equal(
      player.getPlaybackPlanSnapshot().context?.contextId,
      contextId,
    );
    assert.equal(
      player.getPlaybackPlanSnapshot().current?.item.nativePath,
      paths[1],
    );
    assert.equal(player.getPublicState().queue.length, 0);
    assert.equal(player.getPublicState().queueRevision, explicitRevision);
    const diagnostics = player.getCommandDiagnostics();
    for (const stage of [
      "service-accepted",
      "ipc-sent",
      "ipc-acknowledged",
      "property-confirmed",
    ] as const)
      assert.ok(
        diagnostics.some((entry) => entry.stage === stage),
        stage,
      );
  } finally {
    await player.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
