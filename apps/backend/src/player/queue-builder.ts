import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { isSupportedAudioPath } from "../../../../packages/shared/src/audio.js";
import { PlayerError } from "./player-error.js";

const naturalCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function naturalSortPaths(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) =>
    naturalCollator.compare(basename(left), basename(right)),
  );
}

export function deduplicatePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = resolve(path).toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolve(path));
  }
  return result;
}

async function validateFile(path: string): Promise<string | null> {
  if (!isSupportedAudioPath(path)) return null;
  const absolutePath = resolve(path);
  try {
    const details = await stat(absolutePath);
    if (!details.isFile()) return null;
    await access(absolutePath, constants.R_OK);
    return absolutePath;
  } catch {
    return null;
  }
}

export async function expandQueueFromSingleFile(
  path: string,
): Promise<string[]> {
  const selected = await validateFile(path);
  if (!selected)
    throw new PlayerError(
      "NO_VALID_FILES",
      "No readable supported audio file was selected.",
    );
  const parent = dirname(selected);
  const entries = await readdir(parent, { withFileTypes: true });
  const candidatePaths = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        isSupportedAudioPath(entry.name),
    )
    .map((entry) => resolve(parent, entry.name));
  const validated = await Promise.all(candidatePaths.map(validateFile));
  const sorted = naturalSortPaths(
    validated.filter((candidate): candidate is string => candidate !== null),
  );
  const selectedIndex = sorted.findIndex(
    (candidate) =>
      candidate.toLocaleLowerCase("en") === selected.toLocaleLowerCase("en"),
  );
  return selectedIndex < 0 ? [selected] : sorted.slice(selectedIndex);
}

export async function buildQueue(paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0)
    throw new PlayerError("NO_VALID_FILES", "No audio files were selected.");
  if (paths.length === 1) return expandQueueFromSingleFile(paths[0] ?? "");
  const unique = deduplicatePaths(paths);
  const validated = await Promise.all(unique.map(validateFile));
  const result = validated.filter((path): path is string => path !== null);
  if (result.length === 0)
    throw new PlayerError(
      "NO_VALID_FILES",
      "None of the selected files is a readable supported audio file.",
    );
  return result;
}
