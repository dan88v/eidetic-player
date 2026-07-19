import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import type { IAudioMetadata } from "music-metadata";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import { SourceRepository } from "../src/filesystem/source-repository.js";
import { SourceService } from "../src/filesystem/source-service.js";
import { LibraryDatabase } from "../src/library/library-database.js";
import { LibraryRepository } from "../src/library/library-repository.js";
import { LibraryScanner } from "../src/library/library-scanner.js";
import { MetadataService } from "../src/metadata/metadata-service.js";

function metadataFor(path: string): IAudioMetadata {
  const name = basename(path);
  return {
    common: {
      title: name.replace(/\.[^.]+$/, ""),
      artist: name.includes("Duet") ? "Artist A & Artist B" : "Artist A",
      artists: name.includes("Duet") ? ["Artist A", "Artist B"] : ["Artist A"],
      album: " Album ",
      albumartist: "Artist A",
      compilation: false,
      track: { no: 1, of: 3 },
      disk: { no: 1, of: 1 },
      movementIndex: { no: null, of: null },
      year: 2026,
      genre: [" Pop "],
      picture: name.includes("Cover")
        ? [
            {
              format: "image/jpeg",
              data: Uint8Array.from([0xff, 0xd8, 0xff]),
            },
          ]
        : [],
    },
    format: {
      trackInfo: [],
      tagTypes: [],
      duration: 120,
      codec: "MPEG 1 Layer 3",
      container: "MPEG",
      sampleRate: 44_100,
      bitsPerSample: 16,
      bitrate: 320_000.49,
      numberOfChannels: 2,
      lossless: false,
    },
    native: {},
    quality: { warnings: [] },
  };
}

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-scan-"));
  const root = join(temporary, "Music");
  const nested = join(root, "Nested");
  await mkdir(nested, { recursive: true });
  await writeFile(join(root, "01 Cover.mp3"), "one");
  await writeFile(join(nested, "02 Duet.flac"), "two");
  await writeFile(join(root, "notes.txt"), "ignored");
  await writeFile(join(root, ".hidden.mp3"), "hidden");
  await mkdir(join(root, ".hidden-folder"));
  await writeFile(join(root, ".hidden-folder", "hidden.flac"), "hidden");
  const outside = join(temporary, "Outside");
  await mkdir(outside);
  await writeFile(join(outside, "escape.mp3"), "escape");
  await symlink(outside, join(root, "Linked"), "junction").catch(
    () => undefined,
  );
  const provider = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(provider);
  const sourceRepository = new SourceRepository(
    join(temporary, "config", "sources.json"),
  );
  const sources = new SourceService(provider, paths, sourceRepository);
  const added = await sources.addLocal(root);
  const database = await LibraryDatabase.open(
    join(temporary, "data", "library.db"),
  );
  const repository = new LibraryRepository(database);
  repository.syncConfiguredSources(await sourceRepository.list());
  return {
    temporary,
    root,
    provider,
    paths,
    sourceRepository,
    sources,
    sourceId: added.source.id,
    database,
    repository,
  };
}

void test("scanner recursively indexes supported files and preserves normalized entities", async () => {
  const context = await fixture();
  let parseCount = 0;
  const metadata = new MetadataService((path) => {
    parseCount += 1;
    return Promise.resolve(metadataFor(path));
  });
  const scanner = new LibraryScanner(
    context.provider,
    context.paths,
    context.sources,
    context.repository,
    { metadata, batchSize: 1 },
  );
  try {
    const first = await scanner.scan(
      context.sourceId,
      "11111111-1111-4111-8111-111111111111",
      new AbortController().signal,
      () => undefined,
    );
    assert.equal(first.progress.status, "completed");
    assert.equal(first.progress.filesDiscovered, 2);
    assert.equal(first.progress.filesNew, 2);
    assert.equal(first.progress.filesFailed, 0);
    assert.equal(parseCount, 2);
    assert.equal(first.transactionCount, 4);
    assert.ok(first.maximumTransactionMilliseconds > 0);
    assert.ok(first.averageTransactionMilliseconds > 0);
    assert.deepEqual(context.repository.summary(), {
      trackCount: 2,
      availableTrackCount: 2,
      unavailableTrackCount: 0,
      albumCount: 1,
      artistCount: 2,
      sourceCount: 1,
      scanStatus: "completed",
      lastSuccessfulScan: context.repository.summary().lastSuccessfulScan,
    });
    const rows = context.database.connection
      .prepare(
        `SELECT relative_path, channels, bitrate, genre_raw, genre_normalized,
                artwork_available, metadata_state
         FROM tracks ORDER BY relative_path`,
      )
      .all() as Record<string, unknown>[];
    assert.deepEqual(
      rows.map((row) => row.relative_path),
      ["01 Cover.mp3", "Nested/02 Duet.flac"],
    );
    const firstRow = rows[0];
    assert.ok(firstRow);
    assert.equal(firstRow.channels, 2);
    assert.equal(firstRow.bitrate, 320_000);
    assert.equal(firstRow.genre_raw, '["Pop"]');
    assert.equal(firstRow.genre_normalized, '["pop"]');
    assert.equal(firstRow.artwork_available, 1);
    assert.equal(firstRow.metadata_state, "parsed");
    assert.equal(
      JSON.stringify(context.repository.summary()).includes(context.root),
      false,
    );

    const second = await scanner.scan(
      context.sourceId,
      "22222222-2222-4222-8222-222222222222",
      new AbortController().signal,
      () => undefined,
    );
    assert.equal(second.progress.filesUnchanged, 2);
    assert.equal(second.metadataParses, 0);
    assert.equal(parseCount, 2);

    await writeFile(join(context.root, "01 Cover.mp3"), "changed-size");
    const future = new Date(Date.now() + 2_000);
    await utimes(join(context.root, "01 Cover.mp3"), future, future);
    await writeFile(join(context.root, "03 New.wav"), "new");
    await rm(join(context.root, "Nested", "02 Duet.flac"));
    const third = await scanner.scan(
      context.sourceId,
      "33333333-3333-4333-8333-333333333333",
      new AbortController().signal,
      () => undefined,
    );
    assert.equal(third.progress.filesModified, 1);
    assert.equal(third.progress.filesNew, 1);
    assert.equal(third.progress.filesUnavailable, 1);
    assert.equal(context.repository.summary().trackCount, 3);
    assert.equal(context.repository.summary().unavailableTrackCount, 1);

    await writeFile(join(context.root, "Nested", "02 Duet.flac"), "returned");
    const fourth = await scanner.scan(
      context.sourceId,
      "44444444-4444-4444-8444-444444444444",
      new AbortController().signal,
      () => undefined,
    );
    assert.equal(fourth.progress.status, "completed");
    assert.equal(context.repository.summary().unavailableTrackCount, 0);
  } finally {
    scanner.clear();
    context.database.close();
    await rm(context.temporary, { recursive: true, force: true });
  }
});

void test("metadata failure is recorded per file and does not stop the scan", async () => {
  const context = await fixture();
  const scanner = new LibraryScanner(
    context.provider,
    context.paths,
    context.sources,
    context.repository,
    {
      metadata: new MetadataService((path) => {
        if (path.endsWith(".flac"))
          return Promise.reject(new Error("corrupt fixture"));
        return Promise.resolve(metadataFor(path));
      }),
    },
  );
  try {
    const result = await scanner.scan(
      context.sourceId,
      "55555555-5555-4555-8555-555555555555",
      new AbortController().signal,
      () => undefined,
    );
    assert.equal(result.progress.status, "completed");
    assert.equal(result.progress.filesFailed, 1);
    const failed = context.database.connection
      .prepare(
        `SELECT metadata_state, metadata_error_code
         FROM tracks WHERE relative_path = 'Nested/02 Duet.flac'`,
      )
      .get() as Record<string, unknown>;
    assert.equal(failed.metadata_state, "failed");
    assert.equal(failed.metadata_error_code, "METADATA_PARSE_FAILED");
  } finally {
    scanner.clear();
    context.database.close();
    await rm(context.temporary, { recursive: true, force: true });
  }
});

void test("a failed batch is rolled back and the scan reaches a terminal failed state", async () => {
  const context = await fixture();
  context.database.connection.exec(`
    CREATE TRIGGER reject_library_track
    BEFORE INSERT ON tracks
    BEGIN
      SELECT RAISE(ABORT, 'forced batch failure');
    END
  `);
  const scanner = new LibraryScanner(
    context.provider,
    context.paths,
    context.sources,
    context.repository,
    {
      metadata: new MetadataService((path) =>
        Promise.resolve(metadataFor(path)),
      ),
      batchSize: 1,
    },
  );
  try {
    const result = await scanner.scan(
      context.sourceId,
      "5f5f5f5f-5555-4555-8555-555555555555",
      new AbortController().signal,
      () => undefined,
    );
    assert.equal(result.progress.status, "failed");
    assert.equal(
      context.database.connection
        .prepare("SELECT COUNT(*) AS count FROM tracks")
        .get()?.count,
      0,
    );
    assert.equal(context.repository.listSources()[0]?.scanStatus, "failed");
  } finally {
    scanner.clear();
    context.database.close();
    await rm(context.temporary, { recursive: true, force: true });
  }
});

void test("cancel is cooperative and never marks unseen tracks unavailable", async () => {
  const context = await fixture();
  const initialScanner = new LibraryScanner(
    context.provider,
    context.paths,
    context.sources,
    context.repository,
    {
      metadata: new MetadataService((path) =>
        Promise.resolve(metadataFor(path)),
      ),
    },
  );
  try {
    await initialScanner.scan(
      context.sourceId,
      "66666666-6666-4666-8666-666666666666",
      new AbortController().signal,
      () => undefined,
    );
    initialScanner.clear();
    await rm(join(context.root, "Nested", "02 Duet.flac"));
    await writeFile(join(context.root, "00 Slow.mp3"), "slow");
    let release = (): void => {
      throw new Error("Slow parser did not start");
    };
    let started: (() => void) | null = null;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const scanner = new LibraryScanner(
      context.provider,
      context.paths,
      context.sources,
      context.repository,
      {
        metadata: new MetadataService(async (path) => {
          if (path.endsWith("00 Slow.mp3")) {
            started?.();
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return metadataFor(path);
        }),
        batchSize: 1,
      },
    );
    const controller = new AbortController();
    const operation = scanner.scan(
      context.sourceId,
      "77777777-7777-4777-8777-777777777777",
      controller.signal,
      () => undefined,
    );
    await startedPromise;
    controller.abort();
    release();
    const cancelled = await operation;
    assert.equal(cancelled.progress.status, "cancelled");
    assert.equal(cancelled.progress.filesUnavailable, 0);
    assert.equal(context.repository.summary().unavailableTrackCount, 0);
    scanner.clear();
  } finally {
    context.database.close();
    await rm(context.temporary, { recursive: true, force: true });
  }
});

void test("a partial directory traversal preserves previously available tracks", async () => {
  const context = await fixture();
  const metadata = new MetadataService((path) =>
    Promise.resolve(metadataFor(path)),
  );
  const initialScanner = new LibraryScanner(
    context.provider,
    context.paths,
    context.sources,
    context.repository,
    { metadata },
  );
  const partialProvider = new LocalFilesystemProvider();
  const readDirectory = partialProvider.readdir.bind(partialProvider);
  partialProvider.readdir = (path) =>
    path === join(context.root, "Nested")
      ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
      : readDirectory(path);
  const partialScanner = new LibraryScanner(
    partialProvider,
    context.paths,
    context.sources,
    context.repository,
    { metadata },
  );
  try {
    await initialScanner.scan(
      context.sourceId,
      "7a7a7a7a-7777-4777-8777-777777777777",
      new AbortController().signal,
      () => undefined,
    );
    const partial = await partialScanner.scan(
      context.sourceId,
      "7b7b7b7b-7777-4777-8777-777777777777",
      new AbortController().signal,
      () => undefined,
    );
    assert.equal(partial.progress.status, "failed");
    assert.equal(partial.progress.errorCode, "TRAVERSAL_INCOMPLETE");
    assert.equal(context.repository.summary().availableTrackCount, 2);
    assert.equal(context.repository.summary().unavailableTrackCount, 0);
  } finally {
    initialScanner.clear();
    partialScanner.clear();
    context.database.close();
    await rm(context.temporary, { recursive: true, force: true });
  }
});

void test("unavailable source preserves catalog and returns with the same identities", async () => {
  const context = await fixture();
  const scanner = new LibraryScanner(
    context.provider,
    context.paths,
    context.sources,
    context.repository,
    {
      metadata: new MetadataService((path) =>
        Promise.resolve(metadataFor(path)),
      ),
    },
  );
  const offline = `${context.root}-offline`;
  try {
    await scanner.scan(
      context.sourceId,
      "88888888-8888-4888-8888-888888888888",
      new AbortController().signal,
      () => undefined,
    );
    const ids = (
      context.database.connection
        .prepare("SELECT track_id FROM tracks ORDER BY relative_path")
        .all() as { track_id: string }[]
    ).map((row) => row.track_id);
    await rename(context.root, offline);
    const unavailable = await scanner.scan(
      context.sourceId,
      "99999999-9999-4999-8999-999999999999",
      new AbortController().signal,
      () => undefined,
    );
    assert.equal(unavailable.progress.status, "source-unavailable");
    assert.equal(context.repository.summary().trackCount, 2);
    assert.equal(context.repository.summary().availableTrackCount, 0);
    await rename(offline, context.root);
    const returned = await scanner.scan(
      context.sourceId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      new AbortController().signal,
      () => undefined,
    );
    assert.equal(returned.progress.status, "completed");
    assert.deepEqual(
      (
        context.database.connection
          .prepare("SELECT track_id FROM tracks ORDER BY relative_path")
          .all() as { track_id: string }[]
      ).map((row) => row.track_id),
      ids,
    );
  } finally {
    if (await import("node:fs").then(({ existsSync }) => existsSync(offline)))
      await rename(offline, context.root);
    scanner.clear();
    context.database.close();
    await rm(context.temporary, { recursive: true, force: true });
  }
});
