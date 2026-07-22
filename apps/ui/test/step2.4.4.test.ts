import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { crestFactorDb } from "../src/visualizer/technical-renderer.js";
import { nextVisualizerMode } from "../src/visualizer/visualizer-mode.js";

const read = (path: string): Promise<string> =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const readWorkspace = (path: string): Promise<string> =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

void test("visualizers use the requested presentation order", async () => {
  const [types, storage, settings, visualizer, i18n] = await Promise.all([
    read("state/types.ts"),
    read("utils/storage.ts"),
    read("screens/settings.ts"),
    read("components/visualizer.ts"),
    read("i18n/en.ts"),
  ]);
  assert.match(
    types,
    /"meter" \| "spectrumMono" \| "spectrumStereo" \| "technical" \| "none"/,
  );
  assert.match(storage, /value === "technical"/);
  assert.match(
    settings,
    /\["spectrumMono",[\s\S]*?\["spectrumStereo",[\s\S]*?\["meter",[\s\S]*?\["technical",[\s\S]*?\["none",/,
  );
  assert.match(visualizer, /mode = nextVisualizerMode\(mode\)/);
  assert.deepEqual(
    [
      nextVisualizerMode("spectrumMono"),
      nextVisualizerMode("spectrumStereo"),
      nextVisualizerMode("meter"),
      nextVisualizerMode("technical"),
      nextVisualizerMode("none"),
    ],
    ["spectrumStereo", "meter", "technical", "none", "spectrumMono"],
  );
  assert.match(i18n, /"visualizer\.technical": "Technical"/);
});

void test("Technical compact layout exposes Crest Factor and LUFS-S", async () => {
  const [technical, meter, component] = await Promise.all([
    read("visualizer/technical-renderer.ts"),
    read("visualizer/meter-renderer.ts"),
    read("components/visualizer.ts"),
  ]);
  assert.match(technical, /fillText\("CREST \(dB\)"/);
  assert.match(technical, /fillText\("LUFS-S \(dB\)"/);
  assert.doesNotMatch(technical, /fillText\("dB"/);
  assert.doesNotMatch(technical, /fillText\("LUFS"/);
  assert.match(technical, /ui-monospace/);
  assert.match(technical, /compact \? 48 : 56/);
  assert.match(technical, /renderCompactStereoMeter/);
  assert.match(meter, /barHeight = 14/);
  assert.match(meter, /meterPositionForDb\(-18\)/);
  assert.match(meter, /meterPositionForDb\(-3\)/);
  assert.match(meter, /"#f29a3f"/);
  assert.match(meter, /"#ff4d5a"/);
  assert.match(component, /crestFactorDb\([\s\S]*frame\.meter\.leftRms/);
  assert.doesNotMatch(technical, /true.?peak|dBTP/i);
});

void test("Crest Factor is channel-aware, bounded, and neutral for silence", () => {
  assert.equal(crestFactorDb(0, 0, 0, 0), null);
  assert.ok(Math.abs((crestFactorDb(1, 0.5, 0, 0) ?? 0) - 6.0206) < 0.0001);
  assert.ok(
    Math.abs((crestFactorDb(0.5, 0.25, 1, 0.25) ?? 0) - 12.0412) < 0.0001,
  );
  assert.equal(crestFactorDb(1, 0.000_000_1, 0, 0), 60);
});

void test("the non-Technical meter omits dB scale text", async () => {
  const meter = await read("visualizer/meter-renderer.ts");
  const normalMeter = meter.split(
    "export function renderCompactStereoMeter",
  )[0];
  assert.ok(normalMeter);
  assert.doesNotMatch(normalMeter, /fillText\("dB"/);
  assert.doesNotMatch(normalMeter, /fillText\(String\(db\)/);
});

void test("Technical shares identity, audible-time buffer, and one render path", async () => {
  const [component, client, frameBuffer, hub, service] = await Promise.all([
    read("components/visualizer.ts"),
    read("visualizer/visualizer-stream-client.ts"),
    read("visualizer/visualizer-frame-buffer.ts"),
    readFile(
      new URL("../../backend/src/analysis/visualizer-hub.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../backend/src/analysis/audio-analyzer-service.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.equal(
    (component.match(/requestAnimationFrame\(tick\)/g) ?? []).length,
    3,
  );
  assert.equal((client.match(/new EventSource\(/g) ?? []).length, 1);
  assert.match(frameBuffer, /frame\.playerSessionId !== playerSessionId/);
  assert.match(frameBuffer, /frame\.trackTransitionId !== trackTransitionId/);
  assert.match(frameBuffer, /frame\.mode !== mode/);
  assert.match(
    component,
    /positionSeconds - Math\.max\(0, audioBufferSeconds\)/,
  );
  assert.match(hub, /mode === "technical"/);
  assert.match(
    service,
    /private readonly engine = new AudioAnalysisEngine\(\)/,
  );
});

void test("Technical resets on seek/track and preserves paused remount data", async () => {
  const [component, snapshots] = await Promise.all([
    read("components/visualizer.ts"),
    read("visualizer/visualizer-snapshot-store.ts"),
  ]);
  assert.match(
    component,
    /if \(seekDetected\) \{[\s\S]*meter\.reset\(\);[\s\S]*shortTermLufs = null/,
  );
  assert.match(
    component,
    /setTrack\([\s\S]*stream\.clearFrames\(\)[\s\S]*meter\.reset\(\)/,
  );
  assert.match(component, /if \(playbackPaused\) return/);
  assert.match(component, /meter\.setPaused\(paused, now\)/);
  assert.match(snapshots, /technicalCrestDb: number \| null/);
  assert.match(snapshots, /shortTermLufs: number \| null/);
  assert.match(component, /snapshot\.technicalCrestDb/);
});

void test("Technical empty state stays neutral in the existing dark canvas", async () => {
  const [technical, component, css] = await Promise.all([
    read("visualizer/technical-renderer.ts"),
    read("components/visualizer.ts"),
    read("styles/screens.css"),
  ]);
  assert.match(technical, /return .* "—"/);
  assert.match(component, /!hasFrame && mode !== "technical"/);
  assert.match(css, /\.visualizer__canvas[\s\S]*background: var\(--color-bg\)/);
});

void test("Windows dev shutdown gives artwork cleanup a graceful backend path", async () => {
  const [backendIndex, devRunner] = await Promise.all([
    readWorkspace("apps/backend/src/index.ts"),
    readWorkspace("scripts/dev.mjs"),
  ]);
  assert.match(backendIndex, /\/api\/development\/shutdown/);
  assert.match(backendIndex, /EIDETIC_DEV_SHUTDOWN_TOKEN/);
  assert.match(
    backendIndex,
    /setImmediate\(\(\) => \{[\s\S]*shutdown\("SIGTERM"\)/,
  );
  assert.match(devRunner, /stopBackendGracefully/);
  assert.match(devRunner, /backendShutdownToken = randomUUID\(\)/);
  assert.match(devRunner, /"x-eidetic-shutdown-token": backendShutdownToken/);
  assert.match(devRunner, /await stopBackendGracefully\(\)/);
});

void test("the UI uses the bundled cross-platform Open Sans font", async () => {
  const [base, viteConfig, license] = await Promise.all([
    read("styles/base.css"),
    readWorkspace("apps/ui/vite.config.ts"),
    read("assets/fonts/OFL.txt"),
  ]);
  assert.match(base, /@font-face/);
  assert.match(base, /font-family: "Open Sans Bundled"/);
  assert.match(base, /OpenSans-Variable\.ttf/);
  assert.match(base, /font-display: block/);
  assert.doesNotMatch(base, /\bInter,/);
  assert.match(viteConfig, /bundle-open-sans-license/);
  assert.match(viteConfig, /OpenSans-OFL\.txt/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});
