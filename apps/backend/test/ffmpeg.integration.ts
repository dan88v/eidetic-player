import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioAnalysisEngine } from "../src/analysis/audio-analysis-engine.js";
import { discoverFfmpeg } from "../src/analysis/ffmpeg-discovery.js";
import { PcmStreamParser } from "../src/analysis/pcm-stream-parser.js";
import { WaveformService } from "../src/analysis/waveform-service.js";
import { AudioAnalyzerService } from "../src/analysis/audio-analyzer-service.js";
import type { PlayerState } from "../../../packages/shared/src/player.js";

function stereoWave(seconds = 1): Buffer {
  const sampleRate = 24_000;
  const frames = sampleRate * seconds;
  const dataSize = frames * 4;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < frames; index += 1) {
    buffer.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 24_000),
      44 + index * 4,
    );
    buffer.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 2_000 * index) / sampleRate) * 12_000),
      46 + index * 4,
    );
  }
  return buffer;
}

void test("FFmpeg decodes stereo analysis and generates a real waveform", async (context) => {
  const discovery = await discoverFfmpeg();
  if (!discovery) {
    context.skip("FFmpeg is unavailable");
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), "eidetic-ffmpeg-"));
  const path = join(folder, "stereo.wav");
  const waveform = new WaveformService(() => discovery);
  try {
    await writeFile(path, stereoWave());
    const child = spawn(
      discovery.executable,
      [
        "-loglevel",
        "error",
        "-i",
        path,
        "-ac",
        "2",
        "-ar",
        "24000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const parser = new PcmStreamParser();
    const engine = new AudioAnalysisEngine();
    let frame = engine.push(new Float32Array(), "queue-1", 0, 0)[0];
    for await (const chunk of child.stdout) {
      const frames = engine.push(parser.push(chunk as Buffer), "queue-1", 0, 0);
      frame ??= frames[0];
      if (frame) child.kill();
    }
    assert.ok(frame);
    assert.notDeepEqual(frame.leftBands, frame.rightBands);
    const result = await waveform.get("queue-1", path);
    assert.equal(result.status, "ready");
    assert.equal(result.source, "real");
    assert.equal(result.points.length, 512);
  } finally {
    await waveform.close();
    await rm(folder, { recursive: true, force: true });
  }
});

void test("rapid player updates keep exactly one realtime FFmpeg process", async (context) => {
  const discovery = await discoverFfmpeg();
  if (!discovery) {
    context.skip("FFmpeg is unavailable");
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), "eidetic-analyzer-lifecycle-"));
  const path = join(folder, "long.wav");
  const analyzer = new AudioAnalyzerService();
  try {
    await writeFile(path, stereoWave(5));
    await analyzer.initialize();
    analyzer.setSubscriberCount(1);
    const state: PlayerState = {
      playerSessionId: "ffmpeg-integration",
      trackTransitionId: 1,
      status: "playing",
      mpvAvailable: true,
      mpvVersion: "test",
      currentTrack: {
        path,
        filename: "long.wav",
        title: "Long",
        artist: "",
        album: "",
        artists: [],
        albumArtist: null,
        trackNumber: null,
        trackTotal: null,
        discNumber: null,
        discTotal: null,
        year: null,
        genre: [],
        durationSeconds: 5,
        format: "WAV",
        codec: "pcm_s16le",
        sampleRate: 24_000,
        bitDepth: 16,
        bitrate: null,
        lossless: true,
        container: "WAVE",
        artwork: null,
        source: "Local File",
      },
      positionSeconds: 0,
      durationSeconds: 5,
      paused: false,
      volume: 100,
      muted: false,
      shuffleEnabled: false,
      repeatMode: "off",
      currentQueueIndex: 0,
      queue: [
        {
          id: "track-1",
          index: 0,
          path,
          filename: "long.wav",
          displayTitle: "Long",
          artwork: null,
          isCurrent: true,
        },
      ],
      queueRevision: 1,
      audioDevice: "test",
      error: null,
    };
    for (let index = 0; index < 100; index += 1)
      analyzer.updatePlayerState({ ...state, positionSeconds: index / 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.deepEqual(analyzer.getDiagnostics(), {
      starts: 1,
      driftRestarts: 0,
      activeProcesses: 1,
    });
    analyzer.setSubscriberCount(0);
    analyzer.setSubscriberCount(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(analyzer.getDiagnostics().starts, 1);
  } finally {
    await analyzer.close();
    assert.equal(analyzer.getDiagnostics().activeProcesses, 0);
    await rm(folder, { recursive: true, force: true });
  }
});
