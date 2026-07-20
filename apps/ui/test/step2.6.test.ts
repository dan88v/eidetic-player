import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const library = await readFile("apps/ui/src/screens/library.ts", "utf8");
const client = await readFile("apps/ui/src/api/library-api-client.ts", "utf8");
const contracts = await readFile("packages/shared/src/library.ts", "utf8");
const backend = await readFile("apps/backend/src/index.ts", "utf8");
const repository = await readFile(
  "apps/backend/src/library/library-repository.ts",
  "utf8",
);
const storage = await readFile("apps/ui/src/utils/storage.ts", "utf8");
const css = await readFile("apps/ui/src/styles/screens.css", "utf8");
const visualizer = await readFile(
  "apps/ui/src/visualizer/visualizer-mode.ts",
  "utf8",
);

void test("Library exposes typed bounded Albums, Artists and Tracks APIs", () => {
  for (const path of [
    "/api/library/albums",
    "/api/library/artists",
    "/api/library/tracks",
    "/api/library/play",
    "/api/library/queue",
    "/api/library/tracks/queue",
  ])
    assert.match(backend, new RegExp(path.replaceAll("/", "\\/")));
  assert.match(contracts, /interface LibraryAlbumDetail/);
  assert.match(contracts, /interface LibraryArtistDetail/);
  assert.match(contracts, /interface LibraryPage<T>/);
  assert.match(repository, /LIMIT \?/);
  assert.match(repository, /encodeCursor/);
  assert.match(repository, /ORDER BY title_key, artist_key, album_key/);
  const browsingContracts = contracts.slice(
    contracts.indexOf("export type LibraryEntityAvailability"),
  );
  assert.doesNotMatch(browsingContracts, /nativeRoot|canonicalRoot|nativePath/);
});

void test("Library root uses one segmented control and independent persistent Album view", () => {
  assert.match(library, /createSegmentedControl<LibrarySegment>/);
  assert.match(library, /value: "albums"/);
  assert.match(library, /value: "artists"/);
  assert.match(library, /value: "tracks"/);
  assert.match(storage, /librarySegment/);
  assert.match(storage, /libraryAlbumView/);
  assert.match(library, /loadLibraryAlbumViewMode/);
  assert.match(library, /section\.dataset\.albumView = albumView/);
  assert.match(css, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 50rem\)/);
  assert.match(css, /@media \(max-width: 36rem\)/);
});

void test("Album and Artist details use contextual direct-index playback", () => {
  assert.match(library, /context: "album", id: album\.id/);
  assert.match(library, /context: "artist", id: artist\.id/);
  assert.match(library, /selectedTrackId: track\.id/);
  assert.match(backend, /player\.reserveOpenRequest\(\)/);
  assert.match(
    backend,
    /openResolvedQueue\([\s\S]*context\.selectedIndex[\s\S]*context\.origins/,
  );
  assert.match(repository, /SELECT DISTINCT t\.track_id/);
  assert.match(repository, /t\.album_id IS NULL/);
});

void test("Add to Queue remains a secondary sibling menu action", () => {
  assert.match(library, /className = "library-item-more"/);
  assert.match(library, /setAttribute\("aria-haspopup", "menu"\)/);
  assert.match(library, /folders\.addToQueue/);
  assert.match(library, /library\.addAlbum/);
  assert.match(library, /library\.addArtist/);
  assert.doesNotMatch(
    library,
    /className = "primary-action"[\s\S]{0,80}Add to Queue/,
  );
  assert.match(backend, /player\.append\(context\.paths, context\.origins\)/);
});

void test("Track lists are touch-semantic, unavailable-aware and DOM-bounded", () => {
  assert.match(library, /MAX_RENDERED_ITEMS = 192/);
  assert.match(library, /className = "library-page-sentinel"/);
  assert.equal(
    (library.match(/className = "library-page-sentinel"/g) ?? []).length,
    1,
  );
  assert.match(library, /main\.disabled = unavailable/);
  assert.match(library, /library-unavailable-label/);
  assert.match(css, /\.library-track-row \{[\s\S]*min-height: 5\.5rem/);
  assert.match(css, /\.library-item-more \{[\s\S]*var\(--touch-min\)/);
  assert.doesNotMatch(library, /<button[^>]*>[\s\S]*<button/);
  assert.match(library, /decode\(\)/);
});

void test("scan refresh reuses one Library SSE and canonical visualizer order is untouched", () => {
  assert.equal((client.match(/new EventSource/g) ?? []).length, 1);
  assert.match(library, /completedGeneration/);
  assert.match(library, /pages\.albums = emptyPage/);
  assert.match(
    visualizer,
    /mode === "spectrumMono"[\s\S]*"spectrumStereo"[\s\S]*mode === "spectrumStereo"[\s\S]*"meter"[\s\S]*mode === "meter"[\s\S]*"technical"[\s\S]*mode === "technical"[\s\S]*"none"[\s\S]*"spectrumMono"/,
  );
});

void test("detail routing starts at the top and restores the originating list scroll", () => {
  assert.match(library, /let rootScrollTop = 0/);
  assert.match(library, /let artistScrollTop = 0/);
  assert.match(
    library,
    /detailRegion\.hidden = false;[\s\S]*section\.parentElement\.scrollTop = 0/,
  );
  assert.match(
    library,
    /section\.parentElement\.scrollTop = fromArtist[\s\S]*artistScrollTop[\s\S]*rootScrollTop/,
  );
});
