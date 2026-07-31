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
  remoteAudioOutput,
  remotePlayerState,
  resolveRemoteUiStaticRoot,
  type RemoteGatewayAdapters,
} from "../src/remote-access/remote-gateway.js";

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

function adapters(): RemoteGatewayAdapters {
  let player = playerState();
  const playerListeners = new Set<(state: PlayerState) => void>();
  return {
    buildId: "fixture",
    playerState: () => player,
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
    subscribeAudioOutput: () => () => undefined,
    subscribeLibrary: () => Promise.resolve(() => undefined),
    command(action) {
      if (action === "play") {
        player = { ...player, paused: false, status: "playing" };
        playerListeners.forEach((listener) => {
          listener(player);
        });
      }
      return Promise.resolve(player);
    },
    libraryRead: () => Promise.resolve({ items: [] }),
    libraryAction: () => Promise.resolve({ queueLength: 0 }),
    browseSources: () => Promise.resolve([source]),
    browse: () =>
      Promise.resolve({
        source,
        current: { relativePath: "" },
        parent: null,
        entries: [],
      }),
    browseAction: () => Promise.resolve({ queueLength: 0 }),
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
  const gateway = new RemoteGateway(service, adapters(), assets);
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
  const unsafe = {
    ...state,
    playerSessionId: "private-player-session",
    currentTrack: {
      path: "C:\\Users\\person\\Music\\secret.flac",
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
    },
    queue: [
      {
        id: "queue-00000000-0000-4000-8000-000000000004",
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
  const player = JSON.stringify(remotePlayerState(unsafe));
  assert.doesNotMatch(player, /C:\\|\/home\/|private-player-session/u);
  assert.doesNotMatch(player, /clientSessionId|commands/u);

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
