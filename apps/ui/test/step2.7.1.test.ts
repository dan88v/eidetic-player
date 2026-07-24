import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  sources,
  library,
  client,
  queue,
  shell,
  shared,
  backend,
  service,
  css,
  components,
  i18n,
] = await Promise.all([
  readFile("apps/ui/src/screens/sources.ts", "utf8"),
  readFile("apps/ui/src/screens/library.ts", "utf8"),
  readFile("apps/ui/src/api/library-api-client.ts", "utf8"),
  readFile("apps/ui/src/components/queue-drawer.ts", "utf8"),
  readFile("apps/ui/src/components/app-shell.ts", "utf8"),
  readFile("packages/shared/src/library.ts", "utf8"),
  readFile("apps/backend/src/index.ts", "utf8"),
  readFile("apps/backend/src/library/library-service.ts", "utf8"),
  readFile("apps/ui/src/styles/screens.css", "utf8"),
  readFile("apps/ui/src/styles/components.css", "utf8"),
  readFile("apps/ui/src/i18n/en.ts", "utf8"),
]);

void test("Sources places scan with Library Sources and Add Folder with Local Storage", () => {
  const librarySection = sources.slice(
    sources.indexOf("sources-section--library"),
    sources.indexOf("sources-resources"),
  );
  const localSection = sources.slice(
    sources.indexOf('id="local-storage-heading"'),
    sources.indexOf('id="usb-storage-heading"'),
  );
  assert.ok(
    librarySection.includes("sources-header__scan") &&
      !librarySection.includes("sources-local-add"),
  );
  assert.match(localSection, /sources-local-add/);
  assert.match(
    sources,
    /libraryScanBusy[\s\S]*activeScan[\s\S]*queuedSourceIds/,
  );
  assert.match(
    sources,
    /libraryScanBusy \? "library\.cancel" : "sources\.rescanLibrary"/,
  );
  assert.match(sources, /libraryApi\.scan\(\)/);
  assert.match(
    sources,
    /libraryApi\.cancel\([\s\S]*activeScanId \? \{ scanId: activeScanId \} : \{\}/,
  );
  assert.doesNotMatch(sources, /addButton\.disabled\s*=\s*libraryScanBusy/);
  assert.match(css, /\.sources-section__intro[\s\S]*display: flex/);
});

void test("new Sources use the one automatic scheduler and removable deduplicated pending", () => {
  assert.match(backend, /sourceAdded\(result\.source\.id\)/);
  assert.match(
    service,
    /sourceNeedsFirstScan\(sourceId\)[\s\S]*enqueueAutomatic\(\[sourceId\]\)/,
  );
  assert.match(service, /sourceRemoved[\s\S]*removeQueuedSource\(sourceId\)/);
  assert.equal((service.match(/new LibraryScheduler/g) ?? []).length, 1);
});

void test("Library root toolbar order and Search height match the compact controls", () => {
  const root = library.slice(
    library.indexOf('<div class="library-root">'),
    library.indexOf('<div class="library-manage"'),
  );
  assert.match(
    root,
    /library-segments[\s\S]*library-search-action[\s\S]*library-manage-action[\s\S]*library-view-controls/,
  );
  assert.match(library, /viewControls\.replaceChildren\(\)/);
  assert.match(library, /if \(segment === "albums"\)/);
  assert.match(library, /browserToolbar\.hidden = search\.active/);
  assert.match(
    css,
    /\.library-search-field input \{[\s\S]*min-height: var\(--touch-min\)/,
  );
  assert.match(
    css,
    /input::-webkit-search-cancel-button[\s\S]*appearance: none/,
  );
});

void test("Search row and menu share Album-or-single Track playback", () => {
  assert.match(shared, /"album" \| "artist" \| "track" \| "tracks"/);
  assert.match(
    library,
    /const playSearchTrack = async[\s\S]*api\.play\(\{ context: "track", id: trackId \}\)/,
  );
  assert.match(
    library,
    /trackRow\(track, \(\) => void playSearchTrack\(track\.id\), true\)/,
  );
  assert.match(library, /label: t\("library\.play"\)[\s\S]*run: playTrack/);
  assert.match(service, /playbackContextForTrack\(trackId\)/);
  assert.match(
    service,
    /target\.albumId[\s\S]*resolveContext\("album", target\.albumId, trackId\)[\s\S]*resolveTrack\(trackId\)/,
  );
  assert.doesNotMatch(client, /playSearch|search\/play/);
  assert.doesNotMatch(backend, /search\/play|resolveSearchContext/);
  assert.match(
    backend,
    /body\.context === "track"[\s\S]*Add a single Track through the Track Queue action/,
  );
});

void test("Search Album and Artist menus keep open-row semantics and add Play actions", () => {
  assert.match(
    library,
    /label: t\("library\.playAlbum"\)[\s\S]*context: "album"/,
  );
  assert.match(
    library,
    /label: t\("library\.playArtist"\)[\s\S]*context: "artist"/,
  );
  assert.match(library, /library\.addAlbum/);
  assert.match(library, /library\.addArtist/);
  assert.match(i18n, /"library\.playAlbum": "Play album"/);
  assert.match(i18n, /"library\.playArtist": "Play all"/);
});

void test("Queue drawer removes only Add Files and preserves other file entry paths", () => {
  assert.doesNotMatch(
    queue,
    /queue-actions__add|queueDrawer\.addFiles|onAddFiles/,
  );
  assert.doesNotMatch(shell, /onAddFiles:/);
  assert.match(queue, /queue-list__clear-button/);
  assert.match(queue, /onPlay|onClear|onRemove/);
  assert.match(shell, /const openFiles = \(\): void =>/);
  assert.match(shell, /runSingleAudioFileSelection/);
  assert.match(shell, /handlePaths/);
  assert.match(components, /\.queue-list__clear[\s\S]*justify-content: center/);
});
