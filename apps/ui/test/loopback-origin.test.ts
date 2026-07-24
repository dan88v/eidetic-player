import assert from "node:assert/strict";
import test from "node:test";
import {
  alternateLoopbackHost,
  alternateLoopbackUrl,
} from "../src/api/loopback-origin";

void test("realtime traffic uses the alternate local origin", () => {
  assert.equal(alternateLoopbackHost("127.0.0.1"), "localhost");
  assert.equal(alternateLoopbackHost("localhost"), "127.0.0.1");
  assert.equal(
    alternateLoopbackUrl("127.0.0.1", 4310),
    "http://localhost:4310",
  );
  assert.equal(
    alternateLoopbackUrl("192.168.1.10", 4310),
    "http://192.168.1.10:4310",
  );
});
