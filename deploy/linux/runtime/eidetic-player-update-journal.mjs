#!/usr/bin/env node
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const stateDir = "/var/lib/eidetic-player/update";
const currentPath = join(stateDir, "current.json");
const requestPath = join(stateDir, "request.json");
const command = process.argv[2];
const now = () => new Date().toISOString();
const clean = (value, maximum = 96) =>
  [...String(value ?? "")]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .slice(0, maximum);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const request = read(requestPath);
let journal;
try {
  journal = read(currentPath);
} catch {
  journal = null;
}

function atomicWrite(value) {
  const temporary = join(stateDir, `.current.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o640 });
  const fd = openSync(temporary, "r");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(temporary, currentPath);
  const parentFd = openSync(dirname(currentPath), "r");
  fsyncSync(parentFd);
  closeSync(parentFd);
}

if (command === "initialize") {
  journal = {
    schemaVersion: 1,
    revision: Number(journal?.revision ?? 0) + 1,
    jobId: request.planId,
    state: "queued",
    branch: request.branch,
    currentCommitSha: request.currentCommitSha,
    targetCommitSha: request.targetCommitSha,
    phase: null,
    startedAt: now(),
    updatedAt: now(),
    completedAt: null,
    elapsedMs: 0,
    result: null,
    rollback: "not-required",
    warningCount: 0,
    serviceActive: null,
  };
} else if (command === "event") {
  if (!journal || journal.jobId !== request.planId) process.exit(65);
  const line = String(process.argv[3] ?? "");
  if (line.length > 4096) process.exit(64);
  const fields = line.split("\t");
  if (fields[0] !== "EIDETIC_PROGRESS_V1") process.exit(0);
  if (fields[1] === "runtime") {
    const event = fields[2];
    const index = Number(fields[4]);
    const total = Number(fields[5]);
    if (
      !["start", "done", "skipped", "failed"].includes(event) ||
      !Number.isInteger(index) ||
      !Number.isInteger(total)
    )
      process.exit(0);
    journal.state = "running";
    journal.phase = {
      index,
      total,
      label: clean(fields[3].replaceAll("-", " ")),
      substep:
        event === "start"
          ? clean(fields[3].replaceAll("-", " "))
          : event === "failed"
            ? "Failed"
            : null,
    };
  } else if (fields[1] === "update") {
    const event = fields[2];
    if (event === "activation-imminent") journal.state = "activating";
    else if (event === "restarting") journal.state = "restarting";
    else if (event === "verifying") journal.state = "verifying";
    else if (event === "warning") journal.warningCount += 1;
    else if (event === "rollback-completed") {
      journal.state = "rolled-back";
      journal.rollback = "completed";
      journal.result = "rollback-completed";
    } else if (event === "rollback-failed") {
      journal.state = "failed";
      journal.rollback = "failed";
      journal.result = "rollback-failed";
    } else process.exit(0);
    journal.phase = {
      index: Number(fields[3] || 0),
      total: Number(fields[4] || 0),
      label: clean(fields[5] || event),
      substep: clean(fields[6] || "") || null,
    };
  } else process.exit(0);
  journal.revision += 1;
  journal.updatedAt = now();
  journal.elapsedMs = Math.max(0, Date.now() - Date.parse(journal.startedAt));
} else if (command === "finish") {
  if (!journal || journal.jobId !== request.planId) process.exit(65);
  const status = Number(process.argv[3]);
  const failedState = journal.state;
  journal.revision += 1;
  journal.state =
    status === 0
      ? "succeeded"
      : journal.rollback === "completed"
        ? "rolled-back"
        : "failed";
  journal.result =
    status === 0
      ? null
      : journal.rollback === "completed"
        ? "rollback-completed"
        : journal.rollback === "failed"
          ? "rollback-failed"
          : ["activating", "restarting"].includes(failedState)
            ? "activation-failed"
            : failedState === "verifying"
              ? "health-failed"
              : "preparation-failed";
  journal.phase = null;
  journal.updatedAt = now();
  journal.completedAt = journal.updatedAt;
  journal.elapsedMs = Math.max(0, Date.now() - Date.parse(journal.startedAt));
  journal.serviceActive =
    status === 0 || journal.rollback === "completed" ? true : null;
} else if (command === "interrupt") {
  if (!journal || journal.jobId !== request.planId) process.exit(0);
  if (["succeeded", "failed", "rolled-back"].includes(journal.state))
    process.exit(0);
  journal.revision += 1;
  journal.state = "interrupted";
  journal.result = "interrupted";
  journal.phase = null;
  journal.updatedAt = now();
  journal.completedAt = journal.updatedAt;
  journal.elapsedMs = Math.max(0, Date.now() - Date.parse(journal.startedAt));
} else process.exit(64);

atomicWrite(journal);
