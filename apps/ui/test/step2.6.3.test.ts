import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";
import {
  CASSETTE_FRAME_HEIGHT,
  CASSETTE_FRAME_URL,
  CASSETTE_FRAME_WIDTH,
  decodeCassetteFrame,
  loadCassetteFrame,
  nextCassetteFallback,
} from "../src/cassette/cassette-assets";
import {
  CASSETTE_CENTER_WINDOW_POINTS,
  CASSETTE_CORE_RADIUS,
  CASSETTE_FULL_RADIUS,
  CASSETTE_LEFT_REEL,
  CASSETTE_RIGHT_REEL,
  CASSETTE_VIEWBOX_HEIGHT,
  CASSETTE_VIEWBOX_WIDTH,
} from "../src/cassette/cassette-geometry";
import { advanceCassetteMotionScale } from "../src/cassette/cassette-animation-controller";
import {
  deriveAngularVelocity,
  deriveReelGeometry,
} from "../src/cassette/cassette-physics";

const repositoryRoot = new URL("../../../", import.meta.url);
const frameUrl = new URL(
  "apps/ui/public/assets/main-player/cassette/cassette-frame.png",
  repositoryRoot,
);
const masterUrl = new URL(
  "design/cassette/cassette-master-original.png",
  repositoryRoot,
);

function parsePngHeader(buffer: Buffer): {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
} {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24] ?? 0,
    colorType: buffer[25] ?? 0,
  };
}

async function cassetteSources(): Promise<string> {
  const directory = new URL("apps/ui/src/cassette/", repositoryRoot);
  const files = (await readdir(directory)).filter((name) =>
    name.endsWith(".ts"),
  );
  return (
    await Promise.all(
      files.map(async (name) => readFile(new URL(name, directory), "utf8")),
    )
  ).join("\n");
}

void test("approved cassette PNG assets retain identity and runtime boundary", async () => {
  const [frame, master, runtimeFiles, sources] = await Promise.all([
    readFile(frameUrl),
    readFile(masterUrl),
    readdir(new URL(".", frameUrl)),
    cassetteSources(),
  ]);
  const frameHeader = parsePngHeader(frame);
  const masterHeader = parsePngHeader(master);
  assert.deepEqual(frameHeader, {
    width: 1_070,
    height: 710,
    bitDepth: 8,
    colorType: 6,
  });
  assert.ok(masterHeader.width > 0 && masterHeader.height > 0);
  assert.ok((await stat(frameUrl)).size > 0);
  assert.ok((await stat(masterUrl)).size > 0);
  assert.equal(masterUrl.pathname.endsWith(".png"), true);
  assert.equal(masterUrl.pathname.endsWith(".jpeg"), false);
  assert.deepEqual(
    runtimeFiles.filter((name) => /\.(?:png|jpe?g|webp)$/i.test(name)),
    ["cassette-frame.png"],
  );
  assert.doesNotMatch(sources, /cassette-master-original|design\/cassette/);
  assert.doesNotMatch(
    sources.replaceAll("http://www.w3.org/2000/svg", ""),
    /https?:\/\/|data:image|base64,/,
  );
  assert.doesNotMatch(sources, /[A-Z]:\\/);
});

void test("frame loading uses the stable URL and resolves only after decode", async () => {
  const events: string[] = [];
  const fake = {
    naturalWidth: CASSETTE_FRAME_WIDTH,
    naturalHeight: CASSETTE_FRAME_HEIGHT,
    set src(value: string) {
      events.push(`src:${value}`);
    },
    setAttribute() {
      // Attribute content is not material to decode ordering.
    },
    decode() {
      events.push("decode");
      return Promise.resolve();
    },
  } as unknown as HTMLImageElement;
  const resolved = await decodeCassetteFrame(fake);
  assert.equal(resolved, fake);
  assert.deepEqual(events, [`src:${CASSETTE_FRAME_URL}`, "decode"]);

  const broken = {
    naturalWidth: 0,
    naturalHeight: 0,
    set src(_value: string) {
      // The fake records no network activity.
    },
    setAttribute() {
      // The fake records no attributes.
    },
    decode: () => Promise.reject(new Error("decode failed")),
  } as unknown as HTMLImageElement;
  await assert.rejects(decodeCassetteFrame(broken), /decode failed/);

  const wrongSize = {
    naturalWidth: 1,
    naturalHeight: 1,
    set src(_value: string) {
      // The fake performs no network activity.
    },
    setAttribute() {
      // The fake records no attributes.
    },
    decode: () => Promise.resolve(),
  } as unknown as HTMLImageElement;
  await assert.rejects(decodeCassetteFrame(wrongSize), /geometry is invalid/);
});

void test("frame loading is cached once per module session", async () => {
  const previousImage = globalThis.Image;
  let imageCount = 0;
  class FakeImage {
    naturalWidth = CASSETTE_FRAME_WIDTH;
    naturalHeight = CASSETTE_FRAME_HEIGHT;
    decode = () => Promise.resolve();
    setAttribute() {
      // Attributes do not affect the cache assertion.
    }
    constructor() {
      imageCount += 1;
    }
  }
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: FakeImage,
  });
  try {
    const first = loadCassetteFrame();
    const second = loadCassetteFrame();
    assert.equal(first, second);
    await first;
    assert.equal(imageCount, 1);
  } finally {
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: previousImage,
    });
  }
});

void test("premium geometry matches the approved frame coordinates", () => {
  assert.equal(CASSETTE_VIEWBOX_WIDTH, 1_070);
  assert.equal(CASSETTE_VIEWBOX_HEIGHT, 710);
  assert.equal(CASSETTE_CORE_RADIUS, 112);
  assert.equal(CASSETTE_FULL_RADIUS, 270);
  assert.deepEqual(CASSETTE_LEFT_REEL, {
    centerX: 290,
    centerY: 388,
    role: "destination",
  });
  assert.deepEqual(CASSETTE_RIGHT_REEL, {
    centerX: 776,
    centerY: 388,
    role: "source",
  });
  assert.ok(CASSETTE_LEFT_REEL.centerX - CASSETTE_FULL_RADIUS >= 0);
  assert.ok(
    CASSETTE_RIGHT_REEL.centerX + CASSETTE_FULL_RADIUS <=
      CASSETTE_VIEWBOX_WIDTH,
  );
  assert.equal(CASSETTE_CENTER_WINDOW_POINTS.length, 20);
  assert.deepEqual(CASSETTE_CENTER_WINDOW_POINTS[0], [397, 318]);
  assert.deepEqual(CASSETTE_CENTER_WINDOW_POINTS.at(-1), [401, 330]);
});

void test("area physics keeps source right and destination left", () => {
  const start = deriveReelGeometry(0);
  const middle = deriveReelGeometry(0.5);
  const end = deriveReelGeometry(1);
  assert.ok(start.sourceRadius > start.destinationRadius);
  assert.equal(middle.sourceRadius, middle.destinationRadius);
  assert.ok(end.destinationRadius > end.sourceRadius);
  const startSpeed = deriveAngularVelocity(245, start);
  const middleSpeed = deriveAngularVelocity(245, middle);
  assert.ok(Math.abs(startSpeed.destination) > Math.abs(startSpeed.source));
  assert.equal(middleSpeed.source, middleSpeed.destination);
});

void test("Play accelerates and Pause settles reel motion to zero", () => {
  const playing = advanceCassetteMotionScale(0, true, 0.1);
  assert.ok(playing > 0 && playing < 1);
  let paused = playing;
  for (let index = 0; index < 40; index += 1)
    paused = advanceCassetteMotionScale(paused, false, 0.1);
  assert.equal(paused, 0);
  assert.equal(advanceCassetteMotionScale(0, false, 0.1), 0);
});

void test("dynamic SVG contains only bounded reel and tape layers", async () => {
  const [layer, premium, main, controller] = await Promise.all([
    readFile(
      new URL("apps/ui/src/cassette/cassette-reel-layer.ts", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL("apps/ui/src/cassette/cassette-premium-scene.ts", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL("apps/ui/src/cassette/cassette-main-player.ts", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL(
        "apps/ui/src/cassette/cassette-animation-controller.ts",
        repositoryRoot,
      ),
      "utf8",
    ),
  ]);
  assert.match(layer, /viewBox/);
  assert.match(layer, /cassette-player__reel--left/);
  assert.match(layer, /cassette-player__reel--right/);
  assert.match(layer, /cassette-player__reel-spokes/);
  assert.match(layer, /cassette-player__reel-center/);
  assert.match(layer, /cassette-player__tape-mass--left/);
  assert.match(layer, /cassette-player__tape-mass--right/);
  assert.match(layer, /clipPath/);
  assert.match(layer, /cassette-player__center-window-glass/);
  assert.doesNotMatch(layer, /cassette-player__center-tape/);
  assert.doesNotMatch(layer, /<text|<button|tabindex/);
  assert.doesNotMatch(layer, /filter|feGaussianBlur|<image|base64/);
  assert.doesNotMatch(layer, /head|capstan|pinch|mechanism/i);
  assert.ok(
    (layer.match(/<(?:g|circle|path|rect|stop|polygon)\b/g) ?? []).length < 60,
  );
  assert.match(premium, /append\(dynamicLayer\.element, frame\)/);
  assert.doesNotMatch(main, /cassette-scene__head|capstan|pinch|mechanism/i);
  assert.doesNotMatch(controller, /capstan|pinch|mechanism|targetMechanism/i);
  assert.equal(controller.match(/requestAnimationFrame/g)?.length, 1);
  assert.doesNotMatch(
    controller,
    /setInterval|getBoundingClientRect|offsetWidth/,
  );
  assert.doesNotMatch(controller, /CENTER_TAPE|centerTape|translateX/);
  assert.match(controller, /CASSETTE_TAPE_LINEAR_SPEED/);
  assert.match(controller, /\.r\.baseVal\.value/);
  assert.match(controller, /setVisible\(visible/);
  assert.match(controller, /this\.cancel\(\)/);
  assert.match(controller, /1_000 \/ 30/);
});

void test("premium, prototype and Default fallback order is finite", async () => {
  assert.equal(nextCassetteFallback("premium"), "prototype");
  assert.equal(nextCassetteFallback("prototype"), "default");
  assert.equal(nextCassetteFallback("default"), "default");
  const [main, shell] = await Promise.all([
    readFile(
      new URL("apps/ui/src/cassette/cassette-main-player.ts", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL("apps/ui/src/components/app-shell.ts", repositoryRoot),
      "utf8",
    ),
  ]);
  assert.match(main, /loadCassetteFrame\(\)/);
  assert.match(main, /sceneStack\.append\(prototypeScene\.element\)/);
  assert.match(main, /prototypeScene\.element\.hidden = true/);
  assert.match(main, /activatePrototype\(\)/);
  assert.match(main, /options\.onError\(\)/);
  assert.doesNotMatch(
    main,
    /PlayerService|queueRevision\s*=|setQueue|play\(|pause\(|seek\(/,
  );
  assert.doesNotMatch(
    main,
    /retry|setInterval|new CassetteAnimationController[\s\S]*new CassetteAnimationController/,
  );
  assert.match(shell, /let cassetteAssetFallbackNotified = false/);
  assert.match(
    shell,
    /if \(cassetteAssetFallbackNotified\) return;[\s\S]{0,100}cassetteAssetFallbackNotified = true/,
  );
});

void test("Cassette CSS is scoped and keeps SVG and frame in one box", async () => {
  const css = await readFile(
    new URL("apps/ui/src/styles/cassette-player.css", repositoryRoot),
    "utf8",
  );
  for (const line of css.split(/\r?\n/)) {
    const selector = line.trim();
    if (!selector.startsWith(".")) continue;
    assert.match(selector, /^\.cassette-player(?:\s|\b)/);
  }
  assert.match(css, /aspect-ratio:\s*1070 \/ 710/);
  assert.match(css, /cassette-player__dynamic-layer[\s\S]*z-index:\s*0/);
  assert.match(css, /cassette-player__frame[\s\S]*z-index:\s*1/);
  assert.doesNotMatch(
    css,
    /(?:^|})\s*(?:svg|path|circle|image|img|button|\.mini-player|\.visualizer)\b[^,{]*\{/m,
  );
});
