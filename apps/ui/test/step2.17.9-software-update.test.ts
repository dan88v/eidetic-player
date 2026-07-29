import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

void test("Software Update follows the canonical System settings hierarchy", async () => {
  const settings = await readFile("apps/ui/src/screens/settings.ts", "utf8");
  for (const copy of [
    "Software update",
    "Update branch",
    "Refresh branches",
    "Check for updates",
    "Current build",
    "Target build",
    "Start update",
    "Install update?",
  ])
    assert.match(settings, new RegExp(copy, "u"));
  assert.match(
    settings,
    /branch\.channel === "stable" \? "Stable" : "Development"/u,
  );
  assert.match(
    settings,
    /page === "update-branch"\) page = "software-update"/u,
  );
  assert.match(settings, /if \(updateState\.available\)/u);
  assert.match(settings, /branch\.disabled = active/u);
  assert.match(settings, /refresh\.disabled = updateBusy \|\| updateActive/u);
  assert.doesNotMatch(settings, /input[^>]+branch/iu);
});

void test("global update status survives navigation without exhausting REST connections", async () => {
  const [shell, topBar, client] = await Promise.all([
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
    readFile("apps/ui/src/components/top-bar.ts", "utf8"),
    readFile("apps/ui/src/api/update-api-client.ts", "utf8"),
  ]);
  assert.match(shell, /topBar\.updateSoftwareUpdate/u);
  assert.match(shell, /Applying update…/u);
  assert.match(shell, /preferencesController\?\.flush/u);
  assert.doesNotMatch(
    shell,
    /snapshot\.revision < softwareUpdateState\.revision/u,
  );
  assert.equal((client.match(/new EventSource/gu) ?? []).length, 1);
  assert.match(client, /if \(this\.lastSnapshot && this\.isActive/u);
  assert.match(
    client,
    /if \(this\.isActive\(snapshot\)\) this\.ensureEventSource\(\);\s*else this\.closeEventSource\(\)/u,
  );
  assert.doesNotMatch(
    shell,
    /updateApi\.subscribe[\s\S]{0,100}new EventSource/u,
  );
  assert.match(topBar, /role="status"/u);
  assert.match(topBar, /data-visible="false"/u);
  assert.match(topBar, /updateElapsedTimer/u);
  assert.match(topBar, /pointerenter/u);
  assert.match(topBar, /addEventListener\("focus"/u);
  assert.match(topBar, /prefers-reduced-motion|top-bar__update/u);
});
