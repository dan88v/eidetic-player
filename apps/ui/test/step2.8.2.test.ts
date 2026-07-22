import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FavoriteAlbumStore,
  FavoriteArtistStore,
} from "../src/state/favorite-track-store";

const read = (path: string): Promise<string> =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

void test("Album and Artist stores share bounded batch status and optimistic rollback", async () => {
  const albumBatches: string[][] = [];
  const artistBatches: string[][] = [];
  let failArtistRemoval = false;
  const api = {
    favoriteAlbumStatus(ids: readonly string[]) {
      albumBatches.push([...ids]);
      return Promise.resolve({ favoriteAlbumIds: [ids[0] ?? ""] });
    },
    addFavoriteAlbum(albumId: string) {
      return Promise.resolve({ albumId, isFavorite: true, favoritedAt: 1 });
    },
    removeFavoriteAlbum(albumId: string) {
      return Promise.resolve({ albumId, isFavorite: false, favoritedAt: null });
    },
    favoriteArtistStatus(ids: readonly string[]) {
      artistBatches.push([...ids]);
      return Promise.resolve({ favoriteArtistIds: [ids[0] ?? ""] });
    },
    addFavoriteArtist(artistId: string) {
      return Promise.resolve({ artistId, isFavorite: true, favoritedAt: 1 });
    },
    removeFavoriteArtist(artistId: string) {
      return failArtistRemoval
        ? Promise.reject(new Error("failed"))
        : Promise.resolve({
            artistId,
            isFavorite: false,
            favoritedAt: null,
          });
    },
  };
  const albums = new FavoriteAlbumStore(api as never);
  const artists = new FavoriteArtistStore(api as never);
  albums.ensure(["album-a", "album-b", "album-a"]);
  artists.ensure(["artist-a", "artist-b", "artist-a"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(albumBatches, [["album-a", "album-b"]]);
  assert.deepEqual(artistBatches, [["artist-a", "artist-b"]]);
  assert.equal(albums.get("album-a"), true);
  assert.equal(albums.get("album-b"), false);
  assert.equal(artists.get("artist-a"), true);
  failArtistRemoval = true;
  await assert.rejects(artists.set("artist-a", false), /failed/);
  assert.equal(artists.get("artist-a"), true);
});

void test("Favorites exposes persistent Tracks Albums Artists without Search", async () => {
  const [screen, storage, types, css, copy] = await Promise.all([
    read("screens/favorites.ts"),
    read("utils/storage.ts"),
    read("state/types.ts"),
    read("styles/screens.css"),
    read("i18n/en.ts"),
  ]);
  assert.match(types, /FavoriteSegment = "tracks" \| "albums" \| "artists"/);
  assert.match(screen, /createSegmentedControl<FavoriteSegment>/);
  assert.match(screen, /value: segment/);
  assert.match(storage, /favoriteSegment/);
  assert.match(storage, /favoriteAlbumView/);
  assert.match(
    storage,
    /return value === "albums" \|\| value === "artists" \? value : "tracks"/,
  );
  assert.doesNotMatch(screen, /type="search"|sorting|sortMode/i);
  assert.match(screen, /library-album-collection/);
  assert.match(screen, /library-artist-row__main/);
  assert.match(css, /favorites-category-toolbar/);
  assert.match(copy, /"favorites\.emptyAlbums": "No favorite albums yet"/);
  assert.match(copy, /"favorites\.emptyArtists": "No favorite artists yet"/);
});

void test("approved Album and Artist surfaces share hearts and contextual actions", async () => {
  const [library, favorites, button] = await Promise.all([
    read("screens/library.ts"),
    read("screens/favorites.ts"),
    read("components/favorite-track-button.ts"),
  ]);
  assert.match(library, /entityHeart\(options\.favoriteAlbums, album\.id\)/);
  assert.match(library, /entityHeart\(options\.favoriteArtists, artist\.id\)/);
  assert.match(library, /favoriteEntityMenuAction/);
  assert.match(favorites, /createFavoriteEntityButton/);
  assert.match(favorites, /openLibraryEntity\("album", album\.id\)/);
  assert.match(favorites, /openLibraryEntity\("artist", artist\.id\)/);
  assert.match(button, /aria-pressed/);
  assert.match(button, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(button, /showToast|favorites\.added|favorites\.removed/);
});

void test("Favorite category playback uses dedicated atomic endpoints and single-entity contexts", async () => {
  const [client, screen, backend, repository] = await Promise.all([
    read("api/library-api-client.ts"),
    read("screens/favorites.ts"),
    readFile(new URL("../../backend/src/index.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../backend/src/library/library-repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(client, /\/api\/library\/favorites\/albums\/play/);
  assert.match(client, /\/api\/library\/favorites\/artists\/play/);
  assert.match(backend, /resolveFavoriteAlbums/);
  assert.match(backend, /resolveFavoriteArtists/);
  assert.match(screen, /playFavoriteAlbums\(\)/);
  assert.match(screen, /playFavoriteArtists\(\)/);
  assert.match(screen, /playContext\(\{ context: "album", id: album\.id \}\)/);
  assert.match(
    screen,
    /playContext\(\{ context: "artist", id: artist\.id \}\)/,
  );
  assert.match(repository, /favoriteAlbumContextTracks\(\)/);
  assert.match(repository, /favoriteArtistContextTracks\(\)/);
  assert.match(repository, /const seen = new Set<string>\(\)/);
});
