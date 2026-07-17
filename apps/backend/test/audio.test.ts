import test from "node:test";
import assert from "node:assert/strict";
import { isSupportedAudioPath } from "../../../packages/shared/src/audio.js";

void test("supported audio extension matching is case-insensitive", () => {
  assert.equal(isSupportedAudioPath("C:\\Music\\Track.FLAC"), true);
  assert.equal(isSupportedAudioPath("/music/track.opus"), true);
  assert.equal(isSupportedAudioPath("/music/cover.jpg"), false);
  assert.equal(
    isSupportedAudioPath("https://example.com/audio.mp3?x=1"),
    false,
  );
  assert.equal(isSupportedAudioPath("https://example.com/audio.mp3"), false);
});
