import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

void test("local Context play uses one compact revision-bound decision dialog", async () => {
  const dialog = await readFile(
    resolve(root, "src/components/playback-queue-dialog.ts"),
    "utf8",
  );
  const shell = await readFile(
    resolve(root, "src/components/app-shell.ts"),
    "utf8",
  );
  const styles = await readFile(
    resolve(root, "src/styles/screens.css"),
    "utf8",
  );
  const copy = `${dialog}\n${await readFile(resolve(root, "src/i18n/en.ts"), "utf8")}`;
  for (const label of [
    "Up Next isn't empty",
    "Clear it before playing this selection?",
    "Keep Up Next",
    "Clear & Play",
  ])
    assert.ok(copy.includes(label));
  assert.match(dialog, /explicitQueuePolicy: policy/u);
  assert.match(dialog, /expectedQueueRevision: pending\.revision/u);
  assert.match(dialog, /event\.key === "Escape"/u);
  assert.match(shell, /state\.explicitQueue\?\.length/u);
  assert.match(shell, /playbackQueueDialog\.decide\(state\.queueRevision/u);
  assert.match(
    styles,
    /\.playback-queue-dialog__close[\s\S]*width: 44px;[\s\S]*height: 44px;/u,
  );
});

void test("every local Context-producing client receives the same decision provider", async () => {
  const shell = await readFile(
    resolve(root, "src/components/app-shell.ts"),
    "utf8",
  );
  for (const client of [
    "PlayerApiClient",
    "FoldersApiClient",
    "RemovableStorageApiClient",
    "LibraryApiClient",
    "SmbApiClient",
  ])
    assert.match(
      shell,
      new RegExp(`new ${client}\\(decideContextPlay\\)`, "u"),
    );
  for (const file of [
    "player-api-client.ts",
    "folders-api-client.ts",
    "removable-storage-api-client.ts",
    "library-api-client.ts",
    "smb-api-client.ts",
  ]) {
    const source = await readFile(resolve(root, "src/api", file), "utf8");
    assert.match(source, /queueDecision/u);
    assert.match(source, /decideContextPlay/u);
  }
});
