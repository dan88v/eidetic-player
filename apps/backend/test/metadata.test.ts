import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { IAudioMetadata } from "music-metadata";
import {
  composeTechnicalDetails,
  formatBitrate,
  formatSampleRate,
  formatTechnicalName,
} from "../../../packages/shared/src/metadata.js";
import type { PlayerTrack } from "../../../packages/shared/src/player.js";
import { isCurrentEnrichment } from "../src/metadata/enrichment-guard.js";
import {
  fallbackAlbum,
  fallbackArtist,
  fallbackTitle,
  mergeTrackMetadata,
} from "../src/metadata/metadata-merge.js";
import {
  MetadataService,
  normalizeMetadata,
} from "../src/metadata/metadata-service.js";

function rawMetadata(): IAudioMetadata {
  return {
    common: {
      title: "Parsed title",
      artist: "Parsed artist",
      artists: ["Parsed artist", "Guest"],
      album: "Parsed album",
      albumartist: "Album artist",
      track: { no: 2, of: 12 },
      disk: { no: 1, of: 2 },
      movementIndex: { no: null, of: null },
      year: 2026,
      genre: ["Electronic"],
      picture: [],
    },
    format: {
      trackInfo: [],
      tagTypes: [],
      duration: 183.4,
      codec: "FLAC",
      container: "FLAC",
      sampleRate: 96_000,
      bitsPerSample: 24,
      bitrate: 2_304_000,
      lossless: true,
    },
    native: {},
    quality: { warnings: [] },
  };
}

const normalized = normalizeMetadata(rawMetadata());

function mpvTrack(): PlayerTrack {
  return {
    path: "track.flac",
    filename: "track.flac",
    title: "MPV title",
    artist: "MPV artist",
    album: "MPV album",
    artists: [],
    albumArtist: null,
    trackNumber: null,
    trackTotal: null,
    discNumber: null,
    discTotal: null,
    year: null,
    genre: [],
    durationSeconds: 184,
    format: "FLAC",
    codec: "flac",
    sampleRate: 48_000,
    bitDepth: null,
    bitrate: null,
    lossless: null,
    container: null,
    artwork: null,
    source: "Local File",
  };
}

void test("parser metadata enriches MPV while MPV technical values remain authoritative", () => {
  const merged = mergeTrackMetadata(mpvTrack(), normalized, null);
  assert.equal(merged.title, "Parsed title");
  assert.equal(merged.artist, "Parsed artist");
  assert.equal(merged.album, "Parsed album");
  assert.equal(merged.durationSeconds, 184);
  assert.equal(merged.sampleRate, 48_000);
  assert.equal(merged.bitDepth, 24);
  assert.equal(merged.trackNumber, 2);
});

void test("metadata fallbacks never replace valid values with blanks", () => {
  assert.equal(fallbackTitle("", "MPV title", "file"), "MPV title");
  assert.equal(fallbackTitle(null, null, "file"), "file");
  assert.equal(
    fallbackArtist(
      { artist: null, artists: ["One", "Two"], albumArtist: "Album artist" },
      null,
    ),
    "One, Two",
  );
  assert.equal(
    fallbackArtist(
      { artist: null, artists: [], albumArtist: "Album artist" },
      null,
    ),
    "Album artist",
  );
  assert.equal(fallbackAlbum("", "MPV album"), "MPV album");
  assert.equal(fallbackAlbum(null, null), "Unknown Album");
});

void test("sample rate, bitrate, and technical line are normalized", () => {
  assert.equal(formatSampleRate(44_100), "44.1 kHz");
  assert.equal(formatSampleRate(48_000), "48 kHz");
  assert.equal(formatSampleRate(96_000), "96 kHz");
  assert.equal(formatBitrate(320_000), "320 kbps");
  assert.equal(formatTechnicalName("pcm_s16le"), "PCM S16LE");
  assert.equal(formatTechnicalName("opus"), "Opus");
  assert.deepEqual(
    composeTechnicalDetails({
      ...mpvTrack(),
      bitDepth: 24,
      bitrate: 320_000,
    }),
    ["FLAC", "24-bit", "48 kHz", "320 kbps", "Local File"],
  );
});

void test("normalized model retains future metadata fields", () => {
  assert.deepEqual(normalized.artists, ["Parsed artist", "Guest"]);
  assert.equal(normalized.albumArtist, "Album artist");
  assert.equal(normalized.trackTotal, 12);
  assert.equal(normalized.discTotal, 2);
  assert.equal(normalized.year, 2026);
  assert.deepEqual(normalized.genre, ["Electronic"]);
  assert.equal(normalized.lossless, true);
});

void test("metadata cache hits unchanged files and invalidates changed files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-metadata-test-"));
  const path = join(directory, "track.mp3");
  await writeFile(path, "audio");
  let parses = 0;
  const service = new MetadataService(() => {
    parses += 1;
    return Promise.resolve(rawMetadata());
  });
  try {
    const first = await service.read(path);
    const second = await service.read(path);
    assert.equal(first.fromCache, false);
    assert.equal(second.fromCache, true);
    assert.equal(parses, 1);
    await appendFile(path, "changed");
    const third = await service.read(path);
    assert.equal(third.fromCache, false);
    assert.equal(parses, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("obsolete enrichment generations are rejected", () => {
  assert.equal(isCurrentEnrichment(4, 4, "track-b", "track-b"), true);
  assert.equal(isCurrentEnrichment(3, 4, "track-a", "track-b"), false);
  assert.equal(isCurrentEnrichment(4, 4, "track-a", "track-b"), false);
});

void test("empty normalized metadata is represented by nulls, not invented values", () => {
  const empty = normalizeMetadata({
    ...rawMetadata(),
    common: {
      track: { no: null, of: null },
      disk: { no: null, of: null },
      movementIndex: { no: null, of: null },
    },
    format: { trackInfo: [], tagTypes: [] },
  });
  assert.equal(empty.title, null);
  assert.equal(empty.bitDepth, null);
  assert.equal(empty.lossless, null);
});
