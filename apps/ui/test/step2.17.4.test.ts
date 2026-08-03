import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  RELIABLE_TOUCH_SCROLL_DRAG_THRESHOLD,
  touchScrollDragStarted,
  touchScrollTarget,
  touchScrollVelocity,
} from "../src/utils/reliable-touch-scroll";
import { queueDropIndex } from "../src/utils/queue-reorder";

const read = (path: string): string => readFileSync(path, "utf8");
const base = read("apps/ui/src/styles/base.css");
const layout = read("apps/ui/src/styles/layout.css");
const components = read("apps/ui/src/styles/components.css");
const screens = read("apps/ui/src/styles/screens.css");

function declarationBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing CSS rule: ${selector}`);
  const bodyStart = source.indexOf("{", start) + 1;
  const end = source.indexOf("}", bodyStart);
  assert.ok(end >= bodyStart, `incomplete CSS rule: ${selector}`);
  return source.slice(bodyStart, end);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

void test("root stays fixed while every canonical page uses native vertical pan", () => {
  const root = declarationBlock(base, "html,\n  body,\n  #app");
  assert.match(root, /overflow: hidden;/);
  assert.match(root, /overscroll-behavior: none;/);
  assert.doesNotMatch(root, /touch-action:\s*none/);

  const shell = declarationBlock(layout, ".content-shell");
  assert.match(shell, /min-height: 0;/);
  assert.match(shell, /grid-template-rows: minmax\(0, 1fr\);/);

  const region = declarationBlock(layout, ".screen-region");
  assert.match(region, /min-height: 0;/);
  assert.match(region, /overflow-x: hidden;/);
  assert.match(region, /overflow-y: auto;/);
  assert.match(region, /overscroll-behavior-y: contain;/);
  assert.match(region, /touch-action: pan-y;/);

  const targets = declarationBlock(
    layout,
    '.screen-region :where(button, [role="button"])',
  );
  assert.match(targets, /touch-action: pan-y;/);
});

void test("drawer keeps chrome fixed and assigns native pan to its nav targets", () => {
  const drawer = declarationBlock(components, ".side-menu");
  assert.match(drawer, /grid-template-rows: auto minmax\(0, 1fr\) auto;/);
  assert.match(drawer, /overflow: hidden;/);

  const nav = declarationBlock(components, ".side-menu__nav");
  assert.match(nav, /min-height: 0;/);
  assert.match(nav, /overflow-x: hidden;/);
  assert.match(nav, /overflow-y: auto;/);
  assert.match(nav, /overscroll-behavior-y: contain;/);
  assert.match(nav, /touch-action: pan-y;/);

  const targets = declarationBlock(
    components,
    '.side-menu__nav :where(button, [role="button"])',
  );
  assert.match(targets, /touch-action: pan-y;/);

  const sideMenu = read("apps/ui/src/components/side-menu.ts");
  assert.ok(
    sideMenu.indexOf("side-menu__header") <
      sideMenu.indexOf("side-menu__nav") &&
      sideMenu.indexOf("side-menu__nav") <
        sideMenu.indexOf("side-menu__footer"),
  );
});

void test("Queue body pans, row actions tap, and only its handle owns drag", () => {
  const drawer = declarationBlock(components, ".queue-drawer");
  assert.match(drawer, /grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(drawer, /overflow: hidden;/);

  const list = declarationBlock(components, ".queue-list");
  assert.match(list, /min-height: 0;/);
  assert.match(list, /overflow-x: hidden;/);
  assert.match(list, /overflow-y: auto;/);
  assert.match(list, /overscroll-behavior-y: contain;/);
  assert.match(list, /touch-action: pan-y;/);

  const targets = declarationBlock(
    components,
    '.queue-list :where(button, [role="button"])',
  );
  assert.match(targets, /touch-action: pan-y;/);
  assert.match(
    declarationBlock(components, ".queue-item__handle"),
    /touch-action: none;/,
  );

  const source = read("apps/ui/src/components/queue-drawer.ts");
  const begin = source.slice(
    source.indexOf("const beginReorder"),
    source.indexOf('handle.addEventListener("pointerdown", beginReorder)'),
  );
  const capture = begin.indexOf("handle.setPointerCapture");
  assert.ok(capture >= 0 && capture < begin.indexOf("const activate"));
  assert.match(begin, /pointercancel/);
  assert.doesNotMatch(
    source.slice(
      source.indexOf('button.className = "queue-item__button"'),
      source.indexOf('handle.className = "queue-item__handle"'),
    ),
    /pointerdown|setPointerCapture/,
  );
});

void test("Playlist reorder also captures only after its real drag threshold", () => {
  const source = read("apps/ui/src/screens/playlists.ts");
  const begin = source.slice(
    source.indexOf("const beginReorder"),
    source.indexOf("\n  root\n    .querySelector"),
  );
  assert.ok(
    begin.indexOf("setPointerCapture") > begin.indexOf("const activate"),
  );
  assert.match(begin, /pointercancel/);
});

void test("scrollable modal bodies contain touch overscroll and keep visible bars", () => {
  for (const [source, selector] of [
    [components, ".playlist-picker__body"],
    [components, ".power-dialog"],
    [screens, ".source-dialog"],
    [screens, ".smb-dialog__body"],
  ] as const) {
    const block = declarationBlock(source, selector);
    assert.match(block, /overflow-y: auto;/, `${selector} must scroll`);
    assert.match(block, /overscroll-behavior-y: contain;/);
    assert.match(block, /touch-action: pan-y;/);
  }

  const scrollbarRule = declarationBlock(
    layout,
    ":is(\n    .screen-region,\n    .side-menu__nav,\n    .queue-list,\n    .playlist-picker__body,\n    .power-dialog,\n    .source-dialog,\n    .smb-dialog__body\n  )",
  );
  assert.match(scrollbarRule, /scrollbar-color:/);
  assert.match(scrollbarRule, /scrollbar-width: thin;/);
  assert.match(layout, /::-webkit-scrollbar-thumb/);
});

void test("Raspberry fallback remains local and adds no document touch blocker", () => {
  const combinedCss = [base, layout, components, screens].join("\n");
  assert.doesNotMatch(
    combinedCss,
    /(?:html|body|#app|\.app-root|\.screen-region|\.queue-list|\.queue-item|\.side-menu__nav)\s*\{[^}]*touch-action:\s*none/s,
  );

  const sources = sourceFiles("apps/ui/src").map(read).join("\n");
  assert.doesNotMatch(sources, /addEventListener\("touchmove"/);
  assert.doesNotMatch(sources, /(?:momentum|deceleration|kineticScroll)/i);
  assert.doesNotMatch(sources, /document\.addEventListener\("touchmove"/);
  assert.match(
    read("apps/ui/src/components/app-shell.ts"),
    /createPointerVisibilityController\([\s\S]*systemCapabilities\.hidePointerWhenInactive/,
  );
});

void test("fallback click suppression is local and cover click remains intact", () => {
  const sources = sourceFiles("apps/ui/src").map(read).join("\n");
  assert.equal(sources.match(/let suppressNextClick/g)?.length, 1);
  assert.match(
    read("apps/ui/src/utils/reliable-touch-scroll.ts"),
    /event\.detail === 0/,
  );
  assert.match(
    read("apps/ui/src/screens/now-playing.ts"),
    /artworkButton\.addEventListener\("click", options\.onOpenLibrary\)/,
  );
});

void test("Raspberry fallback maps finger motion to direct-manipulation scroll", () => {
  assert.equal(RELIABLE_TOUCH_SCROLL_DRAG_THRESHOLD, 16);
  assert.equal(touchScrollDragStarted(7, 7), false);
  assert.equal(touchScrollDragStarted(12, 8), false);
  assert.equal(touchScrollDragStarted(16, 0), true);
  assert.equal(touchScrollTarget(100, 300, 240), 160);
  assert.equal(touchScrollTarget(100, 300, 360), 40);
  assert.ok(touchScrollVelocity(300, 240, 30) > 0);
  assert.ok(touchScrollVelocity(300, 360, 30) < 0);

  const source = read("apps/ui/src/utils/reliable-touch-scroll.ts");
  assert.match(source, /pointerdown|pointermove|pointercancel/);
  assert.doesNotMatch(source, /event\.pointerType === "touch"/);
  assert.doesNotMatch(source, /navigator\.platform/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /preventDefault/);
  assert.match(source, /suppressNextClick/);
  assert.doesNotMatch(source, /document\.addEventListener\("touchmove"/);

  assert.match(
    read("apps/ui/src/components/app-shell.ts"),
    /createReliableTouchScroller\(screenRegion\)/,
  );
  assert.match(
    read("apps/ui/src/components/side-menu.ts"),
    /createReliableTouchScroller\(nav\)/,
  );
  assert.match(
    read("apps/ui/src/components/queue-drawer.ts"),
    /createReliableTouchScroller\(list\)/,
  );
});

void test("Queue handle captures immediately and keeps symmetric drop geometry", () => {
  const source = read("apps/ui/src/components/queue-drawer.ts");
  const begin = source.slice(
    source.indexOf("const beginReorder"),
    source.indexOf('handle.addEventListener("pointerdown", beginReorder)'),
  );
  assert.ok(
    begin.indexOf("handle.setPointerCapture(pointerId)") <
      begin.indexOf("const activate"),
  );

  assert.equal(queueDropIndex([100, 200, 300], 50), 0);
  assert.equal(queueDropIndex([100, 200, 300], 150), 1);
  assert.equal(queueDropIndex([100, 200, 300], 250), 2);
  assert.equal(queueDropIndex([100, 200, 300], 350), 3);
});

void test("pickers and long dialogs reuse and destroy the shared fallback", () => {
  for (const path of [
    "apps/ui/src/components/playlist-picker.ts",
    "apps/ui/src/components/removable-device-picker.ts",
    "apps/ui/src/components/playlist-name-dialog.ts",
    "apps/ui/src/components/power-menu.ts",
    "apps/ui/src/screens/usb-storage.ts",
    "apps/ui/src/screens/sources.ts",
    "apps/ui/src/screens/network-settings-panel.ts",
  ]) {
    const source = read(path);
    assert.match(source, /createReliableTouchScroller/);
    assert.match(source, /\.destroy\(\)/);
  }

  const utility = read("apps/ui/src/utils/reliable-touch-scroll.ts");
  assert.equal(
    utility.match(/requestAnimationFrame\(/g)?.length,
    2,
    "one self-scheduling inertia loop plus its initial request",
  );
  assert.doesNotMatch(utility, /document\.addEventListener/);
});
