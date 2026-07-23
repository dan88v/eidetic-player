import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { usbStorageSession } from "../src/state/folders-session.js";

const files = await Promise.all(
  [
    "../src/screens/sources.ts",
    "../src/screens/folders.ts",
    "../src/screens/usb-storage.ts",
    "../src/screens/now-playing.ts",
    "../src/cassette/cassette-utility-controls.ts",
    "../src/components/app-shell.ts",
    "../src/components/side-menu.ts",
    "../src/components/icons.ts",
    "../src/styles/screens.css",
    "../src/styles/cassette-player.css",
    "../../../packages/shared/src/library.ts",
    "../../../packages/shared/src/player.ts",
    "../../backend/src/player-session/player-session-types.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);
const source = files.join("\n");

void test("USB session is separate per device and preserves logical scroll", () => {
  usbStorageSession.openSource("usb-a");
  usbStorageSession.setLocation("usb-a", "Artist/Album");
  usbStorageSession.setSelected("entry-a");
  usbStorageSession.saveScroll("usb-a", "Artist/Album", 420);
  usbStorageSession.openSource("usb-b");
  usbStorageSession.setLocation("usb-b", "Other");
  usbStorageSession.saveScroll("usb-b", "Other", 90);
  usbStorageSession.openSource("usb-a");
  assert.deepEqual(usbStorageSession.getLocation(), {
    sourceId: "usb-a",
    relativePath: "Artist/Album",
    selectedEntryId: "entry-a",
  });
  assert.equal(usbStorageSession.scrollFor("usb-a", "Artist/Album"), 420);
  assert.equal(usbStorageSession.scrollFor("usb-b", "Other"), 90);
});

void test("Step 2.11 surfaces keep the approved USB boundaries", () => {
  assert.match(source, /No USB storage connected\./);
  assert.match(source, /aria-label="USB Storage"/);
  assert.match(source, /data-control="usb-storage"/);
  assert.match(source, /icon\("usbStorage"\)/);
  assert.match(source, /transport__button--usb-storage/);
  assert.match(source, /cassette-player__utility-button--usb-storage/);
  assert.match(source, /#66e3d0/);
  assert.match(source, /removableDevices/);
  assert.match(source, /USB storage disconnected\./);
  assert.match(source, /kind: "removable"/);
  assert.doesNotMatch(source, /Add to Library/);
  assert.doesNotMatch(source, /data-screen="usbStorage"/);
});
