import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadBuildInfo, parseBuildInfo } from "../src/system/build-info.js";

const execFileAsync = promisify(execFile);

void test("build info derives the exact seven-character public Build ID", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "eidetic-build-generator-"));
  const output = resolve(root, "build-info.json");
  try {
    await execFileAsync(process.execPath, [
      "scripts/generate-build-info.mjs",
      "--output",
      output,
      "--commit",
      "0123456789abcdef0123456789abcdef01234567",
      "--ref",
      "refs/heads/feature/build id",
      "--built-at",
      "2026-07-27T10:00:00Z",
      "--source",
      "explicit",
    ]);
    const info = JSON.parse(await readFile(output, "utf8")) as unknown;
    assert.equal(parseBuildInfo(info)?.shortCommitSha, "0123456");
    assert.equal(parseBuildInfo(info)?.ref, "feature/build-id");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("build info rejects mismatched or unsafe provenance", async () => {
  const valid = {
    schemaVersion: 1 as const,
    commitSha: "abcdef0123456789abcdef0123456789abcdef01",
    shortCommitSha: "abcdef0",
    ref: "main",
    packageVersion: "0.1.0",
    builtAt: "2026-07-27T10:00:00.000Z",
    source: "ci",
  } as const;
  assert.equal(parseBuildInfo({ ...valid, shortCommitSha: "0000000" }), null);
  assert.equal(parseBuildInfo({ ...valid, ref: "../../secret value" }), null);
  await assert.rejects(
    execFileAsync(process.execPath, [
      "scripts/generate-build-info.mjs",
      "--output",
      resolve(tmpdir(), "invalid-build-info.json"),
      "--commit",
      "not-a-sha",
      "--source",
      "explicit",
    ]),
  );
});

void test("backend loads production provenance once and uses safe fallbacks", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "eidetic-build-info-"));
  try {
    const valid = {
      schemaVersion: 1 as const,
      commitSha: "fedcba9876543210fedcba9876543210fedcba98",
      shortCommitSha: "fedcba9",
      ref: "main",
      packageVersion: "0.1.0",
      builtAt: "2026-07-27T10:00:00.000Z",
      source: "explicit",
    } as const;
    await mkdir(root, { recursive: true });
    await writeFile(
      resolve(root, "build-info.json"),
      JSON.stringify(valid),
      "utf8",
    );
    assert.deepEqual(loadBuildInfo("production", root), valid);
    await writeFile(resolve(root, "build-info.json"), "{", "utf8");
    assert.equal(loadBuildInfo("production", root).shortCommitSha, "unknown");
    assert.equal(loadBuildInfo("development", root).shortCommitSha, "dev");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("development Build ID appends dev without runtime Git access", () => {
  const previous = process.env.EIDETIC_DEV_BUILD_ID;
  try {
    process.env.EIDETIC_DEV_BUILD_ID = "39af42f";
    assert.equal(loadBuildInfo("development").shortCommitSha, "39af42f-dev");
    process.env.EIDETIC_DEV_BUILD_ID = "unsafe";
    assert.equal(loadBuildInfo("development").shortCommitSha, "dev");
  } finally {
    if (previous === undefined) delete process.env.EIDETIC_DEV_BUILD_ID;
    else process.env.EIDETIC_DEV_BUILD_ID = previous;
  }
});
