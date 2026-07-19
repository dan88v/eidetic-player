import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import { resolveAppDirectories } from "../src/platform/app-directories.js";
import { playerSessionConfigPath } from "../src/player-session/player-session-repository.js";
import {
  SourceRepository,
  sourcesConfigPath,
} from "../src/filesystem/source-repository.js";
import { SourceService } from "../src/filesystem/source-service.js";

void test("Windows path normalization, containment and logical paths are strict", () => {
  const paths = new PathService("win32");
  assert.equal(
    paths.normalizeNativePath("C:/Music/Album/../Track"),
    "C:\\Music\\Track",
  );
  assert.equal(
    paths.normalizeNativePath("\\\\server\\share\\Music"),
    "\\\\server\\share\\Music",
  );
  assert.equal(
    paths.normalizeNativePath("D:\\My Music\\Björk"),
    "D:\\My Music\\Björk",
  );
  assert.equal(paths.pathKey("C:\\MUSIC"), paths.pathKey("c:/music"));
  assert.equal(paths.isWithinSource("C:\\Music", "C:\\Music\\Album"), true);
  assert.equal(paths.isWithinSource("C:\\Music", "C:\\MusicBox"), false);
  assert.equal(paths.isWithinSource("C:\\Music", "D:\\Music"), false);
  assert.equal(
    paths.toLogicalRelativePath("C:\\Music", "C:\\Music\\A\\01.flac"),
    "A/01.flac",
  );
  assert.equal(
    paths.fromLogicalRelativePath("C:\\Music", "A/01.flac"),
    "C:\\Music\\A\\01.flac",
  );
  assert.equal(paths.dirnameLogical("A/B"), "A");
  assert.equal(paths.joinLogical("A", "B"), "A/B");
  assert.equal(paths.extension("TRACK.FLAC"), "flac");
});

void test("Linux paths remain case-sensitive and use POSIX semantics", () => {
  const paths = new PathService("linux");
  assert.equal(paths.normalizeNativePath("/music/a/../b"), "/music/b");
  assert.notEqual(paths.pathKey("/Music"), paths.pathKey("/music"));
  assert.equal(paths.isWithinSource("/music", "/music/album"), true);
  assert.equal(paths.isWithinSource("/music", "/music-box"), false);
  assert.equal(paths.toLogicalRelativePath("/music", "/music/a/b"), "a/b");
  assert.equal(
    paths.toLogicalRelativePath("/mnt/music", "/mnt/music/Artist"),
    "Artist",
  );
  assert.equal(
    paths.toLogicalRelativePath("/media/user/USB", "/media/user/USB/Album 10"),
    "Album 10",
  );
});

void test("logical path validator rejects traversal and native path forms", () => {
  const paths = new PathService("win32");
  for (const value of [
    "..",
    "../album",
    "album/../other",
    "./album",
    "album//track",
    "/absolute",
    "\\absolute",
    "C:/Music",
    "C:\\Music",
    "//server/share",
    "\\\\server\\share",
    "album\\track",
    "album:track",
    "album/\0track",
  ])
    assert.throws(() => paths.validateLogicalRelativePath(value));
  assert.equal(
    paths.validateLogicalRelativePath("Artist/Album"),
    "Artist/Album",
  );
  assert.equal(paths.validateLogicalRelativePath(""), "");
});

void test("configuration paths follow Windows APPDATA and Linux XDG", () => {
  const windowsEnvironment = {
    APPDATA: "C:\\Profile\\Roaming",
    LOCALAPPDATA: "D:\\Profile\\Local",
    TEMP: "E:\\Temp",
  };
  assert.deepEqual(
    resolveAppDirectories("win32", windowsEnvironment, "C:\\Home"),
    {
      config: "C:\\Profile\\Roaming\\Eidetic Player",
      cache: "D:\\Profile\\Local\\Eidetic Player\\Cache",
      data: "D:\\Profile\\Local\\Eidetic Player\\Data",
      runtime: "E:\\Temp\\Eidetic Player\\Runtime",
    },
  );
  assert.equal(
    sourcesConfigPath("win32", windowsEnvironment, "C:\\Home"),
    "C:\\Profile\\Roaming\\Eidetic Player\\sources.json",
  );
  assert.equal(
    playerSessionConfigPath("win32", windowsEnvironment, "C:\\Home"),
    "C:\\Profile\\Roaming\\Eidetic Player\\player-session.json",
  );
  assert.equal(
    sourcesConfigPath("linux", { XDG_CONFIG_HOME: "/config" }, "/home/user"),
    "/config/eidetic-player/sources.json",
  );
  assert.equal(
    sourcesConfigPath("linux", {}, "/home/user"),
    "/home/user/.config/eidetic-player/sources.json",
  );
});

void test("source repository persists atomically and recovers corrupt JSON", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-sources-"));
  const configPath = join(temporary, "nested", "sources.json");
  try {
    const repository = new SourceRepository(configPath);
    assert.deepEqual(await repository.list(), []);
    const now = new Date().toISOString();
    const record = {
      id: "11111111-1111-4111-8111-111111111111",
      type: "local" as const,
      displayName: "Music",
      nativeRoot: "C:\\Music",
      canonicalRoot: "C:\\Music",
      createdAt: now,
      updatedAt: now,
    };
    await repository.replace([record]);
    assert.deepEqual(await new SourceRepository(configPath).list(), [record]);
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
      version: number;
    };
    assert.equal(parsed.version, 1);

    await writeFile(configPath, "{not-json", "utf8");
    assert.deepEqual(await new SourceRepository(configPath).list(), []);
    const files = await import("node:fs/promises").then(({ readdir }) =>
      readdir(join(temporary, "nested")),
    );
    assert.equal(
      files.some((name) => name.startsWith("sources.json.corrupt-")),
      true,
    );
    assert.equal(
      files.some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("source add deduplicates, rename is display-only, and remove keeps files", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-source-service-"));
  const music = join(temporary, "Music");
  const config = join(temporary, "config", "sources.json");
  await mkdir(music);
  await writeFile(join(music, "keep.flac"), "untouched");
  try {
    const provider = new LocalFilesystemProvider();
    const paths = PathService.forCurrentPlatform(provider);
    const repository = new SourceRepository(config);
    const service = new SourceService(provider, paths, repository);
    const first = await service.addLocal(music);
    const duplicate = await service.addLocal(join(music, "."));
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(first.source.id, duplicate.source.id);
    assert.equal("nativeRoot" in first.source, false);
    assert.equal("canonicalRoot" in first.source, false);

    const renamed = await service.rename(first.source.id, "  My Library  ");
    assert.equal(renamed.displayName, "My Library");
    assert.equal(
      (await repository.list())[0]?.canonicalRoot,
      paths.normalizeNativePath(music),
    );
    await assert.rejects(service.rename(first.source.id, " "));
    await assert.rejects(service.rename(first.source.id, "x".repeat(81)));

    await service.remove(first.source.id);
    assert.deepEqual(await repository.list(), []);
    assert.equal(await readFile(join(music, "keep.flac"), "utf8"), "untouched");
    await assert.rejects(service.remove(first.source.id));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
