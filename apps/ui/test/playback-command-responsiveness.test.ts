import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  PlayerCommandState,
  PlayerState,
} from "../../../packages/shared/src/player.js";
import { PlaybackCommandCoordinator } from "../src/state/playback-command-coordinator.js";
import { disconnectedPlayerState } from "../src/state/player-store.js";

function commands(patch: Partial<PlayerCommandState> = {}): PlayerCommandState {
  return {
    volume: {
      generation: 0,
      clientSessionId: null,
      clientIntentId: 0,
      phase: "confirmed",
      target: 80,
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
      target: false,
    },
    navigation: {
      generation: 0,
      clientSessionId: null,
      clientIntentId: 0,
      phase: "confirmed",
      targetQueueItemId: null,
    },
    failureRevision: 0,
    ...patch,
  };
}

function state(patch: Partial<PlayerState> = {}): PlayerState {
  return {
    ...disconnectedPlayerState,
    mpvAvailable: true,
    status: "playing",
    volume: 80,
    paused: false,
    commands: commands(),
    ...patch,
  };
}

void test("UI volume preview survives stale snapshots until matching confirmation", () => {
  const confirmed: [string, unknown][] = [];
  const coordinator = new PlaybackCommandCoordinator({
    onConfirmed: (kind, target) => confirmed.push([kind, target]),
  });
  const first = coordinator.beginVolume(state(), 63);
  const stale = coordinator.receive(
    state({
      volume: 0,
      commands: commands({
        volume: {
          generation: 1,
          clientSessionId: first.metadata.clientSessionId ?? null,
          clientIntentId: first.metadata.intentId,
          phase: "acknowledged",
          target: 63,
        },
      }),
    }),
  );
  assert.equal(stale.volume, 63);
  const final = coordinator.receive(
    state({
      volume: 62.999,
      commands: commands({
        volume: {
          generation: 1,
          clientSessionId: first.metadata.clientSessionId ?? null,
          clientIntentId: first.metadata.intentId,
          phase: "confirmed",
          target: 63,
        },
      }),
    }),
  );
  assert.equal(final.volume, 62.999);
  assert.deepEqual(confirmed, [["volume", 63]]);
});

void test("latest UI intent wins and an old API failure cannot roll it back", () => {
  const coordinator = new PlaybackCommandCoordinator();
  const first = coordinator.beginVolume(state(), 40);
  const second = coordinator.beginVolume(first.state, 70);
  const afterOldFailure = coordinator.apiFailed(
    "volume",
    first.metadata.intentId,
    state({ volume: 80 }),
  );
  assert.equal(afterOldFailure.volume, 70);
  const afterLatestFailure = coordinator.apiFailed(
    "volume",
    second.metadata.intentId,
    state({ volume: 80 }),
  );
  assert.equal(afterLatestFailure.volume, 80);
});

void test("rapid transport targets remain explicit and optimistic", () => {
  const coordinator = new PlaybackCommandCoordinator();
  const pause = coordinator.beginTransport(state(), true);
  assert.equal(pause.state.paused, true);
  const play = coordinator.beginTransport(pause.state, false);
  assert.equal(play.state.paused, false);
  assert.ok(play.metadata.intentId > pause.metadata.intentId);
});

void test("rapid navigation retains the latest stable Queue target", () => {
  const coordinator = new PlaybackCommandCoordinator();
  const first = coordinator.beginNavigation(
    "queue-123e4567-e89b-42d3-a456-426614174001",
  );
  assert.equal(
    coordinator.pendingNavigationTarget(),
    "queue-123e4567-e89b-42d3-a456-426614174001",
  );
  const second = coordinator.beginNavigation(
    "queue-123e4567-e89b-42d3-a456-426614174002",
  );
  assert.ok(second.intentId > first.intentId);
  assert.equal(
    coordinator.pendingNavigationTarget(),
    "queue-123e4567-e89b-42d3-a456-426614174002",
  );
});

void test("popover, persistence, Queue identity, and loading controls enforce the corrective", async () => {
  const [popover, shell, queueDrawer, nowPlaying, miniPlayer] =
    await Promise.all([
      readFile(
        new URL("../src/components/volume-popover.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/components/app-shell.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/components/queue-drawer.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/screens/now-playing.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/components/mini-player.ts", import.meta.url),
        "utf8",
      ),
    ]);
  assert.match(
    popover,
    /confirmedVolume = nextVolume[\s\S]*activePointerId === null/,
  );
  assert.match(
    popover,
    /pointercancel[\s\S]*volume = confirmedVolume[\s\S]*render\(\)/,
  );
  assert.match(popover, /ArrowUp[\s\S]*PageUp[\s\S]*Home[\s\S]*End/);
  assert.doesNotMatch(shell, /savePlaybackPreferences\(\{/);
  assert.match(shell, /onConfirmed[\s\S]*saveVolumePreference/);
  assert.match(shell, /onConfirmed[\s\S]*saveMutedPreference/);
  assert.match(
    shell,
    /api\.shuffle\(enabled\)\.then[\s\S]*saveShufflePreference/,
  );
  assert.match(shell, /api\.repeat\(mode\)\.then[\s\S]*saveRepeatPreference/);
  assert.match(queueDrawer, /options\.onPlay\(index, queueItemId\)/);
  assert.match(shell, /pendingNavigationTarget/);
  assert.match(shell, /api\.next\(targetId, metadata\)/);
  assert.match(shell, /api\.previous\(targetId, metadata\)/);
  assert.match(nowPlaying, /state\.mpvAvailable && state\.queue\.length > 0/);
  assert.match(
    miniPlayer,
    /!state\.mpvAvailable \|\| state\.queue\.length === 0/,
  );
  assert.doesNotMatch(miniPlayer, /status === "loading"/);
});
