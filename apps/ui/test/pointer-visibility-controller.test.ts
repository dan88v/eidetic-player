import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PointerModalityTracker } from "../src/utils/pointer-visibility-controller";

const mouseMove = (movementX: number, movementY: number) => ({
  pointerType: "mouse",
  movementX,
  movementY,
});

void test("one absolute relocation does not reveal the appliance pointer", () => {
  const tracker = new PointerModalityTracker();
  assert.equal(tracker.moved(mouseMove(400, 250), 100), "unchanged");
  assert.equal(tracker.pressed(mouseMove(0, 0)), "hide");
});

void test("confirmed mouse motion reveals the pointer and touch hides it", () => {
  const tracker = new PointerModalityTracker();
  assert.equal(tracker.moved(mouseMove(3, 2), 100), "unchanged");
  assert.equal(tracker.moved(mouseMove(5, 4), 150), "show");
  assert.equal(tracker.pressed(mouseMove(0, 0)), "show");
  assert.equal(
    tracker.moved({ pointerType: "touch", movementX: 4, movementY: 2 }, 200),
    "hide",
  );
  assert.equal(tracker.moved(mouseMove(9, 0), 250), "unchanged");
});

void test("touch-derived compatibility mouse events never reveal the pointer", () => {
  const tracker = new PointerModalityTracker();
  const compatibilityMove = {
    ...mouseMove(20, 20),
    sourceCapabilities: { firesTouchEvents: true },
  };
  assert.equal(tracker.moved(compatibilityMove, 100), "hide");
  assert.equal(tracker.moved(compatibilityMove, 150), "hide");
});

void test("appliance pointer controller starts hidden, blocks context menus, and tears down", () => {
  const source = readFileSync(
    "apps/ui/src/utils/pointer-visibility-controller.ts",
    "utf8",
  );
  assert.match(source, /root\.classList\.add\("app-root--pointer-hidden"\)/);
  assert.match(
    source,
    /if \(hidePointerWhenInactive\) \{\s+root\.addEventListener\("contextmenu", suppressContextMenu\)/,
  );
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(
    source,
    /root\.removeEventListener\("contextmenu", suppressContextMenu\)/,
  );
  assert.match(
    source,
    /document\.removeEventListener\("pointermove", onPointerMove\)/,
  );
  assert.match(
    source,
    /document\.removeEventListener\("touchstart", onTouchStart\)/,
  );
});
