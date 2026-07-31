import assert from "node:assert/strict";
import test from "node:test";
import { createClientSessionId } from "../src/client-session-id";

void test("client session IDs work without secure-context randomUUID", () => {
  const source = {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (array instanceof Uint8Array)
        array.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return array;
    },
  };
  assert.equal(
    createClientSessionId(source),
    "00010203-0405-4607-8809-0a0b0c0d0e0f",
  );
});
