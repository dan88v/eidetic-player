import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
import { performance } from "node:perf_hooks";
import type {
  ApiResponse,
  PlaybackContextQueueDecision,
} from "../../../packages/shared/src/player.js";
import type {
  HealthResponse,
  ReadinessResponse,
} from "../../../packages/shared/src/health.js";
import type { WaveformResponse } from "../../../packages/shared/src/visualizer.js";
import {
  playbackContextQueueDecision,
  validateCommandBody,
  type PlayerCommand,
} from "./api/command-validation.js";
import { SseHub } from "./api/sse-hub.js";
import { config } from "./config.js";
import { PlayerError } from "./player/player-error.js";
import { PlayerService } from "./player/player-service.js";
import { AudioAnalyzerService } from "./analysis/audio-analyzer-service.js";
import {
  buildReadinessResponse,
  type BootstrapReadiness,
} from "./readiness.js";
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
import type { PlayerRestoreResult } from "./player-session/player-session-types.js";
import { IndexedLibraryService } from "./library/library-service.js";
import { LibraryError } from "./library/library-errors.js";
import { LibrarySseHub } from "./api/library-sse-hub.js";
import { PlayHistoryTracker } from "./library/play-history-tracker.js";
import type {
  LibraryCancelScanRequest,
  LibraryContextRequest,
  LibraryScanRequest,
  LibrarySearchCategory,
  LibrarySearchPlayRequest,
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
import type {
  Ipv4Draft,
  WifiAdapterRequest,
  WifiConnectRequest,
  WifiHiddenConnectRequest,
  WifiRadioRequest,
  WifiSecurity,
} from "../../../packages/shared/src/network.js";
import { NetworkSseHub } from "./api/network-sse-hub.js";
import { AudioOutputService } from "./audio-output/audio-output-service.js";
import { prepareAudioOutputForSessionRestore } from "./audio-output/audio-output-bootstrap.js";
import { AudioOutputError } from "./audio-output/audio-output-error.js";
import { NetworkService } from "./network/network-service.js";
import { createPlatformNetworkAdapter } from "./network/platform-network-adapter.js";
import { NetworkAdapterError } from "./network/network-adapter.js";
import type {
  AddSmbConnectionRequest,
  EditSmbConnectionRequest,
} from "../../../packages/shared/src/smb.js";
import { SmbSseHub } from "./api/smb-sse-hub.js";
import {
  createPlatformSmbCredentialStore,
  SmbConnectionService,
} from "./smb/smb-connection-service.js";
import { createPlatformSmbAdapter } from "./smb/smb-platform-adapter.js";
import { SmbConnectionRepository } from "./smb/smb-connection-repository.js";
import { SmbError } from "./smb/smb-types.js";
import type {
  SystemCapabilities,
  SystemPowerAction,
} from "../../../packages/shared/src/system.js";
import {
  PowerActionCoordinator,
  PowerActionError,
  validatePowerActionBody,
} from "./system/power-action-coordinator.js";
import {
  createLinuxPowerActionAdapter,
  detectAvailablePowerActions,
} from "./system/linux-power-adapter.js";
import { loadBuildInfo } from "./system/build-info.js";
import {
  PreferencesError,
  PreferencesStore,
} from "./preferences/preferences-store.js";
import type {
  LegacyPreferencesMigration,
  PreferencesPatch,
} from "../../../packages/shared/src/preferences.js";
import type { AudioProcessingPatch } from "../../../packages/shared/src/audio-processing.js";
import { AudioProcessingService } from "./audio-processing/audio-processing-service.js";
import { AudioProcessingError } from "./audio-processing/audio-processing-error.js";
import { SoftwareUpdateService } from "./update/update-service.js";
import { UpdateSseHub } from "./update/update-sse-hub.js";
import { UpdateError } from "./update/update-errors.js";
import { PlayerRecoveryService } from "./player/player-recovery-service.js";
import {
  emptyUpdateBody,
  selectBranchBody,
  startUpdateBody,
} from "./update/update-validation.js";
import {
  isScreenDimLevelPercent,
  type ScreenDimLevelPercent,
} from "../../../packages/shared/src/display.js";
import { DisplayPowerService } from "./display/display-power-service.js";
import { createPlatformDisplayAdapter } from "./display/display-platform-adapter.js";
import { DisplayPowerError } from "./display/display-errors.js";
import { RemoteAccessService } from "./remote-access/remote-access-service.js";
import {
  RemoteGateway,
  resolveRemoteUiStaticRoot,
  type RemoteLibraryAction,
  type RemoteLibraryRead,
} from "./remote-access/remote-gateway.js";
import { RemoteAccessError } from "./remote-access/remote-access-error.js";

const applianceFixture =
  process.env.NODE_ENV !== "production" &&
  process.env.EIDETIC_APPLIANCE_FIXTURE === "1";
const applianceInstallation =
  process.platform === "linux" &&
  process.env.EIDETIC_INSTALLATION_MODE === "appliance";
const standardInstallation =
  process.platform === "linux" &&
  process.env.EIDETIC_INSTALLATION_MODE === "standard";
const installationMode =
  applianceInstallation || applianceFixture
    ? "appliance"
    : standardInstallation
      ? "standard"
      : "development";
const availablePowerActions: readonly SystemPowerAction[] =
  detectAvailablePowerActions(installationMode, process.platform);
const systemCapabilities: SystemCapabilities = {
  installationMode,
  availablePowerActions,
  maintenanceMode: availablePowerActions.includes("maintenance"),
  fullscreen: process.env.EIDETIC_FULLSCREEN === "1",
  hidePointerWhenInactive: process.env.EIDETIC_HIDE_POINTER === "1",
};
const buildInfo = loadBuildInfo(config.environment);
const softwareUpdate = new SoftwareUpdateService(
  buildInfo,
  installationMode === "appliance",
);
const softwareUpdateInitialization = softwareUpdate.initialize();
const preferences = new PreferencesStore();
const display = new DisplayPowerService(
  createPlatformDisplayAdapter(process.platform, installationMode),
);

const player = new PlayerService();
const audioProcessing = new AudioProcessingService(player, preferences);
const audioOutput = new AudioOutputService(player);
display.setAudioOutputState(audioOutput.snapshot());
const unsubscribeAudioDisplay = audioOutput.subscribe((state) => {
  display.setAudioOutputState(state);
});
player.setBeforePlaybackHook(() => audioOutput.prepareForPlayback());
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
const network = new NetworkService(
  createPlatformNetworkAdapter(),
  process.platform === "win32" ? 15_000 : 5_000,
);
const smb = new SmbConnectionService(
  filesystemProvider,
  pathService,
  new SmbConnectionRepository(),
  createPlatformSmbCredentialStore(),
  createPlatformSmbAdapter(),
);
const sources = new SourceService(
  filesystemProvider,
  pathService,
  sourceRepository,
  removableStorage,
  smb,
);
smb.configureLibraryDependencies((connectionId) =>
  sources.hasSmbSources(connectionId),
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
const smbFolders = new DirectoryBrowserService(
  filesystemProvider,
  pathService,
  smb,
  () => player.getCurrentPath(),
);
const indexedLibraryPromise = IndexedLibraryService.create(
  filesystemProvider,
  pathService,
  sourceRepository,
  sources,
  player,
);
void indexedLibraryPromise.then((library) => {
  player.setPrimaryArtistResolver((trackId) =>
    library.primaryArtistIdForTrack(trackId),
  );
  player.setSameArtistResolver((artistId) =>
    library.resolveSameArtistCandidates(artistId),
  );
});
async function persistentFolderOrigins(
  sourceId: string,
  relativePaths: readonly string[],
) {
  const [source, indexedLibrary] = await Promise.all([
    sources.getInternal(sourceId),
    indexedLibraryPromise,
  ]);
  return relativePaths.map((relativePath) => {
    const libraryTrackId = indexedLibrary.libraryTrackIdForSourcePath(
      sourceId,
      relativePath,
    );
    return {
      kind: "folders" as const,
      sourceId,
      relativePath,
      ...(libraryTrackId ? { libraryTrackId } : {}),
      ...(source.type === "removable"
        ? { removable: true as const }
        : source.type === "smb"
          ? { smb: true as const }
          : {}),
    };
  });
}
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
  smb,
);
const powerActions = new PowerActionCoordinator(
  availablePowerActions,
  () => playerSession.flush(),
  createLinuxPowerActionAdapter({
    executeHostActions: !applianceFixture,
    stopBackend: () => {
      shutdown("SIGTERM");
    },
  }),
);
const events = new SseHub(player, audioOutput, display);
const removableEvents = new RemovableStorageSseHub(removableStorage);
const networkEvents = new NetworkSseHub(network);
const smbEvents = new SmbSseHub(smb);
const updateEvents = new UpdateSseHub(softwareUpdate);
let previousSmbStates = new Map<string, boolean>();
let previousSmbConnectionVersions = new Map<string, string>();
let smbLibraryRefresh: Promise<void> = Promise.resolve();
const unsubscribeSmbPlayer = smb.subscribe((snapshot) => {
  const next = new Map(
    snapshot.connections.map((connection) => [
      connection.id,
      connection.readable,
    ]),
  );
  const nextVersions = new Map(
    snapshot.connections.map((connection) => [
      connection.id,
      `${String(connection.readable)}:${connection.connectedAt ?? ""}`,
    ]),
  );
  for (const connection of snapshot.connections) {
    const previous = previousSmbStates.get(connection.id);
    if (
      previousSmbConnectionVersions.get(connection.id) !==
      nextVersions.get(connection.id)
    )
      smbFolders.invalidateSource(connection.id);
    if (previous !== connection.readable)
      void player.setSmbConnectionAvailable(connection.id, connection.readable);
  }
  for (const [id] of previousSmbStates) {
    if (!next.has(id)) {
      smbFolders.invalidateSource(id);
      void player.setSmbConnectionAvailable(id, false);
    }
  }
  const affectedConnectionIds = [
    ...new Set([...previousSmbStates.keys(), ...next.keys()]),
  ].filter(
    (id) =>
      previousSmbStates.get(id) !== next.get(id) ||
      previousSmbConnectionVersions.get(id) !== nextVersions.get(id),
  );
  if (affectedConnectionIds.length > 0) {
    smbLibraryRefresh = smbLibraryRefresh
      .catch(() => undefined)
      .then(async () => {
        const sourceChanges = await sources.refreshSmbAvailability(
          affectedConnectionIds,
        );
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
        console.warn("[smb-library] availability refresh failed", error);
      });
  }
  previousSmbStates = next;
  previousSmbConnectionVersions = nextVersions;
});
let networkWasAvailable = false;
const unsubscribeNetworkSmb = network.subscribe((snapshot) => {
  const available = [...snapshot.wiredAdapters, ...snapshot.wifiAdapters].some(
    (adapter) => adapter.connected,
  );
  if (available && !networkWasAvailable)
    void smb.networkAvailable().catch(() => undefined);
  networkWasAvailable = available;
});
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
let bootstrapReadiness: BootstrapReadiness = "starting";
let bootstrapFailureCode: string | null = null;
let coreBootstrapReady = false;
let lastRestoreResult: PlayerRestoreResult = {
  status: "empty",
  savedCount: 0,
  restoredCount: 0,
  discardedCount: 0,
  readMilliseconds: 0,
  verificationMilliseconds: 0,
  prepareMilliseconds: 0,
};
function publicBootstrapErrorCode(error: unknown): string {
  return error instanceof PlayerError ? error.code : "BOOTSTRAP_FAILED";
}

const playerRecovery = new PlayerRecoveryService(async () => {
  if (!(await player.recover())) return false;
  try {
    await audioOutput.waitForInitialEnumeration(
      process.platform === "linux" && installationMode === "appliance",
    );
    await audioOutput.applyInitialPreference();
    lastRestoreResult = await playerSession.restore();
    await player.setContinuePlaybackMode(
      preferences.snapshot().preferences.continuePlaybackMode,
    );
    await audioProcessing.recoverAfterMpvRestart();
    bootstrapReadiness = "ready";
    bootstrapFailureCode = null;
    preloadWaveforms(true);
    return true;
  } catch (error) {
    bootstrapReadiness = "degraded";
    bootstrapFailureCode = publicBootstrapErrorCode(error);
    console.error("[player] recovery initialization failed", error);
    return false;
  }
});
const unsubscribePlayerRecovery = player.subscribe((state) => {
  if (!state.mpvAvailable && state.status === "unavailable")
    playerRecovery.startAutomaticRecovery();
});

const coreBootstrapPromise = Promise.all([
  removableStorage.start(),
  smb.initialize(),
  preferences.initialize(),
  display.initialize(),
]).then(async () => {
  await player.setContinuePlaybackMode(
    preferences.snapshot().preferences.continuePlaybackMode,
  );
  coreBootstrapReady = true;
});

const bootstrapPromise = Promise.all([
  player.initialize(),
  coreBootstrapPromise,
])
  .then(async () => {
    await prepareAudioOutputForSessionRestore(
      audioOutput,
      process.platform,
      installationMode,
    );
    const restore = await playerSession.restore();
    lastRestoreResult = restore;
    await player.setContinuePlaybackMode(
      preferences.snapshot().preferences.continuePlaybackMode,
    );
    await audioProcessing.initialize(preferences.snapshot());
    playerSession.start();
    await analyzer.initialize(player.getMpvExecutable() ?? undefined);
    const bootstrapState = player.getState();
    if (!bootstrapState.mpvAvailable) {
      bootstrapReadiness = "degraded";
      bootstrapFailureCode = bootstrapState.error?.code ?? "MPV_NOT_AVAILABLE";
      playerRecovery.startAutomaticRecovery();
      return restore;
    }
    bootstrapReadiness = "ready";
    preloadWaveforms(true);
    return restore;
  })
  .catch((error: unknown) => {
    bootstrapReadiness = "degraded";
    bootstrapFailureCode = publicBootstrapErrorCode(error);
    console.error("[backend] bootstrap failed", error);
    playerSession.start();
    throw error;
  });
void bootstrapPromise.catch(() => undefined);
void coreBootstrapPromise
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

async function readBody(
  request: IncomingMessage,
  maximumBytes = 256 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > maximumBytes)
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
  if (command.type === "volume")
    player.noteCommandApiReceived("volume", command.metadata);
  else if (command.type === "mute")
    player.noteCommandApiReceived("mute", command.metadata);
  else if (
    command.type === "play" ||
    command.type === "pause" ||
    command.type === "play-pause"
  )
    player.noteCommandApiReceived("transport", command.metadata);
  else if (
    command.type === "next" ||
    command.type === "previous" ||
    command.type === "queue-play"
  )
    player.noteCommandApiReceived("navigation", command.metadata);
  switch (command.type) {
    case "open":
      await player.open(command.paths, command.queueDecision);
      break;
    case "seek":
      await player.seek(command.positionSeconds);
      analyzer.restartAtCurrentPosition();
      break;
    case "volume":
      await audioProcessing.setVolume(command.volume, command.metadata);
      break;
    case "mute":
      await audioProcessing.setMuted(command.muted, command.metadata);
      break;
    case "play-pause":
      await player.playPause(command.metadata);
      break;
    case "play":
      await player.play(command.metadata);
      break;
    case "pause":
      await player.pause(command.metadata);
      break;
    case "previous":
      await player.previous(command.metadata, command.targetQueueItemId);
      break;
    case "next":
      await player.next(command.metadata, command.targetQueueItemId);
      break;
    case "shuffle":
      await player.setShuffle(command.enabled);
      break;
    case "repeat":
      await player.setRepeatMode(command.mode);
      break;
    case "queue-play":
      await player.playQueueIndex(
        command.index,
        async (origin) => {
          if (origin.kind === "removable")
            return removableStorage.resolveLogicalPath(
              origin.deviceId,
              origin.relativePath,
            );
          if (origin.kind === "smb")
            return smb.resolveLogicalPath(
              origin.connectionId,
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
        },
        command.queueItemId,
        command.metadata,
      );
      break;
    case "queue-append":
      await player.append(command.paths);
      break;
    case "queue-remove":
      await player.removeQueueItem(command.queueItemId);
      break;
    case "queue-reorder":
      await player.reorderQueueItem(
        command.queueItemId,
        command.toIndex,
        command.expectedQueueRevision,
      );
      break;
    case "empty":
      break;
  }
}

const remoteAccessFixture =
  process.env.NODE_ENV !== "production" &&
  process.env.EIDETIC_REMOTE_ACCESS_FIXTURE === "1";
const remoteAccess = new RemoteAccessService(
  installationMode === "appliance" || remoteAccessFixture,
  remoteAccessFixture,
);
events.attachRemoteAccess(remoteAccess);

function boundedRemoteLimit(query: URLSearchParams): number {
  const raw = query.get("limit");
  if (raw === null) return 48;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new LibraryError(
      "INVALID_LIBRARY_PAGE",
      "Library page size must be between 1 and 100.",
    );
  return limit;
}

function boundedRemoteCursor(query: URLSearchParams): string | null {
  const cursor = query.get("cursor");
  if (cursor !== null && (cursor.length < 1 || cursor.length > 1024))
    throw new LibraryError(
      "INVALID_LIBRARY_CURSOR",
      "The Library page cursor is invalid.",
    );
  return cursor;
}

async function applyRemoteLibraryContext(
  context: {
    readonly paths: readonly string[];
    readonly origins: Parameters<PlayerService["openResolvedQueue"]>[2];
    readonly selectedIndex: number;
    readonly playbackContext?: Parameters<
      PlayerService["openResolvedQueue"]
    >[4];
    readonly queueDecision?: PlaybackContextQueueDecision | undefined;
  },
  append: boolean,
): Promise<unknown> {
  if (append) {
    const appendedCount = await player.append(context.paths, context.origins);
    return {
      queueLength: player.getPublicState().explicitQueue?.length ?? 0,
      selectedIndex: null,
      appendedCount,
    };
  }
  const generation = player.reserveOpenRequest();
  await player.openResolvedQueue(
    context.paths,
    context.selectedIndex,
    context.origins,
    generation,
    context.playbackContext,
    context.queueDecision,
  );
  return {
    queueLength: context.paths.length,
    selectedIndex: context.selectedIndex,
    appendedCount: 0,
  };
}

const remoteGateway = new RemoteGateway(
  remoteAccess,
  {
    buildId: buildInfo.shortCommitSha,
    playerState: () => player.getPublicState(),
    audioOutput: () => audioOutput.snapshot(),
    outputLevel: () => {
      const snapshot = preferences.snapshot().preferences;
      return {
        mode: snapshot.outputLevelMode,
        maximumSoftwareVolume: snapshot.maximumSoftwareVolume,
      };
    },
    sources: () => sources.list(),
    librarySnapshot: async () => (await indexedLibraryPromise).snapshot(),
    subscribePlayer: (listener) =>
      player.subscribe(() => {
        listener(player.getPublicState());
      }),
    subscribeAudioOutput: (listener) => audioOutput.subscribe(listener),
    subscribeLibrary: async (listener) =>
      (await indexedLibraryPromise).subscribe(listener),
    command: async (action, body) => {
      const commandTypes: Record<string, PlayerCommand["type"]> = {
        play: "play",
        pause: "pause",
        "play-pause": "play-pause",
        next: "next",
        previous: "previous",
        seek: "seek",
        volume: "volume",
        mute: "mute",
        shuffle: "shuffle",
        repeat: "repeat",
        "queue-play": "queue-play",
        "queue-reorder": "queue-reorder",
        "queue-remove": "queue-remove",
      };
      if (action === "queue-clear") {
        await player.clearQueue();
        return player.getPublicState();
      }
      if (action === "context-clear") {
        await player.clearPlaybackContext();
        return player.getPublicState();
      }
      const type = commandTypes[action];
      if (!type)
        throw new RemoteAccessError(
          "REMOTE_COMMAND_NOT_ALLOWED",
          "Remote command is not allowed.",
          404,
        );
      await execute(
        validateCommandBody(type, {
          ...body,
          requestedAtMilliseconds:
            typeof body.requestedAtMilliseconds === "number"
              ? body.requestedAtMilliseconds
              : performance.now(),
        }),
      );
      return player.getPublicState();
    },
    libraryRead: async (
      operation: RemoteLibraryRead,
      query: URLSearchParams,
    ) => {
      const library = await indexedLibraryPromise;
      const cursor = boundedRemoteCursor(query);
      const limit = boundedRemoteLimit(query);
      if (operation === "albums") return library.albums(cursor, limit);
      if (operation === "artists") return library.artists(cursor, limit);
      if (operation === "tracks") return library.tracks(cursor, limit);
      if (operation === "favorites-tracks")
        return library.favoriteTracks(cursor, limit);
      if (operation === "favorites-albums")
        return library.favoriteAlbums(cursor, limit);
      if (operation === "favorites-artists")
        return library.favoriteArtists(cursor, limit);
      if (operation === "recently-played")
        return library.recentlyPlayed(cursor, limit);
      if (operation === "most-played") return library.mostPlayed(cursor, limit);
      if (operation === "playlists") return library.playlists(cursor, limit);
      const queryValue = query.get("q") ?? "";
      if (queryValue.length < 2 || queryValue.length > 256)
        throw new LibraryError(
          "INVALID_LIBRARY_SEARCH",
          "Enter at least two search characters.",
        );
      return library.search(
        queryValue,
        Math.min(12, Math.max(1, Number(query.get("limitPerGroup")) || 8)),
      );
    },
    libraryAction: async (
      operation: RemoteLibraryAction,
      body: Record<string, unknown>,
    ) => {
      const library = await indexedLibraryPromise;
      if (operation === "play" || operation === "queue") {
        const request = libraryContextBody(body);
        if (operation === "queue" && request.context === "track")
          throw new LibraryError(
            "INVALID_LIBRARY_CONTEXT",
            "Add a single Track through the Track Queue action.",
          );
        const context = await library.resolveContext(
          request.context,
          request.id,
          request.selectedTrackId,
        );
        return applyRemoteLibraryContext(
          {
            ...context,
            queueDecision: playbackDecisionFromRequest(request),
          },
          operation === "queue",
        );
      }
      if (operation === "queue-track") {
        const request = libraryTrackQueueBody(body);
        return applyRemoteLibraryContext(
          await library.resolveTrack(request.trackId),
          true,
        );
      }
      if (operation === "play-search") {
        const request = librarySearchPlayBody(body);
        return applyRemoteLibraryContext(
          {
            ...(await library.resolveSearch(
              request.query,
              request.selectedTrackId,
            )),
            queueDecision: playbackDecisionFromRequest(request),
          },
          false,
        );
      }
      if (operation === "play-favorites-tracks") {
        const request = favoriteTracksPlayBody(body);
        return applyRemoteLibraryContext(
          {
            ...(await library.resolveFavorites(
              request.selectedTrackId,
              request.catalogFingerprint,
            )),
            queueDecision: playbackDecisionFromRequest(request),
          },
          false,
        );
      }
      if (operation === "play-favorites-albums")
        return applyRemoteLibraryContext(
          {
            ...(await library.resolveFavoriteAlbums()),
            queueDecision: playbackContextQueueDecision(body),
          },
          false,
        );
      if (operation === "play-favorites-artists")
        return applyRemoteLibraryContext(
          {
            ...(await library.resolveFavoriteArtists()),
            queueDecision: playbackContextQueueDecision(body),
          },
          false,
        );
      if (operation === "play-recently-played") {
        const request = recentlyPlayedPlayBody(body);
        return applyRemoteLibraryContext(
          {
            ...(await library.resolveRecentlyPlayed(request.selectedHistoryId)),
            queueDecision: playbackDecisionFromRequest(request),
          },
          false,
        );
      }
      if (operation === "play-most-played") {
        const request = mostPlayedPlayBody(body);
        return applyRemoteLibraryContext(
          {
            ...(await library.resolveMostPlayed(request.selectedTrackId)),
            queueDecision: playbackDecisionFromRequest(request),
          },
          false,
        );
      }
      const playlistId =
        typeof body.playlistId === "string" &&
        /^playlist-[0-9a-f-]{36}$/iu.test(body.playlistId)
          ? body.playlistId
          : "";
      if (!playlistId)
        throw new LibraryError("INVALID_PLAYLIST", "Select a valid playlist.");
      const request = playlistPlayBody(body);
      return applyRemoteLibraryContext(
        {
          ...(await library.resolvePlaylist(
            playlistId,
            request.selectedItemId,
          )),
          queueDecision: playbackDecisionFromRequest(request),
        },
        operation === "queue-playlist",
      );
    },
    browseSources: () => sources.list(),
    browse: (sourceId, relativePath) => folders.browse(sourceId, relativePath),
    browseAction: async (sourceId, action, body) => {
      const queueDecision =
        action === "play" ? playbackContextQueueDecision(body) : undefined;
      if (
        typeof body.entryId === "string" &&
        /^entry-[0-9a-f]{32}$/u.test(body.entryId)
      ) {
        if (action === "play") {
          const queue = await folders.queueForEntry(sourceId, body.entryId);
          await player.openResolvedQueue(
            queue.paths,
            queue.selectedIndex,
            await persistentFolderOrigins(sourceId, queue.relativePaths),
            player.reserveOpenRequest(),
            undefined,
            queueDecision,
          );
          return {
            queueLength: queue.paths.length,
            selectedIndex: queue.selectedIndex,
            appendedCount: 0,
          };
        }
        const path = await folders.pathForEntry(sourceId, body.entryId);
        const relativePath = folders.relativePathForEntry(
          sourceId,
          body.entryId,
        );
        const appendedCount = await player.append(
          [path],
          await persistentFolderOrigins(sourceId, [relativePath]),
        );
        return {
          queueLength: player.getPublicState().explicitQueue?.length ?? 0,
          appendedCount,
        };
      }
      const relativePath =
        typeof body.relativePath === "string" ? body.relativePath : "";
      const queue = await folders.queueForDirectoryWithOrigins(
        sourceId,
        relativePath,
      );
      const origins = await persistentFolderOrigins(
        sourceId,
        queue.relativePaths,
      );
      if (action === "play") {
        if (queue.paths.length > 0)
          await player.openResolvedQueue(
            queue.paths,
            0,
            origins,
            player.reserveOpenRequest(),
            undefined,
            queueDecision,
          );
        return {
          queueLength: queue.paths.length,
          appendedCount: queue.paths.length,
        };
      }
      const appendedCount =
        queue.paths.length > 0 ? await player.append(queue.paths, origins) : 0;
      return {
        queueLength: player.getPublicState().explicitQueue?.length ?? 0,
        appendedCount,
      };
    },
    artwork: async (kind, id) => {
      if (kind === "player") return player.getArtworkResource(id);
      const artwork = await player.resolveQueueArtwork(id);
      return artwork ? player.getArtworkResource(artwork.id) : null;
    },
    wakeDisplay: async () => {
      await display.wake();
    },
    wakeAvailable: () =>
      installationMode === "appliance" || remoteAccessFixture,
  },
  resolveRemoteUiStaticRoot(),
);
remoteAccess.attachLifecycle(remoteGateway);
void remoteAccess.initialize();

async function runRemoteAccessOperation<T>(
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RemoteAccessError) throw error;
    throw new RemoteAccessError(
      "REMOTE_ACCESS_REQUEST_FAILED",
      error instanceof Error
        ? error.message
        : "The Remote access request could not be completed.",
    );
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

function requireJson(request: IncomingMessage): void {
  const contentType = request.headers["content-type"] ?? "";
  if (
    typeof contentType !== "string" ||
    !/^application\/json(?:\s*;|$)/iu.test(contentType)
  )
    throw new PreferencesError(
      "PREFERENCES_JSON_REQUIRED",
      "Settings requests require JSON.",
      415,
    );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function preferencesPatchBody(value: unknown): PreferencesPatch {
  const body = objectBody(value);
  if (
    !hasOnlyKeys(body, ["expectedRevision", "changes"]) ||
    !body.changes ||
    typeof body.changes !== "object" ||
    Array.isArray(body.changes) ||
    (body.expectedRevision !== undefined &&
      (!Number.isSafeInteger(body.expectedRevision) ||
        Number(body.expectedRevision) < 0))
  )
    throw new PreferencesError(
      "INVALID_PREFERENCES_PATCH",
      "Settings changes are invalid.",
      400,
    );
  return {
    ...(typeof body.expectedRevision === "number"
      ? { expectedRevision: body.expectedRevision }
      : {}),
    changes: body.changes,
  };
}

function displayDimBody(value: unknown): {
  readonly levelPercent: ScreenDimLevelPercent;
} {
  const body = objectBody(value);
  if (
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, "levelPercent") ||
    !isScreenDimLevelPercent(body.levelPercent)
  )
    throw new DisplayPowerError(
      "INVALID_DISPLAY_REQUEST",
      "The display request is invalid.",
      400,
    );
  return { levelPercent: body.levelPercent };
}

function emptyDisplayBody(value: unknown): void {
  const body = objectBody(value);
  if (Object.keys(body).length !== 0)
    throw new DisplayPowerError(
      "INVALID_DISPLAY_REQUEST",
      "The display request is invalid.",
      400,
    );
}

const audioProcessingPreferenceNames = new Set([
  "outputLevelMode",
  "lastVariableVolume",
  "maximumSoftwareVolume",
  "audioProcessingEnabled",
  "channelMode",
  "balanceDb",
  "equalizerEnabled",
  "equalizerBands",
  "headroomMode",
  "manualPreampDb",
]);

function audioProcessingPatchBody(value: unknown): AudioProcessingPatch {
  const body = objectBody(value);
  if (
    !hasOnlyKeys(body, ["changes", "confirmFixedOutput"]) ||
    !body.changes ||
    typeof body.changes !== "object" ||
    Array.isArray(body.changes) ||
    (body.confirmFixedOutput !== undefined &&
      typeof body.confirmFixedOutput !== "boolean")
  )
    throw new AudioProcessingError(
      "INVALID_AUDIO_PROCESSING",
      "Audio processing settings are invalid.",
    );
  return {
    changes: body.changes,
    ...(typeof body.confirmFixedOutput === "boolean"
      ? { confirmFixedOutput: body.confirmFixedOutput }
      : {}),
  };
}

function legacyPreferencesMigrationBody(
  value: unknown,
): LegacyPreferencesMigration {
  const body = objectBody(value);
  if (
    !hasOnlyKeys(body, [
      "preferences",
      "sourceAvailable",
      "confirmOverwrite",
    ]) ||
    !body.preferences ||
    typeof body.preferences !== "object" ||
    Array.isArray(body.preferences) ||
    typeof body.sourceAvailable !== "boolean" ||
    (body.confirmOverwrite !== undefined &&
      typeof body.confirmOverwrite !== "boolean")
  )
    throw new PreferencesError(
      "INVALID_PREFERENCES_MIGRATION",
      "Legacy settings import is invalid.",
      400,
    );
  return {
    preferences: body.preferences,
    sourceAvailable: body.sourceAvailable,
    ...(typeof body.confirmOverwrite === "boolean"
      ? { confirmOverwrite: body.confirmOverwrite }
      : {}),
  };
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
  const queueDecision = playbackContextQueueDecision(body);
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
    ...(queueDecision ?? {}),
  };
}

function libraryTrackQueueBody(value: unknown): LibraryTrackQueueRequest {
  const body = objectBody(value);
  return { trackId: libraryEntityId(body.trackId, "track") };
}

function librarySearchPlayBody(value: unknown): LibrarySearchPlayRequest {
  const body = objectBody(value);
  const queueDecision = playbackContextQueueDecision(body);
  if (typeof body.query !== "string" || body.query.length > 256)
    throw new LibraryError(
      "INVALID_LIBRARY_SEARCH",
      "Enter a valid Library search.",
    );
  const selectedTrackId =
    body.selectedTrackId === undefined
      ? undefined
      : libraryEntityId(body.selectedTrackId, "track");
  return {
    query: body.query,
    ...(selectedTrackId ? { selectedTrackId } : {}),
    ...(queueDecision ?? {}),
  };
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
  const queueDecision = playbackContextQueueDecision(body);
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
    ...(queueDecision ?? {}),
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
  const queueDecision = playbackContextQueueDecision(body);
  if (
    body.selectedHistoryId !== undefined &&
    (typeof body.selectedHistoryId !== "string" ||
      !/^history-[1-9][0-9]*$/.test(body.selectedHistoryId))
  )
    throw new LibraryError(
      "INVALID_LIBRARY_HISTORY",
      "Select a valid listening-history event.",
    );
  return {
    ...(typeof body.selectedHistoryId === "string"
      ? { selectedHistoryId: body.selectedHistoryId }
      : {}),
    ...(queueDecision ?? {}),
  };
}

function mostPlayedPlayBody(value: unknown): MostPlayedPlayRequest {
  const body = objectBody(value);
  const queueDecision = playbackContextQueueDecision(body);
  return {
    ...(body.selectedTrackId === undefined
      ? {}
      : { selectedTrackId: libraryEntityId(body.selectedTrackId, "track") }),
    ...(queueDecision ?? {}),
  };
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
  const queueDecision = playbackContextQueueDecision(body);
  return {
    ...(typeof body.selectedItemId === "string"
      ? { selectedItemId: body.selectedItemId }
      : {}),
    ...(queueDecision ?? {}),
  };
}

function playbackDecisionFromRequest(
  request: Partial<PlaybackContextQueueDecision>,
): PlaybackContextQueueDecision | undefined {
  return request.explicitQueuePolicy !== undefined &&
    request.expectedQueueRevision !== undefined
    ? {
        explicitQueuePolicy: request.explicitQueuePolicy,
        expectedQueueRevision: request.expectedQueueRevision,
      }
    : undefined;
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
  ["/api/player/play-pause", "play-pause"],
  ["/api/player/play", "play"],
  ["/api/player/pause", "pause"],
  ["/api/player/previous", "previous"],
  ["/api/player/next", "next"],
]);

const emptyCommands = new Map<string, () => Promise<void>>([
  ["/api/player/queue/clear", () => player.clearQueue()],
  ["/api/player/context/clear", () => player.clearPlaybackContext()],
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
    const updateRoute = url.pathname.startsWith("/api/system/update");
    const displayRoute = url.pathname.startsWith("/api/display");
    const remoteManagementRoute = url.pathname.startsWith("/api/remote-access");
    let localOrigin = true;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        localOrigin =
          originUrl.hostname === "127.0.0.1" ||
          originUrl.hostname === "localhost";
      } catch {
        localOrigin = false;
      }
      if (localOrigin) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "Origin");
        response.setHeader("access-control-allow-headers", "content-type");
        response.setHeader(
          "access-control-allow-methods",
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        );
      }
    }
    if (
      (updateRoute || displayRoute || remoteManagementRoute) &&
      !localOrigin
    ) {
      if (remoteManagementRoute)
        throw new RemoteAccessError(
          "REMOTE_ACCESS_LOCAL_ONLY",
          "Remote access management is available only in the local appliance interface.",
          403,
        );
      if (displayRoute)
        throw new DisplayPowerError(
          "INVALID_DISPLAY_REQUEST",
          "Display control is available only in the local appliance interface.",
          403,
        );
      throw new UpdateError(
        "preparation-failed",
        "Software Update is available only in the local appliance interface.",
        403,
      );
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
    if (request.method === "GET" && url.pathname === "/api/readiness") {
      const state = player.getState();
      const payload: ReadinessResponse = buildReadinessResponse({
        bootstrapStatus: bootstrapReadiness,
        playerStatus: state.status,
        mpvAvailable: state.mpvAvailable,
        bootstrapErrorCode: bootstrapFailureCode,
        playerErrorCode: state.error?.code ?? null,
        buildInfo,
      });
      sendJson(response, coreBootstrapReady ? 200 : 503, payload);
      return;
    }
    if (
      (updateRoute || displayRoute || remoteManagementRoute) &&
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        request.socket.remoteAddress ?? "",
      )
    ) {
      if (remoteManagementRoute)
        throw new RemoteAccessError(
          "REMOTE_ACCESS_LOCAL_ONLY",
          "Remote access management is available only in the local appliance interface.",
          403,
        );
      if (displayRoute)
        throw new DisplayPowerError(
          "INVALID_DISPLAY_REQUEST",
          "Display control is available only in the local appliance interface.",
          403,
        );
      throw new UpdateError(
        "preparation-failed",
        "Software Update is available only in the local appliance interface.",
        403,
      );
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/remote-access/state"
    ) {
      await remoteAccess.initialize();
      sendJson(response, 200, {
        ok: true,
        data: remoteAccess.snapshot(true),
      });
      return;
    }
    if (
      request.method === "POST" &&
      (url.pathname === "/api/remote-access/enable" ||
        url.pathname === "/api/remote-access/disable" ||
        url.pathname === "/api/remote-access/retry")
    ) {
      requireJson(request);
      const body = objectBody(await readBody(request, 1024));
      if (Object.keys(body).length !== 0)
        throw new RemoteAccessError(
          "INVALID_REMOTE_ACCESS_REQUEST",
          "The Remote access request must be empty.",
        );
      const data = await runRemoteAccessOperation(() =>
        url.pathname.endsWith("/enable")
          ? remoteAccess.enable()
          : url.pathname.endsWith("/disable")
            ? remoteAccess.disable()
            : remoteAccess.retry(),
      );
      sendJson(response, 200, { ok: true, data });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/remote-access/pairing-code"
    ) {
      requireJson(request);
      const body = objectBody(await readBody(request, 1024));
      if (Object.keys(body).length !== 0)
        throw new RemoteAccessError(
          "INVALID_REMOTE_ACCESS_REQUEST",
          "The pairing request must be empty.",
        );
      await remoteAccess.initialize();
      await runRemoteAccessOperation(() => remoteAccess.createPairingCode());
      sendJson(response, 200, {
        ok: true,
        data: remoteAccess.snapshot(true),
      });
      return;
    }
    if (
      request.method === "DELETE" &&
      url.pathname === "/api/remote-access/pairing-code"
    ) {
      await readBody(request, 1024);
      remoteAccess.cancelPairing();
      sendJson(response, 200, {
        ok: true,
        data: remoteAccess.snapshot(true),
      });
      return;
    }
    const remoteDeviceMatch =
      /^\/api\/remote-access\/devices\/(remote-device-[0-9a-f]{32})$/u.exec(
        url.pathname,
      );
    if (request.method === "DELETE" && remoteDeviceMatch) {
      await readBody(request, 1024);
      await runRemoteAccessOperation(() =>
        remoteAccess.revoke(remoteDeviceMatch[1] ?? ""),
      );
      sendJson(response, 200, {
        ok: true,
        data: remoteAccess.snapshot(true),
      });
      return;
    }
    if (
      request.method === "DELETE" &&
      url.pathname === "/api/remote-access/devices"
    ) {
      await readBody(request, 1024);
      await runRemoteAccessOperation(() => remoteAccess.revokeAll());
      sendJson(response, 200, {
        ok: true,
        data: remoteAccess.snapshot(true),
      });
      return;
    }
    if (updateRoute) await softwareUpdateInitialization;
    if (request.method === "GET" && url.pathname === "/api/display/state") {
      await coreBootstrapPromise;
      sendJson(response, 200, { ok: true, data: display.snapshot() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/display/dim") {
      requireJson(request);
      await coreBootstrapPromise;
      const body = displayDimBody(await readBody(request, 1024));
      sendJson(response, 200, {
        ok: true,
        data: await display.dim(body.levelPercent),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/display/standby") {
      requireJson(request);
      await coreBootstrapPromise;
      emptyDisplayBody(await readBody(request, 1024));
      sendJson(response, 200, {
        ok: true,
        data: await display.standby(),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/display/wake") {
      requireJson(request);
      await coreBootstrapPromise;
      emptyDisplayBody(await readBody(request, 1024));
      sendJson(response, 200, {
        ok: true,
        data: await display.wake(),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/display/test/dim") {
      requireJson(request);
      await coreBootstrapPromise;
      const body = displayDimBody(await readBody(request, 1024));
      sendJson(response, 200, {
        ok: true,
        data: await display.dim(body.levelPercent, true),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/display/test/standby"
    ) {
      requireJson(request);
      await coreBootstrapPromise;
      emptyDisplayBody(await readBody(request, 1024));
      sendJson(response, 200, {
        ok: true,
        data: await display.standby(true),
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/system/update/state"
    ) {
      sendJson(response, 200, { ok: true, data: softwareUpdate.snapshot() });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/system/update/events"
    ) {
      updateEvents.add(response);
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/system/update/branches/refresh"
    ) {
      requireJson(request);
      emptyUpdateBody(await readBody(request, 1024));
      sendJson(response, 200, {
        ok: true,
        data: await softwareUpdate.refreshBranches(),
      });
      return;
    }
    if (
      request.method === "PATCH" &&
      url.pathname === "/api/system/update/branch"
    ) {
      requireJson(request);
      const body = selectBranchBody(await readBody(request, 1024));
      sendJson(response, 200, {
        ok: true,
        data: await softwareUpdate.selectBranch(body.branch),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/system/update/check"
    ) {
      requireJson(request);
      emptyUpdateBody(await readBody(request, 1024));
      sendJson(response, 200, {
        ok: true,
        data: await softwareUpdate.check(),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/system/update/start"
    ) {
      requireJson(request);
      const body = startUpdateBody(await readBody(request, 2048));
      await softwareUpdate.start(body.planId, body.expectedTargetCommitSha);
      sendJson(response, 202, {
        ok: true,
        data: softwareUpdate.snapshot(),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/player/state") {
      sendJson(response, 200, { ok: true, data: player.getPublicState() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/player/retry-mpv") {
      requireJson(request);
      const body = objectBody(await readBody(request, 1024));
      if (Object.keys(body).length !== 0)
        throw new PlayerError(
          "INVALID_MPV_RETRY",
          "The MPV retry request is invalid.",
          400,
        );
      if (!(await playerRecovery.retryNow()))
        throw new PlayerError(
          "MPV_RECOVERY_FAILED",
          "MPV is still unavailable. Check the installation and try again.",
          503,
        );
      sendJson(response, 200, {
        ok: true,
        data: player.getPublicState(),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/preferences") {
      await coreBootstrapPromise;
      sendJson(response, 200, { ok: true, data: preferences.snapshot() });
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/preferences") {
      requireJson(request);
      await coreBootstrapPromise;
      const patch = preferencesPatchBody(await readBody(request, 16 * 1024));
      if (
        Object.keys(patch.changes).some((key) =>
          audioProcessingPreferenceNames.has(key),
        )
      )
        throw new AudioProcessingError(
          "INVALID_AUDIO_PROCESSING",
          "Use the audio processing settings endpoint for audio changes.",
          409,
        );
      const snapshot = await preferences.patch(patch);
      if (Object.hasOwn(patch.changes, "continuePlaybackMode"))
        await player.setContinuePlaybackMode(
          snapshot.preferences.continuePlaybackMode,
        );
      sendJson(response, 200, { ok: true, data: snapshot });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/preferences/migrate-legacy"
    ) {
      requireJson(request);
      await coreBootstrapPromise;
      const snapshot = await preferences.migrateLegacy(
        legacyPreferencesMigrationBody(await readBody(request, 16 * 1024)),
      );
      sendJson(response, 200, { ok: true, data: snapshot });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/audio-output/state"
    ) {
      sendJson(response, 200, { ok: true, data: audioOutput.snapshot() });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/audio-processing/state"
    ) {
      await bootstrapPromise;
      sendJson(response, 200, { ok: true, data: audioProcessing.snapshot() });
      return;
    }
    if (
      request.method === "PATCH" &&
      url.pathname === "/api/audio-processing/settings"
    ) {
      requireJson(request);
      await bootstrapPromise;
      sendJson(response, 200, {
        ok: true,
        data: await audioProcessing.patch(
          audioProcessingPatchBody(await readBody(request, 32 * 1024)),
        ),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/audio-output/select"
    ) {
      const body = objectBody(await readBody(request));
      const keys = Object.keys(body);
      if (
        keys.length !== 1 ||
        keys[0] !== "deviceId" ||
        typeof body.deviceId !== "string"
      )
        throw new AudioOutputError(
          "INVALID_AUDIO_OUTPUT",
          "Select a valid audio output.",
        );
      sendJson(response, 200, {
        ok: true,
        data: await audioOutput.select(body.deviceId),
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/audio-output/refresh"
    ) {
      const body = objectBody(await readBody(request));
      if (Object.keys(body).length !== 0)
        throw new AudioOutputError(
          "INVALID_AUDIO_OUTPUT",
          "The refresh request is invalid.",
        );
      sendJson(response, 200, {
        ok: true,
        data: await audioOutput.refresh(),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/network/state") {
      sendJson(response, 200, { ok: true, data: network.snapshot() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/network/events") {
      networkEvents.add(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/smb/connections") {
      sendJson(response, 200, { ok: true, data: smb.snapshot() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/smb/events") {
      smbEvents.add(response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/smb/connections") {
      const body = objectBody(await readBody(request));
      const connection = await smb.add(
        body as unknown as AddSmbConnectionRequest,
      );
      sendJson(response, 201, { ok: true, data: connection });
      return;
    }
    const smbConnectionMatch =
      /^\/api\/smb\/connections\/(smb-[0-9a-f]{32})$/u.exec(url.pathname);
    if (smbConnectionMatch && request.method === "PATCH") {
      const body = objectBody(await readBody(request));
      sendJson(response, 200, {
        ok: true,
        data: await smb.edit(
          smbConnectionMatch[1] ?? "",
          body as unknown as EditSmbConnectionRequest,
        ),
      });
      return;
    }
    if (smbConnectionMatch && request.method === "DELETE") {
      await readBody(request);
      await smb.remove(smbConnectionMatch[1] ?? "");
      sendJson(response, 200, { ok: true });
      return;
    }
    const smbRetryMatch =
      /^\/api\/smb\/connections\/(smb-[0-9a-f]{32})\/retry$/u.exec(
        url.pathname,
      );
    if (smbRetryMatch && request.method === "POST") {
      await readBody(request);
      sendJson(response, 200, {
        ok: true,
        data: await smb.retry(smbRetryMatch[1] ?? ""),
      });
      return;
    }
    const smbLibraryCoverageMatch =
      /^\/api\/smb\/connections\/(smb-[0-9a-f]{32})\/library-coverage$/u.exec(
        url.pathname,
      );
    if (smbLibraryCoverageMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: await sources.smbCoverage(
          smbLibraryCoverageMatch[1] ?? "",
          url.searchParams.get("logicalRelativePath") ?? "",
        ),
      });
      return;
    }
    const smbLibrarySourceMatch =
      /^\/api\/smb\/connections\/(smb-[0-9a-f]{32})\/library-sources$/u.exec(
        url.pathname,
      );
    if (smbLibrarySourceMatch && request.method === "POST") {
      const body = objectBody(await readBody(request));
      const logicalRelativePath =
        typeof body.logicalRelativePath === "string"
          ? body.logicalRelativePath
          : "";
      const result = await sources.addSmb(
        smbLibrarySourceMatch[1] ?? "",
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
    const smbBrowseMatch =
      /^\/api\/smb\/connections\/(smb-[0-9a-f]{32})\/browse$/u.exec(
        url.pathname,
      );
    if (smbBrowseMatch && request.method === "GET") {
      const connectionId = smbBrowseMatch[1] ?? "";
      try {
        sendJson(response, 200, {
          ok: true,
          data: await smbFolders.browse(
            connectionId,
            url.searchParams.get("relativePath") ?? "",
          ),
        });
      } catch (error) {
        await smb.reportUnavailable(connectionId).catch(() => undefined);
        throw error;
      }
      return;
    }
    const smbFolderArtworkMatch =
      /^\/api\/smb\/connections\/(smb-[0-9a-f]{32})\/folder-artwork$/u.exec(
        url.pathname,
      );
    if (smbFolderArtworkMatch && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: await smbFolders.folderArtworkFor(
          smbFolderArtworkMatch[1] ?? "",
          url.searchParams.get("relativePath") ?? "",
        ),
      });
      return;
    }
    const smbDirectoryActionMatch =
      /^\/api\/smb\/connections\/(smb-[0-9a-f]{32})\/directory\/(play|queue)$/u.exec(
        url.pathname,
      );
    if (smbDirectoryActionMatch && request.method === "POST") {
      const connectionId = smbDirectoryActionMatch[1] ?? "";
      const action = smbDirectoryActionMatch[2] ?? "";
      const body = objectBody(await readBody(request));
      const queueDecision =
        action === "play" ? playbackContextQueueDecision(body) : undefined;
      const relativePath =
        typeof body.relativePath === "string" ? body.relativePath : "";
      const requestGeneration =
        action === "play" ? player.reserveOpenRequest() : undefined;
      const queue = await smbFolders.queueForDirectoryWithOrigins(
        connectionId,
        relativePath,
      );
      const origins = queue.relativePaths.map((entryRelativePath) => ({
        kind: "smb" as const,
        connectionId,
        relativePath: entryRelativePath,
        entryId: smbFolders.entryIdForRelativePath(
          connectionId,
          entryRelativePath,
        ),
      }));
      if (action === "play") {
        if (queue.paths.length > 0)
          await player.openResolvedQueue(
            queue.paths,
            0,
            origins,
            requestGeneration,
            undefined,
            queueDecision,
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
            queueLength: player.getPublicState().explicitQueue?.length ?? 0,
            appendedCount,
          },
        });
      }
      return;
    }
    const smbEntryMatch =
      /^\/api\/smb\/connections\/(smb-[0-9a-f]{32})\/entries\/(entry-[0-9a-f]{32})\/(metadata|artwork|open|queue)$/u.exec(
        url.pathname,
      );
    if (smbEntryMatch) {
      const connectionId = smbEntryMatch[1] ?? "";
      const entryId = smbEntryMatch[2] ?? "";
      const action = smbEntryMatch[3] ?? "";
      if (request.method === "GET" && action === "metadata") {
        sendJson(response, 200, {
          ok: true,
          data: await smbFolders.metadataFor(connectionId, entryId),
        });
        return;
      }
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        action === "artwork"
      ) {
        const resource = await smbFolders.artworkFor(connectionId, entryId);
        if (!resource) {
          sendJson(response, 404, {
            ok: false,
            error: {
              code: "SMB_ARTWORK_NOT_FOUND",
              message: "Artwork not found.",
            },
          });
          return;
        }
        await sendArtworkResource(request, response, resource);
        return;
      }
      if (request.method === "POST" && action === "open") {
        const body = objectBody(await readBody(request));
        const queueDecision = playbackContextQueueDecision(body);
        const requestGeneration = player.reserveOpenRequest();
        const queue = await smbFolders.queueForEntry(connectionId, entryId);
        await player.openResolvedQueue(
          queue.paths,
          queue.selectedIndex,
          queue.relativePaths.map((relativePath) => ({
            kind: "smb" as const,
            connectionId,
            relativePath,
            entryId: smbFolders.entryIdForRelativePath(
              connectionId,
              relativePath,
            ),
          })),
          requestGeneration,
          undefined,
          queueDecision,
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
        const path = await smbFolders.pathForEntry(connectionId, entryId);
        const appendedCount = await player.append(
          [path],
          [
            {
              kind: "smb",
              connectionId,
              relativePath: smbFolders.relativePathForEntry(
                connectionId,
                entryId,
              ),
              entryId,
            },
          ],
        );
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: player.getPublicState().explicitQueue?.length ?? 0,
            appendedCount,
          },
        });
        return;
      }
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/network/ipv4/pending"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: network.snapshot().configurationTransaction,
      });
      return;
    }
    if (
      request.method === "POST" &&
      (url.pathname === "/api/network/ipv4/validate" ||
        url.pathname === "/api/network/ipv4/apply")
    ) {
      const body = await readBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new NetworkAdapterError(
          "generic-failure",
          "Invalid IPv4 request.",
        );
      const record = body as Record<string, unknown>;
      const configuration = record.configuration;
      if (
        !configuration ||
        typeof configuration !== "object" ||
        Array.isArray(configuration)
      )
        throw new NetworkAdapterError(
          "generic-failure",
          "Invalid IPv4 configuration.",
        );
      const candidate = configuration as Record<string, unknown>;
      if (
        (candidate.method !== "dhcp" && candidate.method !== "manual") ||
        !["address", "subnetMask", "gateway", "dns1", "dns2"].every(
          (key) =>
            typeof candidate[key] === "string" && candidate[key].length <= 64,
        )
      )
        throw new NetworkAdapterError(
          "generic-failure",
          "Invalid IPv4 configuration.",
        );
      const draft = candidate as unknown as Ipv4Draft;
      if (url.pathname.endsWith("/validate")) {
        sendJson(response, 200, {
          ok: true,
          data: network.validateIpv4(draft),
        });
        return;
      }
      if (
        typeof record.adapterId !== "string" ||
        !/^network-[0-9a-f]{16}$/u.test(record.adapterId)
      )
        throw new NetworkAdapterError("no-adapter", "Invalid adapter.");
      await network.applyIpv4(record.adapterId, draft);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (
      request.method === "POST" &&
      (url.pathname === "/api/network/ipv4/confirm" ||
        url.pathname === "/api/network/ipv4/rollback" ||
        url.pathname === "/api/network/ipv4/retry-recovery")
    ) {
      if (url.pathname.endsWith("/confirm")) await network.confirmIpv4();
      else if (url.pathname.endsWith("/retry-recovery"))
        await network.retryIpv4Recovery();
      else await network.rollbackIpv4();
      sendJson(response, 200, { ok: true });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname.startsWith("/api/network/wifi/")
    ) {
      const body = await readBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new NetworkAdapterError(
          "generic-failure",
          "Invalid network request.",
        );
      const record = body as Record<string, unknown>;
      const adapterId = record.adapterId;
      if (
        typeof adapterId !== "string" ||
        !/^network-[0-9a-f]{16}$/u.test(adapterId)
      )
        throw new NetworkAdapterError("no-adapter", "Invalid adapter.");
      if (url.pathname === "/api/network/wifi/scan") {
        await network.scan((record as unknown as WifiAdapterRequest).adapterId);
      } else if (url.pathname === "/api/network/wifi/radio") {
        if (typeof record.enabled !== "boolean")
          throw new NetworkAdapterError(
            "generic-failure",
            "Invalid radio state.",
          );
        const requestBody = record as unknown as WifiRadioRequest;
        await network.setRadio(requestBody.adapterId, requestBody.enabled);
      } else if (url.pathname === "/api/network/wifi/connect") {
        if (
          typeof record.networkId !== "string" ||
          !/^network-[0-9a-f]{16}$/u.test(record.networkId) ||
          (record.password !== undefined && typeof record.password !== "string")
        )
          throw new NetworkAdapterError(
            "generic-failure",
            "Invalid connection request.",
          );
        const requestBody = record as unknown as WifiConnectRequest;
        await network.connect(
          requestBody.adapterId,
          requestBody.networkId,
          requestBody.password,
        );
      } else if (url.pathname === "/api/network/wifi/connect-hidden") {
        const validSecurity = (
          value: unknown,
        ): value is Exclude<WifiSecurity, "unsupported"> =>
          value === "open" ||
          value === "wpa2-personal" ||
          value === "wpa3-personal";
        if (
          typeof record.ssid !== "string" ||
          record.ssid.trim().length === 0 ||
          new TextEncoder().encode(record.ssid).length > 32 ||
          !validSecurity(record.security) ||
          (record.password !== undefined && typeof record.password !== "string")
        )
          throw new NetworkAdapterError(
            "generic-failure",
            "Invalid hidden network.",
          );
        const requestBody = record as unknown as WifiHiddenConnectRequest;
        await network.connectHidden(
          requestBody.adapterId,
          requestBody.ssid.trim(),
          requestBody.security,
          requestBody.password,
        );
      } else if (url.pathname === "/api/network/wifi/disconnect") {
        await network.disconnect(adapterId);
      } else {
        throw new NetworkAdapterError(
          "generic-failure",
          "Unknown network action.",
        );
      }
      sendJson(response, 200, { ok: true });
      return;
    }
    if (
      request.method === "DELETE" &&
      url.pathname === "/api/network/wifi/managed-profile"
    ) {
      const body = await readBody(request);
      const adapterId =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).adapterId
          : null;
      if (
        typeof adapterId !== "string" ||
        !/^network-[0-9a-f]{16}$/u.test(adapterId)
      )
        throw new NetworkAdapterError("no-adapter", "Invalid adapter.");
      await network.forgetManagedProfile(adapterId);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      await coreBootstrapPromise;
      const restore = lastRestoreResult;
      sendJson(response, 200, {
        ok: true,
        data: {
          playerState: player.getPublicState(),
          audioOutput: audioOutput.snapshot(),
          system: systemCapabilities,
          buildInfo,
          preferences: preferences.snapshot(),
          display: display.snapshot(),
          restore: {
            status: restore.status,
            restoredCount: restore.restoredCount,
            discardedCount: restore.discardedCount,
          },
        },
      });
      return;
    }
    if (
      request.method === "POST" &&
      (url.pathname === "/api/system/power" ||
        url.pathname === "/api/system/maintenance")
    ) {
      if (
        url.pathname === "/api/system/maintenance" &&
        !systemCapabilities.maintenanceMode
      ) {
        await readBody(request);
        sendJson(response, 404, {
          ok: false,
          error: {
            code: "NOT_AVAILABLE",
            message: "Maintenance mode is unavailable.",
          },
        });
        return;
      }
      try {
        const action =
          url.pathname === "/api/system/maintenance"
            ? "maintenance"
            : validatePowerActionBody(await readBody(request));
        if (url.pathname === "/api/system/maintenance") await readBody(request);
        await powerActions.request(action);
        sendJson(response, 202, { ok: true });
      } catch (error) {
        const powerError =
          error instanceof PowerActionError
            ? error
            : new PowerActionError(
                "POWER_PREPARATION_FAILED",
                "The system action could not be prepared.",
                500,
              );
        sendJson(response, powerError.statusCode, {
          ok: false,
          error: {
            code: powerError.code,
            message: powerError.message,
          },
        });
      }
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
    if (
      request.method === "POST" &&
      url.pathname === "/api/library/search/play"
    ) {
      const body = librarySearchPlayBody(await readBody(request));
      const generation = player.reserveOpenRequest();
      const context = await (
        await indexedLibraryPromise
      ).resolveSearch(body.query, body.selectedTrackId);
      await player.openResolvedQueue(
        context.paths,
        context.selectedIndex,
        context.origins,
        generation,
        context.playbackContext,
        playbackDecisionFromRequest(body),
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
        context.playbackContext,
        playbackDecisionFromRequest(body),
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
        context.playbackContext,
        playbackDecisionFromRequest(body),
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
        context.playbackContext,
        playbackDecisionFromRequest(body),
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
      const body = objectBody(await readBody(request));
      const queueDecision = playbackContextQueueDecision(body);
      const generation = player.reserveOpenRequest();
      const context = await (
        await indexedLibraryPromise
      ).resolveFavoriteAlbums();
      await player.openResolvedQueue(
        context.paths,
        context.selectedIndex,
        context.origins,
        generation,
        context.playbackContext,
        queueDecision,
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
      const body = objectBody(await readBody(request));
      const queueDecision = playbackContextQueueDecision(body);
      const generation = player.reserveOpenRequest();
      const context = await (
        await indexedLibraryPromise
      ).resolveFavoriteArtists();
      await player.openResolvedQueue(
        context.paths,
        context.selectedIndex,
        context.origins,
        generation,
        context.playbackContext,
        queueDecision,
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
          context.playbackContext,
          playbackDecisionFromRequest(body),
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
            queueLength: player.getPublicState().explicitQueue?.length ?? 0,
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
        context.playbackContext,
        playbackDecisionFromRequest(body),
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
          queueLength: player.getPublicState().explicitQueue?.length ?? 0,
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
          queueLength: player.getPublicState().explicitQueue?.length ?? 0,
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
      const body = objectBody(await readBody(request));
      const queueDecision =
        action === "play" ? playbackContextQueueDecision(body) : undefined;
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
            undefined,
            queueDecision,
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
            queueLength: player.getPublicState().explicitQueue?.length ?? 0,
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
        const body = objectBody(await readBody(request));
        const queueDecision = playbackContextQueueDecision(body);
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
          undefined,
          queueDecision,
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
            queueLength: player.getPublicState().explicitQueue?.length ?? 0,
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
      const body = objectBody(await readBody(request));
      const queueDecision =
        action === "play" ? playbackContextQueueDecision(body) : undefined;
      const relativePath =
        typeof body.relativePath === "string" ? body.relativePath : "";
      const openRequestGeneration =
        action === "play" ? player.reserveOpenRequest() : null;
      const queue = await folders.queueForDirectoryWithOrigins(
        sourceId,
        relativePath,
      );
      const origins = await persistentFolderOrigins(
        sourceId,
        queue.relativePaths,
      );
      if (action === "play") {
        if (queue.paths.length > 0)
          await player.openResolvedQueue(
            queue.paths,
            0,
            origins,
            openRequestGeneration ?? undefined,
            undefined,
            queueDecision,
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
            queueLength: player.getPublicState().explicitQueue?.length ?? 0,
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
        const body = objectBody(await readBody(request));
        const queueDecision = playbackContextQueueDecision(body);
        const openRequestGeneration = player.reserveOpenRequest();
        const queue = await folders.queueForEntry(sourceId, entryId);
        await player.openResolvedQueue(
          queue.paths,
          queue.selectedIndex,
          await persistentFolderOrigins(sourceId, queue.relativePaths),
          openRequestGeneration,
          undefined,
          queueDecision,
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
          await persistentFolderOrigins(sourceId, [
            folders.relativePathForEntry(sourceId, entryId),
          ]),
        );
        sendJson(response, 200, {
          ok: true,
          data: {
            queueLength: player.getPublicState().explicitQueue?.length ?? 0,
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
    if (error instanceof RemoteAccessError) {
      sendJson(response, error.statusCode, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof UpdateError) {
      sendJson(response, error.status, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof AudioProcessingError) {
      sendJson(response, error.statusCode, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof AudioOutputError) {
      sendJson(response, error.statusCode, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof DisplayPowerError) {
      sendJson(response, error.statusCode, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof SmbError) {
      sendJson(response, error.statusCode, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof NetworkAdapterError) {
      sendJson(response, error.code === "operation-conflict" ? 409 : 400, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof PreferencesError) {
      sendJson(response, error.statusCode, {
        ok: false,
        error: { code: error.code, message: error.message },
      } satisfies ApiResponse);
      return;
    }
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
  void remoteAccess.startStoredPreference();
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[backend] received ${signal}, shutting down`);
  events.close();
  audioOutput.close();
  audioProcessing.close();
  removableEvents.close();
  networkEvents.close();
  smbEvents.close();
  updateEvents.close();
  softwareUpdate.close();
  playerRecovery.close();
  unsubscribeAudioDisplay();
  unsubscribePlayerRecovery();
  unsubscribeRemovablePlayer();
  unsubscribeSmbPlayer();
  unsubscribeNetworkSmb();
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
        smbFolders.close(),
        remoteAccess.close(),
        removableStorage.close(),
        network.close(),
        smb.close(),
        libraryEventsPromise
          .then((libraryEvents) => {
            libraryEvents.close();
          })
          .catch(() => undefined),
        indexedLibraryPromise
          .then((indexedLibrary) => indexedLibrary.close())
          .catch(() => undefined),
        player.shutdown(),
        display.close(),
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
