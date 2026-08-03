import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PointerModalityTracker } from "../src/utils/pointer-visibility-controller";

const mouseMove = (movementX: number, movementY: number) => ({
  pointerType: "mouse",
  movementX,
  movementY,
  buttons: 0,
});

void test("one absolute relocation does not reveal the appliance pointer", () => {
  const tracker = new PointerModalityTracker();
  assert.equal(tracker.moved(mouseMove(400, 250), 100), "unchanged");
  assert.equal(tracker.pressed(mouseMove(0, 0), 110), "hide");
});

void test("confirmed mouse motion reveals the pointer and touch hides it", () => {
  const tracker = new PointerModalityTracker();
  assert.equal(tracker.moved(mouseMove(3, 2), 100), "unchanged");
  assert.equal(tracker.moved(mouseMove(5, 4), 150), "unchanged");
  assert.equal(tracker.moved(mouseMove(5, 3), 180), "show");
  assert.equal(tracker.pressed(mouseMove(0, 0), 190), "show");
  assert.equal(
    tracker.moved({ pointerType: "touch", movementX: 4, movementY: 2 }, 200),
    "hide",
  );
  assert.equal(tracker.moved(mouseMove(9, 0), 250), "hide");
});

void test("touch quarantine rejects synthesized hover and pressed mouse events", () => {
  const tracker = new PointerModalityTracker();
  assert.equal(tracker.touched(100), "hide");
  assert.equal(tracker.moved(mouseMove(20, 0), 150), "hide");
  assert.equal(tracker.moved(mouseMove(20, 0), 200), "hide");
  assert.equal(tracker.moved(mouseMove(20, 0), 250), "hide");
  assert.equal(tracker.pressed(mouseMove(0, 0), 260), "hide");
  assert.equal(tracker.moved(mouseMove(5, 0), 2_700), "unchanged");
  assert.equal(tracker.moved(mouseMove(5, 0), 2_750), "unchanged");
  assert.equal(tracker.moved(mouseMove(5, 0), 2_800), "show");
});

void test("mouse-emulated touch drag cannot confirm pointer visibility", () => {
  const tracker = new PointerModalityTracker();
  const dragMove = { ...mouseMove(20, 12), buttons: 1 };
  assert.equal(tracker.moved(dragMove, 100), "hide");
  assert.equal(tracker.moved(dragMove, 150), "hide");
  assert.equal(tracker.moved(dragMove, 200), "hide");
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
  assert.match(source, /tracker\.touched\(performance\.now\(\)\)/);
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
