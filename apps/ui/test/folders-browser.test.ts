import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { foldersSession } from "../src/state/folders-session.js";
import { formatAudioQuality } from "../src/utils/audio-quality.js";
import type { LibraryMetadataSummary } from "../../../packages/shared/src/library.js";

const foldersSource = await readFile(
  new URL("../src/screens/folders.ts", import.meta.url),
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
const storage = await readFile(
  new URL("../src/utils/storage.ts", import.meta.url),
  "utf8",
);

void test("Folders keeps logical location and per-directory scroll in session", () => {
  foldersSession.showSources();
  foldersSession.openSource("source-a");
  foldersSession.setLocation("source-a", "Artist/Album");
  foldersSession.setSelected("entry-123");
  foldersSession.saveScroll("source-a", "Artist/Album", 432);
  foldersSession.saveScroll("source-a", "Artist", 121);
  assert.deepEqual(foldersSession.getLocation(), {
    sourceId: "source-a",
    relativePath: "Artist/Album",
    selectedEntryId: "entry-123",
  });
  assert.equal(foldersSession.scrollFor("source-a", "Artist/Album"), 432);
  assert.equal(foldersSession.scrollFor("source-a", "Artist"), 121);
  foldersSession.removeSource("source-a");
  assert.equal(foldersSession.getLocation().sourceId, null);
  assert.equal(foldersSession.scrollFor("source-a", "Artist/Album"), 0);
});

void test("current-track updates do not structurally rebuild Folders", () => {
  const update = foldersSource.slice(
    foldersSource.indexOf("const updateCurrentRows"),
    foldersSource.indexOf("const restoreScroll"),
  );
  assert.match(update, /classList\.toggle\("folders-audio--current"/);
  assert.match(update, /setAttribute\("aria-current", "true"\)/);
  assert.doesNotMatch(update, /row\.entry\.current/);
  assert.doesNotMatch(update, /replaceChildren|innerHTML|append\(/);
});

void test("directory navigation retains old content until a single commit", () => {
  const load = foldersSource.slice(
    foldersSource.indexOf("async function loadDirectory"),
    foldersSource.indexOf("const showSourceChooser"),
  );
  assert.match(load, /stableContent\.setAttribute\("aria-busy", "true"\)/);
  assert.match(foldersSource, /content\.replaceChildren\(fragment\)/);
  assert.doesNotMatch(load, /content\.replaceChildren\(\)/);
});

void test("lazy metadata uses exactly two UI workers and in-place rows", () => {
  assert.match(foldersSource, /Promise\.all\(\[worker\(\), worker\(\)\]\)/);
  assert.match(foldersSource, /row\.title\.textContent = metadata\.title/);
  assert.match(foldersSource, /row\.artwork\.update\(/);
});

void test("audio quality prefers bitrate for MP3 and depth/rate for FLAC", () => {
  const base: LibraryMetadataSummary = {
    title: "Track",
    artist: null,
    durationSeconds: null,
    format: null,
    codec: null,
    container: null,
    bitrate: null,
    sampleRate: null,
    bitDepth: null,
    lossless: null,
    isVariableBitrate: null,
    artwork: null,
  };
  assert.equal(
    formatAudioQuality(
      {
        ...base,
        container: "MPEG",
        codec: "MP3",
        bitrate: 320_000,
        sampleRate: 44_100,
        lossless: false,
      },
      "mp3",
    ),
    "MPEG · 320 kbps",
  );
  assert.equal(
    formatAudioQuality(
      {
        ...base,
        container: "FLAC",
        bitDepth: 24,
        sampleRate: 96_000,
        lossless: true,
      },
      "flac",
    ),
    "FLAC · 24-bit · 96 kHz",
  );
  assert.equal(formatAudioQuality(base, "wav"), "WAV");
});

void test("Folders separates adaptive folder collection and audio list", () => {
  assert.match(foldersSource, /className = "folders-folder-collection"/);
  assert.match(foldersSource, /className = "folders-audio-list"/);
  assert.match(styles, /\.folders-audio__main \{[\s\S]*min-height: 5\.5rem/);
  assert.match(styles, /\.folders-audio__artwork \{[\s\S]*width: 4rem/);
});

void test("responsive layout reduces folder columns without shrinking targets", () => {
  assert.match(
    responsive,
    /@media \(max-width: 50rem\)[\s\S]*\.folders-folder-collection \{[\s\S]*repeat\(2/,
  );
  assert.match(
    responsive,
    /@media \(max-width: 36rem\)[\s\S]*\.folders-folder-collection \{[\s\S]*grid-template-columns: 1fr/,
  );
});

void test("List/Grid is persistent and changes only presentation state", () => {
  assert.match(storage, /eidetic-player\.interface\.folder-view/);
  assert.match(storage, /eidetic-player\.interface\.folder-sort/);
  const switcher = foldersSource.slice(
    foldersSource.indexOf("const setViewMode"),
    foldersSource.indexOf("const viewControls"),
  );
  assert.match(switcher, /section\.dataset\.folderView = mode/);
  assert.doesNotMatch(switcher, /\.browse\(|folderArtwork\(|replaceChildren/);
  assert.match(
    styles,
    /\[data-folder-view="list"\] \.folders-folder-collection/,
  );
});

void test("Folders root is minimal and delegates source management", () => {
  const chooser = foldersSource.slice(
    foldersSource.indexOf("const showSourceChooser"),
    foldersSource.indexOf("back.addEventListener"),
  );
  assert.match(chooser, /folders\.noSources/);
  assert.match(chooser, /folders\.openSources/);
  assert.doesNotMatch(chooser, /addFolder|screen\.library\.description/);
  assert.match(
    styles,
    /\.folders-directory-header\[hidden\],[\s\S]*\.folders-root-toolbar\[hidden\][\s\S]*display: none/,
  );
});

void test("folder cards use clickable artwork, file counts and an action menu", () => {
  assert.match(foldersSource, /folders-folder-card__body/);
  assert.match(foldersSource, /folders-folder-card__art-button/);
  assert.match(foldersSource, /dataset\.fileCount/);
  assert.doesNotMatch(foldersSource, /folders-folder-card__play/);
  assert.match(foldersSource, /aria-haspopup", "menu"/);
  assert.match(foldersSource, /\["queue", t\("folders\.addToQueue"\)\]/);
  assert.match(foldersSource, /event\.key !== "Escape"/);
  assert.match(foldersSource, /new IntersectionObserver/);
});

void test("folder sorting and audio row menus are independent controls", () => {
  assert.match(foldersSource, /const sortFolderCards/);
  assert.match(foldersSource, /folders\.mostFiles/);
  assert.match(foldersSource, /className = "folders-audio__more"/);
  assert.match(foldersSource, /kind: "audio"/);
  assert.match(foldersSource, /addEntryToQueue/);
});

void test("sorting and List/Grid are root-only and sorting is an app popup", () => {
  const directoryRenderer = foldersSource.slice(
    foldersSource.indexOf("const renderDirectory"),
    foldersSource.indexOf("async function loadDirectory"),
  );
  const rootRenderer = foldersSource.slice(
    foldersSource.indexOf("const showSourceChooser"),
    foldersSource.indexOf("back.addEventListener"),
  );
  assert.doesNotMatch(directoryRenderer, /sortControls\(\)|viewControls\(\)/);
  assert.match(rootRenderer, /rootSort\.replaceChildren\(sortControls\(\)\)/);
  assert.match(
    rootRenderer,
    /rootActions\.replaceChildren\(viewControls\(\)\)/,
  );
  assert.doesNotMatch(foldersSource, /createElement\("select"\)/);
  assert.match(foldersSource, /role", "menuitemradio"/);
  assert.match(
    foldersSource,
    /breadcrumbs\.hidden = list\.childElementCount === 0/,
  );
});

void test("compact audio quality remains on one line at desktop width", () => {
  assert.match(
    styles,
    /\.folders-audio__main \{[\s\S]*grid-template-columns: 4rem minmax\(0, 1fr\) 11rem 4\.5rem/,
  );
  assert.match(
    styles,
    /\.folders-audio__technical \{[\s\S]*white-space: nowrap/,
  );
});

void test("source actions use an accessible non-destructive modal", () => {
  assert.match(sourcesSource, /role="dialog" aria-modal="true"/);
  assert.match(sourcesSource, /event\.key === "Escape"/);
  assert.match(sourcesSource, /returnFocus\?\.focus\(\)/);
  assert.match(sourcesSource, /sources\.filesNotDeleted/);
  assert.match(sourcesSource, /else dialogField\.remove\(\)/);
  assert.match(sourcesSource, /Remove “\$\{source\.displayName\}”\?/);
  assert.doesNotMatch(sourcesSource, /confirm\(|alert\(/);
});

void test("public folder contracts contain no native root or absolute path field", () => {
  assert.doesNotMatch(contracts, /nativeRoot|canonicalRoot|absolutePath/);
  assert.match(contracts, /readonly relativePath: string/);
  assert.match(contracts, /readonly id: string/);
});
