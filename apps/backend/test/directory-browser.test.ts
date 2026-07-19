import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { DirectoryBrowserService } from "../src/filesystem/directory-browser-service.js";
import { ArtworkService } from "../src/artwork/artwork-service.js";
import { MetadataService } from "../src/metadata/metadata-service.js";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import { SourceRepository } from "../src/filesystem/source-repository.js";
import { SourceService } from "../src/filesystem/source-service.js";

void test("directory browser is one-level, filtered, stable and queue-exact", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-browser-"));
  const root = join(temporary, "Library");
  const nested = join(root, "Disc 2");
  const outside = join(temporary, "Outside");
  await mkdir(nested, { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, "10 Finale.MP3"), "ten");
  await writeFile(join(root, "2 Middle.flac"), "two");
  await writeFile(join(root, "01 Start.wav"), "one");
  await writeFile(join(root, "notes.txt"), "ignored");
  await writeFile(join(root, ".secret.flac"), "hidden");
  await writeFile(join(root, "desktop.ini"), "system");
  await writeFile(
    join(root, "cover.JPG"),
    Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  );
  await writeFile(join(nested, "nested.mp3"), "nested");
  await writeFile(join(outside, "escape.mp3"), "outside");
  try {
    await symlink(outside, join(root, "Linked outside"), "junction").catch(
      () => undefined,
    );
    const provider = new LocalFilesystemProvider();
    const paths = PathService.forCurrentPlatform(provider);
    const repository = new SourceRepository(
      join(temporary, "config", "sources.json"),
    );
    const sources = new SourceService(provider, paths, repository);
    const added = await sources.addLocal(root);
    let current: string | null = null;
    const browser = new DirectoryBrowserService(
      provider,
      paths,
      sources,
      () => current,
      new MetadataService(),
      new ArtworkService(),
      2,
    );
    try {
      const first = await browser.browse(added.source.id);
      assert.equal(first.current.relativePath, "");
      assert.equal(first.parent, null);
      assert.equal(first.breadcrumbs.length, 1);
      assert.deepEqual(
        first.entries.map((entry) => entry.name),
        ["Disc 2", "01 Start.wav", "2 Middle.flac", "10 Finale.MP3"],
      );
      assert.equal(
        first.entries.some((entry) => entry.name === "nested.mp3"),
        false,
      );
      assert.equal(
        first.entries.some((entry) => entry.name === "notes.txt"),
        false,
      );
      assert.equal(first.containsUnsupportedFiles, true);
      assert.equal(
        first.entries.some((entry) => entry.name.startsWith(".")),
        false,
      );
      assert.equal(
        first.entries.some((entry) => entry.name === "desktop.ini"),
        false,
      );
      assert.equal(
        first.entries.some((entry) => entry.name === "Linked outside"),
        false,
      );
      assert.equal(
        JSON.stringify(first).includes(paths.normalizeNativePath(root)),
        false,
      );
      assert.equal(
        first.entries.every((entry) => /^entry-[0-9a-f]{32}$/.test(entry.id)),
        true,
      );

      const second = await browser.browse(added.source.id);
      assert.equal(second.fromCache, true);
      assert.deepEqual(
        second.entries.map((entry) => entry.id),
        first.entries.map((entry) => entry.id),
      );

      const selected = first.entries.find(
        (entry) => entry.name === "2 Middle.flac",
      );
      assert.ok(selected);
      assert.equal(
        basename(await browser.pathForEntry(added.source.id, selected.id)),
        "2 Middle.flac",
      );
      const queue = await browser.queueForEntry(added.source.id, selected.id);
      assert.deepEqual(
        queue.paths.map((path) => basename(path)),
        ["01 Start.wav", "2 Middle.flac", "10 Finale.MP3"],
      );
      assert.equal(queue.selectedIndex, 1);
      assert.deepEqual(
        (await browser.queueForDirectory(added.source.id, "")).map((path) =>
          basename(path),
        ),
        ["01 Start.wav", "2 Middle.flac", "10 Finale.MP3"],
      );
      const preview = await browser.folderArtworkFor(added.source.id, "");
      assert.equal(preview.mode, "single");
      assert.equal(preview.artwork.length, 1);
      assert.equal(preview.artwork[0]?.sourceType, "folder");
      assert.equal(preview.playableFileCount, 3);
      assert.equal(preview.sampledFileCount, 3);
      assert.equal(JSON.stringify(preview).includes(root), false);

      current = join(root, "2 Middle.flac");
      const refreshed = await browser.browse(added.source.id);
      assert.equal(
        refreshed.entries.find((entry) => entry.id === selected.id)?.current,
        true,
      );

      const child = await browser.browse(added.source.id, "Disc 2");
      assert.equal(child.parent?.relativePath, "");
      assert.equal(child.breadcrumbs.at(-1)?.name, "Disc 2");
      assert.deepEqual(
        child.entries.map((entry) => entry.name),
        ["nested.mp3"],
      );
      await assert.rejects(browser.browse(added.source.id, "../Outside"));
      await assert.rejects(browser.browse(added.source.id, "Disc 2\\.."));
      await assert.rejects(
        browser.queueForEntry(added.source.id, "entry-deadbeef"),
      );

      await writeFile(join(root, "3 Added.ogg"), "new");
      const future = new Date(Date.now() + 2_000);
      await utimes(root, future, future);
      const invalidated = await browser.browse(added.source.id);
      assert.equal(invalidated.fromCache, false);
      assert.equal(
        invalidated.entries.some((entry) => entry.name === "3 Added.ogg"),
        true,
      );

      await browser.browse(added.source.id, "Disc 2");
      assert.ok(browser.getDiagnostics().cacheSize <= 2);
      assert.equal(browser.getDiagnostics().metadataLimit, 2);
      assert.equal(browser.getDiagnostics().artworkLimit, 2);
    } finally {
      await browser.close();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
