import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import type { SourceService } from "../src/filesystem/source-service.js";
import {
  PlayerService as ConcretePlayerService,
  type PlayerService,
} from "../src/player/player-service.js";
import { PlayerSessionRepository } from "../src/player-session/player-session-repository.js";
import { PlayerSessionService } from "../src/player-session/player-session-service.js";
import type {
  PlayerSessionSnapshot,
  ResolvedQueueItem,
} from "../src/player-session/player-session-types.js";

const currentId = "queue-11111111-1111-4111-8111-111111111111";
const secondaryId = "queue-22222222-2222-4222-8222-222222222222";

void test("playlist identity alignment follows paths through shuffle, including duplicate paths", () => {
  const player = new ConcretePlayerService();
  const internals = player as unknown as {
    capturePlaylistIdentities(
      paths: readonly string[],
      ids: readonly string[],
    ): Map<string, string[]>;
    alignPlaylistItemIds(
      playlist: unknown,
      identities: ReadonlyMap<string, readonly string[]>,
    ): void;
    playlistItemIds: string[];
  };
  const first = "/music/first.flac";
  const duplicate = "/music/duplicate.flac";
  const ids = [
    "queue-11111111-1111-4111-8111-111111111111",
    "queue-22222222-2222-4222-8222-222222222222",
    "queue-33333333-3333-4333-8333-333333333333",
  ];
  const identities = internals.capturePlaylistIdentities(
    [first, duplicate, duplicate],
    ids,
  );

  internals.alignPlaylistItemIds(
    [{ filename: duplicate }, { filename: first }, { filename: duplicate }],
    identities,
  );

  assert.deepEqual(internals.playlistItemIds, [ids[1], ids[0], ids[2]]);
});

void test("indexed SMB tracks retain their network source presentation", () => {
  const player = new ConcretePlayerService();
  const path = "/mounted/share/Album/Track.flac";
  const internals = player as unknown as {
    queueOrigins: Map<string, unknown>;
    pathKey(path: string): string;
    createTrack(
      path: string,
      durationSeconds: number,
    ): {
      source: string;
    };
  };
  internals.queueOrigins.set(internals.pathKey(path), {
    kind: "folders",
    sourceId: "33333333-3333-4333-8333-333333333333",
    relativePath: "Album/Track.flac",
    libraryTrackId: `track-${"2".repeat(32)}`,
    smb: true,
  });

  assert.equal(internals.createTrack(path, 180).source, "Network Share");
});

void test("session repository preserves SMB Quick Browse and indexed SMB origins", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-smb-"));
  const repository = new PlayerSessionRepository(join(root, "session.json"));
  try {
    await repository.write({
      version: 1,
      currentQueueItemId: currentId,
      queue: [
        {
          id: currentId,
          origin: {
            kind: "smb",
            connectionId: "smb-11111111111111111111111111111111",
            relativePath: "Music/Track.flac",
            entryId: "entry-11111111111111111111111111111111",
          },
          filename: "Track.flac",
          displayTitle: "Quick Browse",
        },
        {
          id: secondaryId,
          origin: {
            kind: "folders",
            sourceId: "33333333-3333-4333-8333-333333333333",
            relativePath: "Track.flac",
            libraryTrackId: `track-${"2".repeat(32)}`,
            smb: true,
          },
          filename: "Track.flac",
          displayTitle: "Indexed",
        },
      ],
    });
    const restored = await repository.read();
    assert.ok(restored);
    const quickBrowse = restored.queue[0];
    const indexed = restored.queue[1];
    assert.ok(quickBrowse);
    assert.ok(indexed);
    assert.equal(quickBrowse.origin.kind, "smb");
    assert.deepEqual(quickBrowse.origin, {
      kind: "smb",
      connectionId: "smb-11111111111111111111111111111111",
      relativePath: "Music/Track.flac",
      entryId: "entry-11111111111111111111111111111111",
    });
    assert.deepEqual(indexed.origin, {
      kind: "folders",
      sourceId: "33333333-3333-4333-8333-333333333333",
      relativePath: "Track.flac",
      libraryTrackId: `track-${"2".repeat(32)}`,
      smb: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("session restore keeps the current item, drops missing secondary files, and starts paused", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-"));
  try {
    const currentPath = join(root, "current.mp3");
    const missingPath = join(root, "missing.mp3");
    await writeFile(currentPath, "");
    const repository = new PlayerSessionRepository(join(root, "session.json"));
    await repository.write({
      version: 1,
      currentQueueItemId: currentId,
      queue: [
        {
          id: currentId,
          origin: { kind: "direct", nativePath: currentPath },
          filename: "current.mp3",
          displayTitle: "Current",
        },
        {
          id: secondaryId,
          origin: { kind: "direct", nativePath: missingPath },
          filename: "missing.mp3",
          displayTitle: "Missing",
        },
      ],
    });
    let restored: readonly ResolvedQueueItem[] = [];
    let selectedIndex = -1;
    const snapshot: PlayerSessionSnapshot = {
      currentQueueItemId: currentId,
      queue: [
        {
          id: currentId,
          origin: { kind: "direct", nativePath: currentPath },
          filename: "current.mp3",
          displayTitle: "Current",
        },
      ],
    };
    const player = {
      restoreResolvedQueue(items: readonly ResolvedQueueItem[], index: number) {
        restored = items;
        selectedIndex = index;
        return Promise.resolve();
      },
      getSessionSnapshot() {
        return snapshot;
      },
      subscribe() {
        return () => undefined;
      },
    } as unknown as PlayerService;
    const provider = new LocalFilesystemProvider();
    const service = new PlayerSessionService(
      repository,
      provider,
      PathService.forCurrentPlatform(provider),
      {} as SourceService,
      player,
    );
    const result = await service.restore();
    assert.equal(result.status, "restored");
    assert.equal(result.discardedCount, 1);
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.id, currentId);
    assert.equal(selectedIndex, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("an unavailable saved current item invalidates the whole session without fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-session-"));
  try {
    const availablePath = join(root, "available.mp3");
    await writeFile(availablePath, "");
    const configPath = join(root, "session.json");
    const repository = new PlayerSessionRepository(configPath);
    await repository.write({
      version: 1,
      currentQueueItemId: currentId,
      queue: [
        {
          id: currentId,
          origin: { kind: "direct", nativePath: join(root, "gone.mp3") },
          filename: "gone.mp3",
          displayTitle: "Gone",
        },
        {
          id: secondaryId,
          origin: { kind: "direct", nativePath: availablePath },
          filename: "available.mp3",
          displayTitle: "Available",
        },
      ],
    });
    let restoreCalls = 0;
    const player = {
      restoreResolvedQueue() {
        restoreCalls += 1;
        return Promise.resolve();
      },
      getSessionSnapshot() {
        return { currentQueueItemId: null, queue: [] };
      },
      subscribe() {
        return () => undefined;
      },
    } as unknown as PlayerService;
    const provider = new LocalFilesystemProvider();
    const service = new PlayerSessionService(
      repository,
      provider,
      PathService.forCurrentPlatform(provider),
      {} as SourceService,
      player,
    );
    const result = await service.restore();
    assert.equal(result.status, "empty");
    assert.equal(restoreCalls, 0);
    await assert.rejects(readFile(configPath), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
