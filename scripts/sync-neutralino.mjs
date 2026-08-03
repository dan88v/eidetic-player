import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { extract } from "zip-lib";

const MAXIMUM_ARCHIVE_BYTES = 64 * 1024 * 1024;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_END_SIGNATURE = 0x06054b50;

export const neutralinoBinaryNames = Object.freeze([
  "neutralino-linux_x64",
  "neutralino-linux_armhf",
  "neutralino-linux_arm64",
  "neutralino-mac_x64",
  "neutralino-mac_arm64",
  "neutralino-mac_universal",
  "neutralino-win_x64.exe",
]);

function exactVersion(value, label) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`${label} must be an exact semantic version`);
  }
  return value;
}

export function neutralinoArchiveUrl(binaryVersion) {
  const version = exactVersion(binaryVersion, "Neutralino binary version");
  return `https://github.com/neutralinojs/neutralinojs/releases/download/v${version}/neutralinojs-v${version}.zip`;
}

function hasCompleteEndRecord(bytes) {
  const minimumEndRecordBytes = 22;
  const maximumCommentBytes = 65_535;
  const start = Math.max(
    0,
    bytes.length - minimumEndRecordBytes - maximumCommentBytes,
  );
  for (
    let offset = bytes.length - minimumEndRecordBytes;
    offset >= start;
    offset -= 1
  ) {
    if (bytes.readUInt32LE(offset) !== ZIP_END_SIGNATURE) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + minimumEndRecordBytes + commentLength === bytes.length)
      return true;
  }
  return false;
}

export function validateNeutralinoArchive(bytes, declaredLength = null) {
  if (!Buffer.isBuffer(bytes))
    throw new Error("Neutralino archive must be a buffer");
  if (bytes.length === 0 || bytes.length > MAXIMUM_ARCHIVE_BYTES) {
    throw new Error("Neutralino archive has an invalid size");
  }
  if (declaredLength !== null && declaredLength !== bytes.length) {
    throw new Error(
      "Neutralino archive length does not match the HTTP response",
    );
  }
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error("Neutralino archive does not have a ZIP file header");
  }
  if (!hasCompleteEndRecord(bytes)) {
    throw new Error(
      "Neutralino archive is truncated or lacks a complete ZIP directory",
    );
  }
}

function declaredResponseLength(response) {
  const value = response.headers?.get?.("content-length");
  if (value === null || value === undefined || value === "") return null;
  if (!/^\d+$/.test(value))
    throw new Error("Neutralino archive has an invalid Content-Length");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new Error(
      "Neutralino archive Content-Length is outside the supported range",
    );
  }
  return length;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function verifyExtractedBinaries(extractionRoot) {
  for (const binaryName of neutralinoBinaryNames) {
    const binaryPath = join(extractionRoot, binaryName);
    const statistics = await lstat(binaryPath);
    if (
      !statistics.isFile() ||
      statistics.isSymbolicLink() ||
      statistics.size === 0
    ) {
      throw new Error(`Neutralino archive contains an invalid ${binaryName}`);
    }
  }
}

export async function syncNeutralino({
  repositoryRoot = process.cwd(),
  fetchImplementation = globalThis.fetch,
  extractArchive = extract,
} = {}) {
  if (typeof fetchImplementation !== "function") {
    throw new Error("A Fetch-compatible implementation is required");
  }

  const root = resolve(repositoryRoot);
  const configuration = await readJson(join(root, "neutralino.config.json"));
  const binaryVersion = exactVersion(
    configuration.cli?.binaryVersion,
    "Neutralino binary version",
  );
  const clientVersion = exactVersion(
    configuration.cli?.clientVersion,
    "Neutralino client version",
  );
  const clientManifest = await readJson(
    join(root, "node_modules", "@neutralinojs", "lib", "package.json"),
  );
  if (clientManifest.version !== clientVersion) {
    throw new Error(
      `Neutralino client version mismatch: configured ${clientVersion}, installed ${clientManifest.version}`,
    );
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "eidetic-neutralino-"));
  const archivePath = join(temporaryRoot, `${randomUUID()}.zip`);
  const extractionRoot = join(temporaryRoot, "extracted");
  try {
    const response = await fetchImplementation(
      neutralinoArchiveUrl(binaryVersion),
      {
        headers: { "user-agent": "eidetic-player-build" },
        redirect: "follow",
        signal: globalThis.AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Neutralino archive download failed with HTTP ${response.status}`,
      );
    }

    const declaredLength = declaredResponseLength(response);
    const archive = Buffer.from(await response.arrayBuffer());
    validateNeutralinoArchive(archive, declaredLength);
    await writeFile(archivePath, archive, { flag: "wx", mode: 0o600 });
    await mkdir(extractionRoot, { mode: 0o700 });
    await extractArchive(archivePath, extractionRoot);
    await verifyExtractedBinaries(extractionRoot);

    const binaryRoot = join(root, "bin");
    await mkdir(binaryRoot, { recursive: true });
    for (const binaryName of neutralinoBinaryNames) {
      const destination = join(binaryRoot, binaryName);
      await copyFile(join(extractionRoot, binaryName), destination);
      if (process.platform !== "win32" && !binaryName.endsWith(".exe")) {
        await chmod(destination, 0o755);
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  syncNeutralino().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[neutralino-sync] ${message}`);
    process.exitCode = 1;
  });
}
