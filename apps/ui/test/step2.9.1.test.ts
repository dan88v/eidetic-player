import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(path, "utf8");

void test("History exposes Recent, Most Played and Stats without a second stream", () => {
  const screen = read("apps/ui/src/screens/recently-played.ts");
  const client = read("apps/ui/src/api/library-api-client.ts");
  const service = read("apps/backend/src/library/library-service.ts");
  assert.match(screen, /type HistorySegment = "recent" \| "most" \| "stats"/);
  assert.match(screen, /createSegmentedControl<HistorySegment>/);
  assert.match(client, /\/api\/library\/history\/most-played/);
  assert.match(client, /\/api\/library\/history\/stats/);
  assert.match(screen, /snapshot\.statsRevision/);
  assert.match(service, /statsRevision \+= 1/);
  assert.doesNotMatch(screen, /EventSource|setInterval|requestAnimationFrame/);
});

void test("Queue drawer omits Favorite and overflow controls and keeps removal", () => {
  const drawer = read("apps/ui/src/components/queue-drawer.ts");
  const css = read("apps/ui/src/styles/components.css");
  assert.doesNotMatch(
    drawer,
    /createFavoriteTrackButton|queue-item__more|queue-favorite-menu/,
  );
  assert.doesNotMatch(css, /queue-item--favorite-capable|\.queue-item__more/);
  assert.match(drawer, /queue-item__remove/);
});

void test("global toast anchor follows the mini player and hidden toasts do not lay out", () => {
  const shell = read("apps/ui/src/components/app-shell.ts");
  const css = read("apps/ui/src/styles/components.css");
  assert.match(shell, /app-root--with-mini-player/);
  assert.match(css, /\.app-root--with-mini-player \.app-toast-host/);
  assert.match(
    css,
    /\.app-toast:not\(\.app-toast--visible\)[^{]*\{[^}]*display: none/s,
  );
});
