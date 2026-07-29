import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string): Promise<string> => readFile(path, "utf8");

void test("MPV recovery stays contextual to Now Playing and keeps Settings unchanged", async () => {
  const [nowPlaying, settings, styles] = await Promise.all([
    read("apps/ui/src/screens/now-playing.ts"),
    read("apps/ui/src/screens/settings.ts"),
    read("apps/ui/src/styles/screens.css"),
  ]);

  assert.match(nowPlaying, /now-playing__recovery/u);
  assert.match(nowPlaying, /now-playing__retry-mpv/u);
  assert.match(nowPlaying, /options\.actions\s*\.retryMpv\(\)/u);
  assert.match(nowPlaying, /recovery\.hidden = state\.mpvAvailable/u);
  assert.match(nowPlaying, /visualizerSlot\.hidden = !state\.mpvAvailable/u);
  assert.doesNotMatch(settings, /retryMpv|Retry MPV/u);
  assert.match(styles, /\.now-playing__recovery\[hidden\]/u);
  assert.match(styles, /\.now-playing__retry-mpv/u);
  assert.match(styles, /\.now-playing__visualizer-slot\[hidden\]/u);
});

void test("bootstrap and navigation capabilities do not depend on MPV recovery", async () => {
  const [backend, session, recovery] = await Promise.all([
    read("apps/backend/src/index.ts"),
    read("apps/backend/src/player-session/player-session-service.ts"),
    read("apps/backend/src/player/player-recovery-service.ts"),
  ]);

  assert.match(backend, /url\.pathname === "\/api\/player\/retry-mpv"/u);
  assert.match(backend, /playerRecovery\.startAutomaticRecovery\(\)/u);
  assert.match(
    backend,
    /state\.status === "unavailable"[\s\S]*playerRecovery\.startAutomaticRecovery/u,
  );
  assert.match(backend, /const coreBootstrapPromise = Promise\.all/u);
  assert.match(
    backend,
    /url\.pathname === "\/api\/bootstrap"[\s\S]*await coreBootstrapPromise/u,
  );
  assert.match(backend, /coreBootstrapReady \? 200 : 503/u);
  assert.doesNotMatch(
    backend,
    /url\.pathname === "\/api\/bootstrap"[\s\S]{0,120}await bootstrapPromise/u,
  );
  assert.match(session, /restore deferred because MPV is unavailable/u);
  assert.match(session, /return this\.emptyResult\(0, 0, 0, 0\)/u);
  assert.match(recovery, /5_000,\s*15_000,\s*30_000/u);
  assert.doesNotMatch(recovery, /setInterval/u);
});
