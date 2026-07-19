import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatRemainingTime, formatTime } from "../src/components/timeline";

const source = new Map<string, Promise<string>>();
function read(relativePath: string): Promise<string> {
  const cached = source.get(relativePath);
  if (cached) return cached;
  const pending = readFile(
    new URL(`../src/${relativePath}`, import.meta.url),
    "utf8",
  );
  source.set(relativePath, pending);
  return pending;
}

void test("1. artwork placeholder text is not rendered", async () => {
  const artwork = await read("components/artwork.ts");
  assert.doesNotMatch(artwork, /placeholderLabel|textContent\s*=\s*options/);
});

void test("2. artwork placeholder icon is not rendered", async () => {
  const artwork = await read("components/artwork.ts");
  assert.doesNotMatch(artwork, /icon\("album"|placeholder-icon/);
});

void test("3. main artwork has zero border radius", async () => {
  const css = await read("styles/screens.css");
  assert.match(css, /\.now-playing__artwork\s*\{[\s\S]*?border-radius:\s*0;/);
});

void test("4. decoded artwork remains square and cover-fitted", async () => {
  const [screenCss, componentCss] = await Promise.all([
    read("styles/screens.css"),
    read("styles/components.css"),
  ]);
  assert.match(screenCss, /aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(
    componentCss,
    /\.artwork__image\s*\{[\s\S]*?object-fit:\s*cover/,
  );
});

void test("5. Home is absent from the top bar", async () => {
  const topBar = await read("components/top-bar.ts");
  assert.doesNotMatch(topBar, /top-bar__home|icon\("home"\)/);
});

void test("6. Hamburger is the first top-bar control", async () => {
  const topBar = await read("components/top-bar.ts");
  const template = topBar.slice(topBar.indexOf("element.innerHTML"));
  assert.ok(
    template.indexOf("top-bar__menu") < template.indexOf("top-bar__title"),
  );
  assert.equal((template.match(/<button/g) ?? []).length, 1);
});

void test("7. Hamburger target and SVG are enlarged", async () => {
  const css = await read("styles/components.css");
  assert.match(
    css,
    /\.top-bar \.top-bar__menu\s*\{[\s\S]*?var\(--touch-medium\)/,
  );
  assert.match(css, /\.top-bar \.top-bar__menu \.icon\s*\{[\s\S]*?2\.25rem/);
});

void test("8. audio device chrome is not rendered", async () => {
  const [topBar, shell] = await Promise.all([
    read("components/top-bar.ts"),
    read("components/app-shell.ts"),
  ]);
  assert.doesNotMatch(topBar, /top-bar__audio|setAudioDevice/);
  assert.doesNotMatch(shell, /setAudioDevice/);
});

void test("9. Ethernet placeholder is present", async () => {
  assert.match(await read("components/top-bar.ts"), /icon\("ethernet"\)/);
});

void test("10. Wi-Fi placeholder is present", async () => {
  assert.match(await read("components/top-bar.ts"), /icon\("wifi"\)/);
});

void test("11. USB/DAC placeholder is present", async () => {
  assert.match(await read("components/top-bar.ts"), /icon\("usb"\)/);
});

void test("12. system placeholders are hidden from assistive technology", async () => {
  const topBar = await read("components/top-bar.ts");
  assert.match(topBar, /top-bar__system-icons" aria-hidden="true"/);
});

void test("13. system placeholders are non-interactive spans", async () => {
  const topBar = await read("components/top-bar.ts");
  assert.doesNotMatch(topBar, /<button[^>]+top-bar__system/);
  assert.match(topBar, /<span class="top-bar__system-icon">/);
});

void test("14. clock retains minute cadence and 25 px typography", async () => {
  const [topBar, css] = await Promise.all([
    read("components/top-bar.ts"),
    read("styles/components.css"),
  ]);
  assert.match(topBar, /setInterval\(updateClock,\s*60_000\)/);
  assert.match(css, /\.top-bar__clock\s*\{[\s\S]*?font-size:\s*1\.5625rem/);
});

void test("15. mini-player includes Previous", async () => {
  assert.match(
    await read("components/mini-player.ts"),
    /data-control="previous"/,
  );
});

void test("16. mini-player includes Next", async () => {
  assert.match(await read("components/mini-player.ts"), /data-control="next"/);
});

void test("17. mini-player order is Previous, Play, Next, Home", async () => {
  const mini = await read("components/mini-player.ts");
  const controls = [
    ...mini.matchAll(/data-control="(previous|play|next|home)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(controls.slice(0, 4), ["previous", "play", "next", "home"]);
});

void test("18. Home is the final mini-player action", async () => {
  const mini = await read("components/mini-player.ts");
  const actions = mini.slice(
    mini.indexOf('<div class="mini-player__actions">'),
    mini.indexOf('<div class="mini-player__timeline"'),
  );
  assert.match(
    actions.trimEnd(),
    /data-control="home"[\s\S]*?<\/button>\s*<\/div>$/,
  );
});

void test("19. mini-player Previous calls the real action", async () => {
  const [mini, shell] = await Promise.all([
    read("components/mini-player.ts"),
    read("components/app-shell.ts"),
  ]);
  assert.match(mini, /bindAction\(previousButton,\s*onPrevious\)/);
  assert.match(shell, /actions\.previous,\s*actions\.next/);
});

void test("20. mini-player Next calls the real action", async () => {
  assert.match(
    await read("components/mini-player.ts"),
    /bindAction\(nextButton,\s*onNext\)/,
  );
});

void test("21. mini-player actions stop tap propagation", async () => {
  assert.match(
    await read("components/mini-player.ts"),
    /button\.addEventListener\("click",[\s\S]*?event\.stopPropagation\(\)/,
  );
});

void test("22. mini-player contains no elapsed or duration counter", async () => {
  const mini = await read("components/mini-player.ts");
  assert.doesNotMatch(mini, /<time|elapsed|duration-time/);
});

void test("23. mini-player height and progress geometry remain unchanged", async () => {
  const [css, tokens] = await Promise.all([
    read("styles/components.css"),
    read("styles/tokens.css"),
  ]);
  assert.match(tokens, /--mini-player-height:\s*6\.75rem/);
  assert.match(css, /\.mini-player__timeline\s*\{[\s\S]*?height:\s*2\.5rem/);
  assert.match(
    css,
    /\.mini-player__timeline-rail\s*\{[\s\S]*?height:\s*0\.5rem/,
  );
});

void test("24. Volume is in the right Now Playing zone", async () => {
  const nowPlaying = await read("screens/now-playing.ts");
  const right = nowPlaying.slice(
    nowPlaying.indexOf("transport__zone--right"),
    nowPlaying.indexOf("</div>", nowPlaying.indexOf("transport__zone--right")),
  );
  assert.match(right, /data-control="volume"/);
});

void test("25. Volume precedes Queue", async () => {
  const nowPlaying = await read("screens/now-playing.ts");
  const volume = nowPlaying.indexOf('data-control="volume"');
  const queue = nowPlaying.indexOf('data-control="queue"');
  assert.ok(volume > 0 && volume < queue);
});

void test("26. Queue is the final Now Playing control", async () => {
  const nowPlaying = await read("screens/now-playing.ts");
  const transport = nowPlaying.slice(
    nowPlaying.indexOf('<div class="transport"'),
    nowPlaying.indexOf("</div>`"),
  );
  const controls = [...transport.matchAll(/data-control="([^"]+)"/g)];
  assert.equal(controls.at(-1)?.[1], "queue");
});

void test("27. Play/Pause remains centered by symmetric transport columns", async () => {
  const css = await read("styles/screens.css");
  assert.match(
    css,
    /\.transport\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/,
  );
});

void test("28. viewport overlay is absent from app mounting", async () => {
  assert.doesNotMatch(
    await read("components/app-shell.ts"),
    /createViewportIndicator|viewportIndicator/,
  );
});

void test("29. no dormant viewport overlay DOM or listener remains", async () => {
  const [viewport, css] = await Promise.all([
    read("utils/viewport.ts"),
    read("styles/components.css"),
  ]);
  assert.doesNotMatch(viewport, /createElement|addEventListener\("resize"/);
  assert.doesNotMatch(css, /\.viewport-indicator/);
});

void test("30. remaining formatter reports time left after first toggle", () => {
  assert.equal(formatRemainingTime(155, 252), "-1:37");
  assert.equal(formatTime(0.99), "0:00");
  assert.equal(formatRemainingTime(0.99, 8.83), "-0:08");
  assert.equal(formatTime(1), "0:01");
  assert.equal(formatRemainingTime(1, 8.83), "-0:07");
});

void test("31. total formatter restores duration after second toggle", () => {
  assert.equal(formatTime(252), "4:12");
});

void test("32. timeline time mode uses a typed persistent preference", async () => {
  const [types, storage, main] = await Promise.all([
    read("state/types.ts"),
    read("utils/storage.ts"),
    read("main.ts"),
  ]);
  assert.match(types, /TimelineTimeMode\s*=\s*"total"\s*\|\s*"remaining"/);
  assert.match(storage, /eidetic-player\.interface\.timeline-time-mode/);
  assert.match(main, /timelineTimeMode:\s*loadTimelineTimeMode\(\)/);
});

void test("33. total and remaining formats support tracks over one hour", () => {
  assert.equal(formatTime(3_751), "1:02:31");
  assert.equal(formatRemainingTime(31, 3_751), "-1:02:00");
});

void test("34. timeline time toggle is disabled without a valid duration", async () => {
  const timeline = await read("components/timeline.ts");
  assert.match(timeline, /timeToggle\.disabled\s*=\s*!validDuration/);
  assert.equal(formatRemainingTime(0, 0), "0:00");
});

void test("35. section headers retain only descriptions and actions", async () => {
  const [sources, placeholder, settings] = await Promise.all([
    read("screens/sources.ts"),
    read("screens/placeholder.ts"),
    read("screens/settings.ts"),
  ]);
  for (const source of [sources, placeholder, settings]) {
    assert.doesNotMatch(source, /screen-header__eyebrow/);
    assert.match(source, /screen-header__description/);
  }
  assert.doesNotMatch(sources, /<h1/);
  assert.doesNotMatch(placeholder, /<h1/);
  assert.doesNotMatch(settings, /<h1/);
  assert.match(sources, /sources-header__add/);
});

void test("36. seamless transition machinery remains wired", async () => {
  const [shell, nowPlaying, artwork] = await Promise.all([
    read("components/app-shell.ts"),
    read("screens/now-playing.ts"),
    read("components/artwork.ts"),
  ]);
  assert.match(shell, /TrackTransitionCoordinator/);
  assert.match(nowPlaying, /presentation\.generation/);
  assert.match(nowPlaying, /trackTransitionId\s*===\s*generation/);
  assert.match(artwork, /decodeCache\.prepare/);
  assert.match(artwork, /currentGeneration/);
});

void test("37. Now Playing text rows reserve descender-safe line boxes", async () => {
  const css = await read("styles/screens.css");
  assert.match(
    css,
    /\.now-playing__artist\s*\{[\s\S]*?line-height:\s*1\.25;[\s\S]*?height:\s*1\.35em;[\s\S]*?padding-bottom:\s*0\.1em/,
  );
  assert.match(
    css,
    /\.now-playing__album\s*\{[\s\S]*?line-height:\s*1\.25;[\s\S]*?height:\s*1\.35em;[\s\S]*?padding-bottom:\s*0\.1em/,
  );
  assert.doesNotMatch(
    css,
    /\.now-playing__(?:artist|album)\s*\{[\s\S]*?-webkit-line-clamp:\s*1/,
  );
});

void test("38. all Now Playing transport zones share one vertical axis", async () => {
  const css = await read("styles/screens.css");
  assert.match(
    css,
    /\.transport\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?padding-top:/,
  );
  assert.match(css, /\.transport__zone\s*\{[\s\S]*?align-items:\s*center/);
});

void test("39. Now Playing separates Library and Folders without Open Files", async () => {
  const nowPlaying = await read("screens/now-playing.ts");
  assert.match(nowPlaying, /data-control="library"/);
  assert.match(nowPlaying, /data-control="folders"/);
  assert.doesNotMatch(nowPlaying, /now-playing__open|common\.openFiles/);
});

void test("40. Library and Folders are independent routes", async () => {
  const [routes, screens] = await Promise.all([
    read("navigation/routes.ts"),
    read("screens/index.ts"),
  ]);
  assert.match(routes, /id:\s*"folders"/);
  assert.match(routes, /id:\s*"library"/);
  assert.match(screens, /case "folders":[\s\S]*createFoldersScreen/);
  assert.match(screens, /case "library":[\s\S]*createLibraryScreen/);
});

void test("41. Home keeps its final position and gains a themed circle", async () => {
  const css = await read("styles/components.css");
  assert.match(
    css,
    /\.mini-player__home\s*\{[\s\S]*?border-radius:\s*50%;[\s\S]*?background:\s*var\(--color-accent-soft\)/,
  );
});
