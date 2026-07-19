import assert from "node:assert/strict";
import test from "node:test";
import {
  albumIdentity,
  artistIdentity,
  normalizeLibraryIdentity,
  trackArtists,
  trackIdentity,
} from "../src/library/library-normalization.js";
import { emptyMetadata } from "../src/metadata/metadata-service.js";

void test("Library identities normalize Unicode, case and whitespace deterministically", () => {
  assert.equal(normalizeLibraryIdentity("  CAFÉ   Music "), "café music");
  assert.equal(
    normalizeLibraryIdentity("Cafe\u0301 Music"),
    normalizeLibraryIdentity("CAFÉ MUSIC"),
  );
  assert.equal(
    artistIdentity("  Taylor   Swift ")?.id,
    artistIdentity("taylor swift")?.id,
  );
  assert.equal(
    trackIdentity("source-a", "Album/Track.mp3"),
    trackIdentity("source-a", "Album/Track.mp3"),
  );
  assert.notEqual(
    trackIdentity("source-a", "Album/Track.mp3"),
    trackIdentity("source-b", "Album/Track.mp3"),
  );
});

void test("multiple artists preserve display values and remove normalized duplicates", () => {
  const artists = trackArtists({
    ...emptyMetadata,
    artist: "Taylor Swift",
    artists: [" Taylor Swift ", "Guest", "guest"],
  });
  assert.deepEqual(
    artists.map((artist) => artist.displayName),
    ["Taylor Swift", "Guest"],
  );
});

void test("album identity handles album artist, compilation and source-local unknown ownership", () => {
  const albumArtist = albumIdentity("source-a", {
    ...emptyMetadata,
    album: " Midnights ",
    artist: "Taylor Swift",
    albumArtist: "Taylor Swift",
  });
  assert.ok(albumArtist);
  assert.equal(albumArtist.displayTitle, "Midnights");
  assert.equal(albumArtist.albumArtistDisplay, "Taylor Swift");
  assert.equal(
    albumIdentity("source-a", {
      ...emptyMetadata,
      album: "Compilation",
      compilation: true,
    })?.id,
    albumIdentity("source-b", {
      ...emptyMetadata,
      album: " compilation ",
      compilation: true,
    })?.id,
  );
  assert.notEqual(
    albumIdentity("source-a", {
      ...emptyMetadata,
      album: "Untitled",
    })?.id,
    albumIdentity("source-b", {
      ...emptyMetadata,
      album: "Untitled",
    })?.id,
  );
  assert.equal(albumIdentity("source-a", emptyMetadata), null);
});
