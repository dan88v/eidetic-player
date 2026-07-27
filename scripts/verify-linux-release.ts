import { constants } from "node:fs";
import {
  access,
  lstat,
  readFile,
  readlink,
  readdir,
  stat,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type LinuxReleaseArchitecture = "arm64" | "x64";
export type LinuxReleasePhase = "build" | "staged";

export interface LinuxReleaseOptions {
  readonly root: string;
  readonly architecture: LinuxReleaseArchitecture;
  readonly phase: LinuxReleasePhase;
  readonly sourceRoot?: string;
  readonly expectedOwner?: number;
}

interface Entry {
  readonly absolute: string;
  readonly relative: string;
  readonly mode: number;
  readonly uid: number;
  readonly size: number;
  readonly symbolicLink: boolean;
}

interface ReleaseBuildInfo {
  readonly schemaVersion: 1;
  readonly commitSha: string;
  readonly shortCommitSha: string;
  readonly ref: string;
  readonly packageVersion: string;
  readonly builtAt: string;
  readonly source: string;
  readonly dirty?: boolean;
}

export interface LinuxReleaseResult {
  readonly passed: readonly string[];
  readonly failed: readonly string[];
}

async function exists(path: string): Promise<boolean> {
  return access(path, constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

async function collectEntries(root: string): Promise<{
  entries: Entry[];
  brokenLinks: string[];
}> {
  const entries: Entry[] = [];
  const brokenLinks: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const name of await readdir(directory)) {
      const absolute = resolve(directory, name);
      const details = await lstat(absolute);
      const entry = {
        absolute,
        relative: relative(root, absolute).split(sep).join("/"),
        mode: details.mode & 0o777,
        uid: details.uid,
        size: details.size,
        symbolicLink: details.isSymbolicLink(),
      };
      entries.push(entry);
      if (details.isSymbolicLink()) {
        try {
          await stat(absolute);
        } catch {
          brokenLinks.push(entry.relative);
        }
      } else if (details.isDirectory()) {
        await visit(absolute);
      }
    }
  };
  await visit(root);
  return { entries, brokenLinks };
}

function expectedMachine(architecture: LinuxReleaseArchitecture): number {
  return architecture === "arm64" ? 0xb7 : 0x3e;
}

async function verifyElf(
  path: string,
  architecture: LinuxReleaseArchitecture,
): Promise<boolean> {
  const content = await readFile(path);
  if (content.length < 20) return false;
  const littleEndian =
    content[0] === 0x7f &&
    content[1] === 0x45 &&
    content[2] === 0x4c &&
    content[3] === 0x46 &&
    content[5] === 1;
  return (
    littleEndian && content.readUInt16LE(18) === expectedMachine(architecture)
  );
}

function addCheck(
  passed: string[],
  failed: string[],
  label: string,
  condition: boolean,
): void {
  (condition ? passed : failed).push(label);
}

async function validBuildInfo(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<ReleaseBuildInfo>;
    return (
      value.schemaVersion === 1 &&
      typeof value.commitSha === "string" &&
      /^[0-9a-f]{40}$/u.test(value.commitSha) &&
      typeof value.shortCommitSha === "string" &&
      /^[0-9a-f]{7}$/u.test(value.shortCommitSha) &&
      value.shortCommitSha === value.commitSha.slice(0, 7) &&
      typeof value.ref === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(value.ref) &&
      typeof value.packageVersion === "string" &&
      typeof value.builtAt === "string" &&
      Number.isFinite(Date.parse(value.builtAt)) &&
      typeof value.source === "string" &&
      ["ci", "git", "explicit"].includes(value.source) &&
      (value.dirty === undefined || typeof value.dirty === "boolean")
    );
  } catch {
    return false;
  }
}

async function findSourceLeak(
  entries: readonly Entry[],
  sourceRoot: string,
): Promise<string | undefined> {
  const normalized = resolve(sourceRoot);
  const candidates = new Set([
    normalized,
    normalized.split("\\").join("/"),
    normalized.split("/").join("\\"),
    JSON.stringify(normalized).slice(1, -1),
  ]);
  for (const entry of entries) {
    if (
      entry.symbolicLink ||
      entry.size > 2 * 1024 * 1024 ||
      !/\.(?:js|json|map|txt)$/i.test(entry.relative)
    )
      continue;
    const content = await readFile(entry.absolute, "utf8");
    if ([...candidates].some((candidate) => content.includes(candidate)))
      return entry.relative;
  }
  return undefined;
}

export async function verifyLinuxRelease(
  options: LinuxReleaseOptions,
): Promise<LinuxReleaseResult> {
  const root = resolve(options.root);
  const passed: string[] = [];
  const failed: string[] = [];
  if (!(await exists(root))) {
    return { passed, failed: [`artifact root is missing: ${root}`] };
  }

  const { entries, brokenLinks } = await collectEntries(root);
  addCheck(
    passed,
    failed,
    "no broken symbolic links",
    brokenLinks.length === 0,
  );
  for (const link of brokenLinks) failed.push(`broken symbolic link: ${link}`);

  const requireFile = async (label: string, path: string): Promise<void> => {
    const valid = await stat(path)
      .then((details) => details.isFile())
      .catch(() => false);
    addCheck(passed, failed, label, valid);
  };

  if (options.phase === "build") {
    addCheck(
      passed,
      failed,
      "valid build provenance manifest",
      await validBuildInfo(resolve(root, "dist/build-info.json")),
    );
    const backend = resolve(root, "dist/backend/apps/backend/src/index.js");
    const shell = resolve(
      root,
      `dist/eidetic-player/eidetic-player-linux_${options.architecture}`,
    );
    await requireFile("compiled backend entrypoint", backend);
    await requireFile(`Neutralino ${options.architecture} binary`, shell);
    if (await exists(shell))
      addCheck(
        passed,
        failed,
        `Neutralino ${options.architecture} ELF header`,
        await verifyElf(shell, options.architecture),
      );
    await requireFile(
      "Neutralino configuration",
      resolve(root, "neutralino.config.json"),
    );
    await requireFile(
      "built UI entrypoint",
      resolve(root, "dist/ui/index.html"),
    );
    const resourceFiles = entries.filter(
      (entry) =>
        entry.relative.startsWith("dist/eidetic-player/") &&
        entry.relative.endsWith(".neu") &&
        entry.size > 0,
    );
    addCheck(
      passed,
      failed,
      "non-empty Neutralino resource archive",
      resourceFiles.length > 0,
    );
    const uiAssets = entries.filter(
      (entry) =>
        entry.relative.startsWith("dist/ui/assets/") &&
        /\.(?:css|js)$/i.test(entry.relative) &&
        entry.size > 0,
    );
    addCheck(
      passed,
      failed,
      "non-empty built UI CSS and JavaScript assets",
      uiAssets.some((entry) => entry.relative.endsWith(".css")) &&
        uiAssets.some((entry) => entry.relative.endsWith(".js")),
    );
  } else {
    addCheck(
      passed,
      failed,
      "valid build provenance manifest",
      await validBuildInfo(resolve(root, "build-info.json")),
    );
    for (const [label, path] of [
      ["compiled backend entrypoint", "backend/apps/backend/src/index.js"],
      ["Neutralino executable", "eidetic-player"],
      ["backend readiness launcher", "bin/eidetic-player-launch"],
      ["Neutralino configuration", "neutralino.config.json"],
      ["production package manifest", "package.json"],
      ["production lockfile", "package-lock.json"],
    ] as const)
      await requireFile(label, resolve(root, path));
    if (options.sourceRoot && (await exists(resolve(root, "eidetic-player"))))
      addCheck(
        passed,
        failed,
        `staged Neutralino ${options.architecture} ELF header`,
        await verifyElf(resolve(root, "eidetic-player"), options.architecture),
      );
    const dependency = await stat(resolve(root, "node_modules/music-metadata"))
      .then((details) => details.isDirectory())
      .catch(() => false);
    addCheck(
      passed,
      failed,
      "production dependency music-metadata",
      dependency,
    );
    addCheck(
      passed,
      failed,
      "non-empty Neutralino resource archive",
      entries.some(
        (entry) =>
          !entry.relative.includes("/") &&
          entry.relative.endsWith(".neu") &&
          entry.size > 0,
      ),
    );

    if (process.platform !== "win32") {
      for (const path of ["eidetic-player", "bin/eidetic-player-launch"]) {
        try {
          const details = await stat(resolve(root, path));
          addCheck(
            passed,
            failed,
            `${path} mode 0755`,
            (details.mode & 0o777) === 0o755,
          );
        } catch {
          // The missing-file check already supplies the primary diagnostic.
        }
      }
      if (options.expectedOwner !== undefined) {
        const wrongOwner = entries.find(
          (entry) => entry.uid !== options.expectedOwner,
        );
        addCheck(
          passed,
          failed,
          `release owner uid ${String(options.expectedOwner)}`,
          wrongOwner === undefined,
        );
      }
    }

    if (options.sourceRoot) {
      const leak = await findSourceLeak(entries, options.sourceRoot);
      addCheck(
        passed,
        failed,
        "no source-checkout path in staged release",
        leak === undefined,
      );
      if (leak) failed.push(`source-checkout path found in: ${leak}`);
    }

    if (basename(root).startsWith(".incoming-")) {
      const opt = dirname(dirname(root));
      const current = resolve(opt, "current");
      const activated = await readlink(current)
        .then(
          (currentTarget) =>
            resolve(opt, currentTarget) === root ||
            basename(currentTarget) === basename(root),
        )
        .catch(() => false);
      addCheck(
        passed,
        failed,
        "incoming release is not current before verification",
        !activated,
      );
    }
  }
  return { passed, failed };
}

function parseArguments(arguments_: readonly string[]): {
  options?: LinuxReleaseOptions;
  json: boolean;
  help: boolean;
} {
  let root = "";
  let architecture = "";
  let phase = "";
  let sourceRoot: string | undefined;
  let expectedOwner: number | undefined;
  let json = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--root") {
      root = value ?? "";
      index += 1;
    } else if (argument === "--arch") {
      architecture = value ?? "";
      index += 1;
    } else if (argument === "--phase") {
      phase = value ?? "";
      index += 1;
    } else if (argument === "--source-root") {
      sourceRoot = value ?? "";
      index += 1;
    } else if (argument === "--expected-owner") {
      expectedOwner = Number(value);
      index += 1;
    } else if (argument === "--json") {
      json = true;
    } else if (argument === "--help") {
      return { json, help: true };
    } else {
      throw new Error(`unknown option: ${String(argument)}`);
    }
  }
  if (!root) throw new Error("--root is required");
  if (architecture === "amd64") architecture = "x64";
  if (architecture !== "arm64" && architecture !== "x64")
    throw new Error("--arch must be arm64, x64 or amd64");
  if (phase === "build-output") phase = "build";
  if (phase === "staged-release") phase = "staged";
  if (phase !== "build" && phase !== "staged")
    throw new Error(
      "--phase must be build, build-output, staged or staged-release",
    );
  if (
    expectedOwner !== undefined &&
    (!Number.isInteger(expectedOwner) || expectedOwner < 0)
  )
    throw new Error("--expected-owner must be a non-negative integer");
  return {
    json,
    help: false,
    options: {
      root,
      architecture,
      phase,
      ...(sourceRoot ? { sourceRoot } : {}),
      ...(expectedOwner === undefined ? {} : { expectedOwner }),
    },
  };
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[verify:linux:release] FAIL ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
    return;
  }
  if (parsed.help) {
    console.log(
      "Usage: tsx scripts/verify-linux-release.ts --root PATH --arch arm64|x64|amd64 --phase build|staged [--source-root PATH] [--expected-owner UID] [--json]",
    );
    return;
  }
  if (!parsed.options) {
    console.error("[verify:linux:release] FAIL missing verification options");
    process.exitCode = 1;
    return;
  }
  const result = await verifyLinuxRelease(parsed.options);
  if (parsed.json) {
    console.log(JSON.stringify(result));
  } else {
    for (const item of result.passed)
      console.log(`[verify:linux:release] PASS ${item}`);
    for (const item of result.failed)
      console.error(`[verify:linux:release] FAIL ${item}`);
  }
  if (result.failed.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
