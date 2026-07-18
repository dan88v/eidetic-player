import test from "node:test";
import assert from "node:assert/strict";
import { validateCommandBody } from "../src/api/command-validation.js";

void test("valid command bodies are parsed", () => {
  assert.deepEqual(validateCommandBody("volume", { volume: 42 }), {
    type: "volume",
    volume: 42,
  });
  assert.deepEqual(validateCommandBody("repeat", { mode: "one" }), {
    type: "repeat",
    mode: "one",
  });
  assert.deepEqual(
    validateCommandBody("queue-remove", {
      queueItemId: "queue-123e4567-e89b-42d3-a456-426614174000",
    }),
    {
      type: "queue-remove",
      queueItemId: "queue-123e4567-e89b-42d3-a456-426614174000",
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
  assert.throws(
    () => validateCommandBody("queue-remove", { queueItemId: "../track" }),
    /opaque/,
  );
});
