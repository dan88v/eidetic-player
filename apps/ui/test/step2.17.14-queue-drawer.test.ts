import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  ExplicitQueueItem,
  PlayerState,
  PublicPlaybackItem,
  QueueItem,
} from "../../../packages/shared/src/player.js";
import { queueDrawerPresentation } from "../src/components/queue-drawer-model.js";

const read = (path: string): string => readFileSync(path, "utf8");

const publicItem: PublicPlaybackItem = {
  filename: "duplicate.flac",
  displayTitle: "Duplicate",
  artist: "Artist",
  album: "Album",
  artwork: null,
  available: true,
  libraryTrackId: "track-duplicate",
};

function explicit(id: string, index: number): ExplicitQueueItem {
  return {
    explicitQueueEntryId: id,
    playbackInstanceId: `playback-item-${id}`,
    index,
    item: publicItem,
  };
}

function legacyItem(id: string, index: number, isCurrent = false): QueueItem {
  return {
    id,
    index,
    path: `/technical/${id}.flac`,
    filename: `${id}.flac`,
    displayTitle: id,
    artwork: null,
    isCurrent,
    available: true,
    libraryTrackId: `track-${id}`,
  };
}

function playerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    playerSessionId: "session-test",
    trackTransitionId: 1,
    status: "playing",
    mpvAvailable: true,
    mpvVersion: "test",
    currentTrack: null,
    positionSeconds: 0,
    durationSeconds: 180,
    paused: false,
    volume: 70,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    currentQueueIndex: -1,
    queue: [],
    queueRevision: 0,
    audioDevice: "auto",
    error: null,
    ...overrides,
  };
}

void test("authoritative drawer state separates Current and preserves duplicate explicit occurrences", () => {
  const first = explicit("explicit-first", 0);
  const second = explicit("explicit-second", 1);
  const presentation = queueDrawerPresentation(
    playerState({
      queue: [legacyItem("technical-current", 0, true)],
      currentQueueIndex: 0,
      currentPlayback: {
        playbackInstanceId: "playback-item-current",
        source: "context",
        relationId: "context-item-current",
        contextId: "context-album",
        historyEntryId: "history-current",
        startedSequence: 1,
        item: { ...publicItem, displayTitle: "Current" },
      },
      explicitQueue: [first, second],
      playbackContext: {
        contextId: "context-album",
        kind: "album",
        entityId: "album-id",
        title: "Album context",
        sourceLabel: "Library",
        nextItem: { ...publicItem, displayTitle: "Context next" },
        remainingCount: 8,
        totalCount: 10,
        cycle: 0,
      },
      playbackContinuation: {
        mode: "same-artist",
        artistId: "artist-id",
        artistName: "Artist",
        active: false,
      },
    }),
  );

  assert.equal(presentation.authoritative, true);
  assert.equal(presentation.current?.displayTitle, "Current");
  assert.deepEqual(
    presentation.explicitQueue.map((item) => item.id),
    ["explicit-first", "explicit-second"],
  );
  assert.equal(
    new Set(presentation.explicitQueue.map((item) => item.id)).size,
    2,
  );
  assert.deepEqual(
    presentation.explicitQueue.map((item) => item.libraryTrackId),
    ["track-duplicate", "track-duplicate"],
  );
  assert.equal(presentation.context?.nextItem?.displayTitle, "Context next");
  assert.equal(presentation.continuation?.artistName, "Artist");
  const firstPresentationItem = presentation.explicitQueue[0];
  assert.ok(firstPresentationItem);
  assert.equal("path" in firstPresentationItem, false);
});

void test("legacy Queue is a compatibility fallback and excludes Current and past items", () => {
  const presentation = queueDrawerPresentation(
    playerState({
      currentQueueIndex: 1,
      queue: [
        legacyItem("past", 0),
        legacyItem("current", 1, true),
        legacyItem("future-a", 2),
        legacyItem("future-b", 3),
      ],
    }),
  );

  assert.equal(presentation.authoritative, false);
  assert.equal(presentation.current?.id, "current");
  assert.deepEqual(
    presentation.explicitQueue.map((item) => item.id),
    ["future-a", "future-b"],
  );
  assert.deepEqual(
    presentation.explicitQueue.map((item) => item.index),
    [0, 1],
  );
});

void test("Queue drawer renders the three bounded sections without making Current actionable", () => {
  const drawer = read("apps/ui/src/components/queue-drawer.ts");
  const currentMarkup = drawer.slice(
    drawer.indexOf('class="queue-section queue-section--current"'),
    drawer.indexOf('class="queue-section__heading"'),
  );

  assert.match(drawer, /t\("queueDrawer\.nowPlaying"\)/);
  assert.match(drawer, /t\("queueDrawer\.upNext"\)/);
  assert.match(drawer, /t\("queueDrawer\.thenContinuesFrom"\)/);
  assert.match(drawer, /presentation\.context/);
  assert.match(drawer, /context\.nextItem\.displayTitle/);
  assert.match(drawer, /queue-context__remove/);
  assert.match(drawer, /queue-context__details/);
  assert.match(drawer, /queue-context__summary/);
  assert.match(drawer, /queueDrawer\.removeContextAction/);
  assert.match(drawer, /options\.onClearContext/);
  assert.doesNotMatch(
    drawer.slice(
      drawer.indexOf('class="queue-section queue-context"'),
      drawer.indexOf('class="queue-section queue-continuation"'),
    ),
    /icon\("close"\)/,
  );
  assert.match(drawer, /Math\.min\(rawRemaining, 9_999\)/);
  assert.doesNotMatch(currentMarkup, /queue-item__handle|queue-item__remove/);
  assert.match(drawer, /currentRow\.setAttribute\("aria-current", "true"\)/);
  assert.doesNotMatch(
    drawer,
    /context\.originalItems|playbackHistory\.entries/,
  );
});

void test("badge, footer actions, selection and keyed rows use only Explicit Queue IDs", () => {
  const drawer = read("apps/ui/src/components/queue-drawer.ts");

  assert.match(drawer, /explicitQueue = presentation\.explicitQueue/);
  assert.match(drawer, /const explicitCount = explicitQueue\.length/);
  assert.match(drawer, /clearRow\.hidden = explicitCount === 0/);
  assert.match(
    drawer,
    /explicitQueue\.some\(\(item\) => !item\.libraryTrackId\)/,
  );
  assert.match(
    drawer,
    /const nextIds = explicitQueue\.map\(\(item\) => item\.id\)/,
  );
  assert.match(drawer, /rowViews\.get\(item\.id\)/);
  assert.match(drawer, /options\.onPlay\(index, queueItemId\)/);
  assert.match(drawer, /options\.onRemove\(item\.id\)/);
  assert.match(drawer, /onReorder\(item\.id, toIndex\)/);
  assert.doesNotMatch(drawer, /for \(const item of state\.queue\)/);
});

void test("copy and summaries match the Step 2.17.14 contract", () => {
  const translations = read("apps/ui/src/i18n/en.ts");

  assert.match(
    translations,
    /"queueDrawer\.empty": "No songs added to the queue\."/,
  );
  assert.match(
    translations,
    /"queueDrawer\.sameArtist": "Continues with tracks by \{artist\}\."/,
  );
  assert.match(
    translations,
    /Only future songs added to Up Next will be removed\./,
  );
  assert.match(
    translations,
    /"queueDrawer\.removeContext": "Remove playback context"/,
  );
  assert.match(translations, /"queueDrawer\.removeContextAction": "Remove"/);
});

void test("touch scrolling, cancellation, autoscroll and mounted reconciliation remain intact", () => {
  const drawer = read("apps/ui/src/components/queue-drawer.ts");
  const styles = read("apps/ui/src/styles/components.css");

  assert.match(drawer, /createReliableTouchScroller\(list\)/);
  assert.match(drawer, /setPointerCapture/);
  assert.match(drawer, /pointercancel/);
  assert.match(drawer, /queueAutoScrollStep/);
  assert.match(drawer, /requestAnimationFrame\(autoScroll\)/);
  assert.match(drawer, /queueStructureChanged\(queueIds, nextIds\)/);
  assert.match(drawer, /rowViews = new Map<string, QueueRowView>\(\)/);
  assert.doesNotMatch(drawer, /list\.replaceChildren/);
  assert.match(
    styles,
    /\.queue-list\s*\{[^}]*overflow-y: auto;[^}]*touch-action: pan-y;/s,
  );
});

void test("drawer geometry remains bounded at the required local viewports", () => {
  const styles = read("apps/ui/src/styles/components.css");

  assert.match(
    styles,
    /\.queue-drawer\s*\{[^}]*width: min\(29rem, 92vw\);[^}]*overflow: hidden;/s,
  );
  assert.match(
    styles,
    /\.queue-current\s*\{[^}]*grid-template-columns: var\(--touch-small\) minmax\(0, 1fr\);/s,
  );
  assert.match(
    styles,
    /\.queue-context__card\s*\{[^}]*min-width: 0;[^}]*gap: var\(--space-2\);/s,
  );
  assert.match(
    styles,
    /\.queue-context__details\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*align-items: center;[^}]*gap: var\(--space-3\);/s,
  );
  assert.match(
    styles,
    /\.queue-context__summary\s*\{[^}]*min-width: 0;[^}]*gap: var\(--space-1\);/s,
  );
  assert.match(
    styles,
    /\.queue-context__remove\s*\{[^}]*min-height: var\(--touch-small\);[^}]*background: rgb\(226 87 87 \/ 10%\);[^}]*color: #f08a8a;/s,
  );
});
