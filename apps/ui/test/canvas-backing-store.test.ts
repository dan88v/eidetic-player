import assert from "node:assert/strict";
import test from "node:test";
import { prepareCanvas } from "../src/visualizer/canvas";

void test("canvas backing store is not reallocated when its size is unchanged", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { devicePixelRatio: 2 },
  });

  let cssWidth = 320;
  const cssHeight = 100;
  let backingWidth = 0;
  let backingHeight = 0;
  let widthWrites = 0;
  let heightWrites = 0;
  let transformCalls = 0;
  let clearCalls = 0;
  const context = {
    setTransform() {
      transformCalls += 1;
    },
    clearRect() {
      clearCalls += 1;
    },
  };
  const canvas = {
    get width() {
      return backingWidth;
    },
    set width(value: number) {
      backingWidth = value;
      widthWrites += 1;
    },
    get height() {
      return backingHeight;
    },
    set height(value: number) {
      backingHeight = value;
      heightWrites += 1;
    },
    getBoundingClientRect() {
      return { width: cssWidth, height: cssHeight };
    },
    getContext() {
      return context;
    },
  } as unknown as HTMLCanvasElement;

  try {
    assert.deepEqual(prepareCanvas(canvas), {
      width: 320,
      height: 100,
      pixelRatio: 2,
    });
    assert.equal(widthWrites, 1);
    assert.equal(heightWrites, 1);

    prepareCanvas(canvas);
    assert.equal(widthWrites, 1);
    assert.equal(heightWrites, 1);
    assert.equal(transformCalls, 2);
    assert.equal(clearCalls, 2);

    cssWidth = 321;
    prepareCanvas(canvas);
    assert.equal(widthWrites, 2);
    assert.equal(heightWrites, 1);
    assert.equal(backingWidth, 642);
    assert.equal(backingHeight, 200);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});
