import test from "node:test";
import assert from "node:assert/strict";
import { validateCommandBody } from "../src/api/command-validation.js";

void test("valid command bodies are parsed", () => {
  assert.deepEqual(
    validateCommandBody("open", {
      paths: ["C:\\Music\\Album\\01.flac"],
      explicitQueuePolicy: "clear",
      expectedQueueRevision: 7,
    }),
    {
      type: "open",
      paths: ["C:\\Music\\Album\\01.flac"],
      queueDecision: {
        explicitQueuePolicy: "clear",
        expectedQueueRevision: 7,
      },
    },
  );
  assert.deepEqual(validateCommandBody("volume", { volume: 42 }), {
    type: "volume",
    volume: 42,
  });
  assert.deepEqual(validateCommandBody("repeat", { mode: "one" }), {
    type: "repeat",
    mode: "one",
  });
  assert.deepEqual(
    validateCommandBody("queue-play", {
      index: 2,
      queueItemId: "queue-123e4567-e89b-42d3-a456-426614174000",
      intentId: 7,
      requestedAtMilliseconds: 12.5,
    }),
    {
      type: "queue-play",
      index: 2,
      queueItemId: "queue-123e4567-e89b-42d3-a456-426614174000",
      metadata: { intentId: 7, requestedAtMilliseconds: 12.5 },
    },
  );
  assert.deepEqual(
    validateCommandBody("queue-remove", {
      queueItemId: "queue-123e4567-e89b-42d3-a456-426614174000",
    }),
    {
      type: "queue-remove",
      queueItemId: "queue-123e4567-e89b-42d3-a456-426614174000",
    },
  );
  assert.deepEqual(
    validateCommandBody("next", {
      targetQueueItemId: "queue-123e4567-e89b-42d3-a456-426614174000",
      intentId: 8,
      requestedAtMilliseconds: 13,
    }),
    {
      type: "next",
      targetQueueItemId: "queue-123e4567-e89b-42d3-a456-426614174000",
      metadata: { intentId: 8, requestedAtMilliseconds: 13 },
    },
  );
});

void test("invalid command bodies are rejected", () => {
  assert.throws(
    () => validateCommandBody("volume", { volume: 101 }),
    /between 0 and 100/,
  );
  assert.throws(
    () => validateCommandBody("seek", { positionSeconds: -1 }),
    /non-negative/,
  );
  assert.throws(() => validateCommandBody("open", { paths: [] }), /non-empty/);
  for (const invalid of [
    { explicitQueuePolicy: "drop", expectedQueueRevision: 1 },
    { explicitQueuePolicy: "clear", expectedQueueRevision: -1 },
    { explicitQueuePolicy: "clear" },
  ])
    assert.throws(
      () =>
        validateCommandBody("open", {
          paths: ["C:\\Music\\Album\\01.flac"],
          ...invalid,
        }),
      /valid Explicit Queue policy/u,
    );
  assert.throws(
    () => validateCommandBody("queue-remove", { queueItemId: "../track" }),
    /opaque/,
  );
  assert.throws(
    () => validateCommandBody("next", { targetQueueItemId: "../track" }),
    /opaque/,
  );
  assert.throws(
    () =>
      validateCommandBody("play-pause", {
        intentId: 0,
        requestedAtMilliseconds: 1,
      }),
    /intent metadata/,
  );
});

void test("Explicit Queue command bodies preserve stable IDs and concurrency assertions", () => {
  const explicitId = "explicit-123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(
    validateCommandBody("queue-play", {
      queueItemId: explicitId,
      index: 9,
    }),
    {
      type: "queue-play",
      queueItemId: explicitId,
      index: 9,
    },
  );
  assert.deepEqual(
    validateCommandBody("queue-remove", { queueItemId: explicitId }),
    {
      type: "queue-remove",
      queueItemId: explicitId,
    },
  );
  assert.deepEqual(
    validateCommandBody("queue-reorder", {
      queueItemId: explicitId,
      toIndex: 3,
      expectedQueueRevision: 27,
    }),
    {
      type: "queue-reorder",
      queueItemId: explicitId,
      toIndex: 3,
      expectedQueueRevision: 27,
    },
  );

  for (const expectedQueueRevision of [-1, 1.5, "2", Number.MAX_VALUE])
    assert.throws(
      () =>
        validateCommandBody("queue-reorder", {
          queueItemId: explicitId,
          toIndex: 3,
          expectedQueueRevision,
        }),
      /expectedQueueRevision must be a non-negative integer/u,
    );
  assert.throws(
    () =>
      validateCommandBody("queue-play", {
        queueItemId: explicitId,
        index: -1,
      }),
    /index must be a non-negative integer/u,
  );
});
