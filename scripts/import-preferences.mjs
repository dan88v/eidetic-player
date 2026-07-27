#!/usr/bin/env node

import { Buffer } from "node:buffer";

const allowedKeys = new Set([
  "animationsEnabled",
  "visualizerMode",
  "mainPlayerMode",
  "timelineStyle",
  "timelineTimeMode",
  "volume",
  "muted",
  "shuffleEnabled",
  "repeatMode",
  "folderViewMode",
  "folderSortMode",
  "musicBrowsingVisibility",
  "returnToNowPlayingSeconds",
  "librarySegment",
  "libraryAlbumViewMode",
  "favoriteSegment",
  "favoriteAlbumViewMode",
  "onScreenKeyboardMode",
]);

if (process.argv.length !== 2) {
  console.error(
    "Usage: node scripts/import-preferences.mjs < preferences.json",
  );
  process.exitCode = 64;
} else {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input, "utf8") > 16 * 1024) {
      console.error("Import rejected: input is too large.");
      process.exitCode = 65;
      break;
    }
  }
  if (process.exitCode === undefined) {
    try {
      const preferences = JSON.parse(input.replace(/^\uFEFF/u, ""));
      if (
        typeof preferences !== "object" ||
        preferences === null ||
        Array.isArray(preferences) ||
        Object.keys(preferences).length === 0 ||
        !Object.keys(preferences).every((key) => allowedKeys.has(key))
      )
        throw new Error("Import contains unsupported fields.");
      const response = await fetch(
        "http://127.0.0.1:4310/api/preferences/migrate-legacy",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            preferences,
            sourceAvailable: true,
            confirmOverwrite: true,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true)
        throw new Error(
          typeof payload?.error?.message === "string"
            ? payload.error.message
            : "Backend rejected the import.",
        );
      console.log(
        `Preferences import accepted (${String(Object.keys(preferences).length)} fields, revision ${String(payload.data.revision)}).`,
      );
    } catch (error) {
      console.error(
        `Import rejected: ${error instanceof Error ? error.message : "invalid input"}`,
      );
      process.exitCode = 65;
    }
  }
}
