import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { icon, type IconName } from "../src/components/icons.js";

const read = (path: string): Promise<string> =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

const [miniPlayer, componentsCss, toastHost] = await Promise.all([
  read("components/mini-player.ts"),
  read("styles/components.css"),
  read("components/toast-host.ts"),
]);

const allIconNames: readonly IconName[] = [
  "album",
  "back",
  "chevronRight",
  "close",
  "ethernet",
  "folder",
  "home",
  "library",
  "menu",
  "grid",
  "list",
  "more",
  "next",
  "nowPlaying",
  "pause",
  "play",
  "plus",
  "previous",
  "queue",
  "repeat",
  "settings",
  "shuffle",
  "sources",
  "usb",
  "volume",
  "volumeMuted",
  "wifi",
];

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(componentsCss);
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1] ?? "";
}

function assertRenderableIcon(name: IconName): void {
  const rendered = icon(name, `icon icon--${name}`);
  assert.match(rendered, /^<svg\b[^>]*>.+<\/svg>$/s);
  assert.match(rendered, new RegExp(`class="icon icon--${name}"`));
  assert.match(rendered, /viewBox="0 0 24 24"/);
  assert.match(rendered, /aria-hidden="true"/);
  assert.match(rendered, /(?:<path\b|<rect\b|<circle\b)/);
  assert.doesNotMatch(rendered, /width="0"|height="0"/);
  assert.doesNotMatch(rendered, />[^<\s][^<]*</);
}

void test("mini-player Home and transport render the approved SVG icons", () => {
  for (const name of ["home", "previous", "play", "pause", "next"] as const)
    assertRenderableIcon(name);

  for (const control of ["home", "previous", "play", "next"])
    assert.match(
      miniPlayer,
      new RegExp(
        `<button[^>]+data-control="${control}"[^>]+aria-label="[^"]+"[^>]*>\\$\\{icon\\("${control}"\\)\\}</button>`,
      ),
    );
  assert.match(
    miniPlayer,
    /const nextPlayIcon = state\.paused \? "play" : "pause"/,
  );
  assert.match(miniPlayer, /playButton\.innerHTML = icon\(nextPlayIcon\)/);
});

void test("every shared icon renderer retains visible vector geometry", () => {
  for (const name of allIconNames) assertRenderableIcon(name);
});

void test("mini-player keeps summary and controls in separate visible columns", () => {
  const rule = cssRule(".mini-player");
  assert.match(rule, /height: var\(--mini-player-height\)/);
  assert.match(rule, /grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.doesNotMatch(
    rule,
    /display:\s*none|visibility:\s*hidden|opacity:\s*0/,
  );

  const iconRule = cssRule(".icon-button .icon,\n  .nav-item .icon");
  assert.match(iconRule, /width:\s*1\.75rem/);
  assert.match(iconRule, /height:\s*1\.75rem/);
  assert.doesNotMatch(
    iconRule,
    /display:\s*none|visibility:\s*hidden|opacity:\s*0/,
  );
});

void test("toast styling stays scoped and scan progress has only dismiss", () => {
  assert.match(toastHost, /createDismissButton\(dismissProgress\)/);
  assert.doesNotMatch(toastHost, /data-toast-action/);
  assert.doesNotMatch(componentsCss, /(?:^|})\s*(?:svg|path)\s*\{/m);
  const toastDiff = componentsCss.slice(
    componentsCss.indexOf(".app-toast-host"),
  );
  assert.doesNotMatch(
    toastDiff,
    /^\s*(?:\.mini-player|\.transport|\.icon)\b.*\{/m,
  );
});
