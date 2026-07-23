import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
import { performance } from "node:perf_hooks";
import type { ApiResponse } from "../../../packages/shared/src/player.js";
import type { HealthResponse } from "../../../packages/shared/src/health.js";
import type { WaveformResponse } from "../../../packages/shared/src/visualizer.js";
import {
  validateCommandBody,
  type PlayerCommand,
} from "./api/command-validation.js";
import { SseHub } from "./api/sse-hub.js";
import { config } from "./config.js";
import { PlayerError } from "./player/player-error.js";
import { PlayerService } from "./player/player-service.js";
import { AudioAnalyzerService } from "./analysis/audio-analyzer-service.js";
import { VisualizerHub } from "./analysis/visualizer-hub.js";
import { WaveformService } from "./analysis/waveform-service.js";
import { analysisConfig } from "./analysis/analysis-config.js";
import { LocalFilesystemProvider } from "./filesystem/local-filesystem-provider.js";
import { PathService } from "./filesystem/path-service.js";
import { SourceRepository } from "./filesystem/source-repository.js";
import { SourceService } from "./filesystem/source-service.js";
import { DirectoryBrowserService } from "./filesystem/directory-browser-service.js";
import { FilesystemError } from "./filesystem/filesystem-errors.js";
import type {
  AddLocalSourceRequest,
  RenameSourceRequest,
} from "../../../packages/shared/src/library.js";
import type { ArtworkResource } from "./artwork/artwork-service.js";
import { PlayerSessionRepository } from "./player-session/player-session-repository.js";
import { PlayerSessionService } from "./player-session/player-session-service.js";
import { IndexedLibraryService } from "./library/library-service.js";
import { LibraryError } from "./library/library-errors.js";
import { LibrarySseHub } from "./api/library-sse-hub.js";
import { PlayHistoryTracker } from "./library/play-history-tracker.js";
import type {
  LibraryCancelScanRequest,
  LibraryContextRequest,
  LibraryScanRequest,
  LibrarySearchCategory,
  LibraryTrackQueueRequest,
  FavoriteTrackStatusRequest,
  FavoriteTracksPlayRequest,
  FavoriteAlbumStatusRequest,
  FavoriteArtistStatusRequest,
  RecentlyPlayedPlayRequest,
  MostPlayedPlayRequest,
  PlaylistAddTracksRequest,
  PlaylistNameRequest,
  PlaylistPlayRequest,
  PlaylistReorderRequest,
} from "../../../packages/shared/src/library.js";
import { RemovableStorageService } from "./removable-storage/removable-storage-service.js";
import { createPlatformRemovableStorageProvider } from "./removable-storage/removable-storage-service.js";
import { createPlatformRemovableMediaAdapter } from "./removable-storage/removable-storage-service.js";
import { RemovableStorageSseHub } from "./api/removable-storage-sse-hub.js";

const player = new PlayerService();
const filesystemProvider = new LocalFilesystemProvider();
const pathService = PathService.forCurrentPlatform(filesystemProvider);
const sourceRepository = new SourceRepository();
const removableStorage = new RemovableStorageService(
  createPlatformRemovableStorageProvider(),
  filesystemProvider,
  pathService,
  2_500,
  createPlatformRemovableMediaAdapter(),
);
const sources = new SourceService(
  filesystemProvider,
  pathService,
  sourceRepository,
  removableStorage,
);
const directorySources = {
  getInternal: (sourceId: string) =>
    sourceId.startsWith("usb-")
      ? removableStorage.getInternal(sourceId)
      : sources.getInternal(sourceId),
  availabilityOf: (sourceId: string) =>
    sourceId.startsWith("usb-")
      ? removableStorage.availabilityOf(sourceId)
      : sources.availabilityOf(sourceId),
};
const folders = new DirectoryBrowserService(
  filesystemProvider,
  pathService,
  directorySources,
  () => player.getCurrentPath(),
);
const indexedLibraryPromise = IndexedLibraryService.create(
  filesystemProvider,
  pathService,
  sourceRepository,
  sources,
  player,
);
removableStorage.configureOperations({
  async usage(deviceIds, stableVolumeIdentities) {
    const sourceIds = await sources.removableSourceIdsForIdentities(
      stableVolumeIdentities,
    );
    const playerUsage = player.removableUsage(deviceIds, sourceIds);
    const status = (await indexedLibraryPromise).snapshot().status;
    const scanWillCancel =
      (status.activeScan !== null &&
        sourceIds.includes(status.activeScan.sourceId)) ||
      status.queuedSourceIds.some((sourceId) => sourceIds.includes(sourceId));
    return {
      inUse: playerUsage.queueContainsItems || scanWillCancel,
      ...playerUsage,
      scanWillCancel,
      mountedVolumeCount: removableStorage
        .snapshot()
        .devices.filter(
          (device) =>
            deviceIds.includes(device.id) && device.capabilities.canUnmount,
        ).length,
    };
  },
  async prepareRemoval(deviceIds, stableVolumeIdentities) {
    const sourceIds = await sources.removableSourceIdsForIdentities(
      stableVolumeIdentities,
    );
    for (const deviceId of deviceIds) {
      folders.invalidateSource(deviceId);
      await player.setRemovableDeviceAvailable(deviceId, false);
    }
    const library = await indexedLibraryPromise;
    for (const sourceId of sourceIds) {
      folders.invalidateSource(sourceId);
      library.setSourceAvailability(sourceId, false);
      await player.setFolderSourceAvailable(sourceId, false);
    }
  },
});
const libraryEventsPromise = indexedLibraryPromise.then(
  (indexedLibrary) => new LibrarySseHub(indexedLibrary),
);
void indexedLibraryPromise.catch((error: unknown) => {
  console.error("[library] initialization failed", error);
});
let playHistoryTracker: PlayHistoryTracker | null = null;
let unsubscribeHistoryState = (): void => undefined;
let unsubscribeNaturalEnd = (): void => undefined;
let unsubscribeHistorySeek = (): void => undefined;
void indexedLibraryPromise.then((indexedLibrary) => {
  if (shuttingDown) return;
  const tracker = new PlayHistoryTracker(indexedLibrary);
  playHistoryTracker = tracker;
  tracker.observe(player.getState(), performance.now());
  unsubscribeHistoryState = player.subscribe((state) => {
    tracker.observe(state, performance.now());
  });
  unsubscribeNaturalEnd = player.subscribeNaturalEnd((state) => {
    tracker.observe(state, performance.now(), true);
  });
  unsubscribeHistorySeek = player.subscribeSeek((state) => {
    tracker.noteSeek(state, performance.now());
  });
});
const playerSession = new PlayerSessionService(
  new PlayerSessionRepository(),
  filesystemProvider,
  pathService,
  sources,
  player,
  removableStorage,
);
const events = new SseHub(player);
const removableEvents = new RemovableStorageSseHub(removableStorage);
const unsubscribeRemovablePlayer = removableStorage.subscribe((change) => {
  for (const deviceId of change.disconnectedIds) {
    folders.invalidateSource(deviceId);
    void player.setRemovableDeviceAvailable(deviceId, false);
  }
  for (const deviceId of change.changedIds) {
    folders.invalidateSource(deviceId);
    const device = change.snapshot.devices.find(
      (candidate) => candidate.id === deviceId,
    );
    if (device?.readable)
      void player.setRemovableDeviceAvailable(deviceId, true);
  }
  for (const deviceId of change.connectedIds)
    void player.setRemovableDeviceAvailable(deviceId, true);
  void sources
    .refreshRemovableAvailability()
    .then(async (sourceChanges) => {
      const indexedLibrary = await indexedLibraryPromise;
      for (const sourceChange of sourceChanges) {
        folders.invalidateSource(sourceChange.sourceId);
        indexedLibrary.setSourceAvailability(
          sourceChange.sourceId,
          sourceChange.available,
        );
        await player.setFolderSourceAvailable(
          sourceChange.sourceId,
          sourceChange.available,
        );
      }
    })
    .catch((error: unknown) => {
      console.warn("[removable-library] availability refresh failed", error);
    });
});
const analyzer = new AudioAnalyzerService();
const visualizerEvents = new VisualizerHub(analyzer);
const waveform = new WaveformService(() => analyzer.getDiscovery());
let waveformPreloadSignature = "";
function preloadWaveforms(force = false): void {
  const state = player.getState();
  const current = state.queue[state.currentQueueIndex];
  const next = state.queue[state.currentQueueIndex + 1];
  const signature = `${current?.id ?? ""}:${next?.id ?? ""}`;
  if (!force && signature === waveformPreloadSignature) return;
  waveformPreloadSignature = signature;
  if (!current) {
    waveform.cancel();
    return;
  }
  void waveform
    .get(current.id, current.path)
    .then(async () => {
      if (
        analysisConfig.waveformNextPreloadEnabled &&
        next &&
        waveformPreloadSignature === signature
      )
        await waveform.get(next.id, next.path);
    })
    .catch(() => {
      // The frontend keeps its deterministic fallback.
    });
}
const unsubscribeAnalyzerState = player.subscribe((state) => {
  analyzer.updatePlayerState(state);
  preloadWaveforms();
});
const bootstrapPromise = Promise.all([
  player.initialize(),
  removableStorage.start(),
])
  .then(async () => {
    const restore = await playerSession.restore();
    playerSession.start();
    await analyzer.initialize(player.getMpvExecutable() ?? undefined);
    preloadWaveforms(true);
    return restore;
  })
  .catch((error: unknown) => {
    console.error("[backend] bootstrap failed", error);
    playerSession.start();
    throw error;
  });
void bootstrapPromise
  .then(async () => {
    await (await indexedLibraryPromise).startAutomaticScans();
  })
  .catch((error: unknown) => {
    console.error("[library] automatic scan scheduling failed", error);
  });

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function sendArtwork(
  request: IncomingMessage,
  response: ServerResponse,
  artworkId: string,
): Promise<boolean> {
  const resource =
    (await player.getArtworkResource(artworkId)) ??
    (await folders.getArtworkResource(artworkId));
  if (!resource) return false;
  await sendArtworkResource(request, response, resource);
  return true;
}

async function sendArtworkResource(
  request: IncomingMessage,
  response: ServerResponse,
  resource: ArtworkResource,
): Promise<void> {
  response.setHeader("etag", resource.etag);
  response.setHeader("cache-control", "private, max-age=31536000, immutable");
  response.setHeader("x-content-type-options", "nosniff");
  if (request.headers["if-none-match"] === resource.etag) {
    response.writeHead(304);
    response.end();
    return;
  }
  response.setHeader("content-type", resource.mimeType);
  response.setHeader("content-length", String(resource.size));
  if (request.method === "HEAD") {
    response.writeHead(200);
    response.end();
    return;
  }
  response.writeHead(200);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(resource.path);
    stream.once("error", reject);
    response.once("close", resolve);
    response.once("finish", resolve);
    stream.pipe(response);
  });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > 256 * 1024)
      throw new PlayerError(
        "BODY_TOO_LARGE",
        "Request body is too large.",
        413,
      );
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new PlayerError("INVALID_JSON", "Request body is not valid JSON.");
  }
}

async function execute(command: PlayerCommand): Promise<void> {
  switch (command.type) {
    case "open":
      await player.open(command.paths);
      break;
    case "seek":
      await player.seek(command.positionSeconds);
      analyzer.restartAtCurrentPosition();
      break;
    case "volume":
      await player.setVolume(command.volume);
      break;
    case "mute":
      await player.setMuted(command.muted);
      break;
    case "shuffle":
      await player.setShuffle(command.enabled);
      break;
    case "repeat":
      await player.setRepeatMode(command.mode);
      break;
    case "queue-play":
      await player.playQueueIndex(command.index, async (origin) => {
        if (origin.kind === "removable")
          return removableStorage.resolveLogicalPath(
            origin.deviceId,
            origin.relativePath,
          );
        if (origin.kind === "folders") {
          const source = await sources.getInternal(origin.sourceId);
          return pathService.resolveWithinSource(
            source.canonicalRoot,
            origin.relativePath,
          );
        }
        return origin.nativePath;
      });
      break;
    case "queue-append":
      await player.append(command.paths);
      break;
    case "queue-remove":
      await player.removeQueueItem(command.queueItemId);
      break;
    case "queue-reorder":
      await player.reorderQueueItem(command.queueItemId, command.toIndex);
      break;
    case "empty":
      break;
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FilesystemError(
      "MALFORMED_REQUEST",
      "The request body is invalid.",
    );
  return value as Record<string, unknown>;
}

function addSourceBody(value: unknown): AddLocalSourceRequest {
  const body = objectBody(value);
  if (
    typeof body.nativePath !== "string" ||
    body.nativePath.length === 0 ||
    body.nativePath.length > 32_768
  )
    throw new FilesystemError("INVALID_SOURCE", "Select a valid music folder.");
  return { nativePath: body.nativePath };
}

function renameSourceBody(value: unknown): RenameSourceRequest {
  const body = objectBody(value);
  if (typeof body.displayName !== "string")
    throw new FilesystemError(
      "INVALID_DISPLAY_NAME",
      "Enter a valid source name.",
    );
  return { displayName: body.displayName };
}

function libraryScanBody(value: unknown): LibraryScanRequest {
  const body = objectBody(value);
  if (
    body.sourceId !== undefined &&
    (typeof body.sourceId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(body.sourceId))
  )
    throw new LibraryError(
      "INVALID_LIBRARY_SOURCE",
      "Select a valid Library source.",
    );
  return typeof body.sourceId === "string" ? { sourceId: body.sourceId } : {};
}

function libraryLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 48;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new LibraryError(
      "INVALID_LIBRARY_PAGE",
      "Library page size must be between 1 and 100.",
    );
  return limit;
}

function libraryCursor(url: URL, name = "cursor"): string | null {
  const cursor = url.searchParams.get(name);
  if (cursor !== null && (cursor.length === 0 || cursor.length > 1024))
    throw new LibraryError(
      "INVALID_LIBRARY_CURSOR",
      "The Library page cursor is invalid.",
    );
  return cursor;
}

function librarySearchQuery(url: URL): string {
  const query = url.searchParams.get("q");
  if (query === null || query.length > 256)
    throw new LibraryError(
      "INVALID_LIBRARY_SEARCH",
      "Enter a valid Library search.",
    );
  return query;
}

function librarySearchGroupLimit(url: URL): number | undefined {
  const raw = url.searchParams.get("limitPerGroup");
  if (raw === null) return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 12)
    throw new LibraryError(
      "INVALID_LIBRARY_PAGE",
      "Library grouped search size must be between 1 and 12.",
    );
  return limit;
}

function libraryEntityId(
  value: unknown,
  kind: "album" | "artist" | "track",
): string {
  if (
    typeof value !== "string" ||
    !new RegExp(`^${kind}-[0-9a-f]{32}$`).test(value)
  )
    throw new LibraryError(
      "INVALID_LIBRARY_ID",
      "Select a valid Library item.",
    );
  return value;
}

function libraryContextBody(value: unknown): LibraryContextRequest {
  const body = objectBody(value);
  if (
    body.context !== "album" &&
    body.context !== "artist" &&
    body.context !== "track" &&
    body.context !== "tracks"
  )
    throw new LibraryError(
      "INVALID_LIBRARY_CONTEXT",
      "Select a valid Library context.",
    );
  const context = body.context;
  const id =
    context === "tracks"
      ? undefined
      : libraryEntityId(body.id, context === "track" ? "track" : context);
  const selectedTrackId =
    body.selectedTrackId === undefined
      ? undefined
      : libraryEntityId(body.selectedTrackId, "track");
  return {
    context,
    ...(id ? { id } : {}),
    ...(selectedTrackId ? { selectedTrackId } : {}),
  };
}

function libraryTrackQueueBody(value: unknown): LibraryTrackQueueRequest {
  const body = objectBody(value);
  return { trackId: libraryEntityId(body.trackId, "track") };
}

function favoriteTrackStatusBody(value: unknown): FavoriteTrackStatusRequest {
  const body = objectBody(value);
  if (!Array.isArray(body.trackIds))
    throw new LibraryError(
      "INVALID_LIBRARY_FAVORITE_STATUS",
      "Select valid Library tracks.",
    );
  return {
    trackIds: body.trackIds.map((trackId) => libraryEntityId(trackId, "track")),
  };
}

function favoriteTracksPlayBody(value: unknown): FavoriteTracksPlayRequest {
  const body = objectBody(value);
  const selectedTrackId =
    body.selectedTrackId === undefined
      ? undefined
      : libraryEntityId(body.selectedTrackId, "track");
  if (
    body.catalogFingerprint !== undefined &&
    (typeof body.catalogFingerprint !== "string" ||
      body.catalogFingerprint.length > 256)
  )
    throw new LibraryError(
      "INVALID_LIBRARY_CONTEXT",
      "Select a valid Favorites context.",
    );
  return {
    ...(selectedTrackId ? { selectedTrackId } : {}),
    ...(typeof body.catalogFingerprint === "string"
      ? { catalogFingerprint: body.catalogFingerprint }
      : {}),
  };
}

function favoriteAlbumStatusBody(value: unknown): FavoriteAlbumStatusRequest {
  const body = objectBody(value);
  if (!Array.isArray(body.albumIds))
    throw new LibraryError(
      "INVALID_LIBRARY_FAVORITE_STATUS",
      "Select valid Library albums.",
    );
  return {
    albumIds: body.albumIds.map((id) => libraryEntityId(id, "album")),
  };
}

function favoriteArtistStatusBody(value: unknown): FavoriteArtistStatusRequest {
  const body = objectBody(value);
  if (!Array.isArray(body.artistIds))
    throw new LibraryError(
      "INVALID_LIBRARY_FAVORITE_STATUS",
      "Select valid Library artists.",
    );
  return {
    artistIds: body.artistIds.map((id) => libraryEntityId(id, "artist")),
  };
}

function recentlyPlayedPlayBody(value: unknown): RecentlyPlayedPlayRequest {
  const body = objectBody(value);
  if (
    body.selectedHistoryId !== undefined &&
    (typeof body.selectedHistoryId !== "string" ||
      !/^history-[1-9][0-9]*$/.test(body.selectedHistoryId))
  )
    throw new LibraryError(
      "INVALID_LIBRARY_HISTORY",
      "Select a valid listening-history event.",
    );
  return typeof body.selectedHistoryId === "string"
    ? { selectedHistoryId: body.selectedHistoryId }
    : {};
}

function mostPlayedPlayBody(value: unknown): MostPlayedPlayRequest {
  const body = objectBody(value);
  if (body.selectedTrackId === undefined) return {};
  return { selectedTrackId: libraryEntityId(body.selectedTrackId, "track") };
}

function playlistNameBody(value: unknown): PlaylistNameRequest {
  const body = objectBody(value);
  if (typeof body.name !== "string")
    throw new LibraryError("INVALID_PLAYLIST_NAME", "Enter a playlist name.");
  return { name: body.name };
}

function playlistTracksBody(value: unknown): PlaylistAddTracksRequest {
  const body = objectBody(value);
  if (
    !Array.isArray(body.trackIds) ||
    body.trackIds.length < 1 ||
    body.trackIds.length > 2_000
  )
    throw new LibraryError(
      "INVALID_PLAYLIST_TRACKS",
      "Select between 1 and 2,000 indexed tracks.",
    );
  return {
    trackIds: body.trackIds.map((trackId) => libraryEntityId(trackId, "track")),
    ...(body.allowDuplicates === true ? { allowDuplicates: true } : {}),
  };
}

function playlistReorderBody(value: unknown): PlaylistReorderRequest {
  const body = objectBody(value);
  if (
    !Array.isArray(body.itemIds) ||
    body.itemIds.length > 2_000 ||
    body.itemIds.some((id) => typeof id !== "string")
  )
    throw new LibraryError(
      "INVALID_PLAYLIST_ORDER",
      "The playlist order is invalid.",
    );
  return { itemIds: body.itemIds as string[] };
}

function playlistPlayBody(value: unknown): PlaylistPlayRequest {
  const body = objectBody(value);
  return typeof body.selectedItemId === "string"
    ? { selectedItemId: body.selectedItemId }
    : {};
}

function libraryCancelBody(value: unknown): LibraryCancelScanRequest {
  const body = objectBody(value);
  for (const field of ["scanId", "sourceId"] as const)
    if (
      body[field] !== undefined &&
      (typeof body[field] !== "string" || !/^[0-9a-f-]{36}$/i.test(body[field]))
    )
      throw new LibraryError(
        "INVALID_LIBRARY_SCAN",
        "Select a valid Library scan.",
      );
  return {
    ...(typeof body.scanId === "string" ? { scanId: body.scanId } : {}),
    ...(typeof body.sourceId === "string" ? { sourceId: body.sourceId } : {}),
  };
}

const commandRoutes = new Map<string, PlayerCommand["type"]>([
  ["/api/player/open", "open"],
  ["/api/player/seek", "seek"],
  ["/api/player/volume", "volume"],
  ["/api/player/mute", "mute"],
  ["/api/player/shuffle", "shuffle"],
  ["/api/player/repeat", "repeat"],
  ["/api/player/queue/play", "queue-play"],
  ["/api/player/queue/append", "queue-append"],
  ["/api/player/queue/remove", "queue-remove"],
  ["/api/player/queue/reorder", "queue-reorder"],
]);

const emptyCommands = new Map<string, () => Promise<void>>([
  ["/api/player/play-pause", () => player.playPause()],
  ["/api/player/play", () => player.play()],
  ["/api/player/pause", () => player.pause()],
  ["/api/player/previous", () => player.previous()],
  ["/api/player/next", () => player.next()],
  ["/api/player/queue/clear", () => player.clearQueue()],
]);

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(
      request.url ?? "/",
      `http://${config.backendHost}:${String(config.backendPort)}`,
    );
    if (
      config.development &&
      process.env.EIDETIC_DEV_SHUTDOWN_TOKEN &&
      request.headers["x-eidetic-shutdown-token"] ===
        process.env.EIDETIC_DEV_SHUTDOWN_TOKEN &&
      request.method === "POST" &&
      url.pathname === "/api/development/shutdown"
    ) {
      sendJson(response, 202, { ok: true });
      setImmediate(() => {
        shutdown("SIGTERM");
      });
      return;
    }
    const origin = request.headers.origin;
    if (origin) {
      const originUrl = new URL(origin);
      if (
        originUrl.hostname === "127.0.0.1" ||
        originUrl.hostname === "localhost"
      ) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "Origin");
        response.setHeader("access-control-allow-headers", "content-type");
        response.setHeader(
          "access-control-allow-methods",
          "GET, POST, PATCH, DELETE, OPTIONS",
        );
      }
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const payload: HealthResponse = {
        status: "ok",
        environment: config.environment,
      };
      sendJson(response, 200, payload);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/player/state") {
      sendJson(response, 200, { ok: true, data: player.getPublicState() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      const restore = await bootstrapPromise;
      sendJson(response, 200, {
        ok: true,
        data: {
          playerState: player.getPublicState(),
          restore: {
            status: restore.status,
            restoredCount: restore.restoredCount,
            discardedCount: restore.discardedCount,
          },
        },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/sources") {
      sendJson(response, 200, {
        ok: true,
        data: { sources: await sources.list() },
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/removable-storage/devices"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: removableStorage.snapshot(),
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/removable-storage/events"
    ) {
      removableEvents.add(response);
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/library/diagnostics"
    ) {
      const indexedLibrary = await indexedLibraryPromise;
      sendJson(response, 200, {
        ok: true,
        data: {
          folders: folders.getDiagnostics(),
          removableStorage: removableStorage.diagnostics(),
          indexed: indexedLibrary.getDiagnostics(),
        },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/summary") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).snapshot().summary,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/snapshot") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).snapshot(),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/sources") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).snapshot().sources,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/status") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).snapshot().status,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/search") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).search(
          librarySearchQuery(url),
          librarySearchGroupLimit(url),
        ),
      });
      return;
    }
    const librarySearchCategoryMatch =
      /^\/api\/library\/search\/(artists|albums|tracks)$/.exec(url.pathname);
    if (librarySearchCategoryMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).searchCategory(
          librarySearchCategoryMatch[1] as LibrarySearchCategory,
          librarySearchQuery(url),
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/albums") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).albums(
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    const albumMatch = /^\/api\/library\/albums\/(album-[0-9a-f]{32})$/.exec(
      url.pathname,
    );
    if (albumMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).album(albumMatch[1] ?? ""),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/artists") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).artists(
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    const artistMatch = /^\/api\/library\/artists\/(artist-[0-9a-f]{32})$/.exec(
      url.pathname,
    );
    if (artistMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).artist(
          artistMatch[1] ?? "",
          libraryCursor(url, "trackCursor"),
          libraryLimit(url),
        ),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/tracks") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).tracks(
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/library/recently-played"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).recentlyPlayed(
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/library/history/most-played"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).mostPlayed(
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/library/history/stats"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).listeningStats(),
      });
      return;
    }
    if (
      request.method === "DELETE" &&
      url.pathname === "/api/library/history/stats"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).resetListeningStats(),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/history/most-played/play"
    ) {
      const body = mostPlayedPlayBody(await readBody(request));
      const generation = player.reserveOpenRequest();
      const context = await (
        await indexedLibraryPromise
      ).resolveMostPlayed(body.selectedTrackId);
      await player.openResolvedQueue(
        context.paths,
        context.selectedIndex,
        context.origins,
        generation,
      );
      sendJson(response, 200, {
        ok: true,
        data: {
          queueLength: context.paths.length,
          selectedIndex: context.selectedIndex,
          appendedCount: 0,
        },
      });
      return;
    }
    if (
      request.method === "DELETE" &&
      url.pathname === "/api/library/recently-played"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).clearPlayHistory(),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/recently-played/play"
    ) {
      const body = recentlyPlayedPlayBody(await readBody(request));
      const generation = player.reserveOpenRequest();
      const context = await (
        await indexedLibraryPromise
      ).resolveRecentlyPlayed(body.selectedHistoryId);
      await player.openResolvedQueue(
        context.paths,
        context.selectedIndex,
        context.origins,
        generation,
      );
      sendJson(response, 200, {
        ok: true,
        data: {
          queueLength: context.paths.length,
          selectedIndex: context.selectedIndex,
          appendedCount: 0,
        },
      });
      return;
    }
    const recentlyPlayedMatch =
      /^\/api\/library\/recently-played\/(history-[1-9][0-9]*)$/.exec(
        url.pathname,
      );
    if (recentlyPlayedMatch && request.method === "DELETE") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).removePlayHistory(
          recentlyPlayedMatch[1] ?? "",
        ),
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/library/favorites/tracks"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).favoriteTracks(
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/favorites/tracks/status"
    ) {
      const body = favoriteTrackStatusBody(await readBody(request));
      sendJson(response, 200, {
        ok: true,
        data: {
          favoriteTrackIds: (await indexedLibraryPromise).favoriteTrackIds(
            body.trackIds,
          ),
        },
      });
      return;
    }
    const favoriteTrackMatch =
      /^\/api\/library\/favorites\/tracks\/(track-[0-9a-f]{32})$/.exec(
        url.pathname,
      );
    if (favoriteTrackMatch && request.method === "PUT") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).addFavoriteTrack(
          favoriteTrackMatch[1] ?? "",
        ),
      });
      return;
    }
    if (favoriteTrackMatch && request.method === "DELETE") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).removeFavoriteTrack(
          favoriteTrackMatch[1] ?? "",
        ),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/favorites/tracks/play"
    ) {
      const body = favoriteTracksPlayBody(await readBody(request));
      const generation = player.reserveOpenRequest();
      const context = await (
        await indexedLibraryPromise
      ).resolveFavorites(body.selectedTrackId, body.catalogFingerprint);
      await player.openResolvedQueue(
        context.paths,
        context.selectedIndex,
        context.origins,
        generation,
      );
      sendJson(response, 200, {
        ok: true,
        data: {
          queueLength: context.paths.length,
          selectedIndex: context.selectedIndex,
          appendedCount: 0,
        },
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/library/favorites/albums"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).favoriteAlbums(
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/favorites/albums/status"
    ) {
      const body = favoriteAlbumStatusBody(await readBody(request));
      sendJson(response, 200, {
        ok: true,
        data: {
          favoriteAlbumIds: (await indexedLibraryPromise).favoriteAlbumIds(
            body.albumIds,
          ),
        },
      });
      return;
    }
    const favoriteAlbumMatch =
      /^\/api\/library\/favorites\/albums\/(album-[0-9a-f]{32})$/.exec(
        url.pathname,
      );
    if (favoriteAlbumMatch && request.method === "PUT") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).addFavoriteAlbum(
          favoriteAlbumMatch[1] ?? "",
        ),
      });
      return;
    }
    if (favoriteAlbumMatch && request.method === "DELETE") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).removeFavoriteAlbum(
          favoriteAlbumMatch[1] ?? "",
        ),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/favorites/albums/play"
    ) {
      const generation = player.reserveOpenRequest();
      const context = await (
        await indexedLibraryPromise
      ).resolveFavoriteAlbums();
      await player.openResolvedQueue(
        context.paths,
        context.selectedIndex,
        context.origins,
        generation,
      );
      sendJson(response, 200, {
        ok: true,
        data: {
          queueLength: context.paths.length,
          selectedIndex: context.selectedIndex,
          appendedCount: 0,
        },
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/library/favorites/artists"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).favoriteArtists(
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/favorites/artists/status"
    ) {
      const body = favoriteArtistStatusBody(await readBody(request));
      sendJson(response, 200, {
        ok: true,
        data: {
          favoriteArtistIds: (await indexedLibraryPromise).favoriteArtistIds(
            body.artistIds,
          ),
        },
      });
      return;
    }
    const favoriteArtistMatch =
      /^\/api\/library\/favorites\/artists\/(artist-[0-9a-f]{32})$/.exec(
        url.pathname,
      );
    if (favoriteArtistMatch && request.method === "PUT") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).addFavoriteArtist(
          favoriteArtistMatch[1] ?? "",
        ),
      });
      return;
    }
    if (favoriteArtistMatch && request.method === "DELETE") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).removeFavoriteArtist(
          favoriteArtistMatch[1] ?? "",
        ),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/favorites/artists/play"
    ) {
      const generation = player.reserveOpenRequest();
      const context = await (
        await indexedLibraryPromise
      ).resolveFavoriteArtists();
      await player.openResolvedQueue(
        context.paths,
        context.selectedIndex,
        context.origins,
        generation,
      );
      sendJson(response, 200, {
        ok: true,
        data: {
          queueLength: context.paths.length,
          selectedIndex: context.selectedIndex,
          appendedCount: 0,
        },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/playlists") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).playlists(
          libraryCursor(url),
          libraryLimit(url),
        ),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/playlists"
    ) {
      const body = playlistNameBody(await readBody(request));
      sendJson(response, 201, {
        ok: true,
        data: (await indexedLibraryPromise).createPlaylist(body.name),
      });
      return;
    }
    const playlistMatch =
      /^\/api\/library\/playlists\/(playlist-[0-9a-f-]{36})$/.exec(
        url.pathname,
      );
    if (playlistMatch) {
      const playlistId = playlistMatch[1] ?? "";
      const indexedLibrary = await indexedLibraryPromise;
      if (request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          data: indexedLibrary.playlist(playlistId),
        });
        return;
      }
      if (request.method === "PATCH") {
        const body = playlistNameBody(await readBody(request));
        sendJson(response, 200, {
          ok: true,
          data: indexedLibrary.renamePlaylist(playlistId, body.name),
        });
        return;
      }
      if (request.method === "DELETE") {
        sendJson(response, 200, {
          ok: true,
          data: indexedLibrary.deletePlaylist(playlistId),
        });
        return;
      }
    }
    const playlistTracksMatch =
      /^\/api\/library\/playlists\/(playlist-[0-9a-f-]{36})\/tracks$/.exec(
        url.pathname,
      );
    if (playlistTracksMatch && request.method === "POST") {
      const body = playlistTracksBody(await readBody(request));
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).addPlaylistTracks(
          playlistTracksMatch[1] ?? "",
          body.trackIds,
          body.allowDuplicates,
        ),
      });
      return;
    }
    const playlistItemMatch =
      /^\/api\/library\/playlists\/(playlist-[0-9a-f-]{36})\/items\/(playlist-item-[0-9a-f-]{36})$/.exec(
        url.pathname,
      );
    if (playlistItemMatch && request.method === "DELETE") {
      sendJson(response, 200, {
        ok: true,
        data: (await indexedLibraryPromise).removePlaylistItem(
          playlistItemMatch[1] ?? "",
          playlistItemMatch[2] ?? "",
        ),
      });
      return;
    }
    const playlistActionMatch =
      /^\/api\/library\/playlists\/(playlist-[0-9a-f-]{36})\/(reorder|play|queue)$/.exec(
        url.pathname,
      );
    if (playlistActionMatch && request.method === "POST") {
      const playlistId = playlistActionMatch[1] ?? "";
      const action = playlistActionMatch[2];
      const indexedLibrary = await indexedLibraryPromise;
      if (action === "reorder") {
        const body = playlistReorderBody(await readBody(request));
        sendJson(response, 200, {
          ok: true,
          data: indexedLibrary.reorderPlaylist(playlistId, body.itemIds),
        });
        return;
      }
      const body = playlistPlayBody(await readBody(request));
      const context = await indexedLibrary.resolvePlaylist(
        playlistId,
        body.selectedItemId,
      );
      if (action === "play") {
        const generation = player.reserveOpenRequest();
        await player.openResolvedQueue(
          context.paths,
          context.selectedIndex,
          context.origins,
          generation,
        );
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: context.paths.length,
            selectedIndex: context.selectedIndex,
            appendedCount: 0,
          },
        });
      } else {
        const appendedCount = await player.appendResolvedQueue(
          context.paths,
          context.origins,
        );
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: player.getState().queue.length,
            selectedIndex: null,
            appendedCount,
          },
        });
      }
      return;
    }
    const libraryArtworkMatch =
      /^\/api\/library\/tracks\/(track-[0-9a-f]{32})\/artwork$/.exec(
        url.pathname,
      );
    if (
      libraryArtworkMatch &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const indexedLibrary = await indexedLibraryPromise;
      const location = indexedLibrary.trackLocation(
        libraryArtworkMatch[1] ?? "",
      );
      const resource = location
        ? await folders.artworkForLogicalPath(
            location.sourceId,
            location.relativePath,
          )
        : null;
      if (!resource) {
        sendJson(response, 404, {
          ok: false,
          error: {
            code: "LIBRARY_ARTWORK_NOT_FOUND",
            message: "Artwork not found.",
          },
        });
        return;
      }
      await sendArtworkResource(request, response, resource);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/library/play") {
      const body = libraryContextBody(await readBody(request));
      const generation = player.reserveOpenRequest();
      const context = await (
        await indexedLibraryPromise
      ).resolveContext(body.context, body.id, body.selectedTrackId);
      await player.openResolvedQueue(
        context.paths,
        context.selectedIndex,
        context.origins,
        generation,
      );
      sendJson(response, 200, {
        ok: true,
        data: {
          queueLength: context.paths.length,
          selectedIndex: context.selectedIndex,
          appendedCount: 0,
        },
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/library/queue") {
      const body = libraryContextBody(await readBody(request));
      if (body.context === "track")
        throw new LibraryError(
          "INVALID_LIBRARY_CONTEXT",
          "Add a single Track through the Track Queue action.",
        );
      const context = await (
        await indexedLibraryPromise
      ).resolveContext(body.context, body.id);
      const appendedCount = await player.append(context.paths, context.origins);
      sendJson(response, 200, {
        ok: true,
        data: {
          queueLength: player.getState().queue.length,
          selectedIndex: null,
          appendedCount,
        },
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/tracks/queue"
    ) {
      const body = libraryTrackQueueBody(await readBody(request));
      const context = await (
        await indexedLibraryPromise
      ).resolveTrack(body.trackId);
      const appendedCount = await player.append(context.paths, context.origins);
      sendJson(response, 200, {
        ok: true,
        data: {
          queueLength: player.getState().queue.length,
          selectedIndex: null,
          appendedCount,
        },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library/events") {
      (await libraryEventsPromise).add(response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/library/scan") {
      const body = libraryScanBody(await readBody(request));
      sendJson(response, 202, {
        ok: true,
        data: await (await indexedLibraryPromise).requestScan(body),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/scan/cancel"
    ) {
      const body = libraryCancelBody(await readBody(request));
      sendJson(response, 202, {
        ok: true,
        data: (await indexedLibraryPromise).cancelScan(body),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/recovery/acknowledge"
    ) {
      await readBody(request);
      (await indexedLibraryPromise).acknowledgeRecoveryNotice();
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/sources/local") {
      const body = addSourceBody(await readBody(request));
      const result = await sources.addLocal(body.nativePath);
      if (!result.duplicate)
        await (await indexedLibraryPromise).sourceAdded(result.source.id);
      sendJson(response, 201, {
        ok: true,
        data: result,
      });
      return;
    }
    const removableBrowseMatch =
      /^\/api\/removable-storage\/(usb-[0-9a-f]{32})\/browse$/.exec(
        url.pathname,
      );
    const removableOperationMatch =
      /^\/api\/removable-storage\/(usb-[0-9a-f]{32})\/(usage|mount|safe-remove)$/.exec(
        url.pathname,
      );
    if (
      removableOperationMatch &&
      request.method === "GET" &&
      removableOperationMatch[2] === "usage"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: await removableStorage.usage(removableOperationMatch[1] ?? ""),
      });
      return;
    }
    if (
      removableOperationMatch &&
      request.method === "POST" &&
      removableOperationMatch[2] === "mount"
    ) {
      await readBody(request);
      sendJson(response, 200, {
        ok: true,
        data: await removableStorage.mount(removableOperationMatch[1] ?? ""),
      });
      return;
    }
    if (
      removableOperationMatch &&
      request.method === "POST" &&
      removableOperationMatch[2] === "safe-remove"
    ) {
      const body = objectBody(await readBody(request));
      if (body.confirmed !== undefined && typeof body.confirmed !== "boolean")
        throw new FilesystemError(
          "REMOVABLE_INVALID_OPERATION",
          "Select a valid USB operation.",
          400,
        );
      sendJson(response, 200, {
        ok: true,
        data: await removableStorage.safelyRemove(
          removableOperationMatch[1] ?? "",
          body.confirmed === true,
        ),
      });
      return;
    }
    const removableLibrarySourceMatch =
      /^\/api\/removable-storage\/(usb-[0-9a-f]{32})\/library-sources$/.exec(
        url.pathname,
      );
    if (removableLibrarySourceMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: await sources.removableCoverage(
          removableLibrarySourceMatch[1] ?? "",
          url.searchParams.get("logicalRelativePath") ?? "",
        ),
      });
      return;
    }
    if (removableLibrarySourceMatch && request.method === "POST") {
      const body = objectBody(await readBody(request));
      const logicalRelativePath =
        typeof body.logicalRelativePath === "string"
          ? body.logicalRelativePath
          : "";
      const result = await sources.addRemovable(
        removableLibrarySourceMatch[1] ?? "",
        logicalRelativePath,
      );
      try {
        await (await indexedLibraryPromise).sourceAdded(result.source.id);
      } catch (error) {
        await sources.remove(result.source.id).catch(() => undefined);
        throw error;
      }
      sendJson(response, 201, { ok: true, data: result });
      return;
    }
    if (removableBrowseMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: await folders.browse(
          removableBrowseMatch[1] ?? "",
          url.searchParams.get("relativePath") ?? "",
        ),
      });
      return;
    }
    const removableFolderArtworkMatch =
      /^\/api\/removable-storage\/(usb-[0-9a-f]{32})\/folder-artwork$/.exec(
        url.pathname,
      );
    if (removableFolderArtworkMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: await folders.folderArtworkFor(
          removableFolderArtworkMatch[1] ?? "",
          url.searchParams.get("relativePath") ?? "",
        ),
      });
      return;
    }
    const removableDirectoryActionMatch =
      /^\/api\/removable-storage\/(usb-[0-9a-f]{32})\/directory\/(play|queue)$/.exec(
        url.pathname,
      );
    if (removableDirectoryActionMatch && request.method === "POST") {
      const deviceId = removableDirectoryActionMatch[1] ?? "";
      const action = removableDirectoryActionMatch[2] ?? "";
      const body = (await readBody(request)) as { relativePath?: unknown };
      const relativePath =
        typeof body.relativePath === "string" ? body.relativePath : "";
      const requestGeneration =
        action === "play" ? player.reserveOpenRequest() : undefined;
      const queue = await folders.queueForDirectoryWithOrigins(
        deviceId,
        relativePath,
      );
      const origins = queue.relativePaths.map((entryRelativePath) => ({
        kind: "removable" as const,
        deviceId,
        relativePath: entryRelativePath,
        entryId: folders.entryIdForRelativePath(deviceId, entryRelativePath),
      }));
      if (action === "play") {
        if (queue.paths.length)
          await player.openResolvedQueue(
            queue.paths,
            0,
            origins,
            requestGeneration,
          );
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: queue.paths.length,
            appendedCount: queue.paths.length,
          },
        });
      } else {
        const appendedCount = queue.paths.length
          ? await player.append(queue.paths, origins)
          : 0;
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: player.getState().queue.length,
            appendedCount,
          },
        });
      }
      return;
    }
    const removableEntryMatch =
      /^\/api\/removable-storage\/(usb-[0-9a-f]{32})\/entries\/(entry-[0-9a-f]{32})\/(metadata|artwork|open|queue)$/.exec(
        url.pathname,
      );
    if (removableEntryMatch) {
      const deviceId = removableEntryMatch[1] ?? "";
      const entryId = removableEntryMatch[2] ?? "";
      const action = removableEntryMatch[3] ?? "";
      if (request.method === "GET" && action === "metadata") {
        sendJson(response, 200, {
          ok: true,
          data: await folders.metadataFor(deviceId, entryId),
        });
        return;
      }
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        action === "artwork"
      ) {
        const resource = await folders.artworkFor(deviceId, entryId);
        if (!resource) {
          sendJson(response, 404, {
            ok: false,
            error: {
              code: "REMOVABLE_ARTWORK_NOT_FOUND",
              message: "Artwork not found.",
            },
          });
          return;
        }
        await sendArtworkResource(request, response, resource);
        return;
      }
      if (request.method === "POST" && action === "open") {
        await readBody(request);
        const requestGeneration = player.reserveOpenRequest();
        const queue = await folders.queueForEntry(deviceId, entryId);
        await player.openResolvedQueue(
          queue.paths,
          queue.selectedIndex,
          queue.relativePaths.map((relativePath) => ({
            kind: "removable" as const,
            deviceId,
            relativePath,
            entryId: folders.entryIdForRelativePath(deviceId, relativePath),
          })),
          requestGeneration,
        );
        sendJson(response, 200, {
          ok: true,
          data: {
            selectedIndex: queue.selectedIndex,
            queueLength: queue.paths.length,
          },
        });
        return;
      }
      if (request.method === "POST" && action === "queue") {
        await readBody(request);
        const path = await folders.pathForEntry(deviceId, entryId);
        const appendedCount = await player.append(
          [path],
          [
            {
              kind: "removable",
              deviceId,
              relativePath: folders.relativePathForEntry(deviceId, entryId),
              entryId,
            },
          ],
        );
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: player.getState().queue.length,
            appendedCount,
          },
        });
        return;
      }
    }
    const sourceMatch = /^\/api\/sources\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (sourceMatch && request.method === "PATCH") {
      const sourceId = sourceMatch[1] ?? "";
      const body = renameSourceBody(await readBody(request));
      const renamed = await sources.rename(sourceId, body.displayName);
      (await indexedLibraryPromise).sourceRenamed(
        sourceId,
        renamed.displayName,
      );
      sendJson(response, 200, {
        ok: true,
        data: renamed,
      });
      return;
    }
    if (sourceMatch && request.method === "DELETE") {
      const sourceId = sourceMatch[1] ?? "";
      await readBody(request);
      await sources.remove(sourceId);
      folders.invalidateSource(sourceId);
      (await indexedLibraryPromise).sourceRemoved(sourceId);
      sendJson(response, 200, { ok: true });
      return;
    }
    const retryMatch = /^\/api\/sources\/([0-9a-f-]{36})\/retry$/i.exec(
      url.pathname,
    );
    if (retryMatch && request.method === "POST") {
      const sourceId = retryMatch[1] ?? "";
      await readBody(request);
      folders.invalidateSource(sourceId);
      sendJson(response, 200, {
        ok: true,
        data: await sources.retry(sourceId),
      });
      return;
    }
    const browseMatch = /^\/api\/sources\/([0-9a-f-]{36})\/browse$/i.exec(
      url.pathname,
    );
    if (browseMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: await folders.browse(
          browseMatch[1] ?? "",
          url.searchParams.get("relativePath") ?? "",
        ),
      });
      return;
    }
    const folderArtworkMatch =
      /^\/api\/sources\/([0-9a-f-]{36})\/folder-artwork$/i.exec(url.pathname);
    if (folderArtworkMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: await folders.folderArtworkFor(
          folderArtworkMatch[1] ?? "",
          url.searchParams.get("relativePath") ?? "",
        ),
      });
      return;
    }
    const directoryActionMatch =
      /^\/api\/sources\/([0-9a-f-]{36})\/directory\/(play|queue)$/i.exec(
        url.pathname,
      );
    if (directoryActionMatch && request.method === "POST") {
      const sourceId = directoryActionMatch[1] ?? "";
      const action = directoryActionMatch[2] ?? "";
      const body = (await readBody(request)) as { relativePath?: unknown };
      const relativePath =
        typeof body.relativePath === "string" ? body.relativePath : "";
      const openRequestGeneration =
        action === "play" ? player.reserveOpenRequest() : null;
      const queue = await folders.queueForDirectoryWithOrigins(
        sourceId,
        relativePath,
      );
      const origins = queue.relativePaths.map((entryRelativePath) => ({
        kind: "folders" as const,
        sourceId,
        relativePath: entryRelativePath,
      }));
      if (action === "play") {
        if (queue.paths.length > 0)
          await player.openResolvedQueue(
            queue.paths,
            0,
            origins,
            openRequestGeneration ?? undefined,
          );
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: queue.paths.length,
            appendedCount: queue.paths.length,
          },
        });
      } else {
        const appendedCount =
          queue.paths.length > 0
            ? await player.append(queue.paths, origins)
            : 0;
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: player.getState().queue.length,
            appendedCount,
          },
        });
      }
      return;
    }
    const entryMatch =
      /^\/api\/sources\/([0-9a-f-]{36})\/entries\/(entry-[0-9a-f]{32})\/(metadata|artwork|open|queue)$/i.exec(
        url.pathname,
      );
    if (entryMatch) {
      const sourceId = entryMatch[1] ?? "";
      const entryId = entryMatch[2] ?? "";
      const action = entryMatch[3] ?? "";
      if (request.method === "GET" && action === "metadata") {
        sendJson(response, 200, {
          ok: true,
          data: await folders.metadataFor(sourceId, entryId),
        });
        return;
      }
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        action === "artwork"
      ) {
        const resource = await folders.artworkFor(sourceId, entryId);
        if (!resource) {
          sendJson(response, 404, {
            ok: false,
            error: {
              code: "LIBRARY_ARTWORK_NOT_FOUND",
              message: "Artwork not found.",
            },
          });
          return;
        }
        await sendArtworkResource(request, response, resource);
        return;
      }
      if (request.method === "POST" && action === "open") {
        await readBody(request);
        const openRequestGeneration = player.reserveOpenRequest();
        const queue = await folders.queueForEntry(sourceId, entryId);
        await player.openResolvedQueue(
          queue.paths,
          queue.selectedIndex,
          queue.relativePaths.map((relativePath) => ({
            kind: "folders" as const,
            sourceId,
            relativePath,
          })),
          openRequestGeneration,
        );
        sendJson(response, 200, {
          ok: true,
          data: {
            selectedIndex: queue.selectedIndex,
            queueLength: queue.paths.length,
          },
        });
        return;
      }
      if (request.method === "POST" && action === "queue") {
        await readBody(request);
        const path = await folders.pathForEntry(sourceId, entryId);
        const appendedCount = await player.append(
          [path],
          [
            {
              kind: "folders",
              sourceId,
              relativePath: folders.relativePathForEntry(sourceId, entryId),
            },
          ],
        );
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: player.getState().queue.length,
            appendedCount,
          },
        });
        return;
      }
    }
    if (request.method === "GET" && url.pathname === "/api/player/events") {
      events.add(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/visualizer/events") {
      const mode = url.searchParams.get("mode");
      visualizerEvents.add(
        response,
        mode === "spectrumMono" ||
          mode === "spectrumStereo" ||
          mode === "technical"
          ? mode
          : "meter",
      );
      return;
    }
    const waveformMatch = /^\/api\/player\/queue\/([^/]+)\/waveform$/.exec(
      url.pathname,
    );
    if (request.method === "GET" && waveformMatch) {
      const queueItemId = waveformMatch[1] ?? "";
      const path = player.getQueueItemPath(queueItemId);
      if (!path) {
        sendJson(response, 404, {
          ok: false,
          error: {
            code: "QUEUE_ITEM_NOT_FOUND",
            message: "Queue item not found.",
          },
        });
        return;
      }
      const abortController = new AbortController();
      request.once("aborted", () => {
        abortController.abort();
      });
      let payload: WaveformResponse;
      try {
        payload = await waveform.get(queueItemId, path, abortController.signal);
      } catch (error) {
        if (
          abortController.signal.aborted &&
          error instanceof DOMException &&
          error.name === "AbortError"
        )
          return;
        throw error;
      }
      const etag = `"${payload.fingerprint}"`;
      response.setHeader("etag", etag);
      response.setHeader("cache-control", "private, no-cache");
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304);
        response.end();
      } else sendJson(response, 200, payload);
      return;
    }
    const artworkMatch = /^\/api\/artwork\/([^/]+)$/.exec(url.pathname);
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      artworkMatch
    ) {
      if (await sendArtwork(request, response, artworkMatch[1] ?? "")) return;
      sendJson(response, 404, {
        ok: false,
        error: { code: "ARTWORK_NOT_FOUND", message: "Artwork not found." },
      });
      return;
    }
    const queueArtworkMatch = /^\/api\/player\/queue\/([^/]+)\/artwork$/.exec(
      url.pathname,
    );
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      queueArtworkMatch
    ) {
      const ref = await player.resolveQueueArtwork(queueArtworkMatch[1] ?? "");
      if (ref && (await sendArtwork(request, response, ref.id))) return;
      sendJson(response, 404, {
        ok: false,
        error: {
          code: "QUEUE_ARTWORK_NOT_FOUND",
          message: "Queue artwork not found.",
        },
      });
      return;
    }
    if (request.method === "POST") {
      const bodyRoute = commandRoutes.get(url.pathname);
      if (bodyRoute) {
        const command = validateCommandBody(bodyRoute, await readBody(request));
        await execute(command);
        sendJson(response, 200, { ok: true } satisfies ApiResponse);
        return;
      }
      const action = emptyCommands.get(url.pathname);
      if (action) {
        await readBody(request);
        await action();
        sendJson(response, 200, { ok: true } satisfies ApiResponse);
        return;
      }
    }
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Endpoint not found." },
    });
  } catch (error) {
    const playerError =
      error instanceof PlayerError ||
      error instanceof FilesystemError ||
      error instanceof LibraryError
        ? error
        : new PlayerError(
            "INTERNAL_ERROR",
            "The player could not complete the request.",
            500,
          );
    if (
      !(error instanceof PlayerError) &&
      !(error instanceof FilesystemError) &&
      !(error instanceof LibraryError)
    )
      console.error("[backend] request failed", error);
    sendJson(response, playerError.statusCode, {
      ok: false,
      error: { code: playerError.code, message: playerError.message },
    } satisfies ApiResponse);
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(config.backendPort, config.backendHost, () => {
  console.log(
    `[backend] listening on http://${config.backendHost}:${String(config.backendPort)}`,
  );
  void bootstrapPromise.catch(() => undefined);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[backend] received ${signal}, shutting down`);
  events.close();
  removableEvents.close();
  unsubscribeRemovablePlayer();
  unsubscribeHistoryState();
  unsubscribeNaturalEnd();
  unsubscribeHistorySeek();
  playHistoryTracker?.stop();
  unsubscribeAnalyzerState();
  server.close();
  playerSession.stop();
  void bootstrapPromise
    .catch(() => undefined)
    .then(() => playerSession.flush())
    .then(() =>
      Promise.all([
        visualizerEvents.close(),
        waveform.close(),
        folders.close(),
        removableStorage.close(),
        libraryEventsPromise
          .then((libraryEvents) => {
            libraryEvents.close();
          })
          .catch(() => undefined),
        indexedLibraryPromise
          .then((indexedLibrary) => indexedLibrary.close())
          .catch(() => undefined),
        player.shutdown(),
      ]),
    )
    .finally(() => {
      process.exitCode = 0;
    });
  setTimeout(() => {
    console.error("[backend] forced shutdown after grace period");
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
