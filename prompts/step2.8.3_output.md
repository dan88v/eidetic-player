# Step 2.8.3 — Reusable on-screen keyboard foundation

Date: 2026-07-22

## Result

Step 2.8.3 is complete without changing Default Player, Cassette Player,
mini-player, Queue, playback, or analysis behavior.

## Reusable package

- Added the framework-free `packages/on-screen-keyboard` TypeScript/CSS package
  with no Eidetic, backend, storage, or platform dependency.
- The package enforces one controller per document, owns one centralized set of
  listeners, and removes all listeners and state on teardown. It creates no
  timer, observer, animation-frame loop, request, or persistence.
- Editing targets the real input at its live selection, honors `maxlength`, and
  emits one bubbling `input` event. Backspace, Clear, Shift, double-tap Caps
  Lock, symbols, Search/Done, Hide, focus preservation, and Escape are covered.
- Text, numeric, and IPv4 profiles are available. Disabled, readonly, hidden,
  and password fields are rejected.

## Eidetic integration

- Added one application-lifetime adapter with localized labels and Eidetic
  theme tokens. Only explicit `data-onscreen-keyboard` fields opt in.
- Library Search uses the text/Search profile; the safe Source rename field
  uses text/Done. Player surfaces are deliberately outside the integration.
- Settings > Interface now exposes immediate, persisted `Auto | Off`, defaulting
  to Auto. Automatic opening is limited to touch or pen and is suppressed for
  mouse, physical-keyboard focus, Off, or a host preferring its native keyboard.
- Route rendering, field removal, focus departure, Hide, Done, Escape, Off, and
  shell teardown close the keyboard. Keyboard visibility suspends the existing
  inactivity return without adding another timer.

## Final visual direction

The later visual steering supersedes the initial preview proposal: the real
input is the only displayed value field, so no redundant preview is rendered.

- The SteamOS-inspired bottom grid fills the viewport width, has no outer
  rounded container, and uses one-pixel separators instead of a complete border
  around every key.
- Text keys are 64 px high at 1280 x 800 and 1280 x 720, and 56 px high at the
  1024 x 600 emergency layout.
- `ASDFGHJKL` is centred between the QWERTY row keys. Exact 20-subcolumn
  geometry places Z below S and M below K, with calibrated Shift and Backspace.
- The fourth alphabetic row contains `123`, comma, Space, period, Done/Search,
  and an icon-only Hide control, with exact edge alignment.
- The `123` layer uses the same ten-column geometry: digits are on top, symbols
  are below, and its third row is symmetrical as `#+=` + six symbols (including
  the requested `+`) + Backspace. Every row closes exactly at the viewport edge.
- The sheet stays above the mini-player, respects the safe area, and uses only
  transform/opacity motion. Animations Off and reduced motion make it static.

## Tests and real QA

Focused tests cover editing, selection replacement, `maxlength`, layouts,
touch-only policy, eligibility, singleton/listener lifecycle, CSS, Settings
persistence, adapter teardown, Search/rename opt-in, Escape, layering, and
player isolation.

The real `npm.cmd run dev` Neutralino/WebView2 path was exercised with an
isolated temporary profile. QA covered:

- touch opening versus mouse/physical-keyboard suppression;
- Auto/Off immediate persistence and reopening;
- one-shot Shift, Caps Lock, symbols, caret replacement, Search's single Enter,
  Done, Hide, and Escape;
- numeric editing (`13`, Clear, `4`, one Enter) and IPv4 editing (`1.3`);
- the alphabetic and `123` grids at exact client viewports 1280 x 800,
  1280 x 720, and 1024 x 600;
- symbol rows measuring the full 1280/1024 px width, the symmetric third row,
  and no horizontal overflow;
- Default, Cassette, and mini-player regression surfaces with zero opted-in
  player inputs.

The app was closed through the normal window path. Neutralino, backend, Vite,
MPV, FFmpeg, ports 4310/5173/9223, and the isolated profile were cleaned up. No
user Library or media was read or modified.

## Final checks

- `npm.cmd run format:check` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 322 tests, 320 passed and 2 platform skips.
- `git diff --check` passed.

MPV/FFmpeg doctor and integration suites were not run because playback,
analysis, and native media paths were not modified. No commit, push, merge,
rebase, reset, restore, stash, or clean was performed.
