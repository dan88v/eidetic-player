import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [screensCss, workingAgreement] = await Promise.all([
  readFile("apps/ui/src/styles/screens.css", "utf8"),
  readFile("AGENTS.md", "utf8"),
]);

void test("playlist secondary toolbar action uses the shared button geometry", () => {
  assert.match(
    screensCss,
    /\.playlist-detail-toolbar__queue\s*\{[^}]*border: 1px solid var\(--color-border\);[^}]*border-radius: var\(--radius-md\);[^}]*background: var\(--color-surface-raised\);/s,
  );
});

void test("playlist name actions stay above the keyboard at reduced heights", () => {
  assert.match(
    screensCss,
    /@media \(max-height: 45rem\)\s*\{\s*\.app-root\[data-keyboard-open="true"\] \.playlist-name-dialog\s*\{[^}]*top: calc\(var\(--top-bar-height\) \+ var\(--space-2\)\);[^}]*transform: translate\(-50%, 0\);/s,
  );
});

void test("working agreement requires canonical surfaces and real visual QA", () => {
  assert.match(workingAgreement, /## Canonical UI surfaces and visual QA/);
  assert.match(workingAgreement, /Every new page must name and reuse/);
  assert.match(
    workingAgreement,
    /source review and automated tests alone are not a/,
  );
  assert.match(
    workingAgreement,
    /intentional and documented in the step report/,
  );
});
