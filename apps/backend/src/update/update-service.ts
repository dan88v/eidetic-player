import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type {
  SoftwareUpdateSnapshot,
  UpdateBranch,
  UpdateJob,
  UpdatePlan,
  UpdateReasonCode,
} from "../../../../packages/shared/src/update.js";
import type { BuildInfo } from "../../../../packages/shared/src/system.js";
import { UpdateError } from "./update-errors.js";
import {
  fullShaPattern,
  validateBranch,
  validateBranchSyntax,
} from "./update-validation.js";

const remote = "https://github.com/dan88v/eidetic-player.git";
const configPath = "/etc/eidetic-player/update.conf";
const journalPath = "/var/lib/eidetic-player/update/current.json";
const maxRemoteOutput = 256 * 1024;
const planLifetimeMs = 30 * 60 * 1_000;
const activeJobStates = [
  "queued",
  "running",
  "activating",
  "restarting",
  "verifying",
] as const;

type Listener = (snapshot: SoftwareUpdateSnapshot) => void;

function idleJob(branch: string): UpdateJob {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    revision: 0,
    jobId: null,
    state: "idle",
    branch,
    currentCommitSha: null,
    targetCommitSha: null,
    phase: null,
    startedAt: null,
    updatedAt: now,
    completedAt: null,
    elapsedMs: 0,
    result: null,
    rollback: "not-required",
    warningCount: 0,
    serviceActive: null,
  };
}

function sanitizedReason(value: unknown): UpdateReasonCode | null {
  const allowed = new Set<UpdateReasonCode>([
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
  ]);
  return typeof value === "string" && allowed.has(value as UpdateReasonCode)
    ? (value as UpdateReasonCode)
    : null;
}

function parseJournal(value: unknown, fallback: UpdateJob): UpdateJob {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Partial<UpdateJob>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.revision !== "number" ||
    typeof record.state !== "string" ||
    typeof record.branch !== "string" ||
    typeof record.updatedAt !== "string"
  )
    return fallback;
  return {
    ...fallback,
    ...record,
    result: sanitizedReason(record.result),
  };
}

function run(
  executable: string,
  args: readonly string[],
  input?: string,
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      [...args],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: maxRemoteOutput,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            error instanceof Error ? error : new Error("Child process failed."),
          );
        else resolve({ stdout, stderr });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

export class SoftwareUpdateService {
  private selectedBranch = "main";
  private branches: readonly UpdateBranch[] = [];
  private branchesLoaded = false;
  private plan: UpdatePlan | null = null;
  private job = idleJob("main");
  private revision = 0;
  private lastError: UpdateReasonCode | null = null;
  private readonly listeners = new Set<Listener>();
  private journalTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly buildInfo: BuildInfo,
    private readonly available = process.platform === "win32",
  ) {}

  async initialize(): Promise<void> {
    this.selectedBranch = await this.readSelectedBranch();
    this.job = idleJob(this.selectedBranch);
    this.job = await this.readJournal(this.job);
    this.emit();
    if (process.platform !== "win32") {
      this.journalTimer = setInterval(() => {
        void this.refreshJournal();
      }, 2_000);
      this.journalTimer.unref();
    }
  }

  close(): void {
    if (this.journalTimer) clearInterval(this.journalTimer);
    this.listeners.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): SoftwareUpdateSnapshot {
    return {
      schemaVersion: 1,
      revision: this.revision,
      available: this.available,
      localOnly: true,
      selectedBranch: this.selectedBranch,
      branchesLoaded: this.branchesLoaded,
      branches: this.branches,
      currentCommitSha: this.buildInfo.commitSha,
      currentShortCommitSha: this.buildInfo.shortCommitSha,
      plan: this.plan,
      job: this.job,
      lastError: this.lastError,
    };
  }

  async refreshBranches(): Promise<SoftwareUpdateSnapshot> {
    this.assertAvailable();
    try {
      const output =
        process.platform === "win32"
          ? [
              `${this.fixtureSha("main")}\trefs/heads/main`,
              `${this.fixtureSha("development/ui-fixture")}\trefs/heads/development/ui-fixture`,
            ].join("\n")
          : (await run("git", ["ls-remote", "--heads", remote])).stdout;
      const deduplicated = new Map<string, UpdateBranch>();
      for (const line of output.split(/\r?\n/u).slice(0, 512)) {
        const match = /^([0-9a-f]{40})\trefs\/heads\/(.+)$/u.exec(line);
        if (!match) continue;
        const commitSha = match[1];
        const rawName = match[2];
        if (commitSha === undefined || rawName === undefined) continue;
        const name = validateBranchSyntax(rawName);
        if (!fullShaPattern.test(commitSha)) continue;
        deduplicated.set(name, {
          name,
          commitSha,
          shortCommitSha: commitSha.slice(0, 7),
          channel: name === "main" ? "stable" : "development",
        });
      }
      this.branches = [...deduplicated.values()].sort((left, right) =>
        left.name === "main"
          ? -1
          : right.name === "main"
            ? 1
            : left.name.localeCompare(right.name),
      );
      this.branchesLoaded = true;
      this.lastError = null;
      this.emit();
      return this.snapshot();
    } catch {
      this.lastError = "target-resolution-failed";
      this.emit();
      throw new UpdateError(
        "target-resolution-failed",
        "Branches could not be refreshed.",
        503,
      );
    }
  }

  async selectBranch(branch: string): Promise<SoftwareUpdateSnapshot> {
    this.assertAvailable();
    if (this.jobIsActive())
      throw new UpdateError(
        "job-conflict",
        "Another update is already running.",
        409,
      );
    const validated = await validateBranch(branch);
    if (
      !this.branchesLoaded ||
      !this.branches.some((candidate) => candidate.name === validated)
    )
      throw new UpdateError(
        "branch-unavailable",
        "Refresh branches before selecting that branch.",
        409,
      );
    if (process.platform !== "win32")
      await this.runHelper(["select-branch", validated]);
    this.selectedBranch = validated;
    if (this.job.state === "idle")
      this.job = { ...this.job, branch: validated };
    this.plan = null;
    this.lastError = null;
    this.emit();
    return this.snapshot();
  }

  async check(): Promise<SoftwareUpdateSnapshot> {
    this.assertAvailable();
    if (this.jobIsActive())
      throw new UpdateError(
        "job-conflict",
        "Another update is already running.",
        409,
      );
    const branch = await validateBranch(this.selectedBranch);
    try {
      const target =
        process.platform === "win32"
          ? (process.env.EIDETIC_UPDATE_FIXTURE_TARGET_SHA ??
            this.buildInfo.commitSha ??
            this.fixtureSha(branch))
          : (
              await run("git", [
                "ls-remote",
                "--exit-code",
                remote,
                `refs/heads/${branch}`,
              ])
            ).stdout.split(/\s/u, 1)[0];
      if (!target || !fullShaPattern.test(target))
        throw new Error("invalid target");
      const current = await this.currentCommitSha();
      if (!current || !fullShaPattern.test(current))
        throw new UpdateError(
          "target-resolution-failed",
          "The installed build has no verifiable commit.",
          409,
        );
      const checkedAt = new Date();
      this.plan = {
        id: randomBytes(16).toString("hex"),
        branch,
        currentCommitSha: current,
        currentShortCommitSha: current.slice(0, 7),
        targetCommitSha: target,
        targetShortCommitSha: target.slice(0, 7),
        updateAvailable: current !== target,
        checkedAt: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + planLifetimeMs).toISOString(),
      };
      this.lastError = current === target ? "already-up-to-date" : null;
      this.emit();
      return this.snapshot();
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      this.plan = null;
      this.lastError = "target-resolution-failed";
      this.emit();
      throw new UpdateError(
        "target-resolution-failed",
        "The selected branch could not be checked.",
        503,
      );
    }
  }

  async start(planId: string, expectedTarget: string): Promise<void> {
    this.assertAvailable();
    const plan = this.plan;
    if (!plan)
      throw new UpdateError(
        "target-resolution-failed",
        "The checked update plan is no longer valid.",
        409,
      );
    if (
      plan.id !== planId ||
      plan.targetCommitSha !== expectedTarget ||
      Date.parse(plan.expiresAt) <= Date.now() ||
      plan.branch !== this.selectedBranch ||
      plan.currentCommitSha !== (await this.currentCommitSha())
    )
      throw new UpdateError(
        "target-resolution-failed",
        "The checked update plan is no longer valid.",
        409,
      );
    if (!plan.updateAvailable)
      throw new UpdateError(
        "already-up-to-date",
        "Eidetic Player is already up to date.",
        409,
      );
    if (this.jobIsActive())
      throw new UpdateError(
        "job-conflict",
        "Another update is already running.",
        409,
      );
    if (process.platform === "win32") {
      this.simulateFixture(plan);
      return;
    }
    await this.runHelper([
      "start",
      plan.id,
      plan.branch,
      plan.currentCommitSha,
      plan.targetCommitSha,
      plan.expiresAt,
    ]);
    await this.refreshJournal();
  }

  private async readSelectedBranch(): Promise<string> {
    if (process.platform === "win32") return "main";
    try {
      const content = await readFile(configPath, "utf8");
      const match = /^EIDETIC_UPDATE_BRANCH=([^\r\n]+)$/mu.exec(content);
      return validateBranchSyntax(match?.[1] ?? "main");
    } catch {
      return "main";
    }
  }

  private async readJournal(fallback: UpdateJob): Promise<UpdateJob> {
    if (process.platform === "win32") return fallback;
    try {
      const metadata = await stat(journalPath);
      if (!metadata.isFile()) return fallback;
      const parsed = parseJournal(
        JSON.parse(await readFile(journalPath, "utf8")),
        fallback,
      );
      if (activeJobStates.some((state) => state === parsed.state))
        try {
          await run("systemctl", [
            "is-active",
            "--quiet",
            "eidetic-player-update.service",
          ]);
        } catch {
          const completedAt = new Date().toISOString();
          return {
            ...parsed,
            state: "interrupted",
            result: "interrupted",
            phase: null,
            updatedAt: completedAt,
            completedAt,
          };
        }
      return parsed;
    } catch {
      return fallback;
    }
  }

  private async refreshJournal(): Promise<void> {
    const next = await this.readJournal(this.job);
    if (
      next.revision === this.job.revision &&
      next.updatedAt === this.job.updatedAt
    )
      return;
    this.job = next;
    this.emit();
  }

  private async runHelper(args: readonly string[]): Promise<void> {
    try {
      await run(
        "pkexec",
        [
          "--disable-internal-agent",
          "/usr/libexec/eidetic-player-update-helper",
          ...args,
        ],
        undefined,
        20_000,
      );
    } catch {
      throw new UpdateError(
        "preparation-failed",
        "The update action could not be authorized.",
        503,
      );
    }
  }

  private fixtureSha(seed: string): string {
    return createHash("sha1").update(`eidetic:${seed}`).digest("hex");
  }

  private assertAvailable(): void {
    if (!this.available)
      throw new UpdateError(
        "preparation-failed",
        "Software Update is available only in Appliance mode.",
        404,
      );
  }

  private jobIsActive(): boolean {
    return activeJobStates.some((state) => state === this.job.state);
  }

  private async currentCommitSha(): Promise<string | null> {
    if (this.buildInfo.commitSha) return this.buildInfo.commitSha;
    if (process.platform !== "win32") return null;
    const value = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
    return fullShaPattern.test(value) ? value : null;
  }

  private simulateFixture(plan: UpdatePlan): void {
    const startedAt = new Date().toISOString();
    this.job = {
      ...idleJob(plan.branch),
      revision: this.job.revision + 1,
      jobId: plan.id,
      state: "running",
      branch: plan.branch,
      currentCommitSha: plan.currentCommitSha,
      targetCommitSha: plan.targetCommitSha,
      phase: {
        index: 1,
        total: 7,
        label: "Preparing application",
        substep: "Windows fixture",
      },
      startedAt,
      updatedAt: startedAt,
    };
    this.emit();
    const duration = Number(
      process.env.EIDETIC_UPDATE_FIXTURE_DURATION_MS ?? 1_200,
    );
    const advance = (
      state: "activating" | "restarting",
      label: string,
      delay: number,
    ): void => {
      const timer = setTimeout(() => {
        this.job = {
          ...this.job,
          revision: this.job.revision + 1,
          state,
          phase: {
            index: state === "activating" ? 5 : 6,
            total: 7,
            label,
            substep: null,
          },
          updatedAt: new Date().toISOString(),
          elapsedMs: Date.now() - Date.parse(startedAt),
        };
        this.emit();
      }, delay);
      timer.unref();
    };
    advance("activating", "Applying update", Math.floor(duration * 0.6));
    advance(
      "restarting",
      "Restarting Eidetic Player",
      Math.floor(duration * 0.78),
    );
    const timer = setTimeout(() => {
      this.job = {
        ...this.job,
        revision: this.job.revision + 1,
        state: "succeeded",
        phase: null,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        elapsedMs: Math.max(0, Date.now() - Date.parse(startedAt)),
        serviceActive: true,
      };
      this.emit();
    }, duration);
    timer.unref();
  }

  private emit(): void {
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
