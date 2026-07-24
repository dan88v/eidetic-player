import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  playlistAutoScrollStep,
  playlistDropIndex,
  shouldStartPlaylistDrag,
} from "../src/screens/playlists";
import {
  queueAutoScrollStep,
  queueDropIndex,
  shouldStartQueueDrag,
} from "../src/utils/queue-reorder";

const read = (path: string): string => readFileSync(path, "utf8");

void test("navigation places Folders after Library and Playlists after Favorites", () => {
  const routes = read("apps/ui/src/navigation/routes.ts");
  assert.match(
    routes,
    /id: "library"[\s\S]*id: "folders"[\s\S]*id: "favorites"[\s\S]*id: "playlists"[\s\S]*id: "recentlyPlayed"/,
  );
  const menu = read("apps/ui/src/components/side-menu.ts");
  assert.match(
    menu,
    /if \(playlists\) playlists\.hidden = value === "folders"/,
  );
});

void test("Playlist list and detail labels keep the corrected geometry", () => {
  const screen = read("apps/ui/src/screens/playlists.ts");
  const styles = read("apps/ui/src/styles/screens.css");
  assert.match(screen, /<span>New Playlist<\/span>/);
  assert.match(
    screen,
    /options\.setTitle\(`Playlists \/ \$\{playlist\.name\}`\)/,
  );
  assert.match(screen, /Add Playlist to Queue/);
  assert.match(screen, /playlist-detail-toolbar__queue/);
  assert.match(screen, /result\.appendedCount/);
  assert.match(screen, /added to Queue\./);
  assert.match(screen, /"success"/);
  assert.match(screen, /playlist-detail-toolbar__summary/);
  assert.match(screen, /playlist-detail-toolbar__actions/);
  assert.match(screen, /playlist-track__art/);
  assert.match(screen, /playlist-track__copy/);
  assert.match(screen, /playlist-track__artist/);
  assert.match(screen, /playlist-track__album/);
  assert.match(screen, /No playlists yet/);
  assert.match(screen, /This playlist is empty/);
  assert.match(
    styles,
    /\.playlists-header > \.primary-action\s*\{[^}]*display: inline-flex;[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/,
  );
  assert.match(
    styles,
    /\.playlist-detail-toolbar__actions > button\s*\{[^}]*white-space: nowrap;/,
  );
  assert.match(
    styles,
    /\.playlists-list,[\s\S]*\.playlist-tracks\s*\{[^}]*gap: 0;[^}]*border-block: 1px solid var\(--color-border\);/,
  );
  assert.match(
    styles,
    /\.playlist-row,[\s\S]*\.playlist-track\s*\{[^}]*border: 0;[^}]*border-bottom: 1px solid var\(--color-border\);[^}]*border-radius: 0;[^}]*background: transparent;/,
  );
  assert.match(styles, /\.playlist-row\s*\{[^}]*min-height: 5\.5rem;/);
  assert.match(
    styles,
    /\.playlists-screen\s*\{[^}]*max-width: 76rem;[^}]*margin-inline: auto;/,
  );
  assert.match(
    styles,
    /\.playlists-header\s*\{[^}]*max-width: none;[^}]*margin-bottom: var\(--space-4\);/,
  );
  assert.match(
    styles,
    /\.playlist-detail-toolbar__queue\s*\{[^}]*background: var\(--color-surface-raised\);/,
  );
  assert.match(
    styles,
    /\.playlist-track > \.favorite-track-button\s*\{[^}]*height: var\(--touch-min\);[^}]*align-self: center;/,
  );
  assert.match(
    styles,
    /\.source-dialog__field input:focus-visible\s*\{[^}]*border-color: var\(--color-accent\);[^}]*outline: 2px solid var\(--color-accent\);/,
  );
});

void test("Add to Playlist has one canonical i18n label", () => {
  const paths = [
    "apps/ui/src/screens/library.ts",
    "apps/ui/src/screens/favorites.ts",
    "apps/ui/src/screens/recently-played.ts",
    "apps/ui/src/screens/playlists.ts",
    "apps/ui/src/components/queue-drawer.ts",
    "apps/ui/src/components/playlist-picker.ts",
  ];
  const content = paths.map(read).join("\n");
  assert.doesNotMatch(content, /Add to playlist/);
  assert.match(
    read("apps/ui/src/i18n/en.ts"),
    /"common\.addToPlaylist": "Add to Playlist"/,
  );
  for (const path of paths)
    assert.match(read(path), /t\("common\.addToPlaylist"\)/);
});

void test("Queue footer adds the whole indexed Queue to a playlist and retains clear", () => {
  const drawer = read("apps/ui/src/components/queue-drawer.ts");
  assert.match(drawer, /queue-list__playlist-button/);
  assert.match(drawer, /t\("common\.addToPlaylist"\)/);
  assert.match(drawer, /queue-list__clear-button/);
  assert.match(drawer, /\.flatMap\(\(item\) =>/);
  assert.match(drawer, /onReorder/);
  assert.match(drawer, /setPointerCapture/);
  const player = read("apps/backend/src/player/player-service.ts");
  assert.match(player, /fromIndex < toIndex \? toIndex \+ 1 : toIndex/);
  assert.match(player, /queueRevision: this\.state\.queueRevision \+ 1/);
});

void test("Step 2.10 follow-up headers and Album grid keep compact geometry", () => {
  const favorites = read("apps/ui/src/screens/favorites.ts");
  const history = read("apps/ui/src/screens/recently-played.ts");
  const styles = read("apps/ui/src/styles/screens.css");
  assert.match(
    favorites,
    /favorites-header__actions[\s\S]*favorites-segments[\s\S]*favorites-play-all/,
  );
  assert.match(
    history,
    /recently-played-header[\s\S]*screen-header__description[\s\S]*recently-played-segments/,
  );
  assert.match(
    styles,
    /\.recently-played-header\s*\{[^}]*justify-content: space-between;/,
  );
  assert.match(
    styles,
    /\.library-screen:not\(\[data-album-view="list"\]\)[\s\S]*\.library-album-card[\s\S]*> \.favorite-track-button\s*\{[^}]*display: none;/,
  );
  assert.match(
    styles,
    /:is\(\.library-screen, \.favorites-screen\):not\(\[data-album-view="list"\]\)[\s\S]*\.library-album-art\s*\{[^}]*width: calc\(100% - var\(--space-3\) - var\(--space-3\)\);[^}]*margin: var\(--space-3\) var\(--space-3\) 0;[^}]*aspect-ratio: 1 \/ 1;/,
  );
  assert.match(styles, /\.library-album-card__open\s*\{[^}]*padding: 0;/);
  assert.match(
    styles,
    /span:last-child[\s\S]*> small:last-child\s*\{[^}]*padding-right: calc\(var\(--touch-min\) \+ var\(--space-2\)\);/,
  );
});

void test("playlist picker shows three rows and uses the shared create dialog", () => {
  const picker = read("apps/ui/src/components/playlist-picker.ts");
  const styles = read("apps/ui/src/styles/components.css");
  assert.match(picker, /duplicateTrackIds/);
  assert.match(picker, /Add anyway/);
  assert.match(picker, /right\.updatedAt - left\.updatedAt/);
  assert.match(picker, /left\.id\.localeCompare\(right\.id\)/);
  assert.match(picker, /Create New Playlist/);
  assert.match(picker, /createPlaylistNameDialog/);
  assert.doesNotMatch(picker, /playlist-picker__name/);
  assert.match(
    styles,
    /\.playlist-picker__body\s*\{[^}]*max-height: 190px;[^}]*overflow-y: auto;/,
  );
  assert.match(picker, /<footer>[\s\S]*data-action="create"/);
});

void test("Create and Rename Playlist share the approved source dialog primitive", () => {
  const screen = read("apps/ui/src/screens/playlists.ts");
  const dialog = read("apps/ui/src/components/playlist-name-dialog.ts");
  assert.match(screen, /createPlaylistNameDialog/);
  assert.match(screen, /Rename Playlist/);
  assert.match(screen, /Create New Playlist/);
  assert.match(dialog, /source-dialog-backdrop/);
  assert.match(dialog, /source-dialog playlist-name-dialog/);
  assert.match(dialog, /source-dialog__field/);
  assert.match(dialog, /source-dialog__actions/);
  assert.match(dialog, /data-onscreen-keyboard="text"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
});

void test("Playlist drag uses threshold, midpoint placement, real scroll container, and one drop persistence", () => {
  const screen = read("apps/ui/src/screens/playlists.ts");
  assert.match(screen, /playlist-track__handle[\s\S]*pointerdown/);
  assert.match(screen, /setPointerCapture/);
  assert.match(screen, /playlist-track--placeholder/);
  assert.match(screen, /closest<HTMLElement>\("\.screen-region"\)/);
  assert.match(screen, /requestAnimationFrame\(autoScroll\)/);
  assert.match(screen, /reorderPlaylist\(playlist\.id, ids\)/);
  const moveHandler = screen.slice(
    screen.indexOf("const move ="),
    screen.indexOf("const cleanup ="),
  );
  assert.doesNotMatch(moveHandler, /reorderPlaylist/);
  assert.match(screen, /restoreInitialOrder\(\)/);
  assert.match(screen, /detail = updated/);
  assert.doesNotMatch(screen, /\.then\(renderDetail\)/);
  assert.doesNotMatch(screen, /draggable|dragstart/);

  assert.equal(shouldStartPlaylistDrag(2, 3), false);
  assert.equal(shouldStartPlaylistDrag(8, 0), true);
  assert.equal(playlistDropIndex([120, 180, 240], 179), 1);
  assert.equal(playlistDropIndex([120, 180, 240], 300), 3);
  assert.ok(playlistAutoScrollStep(105, 100, 500) < 0);
  assert.equal(playlistAutoScrollStep(300, 100, 500), 0);
  assert.ok(playlistAutoScrollStep(495, 100, 500) > 0);
});

void test("Queue drag matches the robust Playlist pointer method", () => {
  const drawer = read("apps/ui/src/components/queue-drawer.ts");
  const styles = read("apps/ui/src/styles/components.css");
  assert.match(drawer, /queue-item__handle[\s\S]*pointerdown/);
  assert.match(drawer, /setPointerCapture/);
  assert.match(drawer, /queue-item--placeholder/);
  assert.match(drawer, /requestAnimationFrame\(autoScroll\)/);
  assert.match(drawer, /onReorder\(item\.id, toIndex\)/);
  assert.match(drawer, /queue-list--persisting/);
  assert.match(drawer, /restoreInitialOrder\(\)/);
  assert.match(drawer, /cancelActiveReorder\?\.\(\)/);
  assert.doesNotMatch(drawer, /elementFromPoint/);
  assert.match(
    styles,
    /\.queue-item__button\s*\{[^}]*grid-template-columns: 1\.5rem var\(--touch-small\) minmax\(0, 1fr\);/,
  );
  assert.match(
    styles,
    /\.queue-item__copy strong\s*\{[^}]*font-size: 0\.875rem;/,
  );
  assert.equal(shouldStartQueueDrag(2, 3), false);
  assert.equal(shouldStartQueueDrag(8, 0), true);
  assert.equal(queueDropIndex([120, 180, 240], 179), 1);
  assert.equal(queueDropIndex([120, 180, 240], 300), 3);
  assert.ok(queueAutoScrollStep(105, 100, 500) < 0);
  assert.equal(queueAutoScrollStep(300, 100, 500), 0);
  assert.ok(queueAutoScrollStep(495, 100, 500) > 0);
});
