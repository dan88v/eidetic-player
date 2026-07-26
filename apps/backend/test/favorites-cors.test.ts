import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

void test("production loopback CORS permits Favorite PUT without widening origins", () => {
  const backend = readFileSync(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  const client = readFileSync(
    new URL("../../ui/src/api/library-api-client.ts", import.meta.url),
    "utf8",
  );

  assert.match(client, /addFavoriteTrack[\s\S]*?\{ method: "PUT" \}/);
  assert.match(
    backend,
    /"GET, POST, PUT, PATCH, DELETE, OPTIONS"/,
    "the production WebView preflight must permit the Favorite mutation verb",
  );
  assert.match(backend, /originUrl\.hostname === "127\.0\.0\.1"/);
  assert.match(backend, /originUrl\.hostname === "localhost"/);
  assert.doesNotMatch(backend, /access-control-allow-origin", "\*"/);
});
