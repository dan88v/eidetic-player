import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultUiPreferences,
  type PreferencesSnapshot,
} from "../../../packages/shared/src/preferences";
import { startupSettingsWarning } from "../src/preferences/startup-settings-warning";

function snapshot(
  changes: Partial<PreferencesSnapshot> = {},
): PreferencesSnapshot {
  return {
    schemaVersion: 4,
    revision: 85,
    preferences: defaultUiPreferences,
    persistence: "persisted",
    legacyImport: "imported",
    warning: false,
    ...changes,
  };
}

void test("a preserved manual-import marker does not replay after an update", () => {
  assert.equal(
    startupSettingsWarning(
      snapshot({ legacyImport: "manual-required", warning: true }),
      false,
      false,
    ),
    null,
  );
});

void test("a newly detected or unavailable legacy import remains visible", () => {
  const pending = snapshot({
    revision: 1,
    legacyImport: "manual-required",
    warning: true,
  });
  assert.equal(startupSettingsWarning(pending, true, false), "migration");
  assert.equal(
    startupSettingsWarning(
      { ...pending, persistence: "degraded" },
      false,
      false,
    ),
    "migration",
  );
  assert.equal(startupSettingsWarning(pending, false, true), "migration");
});

void test("real persistence warnings still appear after completed migration", () => {
  assert.equal(
    startupSettingsWarning(snapshot({ warning: true }), false, false),
    "persistence",
  );
  assert.equal(startupSettingsWarning(snapshot(), false, false), null);
});
