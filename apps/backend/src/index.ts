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

const player = new PlayerService();
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
  const resource = await player.getArtworkResource(artworkId);
  if (!resource) return false;
  response.setHeader("etag", resource.etag);
  response.setHeader("cache-control", "private, max-age=31536000, immutable");
  response.setHeader("x-content-type-options", "nosniff");
  if (request.headers["if-none-match"] === resource.etag) {
    response.writeHead(304);
    response.end();
    return true;
  }
  response.setHeader("content-type", resource.mimeType);
  response.setHeader("content-length", String(resource.size));
  if (request.method === "HEAD") {
    response.writeHead(200);
    response.end();
    return true;
  }
  response.writeHead(200);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(resource.path);
    stream.once("error", reject);
    response.once("close", resolve);
    response.once("finish", resolve);
    stream.pipe(response);
  });
  return true;
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
          "GET, POST, OPTIONS",
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
      error instanceof PlayerError
        ? error
        : new PlayerError(
            "INTERNAL_ERROR",
            "The player could not complete the request.",
            500,
          );
    if (!(error instanceof PlayerError))
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
  void player
    .initialize()
    .then(() => analyzer.initialize(player.getMpvExecutable() ?? undefined))
    .then(() => {
      preloadWaveforms(true);
    });
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[backend] received ${signal}, shutting down`);
  events.close();
  unsubscribeAnalyzerState();
  server.close();
  void Promise.all([
    visualizerEvents.close(),
    waveform.close(),
    player.shutdown(),
  ]).finally(() => {
    process.exitCode = 0;
  });
  setTimeout(() => {
    console.error("[backend] forced shutdown after grace period");
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
