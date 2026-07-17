import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverMpv } from "../src/player/mpv-discovery.js";
import { MpvController } from "../src/player/mpv-controller.js";
import { PlayerService } from "../src/player/player-service.js";
import { MetadataService } from "../src/metadata/metadata-service.js";
import { ArtworkService } from "../src/artwork/artwork-service.js";

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
    await player.open([first]);
    const enriched = await waitFor(
      () => Promise.resolve(player.getState()),
      (state) =>
        state.currentTrack?.artwork?.sourceType === "folder" &&
        state.currentTrack.sampleRate === 8_000,
      5_000,
    );
    const track = enriched.currentTrack;
    assert.ok(track);
    assert.equal(track.title, "01 First");
    assert.equal(track.bitDepth, 16);
    assert.equal(enriched.queue.length, 2);
    const ref = track.artwork;
    assert.ok(ref);
    assert.equal(
      (await player.getArtworkResource(ref.id))?.mimeType,
      "image/png",
    );
    await player.next();
    await waitFor(
      () => Promise.resolve(player.getState().currentQueueIndex),
      (index) => index === 1,
    );
    await player.previous();
    await waitFor(
      () => Promise.resolve(player.getState().currentQueueIndex),
      (index) => index === 0,
    );
    const secondItem = player.getState().queue[1];
    assert.ok(secondItem);
    assert.equal(
      (await player.resolveQueueArtwork(secondItem.id))?.sourceType,
      "folder",
    );
  } finally {
    await player.shutdown();
    await rm(folder, { recursive: true, force: true });
  }
  await assert.rejects(access(artwork.tempDirectory));
});
