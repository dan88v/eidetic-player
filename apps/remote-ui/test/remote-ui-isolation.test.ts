import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  formatRemoteAlbumCount,
  formatRemoteTrackCount,
  mergeRemotePlayerProgress,
  remotePlaybackContextKindLabel,
  remoteLibraryRecordDetail,
  remotePlayerDisplay,
  remotePlayerPresentationChanged,
  RemotePlayerStateCoordinator,
  remotePlayerTrackKey,
  remoteQueuePresentationChanged,
  remoteSameArtistSummary,
} from "../src/player-presentation.js";
import { LatestRequestCoordinator } from "../src/latest-request-coordinator.js";
import type { RemotePlayerState } from "../../../packages/shared/src/remote-access.js";

const root = resolve(import.meta.dirname, "..");

void test("Remote UI is standalone and never imports the appliance UI", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
  assert.doesNotMatch(source, /apps\/ui|components\/app-shell|now-playing/iu);
  assert.doesNotMatch(styles, /apps\/ui|\.app-shell|\.top-bar/iu);
  assert.match(source, /new EventSource\("\/api\/events"/u);
  assert.equal((source.match(/new EventSource/gu) ?? []).length, 1);
  assert.match(source, /visibilitychange/u);
  assert.match(source, /stream\?\.close\(\)/u);
  assert.match(source, /envelope\.type === "snapshot"/u);
  assert.match(
    source,
    /playerStateCoordinator\.acceptEvent\(\s*snapshot\.player,/u,
  );
  assert.match(source, /"player-progress"/u);
  assert.match(source, /bootstrapRequests\.run/u);
  assert.match(source, /deferUnauthorized: true/u);
});

void test("Remote UI has no PWA, credential storage, visualizer, or custom keyboard", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const html = await readFile(resolve(root, "index.html"), "utf8");
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "serviceWorker",
    "WebSocket",
    "visualizer",
    "fft",
    "manifest.webmanifest",
  ])
    assert.doesNotMatch(`${source}\n${html}`, new RegExp(forbidden, "iu"));
  assert.doesNotMatch(html, /rel=["']manifest/iu);
  assert.match(source, /inputMode = "search"/u);
  assert.match(source, /inputMode = "numeric"/u);
});

void test("Remote UI exposes exactly four portrait destinations and safe-area layout", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
  for (const destination of ["Player", "Library", "Browse", "Queue"])
    assert.match(source, new RegExp(`"${destination}"`, "u"));
  assert.match(styles, /env\(safe-area-inset-bottom\)/u);
  assert.match(styles, /overflow-x: hidden/u);
  assert.match(styles, /min-height: 44px/u);
  assert.match(styles, /width: min\(100%, 540px\)/u);
  assert.match(styles, /remote-content--player/u);
  assert.match(styles, /grid-template-rows: minmax\(0, 1fr\) auto auto/u);
});

void test("Remote UI keeps wake separate, confirms clear, and rolls back touch reorder", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  assert.match(source, /runAction\("\/api\/display\/wake"\)/u);
  assert.match(
    source,
    /runCommand\("\/api\/queue\/clear", \{ confirm: true \}\)/u,
  );
  assert.match(source, /pointercancel/u);
  assert.match(source, /pointermove/u);
  assert.match(source, /releasePointerCapture/u);
  assert.match(source, /remote-queue-row--drop-target/u);
  assert.match(source, /previousPlayer/u);
  assert.match(source, /"\/api\/library\/queue"/u);
  assert.match(source, /nextCursor/u);
  assert.match(source, /Load more/u);
});

void test("Remote Context play mirrors the essential revision-bound Queue decision", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
  for (const label of [
    "Up Next isn't empty",
    "Clear it before playing this selection?",
    "Keep Up Next",
    "Clear & Play",
  ])
    assert.ok(source.includes(label));
  assert.match(source, /bootstrap\.player\.explicitQueue\.length === 0/u);
  assert.match(source, /expectedQueueRevision: revision/u);
  assert.match(source, /body = \{ \.\.\.body, \.\.\.queueDecision \}/u);
  assert.match(source, /"\/api\/library\/most-played\/play"/u);
  assert.match(
    styles,
    /\.remote-queue-decision__close[\s\S]*width: 44px;[\s\S]*height: 44px;/u,
  );
});

void test("Remote Queue renders only Current and future explicit entries", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
  for (const label of [
    "Now Playing",
    "Up Next",
    "Then continues from",
    "Same artist",
    "No songs added to the queue.",
  ])
    assert.match(source, new RegExp(label, "u"));
  assert.match(source, /const explicitCount = state\.explicitQueue\.length/u);
  assert.match(source, /explicitQueueEntryId/u);
  assert.match(source, /data-explicit-queue-count/u);
  assert.match(source, /remoteQueuePresentationChanged\(previous, next\)/u);
  assert.match(source, /runCommand\("\/api\/context\/clear"\)/u);
  assert.match(styles, /\.remote-queue-summary__remove/u);
  assert.doesNotMatch(source, /currentQueueIndex/u);
  assert.doesNotMatch(source, /(?:state|bootstrap\.player)\.queue\.length/u);

  const currentRowSource = source.slice(
    source.indexOf("function currentPlaybackRow"),
    source.indexOf("function explicitQueueRow"),
  );
  assert.doesNotMatch(
    currentRowSource,
    /remote-reorder-handle|\/api\/queue\/(?:play|remove)/u,
  );
  assert.match(
    currentRowSource,
    /artworkId[\s\S]*\/api\/artwork\/player\/[\s\S]*\/api\/artwork\/queue\/[\s\S]*current\.playbackInstanceId/u,
  );
  const explicitRowSource = source.slice(
    source.indexOf("function explicitQueueRow"),
    source.indexOf("function compatibilityQueue"),
  );
  assert.match(
    explicitRowSource,
    /\/api\/artwork\/queue\/[\s\S]*entry\.explicitQueueEntryId/u,
  );
  assert.doesNotMatch(explicitRowSource, /item\.artwork\s*\?/u);
  const queueArtworkSource = source.slice(
    source.indexOf("function queueArtwork"),
    source.indexOf("function explicitQueueRow"),
  );
  assert.match(queueArtworkSource, /image\.loading = "lazy"/u);
  assert.doesNotMatch(
    `${currentRowSource}\n${explicitRowSource}`,
    /(?:nativePath|item\.path)\b/u,
  );
  assert.match(styles, /\.remote-queue-sections/u);
  assert.match(styles, /\.remote-queue-summary/u);
  assert.match(styles, /\.remote-nav-item__badge/u);
});

void test("Remote Queue keeps bounded touch geometry from 320px through 430px", async () => {
  const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
  assert.match(styles, /body\s*\{[\s\S]*min-width: 320px/u);
  assert.match(
    styles,
    /\.remote-queue-row,[\s\S]*min-width: 0;[\s\S]*min-height: 64px/u,
  );
  assert.match(
    styles,
    /\.remote-queue-row__artwork\s*\{[\s\S]*width: 48px;[\s\S]*height: 48px/u,
  );
  assert.match(
    styles,
    /@media \(max-width: 374px\)[\s\S]*\.remote-content\s*\{[\s\S]*padding-inline: 12px/u,
  );
  assert.match(
    styles,
    /\.remote-reorder-handle\s*\{[\s\S]*touch-action: none/u,
  );
});

void test("Remote Player mirrors the appliance transport and hides fixed volume", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const styles = await readFile(resolve(root, "src/styles.css"), "utf8");
  assert.match(source, /remote-header__brand", "Eidetic Player"/u);
  assert.match(source, /setRemoteIcon\(shuffle, "shuffle"\)/u);
  assert.match(source, /setRemoteIcon\(repeat, "repeat"\)/u);
  assert.match(
    source,
    /transport\.append\(shuffle, previous, play, next, repeat\)/u,
  );
  assert.match(source, /outputLevelMode !== "fixed"/u);
  assert.doesNotMatch(source, /Fixed 100%/u);
  assert.match(styles, /\.remote-round-button--mode/u);
  assert.match(
    styles,
    /\.remote-round-button--mode\s*\{[\s\S]*color: #f6f8fc;/u,
  );
  assert.match(
    styles,
    /\.remote-round-button:disabled\s*\{[\s\S]*color: #738096;/u,
  );
  assert.match(styles, /\.remote-header__action\s*\{[\s\S]*border:/u);
  assert.match(source, /mini\.hidden = destination === "player"/u);
  assert.match(source, /setPointerCapture/u);
  assert.match(source, /if \(activeSeek\) return/u);
  assert.match(source, /remote-player__controls/u);
  assert.match(
    source,
    /next\.dataset\.commandAvailable = String\(state\.canGoNext\)/u,
  );
});

void test("Remote Player keeps position ticks incremental during seek", () => {
  const playbackItem = {
    filename: "track.flac",
    displayTitle: "Track",
    artist: "Artist",
    album: "Album",
    durationSeconds: 100,
    artwork: null,
    available: true,
    libraryTrackId: "track-11111111111111111111111111111111",
  } as const;
  const player = {
    playerSessionId: "player-session-a",
    playbackPlanRevision: 1,
    trackTransitionId: 1,
    status: "playing",
    mpvAvailable: true,
    paused: false,
    volume: 50,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    currentTrack: {
      title: "Track",
      filename: "track.flac",
      artist: "Artist",
      album: "Album",
      artwork: null,
    },
    currentPlayback: {
      playbackInstanceId: "playback-current",
      source: "context",
      relationId: "context-item-1",
      contextId: "context-1",
      historyEntryId: "history-1",
      startedSequence: 1,
      item: playbackItem,
    },
    explicitQueue: [
      {
        explicitQueueEntryId: "explicit-1",
        playbackInstanceId: "playback-explicit-1",
        index: 0,
        item: playbackItem,
      },
    ],
    playbackContext: {
      contextId: "context-1",
      kind: "album",
      entityId: "album-11111111111111111111111111111111",
      title: "Album",
      sourceLabel: "Library",
      nextItem: playbackItem,
      remainingCount: 4,
      totalCount: 8,
      cycle: 0,
    },
    playbackHistory: {
      entryCount: 1,
      cursor: 0,
      canGoBack: false,
      canGoForward: false,
    },
    playbackContinuation: {
      mode: "same-artist",
      artistId: "artist-11111111111111111111111111111111",
      artistName: "Artist",
      active: false,
    },
    queue: [
      {
        id: "explicit-1",
        index: 0,
        filename: "track.flac",
        displayTitle: "Track",
        artwork: null,
        isCurrent: false,
      },
    ],
    queueRevision: 1,
    contextRevision: 1,
    positionSeconds: 10,
    durationSeconds: 100,
    error: null,
  } as unknown as RemotePlayerState;
  assert.equal(remotePlayerTrackKey(player), "playback-current");
  assert.equal(remotePlayerDisplay(player).title, "Track");
  assert.equal(
    remoteSameArtistSummary(player),
    "Continues with tracks by Artist.",
  );
  assert.equal(
    remoteSameArtistSummary({
      ...player,
      playbackContinuation: {
        ...player.playbackContinuation,
        artistId: null,
      },
    }),
    null,
  );
  assert.equal(
    remotePlayerPresentationChanged(player, {
      ...player,
      positionSeconds: 11,
    }),
    false,
  );
  assert.equal(
    remoteQueuePresentationChanged(player, {
      ...player,
      positionSeconds: 11,
    }),
    false,
  );
  const progressMerged = mergeRemotePlayerProgress(player, {
    playerSessionId: player.playerSessionId,
    playbackPlanRevision: player.playbackPlanRevision,
    trackTransitionId: player.trackTransitionId,
    status: player.status,
    mpvAvailable: player.mpvAvailable,
    positionSeconds: 12,
    durationSeconds: player.durationSeconds,
    paused: player.paused,
    volume: player.volume,
    muted: player.muted,
    shuffleEnabled: player.shuffleEnabled,
    repeatMode: player.repeatMode,
    error: player.error,
  });
  assert.equal(progressMerged.positionSeconds, 12);
  assert.equal(progressMerged.explicitQueue, player.explicitQueue);
  assert.equal(progressMerged.playbackContext, player.playbackContext);
  assert.equal(remoteQueuePresentationChanged(player, progressMerged), false);
  assert.equal(
    mergeRemotePlayerProgress(player, {
      ...progressMerged,
      playerSessionId: "obsolete-session",
      positionSeconds: 99,
    }),
    player,
  );
  assert.equal(
    remotePlayerPresentationChanged(player, { ...player, paused: true }),
    true,
  );
  assert.equal(
    remoteQueuePresentationChanged(player, { ...player, paused: true }),
    false,
  );
  assert.equal(
    remoteQueuePresentationChanged(player, {
      ...player,
      queueRevision: 2,
    }),
    true,
  );
  assert.equal(
    remoteQueuePresentationChanged(player, {
      ...player,
      contextRevision: 2,
    }),
    true,
  );
  assert.equal(
    remoteQueuePresentationChanged(player, {
      ...player,
      explicitQueue: player.explicitQueue.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              item: {
                ...entry.item,
                artwork: {
                  id: "future-artwork",
                  mimeType: "image/jpeg",
                  sourceType: "embedded",
                  revision: "2",
                },
              },
            }
          : entry,
      ),
    }),
    true,
  );
  assert.equal(
    remoteQueuePresentationChanged(player, {
      ...player,
      explicitQueue: player.explicitQueue.map((entry) => ({
        ...entry,
        item: { ...entry.item },
      })),
    }),
    false,
  );
});

void test("Remote player rejects late HTTP state and mismatched progress after a newer SSE", () => {
  const base = {
    playerSessionId: "player-session-a",
    playbackPlanRevision: 4,
    trackTransitionId: 7,
    status: "playing",
    mpvAvailable: true,
    canGoNext: true,
    currentTrack: null,
    currentPlayback: {
      playbackInstanceId: "playback-a",
      source: "context",
      relationId: "context-a",
      contextId: "context",
      historyEntryId: null,
      startedSequence: 4,
      item: {
        filename: "a.flac",
        displayTitle: "A",
        artist: null,
        album: null,
        durationSeconds: 100,
        artwork: null,
        available: true,
        libraryTrackId: null,
      },
    },
    explicitQueue: [],
    playbackContext: null,
    playbackHistory: {
      entryCount: 1,
      cursor: 0,
      canGoBack: false,
      canGoForward: false,
    },
    playbackContinuation: {
      mode: "off",
      artistId: null,
      artistName: null,
      active: false,
    },
    contextRevision: 2,
    queue: [],
    queueRevision: 3,
    positionSeconds: 10,
    durationSeconds: 100,
    paused: false,
    volume: 50,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    error: null,
  } satisfies RemotePlayerState;
  const next = {
    ...base,
    playbackPlanRevision: 5,
    trackTransitionId: 8,
    positionSeconds: 2,
    currentPlayback: {
      ...base.currentPlayback,
      playbackInstanceId: "playback-b",
      relationId: "context-b",
      startedSequence: 5,
      item: {
        ...base.currentPlayback.item,
        filename: "b.flac",
        displayTitle: "B",
      },
    },
  } satisfies RemotePlayerState;
  const coordinator = new RemotePlayerStateCoordinator();
  coordinator.reset(base, 40);
  const pendingHttp = coordinator.beginHttpRequest();
  assert.equal(coordinator.acceptEvent(next, 41), next);
  assert.equal(
    coordinator.acceptHttp(
      { ...base, currentPlayback: null, positionSeconds: 0 },
      pendingHttp,
    ),
    null,
  );
  assert.equal(
    coordinator.acceptProgress(
      {
        playerSessionId: base.playerSessionId,
        playbackPlanRevision: base.playbackPlanRevision,
        trackTransitionId: base.trackTransitionId,
        status: "playing",
        mpvAvailable: true,
        positionSeconds: 78,
        durationSeconds: 100,
        paused: false,
        volume: 50,
        muted: false,
        shuffleEnabled: false,
        repeatMode: "off",
        error: null,
      },
      42,
    ),
    null,
  );
  const progressed = coordinator.acceptProgress(
    {
      playerSessionId: next.playerSessionId,
      playbackPlanRevision: next.playbackPlanRevision,
      trackTransitionId: next.trackTransitionId,
      status: "playing",
      mpvAvailable: true,
      positionSeconds: 12,
      durationSeconds: 100,
      paused: false,
      volume: 50,
      muted: false,
      shuffleEnabled: false,
      repeatMode: "off",
      error: null,
    },
    43,
  );
  assert.ok(progressed?.currentPlayback);
  assert.equal(progressed.currentPlayback.item.displayTitle, "B");
  assert.equal(progressed.positionSeconds, 12);
  assert.equal(coordinator.acceptEvent(base, 42), null);
  assert.equal(
    coordinator.acceptEvent(
      { ...base, currentPlayback: null, positionSeconds: 0 },
      44,
    ),
    null,
  );
});

void test("Remote renders a new authoritative Current while observed track enrichment is pending", () => {
  const artworkA = {
    id: "artwork-a",
    mimeType: "image/jpeg",
    sourceType: "embedded",
    revision: "a",
  } as const;
  const artworkB = {
    id: "artwork-b",
    mimeType: "image/jpeg",
    sourceType: "embedded",
    revision: "b",
  } as const;
  const observedA = {
    filename: "a.flac",
    title: "A",
    artist: "Artist A",
    album: "Album A",
    artists: ["Artist A"],
    albumArtist: null,
    trackNumber: 1,
    trackTotal: 2,
    discNumber: 1,
    discTotal: 1,
    year: 2026,
    genre: [],
    durationSeconds: 100,
    format: "FLAC",
    codec: "flac",
    sampleRate: 44_100,
    bitDepth: 16,
    bitrate: 900_000,
    lossless: true,
    container: "FLAC",
    artwork: artworkA,
    source: "Local File",
  } as const;
  const previous = {
    playerSessionId: "player-session-transition",
    playbackPlanRevision: 10,
    trackTransitionId: 20,
    status: "playing",
    mpvAvailable: true,
    canGoNext: true,
    currentTrack: observedA,
    currentPlayback: {
      playbackInstanceId: "playback-a",
      source: "context",
      relationId: "context-a",
      contextId: "context",
      historyEntryId: null,
      startedSequence: 10,
      item: {
        filename: "a.flac",
        displayTitle: "A",
        artist: "Artist A",
        album: "Album A",
        durationSeconds: 100,
        artwork: artworkA,
        available: true,
        libraryTrackId: null,
      },
    },
    explicitQueue: [],
    playbackContext: null,
    playbackHistory: {
      entryCount: 1,
      cursor: 0,
      canGoBack: false,
      canGoForward: false,
    },
    playbackContinuation: {
      mode: "off",
      artistId: null,
      artistName: null,
      active: false,
    },
    contextRevision: 4,
    queue: [],
    queueRevision: 2,
    positionSeconds: 91,
    durationSeconds: 100,
    paused: false,
    volume: 50,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    error: null,
  } satisfies RemotePlayerState;
  const pendingEnrichment = {
    ...previous,
    playbackPlanRevision: 11,
    currentTrack: null,
    currentPlayback: {
      ...previous.currentPlayback,
      playbackInstanceId: "playback-b",
      relationId: "context-b",
      startedSequence: 11,
      item: {
        ...previous.currentPlayback.item,
        filename: "b.flac",
        displayTitle: "B",
        artist: "Artist B",
        album: "Album B",
        artwork: artworkB,
      },
    },
    positionSeconds: 0,
  } satisfies RemotePlayerState;
  const coordinator = new RemotePlayerStateCoordinator();
  coordinator.reset(previous, 100);
  const acceptedPending = coordinator.acceptEvent(pendingEnrichment, 101);
  assert.ok(acceptedPending);
  assert.deepEqual(remotePlayerDisplay(acceptedPending), {
    title: "B",
    artist: "Artist B",
    album: "Album B",
    artwork: artworkB,
    hasCurrent: true,
  });

  const observedB = {
    ...observedA,
    filename: "b.flac",
    title: "B",
    artist: "Artist B",
    album: "Album B",
    artists: ["Artist B"],
    artwork: artworkB,
  } as const;
  const settled = coordinator.acceptEvent(
    {
      ...pendingEnrichment,
      trackTransitionId: 21,
      currentTrack: observedB,
      positionSeconds: 0.08,
    },
    102,
  );
  assert.ok(settled);
  assert.equal(remotePlayerDisplay(settled).title, "B");
  assert.equal(remotePlayerDisplay(settled).artwork, artworkB);
});

void test("Remote player accepts only the newest concurrent HTTP response", () => {
  const player = {
    playerSessionId: "player-session-a",
    playbackPlanRevision: 1,
    trackTransitionId: 1,
    queueRevision: 0,
    contextRevision: 0,
    currentPlayback: null,
  } as unknown as RemotePlayerState;
  const coordinator = new RemotePlayerStateCoordinator();
  coordinator.reset(player, 1);
  const first = coordinator.beginHttpRequest();
  const second = coordinator.beginHttpRequest();
  assert.equal(coordinator.acceptHttp({ ...player, volume: 25 }, first), null);
  assert.equal(
    coordinator.acceptHttp({ ...player, volume: 75 }, second)?.volume,
    75,
  );
});

void test("Remote progress merges onto the optimistic Queue snapshot", () => {
  const player = {
    playerSessionId: "player-session-queue",
    playbackPlanRevision: 3,
    trackTransitionId: 5,
    queueRevision: 7,
    contextRevision: 2,
    currentPlayback: null,
    explicitQueue: [
      { explicitQueueEntryId: "explicit-a", index: 0 },
      { explicitQueueEntryId: "explicit-b", index: 1 },
    ],
    queue: [
      { id: "explicit-a", index: 0 },
      { id: "explicit-b", index: 1 },
    ],
  } as unknown as RemotePlayerState;
  const coordinator = new RemotePlayerStateCoordinator();
  coordinator.reset(player, 10);
  const optimistic = coordinator.replaceLocal({
    ...player,
    explicitQueue: [...player.explicitQueue].reverse(),
    queue: [...player.queue].reverse(),
  });
  assert.ok(optimistic);
  const pendingHttp = coordinator.beginHttpRequest();
  const progressed = coordinator.acceptProgress(
    {
      playerSessionId: player.playerSessionId,
      playbackPlanRevision: player.playbackPlanRevision,
      trackTransitionId: player.trackTransitionId,
      status: "playing",
      mpvAvailable: true,
      positionSeconds: 12,
      durationSeconds: 100,
      paused: false,
      volume: 50,
      muted: false,
      shuffleEnabled: false,
      repeatMode: "off",
      error: null,
    },
    11,
  );
  assert.deepEqual(
    progressed?.explicitQueue.map((entry) => entry.explicitQueueEntryId),
    ["explicit-b", "explicit-a"],
  );
  assert.equal(coordinator.isCurrent(pendingHttp), false);
  assert.equal(coordinator.isLatestHttpRequest(pendingHttp), true);
  assert.ok(progressed);
  const rolledBack = coordinator.replaceLocal({
    ...progressed,
    explicitQueue: player.explicitQueue,
    queue: player.queue,
  });
  assert.ok(rolledBack);
  assert.deepEqual(
    rolledBack.explicitQueue.map((entry) => entry.explicitQueueEntryId),
    ["explicit-a", "explicit-b"],
  );
  assert.equal(rolledBack.positionSeconds, 12);
});

void test("Remote bootstrap applies only the latest deferred outcome", async () => {
  function deferred<T>() {
    let resolvePromise!: (value: T) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    return { promise, resolve: resolvePromise, reject: rejectPromise };
  }

  const coordinator = new LatestRequestCoordinator();
  const first = deferred<string>();
  const second = deferred<string>();
  const effects: string[] = [];
  const handlers = {
    success: (value: string) => {
      effects.push(`success:${value}`);
    },
    failure: (error: unknown) => {
      effects.push(
        `failure:${error instanceof Error ? error.message : "unknown"}`,
      );
    },
  };
  const firstRun = coordinator.run(() => first.promise, handlers);
  const secondRun = coordinator.run(() => second.promise, handlers);
  second.resolve("new-bootstrap");
  assert.equal(await secondRun, "applied");
  first.reject(new Error("obsolete-401"));
  assert.equal(await firstRun, "stale");
  assert.deepEqual(effects, ["success:new-bootstrap"]);

  const current = deferred<string>();
  const currentRun = coordinator.run(() => current.promise, handlers);
  current.reject(new Error("current-401"));
  assert.equal(await currentRun, "applied");
  assert.deepEqual(effects, ["success:new-bootstrap", "failure:current-401"]);
});

void test("Remote Library labels Album and Artist counts with their owner", () => {
  assert.equal(formatRemoteTrackCount(1), "1 track");
  assert.equal(formatRemoteTrackCount(12), "12 tracks");
  assert.equal(formatRemoteTrackCount("12"), null);
  assert.equal(formatRemoteAlbumCount(1), "1 album");
  assert.equal(formatRemoteAlbumCount(4), "4 albums");
  assert.equal(formatRemoteAlbumCount(-1), null);
  assert.equal(
    remoteLibraryRecordDetail({
      albumArtist: "Massive Attack",
      trackCount: 11,
    }),
    "Massive Attack · 11 tracks",
  );
  assert.equal(
    remoteLibraryRecordDetail({ albumCount: 3, trackCount: 29 }),
    "3 albums · 29 tracks",
  );
  assert.equal(
    remoteLibraryRecordDetail({
      artist: "Portishead",
      album: "Dummy",
      playCount: 7,
    }),
    "Portishead · Dummy · 7",
  );
  assert.equal(
    remotePlaybackContextKindLabel("direct-folder"),
    "Direct folder",
  );
  assert.equal(remotePlaybackContextKindLabel("artist-radio"), "Same artist");
});

void test("Remote Library routes Play contexts separately from Explicit Queue additions", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  for (const route of [
    "/api/library/tracks/queue",
    "/api/library/search/play",
    "/api/library/favorites/tracks/play",
    "/api/library/recently-played/play",
    "/api/library/most-played/play",
    "/api/library/playlists/play",
    "/api/library/playlists/queue",
  ])
    assert.match(source, new RegExp(route.replaceAll("/", "\\/"), "u"));
  assert.match(
    source,
    /libraryView === "tracks"[\s\S]*context: "tracks", selectedTrackId: id/u,
  );
  assert.match(source, /libraryView === "recently"[\s\S]*record\.historyId/u);
  assert.match(
    source,
    /button\("Add", "remote-secondary"[\s\S]*playLibraryRecord\(record, true\)/u,
  );
  assert.doesNotMatch(source, /Playlists can be played from this view/u);
  assert.doesNotMatch(source, /add\.hidden = true/u);
});

void test("Remote viewport disables device zoom explicitly", async () => {
  const html = await readFile(resolve(root, "index.html"), "utf8");
  assert.match(html, /maximum-scale=1\.0/u);
  assert.match(html, /user-scalable=no/u);
});

void test("Remote wake reaches the local software-dim owner on the existing SSE", async () => {
  const backendHub = await readFile(
    resolve(root, "../backend/src/api/sse-hub.ts"),
    "utf8",
  );
  const localClient = await readFile(
    resolve(root, "../ui/src/api/player-api-client.ts"),
    "utf8",
  );
  const idleController = await readFile(
    resolve(root, "../ui/src/display/display-idle-controller.ts"),
    "utf8",
  );
  assert.match(backendHub, /broadcastNamed\("display", state\)/u);
  assert.match(localClient, /addEventListener\("display"/u);
  assert.match(idleController, /receiveExternalSnapshot/u);
  assert.doesNotMatch(localClient, /new EventSource[^\n]*display/iu);
});

void test("Remote UI starts visibly on plain HTTP LAN origins", async () => {
  const source = await readFile(resolve(root, "src/main.ts"), "utf8");
  const sessionId = await readFile(
    resolve(root, "src/client-session-id.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /crypto\.randomUUID/u);
  assert.match(sessionId, /getRandomValues/u);
  assert.match(source, /renderStartup\(\);\s*void loadBootstrap\(\);/u);
  assert.match(source, /Connecting to Eidetic Player/u);
});
