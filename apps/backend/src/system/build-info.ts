import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildInfoSources,
  developmentBuildInfo,
  type BuildInfo,
  unknownBuildInfo,
} from "../../../../packages/shared/src/system.js";

const fullShaPattern = /^[0-9a-f]{40}$/u;
const shortShaPattern = /^[0-9a-f]{7}$/u;
const safeRefPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;

export function parseBuildInfo(value: unknown): BuildInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.commitSha !== "string" ||
    !fullShaPattern.test(record.commitSha) ||
    typeof record.shortCommitSha !== "string" ||
    !shortShaPattern.test(record.shortCommitSha) ||
    record.shortCommitSha !== record.commitSha.slice(0, 7) ||
    typeof record.ref !== "string" ||
    !safeRefPattern.test(record.ref) ||
    typeof record.packageVersion !== "string" ||
    !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(record.packageVersion) ||
    typeof record.builtAt !== "string" ||
    !Number.isFinite(Date.parse(record.builtAt)) ||
    typeof record.source !== "string" ||
    !buildInfoSources
      .filter((source) => source !== "development" && source !== "unknown")
      .includes(record.source as never) ||
    (record.dirty !== undefined && typeof record.dirty !== "boolean")
  )
    return null;
  return record as unknown as BuildInfo;
}

export function loadBuildInfo(
  environment: "development" | "production",
  releaseRoot = process.env.EIDETIC_PLAYER_RELEASE ??
    (process.platform === "linux" ? "/opt/eidetic-player/current" : ""),
): BuildInfo {
  if (environment === "development") {
    const developmentId = process.env.EIDETIC_DEV_BUILD_ID;
    return developmentId && /^[0-9a-f]{7}$/u.test(developmentId)
      ? {
          ...developmentBuildInfo,
          shortCommitSha: `${developmentId}-dev`,
        }
      : developmentBuildInfo;
  }
  if (!releaseRoot) return unknownBuildInfo;
  try {
    const content = readFileSync(resolve(releaseRoot, "build-info.json"), {
      encoding: "utf8",
      flag: "r",
    });
    return parseBuildInfo(JSON.parse(content)) ?? unknownBuildInfo;
  } catch {
    return unknownBuildInfo;
  }
}
