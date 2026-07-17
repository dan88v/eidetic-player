import test from "node:test";
import assert from "node:assert/strict";
import { JsonLineParser } from "../src/player/json-line-parser.js";

void test("JSON line parser joins incomplete chunks", () => {
  const messages: unknown[] = [];
  const parser = new JsonLineParser((message) => messages.push(message));
  parser.push('{"request_id":');
  parser.push('1,"data":"ok"}\n');
  assert.deepEqual(messages, [{ request_id: 1, data: "ok" }]);
});

void test("JSON line parser emits multiple messages from one chunk", () => {
  const messages: unknown[] = [];
  const parser = new JsonLineParser((message) => messages.push(message));
  parser.push('{"event":"start-file"}\n{"event":"file-loaded"}\n');
  assert.deepEqual(messages, [
    { event: "start-file" },
    { event: "file-loaded" },
  ]);
});
