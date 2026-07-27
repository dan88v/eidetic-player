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
import type {
  ArtworkRef,
  PlayerTrack,
} from "../../../packages/shared/src/player.js";
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
import {
  METADATA_TEXT_MAX_LENGTH,
  normalizeMetadataText,
} from "../src/metadata/metadata-text.js";

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

void test("ID3v2.3 artist text remains atomic when the parser splits a slash", () => {
  const parsed = normalizeMetadata({
    ...rawMetadata(),
    common: {
      ...rawMetadata().common,
      artist: "AC",
      artists: ["AC", "DC"],
      albumartist: "AC",
    },
    native: {
      "ID3v2.3": [
        { id: "TPE1", value: "AC" },
        { id: "TPE1", value: "DC" },
        { id: "TPE2", value: "AC" },
        { id: "TPE2", value: "DC" },
      ],
    },
  });

  assert.equal(parsed.artist, "AC/DC");
  assert.deepEqual(parsed.artists, ["AC/DC"]);
  assert.equal(parsed.albumArtist, "AC/DC");
});

void test("ID3v2.3 reconstruction preserves leading, trailing and repeated slash", () => {
  for (const [values, expected] of [
    [["", "Artist"], "/Artist"],
    [["Artist", ""], "Artist/"],
    [["A", "", "B"], "A//B"],
    [["Artist A ", " Artist B"], "Artist A/Artist B"],
  ] as const) {
    const raw = rawMetadata();
    raw.common.artist = values[0];
    raw.common.artists = [...values];
    raw.native = {
      "ID3v2.3": values.map((value) => ({ id: "TPE1", value })),
    };
    const parsed = normalizeMetadata(raw);
    assert.equal(parsed.artist, expected);
    assert.deepEqual(parsed.artists, [expected]);
  }
});

void test("metadata text preserves punctuation and Unicode while bounding unsafe input", () => {
  const preserved = [
    "AC/DC",
    "AC",
    "DC",
    "/Artist",
    "Artist/",
    "A//B",
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
  ];
  for (const value of preserved)
    assert.equal(normalizeMetadataText(value), value);
  assert.equal(normalizeMetadataText("A\0B\nC\tD"), "A B C D");
  assert.equal(normalizeMetadataText(null), null);
  assert.equal(normalizeMetadataText(42), null);
  assert.equal(normalizeMetadataText("  "), null);
  assert.equal(
    normalizeMetadataText("x".repeat(METADATA_TEXT_MAX_LENGTH + 20))?.length,
    METADATA_TEXT_MAX_LENGTH,
  );
});

void test("real artist metadata wins over fallback values and survives API JSON", () => {
  const merged = mergeTrackMetadata(
    { ...mpvTrack(), artist: "Path fallback" },
    {
      ...normalized,
      artist: "AC/DC",
      artists: ["AC/DC"],
    },
    null,
  );
  assert.equal(merged.artist, "AC/DC");
  assert.equal(
    (JSON.parse(JSON.stringify(merged)) as PlayerTrack).artist,
    "AC/DC",
  );
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

void test("metadata cache reparses only when an embedded artwork reference is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-artwork-retry-"));
  const path = join(directory, "track.mp3");
  await writeFile(path, "audio");
  let parses = 0;
  const service = new MetadataService(() => {
    parses += 1;
    const raw = rawMetadata();
    raw.common.picture = [
      { data: Buffer.from([0xff, 0xd8, 0xff]), format: "image/jpeg" },
    ];
    return Promise.resolve(raw);
  });
  const ref: ArtworkRef = {
    id: "artwork-id",
    mimeType: "image/jpeg",
    sourceType: "embedded",
    revision: "revision",
  };
  try {
    const first = await service.read(path);
    assert.equal(first.hasEmbeddedArtwork, true);
    service.rememberArtwork(first.cacheKey, ref);

    const recovered = await service.readForArtwork(path, () =>
      Promise.resolve(false),
    );
    assert.equal(recovered.fromCache, false);
    assert.equal(recovered.pictures.length, 1);
    assert.equal(parses, 2);

    service.rememberArtwork(recovered.cacheKey, ref);
    const cached = await service.readForArtwork(path, () =>
      Promise.resolve(true),
    );
    assert.equal(cached.fromCache, true);
    assert.equal(cached.artwork, ref);
    assert.equal(parses, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("transient parser failures are not retained as negative cache entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-metadata-retry-"));
  const path = join(directory, "track.mp3");
  await writeFile(path, "audio");
  let parses = 0;
  const service = new MetadataService(() => {
    parses += 1;
    return parses === 1
      ? Promise.reject(new Error("temporary read failure"))
      : Promise.resolve(rawMetadata());
  });
  try {
    const failed = await service.read(path);
    const retried = await service.read(path);
    assert.equal(failed.metadata.title, null);
    assert.equal(retried.metadata.title, "Parsed title");
    assert.equal(retried.fromCache, false);
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
