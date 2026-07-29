import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { BuildInfo } from "../../../packages/shared/src/system.js";
import {
  emptyUpdateBody,
  selectBranchBody,
  startUpdateBody,
  validateBranchSyntax,
} from "../src/update/update-validation.js";
import { SoftwareUpdateService } from "../src/update/update-service.js";

const currentSha = "e76cbe7ed215cb3f898842267378910485e52e9a";
const targetSha = "a".repeat(40);
const buildInfo: BuildInfo = {
  schemaVersion: 1,
  commitSha: currentSha,
  shortCommitSha: currentSha.slice(0, 7),
  ref: "main",
  packageVersion: "0.1.0",
  builtAt: "2026-07-28T00:00:00.000Z",
  source: "explicit",
};

void test("branch validation rejects option injection, controls and malformed refs", () => {
  for (const value of [
    "-upload-pack=evil",
    "main\nother",
    "main..other",
    "refs heads/main",
    "a".repeat(129),
  ])
    assert.throws(() => validateBranchSyntax(value));
  assert.equal(
    validateBranchSyntax("development/touch-ui"),
    "development/touch-ui",
  );
  assert.deepEqual(selectBranchBody({ branch: "main" }), { branch: "main" });
  assert.throws(() => selectBranchBody({ branch: "main", remote: "evil" }));
});

void test("start body accepts only a plan id and exact expected SHA", () => {
  assert.doesNotThrow(() => {
    emptyUpdateBody({});
  });
  assert.throws(() => {
    emptyUpdateBody({ ref: "main" });
  });
  const request = {
    planId: "1".repeat(32),
    expectedTargetCommitSha: "a".repeat(40),
  };
  assert.deepEqual(startUpdateBody(request), request);
  assert.throws(() => startUpdateBody({ ...request, ref: "main" }));
  assert.throws(() =>
    startUpdateBody({ ...request, expectedTargetCommitSha: "a".repeat(7) }),
  );
});

void test(
  "cross-platform fixture keeps discovery explicit, pins the checked SHA and runs one job",
  { concurrency: false },
  async () => {
    let fixtureTarget = targetSha;
    const service = new SoftwareUpdateService(buildInfo, true, {
      fixtureMode: true,
      fixtureDurationMs: 200,
      fixtureTarget: () => fixtureTarget,
      fixtureTargetCommitAt: () => "2026-07-29T12:00:00.000Z",
    });
    await service.initialize();
    const states: string[] = [];
    const unsubscribe = service.subscribe((snapshot) => {
      states.push(snapshot.job.state);
    });
    try {
      assert.equal(service.snapshot().branchesLoaded, false);
      const refreshed = await service.refreshBranches();
      assert.equal(refreshed.branches[0]?.name, "main");
      assert.equal(
        refreshed.branches.find((branch) => branch.name === "main")?.channel,
        "stable",
      );
      assert.equal(
        refreshed.branches.find(
          (branch) => branch.name === "development/ui-fixture",
        )?.channel,
        "development",
      );
      const checked = await service.check();
      assert.equal(checked.plan?.targetCommitSha, targetSha);
      assert.ok(checked.plan);
      assert.equal(checked.plan.updateAvailable, true);
      assert.equal(checked.currentBuiltAt, buildInfo.builtAt);
      assert.equal(checked.plan.targetCommitAt, "2026-07-29T12:00:00.000Z");
      const plan = checked.plan;
      assert.ok(plan);
      assert.equal(
        Date.parse(plan.expiresAt) - Date.parse(plan.checkedAt),
        30 * 60 * 1_000,
      );
      fixtureTarget = "b".repeat(40);
      await service.start(plan.id, plan.targetCommitSha);
      assert.equal(service.snapshot().job.state, "running");
      assert.equal(service.snapshot().job.targetCommitSha, targetSha);
      await assert.rejects(
        service.start(plan.id, plan.targetCommitSha),
        /already running/u,
      );
      await assert.rejects(
        service.selectBranch("development/ui-fixture"),
        /already running/u,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(service.snapshot().job.state, "succeeded");
      assert.deepEqual(
        states.filter((state, index) => state !== states[index - 1]),
        ["idle", "running", "activating", "restarting", "succeeded"],
      );
      await service.selectBranch("development/ui-fixture");
      assert.equal(service.snapshot().plan, null);
      await assert.rejects(
        service.selectBranch("development/not-discovered"),
        /Refresh branches/u,
      );
    } finally {
      unsubscribe();
      service.close();
    }
  },
);

void test(
  "up-to-date checks stay no-op and non-appliance services remain unavailable",
  { concurrency: false },
  async () => {
    const fixture = {
      fixtureMode: true,
      fixtureTarget: () => currentSha,
    };
    const service = new SoftwareUpdateService(buildInfo, true, fixture);
    const unavailable = new SoftwareUpdateService(buildInfo, false, fixture);
    await service.initialize();
    await unavailable.initialize();
    try {
      await service.refreshBranches();
      const snapshot = await service.check();
      assert.equal(snapshot.plan?.updateAvailable, false);
      assert.equal(snapshot.lastError, "already-up-to-date");
      assert.ok(snapshot.plan);
      await assert.rejects(
        service.start(snapshot.plan.id, snapshot.plan.targetCommitSha),
        /already up to date/u,
      );
      assert.equal(service.snapshot().job.state, "idle");
      assert.equal(unavailable.snapshot().available, false);
      await assert.rejects(unavailable.refreshBranches(), /Appliance mode/u);
    } finally {
      service.close();
      unavailable.close();
    }
  },
);

void test("deployment uses systemd, exact SHA argv and structured progress only", async () => {
  const [runner, helper, unit, journal, updater, installer, doctor, service] =
    await Promise.all([
      readFile("deploy/linux/runtime/eidetic-player-update-runner", "utf8"),
      readFile("deploy/linux/runtime/eidetic-player-update-helper", "utf8"),
      readFile("deploy/linux/templates/eidetic-player-update.service", "utf8"),
      readFile("deploy/linux/lib/eidetic-player-update-journal.mjs", "utf8"),
      readFile("deploy/linux/update-eidetic-player.sh", "utf8"),
      readFile("deploy/linux/install-eidetic-player.sh", "utf8"),
      readFile("deploy/linux/doctor-installation.sh", "utf8"),
      readFile("apps/backend/src/update/update-service.ts", "utf8"),
    ]);
  assert.match(unit, /Type=oneshot/u);
  assert.match(unit, /Group=__EIDETIC_RUNTIME_USER__/u);
  assert.match(unit, /UMask=0027/u);
  assert.match(runner, /flock -n/u);
  assert.match(runner, /--ref "\$target" --unattended/u);
  assert.doesNotMatch(runner, /eval|sh -c|nohup|tmux|screen/u);
  assert.match(helper, /git check-ref-format --branch/u);
  assert.match(helper, /refs\/heads\/\$branch/u);
  assert.match(helper, /select-branch[\s\S]+ls-remote --exit-code --heads/u);
  assert.match(journal, /EIDETIC_PROGRESS_V1/u);
  assert.match(journal, /mode: 0o640/u);
  assert.match(journal, /rollback-completed/u);
  assert.match(updater, /rollback-failed/u);
  assert.match(updater, /eidetic_fetch_isolated_source/u);
  assert.match(
    updater,
    /bootstrap_installer="\$bootstrap_workspace\/source\/deploy\/linux\/install-eidetic-player\.sh"/u,
  );
  assert.match(updater, /"\$bootstrap_installer" "\$\{args\[@\]\}"/u);
  assert.match(installer, /install -d -m 0710 -o root -g "\$runtime_user"/u);
  assert.match(
    installer,
    /"\$update_unit" \/etc\/systemd\/system\/eidetic-player-update\.service/u,
  );
  assert.match(doctor, /update-journal-readable/u);
  const start = service.slice(
    service.indexOf("async start("),
    service.indexOf("private async readSelectedBranch"),
  );
  assert.match(start, /await this\.runHelper/u);
  assert.match(start, /state: "queued"/u);
  assert.match(start, /this\.emit\(\)/u);
  assert.doesNotMatch(start, /refreshJournal/u);
  assert.doesNotMatch(journal, /stdout|stderr/u);
  assert.match(updater, /EIDETIC_UPDATE_JOB_FD/u);
});
