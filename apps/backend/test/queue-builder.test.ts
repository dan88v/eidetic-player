import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildQueue,
  deduplicatePaths,
  naturalSortPaths,
} from "../src/player/queue-builder.js";

void test("natural sort uses numeric filename order", () => {
  assert.deepEqual(
    naturalSortPaths(["10 - End.flac", "2 - Middle.flac", "01 - Intro.flac"]),
    ["01 - Intro.flac", "2 - Middle.flac", "10 - End.flac"],
  );
});

void test("deduplication keeps the first path", () => {
  const paths = deduplicatePaths(["one.flac", "two.flac", "ONE.flac"]);
  assert.equal(paths.length, 2);
  assert.match(paths[0] ?? "", /one\.flac$/i);
});

void test("single selection expands only later supported files, non-recursively", async () => {
  const folder = await mkdtemp(join(tmpdir(), "eidetic-queue-"));
  try {
    for (const name of [
      "01 - Intro.flac",
      "02 - Song.flac",
      "03 - Finale.mp3",
      "cover.jpg",
    ])
      await writeFile(join(folder, name), "test");
    await mkdir(join(folder, "04 - Nested"));
    await writeFile(join(folder, "04 - Nested", "04 - Hidden.flac"), "test");
    const queue = await buildQueue([join(folder, "02 - Song.flac")]);
    assert.deepEqual(
      queue.map((path) => path.split(/[\\/]/).at(-1)),
      ["02 - Song.flac", "03 - Finale.mp3"],
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

void test("multiple selection keeps explicit order and removes duplicates", async () => {
  const folder = await mkdtemp(join(tmpdir(), "eidetic-multi-"));
  try {
    const one = join(folder, "one.flac");
    const two = join(folder, "two.mp3");
    await writeFile(one, "test");
    await writeFile(two, "test");
    assert.deepEqual(await buildQueue([two, one, two]), [two, one]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
