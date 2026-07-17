import assert from "node:assert/strict";
import test from "node:test";
import { LimitedConcurrency } from "../src/utils/limited-concurrency.js";

void test("Queue artwork concurrency never exceeds two operations", async () => {
  const limiter = new LimitedConcurrency(2);
  let active = 0;
  let maximum = 0;
  let releases: (() => void)[] = [];
  const operations = Array.from({ length: 6 }, (_, index) =>
    limiter.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
        if (releases.length === 2) {
          const batch = releases;
          releases = [];
          queueMicrotask(() => {
            batch.forEach((release) => {
              release();
            });
          });
        }
      });
      active -= 1;
      return index;
    }),
  );
  assert.deepEqual(await Promise.all(operations), [0, 1, 2, 3, 4, 5]);
  assert.equal(maximum, 2);
});
