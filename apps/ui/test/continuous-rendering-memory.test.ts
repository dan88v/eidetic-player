import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

void test("continuous visualizer painting reuses one opaque canvas context", async () => {
  const source = await readFile("apps/ui/src/components/visualizer.ts", "utf8");
  assert.equal(source.match(/canvas\.getContext\(/gu)?.length, 1);
  assert.match(source, /canvas\.getContext\("2d", \{ alpha: false \}\)/u);
  assert.match(source, /context\.fillRect\(0, 0, size\.width, size\.height\)/u);
  assert.match(source, /TARGET_FRAME_INTERVAL = 1_000 \/ 15/u);
});

void test("playback position moves timeline layers without repainting canvases", async () => {
  const source = await readFile("apps/ui/src/components/timeline.ts", "utf8");
  const setProgress =
    /function setProgress[\s\S]*?\n[ ]{2}\}\n\n[ ]{2}function updateFromPointer/u.exec(
      source,
    )?.[0];
  assert.ok(setProgress);
  assert.match(setProgress, /updateProgressLayers\(\)/u);
  assert.doesNotMatch(
    setProgress,
    /prepareCanvas|renderWaveform|renderLine|getContext|getBoundingClientRect/u,
  );
  assert.match(source, /new ResizeObserver\(drawStaticTimeline\)/u);
  assert.match(source, /slider\.append\(canvas, playedLayer, playhead\)/u);
  assert.equal(
    source.match(/getContext\("2d", \{ alpha: false \}\)/gu)?.length,
    2,
  );
});

void test("visualizer frame consumption avoids per-frame removed arrays", async () => {
  const source = await readFile(
    "apps/ui/src/visualizer/visualizer-frame-buffer.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /\.splice\(/u);
  assert.match(source, /this\.frames\.shift\(\)/u);
});
