import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
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

const player = new PlayerService();
const filesystemProvider = new LocalFilesystemProvider();
const pathService = PathService.forCurrentPlatform(filesystemProvider);
const sourceRepository = new SourceRepository();
const sources = new SourceService(
  filesystemProvider,
  pathService,
  sourceRepository,
);
const library = new DirectoryBrowserService(
  filesystemProvider,
  pathService,
  sources,
  () => player.getCurrentPath(),
);
const playerSession = new PlayerSessionService(
  new PlayerSessionRepository(),
  filesystemProvider,
  pathService,
  sources,
  player,
);
const events = new SseHub(player);
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
const bootstrapPromise = player
  .initialize()
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
    (await library.getArtworkResource(artworkId));
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
      await player.playQueueIndex(command.index);
      break;
    case "queue-append":
      await player.append(command.paths);
      break;
    case "queue-remove":
      await player.removeQueueItem(command.queueItemId);
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
      sendJson(response, 200, { ok: true, data: player.getState() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      const restore = await bootstrapPromise;
      sendJson(response, 200, {
        ok: true,
        data: {
          playerState: player.getState(),
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
      url.pathname === "/api/library/diagnostics"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: library.getDiagnostics(),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/sources/local") {
      const body = addSourceBody(await readBody(request));
      sendJson(response, 201, {
        ok: true,
        data: await sources.addLocal(body.nativePath),
      });
      return;
    }
    const sourceMatch = /^\/api\/sources\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (sourceMatch && request.method === "PATCH") {
      const sourceId = sourceMatch[1] ?? "";
      const body = renameSourceBody(await readBody(request));
      sendJson(response, 200, {
        ok: true,
        data: await sources.rename(sourceId, body.displayName),
      });
      return;
    }
    if (sourceMatch && request.method === "DELETE") {
      const sourceId = sourceMatch[1] ?? "";
      await readBody(request);
      await sources.remove(sourceId);
      library.invalidateSource(sourceId);
      sendJson(response, 200, { ok: true });
      return;
    }
    const retryMatch = /^\/api\/sources\/([0-9a-f-]{36})\/retry$/i.exec(
      url.pathname,
    );
    if (retryMatch && request.method === "POST") {
      const sourceId = retryMatch[1] ?? "";
      await readBody(request);
      library.invalidateSource(sourceId);
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
        data: await library.browse(
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
        data: await library.folderArtworkFor(
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
      const queue = await library.queueForDirectoryWithOrigins(
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
          await player.openResolvedQueue(queue.paths, 0, origins);
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
          data: await library.metadataFor(sourceId, entryId),
        });
        return;
      }
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        action === "artwork"
      ) {
        const resource = await library.artworkFor(sourceId, entryId);
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
        const queue = await library.queueForEntry(sourceId, entryId);
        await player.openResolvedQueue(
          queue.paths,
          queue.selectedIndex,
          queue.relativePaths.map((relativePath) => ({
            kind: "folders" as const,
            sourceId,
            relativePath,
          })),
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
        const path = await library.pathForEntry(sourceId, entryId);
        const appendedCount = await player.append(
          [path],
          [
            {
              kind: "folders",
              sourceId,
              relativePath: library.relativePathForEntry(sourceId, entryId),
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
        mode === "spectrumMono" || mode === "spectrumStereo" ? mode : "meter",
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
      error instanceof PlayerError || error instanceof FilesystemError
        ? error
        : new PlayerError(
            "INTERNAL_ERROR",
            "The player could not complete the request.",
            500,
          );
    if (!(error instanceof PlayerError) && !(error instanceof FilesystemError))
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
        library.close(),
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
