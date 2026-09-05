import type { PreferencesSnapshot } from "../../../../packages/shared/src/preferences";

export type StartupSettingsWarning = "migration" | "persistence" | null;

export function startupSettingsWarning(
  snapshot: PreferencesSnapshot,
  legacyMigrationAttempted: boolean,
  legacyMigrationFailed: boolean,
): StartupSettingsWarning {
  if (legacyMigrationFailed) return "migration";
  if (snapshot.legacyImport === "manual-required") {
    // A persisted manual-required marker records an earlier one-time legacy
    // localStorage check. Replaying it after every release switch falsely
    // implies that the authoritative backend preferences were lost.
    if (legacyMigrationAttempted || snapshot.persistence !== "persisted")
      return "migration";
    return null;
  }
  return snapshot.warning ? "persistence" : null;
}
