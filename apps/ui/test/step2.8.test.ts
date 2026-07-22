import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FavoriteTrackStore } from "../src/state/favorite-track-store";

const read = (path: string): Promise<string> =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

void test("Favorite store batches visible IDs and rolls optimistic failures back", async () => {
  const statusCalls: string[][] = [];
  let failRemove = false;
  const api = {
    favoriteTrackStatus(trackIds: readonly string[]) {
      statusCalls.push([...trackIds]);
      return Promise.resolve({ favoriteTrackIds: [trackIds[0] ?? ""] });
    },
    addFavoriteTrack(trackId: string) {
      return Promise.resolve({ trackId, isFavorite: true, favoritedAt: 1 });
    },
    removeFavoriteTrack(trackId: string) {
      if (failRemove) return Promise.reject(new Error("failed"));
      return Promise.resolve({
        trackId,
        isFavorite: false,
        favoritedAt: null,
      });
    },
  };
  const store = new FavoriteTrackStore(api as never);
  store.ensure(["track-a", "track-b", "track-a"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(statusCalls.length, 1);
  assert.deepEqual(new Set(statusCalls[0]), new Set(["track-a", "track-b"]));
  assert.equal(store.get("track-a"), true);
  assert.equal(store.get("track-b"), false);
  failRemove = true;
  await assert.rejects(store.set("track-a", false), /failed/);
  assert.equal(store.get("track-a"), true);
});

void test("Favorites navigation and visibility follow Library", async () => {
  const [routes, menu, types] = await Promise.all([
    read("navigation/routes.ts"),
    read("components/side-menu.ts"),
    read("state/types.ts"),
  ]);
  assert.match(types, /"favorites"/);
  assert.ok(
    routes.indexOf('id: "library"') < routes.indexOf('id: "favorites"'),
  );
  assert.ok(
    routes.indexOf('id: "favorites"') < routes.indexOf('id: "folders"'),
  );
  assert.match(menu, /favorites\.hidden = value === "folders"/);
});

void test("approved Track surfaces share semantic heart and menu actions", async () => {
  const [library, favorites, queue, button, css] = await Promise.all([
    read("screens/library.ts"),
    read("screens/favorites.ts"),
    read("components/queue-drawer.ts"),
    read("components/favorite-track-button.ts"),
    read("styles/screens.css"),
  ]);
  assert.match(library, /createFavoriteTrackButton/);
  assert.match(library, /favorites\.added/);
  assert.match(favorites, /favorites\.emptyTitle/);
  assert.match(favorites, /createSegmentedControl/);
  assert.doesNotMatch(favorites, /type="search"/);
  assert.match(queue, /item\.libraryTrackId\s*\?/);
  assert.match(button, /element\.type = "button"/);
  assert.match(button, /aria-pressed/);
  assert.match(button, /event\.stopPropagation\(\)/);
  assert.match(css, /\.favorite-track-button[\s\S]*height: 2\.75rem/);
});

void test("Favorites rows keep Library grid geometry and players show passive status", async () => {
  const [favorites, miniPlayer, nowPlaying, indicator, screens] =
    await Promise.all([
      read("screens/favorites.ts"),
      read("components/mini-player.ts"),
      read("screens/now-playing.ts"),
      read("components/favorite-track-indicator.ts"),
      read("screens/index.ts"),
    ]);
  assert.match(favorites, /main\.append\(art, number, copy, duration\)/);
  assert.match(favorites, /library-track-row__number/);
  assert.match(miniPlayer, /createFavoriteTrackIndicator/);
  assert.match(nowPlaying, /createFavoriteTrackIndicator/);
  assert.match(indicator, /element\.hidden = isFavorite !== true/);
  assert.match(indicator, /setTrack\(trackId: string \| null\)/);
  assert.match(screens, /favorites: context\.favorites/);
});

void test("Favorites copy stays clean and Play all remains on one line", async () => {
  const [favorites, i18n, css] = await Promise.all([
    read("screens/favorites.ts"),
    read("i18n/en.ts"),
    read("styles/screens.css"),
  ]);
  assert.doesNotMatch(favorites, /Â|â€|�/u);
  assert.doesNotMatch(i18n, /favorites[^\n]*(?:Â|â€|�)/u);
  assert.match(favorites, /\.join\(" · "\)/u);
  assert.match(favorites, /return "—"/u);
  assert.match(i18n, /"favorites\.loading": "Loading Favorites…"/u);
  assert.match(css, /\.favorites-play-all \{[\s\S]*?white-space: nowrap/);
});

void test("every Library Back subpage uses the reusable sticky header", async () => {
  const [library, css] = await Promise.all([
    read("screens/library.ts"),
    read("styles/screens.css"),
  ]);
  assert.equal(
    [
      ...library.matchAll(
        /class(?:Name)?\s*=\s*["`]([^"`]*folders-back[^"`]*)/g,
      ),
    ].length,
    4,
  );
  assert.equal([...library.matchAll(/library-sticky-back-header/g)].length, 4);
  assert.match(
    css,
    /\.library-sticky-back-header \{[\s\S]*?position: sticky;[\s\S]*?top: 0;/,
  );
});

void test("Favorite playback uses the full backend context and direct index", async () => {
  const [repository, service, backend] = await Promise.all([
    readFile(
      new URL(
        "../../backend/src/library/library-repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../backend/src/library/library-service.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../backend/src/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(repository, /favoriteContextTracks\(\)/);
  assert.match(repository, /ORDER BY f\.created_at DESC, f\.track_id ASC/);
  assert.match(service, /resolved\.findIndex/);
  assert.match(backend, /openResolvedQueue\([\s\S]*context\.selectedIndex/);
});
