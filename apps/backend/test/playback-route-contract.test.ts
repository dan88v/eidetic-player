import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

function read(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing route marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Missing route boundary: ${end}`);
  return source.slice(from, to);
}

void test("Library Play resolvers cover every typed Context and Queue routes only append", async () => {
  const [index, library] = await Promise.all([
    read("apps/backend/src/index.ts"),
    read("apps/backend/src/library/library-service.ts"),
  ]);
  for (const kind of [
    "album",
    "artist",
    "tracks",
    "playlist",
    "favorites",
    "recently-played",
    "most-played",
    "search",
  ])
    assert.match(library, new RegExp(`kind: "${kind}"`, "u"), kind);

  const genericPlay = region(
    index,
    'url.pathname === "/api/library/play"',
    'url.pathname === "/api/library/queue"',
  );
  assert.match(genericPlay, /resolveContext/u);
  assert.match(genericPlay, /player\.openResolvedQueue/u);
  assert.match(genericPlay, /context\.playbackContext/u);
  assert.doesNotMatch(genericPlay, /player\.append/u);

  const genericQueue = region(
    index,
    'url.pathname === "/api/library/queue"',
    'url.pathname === "/api/library/tracks/queue"',
  );
  assert.match(genericQueue, /player\.append/u);
  assert.doesNotMatch(genericQueue, /player\.openResolvedQueue/u);
  assert.match(genericQueue, /body\.context === "track"/u);

  for (const [start, end, resolver] of [
    [
      'url.pathname === "/api/library/history/most-played/play"',
      'url.pathname === "/api/library/recently-played"',
      "resolveMostPlayed",
    ],
    [
      'url.pathname === "/api/library/recently-played/play"',
      "const recentlyPlayedMatch",
      "resolveRecentlyPlayed",
    ],
    [
      'url.pathname === "/api/library/favorites/tracks/play"',
      'url.pathname === "/api/library/favorites/albums"',
      "resolveFavorites",
    ],
    [
      'url.pathname === "/api/library/favorites/albums/play"',
      'url.pathname === "/api/library/favorites/artists"',
      "resolveFavoriteAlbums",
    ],
    [
      'url.pathname === "/api/library/favorites/artists/play"',
      'url.pathname === "/api/library/playlists"',
      "resolveFavoriteArtists",
    ],
    [
      'url.pathname === "/api/library/search/play"',
      "const librarySearchCategoryMatch",
      "resolveSearch",
    ],
  ] as const) {
    const play = region(index, start, end);
    assert.match(play, new RegExp(resolver, "u"));
    assert.match(play, /player\.openResolvedQueue/u);
    assert.match(play, /context\.playbackContext/u);
    assert.doesNotMatch(play, /player\.append/u);
  }

  const playlist = region(
    index,
    "const playlistActionMatch",
    "const libraryArtworkMatch",
  );
  assert.match(playlist, /action === "play"/u);
  assert.match(playlist, /context\.playbackContext/u);
  assert.match(playlist, /player\.appendResolvedQueue/u);

  const remoteActions = region(index, "libraryAction: async", "browseSources:");
  for (const resolver of [
    "resolveContext",
    "resolveTrack",
    "resolveSearch",
    "resolveFavorites",
    "resolveRecentlyPlayed",
    "resolveMostPlayed",
    "resolvePlaylist",
  ])
    assert.match(remoteActions, new RegExp(resolver, "u"));
  assert.match(remoteActions, /operation === "queue-playlist"/u);
  assert.match(remoteActions, /\^playlist-\[0-9a-f-\]\{36\}\$/u);
});

void test("Folder, USB, SMB, dialog and drag-drop preserve Play Context versus Add semantics", async () => {
  const [index, player, shell] = await Promise.all([
    read("apps/backend/src/index.ts"),
    read("apps/backend/src/player/player-service.ts"),
    read("apps/ui/src/components/app-shell.ts"),
  ]);
  for (const [start, end] of [
    ["const smbDirectoryActionMatch", "const smbEntryMatch"],
    ["const removableDirectoryActionMatch", "const removableEntryMatch"],
    ["const directoryActionMatch", "const entryMatch"],
  ] as const) {
    const block = region(index, start, end);
    assert.match(block, /action === "play"/u);
    assert.match(block, /player\.openResolvedQueue/u);
    assert.match(block, /player\.append/u);
  }
  for (const origin of ["folders", "removable", "smb"])
    assert.match(
      player,
      new RegExp(`first\\?\\.kind === "${origin}"[\\s\\S]*kind: "folder"`, "u"),
    );

  const directOpen = region(player, "async open(", "reserveOpenRequest():");
  assert.match(directOpen, /buildQueue\(paths\)/u);
  assert.match(directOpen, /selectedIndex/u);
  assert.match(directOpen, /kind: "direct-folder"/u);
  const incomingFiles = region(
    shell,
    "const handlePaths =",
    "const closeOverlays =",
  );
  assert.match(incomingFiles, /run\(api\.open\(supported\)\)/u);
  assert.match(shell, /runSingleAudioFileSelection\(platform, handlePaths\)/u);
  assert.match(shell, /subscribeToDroppedFiles\(handlePaths\)/u);
});

void test("local and Remote Queue mutations propagate Explicit IDs and expected revisions", async () => {
  const [shell, playerApi, remote, gateway] = await Promise.all([
    read("apps/ui/src/components/app-shell.ts"),
    read("apps/ui/src/api/player-api-client.ts"),
    read("apps/remote-ui/src/main.ts"),
    read("apps/backend/src/remote-access/remote-gateway.ts"),
  ]);
  assert.match(shell, /api\.playQueue\(index, queueItemId, metadata\)/u);
  assert.match(
    shell,
    /reorderQueueItem\([\s\S]*queueItemId,[\s\S]*toIndex,[\s\S]*queueRevision/u,
  );
  assert.match(
    playerApi,
    /queueItemId,[\s\S]*toIndex,[\s\S]*expectedQueueRevision/u,
  );
  assert.match(remote, /queueItemId: item\.explicitQueueEntryId/u);
  assert.match(remote, /expectedQueueRevision: previousPlayer\.queueRevision/u);
  assert.match(shell, /api\.clearPlaybackContext\(\)/u);
  assert.match(playerApi, /post\("context\/clear", \{\}\)/u);
  assert.match(remote, /runCommand\("\/api\/context\/clear"\)/u);
  assert.match(gateway, /"\/api\/context\/clear"/u);
  for (const route of [
    "/api/library/tracks/queue",
    "/api/library/search/play",
    "/api/library/playlists/queue",
  ])
    assert.match(gateway, new RegExp(route.replaceAll("/", "\\/"), "u"));
});
