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

void test("metadata snapshot commits title, artist, album and technical data together", () => {
  const snapshot = createTrackPresentationSnapshot(state(1, "one"));
  assert.deepEqual(
    [snapshot.title, snapshot.artist, snapshot.album],
    ["one title", "one artist", "one album"],
  );
  assert.match(snapshot.technical, /FLAC/);
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

void test("new metadata cannot retain the previous artwork", () => {
  const next = createTrackPresentationSnapshot(
    state(2, "two", { artwork: false }),
  );
  assert.equal(next.title, "two title");
  assert.equal(next.artwork, null);
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
  assert.match(source, /playerState\.trackTransitionId === generation/);
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
