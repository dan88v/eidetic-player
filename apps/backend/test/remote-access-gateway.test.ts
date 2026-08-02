import assert from "node:assert/strict";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";
import type { AudioOutputState } from "../../../packages/shared/src/audio-output.js";
import type {
  IndexedLibrarySnapshot,
  LibrarySource,
} from "../../../packages/shared/src/library.js";
import type { PlayerState } from "../../../packages/shared/src/player.js";
import { RemoteAccessStore } from "../src/remote-access/remote-access-store.js";
import { RemoteAccessService } from "../src/remote-access/remote-access-service.js";
import {
  RemoteGateway,
  RemotePlayerStreamProjector,
  remoteAudioOutput,
  remotePlayerState,
  resolveRemoteUiStaticRoot,
  type RemoteGatewayAdapters,
  type RemoteLibraryAction,
} from "../src/remote-access/remote-gateway.js";
import { defaultPlaybackSourceSnapshot } from "../../../packages/shared/src/playback-source.js";

const origin = "http://127.0.0.1:8080";

async function requestStatus(options: {
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: 8080,
        path: options.path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          resolvePromise(response.statusCode ?? 0);
        });
      },
    );
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function playerState(): PlayerState {
  return {
    playerSessionId: "00000000-0000-4000-8000-000000000001",
    trackTransitionId: 0,
    status: "idle",
    mpvAvailable: true,
    mpvVersion: "fixture",
    currentTrack: null,
    positionSeconds: 0,
    durationSeconds: 0,
    paused: true,
    volume: 50,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    currentQueueIndex: -1,
    queue: [],
    queueRevision: 0,
    audioDevice: "auto",
    commands: {
      volume: {
        generation: 0,
        clientSessionId: null,
        clientIntentId: 0,
        phase: "confirmed",
        target: 50,
      },
      mute: {
        generation: 0,
        clientSessionId: null,
        clientIntentId: 0,
        phase: "confirmed",
        target: false,
      },
      transport: {
        generation: 0,
        clientSessionId: null,
        clientIntentId: 0,
        phase: "confirmed",
        target: true,
      },
      navigation: {
        generation: 0,
        clientSessionId: null,
        clientIntentId: 0,
        phase: "confirmed",
        targetQueueItemId: null,
      },
      failureRevision: 0,
    },
    error: null,
    audioBufferSeconds: 0.2,
  };
}

const audioOutput = {
  mpvAvailable: true,
  devices: [],
  preferredDevice: {
    deviceId: "auto",
    description: "System default",
  },
  effectiveDeviceId: "auto",
  status: "active",
  switching: false,
  revision: 1,
  notice: null,
  noticeRevision: 0,
  diagnostics: {
    currentAo: "fixture",
    normalizedDeviceCount: 0,
    preferredDeviceAvailable: true,
    initialEnumerationStatus: "ready",
  },
  canonicalOutputs: [],
  selectedPhysicalOutputId: "system-default",
} as AudioOutputState;

const source: LibrarySource = {
  id: "00000000-0000-4000-8000-000000000002",
  type: "local",
  displayName: "Music",
  availability: "available",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
};

const librarySnapshot = {
  summary: {
    trackCount: 0,
    availableTrackCount: 0,
    unavailableTrackCount: 0,
    albumCount: 0,
    artistCount: 0,
    sourceCount: 1,
    scanStatus: "idle",
    lastSuccessfulScan: null,
  },
  sources: [],
  status: {
    activeScan: null,
    latestScan: null,
    queuedSourceIds: [],
    recoveryNotice: null,
  },
  historyRevision: 0,
  statsRevision: 0,
  playlistRevision: 0,
} as IndexedLibrarySnapshot;

function adapters(
  observers: {
    readonly commandAction?: (action: string) => void;
    readonly libraryAction?: (
      operation: RemoteLibraryAction,
      body: Record<string, unknown>,
    ) => void;
    readonly browseAction?: (
      sourceId: string,
      action: "play" | "queue",
      body: Record<string, unknown>,
    ) => void;
  } = {},
): RemoteGatewayAdapters {
  let player = playerState();
  const playerListeners = new Set<(state: PlayerState) => void>();
  return {
    buildId: "fixture",
    playerState: () => player,
    playbackSource: () => defaultPlaybackSourceSnapshot,
    audioOutput: () => audioOutput,
    outputLevel: () => ({
      mode: "variable",
      maximumSoftwareVolume: 100,
    }),
    sources: () => Promise.resolve([source]),
    librarySnapshot: () => Promise.resolve(librarySnapshot),
    subscribePlayer(listener) {
      playerListeners.add(listener);
      return () => {
        playerListeners.delete(listener);
      };
    },
    subscribePlaybackSource: () => () => undefined,
    subscribeAudioOutput: () => () => undefined,
    subscribeLibrary: () => Promise.resolve(() => undefined),
    command(action) {
      observers.commandAction?.(action);
      if (action === "play") {
        player = { ...player, paused: false, status: "playing" };
        playerListeners.forEach((listener) => {
          listener(player);
        });
      }
      return Promise.resolve(player);
    },
    libraryRead: () => Promise.resolve({ items: [] }),
    libraryAction: (operation, body) => {
      observers.libraryAction?.(operation, body);
      return Promise.resolve({ queueLength: 0 });
    },
    browseSources: () => Promise.resolve([source]),
    browse: () =>
      Promise.resolve({
        source,
        current: { relativePath: "" },
        parent: null,
        entries: [],
      }),
    browseAction: (sourceId, action, body) => {
      observers.browseAction?.(sourceId, action, body);
      return Promise.resolve({ queueLength: 0 });
    },
    artwork: () => Promise.resolve(null),
    wakeDisplay: () => Promise.resolve(),
    wakeAvailable: () => true,
  };
}

async function pairedCookie(
  service: RemoteAccessService,
): Promise<{ cookie: string; csrf: string }> {
  const pairing = service.createPairingCode();
  const response = await fetch(`${origin}/api/pair`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      code: pairing.code,
      deviceName: "Gateway test",
    }),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.doesNotMatch(cookie, /Secure/u);
  const payload = (await response.json()) as {
    data: { csrfToken: string };
  };
  return {
    cookie: cookie.split(";")[0] ?? "",
    csrf: payload.data.csrfToken,
  };
}

void test("Remote Gateway enforces pairing, security headers, route allowlist and one SSE", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-remote-gateway-"));
  const assets = join(root, "assets");
  await mkdir(assets);
  await writeFile(join(assets, "index.html"), "<!doctype html><p>Remote</p>");
  const service = new RemoteAccessService(
    true,
    true,
    new RemoteAccessStore(join(root, "remote-access.json")),
  );
  const libraryActions: RemoteLibraryAction[] = [];
  const browseActions: ("play" | "queue")[] = [];
  const commandActions: string[] = [];
  const gateway = new RemoteGateway(
    service,
    adapters({
      commandAction: (action) => commandActions.push(action),
      libraryAction: (operation) => libraryActions.push(operation),
      browseAction: (_sourceId, action) => browseActions.push(action),
    }),
    assets,
  );
  service.attachLifecycle(gateway);
  try {
    await service.initialize();
    assert.equal(service.snapshot().enabled, false);
    await assert.rejects(() => fetch(`${origin}/`));
    await service.enable();

    const index = await fetch(`${origin}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Remote/u);
    assert.equal(index.headers.get("x-frame-options"), "DENY");
    assert.match(
      index.headers.get("content-security-policy") ?? "",
      /frame-ancestors 'none'/u,
    );
    const indexHead = await fetch(`${origin}/`, { method: "HEAD" });
    assert.equal(indexHead.status, 200);
    assert.ok(indexHead.headers.get("etag"));
    assert.equal(await requestStatus({ path: "/%2e%2e/package.json" }), 404);

    const invalidHost = await requestStatus({
      path: "/",
      headers: { host: "evil.example:8080" },
    });
    assert.equal(invalidHost, 400);
    const invalidOrigin = await fetch(`${origin}/api/pair`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: "{}",
    });
    assert.equal(invalidOrigin.status, 403);
    const preflight = await fetch(`${origin}/api/pair`, {
      method: "OPTIONS",
      headers: { origin },
    });
    assert.equal(preflight.status, 405);
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);

    const session = await pairedCookie(service);
    const bootstrap = await fetch(`${origin}/api/bootstrap`, {
      headers: { cookie: session.cookie },
    });
    assert.equal(bootstrap.status, 200);
    const bootstrapText = await bootstrap.text();
    assert.doesNotMatch(bootstrapText, /tokenHash|preferences|password/iu);
    assert.match(bootstrapText, /csrfToken/u);
    const bootstrapPayload = JSON.parse(bootstrapText) as {
      readonly data: { readonly player: Record<string, unknown> };
    };
    assert.equal(bootstrapPayload.data.player.currentPlayback, null);
    assert.deepEqual(bootstrapPayload.data.player.explicitQueue, []);
    assert.deepEqual(bootstrapPayload.data.player.queue, []);
    assert.equal(
      Object.hasOwn(bootstrapPayload.data.player, "currentQueueIndex"),
      false,
    );

    const libraryRouteCases: readonly [
      path: string,
      operation: RemoteLibraryAction,
      body: Record<string, unknown>,
    ][] = [
      [
        "/api/library/play",
        "play",
        { context: "album", id: "album-00000000000000000000000000000001" },
      ],
      [
        "/api/library/queue",
        "queue",
        { context: "artist", id: "artist-00000000000000000000000000000001" },
      ],
      [
        "/api/library/tracks/queue",
        "queue-track",
        { trackId: "track-00000000000000000000000000000001" },
      ],
      [
        "/api/library/search/play",
        "play-search",
        {
          query: "fixture",
          selectedTrackId: "track-00000000000000000000000000000001",
        },
      ],
      [
        "/api/library/favorites/tracks/play",
        "play-favorites-tracks",
        { selectedTrackId: "track-00000000000000000000000000000001" },
      ],
      [
        "/api/library/recently-played/play",
        "play-recently-played",
        { selectedHistoryId: "history-1" },
      ],
      [
        "/api/library/most-played/play",
        "play-most-played",
        { selectedTrackId: "track-00000000000000000000000000000001" },
      ],
      [
        "/api/library/playlists/play",
        "play-playlist",
        { playlistId: "playlist-00000000-0000-4000-8000-000000000001" },
      ],
      [
        "/api/library/playlists/queue",
        "queue-playlist",
        { playlistId: "playlist-00000000-0000-4000-8000-000000000001" },
      ],
    ];
    for (const [path, operation, body] of libraryRouteCases) {
      const routeResponse = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
          origin,
          "x-eidetic-csrf": session.csrf,
        },
        body: JSON.stringify(body),
      });
      assert.equal(routeResponse.status, 200, `${path} -> ${operation}`);
    }
    assert.deepEqual(
      libraryActions,
      libraryRouteCases.map(([, operation]) => operation),
    );
    for (const action of ["play", "queue"] as const) {
      const routeResponse = await fetch(
        `${origin}/api/browse/${source.id}/${action}`,
        {
          method: "POST",
          headers: {
            cookie: session.cookie,
            "content-type": "application/json",
            origin,
            "x-eidetic-csrf": session.csrf,
          },
          body: JSON.stringify({ entryId: "entry-fixture" }),
        },
      );
      assert.equal(routeResponse.status, 200);
    }
    assert.deepEqual(browseActions, ["play", "queue"]);

    const missingCsrf = await fetch(`${origin}/api/player/play`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        clientSessionId: "00000000-0000-4000-8000-000000000003",
        intentId: 1,
      }),
    });
    assert.equal(missingCsrf.status, 403);
    const unconfirmedClear = await fetch(`${origin}/api/queue/clear`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        origin,
        "x-eidetic-csrf": session.csrf,
      },
      body: JSON.stringify({
        clientSessionId: "00000000-0000-4000-8000-000000000003",
        intentId: 2,
      }),
    });
    assert.equal(unconfirmedClear.status, 400);

    const clearContext = await fetch(`${origin}/api/context/clear`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        origin,
        "x-eidetic-csrf": session.csrf,
      },
      body: JSON.stringify({
        clientSessionId: "00000000-0000-4000-8000-000000000003",
        intentId: 3,
      }),
    });
    assert.equal(clearContext.status, 200);
    assert.deepEqual(commandActions, ["context-clear"]);

    const forbidden = await fetch(`${origin}/api/system/update/state`, {
      headers: { cookie: session.cookie },
    });
    assert.equal(forbidden.status, 404);
    for (const path of [
      "/api/system/power",
      "/api/network/state",
      "/api/audio-output/state",
      "/api/display/state",
      "/api/smb/connections",
      "/api/preferences",
    ]) {
      const response = await fetch(`${origin}${path}`, {
        headers: { cookie: session.cookie },
      });
      assert.equal(response.status, 404, path);
    }

    const abortFirst = new AbortController();
    const first = await fetch(`${origin}/api/events`, {
      headers: { cookie: session.cookie },
      signal: abortFirst.signal,
    });
    assert.equal(first.status, 200);
    assert.equal(gateway.connectionCount(), 1);
    const abortSecond = new AbortController();
    const second = await fetch(`${origin}/api/events`, {
      headers: { cookie: session.cookie },
      signal: abortSecond.signal,
    });
    assert.equal(second.status, 200);
    assert.equal(gateway.connectionCount(), 1);
    abortFirst.abort();
    abortSecond.abort();

    await service.disable();
    assert.equal(gateway.connectionCount(), 0);
    await assert.rejects(() => fetch(`${origin}/`));
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test("Remote read models omit native paths, command sessions, and raw output routes", () => {
  const state = playerState();
  const commands = state.commands;
  assert.ok(commands);
  assert.deepEqual(remotePlayerState(state), {
    trackTransitionId: 0,
    status: "idle",
    mpvAvailable: true,
    canGoNext: true,
    currentTrack: null,
    currentPlayback: null,
    explicitQueue: [],
    playbackContext: null,
    playbackHistory: {
      entryCount: 0,
      cursor: -1,
      canGoBack: false,
      canGoForward: false,
    },
    playbackContinuation: {
      mode: "off",
      artistId: null,
      artistName: null,
      active: false,
    },
    positionSeconds: 0,
    durationSeconds: 0,
    paused: true,
    volume: 50,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    queue: [],
    queueRevision: 0,
    contextRevision: 0,
    error: null,
  });
  const unsafePlaybackItem = {
    filename: "secret.flac",
    displayTitle: "Secret",
    artist: "Artist",
    album: "Album",
    durationSeconds: 60,
    artwork: null,
    available: true,
    libraryTrackId: "track-11111111111111111111111111111111",
    path: "/home/person/Music/secret.flac",
    nativePath: "C:\\Users\\person\\Music\\secret.flac",
  };
  const unsafeTrack = {
    path: "C:\\Users\\person\\Music\\secret.flac",
    nativePath: "C:\\Users\\person\\Music\\secret.flac",
    filename: "secret.flac",
    title: "Secret",
    artist: "Artist",
    album: "Album",
    artists: ["Artist"],
    albumArtist: null,
    trackNumber: 1,
    trackTotal: 1,
    discNumber: 1,
    discTotal: 1,
    year: 2026,
    genre: [],
    durationSeconds: 60,
    format: "FLAC",
    codec: "flac",
    sampleRate: 44_100,
    bitDepth: 16,
    bitrate: 900_000,
    lossless: true,
    container: "FLAC",
    artwork: null,
    source: "Local File" as const,
  };
  const unsafe = {
    ...state,
    playerSessionId: "private-player-session",
    currentTrack: unsafeTrack,
    currentPlayback: {
      playbackInstanceId: "playback-current",
      source: "context" as const,
      relationId: "context-item-1",
      contextId: "context-1",
      historyEntryId: "history-1",
      startedSequence: 8,
      item: unsafePlaybackItem,
    },
    explicitQueue: [
      {
        explicitQueueEntryId: "explicit-1",
        playbackInstanceId: "playback-explicit-1",
        index: 0,
        item: unsafePlaybackItem,
      },
      {
        explicitQueueEntryId: "explicit-2",
        playbackInstanceId: "playback-explicit-2",
        index: 1,
        item: unsafePlaybackItem,
      },
    ],
    playbackContext: {
      contextId: "context-1",
      kind: "album" as const,
      entityId: "album-11111111111111111111111111111111",
      title: "Album",
      sourceLabel: "Library",
      nextItem: unsafePlaybackItem,
      remainingCount: 4,
      totalCount: 8,
      cycle: 0,
    },
    playbackHistory: {
      entryCount: 3,
      cursor: 2,
      canGoBack: true,
      canGoForward: false,
    },
    playbackContinuation: {
      mode: "same-artist" as const,
      artistId: "artist-11111111111111111111111111111111",
      artistName: "Artist",
      active: false,
    },
    contextRevision: 4,
    queue: [
      {
        id: "technical-context-item",
        index: 0,
        path: "/home/person/Music/secret.flac",
        filename: "secret.flac",
        displayTitle: "Secret",
        artwork: null,
        isCurrent: true,
      },
    ],
    commands: {
      ...commands,
      transport: {
        ...commands.transport,
        clientSessionId: "00000000-0000-4000-8000-000000000005",
      },
    },
  } satisfies PlayerState;
  const remote = remotePlayerState(unsafe);
  assert.deepEqual(
    remote.explicitQueue.map((entry) => entry.explicitQueueEntryId),
    ["explicit-1", "explicit-2"],
  );
  assert.deepEqual(
    remote.queue.map((entry) => ({ id: entry.id, current: entry.isCurrent })),
    [
      { id: "explicit-1", current: false },
      { id: "explicit-2", current: false },
    ],
  );
  assert.equal(Object.hasOwn(remote, "currentQueueIndex"), false);
  assert.equal(remote.currentPlayback?.playbackInstanceId, "playback-current");
  assert.equal(remote.playbackContext?.remainingCount, 4);
  assert.equal(remote.playbackHistory.canGoBack, true);
  assert.equal(remote.playbackContinuation.mode, "same-artist");
  const player = JSON.stringify(remote);
  assert.doesNotMatch(player, /C:\\|\/home\/|private-player-session/u);
  assert.doesNotMatch(
    player,
    /clientSessionId|commands|nativePath|technical-context-item/u,
  );

  const output = JSON.stringify(
    remoteAudioOutput({
      ...audioOutput,
      devices: [
        {
          id: "alsa/private-hardware-id",
          description: "Living room DAC",
          available: true,
        },
      ],
      diagnostics: {
        ...audioOutput.diagnostics,
        currentAo: "alsa/private-hardware-id",
      },
      canonicalOutputs: [
        {
          id: "living-room",
          description: "Living room DAC",
          available: true,
          routes: [
            {
              id: "alsa/private-hardware-id",
              description: "Living room DAC",
              kind: "alsa",
              available: true,
            },
          ],
        },
      ],
      selectedPhysicalOutputId: "living-room",
    }),
  );
  assert.match(output, /Living room DAC/u);
  assert.doesNotMatch(
    output,
    /private-hardware-id|devices|diagnostics|routes/u,
  );
});

void test("Remote player position ticks stay bounded with a 2000-entry explicit Queue", () => {
  const item = {
    filename: "fixture.flac",
    displayTitle: "Fixture",
    artist: "Artist",
    album: "Album",
    durationSeconds: 180,
    artwork: null,
    available: true,
    libraryTrackId: "track-11111111111111111111111111111111",
  } as const;
  const explicitQueue = Array.from({ length: 2_000 }, (_, index) => ({
    explicitQueueEntryId: `explicit-${String(index).padStart(4, "0")}`,
    playbackInstanceId: `playback-${String(index).padStart(4, "0")}`,
    index,
    item,
  }));
  const state: PlayerState = {
    ...playerState(),
    explicitQueue,
    queueRevision: 7,
    contextRevision: 3,
  };
  const projector = new RemotePlayerStreamProjector();
  projector.seed(state);

  const progress = projector.project({ ...state, positionSeconds: 1 });
  if (progress.type !== "player-progress")
    assert.fail("A position-only update must be a progress event.");
  const progressJson = JSON.stringify(progress);
  assert.ok(progressJson.length < 1_000);
  assert.doesNotMatch(
    progressJson,
    /explicitQueue|explicit-1999|playbackContext|currentPlayback/u,
  );

  const queueChanged = projector.project({
    ...state,
    positionSeconds: 2,
    queueRevision: 8,
  });
  if (queueChanged.type !== "player")
    assert.fail("A Queue revision must publish the full player state.");
  assert.equal(queueChanged.data.explicitQueue.length, 2_000);
  assert.equal(queueChanged.data.queue.length, 2_000);

  const contextChanged = projector.project({
    ...state,
    positionSeconds: 3,
    queueRevision: 8,
    contextRevision: 4,
  });
  assert.equal(contextChanged.type, "player");

  const nextProgress = projector.project({
    ...state,
    positionSeconds: 4,
    queueRevision: 8,
    contextRevision: 4,
  });
  assert.equal(nextProgress.type, "player-progress");

  const updatedExplicitQueue = explicitQueue.map((entry, index) =>
    index === 1_000
      ? {
          ...entry,
          item: { ...entry.item, displayTitle: "Updated middle metadata" },
        }
      : entry,
  );
  const middlePresentationChanged = projector.project({
    ...state,
    positionSeconds: 5,
    queueRevision: 8,
    contextRevision: 4,
    explicitQueue: updatedExplicitQueue,
  });
  if (middlePresentationChanged.type !== "player")
    assert.fail("A cached Explicit Queue replacement must publish full state.");
  assert.equal(
    middlePresentationChanged.data.explicitQueue[1_000]?.item.displayTitle,
    "Updated middle metadata",
  );
  assert.equal(
    projector.project({
      ...state,
      positionSeconds: 6,
      queueRevision: 8,
      contextRevision: 4,
      explicitQueue: updatedExplicitQueue,
    }).type,
    "player-progress",
  );

  const currentPresentationChanged = projector.project({
    ...state,
    positionSeconds: 7,
    queueRevision: 8,
    contextRevision: 4,
    explicitQueue: updatedExplicitQueue,
    currentPlayback: {
      playbackInstanceId: "playback-current",
      source: "explicit-queue",
      relationId: "explicit-current",
      contextId: null,
      historyEntryId: "history-current",
      startedSequence: 1,
      item,
    },
  });
  assert.equal(currentPresentationChanged.type, "player");

  projector.reset();
  assert.equal(
    projector.project({
      ...state,
      queueRevision: 8,
      contextRevision: 4,
      explicitQueue: updatedExplicitQueue,
    }).type,
    "player",
  );
});

void test("Remote UI static root follows development and staged-release layouts", () => {
  const release = join(process.cwd(), "release-fixture");
  assert.equal(
    resolveRemoteUiStaticRoot(
      true,
      pathToFileURL(
        join(
          release,
          "backend/apps/backend/src/remote-access/remote-gateway.js",
        ),
      ).href,
    ),
    join(release, "remote-ui"),
  );
  assert.equal(
    resolveRemoteUiStaticRoot(false),
    join(process.cwd(), "dist", "remote-ui"),
  );
});

void test("Remote Gateway reports a fixed-port conflict without changing enabled preference", async () => {
  const blocker = createServer();
  await new Promise<void>((resolvePromise) => {
    blocker.listen(8080, "0.0.0.0", resolvePromise);
  });
  const root = await mkdtemp(join(tmpdir(), "eidetic-remote-port-"));
  const assets = join(root, "assets");
  await mkdir(assets);
  await writeFile(join(assets, "index.html"), "<!doctype html>");
  const service = new RemoteAccessService(
    true,
    true,
    new RemoteAccessStore(join(root, "remote-access.json")),
  );
  const gateway = new RemoteGateway(service, adapters(), assets);
  service.attachLifecycle(gateway);
  try {
    await service.initialize();
    const state = await service.enable();
    assert.equal(state.enabled, true);
    assert.equal(state.status, "error");
    assert.equal(state.reasonCode, "port-unavailable");
  } finally {
    await service.close();
    await new Promise<void>((resolvePromise) =>
      blocker.close(() => {
        resolvePromise();
      }),
    );
    await rm(root, { recursive: true, force: true });
  }
});
