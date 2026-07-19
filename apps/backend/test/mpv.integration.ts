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
    await controller.command(["seek", 0.5, "absolute+exact"]);
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
      (state) => state.currentQueueIndex === 8,
      5_000,
    );
    assert.equal(firstState.currentTrack?.path, first[8]);
    assert.equal(firstState.queue.length, 10);
    assert.equal(transitions.includes(first[0] ?? ""), false);
    const oldIds = new Set(firstState.queue.map((item) => item.id));
    const oldNinth = firstState.queue[8];
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
        state.currentQueueIndex === 8 && state.currentTrack?.path === second[8],
      5_000,
    );
    assert.equal(secondState.queue.length, 10);
    assert.equal(transitions.includes(second[0] ?? ""), false);
    assert.equal(
      secondState.queue.some((item) => oldIds.has(item.id)),
      false,
    );
    assert.equal(player.getQueueItemPath(oldNinth.id), null);
    assert.equal(await player.resolveQueueArtwork(oldNinth.id), null);
    const newNinth = secondState.queue[8];
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
    assert.equal(enriched.queue.length, 2);
    assert.equal(enriched.currentQueueIndex, 1);
    const ref = track.artwork;
    assert.ok(ref);
    assert.equal(
      (await player.getArtworkResource(ref.id))?.mimeType,
      "image/png",
    );
    await player.previous();
    await waitFor(
      () => Promise.resolve(player.getState().currentQueueIndex),
      (index) => index === 0,
    );
    await player.append([first, second]);
    assert.equal(player.getState().queue.length, 2);
    const firstItem = player.getState().queue[0];
    assert.ok(firstItem);
    await player.removeQueueItem(firstItem.id);
    await waitFor(
      () => Promise.resolve(player.getState().queue.length),
      (length) => length === 1,
    );
    const secondItem = player.getState().queue[0];
    assert.ok(secondItem);
    assert.equal(
      (await player.resolveQueueArtwork(secondItem.id))?.sourceType,
      "folder",
    );
    await player.clearQueue();
    assert.equal(player.getState().queue.length, 0);
    assert.equal(player.getState().currentTrack, null);
    const transitionBeforeAppend = player.getState().trackTransitionId;
    const revisionBeforeAppend = player.getState().queueRevision;
    const appended = await player.append([first, second]);
    assert.equal(appended, 2);
    assert.equal(player.getState().queue.length, 2);
    assert.equal(player.getState().currentTrack, null);
    assert.equal(player.getState().trackTransitionId, transitionBeforeAppend);
    assert.equal(player.getState().queueRevision, revisionBeforeAppend + 1);
    await player.clearQueue();
  } finally {
    await player.shutdown();
    await rm(folder, { recursive: true, force: true });
  }
  await assert.rejects(access(artwork.tempDirectory));
});
