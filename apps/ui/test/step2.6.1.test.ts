import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  IndexedLibrarySnapshot,
  LibraryScanProgress,
} from "../../../packages/shared/src/library.js";
import { resolveLibraryToast } from "../src/components/toast-host.js";

const read = (path: string): Promise<string> =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

const [library, shell, sources, toast, componentsCss, screensCss, i18n] =
  await Promise.all([
    read("screens/library.ts"),
    read("components/app-shell.ts"),
    read("screens/sources.ts"),
    read("components/toast-host.ts"),
    read("styles/components.css"),
    read("styles/screens.css"),
    read("i18n/en.ts"),
  ]);

const scan: LibraryScanProgress = {
  scanId: "scan-1",
  sourceId: "source-1",
  sourceName: "Music",
  generation: 2,
  status: "scanning",
  filesDiscovered: 20,
  filesProcessed: 5,
  filesUnchanged: 1,
  filesNew: 3,
  filesModified: 1,
  filesUnavailable: 0,
  filesFailed: 0,
  totalFiles: 20,
  startedAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T10:00:01.000Z",
  completedAt: null,
  elapsedMilliseconds: 1_000,
  errorCode: null,
};

function snapshot(
  activeScan: LibraryScanProgress | null,
  latestScan: LibraryScanProgress | null,
  queuedSourceIds: readonly string[] = [],
): IndexedLibrarySnapshot {
  return {
    historyRevision: 0,
    summary: {
      trackCount: 0,
      availableTrackCount: 0,
      unavailableTrackCount: 0,
      albumCount: 0,
      artistCount: 0,
      sourceCount: 1,
      scanStatus: activeScan?.status ?? latestScan?.status ?? "idle",
      lastSuccessfulScan: null,
    },
    sources: [
      {
        sourceId: "source-1",
        displayName: "Music",
        availability: "available",
        firstScanCompleted: false,
        scanStatus: activeScan?.status ?? latestScan?.status ?? "idle",
        lastScanStarted: null,
        lastScanCompleted: null,
        lastSuccessfulScan: null,
        lastErrorCode: null,
        currentGeneration: 2,
        fileCount: 0,
        unavailableCount: 0,
      },
    ],
    status: {
      activeScan,
      latestScan,
      queuedSourceIds,
      recoveryNotice: null,
    },
  };
}

void test("Library root is browsing-only with Search and compact Manage actions", () => {
  const rootMarkup = library.slice(
    library.indexOf('<div class="library-root">'),
    library.indexOf('<div class="library-manage"'),
  );
  assert.doesNotMatch(rootMarkup, /library-summary|library-scan-panel/);
  assert.doesNotMatch(rootMarkup, /screen-header__description/);
  assert.doesNotMatch(
    rootMarkup,
    /library-scan-action|library-manage-scan-action/,
  );
  assert.match(rootMarkup, /library-search-action/);
  assert.match(rootMarkup, /library-manage-action/);
  assert.match(rootMarkup, /library-browser-toolbar/);
  assert.ok(
    rootMarkup.indexOf("library-browser-toolbar") <
      rootMarkup.indexOf("library-browser-content"),
  );
  assert.match(library, /busy \? "library\.cancel" : "library\.rescan"/);
  const manageMarkup = library.slice(
    library.indexOf('<div class="library-manage"'),
    library.indexOf('<div class="library-detail"'),
  );
  assert.match(manageMarkup, /library-manage-scan-action/);
});

void test("Manage Library reuses summary and detailed scan primitives", () => {
  const manageMarkup = library.slice(
    library.indexOf('<div class="library-manage"'),
    library.indexOf('<div class="library-detail"'),
  );
  assert.match(manageMarkup, /library-manage-back/);
  assert.match(manageMarkup, /library-summary/);
  assert.match(manageMarkup, /library-scan-panel/);
  assert.match(manageMarkup, /class="library-progress/);
  for (const field of [
    "discovered",
    "processed",
    "new",
    "modified",
    "unchanged",
    "unavailable",
    "errors",
    "elapsed",
  ])
    assert.match(manageMarkup, new RegExp(`data-library-stat="${field}"`));
  assert.match(library, /options\.setTitle\(t\("library\.manage"\)\)/);
  assert.doesNotMatch(manageMarkup, />Manage Library</);
});

void test("Manage navigation preserves Library route, view and scroll state", () => {
  assert.match(library, /let manageReturnRoute: LibraryRoute/);
  assert.match(library, /manageReturnScrollTop/);
  assert.match(library, /rootScrollTop = section\.parentElement\?\.scrollTop/);
  assert.match(
    library,
    /manageScrollTop = section\.parentElement\?\.scrollTop/,
  );
  assert.match(library, /route = manageReturnRoute/);
  assert.match(library, /loadLibrarySegment\(\)/);
  assert.match(library, /loadLibraryAlbumViewMode\(\)/);
  assert.match(library, /manageAction\.addEventListener\("click"/);
});

void test("Sources overview is operational without duplicating configuration", () => {
  assert.match(library, /library-sources-overview/);
  assert.match(library, /item\.fileCount/);
  assert.match(library, /item\.unavailableCount/);
  assert.match(library, /item\.lastSuccessfulScan/);
  assert.match(
    library,
    /options\.api[\s\S]{0,40}\.scan\(\{ sourceId: item\.sourceId \}\)/,
  );
  assert.match(library, /library-open-sources/);
  assert.match(
    library,
    /openSources\.addEventListener\("click", options\.openSources\)/,
  );
  assert.doesNotMatch(
    library,
    /sources\.rename|sources\.remove|addLocalFolder/,
  );
  assert.match(library, /current\.sources\.length === 0/);
});

void test("one global Library SSE feeds Library, Sources and the toast", () => {
  assert.match(shell, /libraryApi\.subscribe\(receiveLibrarySnapshot/);
  assert.match(shell, /currentScreen\?\.updateLibrarySnapshot\?\.\(snapshot\)/);
  assert.match(shell, /toastHost\.updateLibrary\(snapshot\)/);
  assert.doesNotMatch(library, /\.subscribe\(/);
  assert.doesNotMatch(sources, /\.subscribe\(/);
  assert.match(shell, /unsubscribeLibrary\(\)/);
  assert.match(shell, /appDestroyed/);
});

void test("scan progress is one keyed in-place notification", () => {
  assert.match(toast, /LIBRARY_SCAN_TOAST_KEY = "library-scan-progress"/);
  assert.equal((shell.match(/createToastHost\(/g) ?? []).length, 1);
  assert.match(toast, /host\.append\(transientToast, progressToast\)/);
  assert.match(toast, /progressToast\.dataset\.key = LIBRARY_SCAN_TOAST_KEY/);
  assert.match(toast, /progressToast\.classList\.add\("app-toast--visible"\)/);
  assert.doesNotMatch(toast, /append\(progressToast\)/);
  assert.match(componentsCss, /\.app-toast-host/);
  assert.match(componentsCss, /bottom: calc\(var\(--mini-player-height\)/);
});

void test("queued, scanning, cancelling and terminal states share the toast", () => {
  for (const key of [
    "preparing",
    "scanning",
    "cancelling",
    "completed",
    "cancelled",
    "failed",
  ])
    assert.match(toast, new RegExp(`library\\.toast\\.${key}`));
  assert.match(toast, /scan\.totalFiles !== null && scan\.totalFiles > 0/);
  assert.match(toast, /progress\.removeAttribute\("value"\)/);
  assert.match(toast, /lastProgressValue/);
  assert.match(toast, /TERMINAL_DURATION_MS = 2_500/);
  assert.match(
    toast,
    /if \(!failure\)[\s\S]*setTimeout\([\s\S]*\(\) => \{[\s\S]*hideProgress\(\)/,
  );
  assert.match(toast, /createDismissButton\(dismissProgress\)/);
  assert.doesNotMatch(toast, /data-toast-action/);
});

void test("scan toast state resolution ignores idle and old terminal bootstrap state", () => {
  assert.deepEqual(resolveLibraryToast(snapshot(null, null), "", false), {
    kind: "idle",
  });
  assert.deepEqual(
    resolveLibraryToast(snapshot(null, null, ["source-1"]), "", false),
    { kind: "queued", sourceName: "Music" },
  );
  assert.deepEqual(resolveLibraryToast(snapshot(scan, scan), "", false), {
    kind: "active",
    scan,
  });
  const completed = {
    ...scan,
    status: "completed" as const,
    completedAt: "2026-07-21T10:00:02.000Z",
  };
  assert.deepEqual(resolveLibraryToast(snapshot(null, completed), "", false), {
    kind: "idle",
  });
  assert.deepEqual(
    resolveLibraryToast(snapshot(null, completed), "scan-1:source-1:2", true),
    { kind: "terminal", scan: completed },
  );
});

void test("toast updates are bounded and teardown cancels every callback", () => {
  assert.match(toast, /LIBRARY_TOAST_UPDATE_INTERVAL_MS = 250/);
  assert.match(toast, /pendingSnapshot/);
  assert.match(toast, /coalesceTimer/);
  assert.doesNotMatch(toast, /setInterval/);
  assert.match(toast, /window\.clearTimeout\(coalesceTimer\)/);
  assert.match(toast, /window\.clearTimeout\(terminalTimer\)/);
  assert.match(toast, /window\.clearTimeout\(transientTimer\)/);
  const libraryReceiver = shell.slice(
    shell.indexOf("const receiveLibrarySnapshot"),
    shell.indexOf("let unsubscribeLibrary"),
  );
  assert.doesNotMatch(libraryReceiver, /scheduleInactivity\(\)/);
});

void test("scan toast only adds dismiss while Library owns management", () => {
  assert.match(toast, /className = "app-toast__dismiss"/);
  assert.doesNotMatch(toast, /data-toast-action|onManageLibrary/);
  assert.doesNotMatch(componentsCss, /app-toast__actions/);
  assert.doesNotMatch(shell, /openManageOnLibraryMount|openLibraryManage/);
  assert.match(library, /library-manage-action/);
});

void test("Manage and progress surfaces retain touch and responsive contracts", () => {
  assert.match(
    screensCss,
    /\.library-manage-action,[\s\S]*min-height: var\(--touch-min\)/,
  );
  assert.match(
    screensCss,
    /\.library-source-overview[\s\S]*min-height: 6\.5rem/,
  );
  assert.match(
    componentsCss,
    /\.app-toast--progress[\s\S]*min-height: 8\.5rem/,
  );
  assert.match(componentsCss, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(i18n, /"library\.progressIndeterminate"/);
  assert.match(toast, /aria-valuetext/);
});
