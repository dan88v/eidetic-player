export const updateJobStates = [
  "idle",
  "queued",
  "running",
  "activating",
  "restarting",
  "verifying",
  "succeeded",
  "failed",
  "rolled-back",
  "interrupted",
  "recovery-required",
] as const;

export type UpdateJobState = (typeof updateJobStates)[number];

export const updateReasonCodes = [
  "branch-unavailable",
  "target-resolution-failed",
  "already-up-to-date",
  "job-conflict",
  "preparation-failed",
  "activation-failed",
  "rollback-completed",
  "rollback-failed",
  "health-failed",
  "interrupted",
] as const;

export type UpdateReasonCode = (typeof updateReasonCodes)[number];

export interface UpdateBranch {
  readonly name: string;
  readonly commitSha: string;
  readonly shortCommitSha: string;
  readonly channel: "stable" | "development";
}

export interface UpdatePlan {
  readonly id: string;
  readonly branch: string;
  readonly currentCommitSha: string;
  readonly currentShortCommitSha: string;
  readonly targetCommitSha: string;
  readonly targetShortCommitSha: string;
  readonly updateAvailable: boolean;
  readonly checkedAt: string;
  readonly expiresAt: string;
}

export interface UpdatePhase {
  readonly index: number;
  readonly total: number;
  readonly label: string;
  readonly substep: string | null;
}

export interface UpdateJob {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly jobId: string | null;
  readonly state: UpdateJobState;
  readonly branch: string;
  readonly currentCommitSha: string | null;
  readonly targetCommitSha: string | null;
  readonly phase: UpdatePhase | null;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly elapsedMs: number;
  readonly result: UpdateReasonCode | null;
  readonly rollback: "not-required" | "completed" | "failed";
  readonly warningCount: number;
  readonly serviceActive: boolean | null;
}

export interface SoftwareUpdateSnapshot {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly available: boolean;
  readonly localOnly: true;
  readonly selectedBranch: string;
  readonly branchesLoaded: boolean;
  readonly branches: readonly UpdateBranch[];
  readonly currentCommitSha: string | null;
  readonly currentShortCommitSha: string;
  readonly plan: UpdatePlan | null;
  readonly job: UpdateJob;
  readonly lastError: UpdateReasonCode | null;
}

export interface UpdateSelectBranchRequest {
  readonly branch: string;
}

export interface UpdateStartRequest {
  readonly planId: string;
  readonly expectedTargetCommitSha: string;
}

export const defaultSoftwareUpdateSnapshot: SoftwareUpdateSnapshot = {
  schemaVersion: 1,
  revision: 0,
  available: false,
  localOnly: true,
  selectedBranch: "main",
  branchesLoaded: false,
  branches: [],
  currentCommitSha: null,
  currentShortCommitSha: "unknown",
  plan: null,
  job: {
    schemaVersion: 1,
    revision: 0,
    jobId: null,
    state: "idle",
    branch: "main",
    currentCommitSha: null,
    targetCommitSha: null,
    phase: null,
    startedAt: null,
    updatedAt: new Date(0).toISOString(),
    completedAt: null,
    elapsedMs: 0,
    result: null,
    rollback: "not-required",
    warningCount: 0,
    serviceActive: null,
  },
  lastError: null,
};
