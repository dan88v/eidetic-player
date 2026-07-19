import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { resolveAppDirectories } from "../src/platform/app-directories.js";
import { createMpvEndpoint } from "../src/player/mpv-endpoint.js";

const execFileAsync = promisify(execFile);

void test("Linux application directories honor all XDG roots", () => {
  assert.deepEqual(
    resolveAppDirectories(
      "linux",
      {
        XDG_CONFIG_HOME: "/xdg/config",
        XDG_CACHE_HOME: "/xdg/cache",
        XDG_DATA_HOME: "/xdg/data",
        XDG_RUNTIME_DIR: "/xdg/runtime",
      },
      "/home/Ü ser",
      "/tmp",
    ),
    {
      config: "/xdg/config/eidetic-player",
      cache: "/xdg/cache/eidetic-player",
      data: "/xdg/data/eidetic-player",
      runtime: "/xdg/runtime/eidetic-player",
    },
  );
});

void test("Linux application directories have safe XDG fallbacks", () => {
  const paths = resolveAppDirectories("linux", {}, "/home/Ü ser", "/tmp");
  assert.equal(paths.config, "/home/Ü ser/.config/eidetic-player");
  assert.equal(paths.cache, "/home/Ü ser/.cache/eidetic-player");
  assert.equal(paths.data, "/home/Ü ser/.local/share/eidetic-player");
  assert.match(paths.runtime, /^\/tmp\/eidetic-player-\d+$/);
});

void test(
  "MPV Unix endpoints are private, unique, stale-safe, and cleaned",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "eidetic endpoint Ü "));
    try {
      const runtime = join(root, "run");
      const first = await createMpvEndpoint("linux", {}, runtime);
      const second = await createMpvEndpoint("linux", {}, runtime);
      assert.notEqual(first.path, second.path);
      assert.equal((await stat(runtime)).mode & 0o777, 0o700);
      await writeFile(first.path, "stale");
      await first.cleanup();
      await assert.rejects(access(first.path));
      await second.cleanup();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

void test("MPV Unix endpoints reject paths beyond portable socket limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-long-endpoint-"));
  const runtime = join(root, "x".repeat(100));
  try {
    await assert.rejects(createMpvEndpoint("linux", {}, runtime), /too long/);
    await assert.rejects(access(runtime));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test(
  "real POSIX filesystem preserves case, Unicode, permissions, links, and special files",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "eidetic-posix-Ü space-"));
    const outside = await mkdtemp(join(tmpdir(), "eidetic-posix-outside-"));
    try {
      await Promise.all([
        writeFile(join(root, "Album.flac"), "upper"),
        writeFile(join(root, "album.flac"), "lower"),
        writeFile(join(root, ".hidden.mp3"), "hidden"),
        writeFile(join(root, "line\nbreak.wav"), "newline"),
        writeFile(join(root, "brano ünicode.mp3"), "unicode"),
        writeFile(join(outside, "escape.flac"), "outside"),
        mkdir(join(root, "locked")),
      ]);
      await chmod(join(root, "locked"), 0o000);
      await symlink("Album.flac", join(root, "internal-link"));
      await symlink(join(outside, "escape.flac"), join(root, "external-link"));
      await symlink("missing.flac", join(root, "broken-link"));
      await execFileAsync("mkfifo", [join(root, "audio.fifo")]);

      assert.equal(await readFile(join(root, "Album.flac"), "utf8"), "upper");
      assert.equal(await readFile(join(root, "album.flac"), "utf8"), "lower");
      assert.equal(
        (await lstat(join(root, "internal-link"))).isSymbolicLink(),
        true,
      );
      assert.equal(
        (await lstat(join(root, "external-link"))).isSymbolicLink(),
        true,
      );
      assert.equal(
        (await lstat(join(root, "broken-link"))).isSymbolicLink(),
        true,
      );
      assert.equal((await lstat(join(root, "audio.fifo"))).isFIFO(), true);
      await assert.rejects(readdir(join(root, "locked")));
      const names = await readdir(root);
      assert.ok(names.includes("Album.flac"));
      assert.ok(names.includes("album.flac"));
      assert.ok(names.includes("brano ünicode.mp3"));
      assert.ok(names.includes("line\nbreak.wav"));
    } finally {
      await chmod(join(root, "locked"), 0o700).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  },
);
