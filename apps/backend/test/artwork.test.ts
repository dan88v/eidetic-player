import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ArtworkService,
  cleanupStaleArtworkDirectories,
  detectImageMime,
  isOpaqueArtworkId,
  MAX_ARTWORK_BYTES,
  selectEmbeddedPicture,
  validatePicture,
} from "../src/artwork/artwork-service.js";
import type { PictureCandidate } from "../src/metadata/types.js";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);

function picture(
  data: Uint8Array,
  mimeType: string,
  type: string | null = null,
): PictureCandidate {
  return { data, mimeType, type, description: null };
}

void test("JPEG, PNG, and WebP signatures are recognized", () => {
  assert.equal(detectImageMime(jpeg), "image/jpeg");
  assert.equal(detectImageMime(png), "image/png");
  assert.equal(detectImageMime(webp), "image/webp");
});

void test("stale artwork directories from dead app processes are removed", async () => {
  const directory = join(
    tmpdir(),
    "eidetic-player-artwork-2147483647-00000000-0000-4000-8000-000000000000",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "stale.jpg"), jpeg);
  await cleanupStaleArtworkDirectories();
  await assert.rejects(access(directory));
});

void test("false MIME and oversized artwork are rejected", () => {
  assert.equal(validatePicture(picture(png, "image/jpeg")), null);
  assert.equal(validatePicture(picture(jpeg, "image/svg+xml")), null);
  assert.equal(validatePicture(picture(jpeg, "image/jpeg"), 3), null);
  assert.equal(MAX_ARTWORK_BYTES, 15 * 1024 * 1024);
});

void test("front cover wins, otherwise the first valid picture is used", () => {
  const generic = picture(png, "image/png", "Other");
  const front = picture(jpeg, "image/jpeg", "Cover (front)");
  assert.equal(selectEmbeddedPicture([generic, front]), front);
  assert.equal(
    selectEmbeddedPicture([
      picture(Uint8Array.from([1, 2, 3]), "image/jpeg"),
      generic,
    ]),
    generic,
  );
});

void test("embedded artwork has priority, receives an opaque ID, and cleans up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-artwork-audio-"));
  const audio = join(directory, "track.mp3");
  await writeFile(audio, "audio");
  await writeFile(join(directory, "cover.jpg"), jpeg);
  const service = new ArtworkService();
  const temporary = service.tempDirectory;
  try {
    const ref = await service.resolve(audio, "media-a", [
      picture(png, "image/png", "Cover (front)"),
    ]);
    assert.ok(ref);
    assert.equal(ref.sourceType, "embedded");
    assert.equal(isOpaqueArtworkId(ref.id), true);
    assert.equal((await service.getResource(ref.id))?.mimeType, "image/png");
    assert.equal(await service.getResource("../cover.jpg"), null);
    assert.equal(await service.getResource("unknown"), null);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
  await assert.rejects(access(temporary));
});

void test("folder lookup is case-insensitive and cover beats folder and front", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-artwork-folder-"));
  const audio = join(directory, "track.flac");
  await writeFile(audio, "audio");
  await writeFile(join(directory, "front.WebP"), webp);
  await writeFile(join(directory, "Folder.jpeg"), jpeg);
  await writeFile(join(directory, "COVER.PNG"), png);
  const service = new ArtworkService();
  try {
    const ref = await service.resolve(audio, "media-b", []);
    assert.ok(ref);
    assert.equal(ref.sourceType, "folder");
    assert.equal(ref.mimeType, "image/png");
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test("folder beats front and missing artwork returns null", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-artwork-priority-"));
  const audio = join(directory, "track.flac");
  await writeFile(audio, "audio");
  await writeFile(join(directory, "front.jpg"), jpeg);
  await writeFile(join(directory, "folder.png"), png);
  const service = new ArtworkService();
  try {
    assert.equal(
      (await service.resolve(audio, "media-c", []))?.mimeType,
      "image/png",
    );
    await rm(join(directory, "folder.png"));
    await rm(join(directory, "front.jpg"));
    assert.equal(await service.resolve(audio, "media-d", []), null);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test("folder artwork fingerprint changes invalidate the cached registry ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-artwork-change-"));
  const audio = join(directory, "track.wav");
  const cover = join(directory, "cover.png");
  await writeFile(audio, "audio");
  await writeFile(cover, png);
  const service = new ArtworkService();
  try {
    const first = await service.resolve(audio, "media-e", []);
    assert.ok(first);
    await writeFile(cover, Uint8Array.from([...png, 0]));
    const second = await service.resolve(audio, "media-e", []);
    assert.ok(second);
    assert.notEqual(first.id, second.id);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
