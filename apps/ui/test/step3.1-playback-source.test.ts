import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  defaultPlaybackSourceSnapshot,
  playbackSourceKeepsDisplayActive,
} from "../../../packages/shared/src/playback-source.js";
import type { PlayerState } from "../../../packages/shared/src/player.js";
import { createActivePlaybackPresentation } from "../src/state/active-playback-presentation.js";
import { PlaybackSourceStore } from "../src/state/playback-source-store.js";

const localPlayer: PlayerState = {
  playerSessionId: "session-ui",
  trackTransitionId: 1,
  status: "paused",
  mpvAvailable: true,
  mpvVersion: "fixture",
  audioDevice: "USB DAC",
  currentTrack: null,
  positionSeconds: 0,
  durationSeconds: 0,
  paused: true,
  volume: 70,
  muted: false,
  shuffleEnabled: false,
  repeatMode: "off",
  currentQueueIndex: 0,
  queue: [],
  queueRevision: 0,
  error: null,
};

void test("external presentation never borrows local metadata or artwork", () => {
  const source = {
    ...defaultPlaybackSourceSnapshot,
    revision: 1,
    transitionGeneration: 8,
    activeSource: "spotify" as const,
    phase: "active" as const,
    providerState: "paused" as const,
    metadata: {
      title: "Fixture song",
      artist: "Fixture artist",
      album: "Fixture album",
      durationSeconds: 120,
    },
    artwork: null,
    positionSeconds: 17,
    durationSeconds: 120,
  };
  const presentation = createActivePlaybackPresentation(localPlayer, source);
  assert.equal(presentation.heading, "Now Playing — Spotify Connect");
  assert.equal(presentation.external, true);
  assert.equal(presentation.title, "Fixture song");
  assert.equal(presentation.artwork, null);
  assert.equal(presentation.paused, true);
});

void test("display inhibition follows external playing and buffering only", () => {
  for (const providerState of ["playing", "buffering"] as const)
    assert.equal(
      playbackSourceKeepsDisplayActive({
        ...defaultPlaybackSourceSnapshot,
        activeSource: "airplay",
        providerState,
      }),
      true,
    );
  assert.equal(
    playbackSourceKeepsDisplayActive({
      ...defaultPlaybackSourceSnapshot,
      activeSource: "airplay",
      providerState: "paused",
    }),
    false,
  );
});

void test("the first source snapshot after SSE reconnect resets backend-local revisions", () => {
  const staleExternal = {
    ...defaultPlaybackSourceSnapshot,
    revision: 42,
    transitionGeneration: 7,
    activeSource: "spotify" as const,
    phase: "active" as const,
    sessionId: "old-backend-session",
  };
  const restartedLocal = {
    ...defaultPlaybackSourceSnapshot,
    revision: 1,
    transitionGeneration: 7,
    phase: "active" as const,
  };
  const store = new PlaybackSourceStore(staleExternal);
  store.setState(restartedLocal);
  assert.equal(store.getState().activeSource, "spotify");
  store.replaceStateAfterReconnect(restartedLocal);
  assert.equal(store.getState().activeSource, "local");
  assert.equal(store.getState().revision, 1);
});

void test("local and Remote surfaces use source-aware state without another SSE", async () => {
  const [shell, nowPlaying, queue, settings, remote, remoteContract] =
    await Promise.all([
      readFile("apps/ui/src/components/app-shell.ts", "utf8"),
      readFile("apps/ui/src/screens/now-playing.ts", "utf8"),
      readFile("apps/ui/src/components/queue-drawer.ts", "utf8"),
      readFile("apps/ui/src/screens/settings.ts", "utf8"),
      readFile("apps/remote-ui/src/main.ts", "utf8"),
      readFile("packages/shared/src/remote-access.ts", "utf8"),
    ]);
  assert.match(shell, /playbackSourceStore\.subscribe/u);
  assert.match(shell, /playbackSourceKeepsDisplayActive/u);
  assert.match(nowPlaying, /Resume local playback/u);
  assert.match(nowPlaying, /sourceIndicator\.innerHTML/u);
  assert.match(
    queue,
    /Local playback is paused while \$\{playbackSourceDisplayName\(source\.activeSource\)\} is active\./u,
  );
  assert.match(settings, /After external playback ends/u);
  assert.match(settings, /Keep local playback paused/u);
  assert.match(settings, /Resume interrupted playback/u);
  assert.match(remote, /"playback-source"/u);
  assert.match(remote, /Resume local playback/u);
  assert.match(remoteContract, /\| "playback-source"/u);
  assert.equal((remote.match(/new EventSource\(/gu) ?? []).length, 1);
});

void test("AirPlay uses a truthful conditional Line timeline on both player surfaces", async () => {
  const [nowPlaying, miniPlayer, timeline, remote] = await Promise.all([
    readFile("apps/ui/src/screens/now-playing.ts", "utf8"),
    readFile("apps/ui/src/components/mini-player.ts", "utf8"),
    readFile("apps/ui/src/components/timeline.ts", "utf8"),
    readFile("apps/remote-ui/src/main.ts", "utf8"),
  ]);
  assert.match(
    nowPlaying,
    /active\.source === "airplay"[\s\S]*setStyle\([\s\S]*"line"/u,
  );
  assert.match(
    nowPlaying,
    /active\.source === "airplay" && !active\.capabilities\.progress/u,
  );
  assert.match(
    miniPlayer,
    /presentation\.source === "airplay" &&[\s\S]*!presentation\.capabilities\.progress/u,
  );
  assert.match(timeline, /setStyle\(nextStyle\)/u);
  assert.match(
    remote,
    /source\.activeSource === "airplay" && !source\.capabilities\.progress/u,
  );
  assert.match(remote, /Controlled by the sender/u);
});
