import type { ServerResponse } from "node:http";
import type { RemoteAccessState } from "../../../../packages/shared/src/remote-access.js";
import type { PlayerService } from "../player/player-service.js";
import type { AudioOutputService } from "../audio-output/audio-output-service.js";
import type { DisplaySnapshot } from "../../../../packages/shared/src/display.js";
import type {
  PlayerProgressState,
  PlayerState,
} from "../../../../packages/shared/src/player.js";
import type { PlaybackSourceSnapshot } from "../../../../packages/shared/src/playback-source.js";

interface RemoteAccessStateSource {
  subscribe(listener: (state: RemoteAccessState) => void): () => void;
  snapshot(includePairingCode?: boolean): RemoteAccessState;
}

interface DisplayStateSource {
  subscribe(listener: (state: DisplaySnapshot) => void): () => void;
  snapshot(): DisplaySnapshot;
}

interface PlaybackSourceStateSource {
  subscribe(listener: (state: PlaybackSourceSnapshot) => void): () => void;
  snapshot(): PlaybackSourceSnapshot;
}

export class SseHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeAudioOutput: () => void;
  private readonly unsubscribeDisplay: () => void;
  private readonly unsubscribePlaybackSource: () => void;
  private unsubscribeRemoteAccess = (): void => undefined;
  private remoteAccess: RemoteAccessStateSource | null = null;
  private readonly keepalive: NodeJS.Timeout;
  private fullPlayerSignature = "";
  private fullExplicitQueue: PlayerState["explicitQueue"];

  constructor(
    private readonly player: PlayerService,
    private readonly audioOutput?: AudioOutputService,
    private readonly display?: DisplayStateSource,
    private readonly playbackSource?: PlaybackSourceStateSource,
  ) {
    const initialPublicState = player.getPublicState();
    this.fullPlayerSignature = this.playerSnapshotSignature(initialPublicState);
    this.fullExplicitQueue = initialPublicState.explicitQueue;
    this.unsubscribe = player.subscribe((state) => {
      void state;
      const publicState = player.getPublicState();
      const signature = this.playerSnapshotSignature(publicState);
      const explicitQueueChanged =
        publicState.explicitQueue !== this.fullExplicitQueue;
      if (signature !== this.fullPlayerSignature || explicitQueueChanged) {
        this.fullPlayerSignature = signature;
        this.fullExplicitQueue = publicState.explicitQueue;
        this.broadcast(publicState);
      } else {
        this.broadcastNamed(
          "player-progress",
          this.playerProgress(publicState),
        );
      }
    });
    this.unsubscribeAudioOutput =
      audioOutput?.subscribe((state) => {
        this.broadcastNamed("audio-output", state);
      }) ?? (() => undefined);
    this.unsubscribeDisplay =
      display?.subscribe((state) => {
        this.broadcastNamed("display", state);
      }) ?? (() => undefined);
    this.unsubscribePlaybackSource =
      playbackSource?.subscribe((state) => {
        this.broadcastNamed("playback-source", state);
      }) ?? (() => undefined);
    this.keepalive = setInterval(() => {
      for (const client of this.clients) client.write(": keepalive\n\n");
    }, 25_000);
    this.keepalive.unref();
  }

  add(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.flushHeaders();
    this.clients.add(response);
    this.send(response, this.player.getPublicState());
    if (this.audioOutput)
      this.sendNamed(response, "audio-output", this.audioOutput.snapshot());
    if (this.display)
      this.sendNamed(response, "display", this.display.snapshot());
    if (this.playbackSource)
      this.sendNamed(
        response,
        "playback-source",
        this.playbackSource.snapshot(),
      );
    if (this.remoteAccess)
      this.sendNamed(
        response,
        "remote-access",
        this.remoteAccess.snapshot(true),
      );
    response.once("close", () => this.clients.delete(response));
  }

  attachRemoteAccess(source: RemoteAccessStateSource): void {
    this.unsubscribeRemoteAccess();
    this.remoteAccess = source;
    this.unsubscribeRemoteAccess = source.subscribe((state) => {
      this.broadcastNamed("remote-access", state);
    });
  }

  close(): void {
    clearInterval(this.keepalive);
    this.unsubscribe();
    this.unsubscribeAudioOutput();
    this.unsubscribeDisplay();
    this.unsubscribePlaybackSource();
    this.unsubscribeRemoteAccess();
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  private broadcast(state: unknown): void {
    for (const client of this.clients) this.send(client, state);
  }

  private send(client: ServerResponse, state: unknown): void {
    client.write(`data: ${JSON.stringify(state)}\n\n`);
  }

  private broadcastNamed(event: string, state: unknown): void {
    for (const client of this.clients) this.sendNamed(client, event, state);
  }

  private sendNamed(
    client: ServerResponse,
    event: string,
    state: unknown,
  ): void {
    client.write(`event: ${event}\ndata: ${JSON.stringify(state)}\n\n`);
  }

  private playerSnapshotSignature(state: PlayerState): string {
    return JSON.stringify([
      state.playerSessionId,
      state.trackTransitionId,
      state.mpvAvailable,
      state.queueRevision,
      state.contextRevision ?? 0,
      state.playbackPlanRevision ?? 0,
      state.canGoNext ?? true,
      state.currentPlayback ?? null,
      state.currentTrack,
      state.playbackContext ?? null,
      state.playbackHistory ?? null,
      state.playbackContinuation ?? null,
      state.shuffleEnabled,
      state.repeatMode,
      state.audioDevice,
      state.error?.code ?? null,
      state.error?.message ?? null,
      state.commands ?? null,
    ]);
  }

  private playerProgress(state: PlayerState): PlayerProgressState {
    return {
      playerSessionId: state.playerSessionId,
      trackTransitionId: state.trackTransitionId,
      status: state.status,
      positionSeconds: state.positionSeconds,
      durationSeconds: state.durationSeconds,
      paused: state.paused,
      volume: state.volume,
      muted: state.muted,
      ...(state.audioBufferSeconds !== undefined
        ? { audioBufferSeconds: state.audioBufferSeconds }
        : {}),
    };
  }
}
