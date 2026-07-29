import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import {
  POWER_ACTION_DELAY_MS,
  POWER_PREFLIGHT_TIMEOUT_MS,
  createLinuxPowerActionAdapter,
  detectAvailablePowerActions,
  linuxPowerPaths,
  type PowerExecFile,
  type PowerScheduler,
  type PowerSpawn,
} from "../src/system/linux-power-adapter.js";
import {
  PowerActionCoordinator,
  PowerActionError,
} from "../src/system/power-action-coordinator.js";

function integrationProbe(executable: readonly string[] = []) {
  return {
    executable: (path: string) => executable.includes(path),
  };
}

void test("power capabilities follow the exact platform and installation matrix", () => {
  const complete = integrationProbe([
    linuxPowerPaths.pkexec,
    linuxPowerPaths.helper,
    linuxPowerPaths.systemctl,
  ]);
  assert.deepEqual(
    detectAvailablePowerActions("development", "win32", complete),
    ["quit"],
  );
  assert.deepEqual(
    detectAvailablePowerActions("standard", "linux", integrationProbe()),
    ["quit"],
  );
  assert.deepEqual(detectAvailablePowerActions("standard", "linux", complete), [
    "quit",
    "reboot",
    "shutdown",
  ]);
  assert.deepEqual(
    detectAvailablePowerActions(
      "standard",
      "linux",
      integrationProbe([linuxPowerPaths.pkexec, linuxPowerPaths.helper]),
    ),
    ["quit", "reboot", "shutdown"],
    "the unprivileged app does not need read access to root-owned Polkit rules",
  );
  assert.deepEqual(
    detectAvailablePowerActions(
      "appliance",
      "linux",
      integrationProbe([linuxPowerPaths.systemctl]),
    ),
    ["restart-app", "maintenance"],
  );
  assert.deepEqual(
    detectAvailablePowerActions("appliance", "linux", complete),
    ["restart-app", "maintenance", "reboot", "shutdown"],
  );
  assert.equal(
    detectAvailablePowerActions("appliance", "linux", complete).includes(
      "quit",
    ),
    false,
  );
});

void test("restart-app uses fixed user-systemd preflight and delayed execution", async () => {
  const execCalls: unknown[][] = [];
  const spawnCalls: unknown[][] = [];
  const scheduled: { callback: () => void; delay: number }[] = [];
  const execFile: PowerExecFile = (file, arguments_, options) => {
    execCalls.push([file, arguments_, options]);
    return Promise.resolve({ stdout: "loaded\n" });
  };
  const spawn: PowerSpawn = (file, arguments_, options) => {
    spawnCalls.push([file, arguments_, options]);
    return {
      once: () => undefined as never,
      unref: () => undefined,
    };
  };
  const schedule: PowerScheduler = (callback, delay) => {
    scheduled.push({ callback, delay });
    return { unref: () => undefined };
  };
  const adapter = createLinuxPowerActionAdapter({
    execFile,
    spawn,
    schedule,
  });

  await adapter.execute("restart-app");
  assert.deepEqual(execCalls, [
    [
      linuxPowerPaths.systemctl,
      [
        "--user",
        "show",
        "--property=LoadState",
        "--value",
        "eidetic-player.service",
      ],
      {
        shell: false,
        timeout: POWER_PREFLIGHT_TIMEOUT_MS,
        windowsHide: true,
      },
    ],
  ]);
  assert.equal(spawnCalls.length, 0);
  assert.equal(scheduled.length, 1);
  const firstScheduled = scheduled[0];
  assert.ok(firstScheduled);
  assert.equal(firstScheduled.delay, POWER_ACTION_DELAY_MS);
  firstScheduled.callback();
  assert.deepEqual(spawnCalls, [
    [
      linuxPowerPaths.systemctl,
      ["--user", "--no-block", "restart", "eidetic-player.service"],
      { detached: true, shell: false, stdio: "ignore" },
    ],
  ]);
});

void test("reboot and shutdown use pkexec probe before one delayed fixed action", async () => {
  for (const action of ["reboot", "shutdown"] as const) {
    const events: string[] = [];
    let scheduled: (() => void) | undefined;
    const adapter = createLinuxPowerActionAdapter({
      execFile: (file, arguments_, options) => {
        assert.equal(file, linuxPowerPaths.pkexec);
        assert.deepEqual(arguments_, [
          "--disable-internal-agent",
          linuxPowerPaths.helper,
          "probe",
        ]);
        assert.equal(options.shell, false);
        assert.equal(options.timeout, POWER_PREFLIGHT_TIMEOUT_MS);
        events.push("probe");
        return Promise.resolve({ stdout: "" });
      },
      schedule: (callback, delay) => {
        assert.equal(delay, POWER_ACTION_DELAY_MS);
        scheduled = callback;
        events.push("scheduled");
        return { unref: () => undefined };
      },
      spawn: (file, arguments_, options) => {
        assert.equal(file, linuxPowerPaths.pkexec);
        assert.deepEqual(arguments_, [
          "--disable-internal-agent",
          linuxPowerPaths.helper,
          action,
        ]);
        assert.deepEqual(options, {
          detached: true,
          shell: false,
          stdio: "ignore",
        });
        events.push("spawn");
        return {
          once: () => undefined as never,
          unref: () => undefined,
        };
      },
    });
    const coordinator = new PowerActionCoordinator(
      [action],
      () => {
        events.push("flush");
        return Promise.resolve();
      },
      adapter,
    );

    await coordinator.request(action);
    assert.deepEqual(events, ["flush", "probe", "scheduled"]);
    scheduled?.();
    assert.deepEqual(events, ["flush", "probe", "scheduled", "spawn"]);
    await assert.rejects(
      coordinator.request(action),
      (error: unknown) =>
        error instanceof PowerActionError &&
        error.code === "ACTION_IN_PROGRESS",
    );
  }
});

void test("preflight failures are sanitized and unlock the coordinator", async () => {
  let attempts = 0;
  const logs: string[] = [];
  const adapter = createLinuxPowerActionAdapter({
    execFile: () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(
            Object.assign(new Error("private stderr and username"), {
              code: 126,
            }),
          )
        : Promise.resolve({ stdout: "" });
    },
    schedule: () => ({ unref: () => undefined }),
    log: (message) => logs.push(message),
  });
  const coordinator = new PowerActionCoordinator(
    ["reboot"],
    () => Promise.resolve(),
    adapter,
  );

  await assert.rejects(
    coordinator.request("reboot"),
    (error: unknown) =>
      error instanceof PowerActionError &&
      error.code === "POWER_ACTION_FAILED" &&
      error.statusCode === 503 &&
      error.message === "The system action could not be started.",
  );
  await coordinator.request("reboot");
  assert.deepEqual(logs, ["[power] action=reboot phase=preflight exit=126"]);
  assert.doesNotMatch(logs.join("\n"), /private|username|stderr/u);
});

void test("power helper has a closed, root-only, absolute command contract", () => {
  const helperPath = "deploy/linux/runtime/eidetic-player-power-helper";
  const helper = readFileSync(helperPath, "utf8");
  assert.match(helper, /^#!\/usr\/bin\/env bash\nset -euo pipefail/u);
  assert.match(helper, /\[\[ \$# -eq 1 \]\] \|\| exit 64/u);
  assert.match(helper, /\(\(EUID == 0\)\) \|\| exit 77/u);
  assert.match(helper, /\[\[ -x \/usr\/bin\/systemctl \]\] \|\| exit 69/u);
  assert.match(helper, /exec \/usr\/bin\/systemctl --no-block reboot/u);
  assert.match(helper, /exec \/usr\/bin\/systemctl --no-block poweroff/u);
  assert.doesNotMatch(helper, /\b(?:sudo|eval|sh -c|bash -c)\b/u);
  assert.doesNotMatch(helper, /\b(?:PATH|command -v)\b/u);

  for (const arguments_ of [
    [],
    ["probe", "extra"],
    ["unknown"],
    ["restart-app"],
    ["--reboot"],
    ["/usr/bin/systemctl"],
  ]) {
    const result = spawnSync("bash", [helperPath, ...arguments_], {
      encoding: "utf8",
    });
    assert.equal(result.status, 64, `arguments: ${arguments_.join(" ")}`);
  }
  if (process.platform === "linux" && process.getuid?.() !== 0) {
    for (const action of ["reboot", "shutdown"]) {
      const result = spawnSync("bash", [helperPath, action], {
        encoding: "utf8",
      });
      assert.equal(result.status, 77);
    }
  }
});

void test("rendered Polkit rule authorizes only exact helper, user and local session", () => {
  const template = readFileSync(
    "deploy/linux/templates/eidetic-player-power.polkit.rules",
    "utf8",
  );
  assert.equal(template.match(/__EIDETIC_RUNTIME_USER__/gu)?.length, 1);
  assert.doesNotMatch(template, /isInGroup|sudo|wheel|\*|`|\?\./u);
  type PolkitRule = (
    action: { id: string; lookup: (key: string) => string },
    subject: { user: string; active: boolean; local: boolean },
  ) => string;
  const rules: PolkitRule[] = [];
  runInNewContext(template.replace("__EIDETIC_RUNTIME_USER__", "eidetic"), {
    polkit: {
      Result: { YES: "YES", NOT_HANDLED: "NOT_HANDLED" },
      addRule: (rule: (typeof rules)[number]) => rules.push(rule),
    },
  });
  const rule = rules[0];
  assert.ok(rule);
  const evaluate = (
    program: string,
    user = "eidetic",
    id = "org.freedesktop.policykit.exec",
    active = true,
    local = true,
  ) =>
    rule(
      { id, lookup: (key) => (key === "program" ? program : "") },
      { user, active, local },
    );
  assert.equal(evaluate(linuxPowerPaths.helper), "YES");
  for (const program of [
    "/bin/sh",
    "/usr/bin/systemctl",
    "/usr/bin/pkexec",
    "/usr/libexec/eidetic-player-power-helper-extra",
  ])
    assert.equal(evaluate(program), "NOT_HANDLED");
  assert.equal(evaluate(linuxPowerPaths.helper, "other"), "NOT_HANDLED");
  assert.equal(
    evaluate(linuxPowerPaths.helper, "eidetic", "other.action"),
    "NOT_HANDLED",
  );
  assert.equal(
    evaluate(linuxPowerPaths.helper, "eidetic", undefined, false),
    "NOT_HANDLED",
  );
  assert.equal(
    evaluate(linuxPowerPaths.helper, "eidetic", undefined, true, false),
    "NOT_HANDLED",
  );
});
