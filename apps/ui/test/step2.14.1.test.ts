import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { queueStructureChanged } from "../src/utils/queue-reorder";

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

function declarationBlockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing CSS marker: ${marker}`);
  const bodyStart = source.indexOf("{", start) + 1;
  const end = source.indexOf("}", bodyStart);
  assert.ok(end >= bodyStart, `incomplete CSS rule after: ${marker}`);
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

void test("app text is non-selectable with explicit editable opt-ins", () => {
  const root = declarationBlock(base, ".app-root");
  assert.match(root, /user-select: none;/);
  assert.match(root, /-webkit-user-select: none;/);

  for (const selector of [
    "input",
    "textarea",
    '[contenteditable="true"]',
    ".text-selectable",
    '[data-text-selectable="true"]',
  ])
    assert.ok(
      base.includes(selector),
      `missing editable selector: ${selector}`,
    );
  const editable = declarationBlockAfter(base, '[data-text-selectable="true"]');
  assert.match(editable, /user-select: text;/);
  assert.match(editable, /-webkit-user-select: text;/);
});

void test("artwork opts out of native image dragging", () => {
  const images = declarationBlock(base, ".app-root img");
  assert.match(images, /-webkit-user-drag: none;/);
  const artwork = read("apps/ui/src/components/artwork.ts");
  assert.match(artwork, /next\.draggable = false;/);
});

void test("page, drawer, Queue and modal bodies own native vertical scroll", () => {
  const page = declarationBlock(layout, ".screen-region");
  assert.match(page, /min-height: 0;/);
  assert.match(page, /overflow-x: hidden;/);
  assert.match(page, /overflow-y: auto;/);
  assert.match(page, /overscroll-behavior-y: contain;/);
  assert.match(page, /touch-action: pan-y;/);
  assert.match(page, /-webkit-overflow-scrolling: touch;/);

  const content = declarationBlock(layout, ".content-shell");
  assert.match(content, /min-height: 0;/);
  assert.match(content, /grid-template-rows: minmax\(0, 1fr\);/);

  for (const [source, selector] of [
    [components, ".side-menu__nav"],
    [components, ".queue-list"],
    [components, ".playlist-picker__body"],
    [screens, ".smb-dialog__body"],
  ] as const) {
    const block = declarationBlock(source, selector);
    assert.match(block, /overflow-y: auto;/, `${selector} must scroll`);
    assert.match(block, /overscroll-behavior-y: contain;/);
    assert.match(block, /touch-action: pan-y;/);
    assert.match(block, /-webkit-overflow-scrolling: touch;/);
  }
});

void test("touch ownership stays local and global listeners remain passive", () => {
  const combinedCss = [base, layout, components, screens].join("\n");
  assert.equal(
    (combinedCss.match(/touch-action:\s*none;/g) ?? []).length,
    5,
    "only the two timelines, volume and two reorder handles own gestures",
  );
  for (const [source, selector] of [
    [components, ".mini-player__timeline"],
    [components, ".queue-item__handle"],
    [components, ".volume-slider"],
    [screens, ".timeline__slider"],
    [screens, ".playlist-track__handle"],
  ] as const)
    assert.match(declarationBlock(source, selector), /touch-action: none;/);

  const uiSources = [
    ...sourceFiles("apps/ui/src"),
    ...sourceFiles("packages/on-screen-keyboard/src"),
  ]
    .map(read)
    .join("\n");
  assert.doesNotMatch(uiSources, /addEventListener\("touchmove"/);
  const shell = read("apps/ui/src/components/app-shell.ts");
  assert.match(
    shell,
    /document\.addEventListener\("pointermove", revealPointer, \{ passive: true \}\)/,
  );
  assert.match(
    shell,
    /document\.addEventListener\(eventName, noteActivity, \{ passive: true \}\)/,
  );
});

void test("captured gesture owners release pointer cancellation", () => {
  for (const path of [
    "apps/ui/src/components/timeline.ts",
    "apps/ui/src/components/mini-player.ts",
    "apps/ui/src/components/volume-popover.ts",
    "apps/ui/src/components/queue-drawer.ts",
    "apps/ui/src/screens/playlists.ts",
  ])
    assert.match(
      read(path),
      /pointercancel/,
      `${path} must handle pointer cancellation`,
    );
});

void test("Queue reorder survives player ticks and cancels for structural changes", () => {
  assert.equal(queueStructureChanged(["one", "two"], ["one", "two"]), false);
  assert.equal(queueStructureChanged(["one", "two"], ["two", "one"]), true);
  assert.equal(queueStructureChanged(["one", "two"], ["one"]), true);

  const drawer = read("apps/ui/src/components/queue-drawer.ts");
  const structuralBranch = drawer.slice(
    drawer.indexOf("if (structureChanged)"),
    drawer.indexOf("loadGeneration += 1"),
  );
  assert.match(structuralBranch, /cancelActiveReorder\?\.\(\)/);
});
