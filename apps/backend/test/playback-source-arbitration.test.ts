import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PlayerState } from "../../../packages/shared/src/player.js";
import { PreferencesStore } from "../src/preferences/preferences-store.js";
import type { LocalPlaybackAdapter } from "../src/playback-source/local-playback-adapter.js";
import {
  defaultPlaybackArbitrationDocument,
  PlaybackArbitrationStore,
} from "../src/playback-source/playback-arbitration-store.js";
import { PlaybackSourceArbiter } from "../src/playback-source/playback-source-arbiter.js";
import { FixtureExternalPlaybackProvider } from "../src/playback-source/fixture-external-playback-provider.js";

function localState(playing = true): PlayerState {
  return {
    playerSessionId: "session-test",
    trackTransitionId: 4,
    status: playing ? "playing" : "paused",
    mpvAvailable: true,
    mpvVersion: "fixture",
    audioDevice: "USB DAC",
    currentTrack: null,
    positionSeconds: 42,
    durationSeconds: 180,
    paused: !playing,
    volume: 64,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    currentQueueIndex: 0,
    queue: [],
    queueRevision: 2,
    error: null,
  };
}

class FixtureLocalAdapter {
  readonly restores: boolean[] = [];
  readonly restoredLevels: {
    readonly volume: number;
    readonly muted: boolean;
  }[] = [];
  releaseCount = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly state = localState()) {}

  snapshot(): PlayerState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  output() {
    return {
      description: "USB DAC",
      levelMode: "variable" as const,
      maximumSoftwareVolume: 80,
    };
  }

  routeForExternalPlayback() {
    return {
      physicalOutputId: "usb-dac",
      description: "USB DAC",
      routeKind: "wasapi" as const as "other",
      providerTarget: "fixture-usb-dac",
      levelMode: "variable" as const,
      maximumSoftwareVolume: 80,
      availabilityRevision: 3,
    };
  }

  captureSuspension() {
    return Promise.resolve({
      suspensionId: "local-suspension-test",
      player: {
        playerSessionId: "session-test",
        playbackPlanRevision: 2,
        playbackInstanceId: "playback-test",
        trackTransitionId: 4,
        positionSeconds: 42,
        volume: 64,
        muted: false,
        wasPlaying: !this.state.paused,
        wasPaused: this.state.paused,
      },
      playerSessionRevision: 2,
      currentPlaybackOccurrenceId: "playback-test",
      currentTrackGeneration: 4,
      positionSeconds: 42,
      wasPlaying: !this.state.paused,
      wasPaused: this.state.paused,
      outputRouteRevision: 3,
      capturedAt: "2026-08-02T00:00:00.000Z",
    });
  }

  releaseAudioOutput(): Promise<void> {
    this.releaseCount += 1;
    return Promise.resolve();
  }

  restoreAudioOutput(
    token: {
      readonly player: { readonly volume: number; readonly muted: boolean };
    },
    resume: boolean,
  ): Promise<void> {
    this.restores.push(resume);
    this.restoredLevels.push({
      volume: token.player.volume,
      muted: token.player.muted,
    });
    return Promise.resolve();
  }
}

async function fixture(playing = true) {
  const root = await mkdtemp(join(tmpdir(), "eidetic-source-arbiter-"));
  const preferences = new PreferencesStore(join(root, "preferences"));
  await preferences.initialize();
  const local = new FixtureLocalAdapter(localState(playing));
  const airplay = new FixtureExternalPlaybackProvider("airplay");
  const spotify = new FixtureExternalPlaybackProvider("spotify");
  const arbiter = new PlaybackSourceArbiter(
    local as unknown as LocalPlaybackAdapter,
    [airplay, spotify],
    new PlaybackArbitrationStore(join(root, "arbitration.json")),
    preferences,
  );
  await arbiter.initialize();
  return {
    arbiter,
    local,
    airplay,
    spotify,
    preferences,
    cleanup: async () => {
      await arbiter.shutdown();
      await rm(root, { recursive: true, force: true });
    },
  };
}

void test("external paused retains ownership until an explicit release", async () => {
  const subject = await fixture();
  try {
    const sessionId = subject.airplay.prepareSession({ title: "AirPlay QA" });
    await subject.arbiter.acquire("airplay", sessionId);
    subject.airplay.simulate("pause");
    assert.equal(subject.arbiter.snapshot().activeSource, "airplay");
    assert.equal(subject.arbiter.snapshot().providerState, "paused");
    assert.equal(subject.local.releaseCount, 1);
    assert.deepEqual(subject.local.restores, []);

    await subject.arbiter.resumeLocalPlayback();
    assert.equal(subject.arbiter.snapshot().activeSource, "local");
    assert.deepEqual(subject.local.restores, [true]);
  } finally {
    await subject.cleanup();
  }
});

void test("natural end obeys keep-paused and resume-interrupted policies", async () => {
  const subject = await fixture();
  try {
    let sessionId = subject.spotify.prepareSession();
    await subject.arbiter.acquire("spotify", sessionId);
    subject.spotify.simulate("end");
    await subject.arbiter.flush();
    assert.deepEqual(subject.local.restores, [false]);

    await subject.preferences.patch({
      changes: { externalPlaybackEndPolicy: "resume-interrupted" },
    });
    sessionId = subject.spotify.prepareSession();
    await subject.arbiter.acquire("spotify", sessionId);
    subject.spotify.simulate("end");
    await subject.arbiter.flush();
    assert.deepEqual(subject.local.restores, [false, true]);
  } finally {
    await subject.cleanup();
  }
});

void test("a failed acquire rolls local playback back to its captured state", async () => {
  const subject = await fixture();
  try {
    subject.airplay.setFailureMode({ acquire: true });
    const sessionId = subject.airplay.prepareSession();
    await assert.rejects(
      subject.arbiter.acquire("airplay", sessionId),
      /could not acquire/u,
    );
    assert.equal(subject.arbiter.snapshot().activeSource, "local");
    assert.deepEqual(subject.local.restores, [true]);
  } finally {
    await subject.cleanup();
  }
});

void test("the last valid external request replaces the previous owner", async () => {
  const subject = await fixture();
  try {
    const airplaySession = subject.airplay.prepareSession();
    await subject.arbiter.acquire("airplay", airplaySession);
    const spotifySession = subject.spotify.prepareSession();
    await subject.arbiter.acquire("spotify", spotifySession);
    assert.equal(subject.airplay.snapshot().state, "stopped");
    assert.equal(subject.arbiter.snapshot().activeSource, "spotify");
    assert.equal(subject.arbiter.snapshot().sessionId, spotifySession);
    assert.equal(subject.local.releaseCount, 1);
  } finally {
    await subject.cleanup();
  }
});

void test("a failed external replacement rolls back to the preserved local session", async () => {
  const subject = await fixture();
  try {
    const airplaySession = subject.airplay.prepareSession();
    await subject.arbiter.acquire("airplay", airplaySession);
    subject.spotify.setFailureMode({ acquire: true });
    const spotifySession = subject.spotify.prepareSession();
    await assert.rejects(
      subject.arbiter.acquire("spotify", spotifySession),
      /could not acquire/u,
    );
    assert.equal(subject.airplay.snapshot().state, "stopped");
    assert.equal(subject.spotify.snapshot().state, "stopped");
    assert.equal(subject.arbiter.snapshot().activeSource, "local");
    assert.equal(subject.arbiter.snapshot().phase, "error");
    assert.deepEqual(subject.local.restores, [true]);
  } finally {
    await subject.cleanup();
  }
});

void test("external commands preserve latest-intent semantics and maximum volume", async () => {
  const subject = await fixture();
  try {
    const sessionId = subject.spotify.prepareSession();
    await subject.arbiter.acquire("spotify", sessionId);
    const clientSessionId = "123e4567-e89b-42d3-a456-426614174000";
    await Promise.all([
      subject.arbiter.pause({
        clientSessionId,
        intentId: 1,
        requestedAtMilliseconds: 1,
      }),
      subject.arbiter.play({
        clientSessionId,
        intentId: 2,
        requestedAtMilliseconds: 2,
      }),
    ]);
    assert.equal(subject.spotify.snapshot().state, "playing");
    await subject.arbiter.setVolume(99);
    assert.equal(subject.arbiter.snapshot().volume, 80);
    assert.equal(subject.preferences.snapshot().preferences.volume, 80);
    await subject.arbiter.requestLocalOwnership(false);
    assert.deepEqual(subject.local.restoredLevels.at(-1), {
      volume: 80,
      muted: false,
    });
  } finally {
    await subject.cleanup();
  }
});

void test("startup adopts one external session and stops multiple owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-source-startup-"));
  const preferences = new PreferencesStore(join(root, "preferences"));
  await preferences.initialize();
  const local = new FixtureLocalAdapter();
  const airplay = new FixtureExternalPlaybackProvider("airplay");
  airplay.prepareSession();
  let arbiter = new PlaybackSourceArbiter(
    local as unknown as LocalPlaybackAdapter,
    [airplay],
    new PlaybackArbitrationStore(join(root, "one.json")),
    preferences,
  );
  try {
    await arbiter.initialize();
    assert.equal(arbiter.snapshot().activeSource, "airplay");
    assert.equal(local.releaseCount, 1);
    await arbiter.shutdown();

    const airplayTwo = new FixtureExternalPlaybackProvider("airplay");
    const spotifyTwo = new FixtureExternalPlaybackProvider("spotify");
    const multipleLocal = new FixtureLocalAdapter();
    airplayTwo.prepareSession();
    spotifyTwo.prepareSession();
    arbiter = new PlaybackSourceArbiter(
      multipleLocal as unknown as LocalPlaybackAdapter,
      [airplayTwo, spotifyTwo],
      new PlaybackArbitrationStore(join(root, "multiple.json")),
      preferences,
    );
    await arbiter.initialize();
    assert.equal(arbiter.snapshot().activeSource, "local");
    assert.equal(arbiter.snapshot().phase, "error");
    assert.equal(
      arbiter.snapshot().lastError?.code,
      "MULTIPLE_EXTERNAL_SOURCES",
    );
    assert.equal(airplayTwo.snapshot().state, "stopped");
    assert.equal(spotifyTwo.snapshot().state, "stopped");
    assert.deepEqual(multipleLocal.restores, [false]);
  } finally {
    await arbiter.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

void test("a stale persisted external session normalizes to local paused", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-source-stale-"));
  const path = join(root, "arbitration.json");
  const store = new PlaybackArbitrationStore(path);
  await store.load();
  await store.save({
    ...defaultPlaybackArbitrationDocument(),
    revision: 1,
    transitionGeneration: 1,
    activeSource: "spotify",
    phase: "external-active",
    providerSessionId: "spotify-stale-session",
    lastTransitionResult: { code: "acquired", success: true },
    updatedAt: "2026-08-02T00:00:00.000Z",
  });
  const preferences = new PreferencesStore(join(root, "preferences"));
  await preferences.initialize();
  const arbiter = new PlaybackSourceArbiter(
    new FixtureLocalAdapter(
      localState(false),
    ) as unknown as LocalPlaybackAdapter,
    [],
    store,
    preferences,
  );
  try {
    await arbiter.initialize();
    assert.equal(arbiter.snapshot().activeSource, "local");
    assert.equal(arbiter.snapshot().providerState, "paused");
    const persisted = await new PlaybackArbitrationStore(path).load();
    assert.equal(persisted.document.activeSource, "local");
    assert.equal(
      persisted.document.lastTransitionResult?.code,
      "interrupted-external-restored-local",
    );
  } finally {
    await arbiter.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

void test("provider crash and release failure remain recoverable without overlap", async () => {
  const subject = await fixture();
  try {
    const sessionId = subject.airplay.prepareSession();
    await subject.arbiter.acquire("airplay", sessionId);
    subject.airplay.setFailureMode({ release: true });
    subject.airplay.simulate("crash");
    await subject.arbiter.flush();
    assert.equal(subject.arbiter.snapshot().activeSource, "airplay");
    assert.equal(subject.arbiter.snapshot().phase, "error");
    assert.equal(
      subject.arbiter.snapshot().lastError?.code,
      "EXTERNAL_SOURCE_RELEASE_FAILED",
    );
    assert.deepEqual(subject.local.restores, []);
  } finally {
    await subject.cleanup();
  }
});
