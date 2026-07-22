import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { historyGroupLabel } from "../src/screens/recently-played";

const read = (path: string): string => readFileSync(path, "utf8");
const routes = read("apps/ui/src/navigation/routes.ts");
const sideMenu = read("apps/ui/src/components/side-menu.ts");
const screen = read("apps/ui/src/screens/recently-played.ts");
const api = read("apps/ui/src/api/library-api-client.ts");
const backend = read("apps/backend/src/index.ts");
const service = read("apps/backend/src/library/library-service.ts");
const repository = read("apps/backend/src/library/library-repository.ts");

void test("Recently Played follows Favorites and Library visibility", () => {
  assert.ok(
    routes.indexOf('id: "favorites"') < routes.indexOf('id: "recentlyPlayed"'),
  );
  assert.ok(
    routes.indexOf('id: "recentlyPlayed"') < routes.indexOf('id: "folders"'),
  );
  assert.match(sideMenu, /data-screen="recentlyPlayed"/);
  assert.match(sideMenu, /recentlyPlayed\.hidden = value === "folders"/);
});

void test("history groups Today, Yesterday, and older local dates", () => {
  const now = new Date(2026, 6, 22, 12).getTime();
  assert.equal(historyGroupLabel(now, now), "Today");
  assert.equal(
    historyGroupLabel(new Date(2026, 6, 21, 23).getTime(), now),
    "Yesterday",
  );
  const older = historyGroupLabel(new Date(2026, 6, 18, 12).getTime(), now);
  assert.notEqual(older, "Today");
  assert.notEqual(older, "Yesterday");
});

void test("history UI is bounded, touch-row based, and has no Search", () => {
  assert.match(screen, /PAGE_SIZE = 48/);
  assert.match(screen, /MAX_RENDERED_ITEMS = 192/);
  assert.match(screen, /library-track-row recently-played-row/);
  assert.match(screen, /library-page-sentinel/);
  assert.match(screen, /createFavoriteTrackButton/);
  assert.doesNotMatch(screen, /type="search"|searchPlaceholder/i);
  assert.match(screen, /createSegmentedControl<HistorySegment>/);
  assert.match(screen, /recentlyPlayed\.emptyTitle/);
  assert.match(screen, /recentlyPlayed\.emptyText/);
});

void test("Play uses the complete history context while Add queues one Track", () => {
  assert.match(
    screen,
    /playRecentlyPlayed\(\{ selectedHistoryId: item\.historyId \}\)/,
  );
  assert.match(screen, /queue\(item\.id\)/);
  assert.match(api, /\/api\/library\/recently-played\/play/);
  assert.match(backend, /resolveRecentlyPlayed\(body\.selectedHistoryId\)/);
  assert.match(service, /playHistoryContextTracks\(\)/);
  assert.match(repository, /ROW_NUMBER\(\) OVER/);
  assert.match(repository, /PARTITION BY h\.track_id/);
});

void test("Remove and confirmed footer Clear mutate history only", () => {
  assert.match(screen, /recentlyPlayed\.remove/);
  assert.match(screen, /removeRecentlyPlayed\(historyId\)/);
  assert.match(screen, /recently-played-clear/);
  assert.match(screen, /queue-confirmation--open/);
  assert.match(screen, /clearRecentlyPlayed\(\)/);
  assert.match(backend, /clearPlayHistory\(\)/);
  assert.doesNotMatch(screen, /clearQueue|removeQueue|playerActions/);
});

void test("history refresh reuses Library SSE revision and adds no polling", () => {
  assert.match(screen, /snapshot\.historyRevision/);
  assert.match(service, /historyRevision \+= 1/);
  assert.doesNotMatch(screen, /EventSource|setInterval|requestAnimationFrame/);
  assert.doesNotMatch(backend, /recently-played\/events/);
});
