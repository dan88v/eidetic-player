import { createReadStream, type Stats } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { dirname, extname, relative, resolve, sep } from "node:path";
import type {
  RemoteAudioOutputState,
  RemoteBootstrap,
  RemoteCommandMetadata,
  RemoteEventEnvelope,
  RemoteEventName,
  RemotePlayerProgress,
  RemotePlayerState,
  RemotePlayerTrack,
  RemoteQueueItem,
} from "../../../../packages/shared/src/remote-access.js";
import {
  REMOTE_ACCESS_DEVICE_INACTIVITY_DAYS,
  REMOTE_ACCESS_PORT,
} from "../../../../packages/shared/src/remote-access.js";
import type { AudioOutputState } from "../../../../packages/shared/src/audio-output.js";
import type {
  IndexedLibrarySnapshot,
  LibrarySource,
} from "../../../../packages/shared/src/library.js";
import type {
  ArtworkRef,
  CurrentPlaybackView,
  ExplicitQueueItem,
  PlaybackContextSummary,
  PlaybackContinuationSummary,
  PlaybackHistoryCapabilities,
  PlayerState,
  PublicPlaybackItem,
} from "../../../../packages/shared/src/player.js";
import { remoteIpv4, RemoteAccessService } from "./remote-access-service.js";

const SESSION_COOKIE = "eidetic_remote_session";
const MAX_BODY_BYTES = 16 * 1024;
const HEARTBEAT_MILLISECONDS = 25_000;
const RATE_WINDOW_MILLISECONDS = 60_000;
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

export type RemoteLibraryRead =
  | "albums"
  | "artists"
  | "tracks"
  | "search"
  | "favorites-tracks"
  | "favorites-albums"
  | "favorites-artists"
  | "recently-played"
  | "most-played"
  | "playlists";

export type RemoteLibraryAction =
  | "play"
  | "queue"
  | "queue-track"
  | "play-search"
  | "play-favorites-tracks"
  | "play-favorites-albums"
  | "play-favorites-artists"
  | "play-recently-played"
  | "play-most-played"
  | "play-playlist"
  | "queue-playlist";

export interface RemoteGatewayAdapters {
  readonly buildId: string;
  playerState(): PlayerState;
  audioOutput(): AudioOutputState;
  outputLevel(): {
    readonly mode: "fixed" | "variable";
    readonly maximumSoftwareVolume: number;
  };
  sources(): Promise<readonly LibrarySource[]>;
  librarySnapshot(): Promise<IndexedLibrarySnapshot>;
  subscribePlayer(listener: (state: PlayerState) => void): () => void;
  subscribeAudioOutput(listener: (state: AudioOutputState) => void): () => void;
  subscribeLibrary(
    listener: (state: IndexedLibrarySnapshot) => void,
  ): Promise<() => void>;
  command(
    action: string,
    body: Record<string, unknown>,
    metadata: RemoteCommandMetadata,
  ): Promise<unknown>;
  libraryRead(
    operation: RemoteLibraryRead,
    query: URLSearchParams,
  ): Promise<unknown>;
  libraryAction(
    operation: RemoteLibraryAction,
    body: Record<string, unknown>,
  ): Promise<unknown>;
  browseSources(): Promise<readonly LibrarySource[]>;
  browse(sourceId: string, relativePath: string): Promise<unknown>;
  browseAction(
    sourceId: string,
    action: "play" | "queue",
    body: Record<string, unknown>,
  ): Promise<unknown>;
  artwork(kind: "player" | "queue", id: string): Promise<RemoteArtwork | null>;
  wakeDisplay(): Promise<void>;
  wakeAvailable(): boolean;
}

export interface RemoteArtwork {
  readonly path: string;
  readonly mimeType: string;
  readonly etag: string;
}

interface RateEntry {
  startedAt: number;
  count: number;
}

interface StreamEntry {
  readonly response: ServerResponse;
  readonly heartbeat: NodeJS.Timeout;
}

export function resolveRemoteUiStaticRoot(
  production = process.env.NODE_ENV === "production",
  moduleUrl = import.meta.url,
): string {
  return production
    ? resolve(dirname(fileURLToPath(moduleUrl)), "../../../../..", "remote-ui")
    : resolve(process.cwd(), "dist", "remote-ui");
}

function remoteArtwork(artwork: ArtworkRef | null): ArtworkRef | null {
  return artwork
    ? {
        id: artwork.id,
        mimeType: artwork.mimeType,
        sourceType: artwork.sourceType,
        revision: artwork.revision,
      }
    : null;
}

function remoteCurrentTrack(
  track: PlayerState["currentTrack"],
): RemotePlayerTrack | null {
  if (!track) return null;
  return {
    filename: track.filename,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artists: [...track.artists],
    albumArtist: track.albumArtist,
    trackNumber: track.trackNumber,
    trackTotal: track.trackTotal,
    discNumber: track.discNumber,
    discTotal: track.discTotal,
    year: track.year,
    genre: [...track.genre],
    durationSeconds: track.durationSeconds,
    format: track.format,
    codec: track.codec,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    bitrate: track.bitrate,
    lossless: track.lossless,
    container: track.container,
    artwork: remoteArtwork(track.artwork),
    source: track.source,
  };
}

function remotePlaybackItem(item: PublicPlaybackItem): PublicPlaybackItem {
  return {
    filename: item.filename,
    displayTitle: item.displayTitle,
    artist: item.artist,
    album: item.album,
    durationSeconds: item.durationSeconds,
    artwork: remoteArtwork(item.artwork),
    available: item.available,
    libraryTrackId: item.libraryTrackId,
  };
}

function remoteCurrentPlayback(
  current: CurrentPlaybackView | null | undefined,
): CurrentPlaybackView | null {
  if (!current) return null;
  return {
    playbackInstanceId: current.playbackInstanceId,
    source: current.source,
    relationId: current.relationId,
    contextId: current.contextId,
    historyEntryId: current.historyEntryId,
    startedSequence: current.startedSequence,
    item: remotePlaybackItem(current.item),
  };
}

function remoteExplicitQueue(
  queue: readonly ExplicitQueueItem[] | undefined,
): readonly ExplicitQueueItem[] {
  return (queue ?? []).map((entry) => ({
    explicitQueueEntryId: entry.explicitQueueEntryId,
    playbackInstanceId: entry.playbackInstanceId,
    index: entry.index,
    item: remotePlaybackItem(entry.item),
  }));
}

function remotePlaybackContext(
  context: PlaybackContextSummary | null | undefined,
): PlaybackContextSummary | null {
  if (!context) return null;
  return {
    contextId: context.contextId,
    kind: context.kind,
    entityId: context.entityId,
    title: context.title,
    sourceLabel: context.sourceLabel,
    nextItem: context.nextItem ? remotePlaybackItem(context.nextItem) : null,
    remainingCount: context.remainingCount,
    totalCount: context.totalCount,
    cycle: context.cycle,
  };
}

function remotePlaybackHistory(
  history: PlaybackHistoryCapabilities | undefined,
): PlaybackHistoryCapabilities {
  return history
    ? {
        entryCount: history.entryCount,
        cursor: history.cursor,
        canGoBack: history.canGoBack,
        canGoForward: history.canGoForward,
      }
    : {
        entryCount: 0,
        cursor: -1,
        canGoBack: false,
        canGoForward: false,
      };
}

function remotePlaybackContinuation(
  continuation: PlaybackContinuationSummary | undefined,
): PlaybackContinuationSummary {
  return continuation
    ? {
        mode: continuation.mode,
        artistId: continuation.artistId,
        artistName: continuation.artistName,
        active: continuation.active,
      }
    : {
        mode: "off",
        artistId: null,
        artistName: null,
        active: false,
      };
}

function remoteCompatibilityQueueItem(
  entry: ExplicitQueueItem,
): RemoteQueueItem {
  return {
    id: entry.explicitQueueEntryId,
    index: entry.index,
    filename: entry.item.filename,
    displayTitle: entry.item.displayTitle,
    durationSeconds: entry.item.durationSeconds,
    artwork: remoteArtwork(entry.item.artwork),
    isCurrent: false,
    available: entry.item.available,
    ...(entry.item.libraryTrackId
      ? { libraryTrackId: entry.item.libraryTrackId }
      : {}),
  };
}

export function remotePlayerState(state: PlayerState): RemotePlayerState {
  const explicitQueue = remoteExplicitQueue(state.explicitQueue);
  return {
    trackTransitionId: state.trackTransitionId,
    status: state.status,
    mpvAvailable: state.mpvAvailable,
    canGoNext: state.canGoNext !== false,
    currentTrack: remoteCurrentTrack(state.currentTrack),
    currentPlayback: remoteCurrentPlayback(state.currentPlayback),
    explicitQueue,
    playbackContext: remotePlaybackContext(state.playbackContext),
    playbackHistory: remotePlaybackHistory(state.playbackHistory),
    playbackContinuation: remotePlaybackContinuation(
      state.playbackContinuation,
    ),
    positionSeconds: state.positionSeconds,
    durationSeconds: state.durationSeconds,
    paused: state.paused,
    volume: state.volume,
    muted: state.muted,
    shuffleEnabled: state.shuffleEnabled,
    repeatMode: state.repeatMode,
    queue: explicitQueue.map(remoteCompatibilityQueueItem),
    queueRevision: state.queueRevision,
    contextRevision: state.contextRevision ?? 0,
    error: state.error
      ? { code: state.error.code, message: state.error.message }
      : null,
  };
}

export function remotePlayerProgress(state: PlayerState): RemotePlayerProgress {
  return {
    trackTransitionId: state.trackTransitionId,
    status: state.status,
    mpvAvailable: state.mpvAvailable,
    positionSeconds: state.positionSeconds,
    durationSeconds: state.durationSeconds,
    paused: state.paused,
    volume: state.volume,
    muted: state.muted,
    shuffleEnabled: state.shuffleEnabled,
    repeatMode: state.repeatMode,
    error: state.error
      ? { code: state.error.code, message: state.error.message }
      : null,
  };
}

function remotePlayerPresentationSignature(state: PlayerState): string {
  const explicitQueue = state.explicitQueue ?? [];
  return JSON.stringify({
    trackTransitionId: state.trackTransitionId,
    canGoNext: state.canGoNext !== false,
    currentTrack: remoteCurrentTrack(state.currentTrack),
    currentPlayback: remoteCurrentPlayback(state.currentPlayback),
    queueRevision: state.queueRevision,
    explicitQueueLength: explicitQueue.length,
    firstExplicitQueueEntryId: explicitQueue[0]?.explicitQueueEntryId ?? null,
    lastExplicitQueueEntryId:
      explicitQueue.at(-1)?.explicitQueueEntryId ?? null,
    contextRevision: state.contextRevision ?? 0,
    playbackContext: remotePlaybackContext(state.playbackContext),
    playbackHistory: remotePlaybackHistory(state.playbackHistory),
    playbackContinuation: remotePlaybackContinuation(
      state.playbackContinuation,
    ),
  });
}

export type RemotePlayerStreamEvent =
  | { readonly type: "player"; readonly data: RemotePlayerState }
  | {
      readonly type: "player-progress";
      readonly data: RemotePlayerProgress;
    };

export class RemotePlayerStreamProjector {
  private presentationSignature: string | null = null;
  private explicitQueueReference: PlayerState["explicitQueue"] = undefined;

  seed(state: PlayerState): void {
    this.presentationSignature = remotePlayerPresentationSignature(state);
    this.explicitQueueReference = state.explicitQueue;
  }

  project(state: PlayerState): RemotePlayerStreamEvent {
    const signature = remotePlayerPresentationSignature(state);
    if (
      signature !== this.presentationSignature ||
      state.explicitQueue !== this.explicitQueueReference
    ) {
      this.presentationSignature = signature;
      this.explicitQueueReference = state.explicitQueue;
      return { type: "player", data: remotePlayerState(state) };
    }
    return { type: "player-progress", data: remotePlayerProgress(state) };
  }

  reset(): void {
    this.presentationSignature = null;
    this.explicitQueueReference = undefined;
  }
}

export function remoteAudioOutput(
  state: AudioOutputState,
): RemoteAudioOutputState {
  const selected = state.canonicalOutputs.find(
    (output) => output.id === state.selectedPhysicalOutputId,
  );
  return {
    mpvAvailable: state.mpvAvailable,
    status: state.status,
    currentOutput: selected?.description ?? state.preferredDevice.description,
    revision: state.revision,
  };
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
  );
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.setHeader("x-frame-options", "DENY");
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.writableEnded) return;
  const body = JSON.stringify(value);
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.writeHead(status);
  response.end(body);
}

function errorResponse(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, {
    ok: false,
    error: { code, message },
  });
}

function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of header?.split(";") ?? []) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key && value) result.set(key, value);
  }
  return result;
}

async function readJson(
  request: IncomingMessage,
  maximum = MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim();
  if (contentType !== "application/json")
    throw Object.assign(new Error("JSON is required."), { status: 415 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > maximum)
      throw Object.assign(new Error("Request body is too large."), {
        status: 413,
      });
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("JSON is invalid."), { status: 400 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Object.assign(new Error("JSON object is required."), { status: 400 });
  return value as Record<string, unknown>;
}

function commandMetadata(body: Record<string, unknown>): RemoteCommandMetadata {
  if (
    typeof body.clientSessionId !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(body.clientSessionId) ||
    typeof body.intentId !== "number" ||
    !Number.isSafeInteger(body.intentId) ||
    body.intentId < 1
  )
    throw Object.assign(new Error("Command metadata is invalid."), {
      status: 400,
    });
  return {
    clientSessionId: body.clientSessionId,
    intentId: body.intentId,
  };
}

function allowedHostnames(fixture: boolean): Set<string> {
  const result = new Set<string>();
  if (fixture) {
    result.add(`127.0.0.1:${String(REMOTE_ACCESS_PORT)}`);
    result.add(`localhost:${String(REMOTE_ACCESS_PORT)}`);
  }
  return result;
}

function pathnameIsSafe(pathname: string): boolean {
  if (
    pathname.includes("\0") ||
    pathname.includes("\\") ||
    pathname.split("/").some((part) => part === "." || part === "..")
  )
    return false;
  try {
    return decodeURIComponent(pathname)
      .split("/")
      .every((part) => part !== "." && part !== ".." && !part.includes("\\"));
  } catch {
    return false;
  }
}

export class RemoteGateway {
  private server: Server | null = null;
  private staticRootRealPath: string | null = null;
  private readonly streams = new Map<string, StreamEntry>();
  private readonly rateEntries = new Map<string, RateEntry>();
  private readonly subscriptions: (() => void)[] = [];
  private readonly playerStreamProjector = new RemotePlayerStreamProjector();
  private eventRevision = 0;
  private readonly unsubscribeRevoke: () => void;

  constructor(
    private readonly service: RemoteAccessService,
    private readonly adapters: RemoteGatewayAdapters,
    private readonly staticRoot: string,
  ) {
    this.unsubscribeRevoke = service.onRevoke((deviceId) => {
      if (deviceId) this.closeStream(deviceId);
      else this.closeStreams();
    });
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.staticRootRealPath = await realpath(this.staticRoot);
    const server = createServer((request, response) => {
      securityHeaders(response);
      void this.handle(request, response);
    });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxRequestsPerSocket = 100;
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolvePromise();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(REMOTE_ACCESS_PORT, "0.0.0.0");
    });
    this.server = server;
    try {
      this.playerStreamProjector.seed(this.adapters.playerState());
      this.subscriptions.push(
        this.adapters.subscribePlayer((state) => {
          const event = this.playerStreamProjector.project(state);
          this.broadcast(event.type, event.data);
        }),
        this.adapters.subscribeAudioOutput((state) => {
          this.broadcast("audio-output", remoteAudioOutput(state));
        }),
      );
      const unsubscribeLibrary = await this.adapters.subscribeLibrary(
        (state) => {
          this.broadcast("library-scan", state.status);
          this.broadcast("library-invalidated", {
            historyRevision: state.historyRevision,
            statsRevision: state.statsRevision,
            playlistRevision: state.playlistRevision ?? 0,
          });
        },
      );
      this.subscriptions.push(unsubscribeLibrary);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.closeStreams();
    this.playerStreamProjector.reset();
    this.rateEntries.clear();
    while (this.subscriptions.length > 0) this.subscriptions.pop()?.();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolvePromise) => {
      server.close(() => {
        resolvePromise();
      });
      server.closeIdleConnections();
      server.closeAllConnections();
    });
  }

  async close(): Promise<void> {
    this.unsubscribeRevoke();
    await this.stop();
  }

  connectionCount(): number {
    return this.streams.size;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const remoteAddress = remoteIpv4(
        request.socket.remoteAddress,
        this.service.developmentFixture,
      );
      if (!remoteAddress) {
        errorResponse(response, 403, "LAN_ONLY", "LAN access is required.");
        return;
      }
      const host = request.headers.host?.toLowerCase() ?? "";
      const allowed = this.allowedHosts();
      if (!allowed.has(host)) {
        errorResponse(response, 400, "INVALID_HOST", "Host is not allowed.");
        return;
      }
      const expectedOrigin = `http://${host}`;
      const origin = request.headers.origin;
      if (origin && origin !== expectedOrigin) {
        errorResponse(
          response,
          403,
          "INVALID_ORIGIN",
          "Origin is not allowed.",
        );
        return;
      }
      if (request.method === "OPTIONS") {
        response.setHeader("allow", "GET, HEAD, POST, DELETE");
        errorResponse(
          response,
          405,
          "METHOD_NOT_ALLOWED",
          "Preflight requests are not supported.",
        );
        return;
      }
      const url = new URL(request.url ?? "/", expectedOrigin);
      if (!pathnameIsSafe(url.pathname)) {
        errorResponse(response, 400, "INVALID_PATH", "Path is invalid.");
        return;
      }
      if (url.pathname === "/api/pairing/status" && request.method === "GET") {
        const authenticated = await this.authenticate(request);
        sendJson(response, 200, {
          ok: true,
          data: {
            pairingAvailable:
              this.service.snapshot(false).status === "listening",
            authenticated: authenticated !== null,
          },
        });
        return;
      }
      if (url.pathname === "/api/pair" && request.method === "POST") {
        if (!origin) {
          errorResponse(response, 403, "INVALID_ORIGIN", "Origin is required.");
          return;
        }
        if (!this.takeRate(`pair:${remoteAddress}`, 5)) {
          errorResponse(
            response,
            429,
            "RATE_LIMITED",
            "Too many pairing attempts.",
          );
          return;
        }
        const body = await readJson(request, 2 * 1024);
        const paired = await this.service.pair(
          body.code,
          body.deviceName,
          remoteAddress,
        );
        response.setHeader(
          "set-cookie",
          `${SESSION_COOKIE}=${paired.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(REMOTE_ACCESS_DEVICE_INACTIVITY_DAYS * 24 * 60 * 60)}`,
        );
        sendJson(response, 201, {
          ok: true,
          data: {
            device: paired.device,
            csrfToken: paired.csrfToken,
          },
        });
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        await this.serveStatic(request, response, url.pathname);
        return;
      }
      const authenticated = await this.authenticate(request);
      if (!authenticated) {
        if (!this.takeRate(`authentication:${remoteAddress}`, 30)) {
          errorResponse(
            response,
            429,
            "RATE_LIMITED",
            "Too many authentication failures.",
          );
          return;
        }
        errorResponse(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Pair this browser again.",
        );
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        if (
          !origin ||
          !this.service.validateCsrf(
            authenticated.device.id,
            request.headers["x-eidetic-csrf"] as string | undefined,
          )
        ) {
          errorResponse(response, 403, "INVALID_CSRF", "Request is invalid.");
          return;
        }
        if (!this.takeRate(`mutation:${remoteAddress}`, 120)) {
          errorResponse(response, 429, "RATE_LIMITED", "Too many commands.");
          return;
        }
      }
      if (url.pathname === "/api/logout" && request.method === "POST") {
        response.setHeader(
          "set-cookie",
          `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
        );
        this.closeStream(authenticated.device.id);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api/bootstrap" && request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          data: await this.bootstrap(authenticated),
        });
        return;
      }
      if (url.pathname === "/api/events" && request.method === "GET") {
        if (!this.takeRate(`stream:${remoteAddress}`, 20)) {
          errorResponse(
            response,
            429,
            "RATE_LIMITED",
            "Too many stream requests.",
          );
          return;
        }
        this.openStream(authenticated.device.id, response);
        return;
      }
      if (url.pathname === "/api/display/wake" && request.method === "POST") {
        await readJson(request, 512);
        if (!this.adapters.wakeAvailable())
          throw Object.assign(new Error("Display wake is unavailable."), {
            status: 404,
          });
        await this.adapters.wakeDisplay();
        sendJson(response, 200, { ok: true });
        return;
      }
      const artworkMatch =
        /^\/api\/artwork\/(player|queue)\/([A-Za-z0-9-]{1,128})$/u.exec(
          url.pathname,
        );
      if (
        artworkMatch &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        await this.serveArtwork(
          request,
          response,
          artworkMatch[1] as "player" | "queue",
          artworkMatch[2] ?? "",
        );
        return;
      }
      const commandMatch =
        /^\/api\/player\/(play|pause|play-pause|next|previous|seek|volume|mute|shuffle|repeat)$/u.exec(
          url.pathname,
        );
      if (commandMatch && request.method === "POST") {
        const body = await readJson(request);
        const metadata = commandMetadata(body);
        const data = await this.adapters.command(
          commandMatch[1] ?? "",
          body,
          metadata,
        );
        sendJson(response, 200, {
          ok: true,
          data: remotePlayerState(data as PlayerState),
        });
        return;
      }
      const queueMatch = /^\/api\/queue\/(play|reorder|remove|clear)$/u.exec(
        url.pathname,
      );
      if (queueMatch && request.method === "POST") {
        const body = await readJson(request);
        if (queueMatch[1] === "clear" && body.confirm !== true)
          throw Object.assign(
            new Error("Queue clear requires explicit confirmation."),
            { status: 400 },
          );
        const metadata = commandMetadata(body);
        const data = await this.adapters.command(
          `queue-${queueMatch[1] ?? ""}`,
          body,
          metadata,
        );
        sendJson(response, 200, {
          ok: true,
          data: remotePlayerState(data as PlayerState),
        });
        return;
      }
      if (url.pathname === "/api/context/clear" && request.method === "POST") {
        const body = await readJson(request, 512);
        const data = await this.adapters.command(
          "context-clear",
          body,
          commandMetadata(body),
        );
        sendJson(response, 200, {
          ok: true,
          data: remotePlayerState(data as PlayerState),
        });
        return;
      }
      if (url.pathname === "/api/library/sources" && request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          data: { sources: await this.adapters.browseSources() },
        });
        return;
      }
      const libraryReads = new Map<string, RemoteLibraryRead>([
        ["/api/library/albums", "albums"],
        ["/api/library/artists", "artists"],
        ["/api/library/tracks", "tracks"],
        ["/api/library/search", "search"],
        ["/api/library/favorites/tracks", "favorites-tracks"],
        ["/api/library/favorites/albums", "favorites-albums"],
        ["/api/library/favorites/artists", "favorites-artists"],
        ["/api/library/recently-played", "recently-played"],
        ["/api/library/most-played", "most-played"],
        ["/api/library/playlists", "playlists"],
      ]);
      const libraryRead = libraryReads.get(url.pathname);
      if (libraryRead && request.method === "GET") {
        if (
          libraryRead === "search" &&
          !this.takeRate(`search:${remoteAddress}`, 30)
        ) {
          errorResponse(response, 429, "RATE_LIMITED", "Too many searches.");
          return;
        }
        sendJson(response, 200, {
          ok: true,
          data: await this.adapters.libraryRead(libraryRead, url.searchParams),
        });
        return;
      }
      const libraryActions = new Map<string, RemoteLibraryAction>([
        ["/api/library/play", "play"],
        ["/api/library/queue", "queue"],
        ["/api/library/tracks/queue", "queue-track"],
        ["/api/library/search/play", "play-search"],
        ["/api/library/favorites/tracks/play", "play-favorites-tracks"],
        ["/api/library/favorites/albums/play", "play-favorites-albums"],
        ["/api/library/favorites/artists/play", "play-favorites-artists"],
        ["/api/library/recently-played/play", "play-recently-played"],
        ["/api/library/most-played/play", "play-most-played"],
        ["/api/library/playlists/play", "play-playlist"],
        ["/api/library/playlists/queue", "queue-playlist"],
      ]);
      const libraryAction = libraryActions.get(url.pathname);
      if (libraryAction && request.method === "POST") {
        const body = await readJson(request);
        sendJson(response, 200, {
          ok: true,
          data: await this.adapters.libraryAction(libraryAction, body),
        });
        return;
      }
      const browseMatch = /^\/api\/browse\/([0-9a-f-]{36})$/iu.exec(
        url.pathname,
      );
      if (browseMatch && request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          data: await this.adapters.browse(
            browseMatch[1] ?? "",
            url.searchParams.get("relativePath") ?? "",
          ),
        });
        return;
      }
      const browseActionMatch =
        /^\/api\/browse\/([0-9a-f-]{36})\/(play|queue)$/iu.exec(url.pathname);
      if (browseActionMatch && request.method === "POST") {
        const body = await readJson(request);
        sendJson(response, 200, {
          ok: true,
          data: await this.adapters.browseAction(
            browseActionMatch[1] ?? "",
            browseActionMatch[2] as "play" | "queue",
            body,
          ),
        });
        return;
      }
      errorResponse(response, 404, "NOT_FOUND", "Endpoint not found.");
    } catch (error) {
      const status =
        error &&
        typeof error === "object" &&
        "status" in error &&
        typeof error.status === "number"
          ? error.status
          : 400;
      errorResponse(
        response,
        status,
        status >= 500 ? "REMOTE_ERROR" : "INVALID_REQUEST",
        status >= 500
          ? "The remote request could not be completed."
          : error instanceof Error
            ? error.message
            : "The remote request is invalid.",
      );
    }
  }

  private allowedHosts(): Set<string> {
    const hosts = allowedHostnames(this.service.developmentFixture);
    for (const address of this.service.snapshot(false).addresses) {
      try {
        hosts.add(new URL(address).host.toLowerCase());
      } catch {
        // Snapshot addresses are generated internally and already validated.
      }
    }
    return hosts;
  }

  private async authenticate(request: IncomingMessage) {
    return this.service.authenticate(
      parseCookies(request.headers.cookie).get(SESSION_COOKIE) ?? null,
    );
  }

  private async bootstrap(
    authenticated: NonNullable<
      Awaited<ReturnType<RemoteGateway["authenticate"]>>
    >,
  ): Promise<RemoteBootstrap> {
    const [sources, library] = await Promise.all([
      this.adapters.sources(),
      this.adapters.librarySnapshot(),
    ]);
    const output = this.adapters.outputLevel();
    return {
      device: authenticated.device,
      buildId: this.adapters.buildId,
      player: remotePlayerState(this.adapters.playerState()),
      audioOutput: remoteAudioOutput(this.adapters.audioOutput()),
      outputLevelMode: output.mode,
      maximumSoftwareVolume: output.maximumSoftwareVolume,
      sources,
      library: library.summary,
      capabilities: {
        player: this.adapters.playerState().mpvAvailable,
        queue: true,
        library: true,
        browse: true,
        wakeDisplay: this.adapters.wakeAvailable(),
      },
      csrfToken: authenticated.csrfToken,
      eventRevision: this.eventRevision,
    };
  }

  private openStream(deviceId: string, response: ServerResponse): void {
    this.closeStream(deviceId);
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("connection", "keep-alive");
    response.flushHeaders();
    const heartbeat = setInterval(() => {
      if (!response.write(": heartbeat\n\n")) this.closeStream(deviceId);
    }, HEARTBEAT_MILLISECONDS);
    heartbeat.unref();
    this.streams.set(deviceId, { response, heartbeat });
    response.on("close", () => {
      const current = this.streams.get(deviceId);
      if (current?.response === response) {
        clearInterval(current.heartbeat);
        this.streams.delete(deviceId);
      }
    });
    this.sendEvent(deviceId, "snapshot", {
      player: remotePlayerState(this.adapters.playerState()),
      audioOutput: remoteAudioOutput(this.adapters.audioOutput()),
    });
  }

  private broadcast(type: RemoteEventName, data: unknown): void {
    for (const deviceId of this.streams.keys())
      this.sendEvent(deviceId, type, data);
  }

  private sendEvent(
    deviceId: string,
    type: RemoteEventName,
    data: unknown,
  ): void {
    const stream = this.streams.get(deviceId);
    if (!stream) return;
    const envelope: RemoteEventEnvelope = {
      revision: ++this.eventRevision,
      type,
      data,
    };
    const payload = `id: ${String(envelope.revision)}\nevent: ${type}\ndata: ${JSON.stringify(envelope)}\n\n`;
    if (!stream.response.write(payload)) this.closeStream(deviceId);
  }

  private closeStream(deviceId: string): void {
    const stream = this.streams.get(deviceId);
    if (!stream) return;
    clearInterval(stream.heartbeat);
    this.streams.delete(deviceId);
    stream.response.end();
  }

  private closeStreams(): void {
    for (const deviceId of [...this.streams.keys()]) this.closeStream(deviceId);
  }

  private takeRate(key: string, maximum: number): boolean {
    const now = Date.now();
    let entry = this.rateEntries.get(key);
    if (!entry || now - entry.startedAt >= RATE_WINDOW_MILLISECONDS) {
      entry = { startedAt: now, count: 0 };
      this.rateEntries.set(key, entry);
    }
    entry.count += 1;
    if (this.rateEntries.size > 512) {
      const oldestKey = this.rateEntries.keys().next().value;
      if (oldestKey !== undefined) this.rateEntries.delete(oldestKey);
    }
    return entry.count <= maximum;
  }

  private async serveStatic(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      errorResponse(
        response,
        405,
        "METHOD_NOT_ALLOWED",
        "Method is not allowed.",
      );
      return;
    }
    const relativePath =
      pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    const candidate = resolve(this.staticRoot, relativePath);
    const relativeCandidate = relative(resolve(this.staticRoot), candidate);
    if (
      relativeCandidate.startsWith(`..${sep}`) ||
      relativeCandidate === ".."
    ) {
      errorResponse(response, 404, "NOT_FOUND", "Asset not found.");
      return;
    }
    const extension = extname(candidate).toLowerCase();
    const mimeType = MIME_TYPES.get(extension);
    if (!mimeType || extension === ".map") {
      errorResponse(response, 404, "NOT_FOUND", "Asset not found.");
      return;
    }
    let stats: Stats;
    try {
      const links = await lstat(candidate);
      if (links.isSymbolicLink()) throw new Error("symlink");
      const canonical = await realpath(candidate);
      if (
        !this.staticRootRealPath ||
        (canonical !== this.staticRootRealPath &&
          !canonical.startsWith(`${this.staticRootRealPath}${sep}`))
      )
        throw new Error("escape");
      stats = await stat(canonical);
      if (!stats.isFile()) throw new Error("not-file");
    } catch {
      errorResponse(response, 404, "NOT_FOUND", "Asset not found.");
      return;
    }
    const etag = `"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304);
      response.end();
      return;
    }
    response.setHeader("content-type", mimeType);
    response.setHeader("content-length", stats.size);
    response.setHeader("etag", etag);
    response.setHeader(
      "cache-control",
      relativePath === "index.html"
        ? "no-cache"
        : /-[A-Za-z0-9_-]{8,}\./u.test(relativePath)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
    );
    response.writeHead(200);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(candidate).pipe(response);
  }

  private async serveArtwork(
    request: IncomingMessage,
    response: ServerResponse,
    kind: "player" | "queue",
    id: string,
  ): Promise<void> {
    const artwork = await this.adapters.artwork(kind, id);
    if (!artwork) {
      errorResponse(response, 404, "NOT_FOUND", "Artwork not found.");
      return;
    }
    if (request.headers["if-none-match"] === artwork.etag) {
      response.writeHead(304);
      response.end();
      return;
    }
    const body = await readFile(artwork.path);
    response.setHeader("content-type", artwork.mimeType);
    response.setHeader("content-length", body.length);
    response.setHeader("etag", artwork.etag);
    response.setHeader("cache-control", "private, max-age=3600");
    response.writeHead(200);
    if (request.method === "HEAD") response.end();
    else response.end(body);
  }
}
