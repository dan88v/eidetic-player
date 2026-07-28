import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  UpdateSelectBranchRequest,
  UpdateStartRequest,
} from "../../../../packages/shared/src/update.js";
import { UpdateError } from "./update-errors.js";

const execFileAsync = promisify(execFile);
const branchPattern =
  /^(?!-)(?!.*(?:\.\.|@\{|\/\/|[~^:?*\\\s]))[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
export const fullShaPattern = /^[0-9a-f]{40}$/;
export const planIdPattern = /^[0-9a-f]{32}$/;

export function validateBranchSyntax(branch: unknown): string {
  if (typeof branch !== "string" || !branchPattern.test(branch))
    throw new UpdateError(
      "branch-unavailable",
      "That update branch is invalid.",
    );
  return branch;
}

export async function validateBranch(branch: unknown): Promise<string> {
  const value = validateBranchSyntax(branch);
  if (process.platform !== "win32")
    try {
      await execFileAsync("git", ["check-ref-format", "--branch", value], {
        timeout: 2_000,
        windowsHide: true,
      });
    } catch {
      throw new UpdateError(
        "branch-unavailable",
        "That update branch is invalid.",
      );
    }
  return value;
}

export function selectBranchBody(body: unknown): UpdateSelectBranchRequest {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new UpdateError("branch-unavailable", "Invalid branch request.");
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "branch"))
    throw new UpdateError("branch-unavailable", "Invalid branch request.");
  return { branch: validateBranchSyntax(record.branch) };
}

export function emptyUpdateBody(body: unknown): void {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 0
  )
    throw new UpdateError(
      "target-resolution-failed",
      "Invalid update request.",
    );
}

export function startUpdateBody(body: unknown): UpdateStartRequest {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new UpdateError(
      "target-resolution-failed",
      "Invalid update request.",
    );
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "planId" && key !== "expectedTargetCommitSha",
    ) ||
    typeof record.planId !== "string" ||
    !planIdPattern.test(record.planId) ||
    typeof record.expectedTargetCommitSha !== "string" ||
    !fullShaPattern.test(record.expectedTargetCommitSha)
  )
    throw new UpdateError(
      "target-resolution-failed",
      "Invalid update request.",
    );
  return {
    planId: record.planId,
    expectedTargetCommitSha: record.expectedTargetCommitSha,
  };
}
