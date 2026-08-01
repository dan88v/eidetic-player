import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  PlayerState,
  PlayerTrack,
  QueueItem,
} from "../../../packages/shared/src/player";
import {
  createTrackPresentationSnapshot,
  TrackTransitionCoordinator,
} from "../src/state/track-transition-coordinator";
import { isSameWaveformRequest } from "../src/timeline/waveform-request-identity";

const track = (name: string, artwork = true): PlayerTrack => ({
  path: `C:\\Music\\${name}.flac`,
  filename: `${name}.flac`,
  title: `${name} title`,
  artist: `${name} artist`,
  album: `${name} album`,
  artists: [`${name} artist`],
  albumArtist: null,
  trackNumber: 1,
  trackTotal: 3,
  discNumber: 1,
  discTotal: 1,
  year: 2026,
  genre: [],
  durationSeconds: 200,
  format: "FLAC",
  codec: "flac",
  sampleRate: 48_000,
  bitDepth: 24,
  bitrate: 1_000_000,
  lossless: true,
  container: "FLAC",
  artwork: artwork
    ? {
        id: `art-${name}`,
        mimeType: "image/jpeg",
        sourceType: "embedded",
        revision: `revision-${name}`,
      }
    : null,
  source: "Local File",
});

function state(
  generation: number,
  name: string,
  options: {
    readonly artwork?: boolean;
    readonly position?: number;
    readonly duration?: number;
    readonly queue?: readonly QueueItem[];
    readonly index?: number;
  } = {},
): PlayerState {
  const current = track(name, options.artwork);
  const queue =
    options.queue ??
    ([
      {
        id: `queue-${name}`,
        index: 0,
        path: current.path,
        filename: current.filename,
        displayTitle: current.title,
        artwork: current.artwork,
        isCurrent: true,
      },
    ] satisfies readonly QueueItem[]);
  return {
    playerSessionId: "transition-test",
    trackTransitionId: generation,
    status: "playing",
    mpvAvailable: true,
    mpvVersion: "mpv",
    currentTrack: current,
    positionSeconds: options.position ?? 10,
    durationSeconds: options.duration ?? 200,
    paused: false,
    volume: 80,
    muted: false,
    shuffleEnabled: false,
    repeatMode: "off",
    currentQueueIndex: options.index ?? 0,
    queue,
    queueRevision: generation,
    audioDevice: "Default output",
    error: null,
  };
}

function authoritativeState(
  generation: number,
  name: string,
  startedSequence: number,
): PlayerState {
  const base = state(generation, name);
  const current = base.currentTrack;
  assert.ok(current);
  return {
    ...base,
    playbackPlanRevision: startedSequence,
    currentPlayback: {
      playbackInstanceId: `playback-${name}`,
      source: "context",
      relationId: `context-${name}`,
      contextId: `context-${name}`,
      historyEntryId: null,
      startedSequence,
      item: {
        filename: current.filename,
        displayTitle: current.title,
        artist: current.artist,
        album: current.album,
        durationSeconds: current.durationSeconds,
        artwork: current.artwork,
        available: true,
        libraryTrackId: null,
      },
    },
  };
}

void test("metadata snapshot commits title, artist, album and technical data together", () => {
  const snapshot = createTrackPresentationSnapshot(state(1, "one"));
  assert.deepEqual(
    [snapshot.title, snapshot.artist, snapshot.album],
    ["one title", "one artist", "one album"],
  );
  assert.match(snapshot.technical, /FLAC/);
});

void test("presentation preserves slash, Unicode and HTML-like artist text literally", () => {
  for (const artist of [
    "AC/DC",
    "Artist A / Artist B",
    "AC\\DC",
    "Guns N' Roses",
    "Simon & Garfunkel",
    "Earth, Wind & Fire",
    "Sigur Rós",
    "Björk",
    "<b>Artist</b>",
    "A & B < C",
    "Cafe\u0301",
  ]) {
    const input = state(1, "literal");
    const snapshot = createTrackPresentationSnapshot({
      ...input,
      currentTrack: input.currentTrack
        ? { ...input.currentTrack, artist }
        : null,
    });
    assert.equal(snapshot.artist, artist);
  }
});

void test("normal track changes never synthesize an intermediate Unknown title", () => {
  const coordinator = new TrackTransitionCoordinator();
  coordinator.accept(state(1, "one"));
  const accepted = coordinator.accept(state(2, "two"));
  assert.equal(accepted.currentTrack?.title, "two title");
  assert.doesNotMatch(accepted.currentTrack.title, /Unknown/);
});

void test("obsolete generations are ignored", () => {
  const coordinator = new TrackTransitionCoordinator();
  coordinator.accept(state(4, "four"));
  assert.equal(
    coordinator.accept(state(3, "three")).currentTrack?.title,
    "four title",
  );
  assert.equal(coordinator.getDiagnostics().staleStatesIgnored, 1);
});

void test("same-generation planner Current advances by monotonic public revision", () => {
  const coordinator = new TrackTransitionCoordinator();
  const first = authoritativeState(4, "one", 1);
  const second = authoritativeState(4, "two", 2);
  coordinator.accept(first);
  assert.equal(
    coordinator.accept(second).currentPlayback?.playbackInstanceId,
    "playback-two",
  );
  assert.equal(
    coordinator.accept(first).currentPlayback?.playbackInstanceId,
    "playback-two",
  );
  assert.equal(coordinator.getDiagnostics().staleStatesIgnored, 1);
});

void test("same-generation planner rollback advances its public revision", () => {
  const coordinator = new TrackTransitionCoordinator();
  const first = authoritativeState(4, "one", 1);
  const attempted = authoritativeState(4, "two", 2);
  const rolledBack = { ...first, playbackPlanRevision: 3 };
  coordinator.accept(first);
  coordinator.accept(attempted);
  assert.equal(
    coordinator.accept(rolledBack).currentPlayback?.playbackInstanceId,
    "playback-one",
  );
  assert.equal(
    coordinator.accept(attempted).currentPlayback?.playbackInstanceId,
    "playback-one",
  );
});

void test("same-generation authoritative stop cannot be undone by a late Current", () => {
  const coordinator = new TrackTransitionCoordinator();
  const current = authoritativeState(7, "one", 3);
  coordinator.accept(current);
  const stopped = coordinator.accept({
    ...current,
    playbackPlanRevision: 4,
    currentPlayback: null,
    currentTrack: null,
    status: "stopped",
    paused: true,
    positionSeconds: 0,
    durationSeconds: 0,
  });
  assert.equal(stopped.currentPlayback, null);
  assert.equal(coordinator.accept(current).currentPlayback, null);
});

void test("new metadata cannot retain the previous artwork", () => {
  const next = createTrackPresentationSnapshot(
    state(2, "two", { artwork: false }),
  );
  assert.equal(next.title, "two title");
  assert.equal(next.artwork, null);
});

void test("authoritative Current replaces stale observed metadata as one placeholder snapshot", () => {
  const stale = state(2, "old", { position: 91, duration: 200 });
  const nextArtwork = track("next").artwork;
  const snapshot = createTrackPresentationSnapshot({
    ...stale,
    currentPlayback: {
      playbackInstanceId: "playback-next",
      source: "context",
      relationId: "context-next-item",
      contextId: "context-next",
      historyEntryId: null,
      startedSequence: 2,
      item: {
        filename: "next.flac",
        displayTitle: "next title",
        artist: "next artist",
        album: "next album",
        durationSeconds: 180,
        artwork: nextArtwork,
        available: true,
        libraryTrackId: "track-next",
      },
    },
  });

  assert.deepEqual(
    [snapshot.title, snapshot.artist, snapshot.album],
    ["next title", "next artist", "next album"],
  );
  assert.equal(snapshot.artwork?.revision, "revision-next");
  assert.equal(snapshot.technical, "");
  assert.equal(snapshot.positionSeconds, 0);
  assert.equal(snapshot.durationSeconds, 180);
});

void test("authoritative Current never falls back to stale artwork on a cache miss", () => {
  const stale = state(2, "old");
  const snapshot = createTrackPresentationSnapshot({
    ...stale,
    currentPlayback: {
      playbackInstanceId: "playback-next",
      source: "explicit-queue",
      relationId: "explicit-next",
      contextId: null,
      historyEntryId: null,
      startedSequence: 2,
      item: {
        filename: "next.flac",
        displayTitle: "next title",
        artist: null,
        album: null,
        artwork: null,
        available: true,
        libraryTrackId: null,
      },
    },
  });

  assert.equal(snapshot.title, "next title");
  assert.equal(snapshot.artwork, null);
});

void test("artwork cache miss resolves to the immediate placeholder state", () => {
  assert.equal(
    createTrackPresentationSnapshot(state(2, "two", { artwork: false }))
      .artwork,
    null,
  );
});

void test("preloaded Queue artwork is handed to the current snapshot", () => {
  const current = track("two", false);
  const queueArtwork = track("two").artwork;
  const input = state(2, "two", {
    artwork: false,
    queue: [
      {
        id: "queue-two",
        index: 0,
        path: current.path,
        filename: current.filename,
        displayTitle: current.title,
        artwork: queueArtwork,
        isCurrent: true,
      },
    ],
  });
  assert.equal(
    createTrackPresentationSnapshot(input).artwork?.revision,
    "revision-two",
  );
});

void test("artwork implementation decodes before committing the image", async () => {
  const source = await readFile("apps/ui/src/components/artwork.ts", "utf8");
  assert.ok(source.indexOf(".decode()") < source.indexOf("commit(template"));
});

void test("track change invalidates waveform before requesting its replacement", async () => {
  const source = await readFile("apps/ui/src/screens/now-playing.ts", "utf8");
  assert.ok(
    source.indexOf("timeline.setWaveform(null") <
      source.indexOf("waveformLoader.load("),
  );
});

void test("empty waveform rail is deterministic and remains available", async () => {
  const source = await readFile(
    "apps/ui/src/timeline/timeline-renderer.ts",
    "utf8",
  );
  assert.match(source, /#242b38/);
});

void test("waveform results carry and verify the current generation", async () => {
  const source = await readFile("apps/ui/src/screens/now-playing.ts", "utf8");
  assert.match(source, /isSameWaveformRequest\(waveformRequest/);
});

void test("restored playback reloads waveform when bootstrap generation advances", () => {
  const bootstrapRequest = {
    queueItemId: "playback-restored",
    trackGeneration: 0,
  };
  const restoredRequest = {
    queueItemId: "playback-restored",
    trackGeneration: 1,
  };

  assert.equal(isSameWaveformRequest(bootstrapRequest, restoredRequest), false);
  assert.equal(isSameWaveformRequest(restoredRequest, restoredRequest), true);
});

void test("visualizer rejects obsolete track frames", async () => {
  const source = await readFile(
    "apps/ui/src/visualizer/visualizer-frame-buffer.ts",
    "utf8",
  );
  assert.match(source, /frame\.trackId !== trackId/);
  assert.match(source, /frame\.trackTransitionId !== trackTransitionId/);
});

void test("visualizer resets meter and decays spectrum on a track change", async () => {
  const source = await readFile("apps/ui/src/components/visualizer.ts", "utf8");
  assert.match(source, /meter\.reset\(\)/);
  assert.match(source, /decaying = mode === "technical" \? false : hasFrame/);
});

void test("position and duration are clamped as one coherent pair", () => {
  const snapshot = createTrackPresentationSnapshot(
    state(1, "one", { position: 240, duration: 200 }),
  );
  assert.deepEqual(
    [snapshot.positionSeconds, snapshot.durationSeconds],
    [200, 200],
  );
});

void test("mini-player consumes the shared atomic presentation snapshot", async () => {
  const source = await readFile(
    "apps/ui/src/components/mini-player.ts",
    "utf8",
  );
  assert.match(source, /createTrackPresentationSnapshot\(state\)/);
});

void test("local transports disable Next at the authoritative playback boundary", async () => {
  const nowPlaying = await readFile(
    "apps/ui/src/screens/now-playing.ts",
    "utf8",
  );
  const miniPlayer = await readFile(
    "apps/ui/src/components/mini-player.ts",
    "utf8",
  );
  assert.match(nowPlaying, /state\.canGoNext === false/);
  assert.match(miniPlayer, /nextUnavailable = state\.canGoNext === false/);
});

void test("Queue update path never replaces the complete list", async () => {
  const source = await readFile(
    "apps/ui/src/components/queue-drawer.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /list\.replaceChildren/);
});

void test("Queue current state uses aria-current without structural rebuild", async () => {
  const source = await readFile(
    "apps/ui/src/components/queue-drawer.ts",
    "utf8",
  );
  assert.match(source, /setAttribute\("aria-current", "true"\)/);
  assert.match(source, /classList\.toggle\("queue-item--current"/);
});

void test("last command wins records superseded commands", () => {
  const coordinator = new TrackTransitionCoordinator();
  coordinator.accept(state(1, "one"));
  coordinator.noteTrackCommand();
  coordinator.noteTrackCommand();
  coordinator.noteTrackCommand();
  coordinator.accept(state(2, "four"));
  assert.equal(coordinator.getDiagnostics().cancelledCommands, 2);
});

void test("three rapid Next commands converge on the newest generation", () => {
  const coordinator = new TrackTransitionCoordinator();
  coordinator.accept(state(1, "one"));
  for (let index = 0; index < 3; index += 1) coordinator.noteTrackCommand();
  assert.equal(coordinator.accept(state(4, "four")).trackTransitionId, 4);
});

void test("rapid alternating Next and Previous ignores late intermediate state", () => {
  const coordinator = new TrackTransitionCoordinator();
  coordinator.accept(state(1, "one"));
  coordinator.noteTrackCommand();
  coordinator.noteTrackCommand();
  coordinator.accept(state(3, "three"));
  assert.equal(
    coordinator.accept(state(2, "two")).currentTrack?.title,
    "three title",
  );
});

void test("automatic end-of-track uses the same monotonic generation path", () => {
  const coordinator = new TrackTransitionCoordinator();
  coordinator.accept(state(8, "eight"));
  assert.equal(coordinator.accept(state(9, "nine")).trackTransitionId, 9);
});

void test("one-line and two-line titles reserve the same fixed CSS height", async () => {
  const css = await readFile("apps/ui/src/styles/screens.css", "utf8");
  assert.match(css, /\.now-playing__track[\s\S]*?height: 2\.3em/);
  assert.match(css, /\.now-playing__track[\s\S]*?padding-bottom: 0\.1em/);
  assert.match(css, /-webkit-line-clamp: 2/);
});

void test("artist, album and technical geometry reserves descender space", async () => {
  const css = await readFile("apps/ui/src/styles/screens.css", "utf8");
  assert.match(css, /\.now-playing__artist[\s\S]*?height: 1\.35em/);
  assert.match(css, /\.now-playing__album[\s\S]*?height: 1\.35em/);
  assert.match(css, /\.now-playing__technical[\s\S]*?height: 1\.45em/);
  assert.equal((css.match(/padding-bottom: 0\.1em/g) ?? []).length >= 4, true);
});

void test("Now Playing artist and album use the approved readable one-line ranges", async () => {
  const css = await readFile("apps/ui/src/styles/screens.css", "utf8");
  assert.match(
    css,
    /\.now-playing__artist[\s\S]*?font-size:\s*clamp\(1\.9375rem,[^;]+,\s*2rem\)/,
  );
  assert.match(
    css,
    /\.now-playing__album[\s\S]*?font-size:\s*clamp\(1\.5rem,[^;]+,\s*1\.625rem\)/,
  );
});

void test("compact Now Playing grows square artwork to at most 40vw and reduces the visualizer", async () => {
  const css = await readFile("apps/ui/src/styles/responsive.css", "utf8");
  assert.match(
    css,
    /@media \(max-width: 68\.75rem\)[\s\S]*?--now-playing-artwork-size:\s*clamp\(18rem,\s*40vw,\s*25rem\)/,
  );
  assert.match(
    css,
    /@media \(max-width: 68\.75rem\)[\s\S]*?--now-playing-visualizer-height:\s*clamp\(5rem,\s*12vh,\s*6rem\)/,
  );
  assert.match(
    await readFile("apps/ui/src/styles/screens.css", "utf8"),
    /\.now-playing__artwork[\s\S]*?aspect-ratio:\s*1\s*\/\s*1/,
  );
  assert.match(
    css,
    /@media \(max-width: 68\.75rem\) and \(max-height: 40rem\)[\s\S]*?--now-playing-artwork-size:\s*clamp\(16rem,\s*36vw,\s*20rem\)[\s\S]*?--now-playing-visualizer-height:\s*clamp\(4rem,\s*10vh,\s*5rem\)/,
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width: 68\.75rem\) and \(max-height: 40rem\)[\s\S]*?\.now-playing__technical\s*\{\s*display:\s*none/,
  );
});

void test("Now Playing artwork is a native Library navigation button", async () => {
  const source = await readFile("apps/ui/src/screens/now-playing.ts", "utf8");
  assert.match(
    source,
    /const artworkButton = document\.createElement\("button"\)/,
  );
  assert.match(source, /artworkButton\.type = "button"/);
  assert.match(
    source,
    /artworkButton\.setAttribute\("aria-label", t\("nav\.openLibrary"\)\)/,
  );
  assert.match(source, /artworkButton\.append\(artwork\.element\)/);
  assert.match(
    source,
    /artworkButton\.addEventListener\("click", options\.onOpenLibrary\)/,
  );
  assert.doesNotMatch(source, /artworkButton\.addEventListener\("pointer/);
  assert.doesNotMatch(source, /artworkButton\.addEventListener\("key/);
  assert.match(source, /else element\.textContent = value/);
  assert.doesNotMatch(source, /artist\.innerHTML|album\.innerHTML/);
});

void test("Animations Off removes artwork transition duration", async () => {
  const source = await readFile("apps/ui/src/components/artwork.ts", "utf8");
  assert.match(source, /dataset\.animations !==\s*"false"/);
});

void test("prefers-reduced-motion removes artificial artwork delay", async () => {
  const source = await readFile("apps/ui/src/components/artwork.ts", "utf8");
  assert.match(source, /prefers-reduced-motion: reduce/);
});

void test("bootstrap, shell, artwork and Canvas surfaces are explicitly dark", async () => {
  const [html, layout, screens, components] = await Promise.all([
    readFile("apps/ui/index.html", "utf8"),
    readFile("apps/ui/src/styles/layout.css", "utf8"),
    readFile("apps/ui/src/styles/screens.css", "utf8"),
    readFile("apps/ui/src/styles/components.css", "utf8"),
  ]);
  assert.match(html, /background: #0b0e14/);
  assert.match(layout, /background: var\(--color-bg\)/);
  assert.match(screens, /\.visualizer__canvas[\s\S]*?background:/);
  assert.match(components, /\.artwork[\s\S]*?background:/);
});

void test("visualizer owns a single requestAnimationFrame handle", async () => {
  const source = await readFile("apps/ui/src/components/visualizer.ts", "utf8");
  assert.equal((source.match(/let animationFrame = 0/g) ?? []).length, 1);
});

void test("visualizer owns one EventSource client", async () => {
  const source = await readFile("apps/ui/src/components/visualizer.ts", "utf8");
  assert.equal(
    (source.match(/new VisualizerStreamClient\(\)/g) ?? []).length,
    1,
  );
});

void test("analyzer transition identity includes generation and track", async () => {
  const source = await readFile(
    "apps/backend/src/analysis/audio-analyzer-service.ts",
    "utf8",
  );
  assert.match(source, /trackId !== this\.activeTrackId/);
  assert.match(source, /trackTransitionId !== this\.activeTransitionId/);
});

void test("rapid waveform cleanup aborts current and preload requests", async () => {
  const source = await readFile(
    "apps/ui/src/timeline/waveform-loader.ts",
    "utf8",
  );
  assert.match(source, /this\.controller\?\.abort\(\)/);
  assert.match(source, /this\.preloadController\?\.abort\(\)/);
});

void test("metadata enrichment within one generation keeps stable identity", () => {
  const coordinator = new TrackTransitionCoordinator();
  const first = state(2, "two", { artwork: false });
  coordinator.accept(first);
  const enriched = state(2, "two");
  assert.equal(
    coordinator.accept(enriched).currentTrack?.artwork?.revision,
    "revision-two",
  );
});

void test("a reconnected backend session resets generation ordering safely", () => {
  const coordinator = new TrackTransitionCoordinator();
  coordinator.accept(state(12, "old"));
  const fresh = {
    ...state(1, "fresh"),
    playerSessionId: "reconnected-session",
  };
  assert.equal(coordinator.accept(fresh).currentTrack?.title, "fresh title");
});
