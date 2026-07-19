import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoots = ["apps", "packages", "scripts"];
const sourceExtensions = new Set([".ts", ".js", ".mjs", ".cjs"]);
const importPattern =
  /(?:from\s+|import\s*\(|export\s+[^"']*from\s+)["'](\.[^"']+)["']/g;
const failures: string[] = [];

async function exactPath(path: string): Promise<boolean> {
  const absolute = resolve(path);
  const segments = relative("/", absolute).split("/");
  let current = "/";
  for (const segment of segments) {
    const names = await readdir(current).catch((): string[] => []);
    if (!names.includes(segment)) return false;
    current = join(current, segment);
  }
  return true;
}

async function resolveImport(
  file: string,
  specifier: string,
): Promise<string | null> {
  const raw = resolve(dirname(file), specifier);
  const candidates = extname(raw)
    ? [raw, raw.replace(/\.(?:js|mjs|cjs)$/, ".ts")]
    : [`${raw}.ts`, `${raw}.js`, join(raw, "index.ts")];
  for (const candidate of candidates) {
    if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  return null;
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

for (const sourceRoot of sourceRoots) {
  for (const file of await walk(join(root, sourceRoot))) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      const target = await resolveImport(file, specifier);
      if (!target || !(await exactPath(target)))
        failures.push(`${relative(root, file)} -> ${specifier}`);
    }
  }
}

if (failures.length > 0) {
  console.error("[case-sensitive] FAIL");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log("[case-sensitive] PASS: relative imports match filesystem case");
}
