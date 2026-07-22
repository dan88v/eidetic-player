# Development guidelines

These documents expand the mandatory rules in the repository
[`AGENTS.md`](../../AGENTS.md).

- [Architecture](architecture.md) — component boundaries and state ownership.
- [Touch UI and UX](ui-ux.md) — physical touch, stable geometry, loading, and
  transitions.
- [Reusable on-screen keyboard](on-screen-keyboard.md) — opt-in profiles,
  touch-only policy, editing, layout, and lifecycle ownership.
- [Performance](performance.md) — Raspberry Pi 3B budgets, Canvas, SSE, MPV,
  and FFmpeg.
- [Cassette main player](cassette-player.md) — Queue tape progress, mechanics,
  animation lifecycle, and the Default/visualizer boundary.
- [Indexed Library](library-index.md) — SQLite ownership, schema, incremental
  scanning, cancellation, recovery, API, and UI lifecycle.
- [Testing](testing.md) — unit, integration, real-media, native-shell, and
  shutdown verification.
- [Security and accessibility](security-accessibility.md) — trust boundaries,
  safe local media handling, and accessible interaction.
- [Workflow](workflow.md) — incremental steps, regression discipline, and
  required reports.
- [WSL2 Debian environment](../../wsl-debian-prep/wsl-debian-setup.md) —
  repeatable local bootstrap for the future Linux compatibility audit. The
  setup scripts and preparation report live in the same dedicated folder.

When guidance conflicts, follow this order:

1. the current user request;
2. root `AGENTS.md`;
3. these development documents;
4. existing feature documentation.

Do not use these documents as permission to expand the scope of a step.
