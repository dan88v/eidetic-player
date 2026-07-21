import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatRemainingTime, formatTime } from "../src/components/timeline";
import { CASSETTE_METADATA_LABEL_AREA } from "../src/cassette/cassette-geometry";
import {
  fitCassetteText,
  normalizeCassetteAlbum,
  normalizeCassetteArtist,
  normalizeCassetteMetadata,
  resolveCassetteMetadataLine,
} from "../src/cassette/cassette-text-fit";
import { deriveCassetteTimeDisplay } from "../src/cassette/cassette-time-row";
import { resolveCassetteBrowsingControls } from "../src/cassette/cassette-utility-controls";

const repositoryRoot = new URL("../../../", import.meta.url);

const readSource = (path: string) =>
  readFile(new URL(`apps/ui/src/${path}`, repositoryRoot), "utf8");

void test("Cassette metadata normalization and single-line composition are deterministic", () => {
  assert.equal(
    normalizeCassetteMetadata("  Björk\n  Guðmundsdóttir  "),
    "Björk Guðmundsdóttir",
  );
  assert.equal(
    resolveCassetteMetadataLine("Artist", "Album"),
    "Artist - Album",
  );
  assert.equal(resolveCassetteMetadataLine(" Artist ", null), "Artist");
  assert.equal(resolveCassetteMetadataLine(null, " Album "), "Album");
  assert.equal(resolveCassetteMetadataLine("  ", null), "");
  assert.equal(normalizeCassetteArtist("Unknown Artist"), "");
  assert.equal(normalizeCassetteAlbum("Unknown Album"), "");
  assert.equal(
    resolveCassetteMetadataLine("Unknown Artist", "Unknown Album"),
    "",
  );
});

void test("bounded text fitting preserves short text and ellipsizes long text", () => {
  let measurements = 0;
  const measure = (value: string, fontSize: number): number => {
    measurements += 1;
    return Array.from(value).length * fontSize;
  };
  for (const value of [
    "Aerosmith",
    "Rocks",
    "Björk",
    "Ágætis byrjun",
    "Rock & Roll (Deluxe) — Artist's Cut",
  ]) {
    const result = fitCassetteText(
      value,
      { maxWidth: 100, minFontSize: 8, maxFontSize: 16 },
      measure,
    );
    assert.ok(result.text.length > 0);
    assert.ok(measure(result.text, result.fontSize) <= 100);
  }
  const reduced = fitCassetteText(
    "The Presidents of the United States of America",
    { maxWidth: 300, minFontSize: 5, maxFontSize: 16 },
    measure,
  );
  assert.equal(reduced.truncated, false);
  assert.ok(reduced.fontSize >= 5 && reduced.fontSize < 16);
  const measurementsBeforeTruncation = measurements;
  const fitted = fitCassetteText(
    "Whatever People Say I Am, That's What I'm Not — Deluxe Anniversary Edition",
    { maxWidth: 70, minFontSize: 8, maxFontSize: 18, iterations: 9 },
    measure,
  );
  assert.equal(fitted.fontSize, 8);
  assert.equal(fitted.truncated, true);
  assert.ok(fitted.text.endsWith("…"));
  assert.ok(measure(fitted.text, fitted.fontSize) <= 70);
  assert.ok(measurements - measurementsBeforeTruncation < 20);
});

void test("metadata safe area uses both ruled rows within the lower ivory band", () => {
  assert.deepEqual(CASSETTE_METADATA_LABEL_AREA, {
    x: 150,
    y: 567,
    width: 770,
    height: 82,
    padding: 8,
  });
  const area: Readonly<
    Record<"x" | "y" | "width" | "height" | "padding", number>
  > = CASSETTE_METADATA_LABEL_AREA;
  assert.ok(area.x >= 0);
  assert.ok(area.y >= 565);
  assert.ok(area.y < 598);
  assert.ok(area.y + area.height > 630);
  assert.ok(area.y + area.height <= 650);
  assert.ok(area.x + area.width <= 1_070);
});

void test("official local font assets retain their licensed binary identity", async () => {
  const fonts = [
    {
      path: "apps/ui/src/assets/fonts/nothing-you-could-do/NothingYouCouldDo-Regular.ttf",
      hash: "1daf8cf79076bf59c5a9117b5efd6ecea35e57a05ef127fe4f95b072b8a5245d",
    },
    {
      path: "apps/ui/src/assets/fonts/bitcount-single/BitcountSingle-Variable.ttf",
      hash: "007608c704d41cfff140892070b71f31971ec6d85b9f8ad5fdd0d2625f517c70",
    },
  ] as const;
  for (const font of fonts) {
    const binary = await readFile(new URL(font.path, repositoryRoot));
    assert.equal(binary.subarray(0, 4).toString("hex"), "00010000");
    assert.equal(createHash("sha256").update(binary).digest("hex"), font.hash);
  }
  const [metadataLicense, timeLicense] = await Promise.all([
    readFile(
      new URL(
        "apps/ui/src/assets/fonts/nothing-you-could-do/OFL.txt",
        repositoryRoot,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "apps/ui/src/assets/fonts/bitcount-single/OFL.txt",
        repositoryRoot,
      ),
      "utf8",
    ),
  ]);
  assert.match(metadataLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(timeLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
});

void test("Cassette fonts are bundled locally, scoped, and loaded once", async () => {
  const [css, loader] = await Promise.all([
    readSource("styles/cassette-player.css"),
    readSource("cassette/cassette-fonts.ts"),
  ]);
  assert.match(css, /NothingYouCouldDo-Regular\.ttf/);
  assert.match(css, /BitcountSingle-Variable\.ttf/);
  assert.match(css, /Eidetic Nothing You Could Do/);
  assert.match(css, /Eidetic Bitcount Single/);
  assert.doesNotMatch(css, /@import|https?:\/\/|data:font|base64/i);
  assert.match(loader, /let fontLoadPromise/);
  assert.match(loader, /if \(fontLoadPromise\) return fontLoadPromise/);
  assert.equal(loader.match(/document\.fonts\.load/g)?.length, 2);
});

void test("metadata overlay is bounded, content-safe, and not tick-driven", async () => {
  const [layer, main, css] = await Promise.all([
    readSource("cassette/cassette-metadata-layer.ts"),
    readSource("cassette/cassette-main-player.ts"),
    readSource("styles/cassette-player.css"),
  ]);
  assert.equal(layer.match(/createText\(/g)?.length, 1);
  assert.match(layer, /getComputedTextLength/);
  assert.match(layer, /target\.textContent =/);
  assert.doesNotMatch(
    layer,
    /innerHTML|requestAnimationFrame|setInterval|ResizeObserver/,
  );
  assert.match(layer, /if \(key === currentKey\) return false/);
  assert.ok(
    main.indexOf("sceneStack.append(prototypeScene.element)") <
      main.indexOf("sceneStack.append(metadataLayer.element)"),
  );
  assert.match(css, /cassette-player__metadata-layer[\s\S]*z-index:\s*2/);
});

void test("Cassette utility controls preserve Default callbacks and ordering", async () => {
  const [controls, host] = await Promise.all([
    readSource("cassette/cassette-utility-controls.ts"),
    readSource("main-player/main-player-host.ts"),
  ]);
  const order = ["library", "folders", "volume", "queue"].map((name) =>
    controls.indexOf(`data-control="${name}"`),
  );
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(
    order,
    [...order].sort((left, right) => left - right),
  );
  assert.deepEqual(resolveCassetteBrowsingControls("both"), {
    library: true,
    folders: true,
  });
  assert.deepEqual(resolveCassetteBrowsingControls("folders"), {
    library: false,
    folders: true,
  });
  assert.deepEqual(resolveCassetteBrowsingControls("library"), {
    library: true,
    folders: false,
  });
  for (const callback of [
    "onOpenLibrary",
    "onOpenFolders",
    "onToggleVolume",
    "onOpenQueue",
  ]) {
    assert.match(controls, new RegExp(`options\\.${callback}`));
    assert.match(host, new RegExp(`${callback}: options\\.${callback}`));
  }
});

void test("Cassette time row shares exact formatting and seek preview without a slider", async () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65.9), "1:05");
  assert.equal(formatTime(3_661), "1:01:01");
  assert.equal(formatRemainingTime(65, 125), "-1:00");
  assert.deepEqual(deriveCassetteTimeDisplay(65, 125, "total"), {
    elapsed: "1:05",
    end: "2:05",
    positionSeconds: 65,
    validDuration: true,
  });
  assert.deepEqual(deriveCassetteTimeDisplay(65, 125, "remaining"), {
    elapsed: "1:05",
    end: "-1:00",
    positionSeconds: 65,
    validDuration: true,
  });
  assert.equal(deriveCassetteTimeDisplay(200, 125, "total").elapsed, "2:05");
  assert.equal(
    deriveCassetteTimeDisplay(65, 125, "remaining", 100).end,
    "-0:25",
  );
  assert.deepEqual(deriveCassetteTimeDisplay(20, 0, "remaining"), {
    elapsed: "0:00",
    end: "0:00",
    positionSeconds: 0,
    validDuration: false,
  });
  const [row, main] = await Promise.all([
    readSource("cassette/cassette-time-row.ts"),
    readSource("cassette/cassette-main-player.ts"),
  ]);
  assert.match(row, /formatRemainingTime, formatTime/);
  assert.match(row, /updateSeekPreview/);
  assert.doesNotMatch(
    row,
    /slider|range|requestAnimationFrame|setInterval|ResizeObserver/i,
  );
  assert.match(main, /timeRow\.updateSeekPreview\(positionSeconds\)/);
});

void test("utility and time rows anchor to the Cassette surface edges", async () => {
  const [css, main] = await Promise.all([
    readSource("styles/cassette-player.css"),
    readSource("cassette/cassette-main-player.ts"),
  ]);
  assert.match(css, /cassette-player__utility-row[\s\S]*width:\s*100%/);
  assert.match(css, /cassette-player__time-row[\s\S]*width:\s*100%/);
  assert.match(css, /font-size:\s*clamp\(1\.5rem, 3\.4vh, 2\.25rem\)/);
  assert.match(
    main,
    /section\.append\(heading, utilityControls\.element, stage, timeRow\.element\)/,
  );
});
