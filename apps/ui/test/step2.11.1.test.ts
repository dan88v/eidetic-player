import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [usb = "", folders = "", sources = "", api = "", styles = ""] =
  await Promise.all(
    [
      "../src/screens/usb-storage.ts",
      "../src/screens/folders.ts",
      "../src/screens/sources.ts",
      "../src/api/removable-storage-api-client.ts",
      "../src/styles/screens.css",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

void test("USB Library action stays in the canonical browser header", () => {
  assert.match(usb, /createDirectoryHeaderAction/);
  assert.match(usb, /Add this folder to Library/);
  assert.match(usb, /In Library/);
  assert.match(usb, /Covered/);
  assert.match(usb, /libraryCoverage/);
  assert.match(usb, /addLibrarySource/);
  assert.doesNotMatch(usb, /removeSource|navigate\(/i);
  assert.match(folders, /directoryActions\.append\(extraAction\)/);
  assert.match(styles, /\.folders-directory-library/);
  assert.match(styles, /min-width: 12\.5rem/);
});

void test("Sources and Folders distinguish persistent removable Sources", () => {
  assert.match(sources, /USB Library Folders/);
  assert.match(sources, /sources-list--removable-library/);
  assert.match(sources, /source\.type === "removable"/);
  assert.match(sources, /icon\(source\.type === "removable"/);
  assert.match(folders, /source\.type === "removable"/);
  assert.match(folders, /iconName:\s*source\.type === "removable"/);
  assert.match(api, /logicalRelativePath/);
  assert.match(api, /\/library-sources/);
});
