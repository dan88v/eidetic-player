import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  library,
  client,
  contracts,
  backend,
  repository,
  migrations,
  css,
  i18n,
  folders,
] = await Promise.all([
  readFile("apps/ui/src/screens/library.ts", "utf8"),
  readFile("apps/ui/src/api/library-api-client.ts", "utf8"),
  readFile("packages/shared/src/library.ts", "utf8"),
  readFile("apps/backend/src/index.ts", "utf8"),
  readFile("apps/backend/src/library/library-repository.ts", "utf8"),
  readFile("apps/backend/src/library/library-migrations.ts", "utf8"),
  readFile("apps/ui/src/styles/screens.css", "utf8"),
  readFile("apps/ui/src/i18n/en.ts", "utf8"),
  readFile("apps/ui/src/screens/folders.ts", "utf8"),
]);

void test("Library Search uses typed bounded endpoints and no catalog paths", () => {
  assert.match(backend, /url\.pathname === "\/api\/library\/search"/);
  assert.ok(
    backend.includes("^\\/api\\/library\\/search\\/(artists|albums|tracks)$"),
  );
  assert.match(contracts, /interface LibraryGroupedSearchResults/);
  assert.match(contracts, /type LibraryCategorySearchResults/);
  assert.doesNotMatch(
    contracts.slice(contracts.indexOf("export type LibrarySearchCategory")),
    /nativePath|relativePath|sourceId|codec|bitrate/,
  );
  assert.match(client, /searchCategory\(/);
  assert.doesNotMatch(client, /playSearch\(/);
});

void test("Search header is on demand, focused and keyboard accessible", () => {
  const rootMarkup = library.slice(
    library.indexOf('<div class="library-root">'),
    library.indexOf('<div class="library-manage"'),
  );
  assert.match(rootMarkup, /library-search-action/);
  assert.match(rootMarkup, /type="search"/);
  assert.match(
    rootMarkup,
    /placeholder="\$\{t\("library\.searchPlaceholder"\)\}"/,
  );
  assert.match(i18n, /Search albums, artists and tracks…/);
  assert.match(rootMarkup, /library-search-clear/);
  assert.match(
    library,
    /queueMicrotask\(\(\) => \{\s*searchInput\.focus\(\);\s*\}\)/,
  );
  assert.match(library, /event\.key === "Enter"/);
  assert.match(library, /event\.key === "Escape"/);
  assert.match(
    library,
    /searchInput\.addEventListener\("input", scheduleSearch\)/,
  );
  assert.match(i18n, /"library\.searchPlaceholder"/);
});

void test("minimum length, 250 ms debounce, immediate Enter and Clear are deterministic", () => {
  assert.match(library, /SEARCH_DEBOUNCE_MILLISECONDS = 250/);
  assert.match(library, /normalizedInputLength\(search\.query\) < 2/);
  assert.match(library, /setTimeout\([\s\S]*SEARCH_DEBOUNCE_MILLISECONDS/);
  assert.match(
    library,
    /event\.key === "Enter"[\s\S]*clearTimeout\(searchDebounce\)[\s\S]*executeGroupedSearch/,
  );
  assert.match(library, /const clearSearch = \(\): void =>/);
  assert.match(library, /searchInput\.value = ""/);
  assert.match(library, /groupedSearchController\?\.abort\(\)/);
});

void test("stale Search work is aborted, sequenced and destroyed safely", () => {
  assert.match(library, /new AbortController\(\)/);
  assert.match(library, /sequence !== search\.requestSequence/);
  assert.match(library, /search\.requestSequence \+= 1/);
  assert.match(library, /cancelSearchRequests\(\)/);
  assert.match(library, /clearTimeout\(searchDebounce\)/);
  assert.match(library, /error\.name === "AbortError"/);
  assert.match(client, /signal\?: AbortSignal/);
  assert.doesNotMatch(library, /setInterval|new EventSource/);
});

void test("grouped results stay ordered Artists, Albums, Tracks with View all", () => {
  const grouped = library.slice(
    library.indexOf('appendGroup(\n      "artists"'),
    library.indexOf("const executeGroupedSearch"),
  );
  assert.ok(grouped.indexOf('"artists"') < grouped.indexOf('"albums"'));
  assert.ok(grouped.indexOf('"albums"') < grouped.indexOf('"tracks"'));
  assert.match(library, /library\.searchViewAll/);
  assert.match(library, /activeCategoryView = category/);
  assert.match(
    library,
    /libraryHeader\.hidden\s*=\s*!search\.active \|\| search\.activeCategoryView !== null/,
  );
  assert.match(library, /loadSearchCategory\(category, false\)/);
  assert.match(library, /moreButton\(Boolean\(page\.cursor\)/);
  assert.equal(
    (library.match(/className = "library-page-sentinel"/g) ?? []).length,
    1,
  );
});

void test("Search preserves grouped, category and detail scroll for the app session only", () => {
  assert.match(library, /let librarySearchSession:/);
  assert.match(library, /previousLibraryState/);
  assert.match(library, /scrollPositions:/);
  assert.match(library, /persistSearchSession/);
  assert.match(library, /search\.scrollPositions\[category \?\? "grouped"\]/);
  assert.match(library, /librarySearchSession = null/);
  assert.doesNotMatch(library, /save.*Search|localStorage|sessionStorage/i);
});

void test("Search Track play delegates to current-catalog Track context", () => {
  assert.match(library, /api\.play\(\{ context: "track", id: trackId \}\)/);
  assert.doesNotMatch(backend, /\/api\/library\/search\/play/);
  assert.match(backend, /resolveContext\(body\.context, body\.id/);
  assert.match(backend, /context\.selectedIndex/);
  assert.match(repository, /playbackContextForTrack/);
  assert.match(repository, /s\.available = 1 AND s\.removed = 0/);
});

void test("unavailable Search rows remain visible and playback actions are disabled", () => {
  assert.match(library, /library-item--unavailable/);
  assert.match(library, /main\.disabled = unavailable/);
  assert.match(
    library,
    /label: t\("library\.playArtist"\),\s+disabled: unavailable/,
  );
  assert.match(
    library,
    /label: t\("library\.playAlbum"\),\s+disabled: unavailable/,
  );
  assert.match(library, /library-unavailable-label/);
  assert.match(repository, /COUNT\(\*\) OVER \(\) AS total_count/);
});

void test("Library toolbar is one compact row and scan actions remain in Manage", () => {
  const rootMarkup = library.slice(
    library.indexOf('<div class="library-root">'),
    library.indexOf('<div class="library-manage"'),
  );
  const manageMarkup = library.slice(
    library.indexOf('<div class="library-manage"'),
    library.indexOf('<div class="library-detail"'),
  );
  assert.doesNotMatch(
    rootMarkup,
    /library-scan-action|library-manage-scan-action/,
  );
  assert.match(rootMarkup, /library-toolbar-actions/);
  assert.match(
    rootMarkup,
    /library-search-action[\s\S]*library-manage-action[\s\S]*library-view-controls/,
  );
  assert.match(manageMarkup, /library-manage-scan-action/);
  assert.match(library, /browserToolbar\.hidden = search\.active/);
  assert.match(css, /\.library-browser-toolbar \{[\s\S]*display: flex/);
  assert.match(css, /\.library-toolbar-actions/);
});

void test("current schema retains v2 materialized keys, stable ranking and no FTS", () => {
  assert.match(migrations, /LIBRARY_SCHEMA_VERSION = 5/);
  assert.match(migrations, /const migrationV2/);
  for (const key of [
    "search_name",
    "search_title",
    "search_artist",
    "search_album",
    "search_album_artist",
  ])
    assert.match(migrations, new RegExp(key));
  assert.match(repository, /WHEN .* = \? THEN 0/);
  assert.match(repository, /GLOB \? \|\| '\*' THEN 1/);
  assert.match(repository, /instr\(' ' \|\| .*' ' \|\| \?\) > 0 THEN 2/);
  assert.match(repository, /instr\(.*, \?\) > 0 THEN 3/);
  assert.match(repository, /track_id\) > \(\?, \?, \?, \?, \?, \?\)/);
  assert.doesNotMatch(migrations, /FTS5|VIRTUAL TABLE|TRIGGER/i);
});

void test("Search remains Library-only and keeps the single Library SSE", () => {
  assert.doesNotMatch(folders, /library-search|searchPlaceholder|api\.search/);
  assert.equal((client.match(/new EventSource/g) ?? []).length, 1);
  assert.doesNotMatch(library, /\.subscribe\(/);
});
