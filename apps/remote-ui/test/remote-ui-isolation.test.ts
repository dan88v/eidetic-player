import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

void test("Remote UI is standalone and never imports the appliance UI", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
  assert.doesNotMatch(source, /apps\/ui|components\/app-shell|now-playing/iu);
  assert.doesNotMatch(styles, /apps\/ui|\.app-shell|\.top-bar/iu);
  assert.match(source, /new EventSource\("\/api\/events"/u);
  assert.equal((source.match(/new EventSource/gu) ?? []).length, 1);
  assert.match(source, /visibilitychange/u);
  assert.match(source, /stream\?\.close\(\)/u);
});

void test("Remote UI has no PWA, credential storage, visualizer, or custom keyboard", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const html = await readFile(resolve(root, "index.html"), "utf8");
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "serviceWorker",
    "WebSocket",
    "visualizer",
    "fft",
    "manifest.webmanifest",
  ])
    assert.doesNotMatch(`${source}\n${html}`, new RegExp(forbidden, "iu"));
  assert.doesNotMatch(html, /rel=["']manifest/iu);
  assert.match(source, /inputMode = "search"/u);
  assert.match(source, /inputMode = "numeric"/u);
});

void test("Remote UI exposes exactly four portrait destinations and safe-area layout", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
  for (const destination of ["Player", "Library", "Browse", "Queue"])
    assert.match(source, new RegExp(`"${destination}"`, "u"));
  assert.match(styles, /env\(safe-area-inset-bottom\)/u);
  assert.match(styles, /overflow-x: hidden/u);
  assert.match(styles, /min-height: 44px/u);
  assert.match(styles, /width: min\(100%, 540px\)/u);
});

void test("Remote UI keeps wake separate, confirms clear, and rolls back touch reorder", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  assert.match(source, /runAction\("\/api\/display\/wake"\)/u);
  assert.match(
    source,
    /runCommand\("\/api\/queue\/clear", \{ confirm: true \}\)/u,
  );
  assert.match(source, /pointercancel/u);
  assert.match(source, /pointermove/u);
  assert.match(source, /releasePointerCapture/u);
  assert.match(source, /remote-queue-row--drop-target/u);
  assert.match(source, /previousPlayer/u);
  assert.match(source, /"\/api\/library\/queue"/u);
  assert.match(source, /nextCursor/u);
  assert.match(source, /Load more/u);
});

void test("Remote Player mirrors the appliance transport and hides fixed volume", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
  assert.match(source, /remote-header__brand", "Eidetic Player"/u);
  assert.match(source, /setRemoteIcon\(shuffle, "shuffle"\)/u);
  assert.match(source, /setRemoteIcon\(repeat, "repeat"\)/u);
  assert.match(
    source,
    /transport\.append\(shuffle, previous, play, next, repeat\)/u,
  );
  assert.match(source, /outputLevelMode !== "fixed"/u);
  assert.doesNotMatch(source, /Fixed 100%/u);
  assert.match(styles, /\.remote-round-button--mode/u);
  assert.match(styles, /\.remote-header__action\s*\{[\s\S]*border:/u);
});

void test("Remote UI starts visibly on plain HTTP LAN origins", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const sessionId = await readFile(
    resolve(root, "src/client-session-id.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /crypto\.randomUUID/u);
  assert.match(sessionId, /getRandomValues/u);
  assert.match(source, /renderStartup\(\);\s*void loadBootstrap\(\);/u);
  assert.match(source, /Connecting to Eidetic Player/u);
});
