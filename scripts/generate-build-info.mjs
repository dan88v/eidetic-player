import { execFileSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const buildInfoSchemaVersion = 1;

const fullShaPattern = /^[0-9a-f]{40}$/u;
const refPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const sources = new Set(["ci", "git", "explicit"]);

function git(workspace, ...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function sanitizeBuildRef(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value
    .trim()
    .replace(/^refs\/(?:heads|tags)\//u, "")
    .replace(/[^A-Za-z0-9._/-]+/gu, "-")
    .replace(/^[-./]+|[-./]+$/gu, "")
    .slice(0, 128);
  return refPattern.test(normalized) ? normalized : "unknown";
}

export function createBuildInfo({
  commitSha,
  ref,
  packageVersion,
  builtAt,
  source,
  dirty,
}) {
  const normalizedSha = String(commitSha).trim().toLowerCase();
  if (!fullShaPattern.test(normalizedSha))
    throw new Error("commit SHA must contain exactly 40 lowercase hex digits");
  if (!sources.has(source)) throw new Error("invalid build provenance source");
  const timestamp = new Date(builtAt);
  if (!Number.isFinite(timestamp.valueOf()))
    throw new Error("builtAt must be a valid ISO timestamp");
  if (
    typeof packageVersion !== "string" ||
    !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(packageVersion)
  )
    throw new Error("invalid package version");
  return {
    schemaVersion: buildInfoSchemaVersion,
    commitSha: normalizedSha,
    shortCommitSha: normalizedSha.slice(0, 7),
    ref: sanitizeBuildRef(ref),
    packageVersion,
    builtAt: timestamp.toISOString(),
    source,
    ...(typeof dirty === "boolean" ? { dirty } : {}),
  };
}

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (
      ![
        "--output",
        "--commit",
        "--ref",
        "--built-at",
        "--source",
        "--package-version",
      ].includes(argument)
    )
      throw new Error(`unknown option: ${String(argument)}`);
    const value = arguments_[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    values[argument.slice(2)] = value;
    index += 1;
  }
  if (!values.output) throw new Error("--output is required");
  return values;
}

function timestampFromEnvironment() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/u.test(epoch))
    return new Date(Number(epoch) * 1000).toISOString();
  return new Date().toISOString();
}

export async function generateBuildInfo(arguments_ = process.argv.slice(2)) {
  const options = parseArguments(arguments_);
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const packageJson = JSON.parse(
    await import("node:fs/promises").then(({ readFile }) =>
      readFile(resolve(workspace, "package.json"), "utf8"),
    ),
  );
  const explicit = Boolean(options.commit);
  const ciCommit = process.env.GITHUB_SHA;
  const commitSha =
    options.commit ?? ciCommit ?? git(workspace, "rev-parse", "HEAD");
  const ref =
    options.ref ??
    process.env.EIDETIC_BUILD_REF ??
    process.env.GITHUB_REF_NAME ??
    (() => {
      try {
        return git(workspace, "symbolic-ref", "--short", "HEAD");
      } catch {
        return "detached";
      }
    })();
  const source =
    options.source ?? (explicit ? "explicit" : ciCommit ? "ci" : "git");
  let dirty;
  if (source === "git") {
    dirty = git(workspace, "status", "--porcelain").length > 0;
  }
  const info = createBuildInfo({
    commitSha,
    ref,
    packageVersion: options["package-version"] ?? packageJson.version,
    builtAt: options["built-at"] ?? timestampFromEnvironment(),
    source,
    dirty,
  });
  const output = resolve(workspace, options.output);
  const temporary = `${output}.tmp-${String(process.pid)}`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(info, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, output);
  return info;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await generateBuildInfo();
}
