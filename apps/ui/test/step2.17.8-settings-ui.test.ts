import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

void test("Settings UI contract is mandatory and documents the canonical control language", async () => {
  const [agreement, index, contract] = await Promise.all([
    readFile("AGENTS.md", "utf8"),
    readFile("docs/development/README.md", "utf8"),
    readFile("docs/development/settings-ui.md", "utf8"),
  ]);
  assert.match(agreement, /Before every Settings panel change/);
  assert.match(index, /Settings UI contract/);
  assert.match(contract, /`Interface` is\s+the canonical Settings surface/);
  assert.match(contract, /A checkmark means selected preference/);
  assert.match(contract, /compact pill inside a row means runtime state/);
  assert.match(contract, /Parametric EQ Bands/);
  assert.match(contract, /sticky response graph/);
  assert.match(contract, /npm\.cmd run dev/);
});

void test("Audio root follows Interface hierarchy and uses inline binary pills", async () => {
  const settings = await readFile("apps/ui/src/screens/settings.ts", "utf8");
  assert.match(settings, /outputTitle\.textContent = "Output Device"/);
  assert.match(settings, /label: "Software Volume"/);
  assert.match(settings, /label: "Sound Processing"/);
  assert.match(settings, /label: "Parametric EQ"/);
  assert.match(settings, /label: "Gain Compensation"/);
  assert.match(
    settings,
    /changes: \{ headroomMode: value === "on" \? "auto" : "off" \}/,
  );
  assert.match(settings, /"Maximum Software Volume"/);
  assert.match(settings, /processing\.outputLevelMode === "variable"/);
  assert.match(settings, /"Parametric EQ Bands"/);
  assert.match(settings, /"Headroom"/);
  assert.match(settings, /segmentedSettingRow<"variable" \| "fixed">/);
  assert.match(settings, /segmentedSettingRow<"on" \| "bypass">/);
  assert.doesNotMatch(settings, /\| "audio-level"|\| "audio-processing"/);
  assert.match(
    settings,
    /panel\.append\(outputButton, softwareVolume\);[\s\S]*?panel\.append\(\s*soundProcessing,\s*channels,\s*balance,/,
  );
});

void test("Output Device separates physical and advanced groups with checks, pills, and toasts", async () => {
  const [settings, css] = await Promise.all([
    readFile("apps/ui/src/screens/settings.ts", "utf8"),
    readFile("apps/ui/src/styles/screens.css", "utf8"),
  ]);
  assert.match(settings, /devicesLabel\.textContent = "Devices"/);
  assert.match(settings, /advancedLabel\.textContent = "Advanced"/);
  assert.match(settings, /"Advanced Outputs"/);
  assert.match(settings, /check\.textContent = selected \? "✓" : ""/);
  assert.match(settings, /statePill\("Activating", "pending"\)/);
  assert.match(settings, /statePill\("In use", "active"\)/);
  assert.match(settings, /options\.showToast/);
  assert.doesNotMatch(settings, /audioStatusText/);
  assert.doesNotMatch(css, /setting-navigation\[aria-current="true"\]/);
});

void test("Fixed output reuses the canonical confirmation surface", async () => {
  const [settings, confirmation] = await Promise.all([
    readFile("apps/ui/src/screens/settings.ts", "utf8"),
    readFile("apps/ui/src/components/confirmation-dialog.ts", "utf8"),
  ]);
  assert.match(settings, /createConfirmationDialog\(\)/);
  assert.match(settings, /title: "Enable fixed output\?"/);
  assert.match(settings, /confirmLabel: "Enable Fixed"/);
  assert.match(confirmation, /source-dialog confirmation-dialog/);
  assert.match(confirmation, /role", "alertdialog"/);
  assert.match(confirmation, /event\.key === "Escape"/);
  assert.doesNotMatch(settings, /createElement\("dialog"\)|showModal\(\)/);
});

void test("Balance is top-level, centered, human-labelled, and Stereo-only", async () => {
  const [settings, css] = await Promise.all([
    readFile("apps/ui/src/screens/settings.ts", "utf8"),
    readFile("apps/ui/src/styles/screens.css", "utf8"),
  ]);
  assert.match(settings, /balance === 0[\s\S]*\? "Center"/);
  assert.match(settings, /balance < 0 \? "L" : "R"/);
  assert.match(settings, /centerMark\.className = "balance-slider__center"/);
  assert.match(settings, /balanceInput\.step = "1"/);
  assert.match(settings, /processing\.channelMode !== "stereo"/);
  assert.doesNotMatch(settings, /Stereo balance in decibels/);
  assert.doesNotMatch(
    settings,
    /balanceCopy\.append\(statePill\("Bypassed"\)\)/,
  );
  assert.doesNotMatch(settings, /markNavigationBypassed/);
  assert.match(css, /\.balance-slider__center\s*{/);
});

void test("Parametric EQ editor is touch-sized, sticky, and redraws without a loop", async () => {
  const [editor, response, css, touchScroll] = await Promise.all([
    readFile("apps/ui/src/components/parametric-eq-editor.ts", "utf8"),
    readFile("apps/ui/src/utils/equalizer-response.ts", "utf8"),
    readFile("apps/ui/src/styles/screens.css", "utf8"),
    readFile("apps/ui/src/utils/reliable-touch-scroll.ts", "utf8"),
  ]);
  assert.match(editor, /document\.createElement\("canvas"\)/);
  assert.match(editor, /localBands\.forEach\(\(band, index\)/);
  assert.match(editor, /Frequency/);
  assert.match(editor, /Gain/);
  assert.match(editor, /"Q"/);
  assert.match(editor, /label: "Shelving"/);
  assert.match(editor, /label: "Bell"/);
  assert.match(editor, /"low-shelf"/);
  assert.match(editor, /"high-shelf"/);
  assert.match(editor, /new ResizeObserver\(scheduleDraw\)/);
  assert.match(editor, /parametric-eq-graph__compensation/);
  assert.match(editor, /Auto compensation/);
  assert.doesNotMatch(editor, /settings-state-pill/);
  assert.match(editor, /context\.globalAlpha/);
  assert.match(editor, /context\.fill\(\)/);
  assert.match(editor, /canvas\.setPointerCapture\(event\.pointerId\)/);
  assert.match(editor, /canvas\.addEventListener\("pointermove"/);
  assert.match(editor, /canvas\.addEventListener\("pointerup"/);
  assert.match(
    editor,
    /options\.onUpdateBand\(bandIndex,\s*\{\s*frequencyHz: band\.frequencyHz,\s*gainDb: band\.gainDb/,
  );
  assert.equal((editor.match(/requestAnimationFrame\(/g) ?? []).length, 1);
  assert.doesNotMatch(editor, /setInterval|while\s*\(/);
  assert.match(response, /equalizerMagnitudeDb/);
  assert.match(css, /\.parametric-eq-graph\s*{[\s\S]*position: sticky/);
  assert.match(
    css,
    /\.parametric-eq-band\s*{[\s\S]*min-height: var\(--touch-min\)/,
  );
  assert.match(
    css,
    /\.parametric-eq-graph__canvas\s*{[\s\S]*touch-action: none/,
  );
  assert.match(touchScroll, /"\.parametric-eq-graph__canvas"/);
});

void test("Fixed Software Volume hides Default and Cassette volume triggers", async () => {
  const [shell, standard, cassette] = await Promise.all([
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
    readFile("apps/ui/src/screens/now-playing.ts", "utf8"),
    readFile("apps/ui/src/cassette/cassette-utility-controls.ts", "utf8"),
  ]);
  assert.match(
    shell,
    /querySelectorAll<HTMLButtonElement>\(\s*'\[data-control="volume"\]'/,
  );
  assert.match(shell, /trigger\.hidden = locked/);
  assert.match(shell, /const audioLevelPolicyReady = audioOutputApi/);
  assert.match(
    shell,
    /processingState\?\.preferences\.outputLevelMode === "fixed"\s*\?\s*\[\]/,
  );
  assert.match(standard, /data-control="volume"/);
  assert.match(cassette, /data-control="volume"/);
});
