import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticPlayerRecoveryDelaysMilliseconds,
  PlayerRecoveryService,
  type PlayerRecoveryScheduler,
} from "../src/player/player-recovery-service.js";

class FixtureScheduler implements PlayerRecoveryScheduler {
  readonly delays: number[] = [];
  private callbacks: (() => void)[] = [];

  setTimeout(callback: () => void, milliseconds: number): unknown {
    this.delays.push(milliseconds);
    this.callbacks.push(callback);
    return callback;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks = this.callbacks.filter((callback) => callback !== handle);
  }

  runNext(): void {
    this.callbacks.shift()?.();
  }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

void test("automatic MPV recovery is bounded and uses one timer at a time", async () => {
  const scheduler = new FixtureScheduler();
  let attempts = 0;
  const service = new PlayerRecoveryService(() => {
    attempts += 1;
    return Promise.resolve(false);
  }, scheduler);

  service.startAutomaticRecovery();
  service.startAutomaticRecovery();
  for (const delay of automaticPlayerRecoveryDelaysMilliseconds) {
    assert.equal(scheduler.delays.at(-1), delay);
    scheduler.runNext();
    await settle();
  }

  assert.equal(attempts, automaticPlayerRecoveryDelaysMilliseconds.length);
  assert.deepEqual(scheduler.delays, automaticPlayerRecoveryDelaysMilliseconds);
  service.close();
});

void test("manual MPV retry coalesces concurrent requests", async () => {
  let resolveRecovery!: (result: boolean) => void;
  let attempts = 0;
  const service = new PlayerRecoveryService(() => {
    attempts += 1;
    return new Promise<boolean>((resolve) => {
      resolveRecovery = resolve;
    });
  });

  const first = service.retryNow();
  const second = service.retryNow();
  assert.equal(attempts, 1);
  resolveRecovery(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  service.close();
});

void test("a later MPV outage receives a fresh bounded recovery budget", async () => {
  const scheduler = new FixtureScheduler();
  let recover = true;
  const service = new PlayerRecoveryService(
    () => Promise.resolve(recover),
    scheduler,
  );

  service.startAutomaticRecovery();
  scheduler.runNext();
  await settle();

  recover = false;
  service.startAutomaticRecovery();
  for (const delay of automaticPlayerRecoveryDelaysMilliseconds) {
    assert.equal(scheduler.delays.at(-1), delay);
    scheduler.runNext();
    await settle();
  }

  assert.deepEqual(scheduler.delays, [
    automaticPlayerRecoveryDelaysMilliseconds[0],
    ...automaticPlayerRecoveryDelaysMilliseconds,
  ]);
  service.close();
});
