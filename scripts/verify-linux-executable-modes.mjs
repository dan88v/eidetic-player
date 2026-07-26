#!/usr/bin/env node
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const requiredExecutablePaths = new Set([
  "deploy/linux/doctor-installation.sh",
  "deploy/linux/install-eidetic-player.sh",
  "deploy/linux/lib/common.sh",
  "deploy/linux/network/install-network-integration.sh",
  "deploy/linux/network/uninstall-network-integration.sh",
  "deploy/linux/restore-system-ui.sh",
  "deploy/linux/runtime/eidetic-player",
  "deploy/linux/runtime/eidetic-player-display-policy",
  "deploy/linux/runtime/eidetic-player-launch",
  "deploy/linux/runtime/eidetic-player-maintenance",
  "deploy/linux/runtime/eidetic-player-power-helper",
  "deploy/linux/runtime/eidetic-player-resume",
  "deploy/linux/runtime/eidetic-player-smb-helper",
  "deploy/linux/test-case-sensitive-wsl.sh",
  "deploy/linux/test-gpio-i2s-dac-staging.sh",
  "deploy/linux/test-platform-detection.sh",
  "deploy/linux/test-rpi-keyboard.sh",
  "deploy/linux/test-staging.sh",
  "deploy/linux/test-unprivileged-build.sh",
  "deploy/linux/uninstall-eidetic-player.sh",
  "deploy/linux/update-eidetic-player.sh",
]);

const knownDataPaths = new Set(["deploy/linux/plymouth/eidetic-player.script"]);

function parseArguments(arguments_) {
  let repository = process.cwd();
  let git = "git";
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--repo") {
      repository = arguments_[index + 1] ?? "";
      index += 1;
    } else if (argument === "--git") {
      git = arguments_[index + 1] ?? "";
      index += 1;
    } else if (argument === "--help") {
      return { help: true, repository, git };
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!repository) throw new Error("--repo needs a value");
  if (!git) throw new Error("--git needs a value");
  return { help: false, repository: resolve(repository), git };
}

export function parseIndexRecords(output) {
  const records = [];
  for (const rawRecord of output.split("\0")) {
    if (!rawRecord) continue;
    const tab = rawRecord.indexOf("\t");
    if (tab < 0)
      throw new Error("Git returned an invalid NUL-delimited index record");
    const metadata = rawRecord.slice(0, tab).split(" ");
    if (metadata.length !== 3)
      throw new Error("Git returned ambiguous index metadata");
    const [mode, object, stageText] = metadata;
    if (!/^[0-7]{6}$/.test(mode) || !/^[0-9a-f]+$/i.test(object))
      throw new Error("Git returned invalid index metadata");
    const stage = Number(stageText);
    if (!Number.isInteger(stage))
      throw new Error("Git returned an invalid index stage");
    records.push({ mode, object, stage, path: rawRecord.slice(tab + 1) });
  }
  return records;
}

function isDataPath(path) {
  return (
    knownDataPaths.has(path) ||
    /(?:^|\/)README\.md$/i.test(path) ||
    /\.(?:desktop|env|example|md|plymouth|rules|service|template)$/i.test(path)
  );
}

function filesystemPath(repository, gitPath) {
  return resolve(repository, ...gitPath.split("/"));
}

async function inspectRecord(repository, record) {
  const absolute = filesystemPath(repository, record.path);
  const content = await readFile(absolute);
  const hasShebang = content[0] === 0x23 && content[1] === 0x21;
  const inferredScript =
    hasShebang ||
    record.path.endsWith(".sh") ||
    record.path.startsWith("deploy/linux/runtime/");
  const required = requiredExecutablePaths.has(record.path);
  const data = isDataPath(record.path);
  return { ...record, absolute, hasShebang, inferredScript, required, data };
}

export async function verifyLinuxExecutableModes({
  repository = process.cwd(),
  git = "git",
} = {}) {
  const root = resolve(repository);
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      git,
      ["-C", root, "ls-files", "--stage", "-z", "--", "deploy/linux"],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    const detail =
      code === "ENOENT"
        ? "Git is unavailable"
        : "the target is not a readable Git checkout";
    return {
      failures: [`${detail}; this guard requires the Git index for ${root}.`],
      checked: [],
    };
  }

  let records;
  try {
    records = parseIndexRecords(stdout);
  } catch (error) {
    return {
      failures: [
        error instanceof Error ? error.message : "Invalid Git index output",
      ],
      checked: [],
    };
  }

  const failures = [];
  const byPath = new Map();
  for (const record of records) {
    const existing = byPath.get(record.path) ?? [];
    existing.push(record);
    byPath.set(record.path, existing);
  }
  for (const [path, entries] of byPath) {
    if (entries.length !== 1 || entries[0].stage !== 0)
      failures.push(`duplicate or ambiguous Git index entry: ${path}`);
  }
  for (const path of requiredExecutablePaths) {
    if (!byPath.has(path))
      failures.push(`expected executable is absent: ${path}`);
  }

  const checked = [];
  for (const record of records) {
    if (record.stage !== 0) continue;
    if (record.mode === "120000") {
      failures.push(`unexpected symlink in Linux deployment: ${record.path}`);
      continue;
    }
    if (record.mode !== "100644" && record.mode !== "100755") {
      failures.push(`unexpected Git mode ${record.mode}: ${record.path}`);
      continue;
    }
    let item;
    try {
      item = await inspectRecord(root, record);
    } catch {
      failures.push(`tracked deployment file is missing: ${record.path}`);
      continue;
    }
    checked.push(item);
    if ((item.inferredScript || item.required) && item.data)
      failures.push(`ambiguous script/data classification: ${record.path}`);
    if ((item.inferredScript || item.required) && !item.hasShebang)
      failures.push(`script is missing a shebang: ${record.path}`);
    if ((item.inferredScript || item.required) && item.mode !== "100755")
      failures.push(
        `script must use Git mode 100755: ${record.path}\n` +
          `  Fix safely with: git update-index --chmod=+x -- "${record.path}"`,
      );
    if (item.mode === "100755" && !item.inferredScript && !item.required)
      failures.push(`data file must use Git mode 100644: ${record.path}`);

    if (process.platform !== "win32") {
      try {
        const details = await lstat(item.absolute);
        if ((details.mode & 0o002) !== 0)
          failures.push(`world-writable deployment file: ${record.path}`);
      } catch {
        failures.push(`could not inspect filesystem mode: ${record.path}`);
      }
    }
  }
  return { failures, checked };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[verify:linux:executables] FAIL ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(
      "Usage: node scripts/verify-linux-executable-modes.mjs [--repo PATH] [--git PATH]",
    );
    return;
  }
  const result = await verifyLinuxExecutableModes(options);
  for (const failure of result.failures)
    console.error(`[verify:linux:executables] FAIL ${failure}`);
  if (result.failures.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `[verify:linux:executables] PASS ${result.checked.length} tracked deployment files; script/data Git modes are valid`,
  );
  if (process.platform === "win32")
    console.log(
      "[verify:linux:executables] INFO POSIX world-write inspection is not available on Windows; Git index modes were verified",
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
