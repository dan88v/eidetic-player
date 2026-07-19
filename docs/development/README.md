# Development guidelines

These documents expand the mandatory rules in the repository
[`AGENTS.md`](../../AGENTS.md).

- [Architecture](architecture.md) — component boundaries and state ownership.
- [Touch UI and UX](ui-ux.md) — physical touch, stable geometry, loading, and
  transitions.
- [Performance](performance.md) — Raspberry Pi 3B budgets, Canvas, SSE, MPV,
  and FFmpeg.
- [Testing](testing.md) — unit, integration, real-media, native-shell, and
  shutdown verification.
- [Security and accessibility](security-accessibility.md) — trust boundaries,
  safe local media handling, and accessible interaction.
- [Workflow](workflow.md) — incremental steps, regression discipline, and
  required reports.
- [Linux and Debian](linux-debian.md) — XDG, Unix IPC, WSLg, systemd, ARM, and
  Raspberry Pi preparation.

When guidance conflicts, follow this order:

1. the current user request;
2. root `AGENTS.md`;
3. these development documents;
4. existing feature documentation.

Do not use these documents as permission to expand the scope of a step.
