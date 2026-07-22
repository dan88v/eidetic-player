import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nextVisualizerMode } from "../src/visualizer/visualizer-mode.js";

const read = (path: string): Promise<string> =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

void test("Library keeps the indexed summary and scan controls in Manage Library", async () => {
  const [screens, library, styles, responsive, i18n] = await Promise.all([
    read("screens/index.ts"),
    read("screens/library.ts"),
    read("styles/screens.css"),
    read("styles/responsive.css"),
    read("i18n/en.ts"),
  ]);
  assert.match(screens, /case "library":[\s\S]*?createLibraryScreen/);
  assert.doesNotMatch(
    screens,
    /case "library":[\s\S]*?createPlaceholderScreen/,
  );
  for (const counter of ["tracks", "albums", "artists", "unavailable"])
    assert.match(library, new RegExp(`data-library-count="${counter}"`));
  const rootMarkup = library.slice(
    library.indexOf('<div class="library-root">'),
    library.indexOf('<div class="library-manage"'),
  );
  assert.doesNotMatch(rootMarkup, /library-summary|library-scan-panel/);
  assert.match(library, /class="library-manage"/);
  assert.match(library, /library-search-action/);
  assert.match(library, /library\.rescan/);
  assert.match(library, /library\.cancel/);
  assert.match(library, /<progress class="library-progress"/);
  assert.match(library, /removeAttribute\("value"\)/);
  assert.match(library, /progress\.value/);
  assert.match(library, /library\.noSources/);
  assert.match(library, /library\.noAudio/);
  assert.match(library, /options\.showToast/);
  assert.doesNotMatch(library, /showToast\([^)]*(completed|success)/i);
  assert.match(styles, /\.library-summary[\s\S]*?repeat\(4/);
  assert.match(styles, /\.library-scan-panel[\s\S]*?min-height:/);
  assert.match(responsive, /\.library-summary,[\s\S]*?repeat\(2/);
  assert.match(i18n, /"library\.status\.source-unavailable"/);
});

void test("Library uses one app-lifetime EventSource and central API client", async () => {
  const [client, library, sources, shell] = await Promise.all([
    read("api/library-api-client.ts"),
    read("screens/library.ts"),
    read("screens/sources.ts"),
    read("components/app-shell.ts"),
  ]);
  assert.equal((client.match(/new EventSource/g) ?? []).length, 1);
  assert.match(client, /\/api\/library\/events/);
  assert.doesNotMatch(library, /options\.api\.subscribe/);
  assert.doesNotMatch(sources, /options\.libraryApi\.subscribe/);
  assert.match(shell, /libraryApi\.subscribe\(receiveLibrarySnapshot/);
  assert.match(shell, /unsubscribeLibrary\(\)/);
  assert.doesNotMatch(library, /\bfetch\(/);
  assert.match(shell, /new LibraryApiClient\(\)/);
  assert.match(shell, /libraryApi,/);
});

void test("Sources reuses the existing popup menu for source rescans", async () => {
  const sources = await read("screens/sources.ts");
  assert.match(sources, /class="folders-action-menu" role="menu"/);
  assert.match(sources, /aria-haspopup="menu"/);
  assert.match(sources, /sources\.rescanLibrary/);
  assert.match(
    sources,
    /options\.libraryApi\.scan\(\{ sourceId: source\.id \}\)/,
  );
  assert.match(sources, /libraryScanBusy/);
  assert.match(sources, /queuedSourceIds\.length > 0/);
  assert.doesNotMatch(sources, /<select/);
});

void test("Library backend contracts are typed and do not expose catalog paths", async () => {
  const [contracts, backend, client] = await Promise.all([
    readFile(
      new URL("../../../packages/shared/src/library.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../backend/src/index.ts", import.meta.url), "utf8"),
    read("api/library-api-client.ts"),
  ]);
  for (const route of [
    "/api/library/snapshot",
    "/api/library/summary",
    "/api/library/sources",
    "/api/library/status",
    "/api/library/scan",
    "/api/library/scan/cancel",
  ]) {
    assert.ok(backend.includes(route), `missing backend route ${route}`);
  }
  assert.match(contracts, /interface IndexedLibrarySnapshot/);
  assert.match(contracts, /interface LibraryScanProgress/);
  assert.doesNotMatch(
    contracts.slice(contracts.indexOf("export type LibraryScanStatus")),
    /nativePath|canonicalRoot/,
  );
  assert.match(client, /ApiResponse<T>/);
});

void test("Music browsing visibility and canonical visualizer cycle remain unchanged", async () => {
  const [sideMenu, shell] = await Promise.all([
    read("components/side-menu.ts"),
    read("components/app-shell.ts"),
  ]);
  assert.match(sideMenu, /folders\.hidden = value === "library"/);
  assert.match(sideMenu, /library\.hidden = value === "folders"/);
  assert.match(
    shell,
    /state\.activeScreen === "folders"[\s\S]*?navigate\("library"\)/,
  );
  assert.match(
    shell,
    /state\.activeScreen === "library"[\s\S]*?navigate\("folders"\)/,
  );
  assert.deepEqual(
    [
      nextVisualizerMode("spectrumMono"),
      nextVisualizerMode("spectrumStereo"),
      nextVisualizerMode("meter"),
      nextVisualizerMode("technical"),
      nextVisualizerMode("none"),
    ],
    ["spectrumStereo", "meter", "technical", "none", "spectrumMono"],
  );
});
