import assert from "node:assert/strict";
import test from "node:test";
import type { AppBootstrap } from "../src/api/player-api-client";
import { loadAuthoritativeBootstrap } from "../src/bootstrap/backend-bootstrap";

const bootstrapFixture = {} as AppBootstrap;

void test("production bootstrap retries transient failures and returns authoritative state", async () => {
  const attempts: number[] = [];
  const delays: number[] = [];

  const result = await loadAuthoritativeBootstrap(
    () => {
      attempts.push(attempts.length + 1);
      return attempts.length < 3
        ? Promise.reject(new Error("backend not ready"))
        : Promise.resolve(bootstrapFixture);
    },
    {
      requestTimeoutMilliseconds: 100,
      retryDelaysMilliseconds: [1, 2, 3],
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    },
  );

  assert.equal(result, bootstrapFixture);
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(delays, [1, 2]);
});

void test("production bootstrap aborts a stalled attempt before retrying", async () => {
  let attempts = 0;
  const failures: unknown[] = [];

  const result = await loadAuthoritativeBootstrap(
    (signal) => {
      attempts += 1;
      if (attempts > 1) return Promise.resolve(bootstrapFixture);
      return new Promise<AppBootstrap>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error("bootstrap request aborted"),
            );
          },
          { once: true },
        );
      });
    },
    {
      requestTimeoutMilliseconds: 1,
      retryDelaysMilliseconds: [0],
      onFailure: (error) => {
        failures.push(error);
      },
      sleep: () => Promise.resolve(),
    },
  );

  assert.equal(result, bootstrapFixture);
  assert.equal(attempts, 2);
  assert.equal(failures.length, 1);
});
