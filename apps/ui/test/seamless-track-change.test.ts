import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  ArtworkRef,
  PlayerState,
  PlayerTrack,
} from "../../../packages/shared/src/player";
import { shouldRetainArtworkImage } from "../src/components/artwork-transition";
import { favoriteTrackIndicatorHidden } from "../src/components/favorite-track-indicator";
import { SeamlessTrackPresentationCoordinator } from "../src/state/track-transition-coordinator";

const sharedArtwork: ArtworkRef = {
  id: "artwork-album",
  mimeType: "image/jpeg",
  sourceType: "embedded",
  revision: "album-cover-revision",
};

function track(name: string, title: string): PlayerTrack {
  return {
    path: `C:\\Music\\${name}.flac`,
    filename: `${name}.flac`,
    title,
    artist: "Tagged artist",
    album: "Tagged album",
    artists: ["Tagged artist"],
    albumArtist: null,
    trackNumber: null,
    trackTotal: null,
    discNumber: null,
    discTotal: null,
    year: null,
    genre: [],
    durationSeconds: 180,
    format: "FLAC",
    codec: "flac",
    sampleRate: 44_100,
    bitDepth: 16,
    bitrate: null,
    lossless: true,
    container: "FLAC",
    artwork: sharedArtwork,
    source: "Local File",
  };
}

function state(
  generation: number,
  name: string,
  title: string,
  currentTrack: PlayerTrack | null,
): PlayerState {
  return {
    playerSessionId: "seamless-transition",
    trackTransitionId: generation,
    playbackPlanRevision: generation,
    status: "playing",
    mpvAvailable: true,
    mpvVersion: "mpv",
    currentTrack,
    positionSeconds: currentTrack ? 2 : 0,
    durationSeconds: 180,
    paused: false,
    volume: 80,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    currentQueueIndex: -1,
    queue: [],
    queueRevision: 0,
    audioDevice: "Default output",
    error: null,
    currentPlayback: {
      playbackInstanceId: `playback-${name}`,
      source: "context",
      relationId: `context-${name}`,
      contextId: "album-context",
      historyEntryId: null,
      startedSequence: generation,
      item: {
        filename: `${name}.flac`,
        displayTitle: title,
        artist: currentTrack?.artist ?? null,
        album: currentTrack?.album ?? null,
        durationSeconds: 180,
        artwork: currentTrack?.artwork ?? null,
        available: true,
        libraryTrackId: `track-${name}`,
      },
    },
  };
}

void test("Next and Previous retain one coherent presentation until destination tags settle", () => {
  const coordinator = new SeamlessTrackPresentationCoordinator();
  const first = coordinator.accept(
    state(1, "one", "First tagged title", track("one", "First tagged title")),
  );
  const provisional = coordinator.accept(state(2, "two", "02 two", null));

  assert.equal(provisional.trackId, "playback-two");
  assert.equal(provisional.generation, 2);
  assert.deepEqual(
    [provisional.title, provisional.artist, provisional.album],
    [first.title, first.artist, first.album],
  );
  assert.equal(provisional.artwork?.revision, first.artwork?.revision);

  const settled = coordinator.accept(
    state(2, "two", "Second tagged title", track("two", "Second tagged title")),
  );
  assert.equal(settled.title, "Second tagged title");
  assert.equal(settled.artwork?.revision, sharedArtwork.revision);
});

void test("an untagged destination commits its filename only after MPV settles it", () => {
  const coordinator = new SeamlessTrackPresentationCoordinator();
  coordinator.accept(
    state(1, "one", "First tagged title", track("one", "First tagged title")),
  );
  assert.equal(
    coordinator.accept(state(2, "two", "02 two", null)).title,
    "First tagged title",
  );
  assert.equal(
    coordinator.accept(state(2, "two", "02 two", track("two", "02 two"))).title,
    "02 two",
  );
});

void test("same decoded artwork survives a generation change", () => {
  assert.equal(
    shouldRetainArtworkImage(
      sharedArtwork.revision,
      sharedArtwork.revision,
      true,
    ),
    true,
  );
  assert.equal(
    shouldRetainArtworkImage(sharedArtwork.revision, "different", true),
    false,
  );
});

void test("favorite status remains the sole owner of local heart visibility", async () => {
  assert.equal(favoriteTrackIndicatorHidden(true, false), false);
  assert.equal(favoriteTrackIndicatorHidden(false, false), true);
  assert.equal(favoriteTrackIndicatorHidden(true, true), true);

  const [nowPlaying, miniPlayer] = await Promise.all([
    readFile("apps/ui/src/screens/now-playing.ts", "utf8"),
    readFile("apps/ui/src/components/mini-player.ts", "utf8"),
  ]);
  assert.doesNotMatch(nowPlaying, /favoriteIndicator\.element\.hidden\s*=/);
  assert.doesNotMatch(
    miniPlayer,
    /favoriteIndicator\?\.element\.toggleAttribute\(\s*["']hidden["']/,
  );
  assert.match(nowPlaying, /favoriteIndicator\.setSuppressed\(external\)/);
  assert.match(miniPlayer, /favoriteIndicator\?\.setSuppressed\(/);
});
