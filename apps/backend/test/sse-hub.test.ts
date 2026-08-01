import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import test from "node:test";
import type {
  ExplicitQueueItem,
  PlayerState,
  PublicPlaybackItem,
} from "../../../packages/shared/src/player.js";
import { SseHub } from "../src/api/sse-hub.js";
import type { PlayerService } from "../src/player/player-service.js";

type StateListener = (state: PlayerState) => void;

class FixturePlayer {
  private listener: StateListener | null = null;

  constructor(private state: PlayerState) {}

  getPublicState(): PlayerState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  publish(state: PlayerState): void {
    this.state = state;
    this.listener?.(state);
  }
}

interface FixtureResponse {
  readonly response: ServerResponse;
  readonly writes: string[];
  readonly headers: Record<string, string>;
  readonly writeHeadCount: () => number;
  readonly ended: () => boolean;
}

function fixtureResponse(): FixtureResponse {
  const writes: string[] = [];
  const headers: Record<string, string> = {};
  let heads = 0;
  let ended = false;
  const closeListeners: (() => void)[] = [];
  const response = {
    writeHead(status: number, nextHeaders: Record<string, string>) {
      assert.equal(status, 200);
      heads += 1;
      Object.assign(headers, nextHeaders);
      return this;
    },
    flushHeaders() {
      return undefined;
    },
    write(chunk: unknown) {
      writes.push(String(chunk));
      return true;
    },
    once(event: string, listener: () => void) {
      if (event === "close") closeListeners.push(listener);
      return this;
    },
    end() {
      ended = true;
      return this;
    },
  } as unknown as ServerResponse;
  return {
    response,
    writes,
    headers,
    writeHeadCount: () => heads,
    ended: () => ended,
  };
}

function playbackItem(index = 0): PublicPlaybackItem {
  return {
    filename: `track-${String(index)}.flac`,
    displayTitle: `Track ${String(index)}`,
    artist: "Fixture Artist",
    album: "Fixture Album",
    durationSeconds: 180,
    artwork: null,
    available: true,
    libraryTrackId: null,
  };
}

function playerState(explicitCount: number): PlayerState {
  const explicitQueue: ExplicitQueueItem[] = Array.from(
    { length: explicitCount },
    (_, index) => ({
      explicitQueueEntryId: `explicit-${String(index).padStart(4, "0")}`,
      playbackInstanceId: `playback-${String(index).padStart(4, "0")}`,
      index,
      item: playbackItem(index),
    }),
  );
  return {
    playerSessionId: "123e4567-e89b-42d3-a456-426614174000",
    trackTransitionId: 1,
    status: "playing",
    mpvAvailable: true,
    mpvVersion: "fixture",
    currentTrack: null,
    currentPlayback: {
      playbackInstanceId: "playback-current",
      source: "context",
      relationId: "context-item-current",
      contextId: "context-current",
      historyEntryId: "history-current",
      startedSequence: 1,
      item: playbackItem(),
    },
    explicitQueue,
    playbackContext: {
      contextId: "context-current",
      kind: "album",
      entityId: "album-current",
      title: "Fixture Album",
      sourceLabel: "Library",
      nextItem: playbackItem(2_001),
      remainingCount: 8,
      totalCount: 10,
      cycle: 0,
    },
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
    positionSeconds: 10,
    durationSeconds: 180,
    paused: false,
    volume: 70,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    currentQueueIndex: -1,
    queue: explicitQueue.map((entry) => ({
      id: entry.explicitQueueEntryId,
      index: entry.index,
      path: `queue-entry://${entry.explicitQueueEntryId}`,
      filename: entry.item.filename,
      displayTitle: entry.item.displayTitle,
      durationSeconds: entry.item.durationSeconds,
      artwork: entry.item.artwork,
      isCurrent: false,
      available: entry.item.available,
    })),
    queueRevision: 1,
    contextRevision: 1,
    audioDevice: "Default output",
    error: null,
  };
}

function frame(value: string): {
  readonly event: string;
  readonly data: unknown;
} {
  const event = /^event: ([^\n]+)$/mu.exec(value)?.[1] ?? "player";
  const serialized = /^data: (.+)$/mu.exec(value)?.[1];
  assert.ok(serialized);
  return { event, data: JSON.parse(serialized) as unknown };
}

void test("local player SSE keeps one stream and bounds progress ticks with a 2000-entry Explicit Queue", () => {
  const initial = playerState(2_000);
  const player = new FixturePlayer(initial);
  const response = fixtureResponse();
  const hub = new SseHub(player as unknown as PlayerService);

  try {
    hub.add(response.response);
    assert.equal(response.writeHeadCount(), 1);
    assert.equal(
      response.headers["content-type"],
      "text/event-stream; charset=utf-8",
    );
    assert.equal(
      (hub as unknown as { clients: Set<ServerResponse> }).clients.size,
      1,
    );

    const initialFrame = frame(response.writes[0] ?? "");
    assert.equal(initialFrame.event, "player");
    assert.equal(
      (initialFrame.data as PlayerState).explicitQueue?.length,
      2_000,
    );

    player.publish({ ...initial, positionSeconds: 11 });
    const progressRaw = response.writes.at(-1) ?? "";
    const progressFrame = frame(progressRaw);
    assert.equal(progressFrame.event, "player-progress");
    assert.ok(progressRaw.length < 1_000);
    assert.doesNotMatch(
      progressRaw,
      /explicitQueue|queueRevision|playbackContext|currentPlayback|track-1999/u,
    );

    const enrichedExplicitQueue = [...(initial.explicitQueue ?? [])];
    const firstExplicit = enrichedExplicitQueue[0];
    assert.ok(firstExplicit);
    enrichedExplicitQueue[0] = {
      ...firstExplicit,
      item: {
        ...firstExplicit.item,
        artwork: {
          id: "artwork-future",
          mimeType: "image/jpeg",
          sourceType: "embedded",
          revision: "2",
        },
      },
    };
    player.publish({
      ...initial,
      positionSeconds: 11.5,
      explicitQueue: enrichedExplicitQueue,
    });
    assert.equal(frame(response.writes.at(-1) ?? "").event, "player");

    const queueChanged = {
      ...initial,
      positionSeconds: 12,
      queueRevision: 2,
    };
    player.publish(queueChanged);
    assert.equal(frame(response.writes.at(-1) ?? "").event, "player");

    const contextChanged = {
      ...queueChanged,
      positionSeconds: 13,
      contextRevision: 2,
    };
    player.publish(contextChanged);
    assert.equal(frame(response.writes.at(-1) ?? "").event, "player");

    const nextCapabilityChanged = {
      ...contextChanged,
      positionSeconds: 13.5,
      canGoNext: false,
    };
    player.publish(nextCapabilityChanged);
    assert.equal(frame(response.writes.at(-1) ?? "").event, "player");

    const currentPlayback = nextCapabilityChanged.currentPlayback;
    assert.ok(currentPlayback);
    player.publish({
      ...nextCapabilityChanged,
      positionSeconds: 14,
      currentPlayback: {
        ...currentPlayback,
        playbackInstanceId: "playback-current-next",
      },
    });
    assert.equal(frame(response.writes.at(-1) ?? "").event, "player");
    assert.equal(response.writeHeadCount(), 1);
    assert.equal(
      (hub as unknown as { clients: Set<ServerResponse> }).clients.size,
      1,
    );
  } finally {
    hub.close();
  }

  assert.equal(response.ended(), true);
});
