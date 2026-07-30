import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

void test("Software Update follows the canonical System settings hierarchy", async () => {
  const [settings, css] = await Promise.all([
    readFile("apps/ui/src/screens/settings.ts", "utf8"),
    readFile("apps/ui/src/styles/screens.css", "utf8"),
  ]);
  for (const copy of [
    "Software update",
    "Update branch",
    "Refresh branches",
    "Check for updates",
    "Current build",
    "Target build",
    "Start update",
    "Install update?",
    "Update log",
    "No update activity recorded.",
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
  assert.match(settings, /section\.append\(refreshActions\)/u);
  assert.match(
    settings,
    /panel\.append\(branch, current, target, status, logHeading, logRegion\)/u,
  );
  assert.match(settings, /updateActions\.append\(check, start\)/u);
  assert.match(settings, /currentBuiltAt/u);
  assert.match(settings, /targetCommitAt/u);
  assert.match(settings, /updateBusyAction = "start";\s*render\(\)/u);
  assert.match(settings, /logRegion\.setAttribute\("role", "log"\)/u);
  assert.match(settings, /updatePageRefresh = \(\) =>/u);
  assert.match(settings, /updateState\.job\.log\.map/u);
  assert.match(
    settings,
    /page === "software-update" && updatePageRefresh[\s\S]+updatePageRefresh\(\)/u,
  );
  assert.doesNotMatch(
    settings,
    /page === "software-update"\s*\|\|[\s\S]{0,120}render\(\)/u,
  );
  assert.match(
    css,
    /\.settings-page-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/u,
  );
  assert.match(
    css,
    /\.settings-page-actions--single\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
  );
  assert.match(
    css,
    /\.update-log\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?scrollbar-gutter:\s*stable;/u,
  );
  assert.doesNotMatch(settings, /input[^>]+branch/iu);
});

void test("global update status survives navigation without exhausting REST connections", async () => {
  const [shell, settings, topBar, client, componentsCss] = await Promise.all([
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
    readFile("apps/ui/src/screens/settings.ts", "utf8"),
    readFile("apps/ui/src/components/top-bar.ts", "utf8"),
    readFile("apps/ui/src/api/update-api-client.ts", "utf8"),
    readFile("apps/ui/src/styles/components.css", "utf8"),
  ]);
  assert.match(shell, /topBar\.updateSoftwareUpdate/u);
  assert.match(shell, /Applying update…/u);
  assert.match(shell, /preferencesController\?\.flush/u);
  assert.doesNotMatch(
    shell,
    /snapshot\.revision < softwareUpdateState\.revision/u,
  );
  assert.doesNotMatch(
    settings,
    /updateSoftwareUpdateState\(snapshot\)\s*\{\s*if \(snapshot\.revision < updateState\.revision\)/u,
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
  assert.match(
    componentsCss,
    /\.top-bar__update\[data-visible="false"\]\s*\{\s*display:\s*none;/u,
  );
  assert.doesNotMatch(
    componentsCss,
    /\.top-bar__update\[data-visible="false"\][^{]*\{[^}]*visibility:\s*hidden/u,
  );
});
