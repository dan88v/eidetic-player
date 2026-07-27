import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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
  const activate = begin.indexOf("const activate");
  const capture = begin.indexOf("handle.setPointerCapture");
  assert.ok(activate >= 0 && capture > activate);
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

void test("no global gesture blocker or JavaScript scroll engine is introduced", () => {
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
    /document\.addEventListener\("pointermove", revealPointer, \{ passive: true \}\)/,
  );
});

void test("native click suppression remains authoritative without a swipe guard", () => {
  const sources = sourceFiles("apps/ui/src").map(read).join("\n");
  assert.doesNotMatch(sources, /swipeGuard|suppressNextClick|antiClick/i);
  assert.match(
    read("apps/ui/src/screens/now-playing.ts"),
    /artworkButton\.addEventListener\("click", options\.onOpenLibrary\)/,
  );
});
