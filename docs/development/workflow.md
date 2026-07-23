# Incremental workflow and non-regression rules

## Step discipline

Development proceeds in small, closed steps. Before editing:

1. read root `AGENTS.md`;
2. read the relevant files under `docs/development/`;
3. read existing architecture/UI docs;
4. read the latest applicable `prompts/step<number>_output.md`;
5. inspect current code and repository status;
6. reproduce reported defects and record a baseline.

Implement only the requested outcome. Do not fold in adjacent roadmap items,
replace working architecture, or perform a broad cleanup without explicit
scope.

## Preserve the approved product

Unless the current step explicitly changes them, preserve:

- vanilla TypeScript and the lightweight dependency profile;
- PlatformBridge and native-shell separation;
- MPV JSON IPC;
- REST/player SSE/visualizer SSE separation;
- artwork and waveform opaque endpoints;
- established 1280 × 800 geometry and touch targets;
- current overlay/focus behavior;
- Queue session semantics;
- startup and shutdown cleanup;
- browser fallback behavior.

Read the diff before finishing. Revert no unrelated user changes and do not
format unrelated files gratuitously.

## Defect workflow

For a reported defect:

1. reproduce it through the same real path the user used;
2. identify the causal boundary, not just the visual symptom;
3. capture measurable evidence where relevant;
4. add a focused regression test;
5. implement the smallest robust correction;
6. rerun the reproduction and compare before/after;
7. run adjacent non-regression checks.

Examples:

- a blinking Queue is not solved by hiding it with a longer fade;
- a wrong starting track is not solved by correcting UI state after MPV already
  loaded track one;
- a stale artwork race is not solved by delaying display globally;
- visualizer stutter is not solved by randomly lowering FPS before finding
  duplicate streams, loops, allocations, or analyzer restarts.

## Non-regression checklist

Select all relevant areas for each step:

- Neutralino runtime detection and initialization;
- native Open Files and drag/drop;
- MPV discovery, IPC, play/pause, seek, Previous/Next;
- correct single-file folder Queue and multi-select behavior;
- Queue append/remove/clear and stable IDs;
- metadata and artwork identity;
- mini-player and main-player synchronization;
- volume, mute, shuffle, and repeat persistence;
- player SSE reconnect without duplicate listeners;
- visualizer lifecycle and fallback;
- waveform lifecycle and fallback;
- overlays, Escape, focus trap, and focus restoration;
- animations off and reduced motion;
- 1280 × 800 layout and emergency layouts;
- clean shutdown.

## Required output file

Every implementation step must create:

```text
prompts/step<number>_output.md
```

Examples:

```text
prompts/step2.3_output.md
prompts/step2.3.1_output.md
prompts/step3.0_output.md
```

Never overwrite or rewrite earlier step outputs. If correcting a completed
step, use a new substep number.

The output file must contain the same substantive summary delivered to the
user, including:

- date and step title;
- requested outcome;
- root causes for defect fixes;
- files created and modified;
- architecture and behavior changes;
- dependencies added/removed and justification;
- commands and automated tests executed;
- real MPV/FFmpeg/Neutralino/media tests executed;
- 1280 × 800 visual/touch checks;
- relevant measurements before and after;
- bundle or runtime impact when relevant;
- cleanup result;
- skipped checks and exact reason;
- remaining limitations.

Do not claim a test passed when it was skipped, simulated, or inferred.

## Completion gate

For every Windows UI or visual step, the mandatory native QA command is
`npm.cmd run dev`. Exercise the requested flows and viewports in the
Neutralino/WebView2 window opened by that command. A browser, direct Vite URL,
browser automation, headless rendering, static inspection, or launch without
interaction does not satisfy this completion gate.

Before declaring completion:

1. inspect the final diff;
2. run formatting, typecheck, lint, build, and relevant tests;
3. exercise the real integration path for the changed feature;
4. inspect 1280 × 800 for seamless behavior;
5. verify no white flash, layout shift, stale async content, scroll jump, or
   unnecessary reconstruction;
6. verify clean shutdown;
7. update focused documentation;
8. save the required step output.

If a check cannot be run, record the limitation and do not substitute an
unrelated check as proof.
