import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { librarySession } from "../src/state/library-session.js";

const librarySource = await readFile(
  new URL("../src/screens/library.ts", import.meta.url),
  "utf8",
);
const sourcesSource = await readFile(
  new URL("../src/screens/sources.ts", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/styles/screens.css", import.meta.url),
  "utf8",
);
const responsive = await readFile(
  new URL("../src/styles/responsive.css", import.meta.url),
  "utf8",
);
const contracts = await readFile(
  new URL("../../../packages/shared/src/library.ts", import.meta.url),
  "utf8",
);

void test("Library keeps logical location and per-directory scroll in session", () => {
  librarySession.showSources();
  librarySession.openSource("source-a");
  librarySession.setLocation("source-a", "Artist/Album");
  librarySession.setSelected("entry-123");
  librarySession.saveScroll("source-a", "Artist/Album", 432);
  librarySession.saveScroll("source-a", "Artist", 121);
  assert.deepEqual(librarySession.getLocation(), {
    sourceId: "source-a",
    relativePath: "Artist/Album",
    selectedEntryId: "entry-123",
  });
  assert.equal(librarySession.scrollFor("source-a", "Artist/Album"), 432);
  assert.equal(librarySession.scrollFor("source-a", "Artist"), 121);
  librarySession.removeSource("source-a");
  assert.equal(librarySession.getLocation().sourceId, null);
  assert.equal(librarySession.scrollFor("source-a", "Artist/Album"), 0);
});

void test("current-track updates do not structurally rebuild Library", () => {
  const update = librarySource.slice(
    librarySource.indexOf("const updateCurrentRows"),
    librarySource.indexOf("const restoreScroll"),
  );
  assert.match(update, /classList\.toggle\("library-audio--current"/);
  assert.match(update, /setAttribute\("aria-current", "true"\)/);
  assert.doesNotMatch(update, /replaceChildren|innerHTML|append\(/);
});

void test("directory navigation retains old content until a single commit", () => {
  const load = librarySource.slice(
    librarySource.indexOf("const loadDirectory"),
    librarySource.indexOf("const showSourceChooser"),
  );
  assert.match(load, /content\.setAttribute\("aria-busy", "true"\)/);
  assert.match(librarySource, /content\.replaceChildren\(fragment\)/);
  assert.doesNotMatch(load, /content\.replaceChildren\(\)/);
});

void test("lazy metadata uses exactly two UI workers and in-place rows", () => {
  assert.match(librarySource, /Promise\.all\(\[worker\(\), worker\(\)\]\)/);
  assert.match(librarySource, /row\.title\.textContent = metadata\.title/);
  assert.match(librarySource, /row\.artwork\.update\(/);
});

void test("Library separates folder grid and audio list with stable geometry", () => {
  assert.match(librarySource, /className = "library-folder-grid"/);
  assert.match(librarySource, /className = "library-audio-list"/);
  assert.match(styles, /\.library-audio \{[\s\S]*min-height: 5\.5rem/);
  assert.match(styles, /\.library-audio__artwork \{[\s\S]*width: 4rem/);
});

void test("responsive layout reduces folder columns without shrinking targets", () => {
  assert.match(
    responsive,
    /@media \(max-width: 50rem\)[\s\S]*\.library-folder-grid \{[\s\S]*repeat\(2/,
  );
  assert.match(
    responsive,
    /@media \(max-width: 36rem\)[\s\S]*\.library-folder-grid \{[\s\S]*grid-template-columns: 1fr/,
  );
});

void test("source actions use an accessible non-destructive modal", () => {
  assert.match(sourcesSource, /role="dialog" aria-modal="true"/);
  assert.match(sourcesSource, /event\.key === "Escape"/);
  assert.match(sourcesSource, /returnFocus\?\.focus\(\)/);
  assert.match(sourcesSource, /sources\.filesNotDeleted/);
  assert.doesNotMatch(sourcesSource, /confirm\(|alert\(/);
});

void test("public Library contracts contain no native root or absolute path field", () => {
  assert.doesNotMatch(contracts, /nativeRoot|canonicalRoot|absolutePath/);
  assert.match(contracts, /readonly relativePath: string/);
  assert.match(contracts, /readonly id: string/);
});
