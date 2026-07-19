import assert from "node:assert/strict";
import test from "node:test";
import { MeterBallistics } from "../src/visualizer/meter-ballistics.js";
import {
  linearPeakToDb,
  METER_MIN_DB,
  METER_SCALE_DB,
  meterPositionForDb,
} from "../src/visualizer/meter-renderer.js";

void test("enhanced meter mapping is bounded, monotonic, and continuous", () => {
  assert.equal(meterPositionForDb(-100), 0);
  assert.equal(meterPositionForDb(-60), 0);
  assert.equal(meterPositionForDb(-24), 0.3);
  assert.equal(meterPositionForDb(-12), 0.6);
  assert.equal(meterPositionForDb(-6), 0.8);
  assert.equal(meterPositionForDb(0), 1);
  assert.equal(meterPositionForDb(4), 1);
  let previous = -1;
  for (let db = -60; db <= 0; db += 0.01) {
    const position = meterPositionForDb(db);
    assert.ok(position >= previous);
    previous = position;
  }
  for (const joint of [-24, -12, -6])
    assert.ok(
      Math.abs(
        meterPositionForDb(joint - 1e-7) - meterPositionForDb(joint + 1e-7),
      ) < 1e-6,
    );
});

void test("enhanced meter scale and physical peak conversion stay honest", () => {
  assert.deepEqual(METER_SCALE_DB, [-60, -40, -24, -12, -6, -3, 0]);
  assert.equal(linearPeakToDb(0), METER_MIN_DB);
  assert.ok(Math.abs(linearPeakToDb(0.1) + 20) < 1e-12);
  assert.ok(Math.abs(linearPeakToDb(0.5) + 6.0206) < 0.0001);
  assert.equal(linearPeakToDb(2), 0);
  assert.equal(meterPositionForDb(-6), 0.8);
  assert.ok(meterPositionForDb(-18) > meterPositionForDb(-24));
});

void test("meter ballistics attack, release, peak hold, pause, and reset", () => {
  const meter = new MeterBallistics();
  meter.setPaused(false, 0);
  meter.setPeaks(1, 0.5);
  assert.equal(meter.update(0), true);
  assert.equal(meter.displayedDb[0], 0);
  const held = Number(meter.peakHoldDb.at(0));

  meter.setPeaks(0.1, 0.1);
  meter.update(100);
  assert.ok(Number(meter.displayedDb.at(0)) > -20);
  assert.equal(meter.peakHoldDb[0], held);

  meter.setPaused(true, 200);
  const frozen = meter.displayedDb[0];
  meter.update(5_000);
  assert.equal(meter.displayedDb[0], frozen);
  assert.equal(meter.peakHoldDb[0], held);

  meter.setPaused(false, 5_000);
  meter.update(5_100);
  assert.ok(Number(meter.peakHoldDb.at(0)) < held);
  meter.reset();
  assert.deepEqual([...meter.displayedDb], [METER_MIN_DB, METER_MIN_DB]);
  assert.deepEqual([...meter.peakHoldDb], [METER_MIN_DB, METER_MIN_DB]);
});
